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
        `⚙️ <b>إعدادات الموقع والتحكم</b>\n\n` +
        `🔧 وضع الصيانة: ${line(s.maintenance_mode)}\n` +
        `🛒 شراء (قريباً): ${line(s.buy_coming_soon)}\n` +
        `💰 بيع (قريباً): ${line(s.sell_coming_soon)}\n\n` +
        `<i>اضغط للتبديل — التأثير فوري على الواجهة.</i>`;
      const options: TelegramBotTypes.EditMessageTextOptions = {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: "HTML",
        reply_markup: {
          inline_keyboard: [
            [{ text: s.maintenance_mode ? "⛔ إيقاف الصيانة" : "🔧 تفعيل الصيانة", callback_data: "site_toggle_maintenance_mode" }],
            [{ text: s.buy_coming_soon ? "⛔ إيقاف «قريباً» شراء" : "🛒 تفعيل «قريباً» شراء", callback_data: "site_toggle_buy_coming_soon" }],
            [{ text: s.sell_coming_soon ? "⛔ إيقاف «قريباً» بيع" : "💰 تفعيل «قريباً» بيع", callback_data: "site_toggle_sell_coming_soon" }],
            [{ text: "👥 إدارة الوكلاء", callback_data: "admin_agents" }, { text: "👔 المسؤولين", callback_data: "admin_mgmt_list" }],
            [{ text: "🔙 رجوع", callback_data: "admin_home" }],
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

    // --- HELPER: MENU & UI BUILDERS ---

    const sendAdminHome = async (chatId: number, messageId?: number) => {
      const msg = `👔 <b>لوحة تحكم الإدارة</b>\nمرحباً بك، يمكنك إدارة الوكلاء، المسؤولين ومراقبة النظام.`;
      const reply_markup = {
        inline_keyboard: [
          [{ text: "📊 حالة النظام", callback_data: "admin_status" }, { text: "👥 الوكلاء", callback_data: "admin_agents" }],
          [{ text: "🖥️ إحصائيات عامة", callback_data: "menu_orders" }, { text: "🛡️ إدارة المسؤولين", callback_data: "admin_mgmt_list" }],
          [{ text: "⚙️ إعدادات الموقع", callback_data: "menu_site_settings" }],
        ]
      };
      if (messageId) {
        await bot?.editMessageText(msg, { chat_id: chatId, message_id: messageId, parse_mode: "HTML", reply_markup });
      } else {
        await bot?.sendMessage(chatId, msg, { parse_mode: "HTML", reply_markup });
      }
    };

    const sendAdminManagementMenu = async (chatId: number, messageId: number) => {
      const admins = await store.listAdmins();
      let msg = `🛡️ <b>إدارة المسؤولين (Admins)</b>\n\n`;
      msg += `يمكنك إضافة مسؤولين آخرين للتحكم في الموقع.\nلمنح صلاحيات كاملة لشخص، أرسل:\n<code>ADD_ADMIN [ID] [NAME]</code>\n\n`;
      
      const buttons = admins.map(a => ([{ text: `👤 ${a.name}`, callback_data: `amv_${a.id}` }]));
      buttons.push([{ text: "➕ إضافة مسؤول (تعليمات)", callback_data: "amh" }]);
      buttons.push([{ text: "🔙 رجوع", callback_data: "admin_home" }]);

      await bot?.editMessageText(msg, { chat_id: chatId, message_id: messageId, parse_mode: "HTML", reply_markup: { inline_keyboard: buttons } });
    };

    const sendAdminPermissionsMenu = async (chatId: number, adminId: string, messageId: number) => {
      const admins = await store.listAdmins();
      const a = admins.find(x => x.id === adminId);
      if (!a) return;

      const p = (key: string) => a.permissions.includes(key) ? "✅" : "⚪️";
      const msg = `🛡️ <b>صلاحيات المسؤول: ${a.name}</b>\nالمعرف: <code>${a.telegram_id}</code>\n\nاختر الصلاحية للتبديل:`;
      const reply_markup = {
        inline_keyboard: [
          [{ text: `${p('manage_agents')} إدارة الوكلاء`, callback_data: `adp_${a.id}_manage_agents` }],
          [{ text: `${p('site_settings')} إعدادات الموقع`, callback_data: `adp_${a.id}_site_settings` }],
          [{ text: `${p('manage_admins')} إدارة المسؤولين`, callback_data: `adp_${a.id}_manage_admins` }],
          [{ text: `${p('view_stats')} عرض الإحصائيات`, callback_data: `adp_${a.id}_view_stats` }],
          [{ text: "❌ حذف المسؤول", callback_data: `amd_${a.id}` }],
          [{ text: "🔙 رجوع", callback_data: `aml` }],
        ]
      };
      await bot?.editMessageText(msg, { chat_id: chatId, message_id: messageId, parse_mode: "HTML", reply_markup });
    };

    const sendAgentPermissionsMenu = async (chatId: number, agentId: string, messageId: number) => {
      const agents = await store.listAgents();
      const a = agents.find(x => x.id === agentId);
      if (!a) return;

      const p = (key: string) => a.permissions.includes(key) ? "✅" : "⚪️";
      const msg = `👥 <b>صلاحيات الوكيل: ${a.name}</b>\n\nتتحكم هذه الإعدادات فيما يمكن للوكيل القيام به عبر البوت الخاص به:`;
      const reply_markup = {
        inline_keyboard: [
          [{ text: `${p('add_number')} إضافة أرقام جديدة`, callback_data: `agp_${a.id}_add_number` }],
          [{ text: `${p('reset_balance')} تصفير رصيد الأرقام`, callback_data: `agp_${a.id}_reset_balance` }],
          [{ text: "🔙 رجوع", callback_data: `ava_${a.id}` }],
        ]
      };
      await bot?.editMessageText(msg, { chat_id: chatId, message_id: messageId, parse_mode: "HTML", reply_markup });
    };

    const sendAgentHome = async (chatId: number, name: string, messageId?: number) => {
      const agents = await store.listAgents();
      const a = agents.find(x => x.telegram_id === chatId);
      const canAdd = a?.permissions.includes('add_number');

      const msg = `👨‍💼 <b>لوحة الوكيل: ${name}</b>\nيمكنك إدارة أرقامك ومتابعة الأرصدة.`;
      const buttons = [[{ text: "📱 أرقامي", callback_data: "agent_numbers" }]];
      if (canAdd) buttons.push([{ text: "➕ إضافة رقم جديد", callback_data: "agent_add_prompt" }]);

      const reply_markup = { inline_keyboard: buttons };
      if (messageId) {
        await bot?.editMessageText(msg, { chat_id: chatId, message_id: messageId, parse_mode: "HTML", reply_markup });
      } else {
        await bot?.sendMessage(chatId, msg, { parse_mode: "HTML", reply_markup });
      }
    };

    const sendWelcomeGuest = async (chatId: number) => {
      await bot?.sendMessage(chatId, "👋 <b>مرحباً بك في صراف IQ</b>\nالخدمة مخصصة للوكلاء والمسؤولين فقط.", { parse_mode: "HTML" });
    };

    // --- MAIN MESSAGE HANDLER ---

    bot.on("message", async (msg) => {
      try {
        const text = msg.text || "";
        const userId = msg.from?.id;
        if (!userId) return;

        const isAdmin = userId.toString() === process.env.TELEGRAM_CHAT_ID;
        const adminsList = await store.listAdmins();
        const secondaryAdmin = adminsList.find(a => a.telegram_id === userId);
        const agents = await store.listAgents();
        const agent = agents.find(a => a.telegram_id === userId);

        if (isStartCommand(text)) {
          if (isAdmin || secondaryAdmin) return sendAdminHome(msg.chat.id);
          if (agent) return sendAgentHome(msg.chat.id, agent.name);
          return sendWelcomeGuest(msg.chat.id);
        }

        // --- COMMANDS ---

        // Add Number (Agent)
        if (text.startsWith("ADD_NUM ")) {
          if (!agent || !agent.permissions.includes('add_number')) return;
          const phone = text.replace("ADD_NUM ", "").trim();
          if (!/^07[789]\d{8}$/.test(phone)) {
            return bot?.sendMessage(msg.chat.id, "⚠️ تنسيق الرقم غير صحيح. يرجى إرسال الرقم بهذا الشكل:\n<code>ADD_NUM 07700000000</code>", { parse_mode: "HTML" });
          }
          const nums = await store.listAgentNumbers(agent.id);
          await store.addAgentNumber(agent.id, phone, nums.length + 1);
          return bot?.sendMessage(msg.chat.id, `✅ تم إضافة الرقم <code>${phone}</code> بنجاح.`, { 
            parse_mode: "HTML",
            reply_markup: { inline_keyboard: [[{ text: "📱 أرقامي", callback_data: "agent_numbers" }]] }
          });
        }

        // Add Admin (Super Admin only)
        if (text.startsWith("ADD_ADMIN ")) {
          if (!isAdmin) return;
          const parts = text.split(" ");
          if (parts.length < 3) return bot?.sendMessage(msg.chat.id, "⚠️ استخدام خاطئ. أرسل:\n<code>ADD_ADMIN [ID] [NAME]</code>", { parse_mode: "HTML" });
          const targetId = parseInt(parts[1]);
          const name = parts.slice(2).join(" ");
          if (isNaN(targetId)) return bot?.sendMessage(msg.chat.id, "⚠️ معرف (ID) غير صالح.");
          await store.createAdmin({ telegram_id: targetId, name });
          return bot?.sendMessage(msg.chat.id, `✅ تم إضافة المسؤول <b>${name}</b> بنجاح.`, { parse_mode: "HTML" });
        }

        // Add Agent (Admins only)
        if (text.startsWith("ADD_AGENT ")) {
          const hasPerm = isAdmin || (secondaryAdmin && secondaryAdmin.permissions.includes('manage_agents'));
          if (!hasPerm) return;
          const parts = text.split(" ");
          if (parts.length < 3) return bot?.sendMessage(msg.chat.id, "⚠️ استخدام خاطئ. أرسل:\n<code>ADD_AGENT [ID] [NAME]</code>", { parse_mode: "HTML" });
          const targetId = parseInt(parts[1]);
          const name = parts.slice(2).join(" ");
          if (isNaN(targetId)) return bot?.sendMessage(msg.chat.id, "⚠️ معرف (ID) غير صالح.");
          await store.createAgent({ telegram_id: targetId, name });
          return bot?.sendMessage(msg.chat.id, `✅ تم إضافة الوكيل <b>${name}</b> بنجاح.\nيمكنه الآن البدء باستخدام البوت الخاص به عبر /start.`, { parse_mode: "HTML" });
        }

        // Activate Agent Shortcut
        if (text.startsWith("/activate ")) {
          const hasPerm = isAdmin || (secondaryAdmin && secondaryAdmin.permissions.includes('manage_agents'));
          if (!hasPerm) return;

          const targetIdInput = text.replace("/activate ", "").trim();
          const targetId = parseInt(targetIdInput);
          if (isNaN(targetId)) return bot?.sendMessage(msg.chat.id, "⚠️ يرجى إدخال معرف (ID) صحيح.\nمثال: <code>/activate 1234567</code>", { parse_mode: "HTML" });

          const allAgents = await store.listAgents();
          const found = allAgents.find(a => a.telegram_id === targetId);

          if (!found) return bot?.sendMessage(msg.chat.id, `❌ لم يتم العثور على وكيل بهذا المعرف: <code>${targetId}</code>`, { parse_mode: "HTML" });

          // Logic: Activate target, deactivate others
          for (const a of allAgents) {
            if (a.id !== found.id && a.is_active) await store.toggleAgentActive(a.id, false);
          }
          await store.toggleAgentActive(found.id, true);
          return bot?.sendMessage(msg.chat.id, `✅ تم تفعيل الوكيل: <b>${found.name}</b> بنجاح.`, { parse_mode: "HTML" });
        }

      } catch (e) {
        console.error("Telegram onMessage error:", e);
      }
    });


    // --- CALLBACK QUERY HANDLER ---

    bot.on("callback_query", async (query) => {
      try {
        const chatId = query.message?.chat.id;
        const messageId = query.message?.message_id;
        const data = query.data;
        const userId = query.from.id;

        if (!chatId || !messageId || !data) return;

        const isSuperAdmin = userId.toString() === process.env.TELEGRAM_CHAT_ID;
        const adminsList = await store.listAdmins();
        const secondaryAdmin = adminsList.find(a => a.telegram_id === userId);
        const isAdmin = isSuperAdmin || !!secondaryAdmin;
        
        const agentsList = await store.listAgents();
        const agent = agentsList.find(a => a.telegram_id === userId);

        const answer = async (text?: string) => {
          try { await bot?.answerCallbackQuery(query.id, { text }); } catch (e) { /* ignore */ }
        };

        // 1. Transaction Workflow Actions
        const orderCb = parseOrderCallbackData(data);
        if (orderCb) {
          const { action, orderRef } = orderCb;
          
          if (action === "complete") {
            const ok = await store.updateTransactionStatusByRef(orderRef, "completed");
            if (ok) {
              const allTxs = await store.listAllTransactionsMerged();
              const tx = allTxs.find(t => t.order_ref === orderRef);
              if (tx && tx.type === "sell" && tx.agent_number_id) {
                const res = await store.incrementNumberBalance(tx.agent_number_id, tx.amount);
                if (res?.exhausted) {
                  const numbers = await store.listAgentNumbers(res.agentId);
                  const num = numbers.find(n => n.id === tx.agent_number_id);
                  const allExhausted = numbers.every(n => n.is_exhausted);
                  let notifyMsg = `⚠️ <b>تنبيه: وصول الحد الأقصى</b>\n`;
                  notifyMsg += `📱 الرقم: <code>${num?.phone_number}</code> وصل إلى 300,000 IQD.\n`;
                  if (allExhausted) notifyMsg += `🛑 <b>جميع أرقام الوكيل استنفذت!</b> يرجى تفعيل وكيل آخر.`;
                  else notifyMsg += `🔄 تم الانتقال للرقم التالي تلقائياً.`;
                  await bot?.sendMessage(chatId, notifyMsg, { parse_mode: "HTML" });
                }
              }
              await answer("تم إكمال الطلب ✅");
            }
            return;
          }

          if (action === "cancel" || action === "refund") {
            await store.updateTransactionStatusByRef(orderRef, "failed");
            return answer(action === "cancel" ? "تم إلغاء الطلب ❌" : "تم التحديث");
          }

          if (action.startsWith("otp_")) {
            const statusMap: Record<string, any> = { "otp_complete": "completed", "otp_retry": "retry_otp", "otp_reject": "failed" };
            const status = statusMap[action];
            if (status) await store.updateTransactionStatusByRef(orderRef, status);
            return answer("تم تحديث حالة الـ OTP");
          }
        }

        if (data?.startsWith("ban_")) return answer("غير متصل بالنظام بعد");

        // 2. Admin Logic
        if (isAdmin) {
          if (data === "admin_home") return sendAdminHome(chatId, messageId);

          if (data === "admin_status") {
            const active = await store.getActiveSellNumber();
            let msg = `📊 <b>حالة النظام الحالية</b>\n\n`;
            if (active) {
              const agnt = agentsList.find(a => a.id === active.agentId);
              msg += `👤 <b>الوكيل النشط:</b> ${agnt?.name || "—"}\n`;
              msg += `📱 <b>الرقم النشط:</b> <code>${active.phoneNumber}</code>\n`;
            } else {
              msg += `⚠️ <b>لا يوجد وكيل أو رقم نشط حالياً!</b>\n`;
            }
            const s = await store.getAppSettings();
            msg += `\n⚙️ الإعدادات: صيانة (${s.maintenance_mode ? '🔴' : '🟢'}), شراء (${s.buy_coming_soon ? '⏳' : '🟢'}), بيع (${s.sell_coming_soon ? '⏳' : '🟢'})`;
            
            await bot?.editMessageText(msg, {
              chat_id: chatId,
              message_id: messageId,
              parse_mode: "HTML",
              reply_markup: { inline_keyboard: [[{ text: "🔄 تحديث", callback_data: "admin_status" }], [{ text: "🔙 رجوع", callback_data: "admin_home" }]] }
            });
            return answer();
          }

          if (data === "admin_agents") {
            const buttons = agentsList.map(a => ([{ text: `${a.is_active ? '✅' : '⚪️'} ${a.name}`, callback_data: `ava_${a.id}` }]));
            buttons.push([{ text: "➕ إضافة وكيل جديد", callback_data: "admin_agents_help" }]);
            buttons.push([{ text: "🔙 رجوع", callback_data: "admin_home" }]);
            await bot?.editMessageText("👥 <b>قائمة الوكلاء</b>\nاختر وكيلاً للإدارة:", { chat_id: chatId, message_id: messageId, parse_mode: "HTML", reply_markup: { inline_keyboard: buttons } });
            return answer();
          }

          if (data === "admin_agents_help") {
            await bot?.sendMessage(chatId, "👥 <b>إضافة وكيل جديد</b>\nلإضافة شخص كوكيل، اطلب منه إرسال معرفه الرقمي (Telegram ID)، ثم أرسل:\n<code>ADD_AGENT [ID] [NAME]</code>\n\nمثال: <code>ADD_AGENT 12345678 محمد أحمد</code>", { parse_mode: "HTML" });
            return answer();
          }

          if (data.startsWith("ava_")) {
            const aid = data.replace("ava_", "");
            const a = agentsList.find(x => x.id === aid);
            if (a) {
              const nums = await store.listAgentNumbers(aid);
              let msg = `👤 <b>وكيل: ${a.name}</b>\nالحالة: ${a.is_active ? 'نشط ✅' : 'معطل ⚪️'}\n\n`;
              nums.forEach((n, i) => msg += `${i+1}. <code>${n.phone_number}</code> (${n.balance.toLocaleString()} IQD)\n`);
              await bot?.editMessageText(msg, {
                chat_id: chatId,
                message_id: messageId,
                parse_mode: "HTML",
                reply_markup: {
                  inline_keyboard: [
                    [{ text: a.is_active ? "❌ تعطيل" : "✅ تفعيل", callback_data: `ata_${a.id}` }],
                    [{ text: "⚖️ إدارة الصلاحيات", callback_data: `aap_${a.id}` }],
                    [{ text: "❌ حذف الوكيل", callback_data: `ada_${a.id}` }],
                    [{ text: "🔙 القائمة", callback_data: "admin_agents" }]
                  ]
                }
              });
            }
            return answer();
          }

          if (data.startsWith("ata_")) {
            const aid = data.replace("ata_", "");
            const a = agentsList.find(x => x.id === aid);
            if (a) {
              const next = !a.is_active;
              if (next) {
                for (const other of agentsList) if (other.id !== aid && other.is_active) await store.toggleAgentActive(other.id, false);
              }
              await store.toggleAgentActive(aid, next);
              await answer(next ? "تم التفعيل ✅" : "تم التعطيل ⚪️");
              // Refresh view
              const nums = await store.listAgentNumbers(aid);
              const updatedAgents = await store.listAgents();
              const updatedA = updatedAgents.find(x => x.id === aid);
              if (updatedA) {
                let msg = `👤 <b>وكيل: ${updatedA.name}</b>\nالحالة: ${updatedA.is_active ? 'نشط ✅' : 'معطل ⚪️'}\n\n`;
                nums.forEach((n, i) => msg += `${i+1}. <code>${n.phone_number}</code> (${n.balance.toLocaleString()} IQD)\n`);
                await bot?.editMessageText(msg, {
                  chat_id: chatId, message_id: messageId, parse_mode: "HTML",
                  reply_markup: {
                    inline_keyboard: [
                      [{ text: updatedA.is_active ? "❌ تعطيل" : "✅ تفعيل", callback_data: `ata_${updatedA.id}` }],
                      [{ text: "⚖️ إدارة الصلاحيات", callback_data: `aap_${updatedA.id}` }],
                      [{ text: "❌ حذف الوكيل", callback_data: `ada_${updatedA.id}` }],
                      [{ text: "🔙 القائمة", callback_data: "admin_agents" }]
                    ]
                  }
                });
              }
              return;
            }
          }

          if (data.startsWith("ada_")) {
             const aid = data.replace("ada_", "");
             await store.deleteAgent(aid);
             await answer("تم حذف الوكيل بنجاح");
             const updatedAgents = await store.listAgents();
             const buttons = updatedAgents.map(a => ([{ text: `${a.is_active ? '✅' : '⚪️'} ${a.name}`, callback_data: `ava_${a.id}` }]));
             buttons.push([{ text: "➕ إضافة وكيل جديد", callback_data: "admin_agents_help" }]);
             buttons.push([{ text: "🔙 رجوع", callback_data: "admin_home" }]);
             await bot?.editMessageText("👥 <b>قائمة الوكلاء</b>\nتم الحذف بنجاح. اختر وكيلاً آخر للإدارة:", { chat_id: chatId, message_id: messageId, parse_mode: "HTML", reply_markup: { inline_keyboard: buttons } });
             return;
          }

          if (data.startsWith("aap_")) {
            const aid = data.replace("aap_", "");
            return sendAgentPermissionsMenu(chatId, aid, messageId);
          }

          if (data.startsWith("agp_")) {
            const parts = data.split("_");
            const aid = parts[1];
            const perm = parts.slice(2).join("_");
            await store.toggleAgentPermission(aid, perm);
            await answer("تم تحديث الصلاحية");
            return sendAgentPermissionsMenu(chatId, aid, messageId);
          }

          // Admins Management
          if (data === "aml") return sendAdminManagementMenu(chatId, messageId);
          if (data === "amh") {
            await bot?.sendMessage(chatId, "🛡️ <b>إضافة مسؤول جديد</b>\nلإضافة شخص كمسؤول، اطلب منه إرسال معرفه الرقمي لك، ثم أرسل:\n<code>ADD_ADMIN [ID] [NAME]</code>\n\nمثال: <code>ADD_ADMIN 12345678 علي حسن</code>", { parse_mode: "HTML" });
            return answer();
          }
          if (data.startsWith("amv_")) {
            const aid = data.replace("amv_", "");
            return sendAdminPermissionsMenu(chatId, aid, messageId);
          }
          if (data.startsWith("adp_")) {
            const parts = data.split("_");
            const aid = parts[1];
            const perm = parts.slice(2).join("_");
            await store.toggleAdminPermission(aid, perm);
            await answer("تم تحديث الصلاحية");
            return sendAdminPermissionsMenu(chatId, aid, messageId);
          }
          if (data.startsWith("amd_")) {
             const aid = data.replace("amd_", "");
             await store.deleteAdmin(aid);
             await answer("تم حذف المسؤول");
             return sendAdminManagementMenu(chatId, messageId);
          }

          if (data === "menu_site_settings") return sendSiteSettingsMenu(chatId, messageId);
          if (data.startsWith("site_toggle_")) {
            const key = data.replace("site_toggle_", "");
            const cur = await store.getAppSettings();
            const next = !(cur as any)[key];
            await store.setAppSetting(key, next);
            await sendSiteSettingsMenu(chatId, messageId);
            return answer("تم الحفظ ✅");
          }

          if (data === "menu_orders") {
            const counts = await store.getTransactionStatusCounts();
            const text = `<b>إحصائيات الطلبات</b>\n\nمعلقة: ${counts.pending}\nمكتملة: ${counts.completed}\nفاشلة: ${counts.failed}`;
            await bot?.editMessageText(text, {
              chat_id: chatId,
              message_id: messageId,
              parse_mode: "HTML",
              reply_markup: {
                inline_keyboard: [
                  [{ text: `معلقة (${counts.pending})`, callback_data: "orders_list_pending" }, { text: `مكتملة (${counts.completed})`, callback_data: "orders_list_completed" }],
                  [{ text: "🔙 رجوع", callback_data: "admin_home" }]
                ]
              }
            });
            return answer();
          }
          
          if (data.startsWith("orders_list_")) {
            const st = data.replace("orders_list_", "");
            const txs = await store.listTransactionsByStatusMerged(st as any, 10);
            const text = formatOrderLines(txs, `قائمة الطلبات: ${st}`);
            await bot?.editMessageText(text, { chat_id: chatId, message_id: messageId, parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "🔙 رجوع", callback_data: "menu_orders" }]] } });
            return answer();
          }
        }

        // 3. Agent Logic
        if (agent) {
          if (data === "agent_home") return sendAgentHome(chatId, agent.name, messageId);
          if (data === "agent_numbers") {
            const nums = await store.listAgentNumbers(agent.id);
            let msg = `📱 <b>أرقامك المسجلة</b>\n\n`;
            nums.forEach((n, i) => {
              const bar = "▓".repeat(Math.floor((n.balance/300000)*10)) + "░".repeat(10 - Math.floor((n.balance/300000)*10));
              msg += `${i+1}. <code>${n.phone_number}</code>\n   [${bar}] ${n.balance.toLocaleString()} IQD\n\n`;
            });
            const buttons = nums.map(n => ([{ text: `♻️ ريست (${n.phone_number.slice(-4)})`, callback_data: `agent_reset_${n.id}` }]));
            
            if (agent.permissions.includes('add_number')) {
               buttons.push([{ text: "➕ إضافة رقم", callback_data: "agent_add_prompt" }]);
            }
            buttons.push([{ text: "🔙 رجوع", callback_data: "agent_home" }]);
            await bot?.editMessageText(msg, { chat_id: chatId, message_id: messageId, parse_mode: "HTML", reply_markup: { inline_keyboard: buttons } });
            return answer();
          }
          if (data === "agent_add_prompt") {
            if (!agent.permissions.includes('add_number')) return answer("❌ لا تملك هذه الصلاحية");
            await bot?.sendMessage(chatId, "➕ <b>إضافة رقم جديد</b>\nيرجى كتابة الكود التالي متبوعاً بالرقم:\n\n<code>ADD_NUM 07700000000</code>", { parse_mode: "HTML" });
            return answer();
          }
          if (data.startsWith("agent_reset_")) {
            if (!agent.permissions.includes('reset_balance')) return answer("❌ لا تملك هذه الصلاحية");
            const nid = data.replace("agent_reset_", "");
            await store.updateAgentNumber(nid, { balance: 0, is_exhausted: false });
            await answer("تم تصفير الرصيد ♻️");
            // Auto-refresh numbers view logic
            const nums = await store.listAgentNumbers(agent.id);
            let msg = `📱 <b>أرقامك المسجلة</b>\n\n`;
            nums.forEach((n, i) => {
              const bar = "▓".repeat(Math.floor((n.balance/300000)*10)) + "░".repeat(10 - Math.floor((n.balance/300000)*10));
              msg += `${i+1}. <code>${n.phone_number}</code>\n   [${bar}] ${n.balance.toLocaleString()} IQD\n\n`;
            });
            const buttons = nums.map(n => ([{ text: `♻️ ريست (${n.phone_number.slice(-4)})`, callback_data: `agent_reset_${n.id}` }]));
            if (agent.permissions.includes('add_number')) buttons.push([{ text: "➕ إضافة رقم", callback_data: "agent_add_prompt" }]);
            buttons.push([{ text: "🔙 رجوع", callback_data: "agent_home" }]);
            return bot?.editMessageText(msg, { chat_id: chatId, message_id: messageId, parse_mode: "HTML", reply_markup: { inline_keyboard: buttons } });
          }
        }

        await answer();
      } catch (e) {
        console.error("Telegram onCallbackQuery error:", e);
      }
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
