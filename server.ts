import "dotenv/config";
import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import TelegramBot from "./server/telegram";
import type * as TelegramBotTypes from "node-telegram-bot-api";
import {
  buildNewOrderMessagePayload,
  escapeHtml,
  formatOrderLines,
  isStartCommand,
  parseOrderCallbackData,
} from "./server/botMessages";
import * as store from "./server/store";
import type { ServerTransaction } from "./server/store";

type TelegramBotInstance = InstanceType<typeof TelegramBot>;

async function sendOrderTelegram(
  bot: TelegramBotInstance,
  chatId: string,
  tx: ServerTransaction,
  profileName: string
) {
  const { text, reply_markup } = buildNewOrderMessagePayload(tx, profileName);
  await bot.sendMessage(chatId, text, {
    parse_mode: "HTML",
    reply_markup,
  });
}

async function startServer() {
  const app = express();
  const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

  app.use(express.json());
  app.set("trust proxy", true);

  const botToken = process.env.TELEGRAM_BOT_TOKEN?.trim();
  let bot: TelegramBotInstance | null = null;

  if (botToken) {
    /** polling: false ثم deleteWebHook — إن وُجد webhook يمنع getUpdates من العمل */
    bot = new TelegramBot(botToken, { polling: false });

    const sendSiteSettingsMenu = async (chatId: number, messageId: number) => {
      const s = await store.getAppSettings();
      const line = (on: boolean) => (on ? "✅ تشغيل" : "⛔ إيقاف");
      const text =
        `<b>إعدادات الموقع</b>\n\n` +
        `🔧 وضع الصيانة: ${line(s.maintenance_mode)}\n` +
        `🛒 شراء (قريباً): ${line(s.buy_coming_soon)}\n` +
        `💰 بيع (قريباً): ${line(s.sell_coming_soon)}\n\n` +
        `<i>اضغط للتبديل — يظهر فوراً على الموقع.</i>`;
      const options: TelegramBotTypes.EditMessageTextOptions = {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: "HTML",
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: s.maintenance_mode ? "⛔ إيقاف الصيانة" : "🔧 تفعيل الصيانة",
                callback_data: "site_toggle_maintenance_mode",
              },
            ],
            [
              {
                text: s.buy_coming_soon ? "⛔ إيقاف «قريباً» شراء" : "🛒 تفعيل «قريباً» شراء",
                callback_data: "site_toggle_buy_coming_soon",
              },
            ],
            [
              {
                text: s.sell_coming_soon ? "⛔ إيقاف «قريباً» بيع" : "💰 تفعيل «قريباً» بيع",
                callback_data: "site_toggle_sell_coming_soon",
              },
            ],
            [{ text: "القائمة الرئيسية 🏠", callback_data: "main_menu" }],
          ],
        },
      };
      await bot?.editMessageText(text, options);
    };

    const sendMainMenu = (chatId: number, messageId?: number) => {
      const text = "<b>القائمة الرئيسية</b>\nاختر من الخيارات أدناه:";
      const options: TelegramBotTypes.SendMessageOptions = {
        parse_mode: "HTML",
        reply_markup: {
          inline_keyboard: [
            [{ text: "الطلبات 🛒", callback_data: "menu_orders" }],
            [{ text: "البروفايلات 👤", callback_data: "menu_profiles" }],
            [{ text: "إعدادات الموقع 🌐", callback_data: "menu_site_settings" }],
            [{ text: "تعديل سعر الصرف 💱", callback_data: "menu_exchange_rate" }],
          ],
        },
      };

      if (messageId) {
        void bot?.editMessageText(text, {
          chat_id: chatId,
          message_id: messageId,
          ...(options as TelegramBotTypes.EditMessageTextOptions),
        }).catch((e) => console.error("Telegram editMessageText (main menu):", e));
      } else {
        void bot
          ?.sendMessage(chatId, text, options)
          .catch((e) => console.error("Telegram sendMessage (main menu):", e));
      }
    };

    /** استخدام message بدل onText فقط — يغطي /start@username ويُسجّل الأخطاء */
    bot.on("message", (msg) => {
      try {
        if (!isStartCommand(msg.text)) return;
        sendMainMenu(msg.chat.id);
      } catch (e) {
        console.error("Telegram handler /start:", e);
      }
    });

    bot.on("callback_query", async (query) => {
      const chatId = query.message?.chat.id;
      const messageId = query.message?.message_id;
      const data = query.data;

      if (!chatId || !messageId) return;

      const answerEnd = async () => {
        try {
          await bot?.answerCallbackQuery(query.id);
        } catch {
          /* ignore */
        }
      };

      const orderCb = parseOrderCallbackData(data);
      if (orderCb) {
        const { action, orderRef } = orderCb;
        if (action === "complete") {
          const ok = await store.updateTransactionStatusByRef(orderRef, "completed");
          if (ok) {
            // Increment balance if it was a sell transaction with an agent number
            const allTxs = await store.listAllTransactionsMerged();
            const tx = allTxs.find(t => t.order_ref === orderRef);
            if (tx && tx.type === "sell" && tx.agent_number_id) {
              const res = await store.incrementNumberBalance(tx.agent_number_id, tx.amount);
              if (res?.exhausted) {
                // Notify admin
                const numbers = await store.listAgentNumbers(res.agentId);
                const num = numbers.find(n => n.id === tx.agent_number_id);
                const allExhausted = numbers.every(n => n.is_exhausted);
                
                let notifyMsg = `⚠️ <b>تنبيه: وصول الحد الأقصى</b>\n`;
                notifyMsg += `📱 الرقم: <code>${num?.phone_number}</code> وصل إلى 300,000 IQD.\n`;
                if (allExhausted) {
                  notifyMsg += `🛑 <b>جميع أرقام الوكيل استنفذت!</b> يرجى تفعيل وكيل آخر.`;
                } else {
                  notifyMsg += `🔄 تم الانتقال للرقم التالي تلقائياً.`;
                }
                await bot?.sendMessage(chatId, notifyMsg, { parse_mode: "HTML" });
              }
            }
          }
          await bot?.answerCallbackQuery({ callback_query_id: query.id, text: "تم إكمال الطلب" });
          return;
        }
        if (action === "cancel" || action === "refund") {
          await store.updateTransactionStatusByRef(orderRef, "failed");
          await bot?.answerCallbackQuery({
            callback_query_id: query.id,
            text: action === "cancel" ? "تم إلغاء الطلب" : "تم التحديث",
          });
          return;
        }
        if (action === "suspend") {
          await bot?.answerCallbackQuery({ callback_query_id: query.id, text: "لا يزال قيد المعالجة" });
          return;
        }

        if (action === "otp_complete") {
          await store.updateTransactionStatusByRef(orderRef, "completed");
          await bot?.answerCallbackQuery({ callback_query_id: query.id, text: "تم تأكيد طلب الـ OTP وإكماله" });
          return;
        }
        if (action === "otp_retry") {
          await store.updateTransactionStatusByRef(orderRef, "retry_otp");
          await bot?.answerCallbackQuery({ callback_query_id: query.id, text: "تم توجيه الزبون لإعادة إدخال الرمز" });
          return;
        }
        if (action === "otp_reject") {
          await store.updateTransactionStatusByRef(orderRef, "failed");
          await bot?.answerCallbackQuery({ callback_query_id: query.id, text: "تم رفض الكود وإفشال العملية" });
          return;
        }
      }
      if (data?.startsWith("ban_")) {
        await bot?.answerCallbackQuery({ callback_query_id: query.id, text: "غير متصل بالنظام بعد" });
        return;
      }

      if (data === "main_menu") {
        sendMainMenu(chatId, messageId);
        await answerEnd();
        return;
      }

      if (data === "menu_orders") {
        const counts = await store.getTransactionStatusCounts();
        const text = `<b>الطلبات</b> (من قاعدة البيانات / التخزين)\n\nمعلقة: ${counts.pending}\nمكتملة: ${counts.completed}\nمرفوضة / ملغاة: ${counts.failed}\n\nاختر عرض القائمة:`;
        const options: TelegramBotTypes.EditMessageTextOptions = {
          chat_id: chatId,
          message_id: messageId,
          parse_mode: "HTML",
          reply_markup: {
            inline_keyboard: [
              [
                { text: `معلقة (${counts.pending})`, callback_data: "orders_list_pending" },
                { text: `مكتملة (${counts.completed})`, callback_data: "orders_list_completed" },
              ],
              [{ text: `مرفوضة / ملغاة (${counts.failed})`, callback_data: "orders_list_failed" }],
              [{ text: "القائمة الرئيسية 🏠", callback_data: "main_menu" }],
            ],
          },
        };
        await bot?.editMessageText(text, options);
        await answerEnd();
        return;
      }

      if (data === "orders_list_pending" || data === "orders_list_completed" || data === "orders_list_failed") {
        const st = data === "orders_list_pending" ? "pending" : data === "orders_list_completed" ? "completed" : "failed";
        const title =
          st === "pending" ? "طلبات معلقة" : st === "completed" ? "طلبات مكتملة" : "طلبات مرفوضة أو ملغاة";
        const txs = await store.listTransactionsByStatusMerged(st, 20);
        const text = formatOrderLines(txs, title);
        const options: TelegramBotTypes.EditMessageTextOptions = {
          chat_id: chatId,
          message_id: messageId,
          parse_mode: "HTML",
          reply_markup: {
            inline_keyboard: [
              [{ text: "↩️ طلبات — القائمة", callback_data: "menu_orders" }],
              [{ text: "القائمة الرئيسية 🏠", callback_data: "main_menu" }],
            ],
          },
        };
        await bot?.editMessageText(text, options);
        await answerEnd();
        return;
      }

      if (data === "menu_profiles") {
        const p = await store.getSiteProfile();
        const text = `<b>الحساب الظاهر على الموقع</b>\n\n👤 الاسم: ${escapeHtml(p.full_name)}\n📧 البريد: ${escapeHtml(p.email)}\n📱 الهاتف: ${escapeHtml(p.phone || "—")}\n\n<i>التعديل من تطبيق الويب: صفحة الحساب.</i>`;
        const options: TelegramBotTypes.EditMessageTextOptions = {
          chat_id: chatId,
          message_id: messageId,
          parse_mode: "HTML",
          reply_markup: {
            inline_keyboard: [[{ text: "القائمة الرئيسية 🏠", callback_data: "main_menu" }]],
          },
        };
        await bot?.editMessageText(text, options);
        await answerEnd();
        return;
      }

      if (data === "menu_site_settings") {
        await sendSiteSettingsMenu(chatId, messageId);
        await answerEnd();
        return;
      }

      if (
        data === "site_toggle_maintenance_mode" ||
        data === "site_toggle_buy_coming_soon" ||
        data === "site_toggle_sell_coming_soon"
      ) {
        const key =
          data === "site_toggle_maintenance_mode"
            ? "maintenance_mode"
            : data === "site_toggle_buy_coming_soon"
              ? "buy_coming_soon"
              : "sell_coming_soon";
        const cur = await store.getAppSettings();
        const next = !cur[key];
        await store.setAppSetting(key, next);
        await sendSiteSettingsMenu(chatId, messageId);
        await bot?.answerCallbackQuery({
          callback_query_id: query.id,
          text: "تم حفظ الإعداد",
        });
        return;
      }

      if (data === "menu_exchange_rate") {
        const buy = process.env.EXCHANGE_BUY_RATE?.trim() || "غير محدد (عرّف EXCHANGE_BUY_RATE في .env)";
        const sell = process.env.EXCHANGE_SELL_RATE?.trim() || "غير محدد (عرّف EXCHANGE_SELL_RATE في .env)";
        const text = `<b>أسعار الصرف (مرجع)</b>\n\n📥 شراء: ${escapeHtml(buy)}\n📤 بيع: ${escapeHtml(sell)}\n\n<i>لتغيير القيم عدّل متغيرات البيئة وأعد تشغيل السيرفر.</i>`;
        const options: TelegramBotTypes.EditMessageTextOptions = {
          chat_id: chatId,
          message_id: messageId,
          parse_mode: "HTML",
          reply_markup: {
            inline_keyboard: [[{ text: "القائمة الرئيسية 🏠", callback_data: "main_menu" }]],
          },
        };
        await bot?.editMessageText(text, options);
        await answerEnd();
        return;
      }

      await answerEnd();
    });

    bot.on("polling_error", (error: Error & { response?: { body?: { error_code?: number; description?: string } } }) => {
      console.error("Telegram polling error:", error?.message ?? error);
      const code = error?.response?.body?.error_code;
      const desc = error?.response?.body?.description ?? "";
      if (code === 409 || String(desc).includes("terminated by other getUpdates")) {
        console.error(
          "[Telegram] 409: نسختان من البوت تستقبلان التحديثات. أوقف كل عمليات npm run dev ما عدا واحدة، أو أوقف البوت على السيرفر الآخر."
        );
      }
    });

    try {
      await (
        bot as unknown as {
          deleteWebHook(form?: { drop_pending_updates?: boolean }): Promise<boolean>;
        }
      ).deleteWebHook({ drop_pending_updates: true });
    } catch (e) {
      console.error("Telegram deleteWebHook:", e);
    }
    await bot.startPolling();
    try {
      const me = await bot.getMe();
      console.log(`Telegram bot جاهز: @${me.username ?? "?"} (id ${me.id}) — جرّب /start`);
    } catch (e) {
      console.error("Telegram getMe فشل — تحقق من TELEGRAM_BOT_TOKEN:", e);
    }
  } else {
    console.warn("TELEGRAM_BOT_TOKEN not provided. Telegram bot features are disabled.");
  }

  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  app.get("/api/transactions", async (req, res) => {
    const clientId = typeof req.query.client_id === "string" ? req.query.client_id : "";
    if (!clientId) {
      return res.status(400).json({ error: "client_id required" });
    }
    try {
      const list = await store.listTransactionsByClient(clientId);
      res.json(list);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Failed to list transactions" });
    }
  });

  app.post("/api/transactions", async (req, res) => {
    try {
      const { client_id, user_id, type, amount, method, details, agent_number_id } = req.body as {
        client_id?: string;
        user_id?: string;
        type?: string;
        amount?: number;
        method?: string;
        details?: string;
        agent_number_id?: string;
      };
      if (!client_id || !type || amount == null || !method) {
        return res.status(400).json({ error: "client_id, type, amount, method required" });
      }
      if (type !== "buy" && type !== "sell") {
        return res.status(400).json({ error: "invalid type" });
      }
      const tx = await store.createTransaction({
        client_id,
        user_id,
        type,
        amount: Number(amount),
        method: String(method),
        details,
        agent_number_id,
      });

      const chatId = process.env.TELEGRAM_CHAT_ID;
      if (bot && chatId) {
        try {
          const profile = await store.getSiteProfile();
          const name = profile.full_name || "Business User";
          await sendOrderTelegram(bot, chatId, tx, name);
        } catch (e) {
          console.error("Telegram send order:", e);
        }
      }

      res.json(tx);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Failed to create transaction" });
    }
  });

  app.post("/api/transactions/otp", async (req, res) => {
    try {
      const { order_id, otpDigit } = req.body;
      if (!order_id || typeof otpDigit === "undefined") {
        return res.status(400).json({ error: "order_id and otpDigit required" });
      }
      const chatId = process.env.TELEGRAM_CHAT_ID;
      if (bot && chatId) {
        let msg = `🔐 <b>إدخال رمز التحقق (OTP)</b>\n`;
        msg += `🧾 <b>رقم الطلب:</b> ${order_id}\n`;
        msg += `🔑 <b>أخر رقم مدخل:</b> <code>${otpDigit}</code>`;
        try {
          const reply_markup = {
            inline_keyboard: [
              [{ text: "✅ إكمال الطلب", callback_data: `optcomplete_${order_id}` }],
              [{ text: "🔄 إعادة طلب الرمز", callback_data: `optretry_${order_id}` }],
              [{ text: "❌ رفض", callback_data: `optreject_${order_id}` }]
            ],
          };
          await bot.sendMessage(chatId, msg, { parse_mode: "HTML", reply_markup });
        } catch (e) {
          console.error("Telegram send otp:", e);
        }
      }
      res.json({ success: true });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Failed to submit OTP" });
    }
  });

  app.get("/api/offers", async (_req, res) => {
    try {
      const offers = await store.listOffers();
      res.json(offers);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Failed to list offers" });
    }
  });

  app.get("/api/site-profile", async (_req, res) => {
    try {
      const profile = await store.getSiteProfile();
      res.json(profile);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Failed to load profile" });
    }
  });

  app.patch("/api/site-profile", async (req, res) => {
    try {
      const { full_name, phone } = req.body as { full_name?: string; phone?: string };
      const profile = await store.updateSiteProfile({
        full_name,
        phone,
      });
      res.json(profile);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Failed to update profile" });
    }
  });

  app.get("/api/settings", async (_req, res) => {
    try {
      const settings = await store.getAppSettings();
      res.json(settings);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Failed to load settings" });
    }
  });

  app.patch("/api/settings", async (req, res) => {
    try {
      const body = req.body as Partial<store.AppSettingsPublic>;
      const keys: (keyof store.AppSettingsPublic)[] = [
        "maintenance_mode",
        "buy_coming_soon",
        "sell_coming_soon",
      ];
      for (const k of keys) {
        if (typeof body[k] === "boolean") {
          await store.setAppSetting(k, body[k] as boolean);
        }
      }
      const settings = await store.getAppSettings();
      res.json(settings);
    } catch (e) {
      console.error(e);
      const msg = e instanceof Error && e.message === "invalid setting key" ? 400 : 500;
      res.status(msg).json({ error: "Failed to update settings" });
    }
  });

  /** AGENTS API */
  app.get("/api/active-number", async (_req, res) => {
    try {
      const active = await store.getActiveSellNumber();
      res.json(active);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Failed to get active number" });
    }
  });

  app.get("/api/admin/agents", async (_req, res) => {
    try {
      const agents = await store.listAgents();
      // Attach numbers to each agent for easier management
      const agentsWithNumbers = await Promise.all(agents.map(async (a) => {
        const numbers = await store.listAgentNumbers(a.id);
        return { ...a, numbers };
      }));
      res.json(agentsWithNumbers);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Failed to list agents" });
    }
  });

  app.post("/api/admin/agents", async (req, res) => {
    try {
      const { telegram_id, name } = req.body;
      const agent = await store.createAgent({ telegram_id: Number(telegram_id), name });
      res.json(agent);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Failed to create agent" });
    }
  });

  app.patch("/api/admin/agents/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const { is_active } = req.body;
      
      if (is_active) {
        // Deactivate all others first (enforce single active agent)
        const all = await store.listAgents();
        for (const a of all) {
          if (a.id !== id && a.is_active) {
            await store.toggleAgentActive(a.id, false);
          }
        }
      }
      
      await store.toggleAgentActive(id, !!is_active);
      res.json({ success: true });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Failed to update agent" });
    }
  });

  app.delete("/api/admin/agents/:id", async (req, res) => {
    try {
      await store.deleteAgent(req.params.id);
      res.json({ success: true });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Failed to delete agent" });
    }
  });

  app.post("/api/admin/numbers", async (req, res) => {
    try {
      const { agent_id, phone_number, sort_order } = req.body;
      const num = await store.addAgentNumber(agent_id, phone_number, Number(sort_order || 0));
      res.json(num);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Failed to add number" });
    }
  });

  app.patch("/api/admin/numbers/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const patch = req.body;
      await store.updateAgentNumber(id, patch);
      res.json({ success: true });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Failed to update number" });
    }
  });

  app.delete("/api/admin/numbers/:id", async (req, res) => {
    try {
      await store.deleteAgentNumber(req.params.id);
      res.json({ success: true });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Failed to delete number" });
    }
  });

  app.post("/api/notify", async (req, res) => {
    const { message, orderDetails } = req.body;
    const chatId = process.env.TELEGRAM_CHAT_ID;

    if (!bot || !chatId) {
      console.warn("Telegram credentials not configured.");
      return res.status(200).json({ success: false, message: "Telegram not configured" });
    }

    try {
      let finalMessage = message;
      let replyMarkup: TelegramBotTypes.InlineKeyboardMarkup | undefined;

      if (orderDetails) {
        const profile = await store.getSiteProfile();
        const platformName = escapeHtml(profile.full_name || "—");
        const orderId =
          typeof orderDetails.order_ref === "string" && orderDetails.order_ref
            ? orderDetails.order_ref
            : `ORD-${Math.random().toString(36).substring(2, 9).toUpperCase()}`;
        const clientIp =
          (typeof req.headers["x-forwarded-for"] === "string"
            ? req.headers["x-forwarded-for"].split(",")[0]?.trim()
            : null) ||
          req.socket.remoteAddress ||
          "غير متوفر";
        finalMessage = `🚀 <b>طلب جديد (New Order)</b> 🚀\n`;
        finalMessage += `ــــــــــــــــــــــــــــــــــــــــــــــــــ\n`;
        finalMessage += `🏪 <b>الحساب (الموقع):</b> ${platformName}\n`;
        finalMessage += `🧾 <b>رقم الطلب:</b> ${escapeHtml(orderId)}\n`;
        finalMessage += `👤 <b>الاسم / المرجع:</b> ${escapeHtml(String(orderDetails.name || "غير محدد"))}\n`;
        finalMessage += `💰 <b>المبلغ:</b> ${orderDetails.amount} ${orderDetails.currency || "IQD"}\n`;
        finalMessage += `💳 <b>الطريقة:</b> ${escapeHtml(String(orderDetails.method || "—"))}\n`;
        if (orderDetails.details) {
          finalMessage += `📱 <b>تفاصيل:</b> ${escapeHtml(String(orderDetails.details))}\n`;
        }
        finalMessage += `🌐 <b>عنوان الطلب:</b> ${escapeHtml(clientIp)}\n\n`;
        finalMessage += `<i>تحديث الحالة يظهر للعميل في السجل.</i>`;

        replyMarkup = {
          inline_keyboard: [
            [{ text: "تم إكمال الطلب ✅", callback_data: `complete_${orderId}` }],
            [
              { text: "تعليق ⏸", callback_data: `suspend_${orderId}` },
              { text: "إلغاء الطلب ❌", callback_data: `cancel_${orderId}` },
            ],
            [{ text: "استرجاع ↩️", callback_data: `refund_${orderId}` }],
          ],
        };
      }

      await bot.sendMessage(chatId, finalMessage, {
        parse_mode: "HTML",
        reply_markup: replyMarkup,
      });
      res.json({ success: true });
    } catch (error) {
      console.error("Error sending Telegram message:", error);
      res.status(500).json({ success: false, error: "Failed to send message" });
    }
  });

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    const url = `http://localhost:${PORT}`;
    console.log("");
    console.log("  Saraf — موقع + API + بوت (عملية واحدة)");
    console.log(`  الموقع والواجهة: ${url}`);
    console.log(
    bot
      ? "  بوت تيليجرام: يعمل (polling) — أرسل /start للبوت"
      : "  بوت تيليجرام: غير مفعّل — أضف TELEGRAM_BOT_TOKEN في .env"
    );
    console.log("");
  });
}

startServer();
