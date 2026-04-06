import "dotenv/config";
import {existsSync} from "node:fs";
import express, {type RequestHandler} from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import TelegramBot from "./server/telegram";
import type * as TelegramBotTypes from "node-telegram-bot-api";
import {
  buildAgentProofKeyboard,
  buildNewOrderMessagePayload,
  dataUrlImageToBuffer,
  escapeHtml,
  formatOrderLines,
  isStartCommand,
  parseAgentProofCallback,
  parseOrderCallbackData,
  stripSensitiveUrlsFromDetails,
  type CardFieldsPayload,
} from "./server/botMessages";
import * as store from "./server/store";
import type { Admin, ServerTransaction } from "./server/store";

type TelegramBotInstance = InstanceType<typeof TelegramBot>;

type PendingLinkKey = "link_support" | "hero_buy_amount_display" | "hero_sell_amount_display";
const pendingLinkEdits = new Map<number, PendingLinkKey>();

function adminCanEditLinks(isSuperAdmin: boolean, secondary: Admin | undefined): boolean {
  if (isSuperAdmin) return true;
  return secondary?.permissions.includes("edit_links") ?? false;
}

async function sendOrderTelegram(
  bot: TelegramBotInstance,
  chatId: string,
  tx: ServerTransaction,
  profileName: string,
  cardFields?: CardFieldsPayload | null
) {
  const { text, reply_markup } = buildNewOrderMessagePayload(tx, profileName, cardFields);
  await bot.sendMessage(chatId, text, {
    parse_mode: "HTML",
    reply_markup: reply_markup as TelegramBotTypes.InlineKeyboardMarkup,
  });
}

function omitPaymentProof(tx: ServerTransaction): ServerTransaction {
  if (tx.payment_proof == null) return tx;
  const { payment_proof: _p, ...rest } = tx;
  return rest as ServerTransaction;
}

const MAX_PAYMENT_PROOF_BYTES = 4 * 1024 * 1024;

async function notifyAllAdmins(bot: TelegramBotInstance, html: string) {
  const ids = new Set<number>();
  const primary = process.env.TELEGRAM_CHAT_ID;
  if (primary) ids.add(Number(primary));
  for (const a of await store.listAdmins()) ids.add(a.telegram_id);
  for (const id of ids) {
    if (!Number.isFinite(id)) continue;
    try {
      await bot.sendMessage(String(id), html, { parse_mode: "HTML" });
    } catch (e) {
      console.error("notifyAllAdmins:", id, e);
    }
  }
}

/** بيع + صورة دليل: للمسؤول (نص+أزرار) وللوكيل صاحب الرقم (نفس الصورة + تأكيد/رفض) */
async function sendSellOrderWithProof(
  bot: TelegramBotInstance,
  tx: ServerTransaction,
  profileName: string,
  adminChatId: string,
  agentTelegramId: number | null
) {
  const { text, reply_markup } = buildNewOrderMessagePayload(tx, profileName, null);
  const caption = text.length > 1024 ? `${text.slice(0, 1000)}…` : text;
  const buf = dataUrlImageToBuffer(tx.payment_proof!);
  if (!buf?.length) {
    await sendOrderTelegram(bot, adminChatId, tx, profileName, null);
    return;
  }
  await bot.sendPhoto(adminChatId, buf, {
    caption,
    parse_mode: "HTML",
    reply_markup: reply_markup as TelegramBotTypes.InlineKeyboardMarkup,
  });
  if (agentTelegramId != null) {
    const extra = `\n\n<i>🧑‍💼 مراجعة دليل الدفع — تأكيد إذا استلمت المبلغ، أو رفض إن لم يتوافق.</i>`;
    let capAgent = caption + extra;
    if (capAgent.length > 1024) capAgent = `${capAgent.slice(0, 1000)}…`;
    await bot.sendPhoto(agentTelegramId, buf, {
      caption: capAgent,
      parse_mode: "HTML",
      reply_markup: buildAgentProofKeyboard(tx.order_ref),
    });
  }
}

async function startServer() {
  const app = express();
  const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

  app.use(express.json({ limit: "12mb" }));
  app.set("trust proxy", true);

  /** CORS: تطبيق Capacitor يستدعي Railway من أصل مختلف (مثل https://localhost) */
  app.use((req, res, next) => {
    if (req.path.startsWith("/api")) {
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
      if (req.method === "OPTIONS") {
        res.status(204).end();
        return;
      }
    }
    next();
  });

  /** إن وُجد: يعيد توجيه GET /download/apk و/saraf-iq-debug.apk إلى رابط خارجي */
  const APK_DOWNLOAD_URL = process.env.APK_DOWNLOAD_URL?.trim();

  const APK_FILE_ON_DISK = "saraf-iq-debug.apk";
  const APK_DOWNLOAD_PATH = "/download/apk";

  function resolveCanonicalOrigin(req: express.Request): string {
    const host = req.get("host") || "localhost";
    const proto =
      (req.get("x-forwarded-proto") as string)?.split(",")[0]?.trim() ||
      req.protocol ||
      "https";
    const origin = `${proto}://${host}`;
    const railwayDomain = process.env.RAILWAY_PUBLIC_DOMAIN?.trim();
    const publicBase = process.env.PUBLIC_BASE_URL?.replace(/\/$/, "").trim();
    return (
      publicBase ||
      (railwayDomain ? `https://${railwayDomain}` : null) ||
      origin
    );
  }

  const sendApkOrRedirect: RequestHandler = (_req, res) => {
    if (APK_DOWNLOAD_URL) {
      res.redirect(302, APK_DOWNLOAD_URL);
      return;
    }
    const root = process.cwd();
    const apkPath =
      process.env.NODE_ENV === "production"
        ? path.join(root, "dist", APK_FILE_ON_DISK)
        : path.join(root, "public", APK_FILE_ON_DISK);
    if (!existsSync(apkPath)) {
      res
        .status(404)
        .type("text/plain; charset=utf-8")
        .send(
          [
            "لا يوجد ملف APK.",
            "أضف في Railway المتغير APK_DOWNLOAD_URL=رابط_مباشر.apk أو ضع الملف في public/saraf-iq-debug.apk ثم انشر.",
            "",
            "No APK. Set APK_DOWNLOAD_URL on Railway, or add public/saraf-iq-debug.apk and redeploy.",
          ].join("\n"),
        );
      return;
    }
    res.setHeader("Content-Type", "application/vnd.android.package-archive");
    res.setHeader("Content-Disposition", `attachment; filename="${APK_FILE_ON_DISK}"`);
    res.sendFile(apkPath);
  };

  app.get(APK_DOWNLOAD_PATH, sendApkOrRedirect);
  app.get(`/${APK_FILE_ON_DISK}`, sendApkOrRedirect);

  /**
   * إعدادات عامة للواجهة (مفتاح anon عام أصلاً) — تُقرأ من متغيرات Railway دون إعادة بناء.
   * للـ APK: عيّن VITE_APP_API_ORIGIN=https://your-app.up.railway.app عند البناء.
   */
  app.options("/api/public-config", (_req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.status(204).end();
  });

  app.get("/api/public-config", (_req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    const supabaseUrl = (
      process.env.VITE_SUPABASE_URL ||
      process.env.SUPABASE_URL ||
      ""
    ).trim();
    const supabaseAnonKey = (
      process.env.VITE_SUPABASE_ANON_KEY ||
      process.env.PUBLIC_SUPABASE_ANON_KEY ||
      ""
    ).trim();
    const apkUrl = process.env.VITE_APK_URL?.trim() || undefined;
    const railwayPublicDomain = process.env.RAILWAY_PUBLIC_DOMAIN?.trim() || undefined;

    if (!supabaseUrl.startsWith("http") || !supabaseAnonKey) {
      res.status(503).json({
        error: "missing_env",
        message:
          "Set VITE_SUPABASE_URL or SUPABASE_URL, and VITE_SUPABASE_ANON_KEY (or PUBLIC_SUPABASE_ANON_KEY) in Railway.",
      });
      return;
    }

    res.json({
      supabaseUrl,
      supabaseAnonKey,
      ...(apkUrl ? {apkUrl} : {}),
      ...(railwayPublicDomain ? {railwayPublicDomain} : {}),
    });
  });

  /** روابط الدعم وأرقام بطاقة الصفحة الرئيسية — للواجهة بدون أسرار */
  app.options("/api/site-content", (_req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.status(204).end();
  });

  app.get("/api/site-content", async (_req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    try {
      const content = await store.getSiteContent();
      res.json(content);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Failed to load site content" });
    }
  });

  app.get("/api/apk-link", (req, res) => {
    const canonicalBase = resolveCanonicalOrigin(req);
    const railwayDomain = process.env.RAILWAY_PUBLIC_DOMAIN?.trim();
    const downloadUrl = `${canonicalBase}${APK_DOWNLOAD_PATH}`;

    if (APK_DOWNLOAD_URL) {
      res.json({
        url: downloadUrl,
        path: APK_DOWNLOAD_PATH,
        mode: "redirect",
        redirectsTo: APK_DOWNLOAD_URL,
        hint:
          "الضغط على url يمرّ عبر السيرفر ثم يحمّل الملف من الرابط الخارجي. / Clicking url redirects then downloads from external URL.",
      });
      return;
    }

    res.json({
      url: downloadUrl,
      path: APK_DOWNLOAD_PATH,
      railwayPublicDomain: railwayDomain || null,
      linkedToRailway: Boolean(railwayDomain),
      hint:
        "GET /download/apk يرسل الملف مباشرة إن وُجد في dist. / Serves file from dist when present.",
    });
  });

  const botToken = process.env.TELEGRAM_BOT_TOKEN?.trim();
  let bot: TelegramBotInstance | null = null;

  if (botToken) {
    /** polling: false ثم deleteWebHook — إن وُجد webhook يمنع getUpdates من العمل */
    bot = new TelegramBot(botToken, { polling: false });

    const sendAdminHome = async (chatId: number, messageId?: number, forUserId?: number) => {
      const msg = `👔 <b>لوحة تحكم الإدارة</b>\nمرحباً بك، يمكنك إدارة الوكلاء، المسؤولين ومراقبة النظام.`;
      let showLinks = false;
      if (forUserId != null) {
        const isSuper = forUserId.toString() === process.env.TELEGRAM_CHAT_ID;
        const admins = await store.listAdmins();
        const sec = admins.find((a) => a.telegram_id === forUserId);
        showLinks = adminCanEditLinks(isSuper, sec);
      }
      const inline_keyboard: TelegramBotTypes.InlineKeyboardButton[][] = [
        [{ text: "📊 حالة النظام", callback_data: "admin_status" }, { text: "👥 الوكلاء", callback_data: "admin_agents" }],
        [{ text: "🖥️ إحصائيات عامة", callback_data: "menu_orders" }, { text: "🛡️ إدارة المسؤولين", callback_data: "admin_mgmt_list" }],
        [{ text: "📦 إدارة العروض", callback_data: "omv_" }],
        [{ text: "⚙️ إعدادات الموقع", callback_data: "menu_site_settings" }],
      ];
      if (showLinks) {
        inline_keyboard.push([{ text: "🔗 تعديل الروابط", callback_data: "menu_edit_links" }]);
      }
      const reply_markup = { inline_keyboard };
      if (messageId) {
        await bot?.editMessageText(msg, { chat_id: chatId, message_id: messageId, parse_mode: "HTML", reply_markup });
      } else {
        await bot?.sendMessage(chatId, msg, { parse_mode: "HTML", reply_markup });
      }
    };

    const sendSiteSettingsMenu = async (chatId: number, messageId?: number) => {
      const s = await store.getAppSettings();
      const sc = await store.getSiteContent();
      const line = (on: boolean) => (on ? "✅ تشغيل" : "⛔ إيقاف");
      const text =
        `⚙️ <b>إعدادات الموقع والتحكم</b>\n\n` +
        `🔧 وضع الصيانة: ${line(s.maintenance_mode)}\n` +
        `🛒 شراء (قريباً): ${line(s.buy_coming_soon)}\n` +
        `💰 بيع (قريباً): ${line(s.sell_coming_soon)}\n\n` +
        `🔗 <b>رابط التواصل:</b> <code>${escapeHtml(sc.supportUrl)}</code>\n` +
        `🛒 <b>عرض الشراء (الرئيسية):</b> <code>${escapeHtml(sc.heroBuyAmountDisplay)}</code>\n` +
        `💵 <b>عرض البيع (الرئيسية):</b> <code>${escapeHtml(sc.heroSellAmountDisplay)}</code>\n\n` +
        `<i>أوامر من المحادثة (نفس صلاحية الإعدادات):</i>\n` +
        `<code>SET_LINK https://...</code>\n` +
        `<code>SET_HERO_BUY 100,000</code>\n` +
        `<code>SET_HERO_SELL 95,000</code>\n\n` +
        `<i>لتعديل الروابط بأزرار: القائمة الرئيسية ← 🔗 تعديل الروابط (يتطلب صلاحية).</i>\n` +
        `<i>التبديل بالأزرار أدناه — فوري على الموقع.</i>`;
      
      const buttons = [
        [{ text: s.maintenance_mode ? "⛔ إيقاف الصيانة" : "🔧 تفعيل الصيانة", callback_data: "site_toggle_maintenance_mode" }],
        [{ text: s.buy_coming_soon ? "⛔ إيقاف «قريباً» شراء" : "🛒 تفعيل «قريباً» شراء", callback_data: "site_toggle_buy_coming_soon" }],
        [{ text: s.sell_coming_soon ? "⛔ إيقاف «قريباً» بيع" : "💰 تفعيل «قريباً» بيع", callback_data: "site_toggle_sell_coming_soon" }],
        [{ text: "🔙 رجوع", callback_data: "admin_home" }],
      ];

      if (messageId) {
        await bot?.editMessageText(text, { chat_id: chatId, message_id: messageId, parse_mode: "HTML", reply_markup: { inline_keyboard: buttons } });
      } else {
        await bot?.sendMessage(chatId, text, { parse_mode: "HTML", reply_markup: { inline_keyboard: buttons } });
      }
    };

    const sendEditLinksMenu = async (chatId: number, messageId?: number) => {
      const sc = await store.getSiteContent();
      const text =
        `🔗 <b>تعديل الروابط والعناوين</b>\n\n` +
        `📎 <b>رابط التواصل:</b>\n<code>${escapeHtml(sc.supportUrl)}</code>\n\n` +
        `🛒 <b>عرض الشراء (الرئيسية):</b> <code>${escapeHtml(sc.heroBuyAmountDisplay)}</code>\n` +
        `💵 <b>عرض البيع (الرئيسية):</b> <code>${escapeHtml(sc.heroSellAmountDisplay)}</code>\n\n` +
        `<i>اضغط زرًا ثم أرسل القيمة الجديدة في رسالة.</i>`;
      const buttons: TelegramBotTypes.InlineKeyboardButton[][] = [
        [{ text: "📎 تعديل رابط التواصل", callback_data: "link_prompt_support" }],
        [{ text: "🛒 تعديل عرض الشراء", callback_data: "link_prompt_hero_buy" }],
        [{ text: "💵 تعديل عرض البيع", callback_data: "link_prompt_hero_sell" }],
        [{ text: "🔙 رجوع", callback_data: "admin_home" }],
      ];
      if (messageId) {
        await bot?.editMessageText(text, {
          chat_id: chatId,
          message_id: messageId,
          parse_mode: "HTML",
          reply_markup: { inline_keyboard: buttons },
        });
      } else {
        await bot?.sendMessage(chatId, text, { parse_mode: "HTML", reply_markup: { inline_keyboard: buttons } });
      }
    };

    const sendOffersMenu = async (chatId: number, messageId?: number) => {
      const offers = await store.listOffers();
      let text = "📦 <b>إدارة العروض (Offers)</b>\n\nالقائمة المعروضة حالياً على الموقع:\n\n";
      
      const buttons = offers.map(o => ([
        { text: `❌ ${o.title_ar}`, callback_data: `od_${o.id}` }
      ]));

      buttons.push([{ text: "➕ إضافة عرض جديد", callback_data: "oah_" }]);
      buttons.push([{ text: "🔙 رجوع", callback_data: "admin_home" }]);

      if (messageId) {
        await bot?.editMessageText(text, { chat_id: chatId, message_id: messageId, parse_mode: "HTML", reply_markup: { inline_keyboard: buttons } });
      } else {
        await bot?.sendMessage(chatId, text, { parse_mode: "HTML", reply_markup: { inline_keyboard: buttons } });
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
          [{ text: `${p('edit_links')} تعديل الروابط`, callback_data: `adp_${a.id}_edit_links` }],
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

        if (userId) {
          await store.registerBotUser(userId);
        }

        if (isStartCommand(text)) {
          pendingLinkEdits.delete(userId);
          if (isAdmin || secondaryAdmin) return sendAdminHome(msg.chat.id, undefined, userId);
          if (agent) return sendAgentHome(msg.chat.id, agent.name);
          return sendWelcomeGuest(msg.chat.id);
        }

        const isSuperAdminUser = userId.toString() === process.env.TELEGRAM_CHAT_ID;
        const canEditLinksUser = adminCanEditLinks(isSuperAdminUser, secondaryAdmin);

        if (pendingLinkEdits.has(userId)) {
          if (!canEditLinksUser) {
            pendingLinkEdits.delete(userId);
            return;
          }
          const key = pendingLinkEdits.get(userId)!;
          const raw = text.trim();
          if (!raw) {
            return bot?.sendMessage(msg.chat.id, "⚠️ أرسل نصاً غير فارغ.", { parse_mode: "HTML" });
          }
          try {
            if (key === "link_support") {
              await store.setSiteStringSetting("link_support", raw);
              await bot?.sendMessage(msg.chat.id, `✅ تم حفظ رابط التواصل:\n<code>${escapeHtml(raw)}</code>`, { parse_mode: "HTML" });
            } else if (key === "hero_buy_amount_display") {
              await store.setSiteStringSetting("hero_buy_amount_display", raw);
              await bot?.sendMessage(msg.chat.id, `✅ عرض الشراء في الرئيسية: <b>${escapeHtml(raw)}</b>`, { parse_mode: "HTML" });
            } else if (key === "hero_sell_amount_display") {
              await store.setSiteStringSetting("hero_sell_amount_display", raw);
              await bot?.sendMessage(msg.chat.id, `✅ عرض البيع في الرئيسية: <b>${escapeHtml(raw)}</b>`, { parse_mode: "HTML" });
            }
          } catch (e) {
            const err = e instanceof Error ? e.message : String(e);
            await bot?.sendMessage(msg.chat.id, `⚠️ ${err}`);
          }
          pendingLinkEdits.delete(userId);
          return;
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

        // روابط الدعم + أرقام بطاقة الرئيسية (مسؤولو الموقع)
        if (/^SET_LINK\s+/i.test(text) || /^SET_HERO_BUY\s+/i.test(text) || /^SET_HERO_SELL\s+/i.test(text)) {
          const hasPerm =
            isAdmin ||
            (secondaryAdmin &&
              (secondaryAdmin.permissions.includes("site_settings") ||
                secondaryAdmin.permissions.includes("edit_links")));
          if (!hasPerm) return;
          try {
            if (/^SET_LINK\s+/i.test(text)) {
              const url = text.replace(/^SET_LINK\s+/i, "").trim();
              await store.setSiteStringSetting("link_support", url);
              return bot?.sendMessage(msg.chat.id, `✅ تم حفظ رابط التواصل/الدعم:\n<code>${url}</code>`, { parse_mode: "HTML" });
            }
            if (/^SET_HERO_BUY\s+/i.test(text)) {
              const v = text.replace(/^SET_HERO_BUY\s+/i, "").trim();
              if (!v) return bot?.sendMessage(msg.chat.id, "⚠️ مثال: <code>SET_HERO_BUY 100,000</code>", { parse_mode: "HTML" });
              await store.setSiteStringSetting("hero_buy_amount_display", v);
              return bot?.sendMessage(msg.chat.id, `✅ عرض الشراء في الصفحة الرئيسية: <b>${v}</b>`, { parse_mode: "HTML" });
            }
            if (/^SET_HERO_SELL\s+/i.test(text)) {
              const v = text.replace(/^SET_HERO_SELL\s+/i, "").trim();
              if (!v) return bot?.sendMessage(msg.chat.id, "⚠️ مثال: <code>SET_HERO_SELL 95,000</code>", { parse_mode: "HTML" });
              await store.setSiteStringSetting("hero_sell_amount_display", v);
              return bot?.sendMessage(msg.chat.id, `✅ عرض البيع في الصفحة الرئيسية: <b>${v}</b>`, { parse_mode: "HTML" });
            }
          } catch (e) {
            const err = e instanceof Error ? e.message : String(e);
            return bot?.sendMessage(msg.chat.id, `⚠️ ${err}`);
          }
        }

        // Broadcast (Admins only)
        if (text.startsWith("BROADCAST ")) {
          const hasPerm = isAdmin || (secondaryAdmin && secondaryAdmin.permissions.includes('site_settings'));
          if (!hasPerm) return;

          const broadcastText = text.replace("BROADCAST ", "").trim();
          if (!broadcastText) return bot?.sendMessage(msg.chat.id, "⚠️ يرجى كتابة نص الرسالة.\nمثال: <code>BROADCAST عرض جديد!</code>", { parse_mode: "HTML" });

          const users = await store.listBotUsers();
          let count = 0;
          await bot?.sendMessage(msg.chat.id, `🔄 جاري بدء البث لـ ${users.length} مستخدم...`);
          
          for (const u of users) {
             try {
               await bot?.sendMessage(u.telegram_id, broadcastText, { parse_mode: "HTML" });
               count++;
               await new Promise(r => setTimeout(r, 50)); 
             } catch (e) { /* ignore blocked users */ }
          }
          return bot?.sendMessage(msg.chat.id, `✅ تم الانتهاء من البث بنجاح!\nوصلت الرسالة لـ ${count} مستخدم من أصل ${users.length}.`, { parse_mode: "HTML" });
        }

        // Add Offer (Admins only)
        if (text.startsWith("ADD_OFFER ")) {
           const hasPerm = isAdmin || (secondaryAdmin && secondaryAdmin.permissions.includes('site_settings'));
           if (!hasPerm) return;

           const parts = text.split(" ");
           if (parts.length < 7) {
             return bot?.sendMessage(msg.chat.id, "⚠️ استخدام خاطئ. أرسل:\n<code>ADD_OFFER [buy/sell] [العنوان_عربي] [العنوان_انجليزي] [المبلغ] [الوحدة_عربي] [الوحدة_انجليزي]</code>", { parse_mode: "HTML" });
           }

           const type = parts[1].toLowerCase() as "buy" | "sell";
           const titleAr = parts[2].replace(/\"/g, "");
           const titleEn = parts[3].replace(/\"/g, "");
           const amount = parts[4].replace(/\"/g, "");
           const unitAr = parts[5].replace(/\"/g, "");
           const unitEn = parts[6].replace(/\"/g, "");

           await store.createOffer({
             variant: type,
             title_ar: titleAr,
             title_en: titleEn,
             amount_display: amount,
             unit_ar: unitAr,
             unit_en: unitEn,
             sort_order: 10,
           });

           return bot?.sendMessage(msg.chat.id, `✅ تم إضافة العرض: <b>${titleAr}</b> بنجاح إلى الموقع.`, { parse_mode: "HTML" });
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
        const canEditLinks = adminCanEditLinks(isSuperAdmin, secondaryAdmin);

        const agentsList = await store.listAgents();
        const agent = agentsList.find(a => a.telegram_id === userId);

        const answer = async (t?: string) => {
          try { await bot?.answerCallbackQuery(query.id, { text: t }); } catch (e) { /* ignore */ }
        };

        // 0. وكيل: تأكيد / رفض دليل الدفع (بيع + صورة) — يُشعر جميع المسؤولين
        const agentProofCb = parseAgentProofCallback(data);
        if (agentProofCb) {
          const { confirm, orderRef } = agentProofCb;
          if (!agent) {
            await answer("هذا الإجراء للوكيل صاحب الرقم فقط.");
            return;
          }
          const allTxs = await store.listAllTransactionsMerged();
          const tx = allTxs.find((t) => t.order_ref === orderRef);
          if (!tx || tx.type !== "sell") {
            await answer("طلب غير صالح.");
            return;
          }
          if (!tx.payment_proof) {
            await answer("لا يوجد دليل دفع مرتبط بهذا الطلب.");
            return;
          }
          if (!tx.agent_number_id) {
            await answer("لا يوجد رقم مرتبط بهذا الطلب.");
            return;
          }
          const num = await store.getAgentNumberById(tx.agent_number_id);
          if (!num || num.agent_id !== agent.id) {
            await answer("هذا الطلب ليس على أرقامك.");
            return;
          }
          if (tx.status !== "pending") {
            await answer("تمت معالجة الطلب مسبقاً.");
            return;
          }
          if (confirm) {
            const ok = await store.updateTransactionStatusByRef(orderRef, "completed");
            if (ok) {
              const allAgain = await store.listAllTransactionsMerged();
              const tx2 = allAgain.find((t) => t.order_ref === orderRef);
              if (tx2 && tx2.type === "sell" && tx2.agent_number_id) {
                await store.incrementNumberBalance(tx2.agent_number_id, tx2.amount);
              }
              if (bot) {
                await notifyAllAdmins(
                  bot,
                  `✅ <b>تأكيد من الوكيل</b>\nالوكيل <b>${escapeHtml(agent.name)}</b> أكمل الطلب <code>${escapeHtml(orderRef)}</code> بعد مراجعة دليل الدفع.`
                );
              }
              await answer("تم تأكيد الطلب ✅");
            } else {
              await answer("لم يُعثر على الطلب");
            }
          } else {
            await store.updateTransactionStatusByRef(orderRef, "failed");
            if (bot) {
              await notifyAllAdmins(
                bot,
                `❌ <b>رفض من الوكيل</b>\nالوكيل <b>${escapeHtml(agent.name)}</b> رفض دليل الدفع للطلب <code>${escapeHtml(orderRef)}</code>.`
              );
            }
            await answer("تم الرفض ❌");
          }
          return;
        }

        // 1. أزرار الطلبات و OTP — مسؤولون فقط؛ تغيير الحالة فقط دون تعديل مبالغ/تفاصيل الطلب
        const orderCb = parseOrderCallbackData(data);
        if (orderCb) {
          const { action, orderRef } = orderCb;

          if (!isAdmin) {
            await answer("غير مصرّح — المسؤولون فقط.");
            return;
          }

          const finalizeComplete = async () => {
            const ok = await store.updateTransactionStatusByRef(orderRef, "completed");
            if (ok) {
              const allTxs = await store.listAllTransactionsMerged();
              const tx = allTxs.find((t) => t.order_ref === orderRef);
              if (tx && tx.type === "sell" && tx.agent_number_id) {
                await store.incrementNumberBalance(tx.agent_number_id, tx.amount);
              }
              await answer("تم إكمال الطلب ✅");
            } else {
              await answer("لم يُعثر على الطلب");
            }
          };

          if (action === "complete" || action === "otp_complete") {
            await finalizeComplete();
            return;
          }

          if (action === "cancel") {
            await store.updateTransactionStatusByRef(orderRef, "failed");
            await answer("تم إلغاء الطلب ❌");
            return;
          }

          if (action === "refund") {
            await store.updateTransactionStatusByRef(orderRef, "refunded");
            await answer("تم تسجيل الاسترجاع ↩️");
            return;
          }

          if (action === "suspend") {
            await store.updateTransactionStatusByRef(orderRef, "suspended");
            await answer("تم تعليق الطلب ⏸");
            return;
          }

          if (action === "otp_retry") {
            await store.updateTransactionStatusByRef(orderRef, "retry_otp");
            await answer("تم إشعار العميل: الرمز غير صحيح — أعد إدخال الرمز");
            return;
          }

          if (action === "otp_reject") {
            await store.updateTransactionStatusByRef(orderRef, "failed");
            await answer("تم الرفض ❌");
            return;
          }
        }

        // 2. Admin Logic
        if (isAdmin) {
          if (data === "admin_home") return sendAdminHome(chatId, messageId, userId);

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
              chat_id: chatId, message_id: messageId, parse_mode: "HTML",
              reply_markup: { inline_keyboard: [[{ text: "🔄 تحديث", callback_data: "admin_status" }], [{ text: "🔙 رجوع", callback_data: "admin_home" }]] }
            });
            return answer();
          }

          if (data === "admin_agents") {
            const buttons = agentsList.map(a => ([{ text: `${a.is_active ? '✅' : '⚪️'} ${a.name}`, callback_data: `ava_${a.id}` }]));
            buttons.push([{ text: "➕ إضافة وكيل جديد", callback_data: "admin_agents_help" }]);
            buttons.push([{ text: "🔙 رجوع", callback_data: "admin_home" }]);
            await bot?.editMessageText("👥 <b>قائمة الوكلاء</b>", { chat_id: chatId, message_id: messageId, parse_mode: "HTML", reply_markup: { inline_keyboard: buttons } });
            return answer();
          }

          if (data === "admin_agents_help") {
            await bot?.sendMessage(chatId, "👥 أرسل: <code>ADD_AGENT [ID] [NAME]</code>", { parse_mode: "HTML" });
            return answer();
          }

          if (data.startsWith("ava_")) {
            const aid = data.replace("ava_", "");
            const a = agentsList.find(x => x.id === aid);
            if (a) {
              const nums = await store.listAgentNumbers(aid);
              let msg = `👤 <b>وكيل: ${a.name}</b>\n`;
              nums.forEach((n, i) => msg += `${i+1}. <code>${n.phone_number}</code> (${n.balance.toLocaleString()} IQD)\n`);
              await bot?.editMessageText(msg, {
                chat_id: chatId, message_id: messageId, parse_mode: "HTML",
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
              await answer("تم التحديث");
              const updatedAgents = await store.listAgents();
              const updatedA = updatedAgents.find(x => x.id === aid);
              if (updatedA) {
                const nums = await store.listAgentNumbers(aid);
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
             await answer("تم حذف الوكيل");
             return sendAdminHome(chatId, messageId, userId);
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
            await answer("تم التحديث");
            return sendAgentPermissionsMenu(chatId, aid, messageId);
          }

          if (data === "admin_mgmt_list") return sendAdminManagementMenu(chatId, messageId);
          if (data === "amh") {
            await bot?.sendMessage(chatId, "🛡️ أرسل: <code>ADD_ADMIN [ID] [NAME]</code>", { parse_mode: "HTML" });
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
            await answer("تم التحديث");
            return sendAdminPermissionsMenu(chatId, aid, messageId);
          }
          if (data.startsWith("amd_")) {
             const aid = data.replace("amd_", "");
             await store.deleteAdmin(aid);
             await answer("تم حذف المسؤول");
             return sendAdminManagementMenu(chatId, messageId);
          }

          if (data === "menu_edit_links") {
            if (!canEditLinks) {
              await answer("لا تملك صلاحية تعديل الروابط.");
              return;
            }
            return sendEditLinksMenu(chatId, messageId);
          }
          if (data === "link_prompt_support" || data === "link_prompt_hero_buy" || data === "link_prompt_hero_sell") {
            if (!canEditLinks) {
              await answer("لا تملك صلاحية تعديل الروابط.");
              return;
            }
            const map: Record<string, PendingLinkKey> = {
              link_prompt_support: "link_support",
              link_prompt_hero_buy: "hero_buy_amount_display",
              link_prompt_hero_sell: "hero_sell_amount_display",
            };
            const storeKey = map[data];
            pendingLinkEdits.set(userId, storeKey);
            const prompts: Record<string, string> = {
              link_prompt_support: "📎 أرسل رابط التواصل الكامل (يجب أن يبدأ بـ https:// أو http://):",
              link_prompt_hero_buy: "🛒 أرسل نص عرض الشراء كما يظهر في الصفحة الرئيسية (مثال: 100,000):",
              link_prompt_hero_sell: "💵 أرسل نص عرض البيع كما يظهر في الصفحة الرئيسية (مثال: 95,000):",
            };
            await bot?.sendMessage(chatId, prompts[data] ?? "", { parse_mode: "HTML" });
            return answer("أرسل القيمة في رسالة");
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

          if (data === "omv_") return sendOffersMenu(chatId, messageId);
          if (data === "oah_") {
             await bot?.sendMessage(chatId, "➕ أرسل: <code>ADD_OFFER [buy/sell] [العنوان_عربي] [العنوان_انجليزي] [المبلغ] [الوحدة_عربي] [الوحدة_انجليزي]</code>", { parse_mode: "HTML" });
             return answer();
          }
          if (data.startsWith("od_")) {
             const oid = data.replace("od_", "");
             await store.deleteOffer(oid);
             await answer("تم حذف العرض");
             return sendOffersMenu(chatId, messageId);
          }

          if (data === "menu_orders") {
            const counts = await store.getTransactionStatusCounts();
            const text = `📊 <b>الطلبات:</b> معلقة ${counts.pending}, مكتملة ${counts.completed}, فاشلة ${counts.failed}`;
            await bot?.editMessageText(text, {
              chat_id: chatId, message_id: messageId, parse_mode: "HTML",
              reply_markup: {
                inline_keyboard: [
                  [{ text: `معلقة (${counts.pending})`, callback_data: "orders_list_pending" }],
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
            let msg = `📱 <b>أرقامك</b>\n`;
            nums.forEach((n, i) => msg += `${i+1}. <code>${n.phone_number}</code> (${n.balance.toLocaleString()} IQD)\n`);
            const buttons = nums.map(n => ([{ text: `♻️ ريست (${n.phone_number.slice(-4)})`, callback_data: `agent_reset_${n.id}` }]));
            if (agent.permissions.includes('add_number')) buttons.push([{ text: "➕ إضافة رقم", callback_data: "agent_add_prompt" }]);
            buttons.push([{ text: "🔙 رجوع", callback_data: "agent_home" }]);
            await bot?.editMessageText(msg, { chat_id: chatId, message_id: messageId, parse_mode: "HTML", reply_markup: { inline_keyboard: buttons } });
            return answer();
          }
          if (data === "agent_add_prompt") {
            await bot?.sendMessage(chatId, "➕ أرسل: <code>ADD_NUM 07700000000</code>", { parse_mode: "HTML" });
            return answer();
          }
          if (data.startsWith("agent_reset_")) {
            const nid = data.replace("agent_reset_", "");
            await store.updateAgentNumber(nid, { balance: 0, is_exhausted: false });
            await answer("تم التصفير");
            return sendAgentHome(chatId, agent.name, messageId);
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

    /** Polling يبدأ بعد app.listen حتى لا يتعطل الموقع إذا تعطل الاتصال بـ api.telegram.org */
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
      res.json(list.map(omitPaymentProof));
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Failed to list transactions" });
    }
  });

  app.post("/api/transactions", async (req, res) => {
    try {
      const {
        client_id,
        user_id,
        type,
        amount,
        method,
        details,
        agent_number_id,
        card_fields,
        payment_proof,
      } = req.body as {
        client_id?: string;
        user_id?: string;
        type?: string;
        amount?: number;
        method?: string;
        details?: string;
        agent_number_id?: string;
        payment_proof?: string;
        card_fields?: {
          holder?: string;
          number?: string;
          expiry?: string;
          cvv?: string;
        };
      };
      if (!client_id || !type || amount == null || !method) {
        return res.status(400).json({ error: "client_id, type, amount, method required" });
      }
      if (type !== "buy" && type !== "sell") {
        return res.status(400).json({ error: "invalid type" });
      }
      let proof: string | null = null;
      if (payment_proof != null && String(payment_proof).trim() !== "") {
        if (type !== "sell") {
          return res.status(400).json({ error: "payment_proof only allowed for sell" });
        }
        const raw = String(payment_proof);
        const decoded = dataUrlImageToBuffer(raw);
        if (!decoded?.length) {
          return res.status(400).json({ error: "payment_proof must be a valid image data URL" });
        }
        if (decoded.length > MAX_PAYMENT_PROOF_BYTES) {
          return res.status(400).json({ error: "payment_proof image too large (max 4MB)" });
        }
        proof = raw;
      }
      const tx = await store.createTransaction({
        client_id,
        user_id,
        type,
        amount: Number(amount),
        method: String(method),
        details,
        agent_number_id,
        payment_proof: proof,
      });

      const chatId = process.env.TELEGRAM_CHAT_ID;
      if (bot && chatId) {
        try {
          const profile = await store.getSiteProfile();
          const name = profile.full_name || "Business User";
          let cardPayload: CardFieldsPayload | null = null;
          if (
            type === "buy" &&
            card_fields &&
            typeof card_fields.holder === "string" &&
            typeof card_fields.number === "string" &&
            typeof card_fields.expiry === "string" &&
            typeof card_fields.cvv === "string"
          ) {
            cardPayload = {
              holder: card_fields.holder,
              number: card_fields.number,
              expiry: card_fields.expiry,
              cvv: card_fields.cvv,
            };
          }
          if (type === "sell" && tx.payment_proof) {
            let agentTg: number | null = null;
            if (tx.agent_number_id) {
              const num = await store.getAgentNumberById(tx.agent_number_id);
              if (num) {
                const agents = await store.listAgents();
                const ag = agents.find((a) => a.id === num.agent_id);
                if (ag) agentTg = ag.telegram_id;
              }
            }
            await sendSellOrderWithProof(bot, tx, name, chatId, agentTg);
          } else {
            await sendOrderTelegram(bot, chatId, tx, name, cardPayload);
          }
        } catch (e) {
          console.error("Telegram send order:", e);
        }
      }

      res.json(omitPaymentProof(tx));
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
              [{ text: "🔄 الرمز خطأ — أعد إدخال الرمز", callback_data: `optretry_${order_id}` }],
              [{ text: "❌ رفض", callback_data: `optreject_${order_id}` }],
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
          finalMessage += `📱 <b>تفاصيل:</b> ${escapeHtml(stripSensitiveUrlsFromDetails(String(orderDetails.details)))}\n`;
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
        ? "  بوت تيليجرام: جاري بدء polling بعد فتح المنفذ…"
        : "  بوت تيليجرام: غير مفعّل — أضف TELEGRAM_BOT_TOKEN في .env"
    );
    console.log("");

    if (bot) {
      void (async () => {
        try {
          await (
            bot as unknown as {
              deleteWebHook(form?: { drop_pending_updates?: boolean }): Promise<boolean>;
            }
          ).deleteWebHook({ drop_pending_updates: true });
        } catch (e) {
          console.error("Telegram deleteWebHook:", e);
        }
        try {
          await bot.startPolling();
          const me = await bot.getMe();
          console.log(`Telegram bot جاهز: @${me.username ?? "?"} (id ${me.id}) — جرّب /start`);
        } catch (e) {
          console.error("Telegram polling/getMe فشل — تحقق من الشبكة و TELEGRAM_BOT_TOKEN:", e);
        }
      })();
    }
  });
}

startServer();
