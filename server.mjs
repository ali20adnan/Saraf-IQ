import "dotenv/config";
import { existsSync, writeFileSync } from "node:fs";
import compression from "compression";
import cors from "cors";
import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import TelegramBot from "./server/telegram";
import {
  buildAgentProofKeyboard,
  buildNewOrderMessagePayload,
  dataUrlImageToBuffer,
  escapeHtml,
  formatOrderLines,
  isStartCommand,
  parseAgentProofCallback,
  parseOrderCallbackData,
  stripSensitiveUrlsFromDetails
} from "./server/botMessages";
import * as store from "./server/store";
import { notifyOrderStatusByRef, sendFcmAnnouncement } from "./server/pushFcm";
const pendingLinkEdits = /* @__PURE__ */ new Map();
const pendingAgentPaymentEdits = /* @__PURE__ */ new Map();
function parseAgentMeditCallback(data) {
  if (!data.startsWith("agent_medit_")) return null;
  const rest = data.slice("agent_medit_".length);
  const suffixes = ["_account_number", "_account_holder", "_barcode"];
  for (const suf of suffixes) {
    if (rest.endsWith(suf)) {
      const encKey = rest.slice(0, -suf.length);
      const key = encKey.replace(/§/g, "_");
      const field = suf.slice(1);
      return { key, field };
    }
  }
  return null;
}
function adminCanEditLinks(isSuperAdmin, secondary) {
  if (isSuperAdmin) return true;
  return secondary?.permissions.includes("edit_links") ?? false;
}
async function sendOrderTelegram(bot, chatId, tx, profileName, cardFields) {
  const { text, reply_markup } = buildNewOrderMessagePayload(tx, profileName, cardFields);
  await bot.sendMessage(chatId, text, {
    parse_mode: "HTML",
    reply_markup
  });
}
function omitPaymentProof(tx) {
  if (tx.payment_proof == null) return tx;
  const { payment_proof: _p, ...rest } = tx;
  return rest;
}
const MAX_PAYMENT_PROOF_BYTES = 4 * 1024 * 1024;
async function notifyAllAdmins(bot, html) {
  const ids = /* @__PURE__ */ new Set();
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
async function getOrderBroadcastRecipientIds() {
  const ids = /* @__PURE__ */ new Set();
  const primary = process.env.TELEGRAM_CHAT_ID;
  if (primary) ids.add(Number(primary));
  for (const a of await store.listAdmins()) ids.add(a.telegram_id);
  const agents = await store.listAgents();
  const active = agents.find((x) => x.is_active);
  if (active && Number.isFinite(active.telegram_id)) ids.add(active.telegram_id);
  return [...ids].filter((id) => Number.isFinite(id));
}
async function sendSellOrderWithProof(bot, tx, profileName, owningAgentTelegramId) {
  let recipients = await getOrderBroadcastRecipientIds();
  if (recipients.length === 0 && owningAgentTelegramId != null && Number.isFinite(owningAgentTelegramId)) {
    recipients = [owningAgentTelegramId];
  }
  const { text, reply_markup } = buildNewOrderMessagePayload(tx, profileName, null);
  const caption = text.length > 1024 ? `${text.slice(0, 1e3)}\u2026` : text;
  const buf = dataUrlImageToBuffer(tx.payment_proof);
  const broadcast = async (fn) => {
    for (const id of recipients) {
      try {
        await fn(String(id));
      } catch (e) {
        console.error("sendSellOrderWithProof broadcast:", id, e);
      }
    }
  };
  if (!buf?.length) {
    await broadcast((chatId) => sendOrderTelegram(bot, chatId, tx, profileName, null));
    return;
  }
  await broadcast(async (chatId) => {
    await bot.sendPhoto(chatId, buf, {
      caption,
      parse_mode: "HTML",
      reply_markup
    });
  });
  if (owningAgentTelegramId != null && Number.isFinite(owningAgentTelegramId)) {
    const extra = `

<i>\u{1F9D1}\u200D\u{1F4BC} \u0645\u0631\u0627\u062C\u0639\u0629 \u062F\u0644\u064A\u0644 \u0627\u0644\u062F\u0641\u0639 \u2014 \u062A\u0623\u0643\u064A\u062F \u0625\u0630\u0627 \u0627\u0633\u062A\u0644\u0645\u062A \u0627\u0644\u0645\u0628\u0644\u063A\u060C \u0623\u0648 \u0631\u0641\u0636 \u0625\u0646 \u0644\u0645 \u064A\u062A\u0648\u0627\u0641\u0642.</i>`;
    let capAgent = caption + extra;
    if (capAgent.length > 1024) capAgent = `${capAgent.slice(0, 1e3)}\u2026`;
    try {
      await bot.sendPhoto(owningAgentTelegramId, buf, {
        caption: capAgent,
        parse_mode: "HTML",
        reply_markup: buildAgentProofKeyboard(tx.id)
      });
    } catch (e) {
      console.error("sendSellOrderWithProof agent proof:", e);
    }
  }
}
function resolveCorsOrigin() {
  const raw = process.env.CORS_ALLOWED_ORIGINS?.trim();
  if (!raw) return true;
  const allowed = new Set(raw.split(",").map((s) => s.trim()).filter(Boolean));
  if (allowed.size === 0) return true;
  return (origin, callback) => {
    if (!origin) {
      callback(null, true);
      return;
    }
    callback(null, allowed.has(origin));
  };
}
async function startServer() {
  const app = express();
  const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3e3;
  app.use(
    "/api",
    cors({
      origin: resolveCorsOrigin(),
      methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization"],
      optionsSuccessStatus: 204,
      maxAge: 86400
    })
  );
  app.use(compression({ threshold: 860 }));
  app.use(express.json({ limit: "12mb" }));
  app.set("trust proxy", true);
  store.ensureBuyWalletIconsDir();
  store.ensureSellWalletIconsDir();
  app.use(
    "/uploads/buy-wallet-icons",
    express.static(path.join(process.cwd(), "data", "buy-wallet-icons"), {
      maxAge: "7d",
      index: false,
      fallthrough: true
    })
  );
  app.use(
    "/uploads/sell-wallet-icons",
    express.static(path.join(process.cwd(), "data", "sell-wallet-icons"), {
      maxAge: "7d",
      index: false,
      fallthrough: true
    })
  );
  const APK_DOWNLOAD_URL = process.env.APK_DOWNLOAD_URL?.trim();
  const APK_FILE_ON_DISK = "saraf-iq-debug.apk";
  const APK_DOWNLOAD_PATH = "/download/apk";
  function resolveCanonicalOrigin(req) {
    const host = req.get("host") || "localhost";
    const proto = req.get("x-forwarded-proto")?.split(",")[0]?.trim() || req.protocol || "https";
    const origin = `${proto}://${host}`;
    const railwayDomain = process.env.RAILWAY_PUBLIC_DOMAIN?.trim();
    const publicBase = process.env.PUBLIC_BASE_URL?.replace(/\/$/, "").trim();
    return publicBase || (railwayDomain ? `https://${railwayDomain}` : null) || origin;
  }
  const sendApkOrRedirect = (_req, res) => {
    if (APK_DOWNLOAD_URL) {
      res.redirect(302, APK_DOWNLOAD_URL);
      return;
    }
    const root = process.cwd();
    const apkPath = process.env.NODE_ENV === "production" ? path.join(root, "dist", APK_FILE_ON_DISK) : path.join(root, "public", APK_FILE_ON_DISK);
    if (!existsSync(apkPath)) {
      res.status(404).type("text/plain; charset=utf-8").send(
        [
          "\u0644\u0627 \u064A\u0648\u062C\u062F \u0645\u0644\u0641 APK.",
          "\u0623\u0636\u0641 \u0641\u064A Railway \u0627\u0644\u0645\u062A\u063A\u064A\u0631 APK_DOWNLOAD_URL=\u0631\u0627\u0628\u0637_\u0645\u0628\u0627\u0634\u0631.apk \u0623\u0648 \u0636\u0639 \u0627\u0644\u0645\u0644\u0641 \u0641\u064A public/saraf-iq-debug.apk \u062B\u0645 \u0627\u0646\u0634\u0631.",
          "",
          "No APK. Set APK_DOWNLOAD_URL on Railway, or add public/saraf-iq-debug.apk and redeploy."
        ].join("\n")
      );
      return;
    }
    res.setHeader("Content-Type", "application/vnd.android.package-archive");
    res.setHeader("Content-Disposition", `attachment; filename="${APK_FILE_ON_DISK}"`);
    res.sendFile(apkPath);
  };
  app.get(APK_DOWNLOAD_PATH, sendApkOrRedirect);
  app.get(`/${APK_FILE_ON_DISK}`, sendApkOrRedirect);
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
    const supabaseUrl = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "").trim();
    const supabaseAnonKey = (process.env.VITE_SUPABASE_ANON_KEY || process.env.PUBLIC_SUPABASE_ANON_KEY || "").trim();
    const apkUrl = process.env.VITE_APK_URL?.trim() || void 0;
    const railwayPublicDomain = process.env.RAILWAY_PUBLIC_DOMAIN?.trim() || void 0;
    if (!supabaseUrl.startsWith("http") || !supabaseAnonKey) {
      res.status(503).json({
        error: "missing_env",
        message: "Set VITE_SUPABASE_URL or SUPABASE_URL, and VITE_SUPABASE_ANON_KEY (or PUBLIC_SUPABASE_ANON_KEY) in Railway."
      });
      return;
    }
    res.json({
      supabaseUrl,
      supabaseAnonKey,
      ...apkUrl ? { apkUrl } : {},
      ...railwayPublicDomain ? { railwayPublicDomain } : {}
    });
  });
  app.post("/api/auth/signup", async (req, res) => {
    try {
      if (!store.db) {
        res.status(503).json({ error: "supabase_unavailable" });
        return;
      }
      const email = String(req.body?.email || "").trim().toLowerCase();
      const password = String(req.body?.password || "").trim();
      const fullName = String(req.body?.fullName || "").trim();
      if (!email || !password) {
        res.status(400).json({ error: "missing_fields" });
        return;
      }
      if (password.length < 6) {
        res.status(400).json({ error: "weak_password" });
        return;
      }
      const adminApi = store.db.auth.admin;
      const { data, error } = await adminApi.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { full_name: fullName || void 0 }
      });
      if (error) {
        const msg = error.message.toLowerCase();
        if (msg.includes("already") || msg.includes("exists")) {
          res.status(409).json({ error: "email_exists" });
          return;
        }
        throw error;
      }
      const userId = data.user?.id;
      if (!userId) {
        res.status(500).json({ error: "user_create_failed" });
        return;
      }
      const { error: profileErr } = await store.db.from("profiles").upsert([{ id: userId, full_name: fullName || null, role: "user", balance: 0 }], {
        onConflict: "id"
      });
      if (profileErr) {
        console.warn("signup profile upsert warning:", profileErr.message);
      }
      res.status(201).json({ ok: true, userId });
    } catch (e) {
      console.error("signup endpoint error:", e);
      res.status(500).json({ error: "signup_failed", message: e?.message || "signup_failed" });
    }
  });
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
        hint: "\u0627\u0644\u0636\u063A\u0637 \u0639\u0644\u0649 url \u064A\u0645\u0631\u0651 \u0639\u0628\u0631 \u0627\u0644\u0633\u064A\u0631\u0641\u0631 \u062B\u0645 \u064A\u062D\u0645\u0651\u0644 \u0627\u0644\u0645\u0644\u0641 \u0645\u0646 \u0627\u0644\u0631\u0627\u0628\u0637 \u0627\u0644\u062E\u0627\u0631\u062C\u064A. / Clicking url redirects then downloads from external URL."
      });
      return;
    }
    res.json({
      url: downloadUrl,
      path: APK_DOWNLOAD_PATH,
      railwayPublicDomain: railwayDomain || null,
      linkedToRailway: Boolean(railwayDomain),
      hint: "GET /download/apk \u064A\u0631\u0633\u0644 \u0627\u0644\u0645\u0644\u0641 \u0645\u0628\u0627\u0634\u0631\u0629 \u0625\u0646 \u0648\u064F\u062C\u062F \u0641\u064A dist. / Serves file from dist when present."
    });
  });
  const botToken = process.env.TELEGRAM_BOT_TOKEN?.trim();
  let bot = null;
  if (botToken) {
    bot = new TelegramBot(botToken, { polling: false });
    const sendAdminHome = async (chatId, messageId, forUserId) => {
      const msg = `\u{1F454} <b>\u0644\u0648\u062D\u0629 \u062A\u062D\u0643\u0645 \u0627\u0644\u0625\u062F\u0627\u0631\u0629</b>
\u0645\u0631\u062D\u0628\u0627\u064B \u0628\u0643\u060C \u064A\u0645\u0643\u0646\u0643 \u0625\u062F\u0627\u0631\u0629 \u0627\u0644\u0648\u0643\u0644\u0627\u0621\u060C \u0627\u0644\u0645\u0633\u0624\u0648\u0644\u064A\u0646 \u0648\u0645\u0631\u0627\u0642\u0628\u0629 \u0627\u0644\u0646\u0638\u0627\u0645.`;
      let showLinks = false;
      let showAppPush = false;
      if (forUserId != null) {
        const isSuper = forUserId.toString() === process.env.TELEGRAM_CHAT_ID;
        const admins = await store.listAdmins();
        const sec = admins.find((a) => a.telegram_id === forUserId);
        showLinks = adminCanEditLinks(isSuper, sec);
        showAppPush = isSuper || (sec?.permissions.includes("site_settings") ?? false);
      }
      const inline_keyboard = [
        [{ text: "\u{1F4CA} \u062D\u0627\u0644\u0629 \u0627\u0644\u0646\u0638\u0627\u0645", callback_data: "admin_status" }, { text: "\u{1F465} \u0627\u0644\u0648\u0643\u0644\u0627\u0621", callback_data: "admin_agents" }],
        [{ text: "\u{1F5A5}\uFE0F \u0625\u062D\u0635\u0627\u0626\u064A\u0627\u062A \u0639\u0627\u0645\u0629", callback_data: "menu_orders" }, { text: "\u{1F6E1}\uFE0F \u0625\u062F\u0627\u0631\u0629 \u0627\u0644\u0645\u0633\u0624\u0648\u0644\u064A\u0646", callback_data: "admin_mgmt_list" }],
        [{ text: "\u{1F4E6} \u0625\u062F\u0627\u0631\u0629 \u0627\u0644\u0639\u0631\u0648\u0636", callback_data: "omv_" }],
        [{ text: "\u2699\uFE0F \u0625\u0639\u062F\u0627\u062F\u0627\u062A \u0627\u0644\u0645\u0648\u0642\u0639", callback_data: "menu_site_settings" }]
      ];
      if (showLinks) {
        inline_keyboard.push([{ text: "\u{1F517} \u062A\u0639\u062F\u064A\u0644 \u0627\u0644\u0631\u0648\u0627\u0628\u0637", callback_data: "menu_edit_links" }]);
      }
      if (showAppPush) {
        inline_keyboard.push([{ text: "\u{1F4F2} \u0625\u0634\u0639\u0627\u0631\u0627\u062A \u0627\u0644\u062A\u0637\u0628\u064A\u0642", callback_data: "menu_app_notifications" }]);
      }
      const reply_markup = { inline_keyboard };
      if (messageId) {
        await bot?.editMessageText(msg, { chat_id: chatId, message_id: messageId, parse_mode: "HTML", reply_markup });
      } else {
        await bot?.sendMessage(chatId, msg, { parse_mode: "HTML", reply_markup });
      }
    };
    const sendSiteSettingsMenu = async (chatId, messageId) => {
      const s = await store.getAppSettings();
      const sc = await store.getSiteContent();
      const line = (on) => on ? "\u2705 \u062A\u0634\u063A\u064A\u0644" : "\u26D4 \u0625\u064A\u0642\u0627\u0641";
      const text = `\u2699\uFE0F <b>\u0625\u0639\u062F\u0627\u062F\u0627\u062A \u0627\u0644\u0645\u0648\u0642\u0639 \u0648\u0627\u0644\u062A\u062D\u0643\u0645</b>

\u{1F527} \u0648\u0636\u0639 \u0627\u0644\u0635\u064A\u0627\u0646\u0629: ${line(s.maintenance_mode)}
\u{1F6D2} \u0634\u0631\u0627\u0621 (\u0642\u0631\u064A\u0628\u0627\u064B): ${line(s.buy_coming_soon)}
\u{1F4B0} \u0628\u064A\u0639 (\u0642\u0631\u064A\u0628\u0627\u064B): ${line(s.sell_coming_soon)}

\u{1F4B3} <b>\u0637\u0631\u0642 \u0627\u0644\u062F\u0641\u0639 (\u0634\u0631\u0627\u0621) / \u0627\u0644\u0627\u0633\u062A\u0644\u0627\u0645 (\u0628\u064A\u0639):</b>
\u2022 \u0632\u064A\u0646 \u0643\u0627\u0634: \u062F\u0641\u0639 ${line(s.method_zaincash_buy_enabled)} \xB7 \u0627\u0633\u062A\u0644\u0627\u0645 ${line(s.method_zaincash_sell_enabled)}
\u2022 \u0633\u0648\u0628\u0631 \u0643\u064A: \u062F\u0641\u0639 ${line(s.method_superqi_buy_enabled)} \xB7 \u0627\u0633\u062A\u0644\u0627\u0645 ${line(s.method_superqi_sell_enabled)}
\u2022 FIB: \u062F\u0641\u0639 ${line(s.method_firstbank_buy_enabled)} \xB7 \u0627\u0633\u062A\u0644\u0627\u0645 ${line(s.method_firstbank_sell_enabled)}
\u2022 \u0641\u0627\u0633\u062A \u0628\u064A: \u062F\u0641\u0639 ${line(s.method_fastpay_buy_enabled)} \xB7 \u0627\u0633\u062A\u0644\u0627\u0645 ${line(s.method_fastpay_sell_enabled)}
\u2022 \u0628\u0637\u0627\u0642\u0629 \u0628\u0646\u0643\u064A\u0629 (\u0634\u0631\u0627\u0621 \u0641\u0642\u0637): ${line(s.method_creditcard_buy_enabled)}

\u{1F517} <b>\u0631\u0627\u0628\u0637 \u0627\u0644\u062A\u0648\u0627\u0635\u0644:</b> <code>${escapeHtml(sc.supportUrl)}</code>
\u{1F6D2} <b>\u0639\u0631\u0636 \u0627\u0644\u0634\u0631\u0627\u0621 (\u0627\u0644\u0631\u0626\u064A\u0633\u064A\u0629):</b> <code>${escapeHtml(sc.heroBuyAmountDisplay)}</code>
\u{1F4B5} <b>\u0639\u0631\u0636 \u0627\u0644\u0628\u064A\u0639 (\u0627\u0644\u0631\u0626\u064A\u0633\u064A\u0629):</b> <code>${escapeHtml(sc.heroSellAmountDisplay)}</code>

<i>\u0623\u0648\u0627\u0645\u0631 \u0645\u0646 \u0627\u0644\u0645\u062D\u0627\u062F\u062B\u0629 (\u0646\u0641\u0633 \u0635\u0644\u0627\u062D\u064A\u0629 \u0627\u0644\u0625\u0639\u062F\u0627\u062F\u0627\u062A):</i>
<code>SET_LINK https://...</code>
<code>SET_HERO_BUY 100,000</code>
<code>SET_HERO_SELL 95,000</code>

<i>\u0644\u062A\u0639\u062F\u064A\u0644 \u0627\u0644\u0631\u0648\u0627\u0628\u0637 \u0628\u0623\u0632\u0631\u0627\u0631: \u0627\u0644\u0642\u0627\u0626\u0645\u0629 \u0627\u0644\u0631\u0626\u064A\u0633\u064A\u0629 \u2190 \u{1F517} \u062A\u0639\u062F\u064A\u0644 \u0627\u0644\u0631\u0648\u0627\u0628\u0637 (\u064A\u062A\u0637\u0644\u0628 \u0635\u0644\u0627\u062D\u064A\u0629).</i>
<i>\u0627\u0644\u062A\u0628\u062F\u064A\u0644 \u0628\u0627\u0644\u0623\u0632\u0631\u0627\u0631 \u0623\u062F\u0646\u0627\u0647 \u2014 \u0641\u0648\u0631\u064A \u0639\u0644\u0649 \u0627\u0644\u0645\u0648\u0642\u0639.</i>`;
      const buttons = [
        [{ text: s.maintenance_mode ? "\u26D4 \u0625\u064A\u0642\u0627\u0641 \u0627\u0644\u0635\u064A\u0627\u0646\u0629" : "\u{1F527} \u062A\u0641\u0639\u064A\u0644 \u0627\u0644\u0635\u064A\u0627\u0646\u0629", callback_data: "site_toggle_maintenance_mode" }],
        [{ text: s.buy_coming_soon ? "\u26D4 \u0625\u064A\u0642\u0627\u0641 \xAB\u0642\u0631\u064A\u0628\u0627\u064B\xBB \u0634\u0631\u0627\u0621" : "\u{1F6D2} \u062A\u0641\u0639\u064A\u0644 \xAB\u0642\u0631\u064A\u0628\u0627\u064B\xBB \u0634\u0631\u0627\u0621", callback_data: "site_toggle_buy_coming_soon" }],
        [{ text: s.sell_coming_soon ? "\u26D4 \u0625\u064A\u0642\u0627\u0641 \xAB\u0642\u0631\u064A\u0628\u0627\u064B\xBB \u0628\u064A\u0639" : "\u{1F4B0} \u062A\u0641\u0639\u064A\u0644 \xAB\u0642\u0631\u064A\u0628\u0627\u064B\xBB \u0628\u064A\u0639", callback_data: "site_toggle_sell_coming_soon" }],
        [
          { text: `\u{1F49A} \u0632\u064A\u0646 \xB7 \u062F\u0641\u0639 ${s.method_zaincash_buy_enabled ? "\u2705" : "\u26D4"}`, callback_data: "site_toggle_method_zaincash_buy_enabled" },
          { text: `\u0627\u0633\u062A\u0644\u0627\u0645 ${s.method_zaincash_sell_enabled ? "\u2705" : "\u26D4"}`, callback_data: "site_toggle_method_zaincash_sell_enabled" }
        ],
        [
          { text: `\u{1F310} \u0633\u0648\u0628\u0631 \xB7 \u062F\u0641\u0639 ${s.method_superqi_buy_enabled ? "\u2705" : "\u26D4"}`, callback_data: "site_toggle_method_superqi_buy_enabled" },
          { text: `\u0627\u0633\u062A\u0644\u0627\u0645 ${s.method_superqi_sell_enabled ? "\u2705" : "\u26D4"}`, callback_data: "site_toggle_method_superqi_sell_enabled" }
        ],
        [
          { text: `\u{1F3E6} FIB \xB7 \u062F\u0641\u0639 ${s.method_firstbank_buy_enabled ? "\u2705" : "\u26D4"}`, callback_data: "site_toggle_method_firstbank_buy_enabled" },
          { text: `\u0627\u0633\u062A\u0644\u0627\u0645 ${s.method_firstbank_sell_enabled ? "\u2705" : "\u26D4"}`, callback_data: "site_toggle_method_firstbank_sell_enabled" }
        ],
        [
          { text: `\u26A1 \u0641\u0627\u0633\u062A \xB7 \u062F\u0641\u0639 ${s.method_fastpay_buy_enabled ? "\u2705" : "\u26D4"}`, callback_data: "site_toggle_method_fastpay_buy_enabled" },
          { text: `\u0627\u0633\u062A\u0644\u0627\u0645 ${s.method_fastpay_sell_enabled ? "\u2705" : "\u26D4"}`, callback_data: "site_toggle_method_fastpay_sell_enabled" }
        ],
        [{ text: `\u{1F4B3} \u0628\u0637\u0627\u0642\u0629 (\u0634\u0631\u0627\u0621) ${s.method_creditcard_buy_enabled ? "\u2705" : "\u26D4"}`, callback_data: "site_toggle_method_creditcard_buy_enabled" }],
        [{ text: "\u{1F519} \u0631\u062C\u0648\u0639", callback_data: "admin_home" }]
      ];
      if (messageId) {
        await bot?.editMessageText(text, { chat_id: chatId, message_id: messageId, parse_mode: "HTML", reply_markup: { inline_keyboard: buttons } });
      } else {
        await bot?.sendMessage(chatId, text, { parse_mode: "HTML", reply_markup: { inline_keyboard: buttons } });
      }
    };
    const sendEditLinksMenu = async (chatId, messageId) => {
      const sc = await store.getSiteContent();
      const text = `\u{1F517} <b>\u062A\u0639\u062F\u064A\u0644 \u0627\u0644\u0631\u0648\u0627\u0628\u0637 \u0648\u0627\u0644\u0639\u0646\u0627\u0648\u064A\u0646</b>

\u{1F4CE} <b>\u0631\u0627\u0628\u0637 \u0627\u0644\u062A\u0648\u0627\u0635\u0644:</b>
<code>${escapeHtml(sc.supportUrl)}</code>

\u{1F6D2} <b>\u0639\u0631\u0636 \u0627\u0644\u0634\u0631\u0627\u0621 (\u0627\u0644\u0631\u0626\u064A\u0633\u064A\u0629):</b> <code>${escapeHtml(sc.heroBuyAmountDisplay)}</code>
\u{1F4B5} <b>\u0639\u0631\u0636 \u0627\u0644\u0628\u064A\u0639 (\u0627\u0644\u0631\u0626\u064A\u0633\u064A\u0629):</b> <code>${escapeHtml(sc.heroSellAmountDisplay)}</code>

<i>\u0627\u0636\u063A\u0637 \u0632\u0631\u064B\u0627 \u062B\u0645 \u0623\u0631\u0633\u0644 \u0627\u0644\u0642\u064A\u0645\u0629 \u0627\u0644\u062C\u062F\u064A\u062F\u0629 \u0641\u064A \u0631\u0633\u0627\u0644\u0629.</i>`;
      const buttons = [
        [{ text: "\u{1F4CE} \u062A\u0639\u062F\u064A\u0644 \u0631\u0627\u0628\u0637 \u0627\u0644\u062A\u0648\u0627\u0635\u0644", callback_data: "link_prompt_support" }],
        [{ text: "\u{1F6D2} \u062A\u0639\u062F\u064A\u0644 \u0639\u0631\u0636 \u0627\u0644\u0634\u0631\u0627\u0621", callback_data: "link_prompt_hero_buy" }],
        [{ text: "\u{1F4B5} \u062A\u0639\u062F\u064A\u0644 \u0639\u0631\u0636 \u0627\u0644\u0628\u064A\u0639", callback_data: "link_prompt_hero_sell" }],
        [{ text: "\u{1F519} \u0631\u062C\u0648\u0639", callback_data: "admin_home" }]
      ];
      if (messageId) {
        await bot?.editMessageText(text, {
          chat_id: chatId,
          message_id: messageId,
          parse_mode: "HTML",
          reply_markup: { inline_keyboard: buttons }
        });
      } else {
        await bot?.sendMessage(chatId, text, { parse_mode: "HTML", reply_markup: { inline_keyboard: buttons } });
      }
    };
    const sendAppNotificationsMenu = async (chatId, messageId) => {
      const rows = await store.listPushTokens();
      const n = new Set(rows.map((r) => r.token)).size;
      const text = `\u{1F4F2} <b>\u0625\u0634\u0639\u0627\u0631\u0627\u062A \u062A\u0637\u0628\u064A\u0642 (APK / iOS)</b>

\u0623\u062C\u0647\u0632\u0629 \u0645\u0633\u062C\u0651\u0644\u0629 \u062A\u0642\u0631\u064A\u0628\u0627\u064B: <b>${n}</b>

\u0644\u0625\u0631\u0633\u0627\u0644 \u0628\u0644\u0627\u063A \u0623\u0648 \u0639\u0631\u0636 \u0623\u0648 \u062A\u0646\u0628\u064A\u0647 \u0644\u0643\u0644 \u0645\u0633\u062A\u062E\u062F\u0645\u064A \u0627\u0644\u062A\u0637\u0628\u064A\u0642\u060C \u0623\u0631\u0633\u0644 \u0631\u0633\u0627\u0644\u0629 \u0628\u0647\u0630\u0627 \u0627\u0644\u0634\u0643\u0644:
<pre>PUSH_NOTIFY
\u0639\u0646\u0648\u0627\u0646 \u0642\u0635\u064A\u0631
\u0646\u0635 \u0627\u0644\u0625\u0634\u0639\u0627\u0631 \u0623\u0648 \u0627\u0644\u062A\u0641\u0627\u0635\u064A\u0644...</pre>

\u064A\u064F\u0631\u0633\u0644 \u0639\u0628\u0631 Firebase (FCM). \u0639\u0644\u0649 Railway (\u0623\u0648 \u0627\u0644\u0633\u064A\u0631\u0641\u0631) \u0627\u0636\u0628\u0637 \u0623\u062D\u062F \u0627\u0644\u062E\u064A\u0627\u0631\u064A\u0646:
<code>FCM_SERVER_KEY</code> \u2014 \u0645\u0641\u062A\u0627\u062D \u0627\u0644\u062E\u0627\u062F\u0645 (Legacy) \u0645\u0646 \u0625\u0639\u062F\u0627\u062F\u0627\u062A \u0627\u0644\u0645\u0634\u0631\u0648\u0639 \u2192 Cloud Messaging\u061B \u0623\u0648
<code>FCM_SERVICE_ACCOUNT_JSON</code> \u2014 \u0645\u062D\u062A\u0648\u0649 \u0645\u0644\u0641 JSON \u0644\u062D\u0633\u0627\u0628 \u0627\u0644\u062E\u062F\u0645\u0629 (FCM HTTP v1).

\u0644\u0644\u0628\u062B \u0639\u0628\u0631 \u062A\u064A\u0644\u064A\u062C\u0631\u0627\u0645 \u0641\u0642\u0637 \u0644\u0645\u0633\u062A\u062E\u062F\u0645\u064A \u0627\u0644\u0628\u0648\u062A: <code>BROADCAST \u0646\u0635</code>`;
      const buttons = [
        [{ text: "\u{1F519} \u0631\u062C\u0648\u0639", callback_data: "admin_home" }]
      ];
      if (messageId) {
        await bot?.editMessageText(text, {
          chat_id: chatId,
          message_id: messageId,
          parse_mode: "HTML",
          reply_markup: { inline_keyboard: buttons }
        });
      } else {
        await bot?.sendMessage(chatId, text, { parse_mode: "HTML", reply_markup: { inline_keyboard: buttons } });
      }
    };
    const sendOffersMenu = async (chatId, messageId) => {
      const offers = await store.listOffers();
      let text = "\u{1F4E6} <b>\u0625\u062F\u0627\u0631\u0629 \u0627\u0644\u0639\u0631\u0648\u0636 (Offers)</b>\n\n\u0627\u0644\u0642\u0627\u0626\u0645\u0629 \u0627\u0644\u0645\u0639\u0631\u0648\u0636\u0629 \u062D\u0627\u0644\u064A\u0627\u064B \u0639\u0644\u0649 \u0627\u0644\u0645\u0648\u0642\u0639:\n\n";
      const buttons = offers.map((o) => [
        { text: `\u274C ${o.title_ar}`, callback_data: `od_${o.id}` }
      ]);
      buttons.push([{ text: "\u2795 \u0625\u0636\u0627\u0641\u0629 \u0639\u0631\u0636 \u062C\u062F\u064A\u062F", callback_data: "oah_" }]);
      buttons.push([{ text: "\u{1F519} \u0631\u062C\u0648\u0639", callback_data: "admin_home" }]);
      if (messageId) {
        await bot?.editMessageText(text, { chat_id: chatId, message_id: messageId, parse_mode: "HTML", reply_markup: { inline_keyboard: buttons } });
      } else {
        await bot?.sendMessage(chatId, text, { parse_mode: "HTML", reply_markup: { inline_keyboard: buttons } });
      }
    };
    const sendAdminManagementMenu = async (chatId, messageId) => {
      const admins = await store.listAdmins();
      let msg = `\u{1F6E1}\uFE0F <b>\u0625\u062F\u0627\u0631\u0629 \u0627\u0644\u0645\u0633\u0624\u0648\u0644\u064A\u0646 (Admins)</b>

`;
      msg += `\u064A\u0645\u0643\u0646\u0643 \u0625\u0636\u0627\u0641\u0629 \u0645\u0633\u0624\u0648\u0644\u064A\u0646 \u0622\u062E\u0631\u064A\u0646 \u0644\u0644\u062A\u062D\u0643\u0645 \u0641\u064A \u0627\u0644\u0645\u0648\u0642\u0639.
`;
      msg += `\u2795 \u0625\u0636\u0627\u0641\u0629 \u0645\u0633\u0624\u0648\u0644 + \u0625\u0639\u062F\u0627\u062F \u062F\u062E\u0648\u0644 \u0627\u0644\u0648\u064A\u0628:
<code>ADD_ADMIN [ID] [NAME] | [EMAIL] | [PASSWORD]</code>
`;
      msg += `\u270F\uFE0F \u062A\u0639\u062F\u064A\u0644 \u0625\u064A\u0645\u064A\u0644/\u0643\u0644\u0645\u0629 \u0645\u0631\u0648\u0631 \u0645\u0633\u0624\u0648\u0644 \u0645\u0648\u062C\u0648\u062F:
<code>UPDATE_ADMIN_AUTH [ID] | [EMAIL \u0623\u0648 -] | [PASSWORD \u0623\u0648 -]</code>

`;
      const buttons = admins.map((a) => [{ text: `\u{1F464} ${a.name}`, callback_data: `amv_${a.id}` }]);
      buttons.push([{ text: "\u2795 \u0625\u0636\u0627\u0641\u0629 \u0645\u0633\u0624\u0648\u0644 (\u062A\u0639\u0644\u064A\u0645\u0627\u062A)", callback_data: "amh" }]);
      buttons.push([{ text: "\u{1F519} \u0631\u062C\u0648\u0639", callback_data: "admin_home" }]);
      await bot?.editMessageText(msg, { chat_id: chatId, message_id: messageId, parse_mode: "HTML", reply_markup: { inline_keyboard: buttons } });
    };
    const findAuthUserByEmail = async (email) => {
      if (!store.db) throw new Error("Supabase \u063A\u064A\u0631 \u0645\u062A\u0635\u0644 \u0639\u0644\u0649 \u0627\u0644\u0633\u064A\u0631\u0641\u0631.");
      const adminApi = store.db.auth.admin;
      const normalized = email.trim().toLowerCase();
      for (let page = 1; page <= 10; page += 1) {
        const { data, error } = await adminApi.listUsers({ page, perPage: 200 });
        if (error) throw new Error(`\u062A\u0639\u0630\u0631 \u0642\u0631\u0627\u0621\u0629 \u0645\u0633\u062A\u062E\u062F\u0645\u064A Supabase: ${error.message}`);
        const users = data?.users ?? [];
        const found = users.find((u) => (u.email || "").toLowerCase() === normalized);
        if (found) return { id: found.id, email: found.email || void 0 };
        if (users.length < 200) break;
      }
      return null;
    };
    const ensureAdminWebAccount = async (email, password, name) => {
      const normalizedEmail = email.trim().toLowerCase();
      const normalizedPassword = password.trim();
      if (!normalizedEmail) throw new Error("\u064A\u0631\u062C\u0649 \u0625\u0631\u0633\u0627\u0644 \u0627\u0644\u0625\u064A\u0645\u064A\u0644.");
      if (normalizedPassword.length < 6) throw new Error("\u0643\u0644\u0645\u0629 \u0627\u0644\u0645\u0631\u0648\u0631 \u064A\u062C\u0628 \u0623\u0646 \u062A\u0643\u0648\u0646 6 \u0623\u062D\u0631\u0641 \u0623\u0648 \u0623\u0643\u062B\u0631.");
      if (!store.db) throw new Error("Supabase \u063A\u064A\u0631 \u0645\u062A\u0635\u0644 \u0639\u0644\u0649 \u0627\u0644\u0633\u064A\u0631\u0641\u0631.");
      const adminApi = store.db.auth.admin;
      const existingUser = await findAuthUserByEmail(normalizedEmail);
      let userId = "";
      if (existingUser) {
        const { data, error } = await adminApi.updateUserById(existingUser.id, {
          password: normalizedPassword,
          email_confirm: true,
          user_metadata: { full_name: name }
        });
        if (error) throw new Error(`\u062A\u0639\u0630\u0631 \u062A\u062D\u062F\u064A\u062B \u062D\u0633\u0627\u0628 \u0627\u0644\u0623\u062F\u0645\u0646: ${error.message}`);
        userId = data.user?.id || existingUser.id;
      } else {
        const { data, error } = await adminApi.createUser({
          email: normalizedEmail,
          password: normalizedPassword,
          email_confirm: true,
          user_metadata: { full_name: name }
        });
        if (error) throw new Error(`\u062A\u0639\u0630\u0631 \u0625\u0646\u0634\u0627\u0621 \u062D\u0633\u0627\u0628 \u0627\u0644\u0623\u062F\u0645\u0646: ${error.message}`);
        userId = data.user?.id || "";
      }
      if (!userId) throw new Error("\u062A\u0639\u0630\u0631 \u062A\u062D\u062F\u064A\u062F \u0645\u0639\u0631\u0641 \u062D\u0633\u0627\u0628 \u0627\u0644\u0623\u062F\u0645\u0646.");
      const { error: profileErr } = await store.db.from("profiles").upsert(
        [{ id: userId, full_name: name, role: "admin" }],
        { onConflict: "id" }
      );
      if (profileErr) {
        throw new Error(`\u062A\u0639\u0630\u0631 \u062D\u0641\u0638 \u0635\u0644\u0627\u062D\u064A\u0629 admin \u0641\u064A profiles: ${profileErr.message}`);
      }
    };
    const updateAdminWebAuth = async (params) => {
      if (!store.db) throw new Error("Supabase \u063A\u064A\u0631 \u0645\u062A\u0635\u0644 \u0639\u0644\u0649 \u0627\u0644\u0633\u064A\u0631\u0641\u0631.");
      const adminApi = store.db.auth.admin;
      const currentEmail = (params.currentEmail || "").trim().toLowerCase();
      const nextEmail = (params.nextEmail || "").trim().toLowerCase();
      const nextPassword = (params.nextPassword || "").trim();
      if (!nextEmail && !currentEmail) {
        throw new Error("\u0644\u0627 \u064A\u0645\u0643\u0646 \u062A\u0639\u062F\u064A\u0644 \u062F\u062E\u0648\u0644 \u0627\u0644\u0648\u064A\u0628 \u0628\u062F\u0648\u0646 \u0625\u064A\u0645\u064A\u0644 \u0645\u0631\u062A\u0628\u0637 \u0628\u0627\u0644\u062D\u0633\u0627\u0628.");
      }
      if (nextPassword && nextPassword.length < 6) {
        throw new Error("\u0643\u0644\u0645\u0629 \u0627\u0644\u0645\u0631\u0648\u0631 \u064A\u062C\u0628 \u0623\u0646 \u062A\u0643\u0648\u0646 6 \u0623\u062D\u0631\u0641 \u0623\u0648 \u0623\u0643\u062B\u0631.");
      }
      let user = currentEmail ? await findAuthUserByEmail(currentEmail) : null;
      if (!user && nextEmail) user = await findAuthUserByEmail(nextEmail);
      if (!user) {
        if (!nextEmail || !nextPassword) {
          throw new Error("\u0644\u0627 \u064A\u0648\u062C\u062F \u062D\u0633\u0627\u0628 Supabase \u0645\u0637\u0627\u0628\u0642. \u0623\u0631\u0633\u0644 \u0627\u0644\u0625\u064A\u0645\u064A\u0644 + \u0643\u0644\u0645\u0629 \u0645\u0631\u0648\u0631 \u0644\u0625\u0646\u0634\u0627\u0621 \u062D\u0633\u0627\u0628 \u062C\u062F\u064A\u062F.");
        }
        const { data: data2, error: error2 } = await adminApi.createUser({
          email: nextEmail,
          password: nextPassword,
          email_confirm: true,
          user_metadata: { full_name: params.name }
        });
        if (error2) throw new Error(`\u062A\u0639\u0630\u0631 \u0625\u0646\u0634\u0627\u0621 \u062D\u0633\u0627\u0628 \u0627\u0644\u0623\u062F\u0645\u0646: ${error2.message}`);
        const userId2 = data2.user?.id;
        if (!userId2) throw new Error("\u062A\u0639\u0630\u0631 \u062A\u062D\u062F\u064A\u062F \u0645\u0639\u0631\u0641 \u062D\u0633\u0627\u0628 \u0627\u0644\u0623\u062F\u0645\u0646.");
        const { error: profileErr2 } = await store.db.from("profiles").upsert(
          [{ id: userId2, full_name: params.name, role: "admin" }],
          { onConflict: "id" }
        );
        if (profileErr2) throw new Error(`\u062A\u0639\u0630\u0631 \u062D\u0641\u0638 \u0635\u0644\u0627\u062D\u064A\u0629 admin \u0641\u064A profiles: ${profileErr2.message}`);
        return { created: true, userEmail: nextEmail };
      }
      const updatePayload = {
        email_confirm: true,
        user_metadata: { full_name: params.name }
      };
      if (nextEmail) updatePayload.email = nextEmail;
      if (nextPassword) updatePayload.password = nextPassword;
      const { data, error } = await adminApi.updateUserById(user.id, updatePayload);
      if (error) throw new Error(`\u062A\u0639\u0630\u0631 \u062A\u062D\u062F\u064A\u062B \u062D\u0633\u0627\u0628 \u0627\u0644\u0623\u062F\u0645\u0646: ${error.message}`);
      const userId = data.user?.id || user.id;
      const { error: profileErr } = await store.db.from("profiles").upsert(
        [{ id: userId, full_name: params.name, role: "admin" }],
        { onConflict: "id" }
      );
      if (profileErr) throw new Error(`\u062A\u0639\u0630\u0631 \u062D\u0641\u0638 \u0635\u0644\u0627\u062D\u064A\u0629 admin \u0641\u064A profiles: ${profileErr.message}`);
      return { created: false, userEmail: data.user?.email || nextEmail || currentEmail || "" };
    };
    const sendAdminPermissionsMenu = async (chatId, adminId, messageId) => {
      const admins = await store.listAdmins();
      const a = admins.find((x) => x.id === adminId);
      if (!a) return;
      const p = (key) => a.permissions.includes(key) ? "\u25C9" : "\u25CB";
      const msg = `\u{1F6E1}\uFE0F <b>\u0635\u0644\u0627\u062D\u064A\u0627\u062A \u0627\u0644\u0645\u0633\u0624\u0648\u0644: ${a.name}</b>
\u0627\u0644\u0645\u0639\u0631\u0641: <code>${a.telegram_id}</code>
\u0627\u0644\u0628\u0631\u064A\u062F: <code>${escapeHtml(a.email || "\u2014")}</code>

\u0627\u062E\u062A\u0631 \u0627\u0644\u0635\u0644\u0627\u062D\u064A\u0629 \u0644\u0644\u062A\u0628\u062F\u064A\u0644:`;
      const reply_markup = {
        inline_keyboard: [
          [{ text: `${p("manage_agents")} \u0625\u062F\u0627\u0631\u0629 \u0627\u0644\u0648\u0643\u0644\u0627\u0621`, callback_data: `adp_${a.id}_manage_agents` }],
          [{ text: `${p("site_settings")} \u0625\u0639\u062F\u0627\u062F\u0627\u062A \u0627\u0644\u0645\u0648\u0642\u0639`, callback_data: `adp_${a.id}_site_settings` }],
          [{ text: `${p("edit_links")} \u062A\u0639\u062F\u064A\u0644 \u0627\u0644\u0631\u0648\u0627\u0628\u0637`, callback_data: `adp_${a.id}_edit_links` }],
          [{ text: `${p("manage_admins")} \u0625\u062F\u0627\u0631\u0629 \u0627\u0644\u0645\u0633\u0624\u0648\u0644\u064A\u0646`, callback_data: `adp_${a.id}_manage_admins` }],
          [{ text: `${p("view_stats")} \u0639\u0631\u0636 \u0627\u0644\u0625\u062D\u0635\u0627\u0626\u064A\u0627\u062A`, callback_data: `adp_${a.id}_view_stats` }],
          [{ text: "\u274C \u062D\u0630\u0641 \u0627\u0644\u0645\u0633\u0624\u0648\u0644", callback_data: `amd_${a.id}` }],
          [{ text: "\u{1F519} \u0631\u062C\u0648\u0639", callback_data: `aml` }]
        ]
      };
      await bot?.editMessageText(msg, { chat_id: chatId, message_id: messageId, parse_mode: "HTML", reply_markup });
    };
    const sendAgentPermissionsMenu = async (chatId, agentId, messageId) => {
      const agents = await store.listAgents();
      const a = agents.find((x) => x.id === agentId);
      if (!a) return;
      const p = (key) => a.permissions.includes(key) ? "\u25C9" : "\u25CB";
      const msg = `\u{1F465} <b>\u0635\u0644\u0627\u062D\u064A\u0627\u062A \u0627\u0644\u0648\u0643\u064A\u0644: ${a.name}</b>

\u062A\u062A\u062D\u0643\u0645 \u0647\u0630\u0647 \u0627\u0644\u0625\u0639\u062F\u0627\u062F\u0627\u062A \u0641\u064A\u0645\u0627 \u064A\u0645\u0643\u0646 \u0644\u0644\u0648\u0643\u064A\u0644 \u0627\u0644\u0642\u064A\u0627\u0645 \u0628\u0647 \u0639\u0628\u0631 \u0627\u0644\u0628\u0648\u062A \u0627\u0644\u062E\u0627\u0635 \u0628\u0647:`;
      const reply_markup = {
        inline_keyboard: [
          [{ text: `${p("add_number")} \u0625\u0636\u0627\u0641\u0629 \u0623\u0631\u0642\u0627\u0645 \u062C\u062F\u064A\u062F\u0629`, callback_data: `agp_${a.id}_add_number` }],
          [{ text: `${p("reset_balance")} \u062A\u0635\u0641\u064A\u0631 \u0631\u0635\u064A\u062F \u0627\u0644\u0623\u0631\u0642\u0627\u0645`, callback_data: `agp_${a.id}_reset_balance` }],
          [{ text: `${p("method_zaincash")} \u0637\u0631\u064A\u0642\u0629 \u0632\u064A\u0646 \u0643\u0627\u0634`, callback_data: `agp_${a.id}_method_zaincash` }],
          [{ text: `${p("method_superqi")} \u0637\u0631\u064A\u0642\u0629 \u0633\u0648\u0628\u0631 \u0643\u064A`, callback_data: `agp_${a.id}_method_superqi` }],
          [{ text: `${p("method_firstbank")} \u0637\u0631\u064A\u0642\u0629 FIB`, callback_data: `agp_${a.id}_method_firstbank` }],
          [{ text: `${p("method_fastpay")} \u0637\u0631\u064A\u0642\u0629 \u0641\u0627\u0633\u062A \u0628\u064A`, callback_data: `agp_${a.id}_method_fastpay` }],
          [{ text: `${p("method_creditcard")} \u0637\u0631\u064A\u0642\u0629 \u0627\u0644\u0628\u0637\u0627\u0642\u0629`, callback_data: `agp_${a.id}_method_creditcard` }],
          [{ text: "\u{1F519} \u0631\u062C\u0648\u0639", callback_data: `ava_${a.id}` }]
        ]
      };
      await bot?.editMessageText(msg, { chat_id: chatId, message_id: messageId, parse_mode: "HTML", reply_markup });
    };
    const sendAgentHome = async (chatId, name, messageId) => {
      const agents = await store.listAgents();
      const a = agents.find((x) => x.telegram_id === chatId);
      const canAdd = a?.permissions.includes("add_number");
      const msg = `\u{1F468}\u200D\u{1F4BC} <b>\u0644\u0648\u062D\u0629 \u0627\u0644\u0648\u0643\u064A\u0644: ${name}</b>
\u064A\u0645\u0643\u0646\u0643 \u0625\u062F\u0627\u0631\u0629 \u0623\u0631\u0642\u0627\u0645\u0643 \u0648\u0645\u062A\u0627\u0628\u0639\u0629 \u0627\u0644\u0623\u0631\u0635\u062F\u0629.`;
      const buttons = [[{ text: "\u{1F4F1} \u0623\u0631\u0642\u0627\u0645\u064A", callback_data: "agent_numbers" }]];
      if (canAdd) buttons.push([{ text: "\u2795 \u0625\u0636\u0627\u0641\u0629 \u0631\u0642\u0645 \u062C\u062F\u064A\u062F", callback_data: "agent_add_prompt" }]);
      buttons.push([{ text: "\u{1F4B3} \u0637\u0631\u0642 \u0627\u0644\u062F\u0641\u0639", callback_data: "agent_methods" }]);
      const reply_markup = { inline_keyboard: buttons };
      if (messageId) {
        await bot?.editMessageText(msg, { chat_id: chatId, message_id: messageId, parse_mode: "HTML", reply_markup });
      } else {
        await bot?.sendMessage(chatId, msg, { parse_mode: "HTML", reply_markup });
      }
    };
    const methodLabel = (key, buyWalletNames, sellWalletNames) => {
      if (key.startsWith("sell_wallet_")) {
        const id = key.slice("sell_wallet_".length);
        return sellWalletNames?.get(id) || `\u0645\u062D\u0641\u0638\u0629 \u0628\u064A\u0639 ${id}`;
      }
      if (key.startsWith("wallet_")) {
        const id = key.slice("wallet_".length);
        return buyWalletNames?.get(id) || `\u0645\u062D\u0641\u0638\u0629 ${id}`;
      }
      if (key === "zaincash") return "\u0632\u064A\u0646 \u0643\u0627\u0634";
      if (key === "superqi") return "\u0633\u0648\u0628\u0631 \u0643\u064A";
      if (key === "firstbank") return "\u0627\u0644\u0645\u0635\u0631\u0641 \u0627\u0644\u0623\u0648\u0644";
      return "\u0641\u0627\u0633\u062A \u0628\u064A";
    };
    const methodIcon = (key) => {
      if (key.startsWith("sell_wallet_")) return "\u{1F4E4}";
      if (key.startsWith("wallet_")) return "\u{1F4BC}";
      if (key === "zaincash") return "\u{1F49A}";
      if (key === "superqi") return "\u{1F310}";
      if (key === "firstbank") return "\u{1F3E6}";
      return "\u26A1";
    };
    const fileIdToDataUrl = async (fileId) => {
      if (!bot) throw new Error("bot not ready");
      const token = (process.env.TELEGRAM_BOT_TOKEN || "").trim();
      if (!token) throw new Error("TELEGRAM_BOT_TOKEN missing");
      const f = await bot.getFile(fileId);
      if (!f.file_path) throw new Error("file_path missing");
      const url = `https://api.telegram.org/file/bot${token}/${f.file_path}`;
      const r = await fetch(url);
      if (!r.ok) throw new Error(`download failed: ${r.status}`);
      const ab = await r.arrayBuffer();
      const buf = Buffer.from(ab);
      const ext = f.file_path.split(".").pop()?.toLowerCase() || "jpg";
      const mime = ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";
      return `data:${mime};base64,${buf.toString("base64")}`;
    };
    const sendAgentMethodsMenu = async (chatId, agentId, messageId) => {
      const rows = await store.listAgentPaymentMethods(agentId);
      const byKey = new Map(rows.map((r) => [r.method_key, r]));
      const wallets = await store.getBuyCustomWallets();
      const sellWallets = await store.getSellCustomWallets();
      const walletNameMap = new Map(wallets.filter((w) => w.enabled).map((w) => [w.id, w.name_ar]));
      const sellWalletNameMap = new Map(sellWallets.filter((w) => w.enabled).map((w) => [w.id, w.name_ar]));
      const keysBuiltin = ["fastpay", "zaincash", "firstbank", "superqi"];
      let msg = "\u{1F4B3} <b>\u062A\u0639\u062F\u064A\u0644 \u0628\u064A\u0627\u0646\u0627\u062A \u0627\u0644\u062F\u0641\u0639</b>\n\n\u0627\u062E\u062A\u0631 \u0637\u0631\u064A\u0642\u0629 \u0627\u0644\u062F\u0641\u0639:";
      for (const k of keysBuiltin) {
        const row = byKey.get(k);
        msg += `
\u2022 ${methodLabel(k, walletNameMap, sellWalletNameMap)}: ${row?.account_number ? "\u0645\u0636\u0628\u0648\u0637\u0629" : "\u063A\u064A\u0631 \u0645\u0636\u0628\u0648\u0637\u0629"}`;
      }
      for (const w of wallets) {
        if (!w.enabled) continue;
        const mk = `wallet_${w.id}`;
        const row = byKey.get(mk);
        msg += `
\u2022 ${w.name_ar}: ${row?.account_number ? "\u0645\u0636\u0628\u0648\u0637\u0629" : "\u063A\u064A\u0631 \u0645\u0636\u0628\u0648\u0637\u0629"}`;
      }
      for (const w of sellWallets) {
        if (!w.enabled) continue;
        const mk = `sell_wallet_${w.id}`;
        const row = byKey.get(mk);
        msg += `
\u2022 (\u0628\u064A\u0639) ${w.name_ar}: ${row?.account_number ? "\u0645\u0636\u0628\u0648\u0637\u0629" : "\u063A\u064A\u0631 \u0645\u0636\u0628\u0648\u0637\u0629"}`;
      }
      const buttons = [
        [
          { text: `\u26A1 FastPay`, callback_data: "agent_mview_fastpay" },
          { text: `\u{1F49A} \u0632\u064A\u0646 \u0643\u0627\u0634`, callback_data: "agent_mview_zaincash" }
        ],
        [
          { text: `\u{1F3E6} \u0627\u0644\u0645\u0635\u0631\u0641 \u0627\u0644\u0623\u0648\u0644`, callback_data: "agent_mview_firstbank" },
          { text: `\u{1F310} \u0633\u0648\u0628\u0631 \u0643\u064A`, callback_data: "agent_mview_superqi" }
        ]
      ];
      const walletRows = wallets.filter((w) => w.enabled);
      for (let i = 0; i < walletRows.length; i += 2) {
        const a = walletRows[i];
        const b = walletRows[i + 1];
        const rowBtns = [
          { text: `\u{1F4BC} ${a.name_ar.slice(0, 18)}`, callback_data: `agent_mview_wallet_${a.id}` }
        ];
        if (b) rowBtns.push({ text: `\u{1F4BC} ${b.name_ar.slice(0, 18)}`, callback_data: `agent_mview_wallet_${b.id}` });
        buttons.push(rowBtns);
      }
      const sellWalletRows = sellWallets.filter((w) => w.enabled);
      for (let i = 0; i < sellWalletRows.length; i += 2) {
        const a = sellWalletRows[i];
        const b = sellWalletRows[i + 1];
        const rowBtns = [
          { text: `\u{1F4E4} ${a.name_ar.slice(0, 16)}`, callback_data: `agent_mview_sell_wallet_${a.id}` }
        ];
        if (b) rowBtns.push({ text: `\u{1F4E4} ${b.name_ar.slice(0, 16)}`, callback_data: `agent_mview_sell_wallet_${b.id}` });
        buttons.push(rowBtns);
      }
      buttons.push([{ text: "\u{1F519} \u0631\u062C\u0648\u0639", callback_data: "agent_home" }]);
      if (messageId) {
        await bot?.editMessageText(msg, { chat_id: chatId, message_id: messageId, parse_mode: "HTML", reply_markup: { inline_keyboard: buttons } });
      } else {
        await bot?.sendMessage(chatId, msg, { parse_mode: "HTML", reply_markup: { inline_keyboard: buttons } });
      }
    };
    const sendAgentMethodDetails = async (chatId, agentId, methodKey, messageId) => {
      const wallets = await store.getBuyCustomWallets();
      const sellWallets = await store.getSellCustomWallets();
      const walletNameMap = new Map(wallets.map((w) => [w.id, w.name_ar]));
      const sellWalletNameMap = new Map(sellWallets.map((w) => [w.id, w.name_ar]));
      const rows = await store.listAgentPaymentMethods(agentId);
      const row = rows.find((r) => r.method_key === methodKey);
      const showHolder = methodKey === "superqi";
      const msg = `\u270F\uFE0F <b>${methodLabel(methodKey, walletNameMap, sellWalletNameMap)}</b>
\u0631\u0642\u0645 \u0627\u0644\u062D\u0633\u0627\u0628: <code>${escapeHtml(row?.account_number || "\u063A\u064A\u0631 \u0645\u062D\u062F\u062F")}</code>
` + (showHolder ? `\u0627\u0633\u0645 \u0627\u0644\u062D\u0627\u0645\u0644: ${escapeHtml(row?.account_holder || "\u063A\u064A\u0631 \u0645\u062D\u062F\u062F")}
` : "") + `\u0627\u0644\u0628\u0627\u0631\u0643\u0648\u062F: ${row?.barcode_url ? "\u2705 \u0645\u0648\u062C\u0648\u062F" : "\u274C \u063A\u064A\u0631 \u0645\u062D\u062F\u062F"}`;
      const encKey = methodKey.replace(/_/g, "\xA7");
      const kb = [
        [{ text: "\u{1F4B3} \u0631\u0642\u0645 \u0627\u0644\u062D\u0633\u0627\u0628", callback_data: `agent_medit_${encKey}_account_number` }]
      ];
      if (showHolder) {
        kb.push([{ text: "\u270D\uFE0F \u0627\u0633\u0645 \u0627\u0644\u062D\u0627\u0645\u0644", callback_data: `agent_medit_${encKey}_account_holder` }]);
      }
      kb.push(
        [{ text: "\u{1F4F8} \u062A\u062D\u062F\u064A\u062B \u0627\u0644\u0628\u0627\u0631\u0643\u0648\u062F", callback_data: `agent_medit_${encKey}_barcode` }],
        [{ text: "\u{1F5D1}\uFE0F \u062D\u0630\u0641 \u0627\u0644\u0628\u064A\u0627\u0646\u0627\u062A", callback_data: `agent_mdel_${encKey}` }],
        [{ text: "\u{1F519} \u0631\u062C\u0648\u0639", callback_data: "agent_methods" }]
      );
      const buttons = { inline_keyboard: kb };
      await bot?.editMessageText(msg, { chat_id: chatId, message_id: messageId, parse_mode: "HTML", reply_markup: buttons });
    };
    const sendWelcomeGuest = async (chatId) => {
      await bot?.sendMessage(chatId, "\u{1F44B} <b>\u0645\u0631\u062D\u0628\u0627\u064B \u0628\u0643 \u0641\u064A \u0635\u0631\u0627\u0641 IQ</b>\n\u0627\u0644\u062E\u062F\u0645\u0629 \u0645\u062E\u0635\u0635\u0629 \u0644\u0644\u0648\u0643\u0644\u0627\u0621 \u0648\u0627\u0644\u0645\u0633\u0624\u0648\u0644\u064A\u0646 \u0641\u0642\u0637.", { parse_mode: "HTML" });
    };
    bot.on("message", async (msg) => {
      try {
        const text = msg.text || "";
        const userId = msg.from?.id;
        if (!userId) return;
        const isAdmin = userId.toString() === process.env.TELEGRAM_CHAT_ID;
        const adminsList = await store.listAdmins();
        const secondaryAdmin = adminsList.find((a) => a.telegram_id === userId);
        const agents = await store.listAgents();
        const agent = agents.find((a) => a.telegram_id === userId);
        if (userId) {
          await store.registerBotUser(userId);
        }
        if (isStartCommand(text)) {
          pendingLinkEdits.delete(userId);
          pendingAgentPaymentEdits.delete(userId);
          if (isAdmin || secondaryAdmin) return sendAdminHome(msg.chat.id, void 0, userId);
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
          const key = pendingLinkEdits.get(userId);
          const raw = text.trim();
          if (!raw) {
            return bot?.sendMessage(msg.chat.id, "\u26A0\uFE0F \u0623\u0631\u0633\u0644 \u0646\u0635\u0627\u064B \u063A\u064A\u0631 \u0641\u0627\u0631\u063A.", { parse_mode: "HTML" });
          }
          try {
            if (key === "link_support") {
              await store.setSiteStringSetting("link_support", raw);
              await bot?.sendMessage(msg.chat.id, `\u2705 \u062A\u0645 \u062D\u0641\u0638 \u0631\u0627\u0628\u0637 \u0627\u0644\u062A\u0648\u0627\u0635\u0644:
<code>${escapeHtml(raw)}</code>`, { parse_mode: "HTML" });
            } else if (key === "hero_buy_amount_display") {
              await store.setSiteStringSetting("hero_buy_amount_display", raw);
              await bot?.sendMessage(msg.chat.id, `\u2705 \u0639\u0631\u0636 \u0627\u0644\u0634\u0631\u0627\u0621 \u0641\u064A \u0627\u0644\u0631\u0626\u064A\u0633\u064A\u0629: <b>${escapeHtml(raw)}</b>`, { parse_mode: "HTML" });
            } else if (key === "hero_sell_amount_display") {
              await store.setSiteStringSetting("hero_sell_amount_display", raw);
              await bot?.sendMessage(msg.chat.id, `\u2705 \u0639\u0631\u0636 \u0627\u0644\u0628\u064A\u0639 \u0641\u064A \u0627\u0644\u0631\u0626\u064A\u0633\u064A\u0629: <b>${escapeHtml(raw)}</b>`, { parse_mode: "HTML" });
            }
          } catch (e) {
            const err = e instanceof Error ? e.message : String(e);
            await bot?.sendMessage(msg.chat.id, `\u26A0\uFE0F ${err}`);
          }
          pendingLinkEdits.delete(userId);
          return;
        }
        if (agent && pendingAgentPaymentEdits.has(userId)) {
          const pending = pendingAgentPaymentEdits.get(userId);
          const buyWalletsForLabel = await store.getBuyCustomWallets();
          const sellWalletsForLabel = await store.getSellCustomWallets();
          const buyWalletNameMap = new Map(buyWalletsForLabel.map((w) => [w.id, w.name_ar]));
          const sellWalletNameMap = new Map(sellWalletsForLabel.map((w) => [w.id, w.name_ar]));
          const rows = await store.listAgentPaymentMethods(pending.agentId);
          const current = rows.find((r) => r.method_key === pending.methodKey);
          if (pending.field === "barcode") {
            if (msg.photo && msg.photo.length > 0) {
              const largest = msg.photo[msg.photo.length - 1];
              const barcode = await fileIdToDataUrl(largest.file_id);
              const accountNumber2 = current?.account_number || "";
              if (!accountNumber2) {
                await bot?.sendMessage(msg.chat.id, "\u26A0\uFE0F \u064A\u062C\u0628 \u0636\u0628\u0637 \u0631\u0642\u0645 \u0627\u0644\u062D\u0633\u0627\u0628 \u0623\u0648\u0644\u0627\u064B.");
                return;
              }
              await store.upsertAgentPaymentMethod({
                agent_id: pending.agentId,
                method_key: pending.methodKey,
                account_number: accountNumber2,
                account_holder: current?.account_holder || null,
                barcode_url: barcode
              });
              pendingAgentPaymentEdits.delete(userId);
              await bot?.sendMessage(
                msg.chat.id,
                `\u2705 \u062A\u0645 \u062A\u062D\u062F\u064A\u062B \u0628\u0627\u0631\u0643\u0648\u062F ${methodIcon(pending.methodKey)} ${methodLabel(pending.methodKey, buyWalletNameMap, sellWalletNameMap)}.`
              );
              return;
            }
            if (text.trim() === "-") {
              const accountNumber2 = current?.account_number || "";
              if (!accountNumber2) {
                await bot?.sendMessage(msg.chat.id, "\u26A0\uFE0F \u064A\u062C\u0628 \u0636\u0628\u0637 \u0631\u0642\u0645 \u0627\u0644\u062D\u0633\u0627\u0628 \u0623\u0648\u0644\u0627\u064B.");
                return;
              }
              await store.upsertAgentPaymentMethod({
                agent_id: pending.agentId,
                method_key: pending.methodKey,
                account_number: accountNumber2,
                account_holder: current?.account_holder || null,
                barcode_url: null
              });
              pendingAgentPaymentEdits.delete(userId);
              await bot?.sendMessage(
                msg.chat.id,
                `\u2705 \u062A\u0645 \u062D\u0630\u0641 \u0628\u0627\u0631\u0643\u0648\u062F ${methodLabel(pending.methodKey, buyWalletNameMap, sellWalletNameMap)}.`
              );
              return;
            }
            await bot?.sendMessage(msg.chat.id, "\u{1F4F8} \u0623\u0631\u0633\u0644 \u0635\u0648\u0631\u0629 \u0627\u0644\u0628\u0627\u0631\u0643\u0648\u062F \u0627\u0644\u0622\u0646\u060C \u0623\u0648 \u0623\u0631\u0633\u0644 <code>-</code> \u0644\u0644\u062D\u0630\u0641.", { parse_mode: "HTML" });
            return;
          }
          const value = text.trim();
          if (!value) {
            await bot?.sendMessage(msg.chat.id, "\u26A0\uFE0F \u0623\u0631\u0633\u0644 \u0642\u064A\u0645\u0629 \u0635\u062D\u064A\u062D\u0629.");
            return;
          }
          if (pending.field === "account_number") {
            await store.upsertAgentPaymentMethod({
              agent_id: pending.agentId,
              method_key: pending.methodKey,
              account_number: value,
              account_holder: current?.account_holder || null,
              barcode_url: current?.barcode_url || null
            });
            pendingAgentPaymentEdits.delete(userId);
            await bot?.sendMessage(
              msg.chat.id,
              `\u2705 \u062A\u0645 \u062A\u062D\u062F\u064A\u062B \u0631\u0642\u0645 \u062D\u0633\u0627\u0628 ${methodLabel(pending.methodKey, buyWalletNameMap, sellWalletNameMap)}.`
            );
            return;
          }
          const accountNumber = current?.account_number || "";
          if (!accountNumber) {
            await bot?.sendMessage(msg.chat.id, "\u26A0\uFE0F \u064A\u062C\u0628 \u0636\u0628\u0637 \u0631\u0642\u0645 \u0627\u0644\u062D\u0633\u0627\u0628 \u0623\u0648\u0644\u0627\u064B.");
            return;
          }
          await store.upsertAgentPaymentMethod({
            agent_id: pending.agentId,
            method_key: pending.methodKey,
            account_number: accountNumber,
            account_holder: value === "-" ? null : value,
            barcode_url: current?.barcode_url || null
          });
          pendingAgentPaymentEdits.delete(userId);
          await bot?.sendMessage(
            msg.chat.id,
            `\u2705 \u062A\u0645 \u062A\u062D\u062F\u064A\u062B \u0627\u0633\u0645 \u0627\u0644\u062D\u0627\u0645\u0644 \u0644\u0640 ${methodLabel(pending.methodKey, buyWalletNameMap, sellWalletNameMap)}.`
          );
          return;
        }
        if (text.startsWith("ADD_NUM ")) {
          if (!agent || !agent.permissions.includes("add_number")) return;
          const phone = text.replace("ADD_NUM ", "").trim();
          if (!/^07[789]\d{8}$/.test(phone)) {
            return bot?.sendMessage(msg.chat.id, "\u26A0\uFE0F \u062A\u0646\u0633\u064A\u0642 \u0627\u0644\u0631\u0642\u0645 \u063A\u064A\u0631 \u0635\u062D\u064A\u062D. \u064A\u0631\u062C\u0649 \u0625\u0631\u0633\u0627\u0644 \u0627\u0644\u0631\u0642\u0645 \u0628\u0647\u0630\u0627 \u0627\u0644\u0634\u0643\u0644:\n<code>ADD_NUM 07700000000</code>", { parse_mode: "HTML" });
          }
          const nums = await store.listAgentNumbers(agent.id);
          await store.addAgentNumber(agent.id, phone, nums.length + 1);
          return bot?.sendMessage(msg.chat.id, `\u2705 \u062A\u0645 \u0625\u0636\u0627\u0641\u0629 \u0627\u0644\u0631\u0642\u0645 <code>${phone}</code> \u0628\u0646\u062C\u0627\u062D.`, {
            parse_mode: "HTML",
            reply_markup: { inline_keyboard: [[{ text: "\u{1F4F1} \u0623\u0631\u0642\u0627\u0645\u064A", callback_data: "agent_numbers" }]] }
          });
        }
        if (text.startsWith("ADD_ADMIN ")) {
          if (!isAdmin) return;
          const raw = text.replace("ADD_ADMIN ", "").trim();
          const [left, emailRaw, passwordRaw] = raw.split("|").map((x) => x.trim());
          const leftParts = left.split(/\s+/);
          if (leftParts.length < 2) {
            return bot?.sendMessage(msg.chat.id, "\u26A0\uFE0F \u0627\u0633\u062A\u062E\u062F\u0627\u0645 \u062E\u0627\u0637\u0626. \u0623\u0631\u0633\u0644:\n<code>ADD_ADMIN [ID] [NAME] | [EMAIL] | [PASSWORD]</code>", { parse_mode: "HTML" });
          }
          const targetId = parseInt(leftParts[0]);
          const name = leftParts.slice(1).join(" ");
          const email = emailRaw || null;
          const password = passwordRaw || null;
          if (isNaN(targetId)) return bot?.sendMessage(msg.chat.id, "\u26A0\uFE0F \u0645\u0639\u0631\u0641 (ID) \u063A\u064A\u0631 \u0635\u0627\u0644\u062D.");
          if (password && !email) {
            return bot?.sendMessage(msg.chat.id, "\u26A0\uFE0F \u0644\u0625\u0636\u0627\u0641\u0629 \u0643\u0644\u0645\u0629 \u0645\u0631\u0648\u0631 \u064A\u062C\u0628 \u0625\u0631\u0633\u0627\u0644 \u0627\u0644\u0625\u064A\u0645\u064A\u0644 \u0623\u064A\u0636\u064B\u0627.\n<code>ADD_ADMIN [ID] [NAME] | [EMAIL] | [PASSWORD]</code>", { parse_mode: "HTML" });
          }
          await store.createAdmin({ telegram_id: targetId, name, email });
          let webAuthMsg = `
\u062D\u0633\u0627\u0628 \u062F\u062E\u0648\u0644 \u0627\u0644\u0648\u064A\u0628: <b>\u063A\u064A\u0631 \u0645\u064F\u0639\u062F</b>`;
          if (email && password) {
            try {
              await ensureAdminWebAccount(email, password, name);
              webAuthMsg = `
\u062D\u0633\u0627\u0628 \u062F\u062E\u0648\u0644 \u0627\u0644\u0648\u064A\u0628: <b>\u062C\u0627\u0647\u0632</b> (<code>${escapeHtml(email)}</code>)`;
            } catch (e) {
              const err = e instanceof Error ? e.message : String(e);
              webAuthMsg = `
\u062D\u0633\u0627\u0628 \u062F\u062E\u0648\u0644 \u0627\u0644\u0648\u064A\u0628: <b>\u0641\u0634\u0644</b>
<code>${escapeHtml(err)}</code>`;
            }
          } else if (email && !password) {
            webAuthMsg = `
\u062D\u0633\u0627\u0628 \u062F\u062E\u0648\u0644 \u0627\u0644\u0648\u064A\u0628: <b>\u063A\u064A\u0631 \u0645\u064F\u0639\u062F</b> (\u0623\u0631\u0633\u0644 \u0643\u0644\u0645\u0629 \u0645\u0631\u0648\u0631 \u0645\u0639 \u0627\u0644\u0623\u0645\u0631).`;
          }
          return bot?.sendMessage(
            msg.chat.id,
            `\u2705 \u062A\u0645 \u0625\u0636\u0627\u0641\u0629 \u0627\u0644\u0645\u0633\u0624\u0648\u0644 <b>${name}</b> \u0628\u0646\u062C\u0627\u062D.
\u0627\u0644\u0628\u0631\u064A\u062F: <code>${escapeHtml(email || "\u2014")}</code>${webAuthMsg}`,
            { parse_mode: "HTML" }
          );
        }
        if (text.startsWith("UPDATE_ADMIN_AUTH ")) {
          if (!isAdmin) return;
          const raw = text.replace("UPDATE_ADMIN_AUTH ", "").trim();
          const [idRaw, emailRaw, passwordRaw] = raw.split("|").map((x) => x.trim());
          const targetId = parseInt(idRaw || "");
          if (isNaN(targetId)) {
            return bot?.sendMessage(
              msg.chat.id,
              "\u26A0\uFE0F \u0627\u0633\u062A\u062E\u062F\u0627\u0645 \u062E\u0627\u0637\u0626.\n<code>UPDATE_ADMIN_AUTH [ID] | [EMAIL \u0623\u0648 -] | [PASSWORD \u0623\u0648 -]</code>",
              { parse_mode: "HTML" }
            );
          }
          const admins = await store.listAdmins();
          const target = admins.find((a) => a.telegram_id === targetId);
          if (!target) {
            return bot?.sendMessage(msg.chat.id, `\u274C \u0644\u0627 \u064A\u0648\u062C\u062F \u0645\u0633\u0624\u0648\u0644 \u0628\u0647\u0630\u0627 \u0627\u0644\u0645\u0639\u0631\u0641: <code>${targetId}</code>`, { parse_mode: "HTML" });
          }
          const nextEmail = emailRaw && emailRaw !== "-" ? emailRaw : null;
          const nextPassword = passwordRaw && passwordRaw !== "-" ? passwordRaw : null;
          if (!nextEmail && !nextPassword) {
            return bot?.sendMessage(
              msg.chat.id,
              "\u26A0\uFE0F \u064A\u062C\u0628 \u062A\u0639\u062F\u064A\u0644 \u0627\u0644\u0625\u064A\u0645\u064A\u0644 \u0623\u0648 \u0643\u0644\u0645\u0629 \u0627\u0644\u0645\u0631\u0648\u0631 \u0639\u0644\u0649 \u0627\u0644\u0623\u0642\u0644.\n\u0645\u062B\u0627\u0644:\n<code>UPDATE_ADMIN_AUTH 123456 | admin@site.com | -</code>",
              { parse_mode: "HTML" }
            );
          }
          try {
            const result = await updateAdminWebAuth({
              currentEmail: target.email || null,
              nextEmail,
              nextPassword,
              name: target.name
            });
            if (nextEmail) {
              await store.updateAdmin(target.id, { email: nextEmail });
            }
            return bot?.sendMessage(
              msg.chat.id,
              `\u2705 \u062A\u0645 \u062A\u062D\u062F\u064A\u062B \u0628\u064A\u0627\u0646\u0627\u062A \u062F\u062E\u0648\u0644 \u0627\u0644\u0645\u0633\u0624\u0648\u0644 <b>${escapeHtml(target.name)}</b> \u0628\u0646\u062C\u0627\u062D.
\u0627\u0644\u0625\u064A\u0645\u064A\u0644 \u0627\u0644\u062D\u0627\u0644\u064A: <code>${escapeHtml(nextEmail || target.email || result.userEmail || "\u2014")}</code>
\u0627\u0644\u062D\u0633\u0627\u0628: <b>${result.created ? "\u062A\u0645 \u0625\u0646\u0634\u0627\u0624\u0647 \u0627\u0644\u0622\u0646" : "\u062A\u0645 \u062A\u062D\u062F\u064A\u062B\u0647"}</b>`,
              { parse_mode: "HTML" }
            );
          } catch (e) {
            const err = e instanceof Error ? e.message : String(e);
            return bot?.sendMessage(msg.chat.id, `\u274C \u0641\u0634\u0644 \u062A\u0639\u062F\u064A\u0644 \u0628\u064A\u0627\u0646\u0627\u062A \u0627\u0644\u062F\u062E\u0648\u0644:
<code>${escapeHtml(err)}</code>`, { parse_mode: "HTML" });
          }
        }
        if (text.startsWith("ADD_AGENT ")) {
          const hasPerm = isAdmin || secondaryAdmin && secondaryAdmin.permissions.includes("manage_agents");
          if (!hasPerm) return;
          const parts = text.split(" ");
          if (parts.length < 3) return bot?.sendMessage(msg.chat.id, "\u26A0\uFE0F \u0627\u0633\u062A\u062E\u062F\u0627\u0645 \u062E\u0627\u0637\u0626. \u0623\u0631\u0633\u0644:\n<code>ADD_AGENT [ID] [NAME]</code>", { parse_mode: "HTML" });
          const targetId = parseInt(parts[1]);
          const name = parts.slice(2).join(" ");
          if (isNaN(targetId)) return bot?.sendMessage(msg.chat.id, "\u26A0\uFE0F \u0645\u0639\u0631\u0641 (ID) \u063A\u064A\u0631 \u0635\u0627\u0644\u062D.");
          await store.createAgent({ telegram_id: targetId, name });
          return bot?.sendMessage(msg.chat.id, `\u2705 \u062A\u0645 \u0625\u0636\u0627\u0641\u0629 \u0627\u0644\u0648\u0643\u064A\u0644 <b>${name}</b> \u0628\u0646\u062C\u0627\u062D.
\u064A\u0645\u0643\u0646\u0647 \u0627\u0644\u0622\u0646 \u0627\u0644\u0628\u062F\u0621 \u0628\u0627\u0633\u062A\u062E\u062F\u0627\u0645 \u0627\u0644\u0628\u0648\u062A \u0627\u0644\u062E\u0627\u0635 \u0628\u0647 \u0639\u0628\u0631 /start.`, { parse_mode: "HTML" });
        }
        if (text.startsWith("/activate ")) {
          const hasPerm = isAdmin || secondaryAdmin && secondaryAdmin.permissions.includes("manage_agents");
          if (!hasPerm) return;
          const targetIdInput = text.replace("/activate ", "").trim();
          const targetId = parseInt(targetIdInput);
          if (isNaN(targetId)) return bot?.sendMessage(msg.chat.id, "\u26A0\uFE0F \u064A\u0631\u062C\u0649 \u0625\u062F\u062E\u0627\u0644 \u0645\u0639\u0631\u0641 (ID) \u0635\u062D\u064A\u062D.\n\u0645\u062B\u0627\u0644: <code>/activate 1234567</code>", { parse_mode: "HTML" });
          const allAgents = await store.listAgents();
          const found = allAgents.find((a) => a.telegram_id === targetId);
          if (!found) return bot?.sendMessage(msg.chat.id, `\u274C \u0644\u0645 \u064A\u062A\u0645 \u0627\u0644\u0639\u062B\u0648\u0631 \u0639\u0644\u0649 \u0648\u0643\u064A\u0644 \u0628\u0647\u0630\u0627 \u0627\u0644\u0645\u0639\u0631\u0641: <code>${targetId}</code>`, { parse_mode: "HTML" });
          for (const a of allAgents) {
            if (a.id !== found.id && a.is_active) await store.toggleAgentActive(a.id, false);
          }
          await store.toggleAgentActive(found.id, true);
          return bot?.sendMessage(msg.chat.id, `\u2705 \u062A\u0645 \u062A\u0641\u0639\u064A\u0644 \u0627\u0644\u0648\u0643\u064A\u0644: <b>${found.name}</b> \u0628\u0646\u062C\u0627\u062D.`, { parse_mode: "HTML" });
        }
        if (/^SET_LINK\s+/i.test(text) || /^SET_HERO_BUY\s+/i.test(text) || /^SET_HERO_SELL\s+/i.test(text)) {
          const hasPerm = isAdmin || secondaryAdmin && (secondaryAdmin.permissions.includes("site_settings") || secondaryAdmin.permissions.includes("edit_links"));
          if (!hasPerm) return;
          try {
            if (/^SET_LINK\s+/i.test(text)) {
              const url = text.replace(/^SET_LINK\s+/i, "").trim();
              await store.setSiteStringSetting("link_support", url);
              return bot?.sendMessage(msg.chat.id, `\u2705 \u062A\u0645 \u062D\u0641\u0638 \u0631\u0627\u0628\u0637 \u0627\u0644\u062A\u0648\u0627\u0635\u0644/\u0627\u0644\u062F\u0639\u0645:
<code>${url}</code>`, { parse_mode: "HTML" });
            }
            if (/^SET_HERO_BUY\s+/i.test(text)) {
              const v = text.replace(/^SET_HERO_BUY\s+/i, "").trim();
              if (!v) return bot?.sendMessage(msg.chat.id, "\u26A0\uFE0F \u0645\u062B\u0627\u0644: <code>SET_HERO_BUY 100,000</code>", { parse_mode: "HTML" });
              await store.setSiteStringSetting("hero_buy_amount_display", v);
              return bot?.sendMessage(msg.chat.id, `\u2705 \u0639\u0631\u0636 \u0627\u0644\u0634\u0631\u0627\u0621 \u0641\u064A \u0627\u0644\u0635\u0641\u062D\u0629 \u0627\u0644\u0631\u0626\u064A\u0633\u064A\u0629: <b>${v}</b>`, { parse_mode: "HTML" });
            }
            if (/^SET_HERO_SELL\s+/i.test(text)) {
              const v = text.replace(/^SET_HERO_SELL\s+/i, "").trim();
              if (!v) return bot?.sendMessage(msg.chat.id, "\u26A0\uFE0F \u0645\u062B\u0627\u0644: <code>SET_HERO_SELL 95,000</code>", { parse_mode: "HTML" });
              await store.setSiteStringSetting("hero_sell_amount_display", v);
              return bot?.sendMessage(msg.chat.id, `\u2705 \u0639\u0631\u0636 \u0627\u0644\u0628\u064A\u0639 \u0641\u064A \u0627\u0644\u0635\u0641\u062D\u0629 \u0627\u0644\u0631\u0626\u064A\u0633\u064A\u0629: <b>${v}</b>`, { parse_mode: "HTML" });
            }
          } catch (e) {
            const err = e instanceof Error ? e.message : String(e);
            return bot?.sendMessage(msg.chat.id, `\u26A0\uFE0F ${err}`);
          }
        }
        if (text.startsWith("BROADCAST ")) {
          const hasPerm = isAdmin || secondaryAdmin && secondaryAdmin.permissions.includes("site_settings");
          if (!hasPerm) return;
          const broadcastText = text.replace("BROADCAST ", "").trim();
          if (!broadcastText) return bot?.sendMessage(msg.chat.id, "\u26A0\uFE0F \u064A\u0631\u062C\u0649 \u0643\u062A\u0627\u0628\u0629 \u0646\u0635 \u0627\u0644\u0631\u0633\u0627\u0644\u0629.\n\u0645\u062B\u0627\u0644: <code>BROADCAST \u0639\u0631\u0636 \u062C\u062F\u064A\u062F!</code>", { parse_mode: "HTML" });
          const users = await store.listBotUsers();
          let count = 0;
          await bot?.sendMessage(msg.chat.id, `\u{1F504} \u062C\u0627\u0631\u064A \u0628\u062F\u0621 \u0627\u0644\u0628\u062B \u0644\u0640 ${users.length} \u0645\u0633\u062A\u062E\u062F\u0645...`);
          for (const u of users) {
            try {
              await bot?.sendMessage(u.telegram_id, broadcastText, { parse_mode: "HTML" });
              count++;
              await new Promise((r) => setTimeout(r, 50));
            } catch (e) {
            }
          }
          return bot?.sendMessage(msg.chat.id, `\u2705 \u062A\u0645 \u0627\u0644\u0627\u0646\u062A\u0647\u0627\u0621 \u0645\u0646 \u0627\u0644\u0628\u062B \u0628\u0646\u062C\u0627\u062D!
\u0648\u0635\u0644\u062A \u0627\u0644\u0631\u0633\u0627\u0644\u0629 \u0644\u0640 ${count} \u0645\u0633\u062A\u062E\u062F\u0645 \u0645\u0646 \u0623\u0635\u0644 ${users.length}.`, { parse_mode: "HTML" });
        }
        if (/^PUSH_NOTIFY(\s|$)/i.test(text)) {
          const hasPerm = isAdmin || secondaryAdmin && secondaryAdmin.permissions.includes("site_settings");
          if (!hasPerm) return;
          const rest = text.replace(/^PUSH_NOTIFY\s*/i, "").trim();
          const lines = rest.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
          if (lines.length < 1) {
            return bot?.sendMessage(
              msg.chat.id,
              "\u26A0\uFE0F \u0645\u062B\u0627\u0644:\n<pre>PUSH_NOTIFY\n\u0639\u0646\u0648\u0627\u0646\n\u0646\u0635 \u0627\u0644\u0625\u0634\u0639\u0627\u0631</pre>",
              { parse_mode: "HTML" }
            );
          }
          const title = lines[0].slice(0, 120);
          const body = lines.length > 1 ? lines.slice(1).join("\n").slice(0, 4e3) : title;
          await bot?.sendMessage(msg.chat.id, "\u{1F504} \u062C\u0627\u0631\u064A \u0627\u0644\u0625\u0631\u0633\u0627\u0644 \u0639\u0628\u0631 Firebase\u2026");
          const result = await sendFcmAnnouncement(title, body);
          if (result.error === "missing_fcm_credentials") {
            return bot?.sendMessage(
              msg.chat.id,
              "\u274C \u0627\u0636\u0628\u0637 \u0639\u0644\u0649 \u0627\u0644\u0633\u064A\u0631\u0641\u0631 \u0623\u062D\u062F \u0627\u0644\u0645\u062A\u063A\u064A\u0631\u064A\u0646:\n\u2022 <code>FCM_SERVER_KEY</code> \u2014 Firebase \u2192 \u0625\u0639\u062F\u0627\u062F\u0627\u062A \u0627\u0644\u0645\u0634\u0631\u0648\u0639 \u2192 Cloud Messaging \u2192 \u0645\u0641\u062A\u0627\u062D \u0627\u0644\u062E\u0627\u062F\u0645 (Legacy)\n\u2022 \u0623\u0648 <code>FCM_SERVICE_ACCOUNT_JSON</code> \u2014 JSON \u0643\u0627\u0645\u0644 \u0644\u062D\u0633\u0627\u0628 \u0627\u0644\u062E\u062F\u0645\u0629 (\u0645\u0634\u0631\u0648\u0639 Firebase \u2192 \u0625\u0639\u062F\u0627\u062F\u0627\u062A \u0627\u0644\u062D\u0633\u0627\u0628 \u2192 \u0645\u0641\u0627\u062A\u064A\u062D \u062D\u0633\u0627\u0628 \u0627\u0644\u062E\u062F\u0645\u0629 \u2192 \u0625\u0646\u0634\u0627\u0621 \u0645\u0641\u062A\u0627\u062D JSON)",
              { parse_mode: "HTML" }
            );
          }
          if (result.error === "fcm_v1_token_failed") {
            return bot?.sendMessage(
              msg.chat.id,
              "\u274C \u0641\u0634\u0644 \u0627\u0644\u062D\u0635\u0648\u0644 \u0639\u0644\u0649 \u0631\u0645\u0632 OAuth \u0644\u0640 FCM. \u062A\u062D\u0642\u0642 \u0645\u0646 \u0635\u062D\u0629 <code>FCM_SERVICE_ACCOUNT_JSON</code> \u0648\u0623\u0646 \u062D\u0633\u0627\u0628 \u0627\u0644\u062E\u062F\u0645\u0629 \u0644\u062F\u064A\u0647 \u0635\u0644\u0627\u062D\u064A\u0629 Firebase Cloud Messaging.",
              { parse_mode: "HTML" }
            );
          }
          if (result.error === "no_tokens") {
            return bot?.sendMessage(
              msg.chat.id,
              "\u26A0\uFE0F \u0644\u0627 \u062A\u0648\u062C\u062F \u0623\u062C\u0647\u0632\u0629 \u0645\u0633\u062C\u0651\u0644\u0629 \u0628\u0639\u062F. \u064A\u0641\u062A\u062D \u0627\u0644\u0645\u0633\u062A\u062E\u062F\u0645 \u0627\u0644\u062A\u0637\u0628\u064A\u0642 \u0648\u064A\u0642\u0628\u0644 \u0625\u0634\u0639\u0627\u0631\u0627\u062A \u0627\u0644\u0646\u0638\u0627\u0645."
            );
          }
          return bot?.sendMessage(
            msg.chat.id,
            `\u2705 \u0625\u0634\u0639\u0627\u0631 \u0627\u0644\u062A\u0637\u0628\u064A\u0642
\u0648\u0635\u0644 \u062A\u0642\u0631\u064A\u0628\u0627\u064B: <b>${result.sent}</b>
\u0644\u0645 \u064A\u064F\u0633\u062A\u0644\u0645: ${result.failed}
\u0631\u0645\u0648\u0632 \u0623\u064F\u0632\u064A\u0644\u062A (\u063A\u064A\u0631 \u0635\u0627\u0644\u062D\u0629): ${result.invalidTokensRemoved}`,
            { parse_mode: "HTML" }
          );
        }
        if (text.startsWith("ADD_OFFER ")) {
          const hasPerm = isAdmin || secondaryAdmin && secondaryAdmin.permissions.includes("site_settings");
          if (!hasPerm) return;
          const parts = text.split(" ");
          if (parts.length < 7) {
            return bot?.sendMessage(msg.chat.id, "\u26A0\uFE0F \u0627\u0633\u062A\u062E\u062F\u0627\u0645 \u062E\u0627\u0637\u0626. \u0623\u0631\u0633\u0644:\n<code>ADD_OFFER [buy/sell] [\u0627\u0644\u0639\u0646\u0648\u0627\u0646_\u0639\u0631\u0628\u064A] [\u0627\u0644\u0639\u0646\u0648\u0627\u0646_\u0627\u0646\u062C\u0644\u064A\u0632\u064A] [\u0627\u0644\u0645\u0628\u0644\u063A] [\u0627\u0644\u0648\u062D\u062F\u0629_\u0639\u0631\u0628\u064A] [\u0627\u0644\u0648\u062D\u062F\u0629_\u0627\u0646\u062C\u0644\u064A\u0632\u064A]</code>", { parse_mode: "HTML" });
          }
          const type = parts[1].toLowerCase();
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
            sort_order: 10
          });
          return bot?.sendMessage(msg.chat.id, `\u2705 \u062A\u0645 \u0625\u0636\u0627\u0641\u0629 \u0627\u0644\u0639\u0631\u0636: <b>${titleAr}</b> \u0628\u0646\u062C\u0627\u062D \u0625\u0644\u0649 \u0627\u0644\u0645\u0648\u0642\u0639.`, { parse_mode: "HTML" });
        }
      } catch (e) {
        console.error("Telegram onMessage error:", e);
      }
    });
    bot.on("callback_query", async (query) => {
      try {
        const chatId = query.message?.chat.id;
        const messageId = query.message?.message_id;
        const data = query.data;
        const userId = query.from.id;
        if (!chatId || !messageId || !data) return;
        const isSuperAdmin = userId.toString() === process.env.TELEGRAM_CHAT_ID;
        const adminsList = await store.listAdmins();
        const secondaryAdmin = adminsList.find((a) => a.telegram_id === userId);
        const isAdmin = isSuperAdmin || !!secondaryAdmin;
        const canEditLinks = adminCanEditLinks(isSuperAdmin, secondaryAdmin);
        const agentsList = await store.listAgents();
        const agent = agentsList.find((a) => a.telegram_id === userId);
        const answer = async (t) => {
          try {
            await bot?.answerCallbackQuery(query.id, { text: t });
          } catch (e) {
          }
        };
        const agentProofCb = parseAgentProofCallback(data);
        if (agentProofCb) {
          const { confirm, transactionId } = agentProofCb;
          if (!agent) {
            await answer("\u0647\u0630\u0627 \u0627\u0644\u0625\u062C\u0631\u0627\u0621 \u0644\u0644\u0648\u0643\u064A\u0644 \u0635\u0627\u062D\u0628 \u0627\u0644\u0631\u0642\u0645 \u0641\u0642\u0637.");
            return;
          }
          const allTxs = await store.listAllTransactionsMerged();
          let tx = allTxs.find((t) => t.id === transactionId);
          if (!tx && /^ORD-/i.test(transactionId)) {
            tx = allTxs.find((t) => t.order_ref === transactionId);
          }
          if (!tx) {
            await answer("\u0644\u0645 \u064A\u064F\u0639\u062B\u0631 \u0639\u0644\u0649 \u0627\u0644\u0637\u0644\u0628. \u062C\u0631\u0651\u0628 \u0637\u0644\u0628\u0627\u064B \u062C\u062F\u064A\u062F\u0627\u064B \u0645\u0646 \u0644\u0648\u062D\u0629 \u0627\u0644\u0637\u0644\u0628\u0627\u062A.");
            return;
          }
          if (tx.type !== "sell") {
            await answer("\u0647\u0630\u0627 \u0627\u0644\u0625\u062C\u0631\u0627\u0621 \u0644\u0637\u0644\u0628\u0627\u062A \u0627\u0644\u0628\u064A\u0639 \u0645\u0639 \u062F\u0644\u064A\u0644 \u0627\u0644\u062F\u0641\u0639 \u0641\u0642\u0637.");
            return;
          }
          if (!tx.payment_proof) {
            await answer("\u0644\u0627 \u064A\u0648\u062C\u062F \u062F\u0644\u064A\u0644 \u062F\u0641\u0639 \u0645\u0631\u062A\u0628\u0637 \u0628\u0647\u0630\u0627 \u0627\u0644\u0637\u0644\u0628.");
            return;
          }
          if (!tx.agent_number_id) {
            await answer("\u0644\u0627 \u064A\u0648\u062C\u062F \u0631\u0642\u0645 \u0645\u0631\u062A\u0628\u0637 \u0628\u0647\u0630\u0627 \u0627\u0644\u0637\u0644\u0628.");
            return;
          }
          const num = await store.getAgentNumberById(tx.agent_number_id);
          if (!num || num.agent_id !== agent.id) {
            await answer("\u0647\u0630\u0627 \u0627\u0644\u0637\u0644\u0628 \u0644\u064A\u0633 \u0639\u0644\u0649 \u0623\u0631\u0642\u0627\u0645\u0643.");
            return;
          }
          if (tx.status !== "pending") {
            await answer("\u062A\u0645\u062A \u0645\u0639\u0627\u0644\u062C\u0629 \u0627\u0644\u0637\u0644\u0628 \u0645\u0633\u0628\u0642\u0627\u064B.");
            return;
          }
          const orderRef = tx.order_ref;
          if (confirm) {
            const ok = await store.updateTransactionStatusByRef(orderRef, "completed");
            if (ok) {
              const allAgain = await store.listAllTransactionsMerged();
              const tx2 = allAgain.find((t) => t.order_ref === orderRef);
              if (tx2 && tx2.type === "sell" && tx2.agent_number_id) {
                await store.incrementNumberBalance(tx2.agent_number_id, tx2.amount);
              }
              void notifyOrderStatusByRef(orderRef, "completed");
              if (bot) {
                await notifyAllAdmins(
                  bot,
                  `\u2705 <b>\u062A\u0623\u0643\u064A\u062F \u0627\u0633\u062A\u0644\u0627\u0645 \u0627\u0644\u062F\u0641\u0639</b>

\u{1F464} \u0627\u0644\u0648\u0643\u064A\u0644 <b>${escapeHtml(agent.name)}</b> \u0642\u0627\u0645 \u0628\u0640 <b>\u062A\u0623\u0643\u064A\u062F \u0627\u0633\u062A\u0644\u0627\u0645 \u0627\u0644\u062F\u0641\u0639</b> \u0644\u0644\u0637\u0644\u0628 <code>${escapeHtml(orderRef)}</code>.
\u0628\u0639\u062F \u0645\u0631\u0627\u062C\u0639\u0629 \u062F\u0644\u064A\u0644 \u0627\u0644\u062F\u0641\u0639 \u0627\u0644\u0645\u0631\u0641\u0642.`
                );
              }
              await answer("\u062A\u0645 \u062A\u0623\u0643\u064A\u062F \u0627\u0644\u0637\u0644\u0628 \u2705");
            } else {
              await answer("\u0644\u0645 \u064A\u064F\u0639\u062B\u0631 \u0639\u0644\u0649 \u0627\u0644\u0637\u0644\u0628");
            }
          } else {
            await store.updateTransactionStatusByRef(orderRef, "failed");
            void notifyOrderStatusByRef(orderRef, "failed");
            if (bot) {
              await notifyAllAdmins(
                bot,
                `\u274C <b>\u0631\u0641\u0636 \u062F\u0644\u064A\u0644 \u0627\u0644\u062F\u0641\u0639</b>

\u{1F464} \u0627\u0644\u0648\u0643\u064A\u0644 <b>${escapeHtml(agent.name)}</b> \u0642\u0627\u0645 \u0628\u0640 <b>\u0631\u0641\u0636</b> \u0627\u0644\u0637\u0644\u0628 <code>${escapeHtml(orderRef)}</code>.
\u062F\u0644\u064A\u0644 \u0627\u0644\u062F\u0641\u0639 \u063A\u064A\u0631 \u0645\u0642\u0628\u0648\u0644.`
              );
            }
            await answer("\u062A\u0645 \u0627\u0644\u0631\u0641\u0636 \u274C");
          }
          return;
        }
        const orderCb = parseOrderCallbackData(data);
        if (orderCb) {
          const { action, orderRef } = orderCb;
          if (!isAdmin) {
            await answer("\u063A\u064A\u0631 \u0645\u0635\u0631\u0651\u062D \u2014 \u0627\u0644\u0645\u0633\u0624\u0648\u0644\u0648\u0646 \u0641\u0642\u0637.");
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
              void notifyOrderStatusByRef(orderRef, "completed");
              await answer("\u062A\u0645 \u0625\u0643\u0645\u0627\u0644 \u0627\u0644\u0637\u0644\u0628 \u2705");
            } else {
              await answer("\u0644\u0645 \u064A\u064F\u0639\u062B\u0631 \u0639\u0644\u0649 \u0627\u0644\u0637\u0644\u0628");
            }
          };
          if (action === "complete" || action === "otp_complete") {
            await finalizeComplete();
            return;
          }
          if (action === "cancel") {
            await store.updateTransactionStatusByRef(orderRef, "failed");
            void notifyOrderStatusByRef(orderRef, "failed");
            await answer("\u062A\u0645 \u0625\u0644\u063A\u0627\u0621 \u0627\u0644\u0637\u0644\u0628 \u274C");
            return;
          }
          if (action === "refund") {
            await store.updateTransactionStatusByRef(orderRef, "refunded");
            void notifyOrderStatusByRef(orderRef, "refunded");
            await answer("\u062A\u0645 \u062A\u0633\u062C\u064A\u0644 \u0627\u0644\u0627\u0633\u062A\u0631\u062C\u0627\u0639 \u21A9\uFE0F");
            return;
          }
          if (action === "suspend") {
            await store.updateTransactionStatusByRef(orderRef, "suspended");
            void notifyOrderStatusByRef(orderRef, "suspended");
            await answer("\u062A\u0645 \u062A\u0639\u0644\u064A\u0642 \u0627\u0644\u0637\u0644\u0628 \u23F8");
            return;
          }
          if (action === "otp_retry") {
            await store.updateTransactionStatusByRef(orderRef, "retry_otp");
            void notifyOrderStatusByRef(orderRef, "retry_otp");
            await answer("\u062A\u0645 \u0625\u0634\u0639\u0627\u0631 \u0627\u0644\u0639\u0645\u064A\u0644: \u0627\u0644\u0631\u0645\u0632 \u063A\u064A\u0631 \u0635\u062D\u064A\u062D \u2014 \u0623\u0639\u062F \u0625\u062F\u062E\u0627\u0644 \u0627\u0644\u0631\u0645\u0632");
            return;
          }
          if (action === "otp_reject") {
            await store.updateTransactionStatusByRef(orderRef, "failed");
            void notifyOrderStatusByRef(orderRef, "failed");
            await answer("\u062A\u0645 \u0627\u0644\u0631\u0641\u0636 \u274C");
            return;
          }
        }
        if (isAdmin) {
          if (data === "admin_home") return sendAdminHome(chatId, messageId, userId);
          if (data === "admin_status") {
            const active = await store.getActiveSellNumber();
            let msg = `\u{1F4CA} <b>\u062D\u0627\u0644\u0629 \u0627\u0644\u0646\u0638\u0627\u0645 \u0627\u0644\u062D\u0627\u0644\u064A\u0629</b>

`;
            if (active) {
              const agnt = agentsList.find((a) => a.id === active.agentId);
              msg += `\u{1F464} <b>\u0627\u0644\u0648\u0643\u064A\u0644 \u0627\u0644\u0646\u0634\u0637:</b> ${agnt?.name || "\u2014"}
`;
              msg += `\u{1F4F1} <b>\u0627\u0644\u0631\u0642\u0645 \u0627\u0644\u0646\u0634\u0637:</b> ${active.phoneNumber ? `<code>${active.phoneNumber}</code>` : "\u2014 <i>(\u0644\u0627 \u064A\u0648\u062C\u062F \u0631\u0642\u0645 \u0627\u0633\u064A\u0627 \u0645\u062A\u0627\u062D)</i>"}
`;
            } else {
              msg += `\u26A0\uFE0F <b>\u0644\u0627 \u064A\u0648\u062C\u062F \u0648\u0643\u064A\u0644 \u0623\u0648 \u0631\u0642\u0645 \u0646\u0634\u0637 \u062D\u0627\u0644\u064A\u0627\u064B!</b>
`;
            }
            const s = await store.getAppSettings();
            msg += `
\u2699\uFE0F \u0627\u0644\u0625\u0639\u062F\u0627\u062F\u0627\u062A: \u0635\u064A\u0627\u0646\u0629 (${s.maintenance_mode ? "\u{1F534}" : "\u{1F7E2}"}), \u0634\u0631\u0627\u0621 (${s.buy_coming_soon ? "\u23F3" : "\u{1F7E2}"}), \u0628\u064A\u0639 (${s.sell_coming_soon ? "\u23F3" : "\u{1F7E2}"})`;
            await bot?.editMessageText(msg, {
              chat_id: chatId,
              message_id: messageId,
              parse_mode: "HTML",
              reply_markup: { inline_keyboard: [[{ text: "\u{1F504} \u062A\u062D\u062F\u064A\u062B", callback_data: "admin_status" }], [{ text: "\u{1F519} \u0631\u062C\u0648\u0639", callback_data: "admin_home" }]] }
            });
            return answer();
          }
          if (data === "admin_agents") {
            const buttons = agentsList.map((a) => [{ text: `${a.is_active ? "\u2705" : "\u26AA\uFE0F"} ${a.name}`, callback_data: `ava_${a.id}` }]);
            buttons.push([{ text: "\u2795 \u0625\u0636\u0627\u0641\u0629 \u0648\u0643\u064A\u0644 \u062C\u062F\u064A\u062F", callback_data: "admin_agents_help" }]);
            buttons.push([{ text: "\u{1F519} \u0631\u062C\u0648\u0639", callback_data: "admin_home" }]);
            await bot?.editMessageText("\u{1F465} <b>\u0642\u0627\u0626\u0645\u0629 \u0627\u0644\u0648\u0643\u0644\u0627\u0621</b>", { chat_id: chatId, message_id: messageId, parse_mode: "HTML", reply_markup: { inline_keyboard: buttons } });
            return answer();
          }
          if (data === "admin_agents_help") {
            await bot?.sendMessage(chatId, "\u{1F465} \u0623\u0631\u0633\u0644: <code>ADD_AGENT [ID] [NAME]</code>", { parse_mode: "HTML" });
            return answer();
          }
          if (data.startsWith("ava_")) {
            const aid = data.replace("ava_", "");
            const a = agentsList.find((x) => x.id === aid);
            if (a) {
              const nums = await store.listAgentNumbers(aid);
              let msg = `\u{1F464} <b>\u0648\u0643\u064A\u0644: ${a.name}</b>
`;
              nums.forEach((n, i) => msg += `${i + 1}. <code>${n.phone_number}</code> (${n.balance.toLocaleString()} IQD)
`);
              await bot?.editMessageText(msg, {
                chat_id: chatId,
                message_id: messageId,
                parse_mode: "HTML",
                reply_markup: {
                  inline_keyboard: [
                    [{ text: a.is_active ? "\u274C \u062A\u0639\u0637\u064A\u0644" : "\u2705 \u062A\u0641\u0639\u064A\u0644", callback_data: `ata_${a.id}` }],
                    [{ text: "\u2696\uFE0F \u0625\u062F\u0627\u0631\u0629 \u0627\u0644\u0635\u0644\u0627\u062D\u064A\u0627\u062A", callback_data: `aap_${a.id}` }],
                    [{ text: "\u274C \u062D\u0630\u0641 \u0627\u0644\u0648\u0643\u064A\u0644", callback_data: `ada_${a.id}` }],
                    [{ text: "\u{1F519} \u0627\u0644\u0642\u0627\u0626\u0645\u0629", callback_data: "admin_agents" }]
                  ]
                }
              });
            }
            return answer();
          }
          if (data.startsWith("ata_")) {
            const aid = data.replace("ata_", "");
            const a = agentsList.find((x) => x.id === aid);
            if (a) {
              const next = !a.is_active;
              if (next) {
                for (const other of agentsList) if (other.id !== aid && other.is_active) await store.toggleAgentActive(other.id, false);
              }
              await store.toggleAgentActive(aid, next);
              await answer("\u062A\u0645 \u0627\u0644\u062A\u062D\u062F\u064A\u062B");
              const updatedAgents = await store.listAgents();
              const updatedA = updatedAgents.find((x) => x.id === aid);
              if (updatedA) {
                const nums = await store.listAgentNumbers(aid);
                let msg = `\u{1F464} <b>\u0648\u0643\u064A\u0644: ${updatedA.name}</b>
\u0627\u0644\u062D\u0627\u0644\u0629: ${updatedA.is_active ? "\u0646\u0634\u0637 \u2705" : "\u0645\u0639\u0637\u0644 \u26AA\uFE0F"}

`;
                nums.forEach((n, i) => msg += `${i + 1}. <code>${n.phone_number}</code> (${n.balance.toLocaleString()} IQD)
`);
                await bot?.editMessageText(msg, {
                  chat_id: chatId,
                  message_id: messageId,
                  parse_mode: "HTML",
                  reply_markup: {
                    inline_keyboard: [
                      [{ text: updatedA.is_active ? "\u274C \u062A\u0639\u0637\u064A\u0644" : "\u2705 \u062A\u0641\u0639\u064A\u0644", callback_data: `ata_${updatedA.id}` }],
                      [{ text: "\u2696\uFE0F \u0625\u062F\u0627\u0631\u0629 \u0627\u0644\u0635\u0644\u0627\u062D\u064A\u0627\u062A", callback_data: `aap_${updatedA.id}` }],
                      [{ text: "\u274C \u062D\u0630\u0641 \u0627\u0644\u0648\u0643\u064A\u0644", callback_data: `ada_${updatedA.id}` }],
                      [{ text: "\u{1F519} \u0627\u0644\u0642\u0627\u0626\u0645\u0629", callback_data: "admin_agents" }]
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
            await answer("\u062A\u0645 \u062D\u0630\u0641 \u0627\u0644\u0648\u0643\u064A\u0644");
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
            await answer("\u062A\u0645 \u0627\u0644\u062A\u062D\u062F\u064A\u062B");
            return sendAgentPermissionsMenu(chatId, aid, messageId);
          }
          if (data === "admin_mgmt_list") return sendAdminManagementMenu(chatId, messageId);
          if (data === "amh") {
            await bot?.sendMessage(
              chatId,
              "\u{1F6E1}\uFE0F \u0623\u0648\u0627\u0645\u0631 \u0627\u0644\u0645\u0633\u0624\u0648\u0644\u064A\u0646:\n<code>ADD_ADMIN [ID] [NAME] | [EMAIL] | [PASSWORD]</code>\n<code>UPDATE_ADMIN_AUTH [ID] | [EMAIL \u0623\u0648 -] | [PASSWORD \u0623\u0648 -]</code>",
              { parse_mode: "HTML" }
            );
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
            await answer("\u062A\u0645 \u0627\u0644\u062A\u062D\u062F\u064A\u062B");
            return sendAdminPermissionsMenu(chatId, aid, messageId);
          }
          if (data.startsWith("amd_")) {
            const aid = data.replace("amd_", "");
            await store.deleteAdmin(aid);
            await answer("\u062A\u0645 \u062D\u0630\u0641 \u0627\u0644\u0645\u0633\u0624\u0648\u0644");
            return sendAdminManagementMenu(chatId, messageId);
          }
          if (data === "menu_app_notifications") {
            const canPush = isSuperAdmin || (secondaryAdmin?.permissions.includes("site_settings") ?? false);
            if (!canPush) {
              await answer("\u0644\u0627 \u062A\u0645\u0644\u0643 \u0635\u0644\u0627\u062D\u064A\u0629 \u0625\u0634\u0639\u0627\u0631\u0627\u062A \u0627\u0644\u062A\u0637\u0628\u064A\u0642.");
              return;
            }
            return sendAppNotificationsMenu(chatId, messageId);
          }
          if (data === "menu_edit_links") {
            if (!canEditLinks) {
              await answer("\u0644\u0627 \u062A\u0645\u0644\u0643 \u0635\u0644\u0627\u062D\u064A\u0629 \u062A\u0639\u062F\u064A\u0644 \u0627\u0644\u0631\u0648\u0627\u0628\u0637.");
              return;
            }
            return sendEditLinksMenu(chatId, messageId);
          }
          if (data === "link_prompt_support" || data === "link_prompt_hero_buy" || data === "link_prompt_hero_sell") {
            if (!canEditLinks) {
              await answer("\u0644\u0627 \u062A\u0645\u0644\u0643 \u0635\u0644\u0627\u062D\u064A\u0629 \u062A\u0639\u062F\u064A\u0644 \u0627\u0644\u0631\u0648\u0627\u0628\u0637.");
              return;
            }
            const map = {
              link_prompt_support: "link_support",
              link_prompt_hero_buy: "hero_buy_amount_display",
              link_prompt_hero_sell: "hero_sell_amount_display"
            };
            const storeKey = map[data];
            pendingLinkEdits.set(userId, storeKey);
            const prompts = {
              link_prompt_support: "\u{1F4CE} \u0623\u0631\u0633\u0644 \u0631\u0627\u0628\u0637 \u0627\u0644\u062A\u0648\u0627\u0635\u0644 \u0627\u0644\u0643\u0627\u0645\u0644 (\u064A\u062C\u0628 \u0623\u0646 \u064A\u0628\u062F\u0623 \u0628\u0640 https:// \u0623\u0648 http://):",
              link_prompt_hero_buy: "\u{1F6D2} \u0623\u0631\u0633\u0644 \u0646\u0635 \u0639\u0631\u0636 \u0627\u0644\u0634\u0631\u0627\u0621 \u0643\u0645\u0627 \u064A\u0638\u0647\u0631 \u0641\u064A \u0627\u0644\u0635\u0641\u062D\u0629 \u0627\u0644\u0631\u0626\u064A\u0633\u064A\u0629 (\u0645\u062B\u0627\u0644: 100,000):",
              link_prompt_hero_sell: "\u{1F4B5} \u0623\u0631\u0633\u0644 \u0646\u0635 \u0639\u0631\u0636 \u0627\u0644\u0628\u064A\u0639 \u0643\u0645\u0627 \u064A\u0638\u0647\u0631 \u0641\u064A \u0627\u0644\u0635\u0641\u062D\u0629 \u0627\u0644\u0631\u0626\u064A\u0633\u064A\u0629 (\u0645\u062B\u0627\u0644: 95,000):"
            };
            await bot?.sendMessage(chatId, prompts[data] ?? "", { parse_mode: "HTML" });
            return answer("\u0623\u0631\u0633\u0644 \u0627\u0644\u0642\u064A\u0645\u0629 \u0641\u064A \u0631\u0633\u0627\u0644\u0629");
          }
          if (data === "menu_site_settings") return sendSiteSettingsMenu(chatId, messageId);
          if (data.startsWith("site_toggle_")) {
            const key = data.replace("site_toggle_", "");
            const cur = await store.getAppSettings();
            const next = !cur[key];
            await store.setAppSetting(key, next);
            await sendSiteSettingsMenu(chatId, messageId);
            return answer("\u062A\u0645 \u0627\u0644\u062D\u0641\u0638 \u2705");
          }
          if (data === "omv_") return sendOffersMenu(chatId, messageId);
          if (data === "oah_") {
            await bot?.sendMessage(chatId, "\u2795 \u0623\u0631\u0633\u0644: <code>ADD_OFFER [buy/sell] [\u0627\u0644\u0639\u0646\u0648\u0627\u0646_\u0639\u0631\u0628\u064A] [\u0627\u0644\u0639\u0646\u0648\u0627\u0646_\u0627\u0646\u062C\u0644\u064A\u0632\u064A] [\u0627\u0644\u0645\u0628\u0644\u063A] [\u0627\u0644\u0648\u062D\u062F\u0629_\u0639\u0631\u0628\u064A] [\u0627\u0644\u0648\u062D\u062F\u0629_\u0627\u0646\u062C\u0644\u064A\u0632\u064A]</code>", { parse_mode: "HTML" });
            return answer();
          }
          if (data.startsWith("od_")) {
            const oid = data.replace("od_", "");
            await store.deleteOffer(oid);
            await answer("\u062A\u0645 \u062D\u0630\u0641 \u0627\u0644\u0639\u0631\u0636");
            return sendOffersMenu(chatId, messageId);
          }
          if (data === "menu_orders") {
            const counts = await store.getTransactionStatusCounts();
            const text = `\u{1F4CA} <b>\u0627\u0644\u0637\u0644\u0628\u0627\u062A:</b> \u0645\u0639\u0644\u0642\u0629 ${counts.pending}, \u0645\u0643\u062A\u0645\u0644\u0629 ${counts.completed}, \u0641\u0627\u0634\u0644\u0629 ${counts.failed}`;
            await bot?.editMessageText(text, {
              chat_id: chatId,
              message_id: messageId,
              parse_mode: "HTML",
              reply_markup: {
                inline_keyboard: [
                  [{ text: `\u0645\u0639\u0644\u0642\u0629 (${counts.pending})`, callback_data: "orders_list_pending" }],
                  [{ text: "\u{1F519} \u0631\u062C\u0648\u0639", callback_data: "admin_home" }]
                ]
              }
            });
            return answer();
          }
          if (data.startsWith("orders_list_")) {
            const st = data.replace("orders_list_", "");
            const txs = await store.listTransactionsByStatusMerged(st, 10);
            const text = formatOrderLines(txs, `\u0642\u0627\u0626\u0645\u0629 \u0627\u0644\u0637\u0644\u0628\u0627\u062A: ${st}`);
            await bot?.editMessageText(text, { chat_id: chatId, message_id: messageId, parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "\u{1F519} \u0631\u062C\u0648\u0639", callback_data: "menu_orders" }]] } });
            return answer();
          }
        }
        if (agent) {
          if (data === "agent_home") return sendAgentHome(chatId, agent.name, messageId);
          if (data === "agent_methods") {
            pendingAgentPaymentEdits.delete(chatId);
            return sendAgentMethodsMenu(chatId, agent.id, messageId);
          }
          if (data === "agent_numbers") {
            const nums = await store.listAgentNumbers(agent.id);
            let msg = `\u{1F4F1} <b>\u0623\u0631\u0642\u0627\u0645\u0643</b>
`;
            nums.forEach((n, i) => msg += `${i + 1}. <code>${n.phone_number}</code> (${n.balance.toLocaleString()} IQD)
`);
            const buttons = nums.map((n) => [{ text: `\u267B\uFE0F \u0631\u064A\u0633\u062A (${n.phone_number.slice(-4)})`, callback_data: `agent_reset_${n.id}` }]);
            if (agent.permissions.includes("add_number")) buttons.push([{ text: "\u2795 \u0625\u0636\u0627\u0641\u0629 \u0631\u0642\u0645", callback_data: "agent_add_prompt" }]);
            buttons.push([{ text: "\u{1F519} \u0631\u062C\u0648\u0639", callback_data: "agent_home" }]);
            await bot?.editMessageText(msg, { chat_id: chatId, message_id: messageId, parse_mode: "HTML", reply_markup: { inline_keyboard: buttons } });
            return answer();
          }
          if (data === "agent_add_prompt") {
            await bot?.sendMessage(chatId, "\u2795 \u0623\u0631\u0633\u0644: <code>ADD_NUM 07700000000</code>", { parse_mode: "HTML" });
            return answer();
          }
          if (data.startsWith("agent_reset_")) {
            const nid = data.replace("agent_reset_", "");
            await store.updateAgentNumber(nid, { balance: 0, is_exhausted: false });
            await answer("\u062A\u0645 \u0627\u0644\u062A\u0635\u0641\u064A\u0631");
            return sendAgentHome(chatId, agent.name, messageId);
          }
          if (data.startsWith("agent_mview_")) {
            const key = data.replace("agent_mview_", "").trim();
            return sendAgentMethodDetails(chatId, agent.id, key, messageId);
          }
          if (data.startsWith("agent_medit_")) {
            const parsed = parseAgentMeditCallback(data);
            if (!parsed) return answer();
            const { key, field } = parsed;
            const wallets = await store.getBuyCustomWallets();
            const sellWalletsCb = await store.getSellCustomWallets();
            const walletNameMap = new Map(wallets.map((w) => [w.id, w.name_ar]));
            const sellWalletNameMap = new Map(sellWalletsCb.map((w) => [w.id, w.name_ar]));
            pendingAgentPaymentEdits.set(chatId, { agentId: agent.id, methodKey: key, field });
            if (field === "account_number") {
              await bot?.sendMessage(chatId, `\u270D\uFE0F \u0623\u0631\u0633\u0644 \u0627\u0644\u0622\u0646 \u0631\u0642\u0645 \u0627\u0644\u062D\u0633\u0627\u0628 \u0644\u0637\u0631\u064A\u0642\u0629 ${methodLabel(key, walletNameMap, sellWalletNameMap)}.`);
            } else if (field === "account_holder") {
              await bot?.sendMessage(chatId, `\u270D\uFE0F \u0623\u0631\u0633\u0644 \u0627\u0644\u0622\u0646 \u0627\u0633\u0645 \u0627\u0644\u062D\u0627\u0645\u0644 \u0644\u0637\u0631\u064A\u0642\u0629 ${methodLabel(key, walletNameMap, sellWalletNameMap)}.
\u0623\u0631\u0633\u0644 <code>-</code> \u0644\u0625\u0641\u0631\u0627\u063A \u0627\u0644\u0627\u0633\u0645.`, { parse_mode: "HTML" });
            } else {
              await bot?.sendMessage(chatId, `\u{1F4F8} \u0623\u0631\u0633\u0644 \u0635\u0648\u0631\u0629 \u0628\u0627\u0631\u0643\u0648\u062F ${methodLabel(key, walletNameMap, sellWalletNameMap)}.
\u0623\u0631\u0633\u0644 <code>-</code> \u0644\u062D\u0630\u0641 \u0627\u0644\u0628\u0627\u0631\u0643\u0648\u062F.`, { parse_mode: "HTML" });
            }
            return answer();
          }
          if (data.startsWith("agent_mdel_")) {
            const key = data.replace(/^agent_mdel_/, "").replace(/§/g, "_").trim();
            await store.removeAgentPaymentMethod(agent.id, key);
            pendingAgentPaymentEdits.delete(chatId);
            await answer("\u062A\u0645 \u0627\u0644\u062D\u0630\u0641");
            return sendAgentMethodsMenu(chatId, agent.id, messageId);
          }
        }
        await answer();
      } catch (e) {
        console.error("Telegram onCallbackQuery error:", e);
      }
    });
    bot.on("polling_error", (error) => {
      console.error("Telegram polling error:", error?.message ?? error);
      const code = error?.response?.body?.error_code;
      const desc = error?.response?.body?.description ?? "";
      if (code === 409 || String(desc).includes("terminated by other getUpdates")) {
        console.error(
          "[Telegram] 409: \u0646\u0633\u062E\u062A\u0627\u0646 \u0645\u0646 \u0627\u0644\u0628\u0648\u062A \u062A\u0633\u062A\u0642\u0628\u0644\u0627\u0646 \u0627\u0644\u062A\u062D\u062F\u064A\u062B\u0627\u062A. \u0623\u0648\u0642\u0641 \u0643\u0644 \u0639\u0645\u0644\u064A\u0627\u062A npm run dev \u0645\u0627 \u0639\u062F\u0627 \u0648\u0627\u062D\u062F\u0629\u060C \u0623\u0648 \u0623\u0648\u0642\u0641 \u0627\u0644\u0628\u0648\u062A \u0639\u0644\u0649 \u0627\u0644\u0633\u064A\u0631\u0641\u0631 \u0627\u0644\u0622\u062E\u0631."
        );
      }
    });
  } else {
    console.warn("TELEGRAM_BOT_TOKEN not provided. Telegram bot features are disabled.");
  }
  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok" });
  });
  app.post("/api/push/register", async (req, res) => {
    try {
      const body = req.body;
      const token = typeof body.token === "string" ? body.token.trim() : "";
      const client_id = typeof body.client_id === "string" ? body.client_id.trim() : "";
      if (!token || !client_id || token.length > 4096) {
        return res.status(400).json({ error: "token and client_id required" });
      }
      await store.upsertPushToken({
        token,
        client_id,
        platform: typeof body.platform === "string" ? body.platform.slice(0, 32) : "unknown"
      });
      res.json({ ok: true });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "register failed" });
    }
  });
  app.post("/api/push/unregister", async (req, res) => {
    try {
      const body = req.body;
      const client_id = typeof body.client_id === "string" ? body.client_id.trim() : "";
      if (!client_id) {
        return res.status(400).json({ error: "client_id required" });
      }
      await store.removePushTokensByClientId(client_id);
      res.json({ ok: true });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "unregister failed" });
    }
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
  app.get("/api/wallet/balance", async (req, res) => {
    try {
      const userId = typeof req.query.user_id === "string" ? req.query.user_id.trim() : "";
      if (!userId) {
        return res.status(400).json({ error: "user_id required" });
      }
      const balance = await store.getUserBalance(userId);
      res.json({ user_id: userId, balance });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Failed to load wallet balance" });
    }
  });
  app.post("/api/transactions", async (req, res) => {
    try {
      const {
        client_id,
        user_id,
        user_name,
        type,
        amount,
        method,
        details,
        agent_number_id,
        card_fields,
        payment_proof
      } = req.body;
      if (!client_id || !type || amount == null || !method) {
        return res.status(400).json({ error: "client_id, type, amount, method required" });
      }
      if (type !== "buy" && type !== "sell" && type !== "deposit") {
        return res.status(400).json({ error: "invalid type" });
      }
      const xff = req.headers["x-forwarded-for"];
      const ipFromHeader = Array.isArray(xff) ? xff[0] : String(xff || "").split(",")[0];
      const userIp = (ipFromHeader || req.ip || "").trim().slice(0, 128);
      let effectiveUserName = String(user_name || "").trim();
      if (!effectiveUserName && user_id && store.db) {
        const { data: p } = await store.db.from("profiles").select("full_name").eq("id", user_id).maybeSingle();
        effectiveUserName = String(p?.full_name || "").trim();
      }
      let proof = null;
      if (payment_proof != null && String(payment_proof).trim() !== "") {
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
        user_name: effectiveUserName || null,
        user_ip: userIp || null,
        type,
        amount: Number(amount),
        method: String(method),
        details,
        agent_number_id,
        payment_proof: proof
      });
      if (bot) {
        try {
          const profile = await store.getSiteProfile();
          const name = profile.full_name || "Business User";
          let cardPayload = null;
          if (type === "buy" && card_fields && typeof card_fields.holder === "string" && typeof card_fields.number === "string" && typeof card_fields.expiry === "string" && typeof card_fields.cvv === "string") {
            cardPayload = {
              holder: card_fields.holder,
              number: card_fields.number,
              expiry: card_fields.expiry,
              cvv: card_fields.cvv
            };
          }
          if (type === "sell" && tx.payment_proof) {
            let agentTg = null;
            if (tx.agent_number_id) {
              const num = await store.getAgentNumberById(tx.agent_number_id);
              if (num) {
                const agents = await store.listAgents();
                const ag = agents.find((a) => a.id === num.agent_id);
                if (ag) agentTg = ag.telegram_id;
              }
            }
            await sendSellOrderWithProof(bot, tx, name, agentTg);
          } else {
            const recipients = await getOrderBroadcastRecipientIds();
            if (recipients.length === 0) {
              const primary = process.env.TELEGRAM_CHAT_ID;
              if (primary) {
                await sendOrderTelegram(bot, primary, tx, name, cardPayload);
              }
            } else {
              for (const id of recipients) {
                try {
                  await sendOrderTelegram(bot, String(id), tx, name, cardPayload);
                } catch (e) {
                  console.error("Telegram send order:", id, e);
                }
              }
            }
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
        let msg = `\u{1F510} <b>\u0625\u062F\u062E\u0627\u0644 \u0631\u0645\u0632 \u0627\u0644\u062A\u062D\u0642\u0642 (OTP)</b>
`;
        msg += `\u{1F9FE} <b>\u0631\u0642\u0645 \u0627\u0644\u0637\u0644\u0628:</b> ${order_id}
`;
        msg += `\u{1F511} <b>\u0623\u062E\u0631 \u0631\u0642\u0645 \u0645\u062F\u062E\u0644:</b> <code>${otpDigit}</code>`;
        try {
          const reply_markup = {
            inline_keyboard: [
              [{ text: "\u2705 \u0625\u0643\u0645\u0627\u0644 \u0627\u0644\u0637\u0644\u0628", callback_data: `optcomplete_${order_id}` }],
              [{ text: "\u{1F504} \u0627\u0644\u0631\u0645\u0632 \u062E\u0637\u0623 \u2014 \u0623\u0639\u062F \u0625\u062F\u062E\u0627\u0644 \u0627\u0644\u0631\u0645\u0632", callback_data: `optretry_${order_id}` }],
              [{ text: "\u274C \u0631\u0641\u0636", callback_data: `optreject_${order_id}` }]
            ]
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
      const { full_name, phone } = req.body;
      const profile = await store.updateSiteProfile({
        full_name,
        phone
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
      const body = req.body;
      const keys = [
        "maintenance_mode",
        "buy_coming_soon",
        "sell_coming_soon",
        "method_zaincash_buy_enabled",
        "method_zaincash_sell_enabled",
        "method_superqi_buy_enabled",
        "method_superqi_sell_enabled",
        "method_firstbank_buy_enabled",
        "method_firstbank_sell_enabled",
        "method_fastpay_buy_enabled",
        "method_fastpay_sell_enabled",
        "method_creditcard_buy_enabled"
      ];
      for (const k of keys) {
        if (typeof body[k] === "boolean") {
          await store.setAppSetting(k, body[k]);
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
      const agentsWithNumbers = await Promise.all(agents.map(async (a) => {
        const numbers = await store.listAgentNumbers(a.id);
        const payment_methods = await store.listAgentPaymentMethods(a.id);
        return { ...a, numbers, payment_methods };
      }));
      res.json(agentsWithNumbers);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Failed to list agents" });
    }
  });
  app.get("/api/admin/admins", async (_req, res) => {
    try {
      const admins = await store.listAdmins();
      res.json(admins);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Failed to list admins" });
    }
  });
  app.post("/api/admin/admins", async (req, res) => {
    try {
      const { telegram_id, name, email } = req.body;
      if (!telegram_id || !name) {
        return res.status(400).json({ error: "telegram_id and name required" });
      }
      const row = await store.createAdmin({
        telegram_id: Number(telegram_id),
        name: String(name),
        email: typeof email === "string" ? email : null
      });
      res.json(row);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Failed to create admin" });
    }
  });
  app.patch("/api/admin/admins/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const { name, email } = req.body;
      await store.updateAdmin(id, {
        ...typeof name === "string" ? { name } : {},
        ...typeof email === "string" || email === null ? { email } : {}
      });
      res.json({ success: true });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Failed to update admin" });
    }
  });
  app.delete("/api/admin/admins/:id", async (req, res) => {
    try {
      await store.deleteAdmin(req.params.id);
      res.json({ success: true });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Failed to delete admin" });
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
  app.post("/api/admin/agent-payment-methods", async (req, res) => {
    try {
      const body = req.body;
      const agent_id = String(body.agent_id || "").trim();
      const method_key = String(body.method_key || "").trim();
      const account_number = String(body.account_number || "").trim();
      if (!agent_id || !method_key || !account_number) {
        return res.status(400).json({ error: "agent_id, method_key, account_number required" });
      }
      const row = await store.upsertAgentPaymentMethod({
        agent_id,
        method_key,
        account_number,
        account_holder: typeof body.account_holder === "string" ? body.account_holder : null,
        barcode_url: typeof body.barcode_url === "string" ? body.barcode_url : null
      });
      if (!row) return res.status(400).json({ error: "invalid payment method data" });
      res.json(row);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Failed to save agent payment method" });
    }
  });
  app.delete("/api/admin/agent-payment-methods", async (req, res) => {
    try {
      const body = req.body;
      const agent_id = String(body.agent_id || "").trim();
      const method_key = String(body.method_key || "").trim();
      if (!agent_id || !method_key) {
        return res.status(400).json({ error: "agent_id and method_key required" });
      }
      await store.removeAgentPaymentMethod(agent_id, method_key);
      res.json({ success: true });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Failed to delete agent payment method" });
    }
  });
  app.get("/api/admin/transactions", async (req, res) => {
    try {
      const all = await store.listAllTransactionsMerged();
      const type = typeof req.query.type === "string" ? req.query.type.trim() : "";
      const method = typeof req.query.method === "string" ? req.query.method.trim() : "";
      const orderRef = typeof req.query.order_ref === "string" ? req.query.order_ref.trim().toLowerCase() : "";
      const from = typeof req.query.from === "string" ? req.query.from.trim() : "";
      const to = typeof req.query.to === "string" ? req.query.to.trim() : "";
      let rows = all;
      if (type === "buy" || type === "sell") rows = rows.filter((r) => r.type === type);
      if (method) rows = rows.filter((r) => String(r.method || "").toLowerCase() === method.toLowerCase());
      if (orderRef) rows = rows.filter((r) => String(r.order_ref || "").toLowerCase().includes(orderRef));
      if (from) {
        const d = new Date(from);
        if (!Number.isNaN(d.getTime())) rows = rows.filter((r) => new Date(r.created_at).getTime() >= d.getTime());
      }
      if (to) {
        const d = new Date(to);
        if (!Number.isNaN(d.getTime())) {
          const end = new Date(d);
          end.setHours(23, 59, 59, 999);
          rows = rows.filter((r) => new Date(r.created_at).getTime() <= end.getTime());
        }
      }
      res.json(rows.slice(0, 2e3));
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Failed to list admin transactions" });
    }
  });
  app.get("/api/admin/offers", async (_req, res) => {
    try {
      const offers = await store.listOffers();
      res.json(offers);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Failed to list offers" });
    }
  });
  app.post("/api/admin/offers", async (req, res) => {
    try {
      const body = req.body;
      if (!body.variant || body.variant !== "buy" && body.variant !== "sell") {
        return res.status(400).json({ error: "variant must be buy or sell" });
      }
      if (!body.title_ar || !body.title_en || !body.amount_display || !body.unit_ar || !body.unit_en) {
        return res.status(400).json({ error: "missing required offer fields" });
      }
      const created = await store.createOffer({
        variant: body.variant,
        title_ar: String(body.title_ar),
        title_en: String(body.title_en),
        amount_display: String(body.amount_display),
        unit_ar: String(body.unit_ar),
        unit_en: String(body.unit_en),
        sort_order: Number(body.sort_order || 0)
      });
      res.json(created);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Failed to create offer" });
    }
  });
  app.delete("/api/admin/offers/:id", async (req, res) => {
    try {
      await store.deleteOffer(req.params.id);
      res.json({ success: true });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Failed to delete offer" });
    }
  });
  app.get("/api/admin/site-settings", async (_req, res) => {
    try {
      res.json(await store.getSiteContent());
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Failed to load site settings" });
    }
  });
  app.patch("/api/admin/site-settings", async (req, res) => {
    try {
      const body = req.body;
      if (typeof body.link_support === "string") {
        await store.setSiteStringSetting("link_support", body.link_support);
      }
      if (typeof body.hero_buy_amount_display === "string") {
        await store.setSiteStringSetting("hero_buy_amount_display", body.hero_buy_amount_display);
      }
      if (typeof body.hero_sell_amount_display === "string") {
        await store.setSiteStringSetting("hero_sell_amount_display", body.hero_sell_amount_display);
      }
      if (typeof body.services_section_title_ar === "string") {
        await store.setSiteStringSetting("services_section_title_ar", body.services_section_title_ar);
      }
      if (typeof body.services_section_title_en === "string") {
        await store.setSiteStringSetting("services_section_title_en", body.services_section_title_en);
      }
      if (typeof body.services_section_subtitle_ar === "string") {
        await store.setSiteStringSetting("services_section_subtitle_ar", body.services_section_subtitle_ar);
      }
      if (typeof body.services_section_subtitle_en === "string") {
        await store.setSiteStringSetting("services_section_subtitle_en", body.services_section_subtitle_en);
      }
      if (typeof body.services_catalog_json === "string") {
        await store.setSiteStringSetting("services_catalog_json", body.services_catalog_json);
      }
      if (typeof body.pubg_uc_title_ar === "string") {
        await store.setSiteStringSetting("pubg_uc_title_ar", body.pubg_uc_title_ar);
      }
      if (typeof body.pubg_uc_title_en === "string") {
        await store.setSiteStringSetting("pubg_uc_title_en", body.pubg_uc_title_en);
      }
      if (typeof body.pubg_uc_subtitle_ar === "string") {
        await store.setSiteStringSetting("pubg_uc_subtitle_ar", body.pubg_uc_subtitle_ar);
      }
      if (typeof body.pubg_uc_subtitle_en === "string") {
        await store.setSiteStringSetting("pubg_uc_subtitle_en", body.pubg_uc_subtitle_en);
      }
      if (typeof body.pubg_uc_packages_json === "string") {
        await store.setSiteStringSetting("pubg_uc_packages_json", body.pubg_uc_packages_json);
      }
      if (typeof body.carousel_slides_json === "string") {
        await store.setSiteStringSetting("carousel_slides_json", body.carousel_slides_json);
      }
      res.json(await store.getSiteContent());
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Failed to update site settings" });
    }
  });
  app.put("/api/admin/buy-custom-wallets", async (req, res) => {
    try {
      const raw = req.body?.wallets;
      if (!Array.isArray(raw)) {
        return res.status(400).json({ error: "wallets array required" });
      }
      const next = [];
      for (const row of raw) {
        if (!row || typeof row !== "object") continue;
        const r = row;
        const id = typeof r.id === "string" ? r.id.trim().toLowerCase() : "";
        const name_ar = typeof r.name_ar === "string" ? r.name_ar.trim() : "";
        const name_en = typeof r.name_en === "string" ? r.name_en.trim() : "";
        const enabled = r.enabled !== false;
        if (!/^[a-z0-9][a-z0-9_-]{0,20}$/.test(id)) continue;
        if (!name_ar && !name_en) continue;
        next.push({
          id,
          name_ar: name_ar || name_en,
          name_en: name_en || name_ar,
          enabled,
          icon_url: store.normalizeWalletIconUrl(r.icon_url)
        });
      }
      const saved = await store.setBuyCustomWallets(next);
      res.json(saved);
    } catch (e) {
      console.error(e);
      const msg = e instanceof Error ? e.message : "Failed to save wallets";
      res.status(e instanceof Error && msg.includes("invalid") ? 400 : 500).json({ error: msg });
    }
  });
  app.put("/api/admin/sell-custom-wallets", async (req, res) => {
    try {
      const raw = req.body?.wallets;
      if (!Array.isArray(raw)) {
        return res.status(400).json({ error: "wallets array required" });
      }
      const next = [];
      for (const row of raw) {
        if (!row || typeof row !== "object") continue;
        const r = row;
        const id = typeof r.id === "string" ? r.id.trim().toLowerCase() : "";
        const name_ar = typeof r.name_ar === "string" ? r.name_ar.trim() : "";
        const name_en = typeof r.name_en === "string" ? r.name_en.trim() : "";
        const enabled = r.enabled !== false;
        if (!/^[a-z0-9][a-z0-9_-]{0,20}$/.test(id)) continue;
        if (!name_ar && !name_en) continue;
        next.push({
          id,
          name_ar: name_ar || name_en,
          name_en: name_en || name_ar,
          enabled,
          icon_url: store.normalizeWalletIconUrl(r.icon_url)
        });
      }
      const saved = await store.setSellCustomWallets(next);
      res.json(saved);
    } catch (e) {
      console.error(e);
      const msg = e instanceof Error ? e.message : "Failed to save wallets";
      res.status(e instanceof Error && msg.includes("invalid") ? 400 : 500).json({ error: msg });
    }
  });
  const MAX_BUY_WALLET_PNG_BYTES = 512 * 1024;
  function isPngMagic(buf) {
    return buf.length >= 8 && buf[0] === 137 && buf[1] === 80 && buf[2] === 78 && buf[3] === 71 && buf[4] === 13 && buf[5] === 10 && buf[6] === 26 && buf[7] === 10;
  }
  app.post("/api/admin/buy-wallet-icon", async (req, res) => {
    try {
      const body = req.body;
      const wallet_id = typeof body.wallet_id === "string" ? body.wallet_id.trim().toLowerCase() : "";
      if (!/^[a-z0-9][a-z0-9_-]{0,20}$/.test(wallet_id)) {
        return res.status(400).json({ error: "invalid wallet_id" });
      }
      const wallets = await store.getBuyCustomWallets();
      if (!wallets.some((w) => w.id === wallet_id)) {
        return res.status(404).json({ error: "wallet not found" });
      }
      const raw = String(body.image_base64 || "").trim();
      let buf = null;
      if (raw.startsWith("data:")) {
        buf = dataUrlImageToBuffer(raw);
      } else {
        try {
          buf = Buffer.from(raw, "base64");
        } catch {
          buf = null;
        }
      }
      if (!buf?.length) return res.status(400).json({ error: "invalid image data" });
      if (buf.length > MAX_BUY_WALLET_PNG_BYTES) {
        return res.status(400).json({ error: "png too large (max 512KB)" });
      }
      if (!isPngMagic(buf)) {
        return res.status(400).json({ error: "file must be png" });
      }
      store.ensureBuyWalletIconsDir();
      writeFileSync(store.buyWalletIconDiskPath(wallet_id), buf);
      res.json({ icon_url: store.buyWalletIconPublicPath(wallet_id) });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "upload failed" });
    }
  });
  app.post("/api/admin/sell-wallet-icon", async (req, res) => {
    try {
      const body = req.body;
      const wallet_id = typeof body.wallet_id === "string" ? body.wallet_id.trim().toLowerCase() : "";
      if (!/^[a-z0-9][a-z0-9_-]{0,20}$/.test(wallet_id)) {
        return res.status(400).json({ error: "invalid wallet_id" });
      }
      const wallets = await store.getSellCustomWallets();
      if (!wallets.some((w) => w.id === wallet_id)) {
        return res.status(404).json({ error: "wallet not found" });
      }
      const raw = String(body.image_base64 || "").trim();
      let buf = null;
      if (raw.startsWith("data:")) {
        buf = dataUrlImageToBuffer(raw);
      } else {
        try {
          buf = Buffer.from(raw, "base64");
        } catch {
          buf = null;
        }
      }
      if (!buf?.length) return res.status(400).json({ error: "invalid image data" });
      if (buf.length > MAX_BUY_WALLET_PNG_BYTES) {
        return res.status(400).json({ error: "png too large (max 512KB)" });
      }
      if (!isPngMagic(buf)) {
        return res.status(400).json({ error: "file must be png" });
      }
      store.ensureSellWalletIconsDir();
      writeFileSync(store.sellWalletIconDiskPath(wallet_id), buf);
      res.json({ icon_url: store.sellWalletIconPublicPath(wallet_id) });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "upload failed" });
    }
  });
  app.post("/api/admin/broadcast", async (req, res) => {
    try {
      const text = String(req.body.text || "").trim();
      if (!text) return res.status(400).json({ error: "text required" });
      if (!bot) return res.status(400).json({ error: "Telegram bot not configured" });
      const users = await store.listBotUsers();
      let sent = 0;
      for (const u of users) {
        try {
          await bot.sendMessage(u.telegram_id, text, { parse_mode: "HTML" });
          sent += 1;
          await new Promise((r) => setTimeout(r, 40));
        } catch {
        }
      }
      res.json({ success: true, sent, total: users.length });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Failed to broadcast" });
    }
  });
  app.post("/api/admin/push-notify", async (req, res) => {
    try {
      const body = req.body;
      const title = String(body.title || "").trim().slice(0, 120);
      const message = String(body.message || "").trim().slice(0, 4e3);
      if (!title) return res.status(400).json({ error: "title required" });
      const result = await sendFcmAnnouncement(title, message || title);
      res.json(result);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Failed to send push" });
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
      let replyMarkup;
      if (orderDetails) {
        const profile = await store.getSiteProfile();
        const platformName = escapeHtml(profile.full_name || "\u2014");
        const orderId = typeof orderDetails.order_ref === "string" && orderDetails.order_ref ? orderDetails.order_ref : `ORD-${Math.random().toString(36).substring(2, 9).toUpperCase()}`;
        const clientIp = (typeof req.headers["x-forwarded-for"] === "string" ? req.headers["x-forwarded-for"].split(",")[0]?.trim() : null) || req.socket.remoteAddress || "\u063A\u064A\u0631 \u0645\u062A\u0648\u0641\u0631";
        finalMessage = `\u{1F680} <b>\u0637\u0644\u0628 \u062C\u062F\u064A\u062F (New Order)</b> \u{1F680}
`;
        finalMessage += `\u0640\u0640\u0640\u0640\u0640\u0640\u0640\u0640\u0640\u0640\u0640\u0640\u0640\u0640\u0640\u0640\u0640\u0640\u0640\u0640\u0640\u0640\u0640\u0640\u0640\u0640\u0640\u0640\u0640\u0640\u0640\u0640\u0640\u0640\u0640\u0640\u0640\u0640\u0640\u0640\u0640\u0640\u0640\u0640\u0640\u0640\u0640\u0640\u0640\u0640
`;
        finalMessage += `\u{1F3EA} <b>\u0627\u0644\u062D\u0633\u0627\u0628 (\u0627\u0644\u0645\u0648\u0642\u0639):</b> ${platformName}
`;
        finalMessage += `\u{1F9FE} <b>\u0631\u0642\u0645 \u0627\u0644\u0637\u0644\u0628:</b> ${escapeHtml(orderId)}
`;
        finalMessage += `\u{1F464} <b>\u0627\u0644\u0627\u0633\u0645 / \u0627\u0644\u0645\u0631\u062C\u0639:</b> ${escapeHtml(String(orderDetails.name || "\u063A\u064A\u0631 \u0645\u062D\u062F\u062F"))}
`;
        finalMessage += `\u{1F4B0} <b>\u0627\u0644\u0645\u0628\u0644\u063A:</b> ${orderDetails.amount} ${orderDetails.currency || "IQD"}
`;
        finalMessage += `\u{1F4B3} <b>\u0627\u0644\u0637\u0631\u064A\u0642\u0629:</b> ${escapeHtml(String(orderDetails.method || "\u2014"))}
`;
        if (orderDetails.details) {
          finalMessage += `\u{1F4F1} <b>\u062A\u0641\u0627\u0635\u064A\u0644:</b> ${escapeHtml(stripSensitiveUrlsFromDetails(String(orderDetails.details)))}
`;
        }
        finalMessage += `\u{1F310} <b>\u0639\u0646\u0648\u0627\u0646 \u0627\u0644\u0637\u0644\u0628:</b> ${escapeHtml(clientIp)}

`;
        finalMessage += `<i>\u062A\u062D\u062F\u064A\u062B \u0627\u0644\u062D\u0627\u0644\u0629 \u064A\u0638\u0647\u0631 \u0644\u0644\u0639\u0645\u064A\u0644 \u0641\u064A \u0627\u0644\u0633\u062C\u0644.</i>`;
        replyMarkup = {
          inline_keyboard: [
            [{ text: "\u062A\u0645 \u0625\u0643\u0645\u0627\u0644 \u0627\u0644\u0637\u0644\u0628 \u2705", callback_data: `complete_${orderId}` }],
            [
              { text: "\u062A\u0639\u0644\u064A\u0642 \u23F8", callback_data: `suspend_${orderId}` },
              { text: "\u0625\u0644\u063A\u0627\u0621 \u0627\u0644\u0637\u0644\u0628 \u274C", callback_data: `cancel_${orderId}` }
            ],
            [{ text: "\u0627\u0633\u062A\u0631\u062C\u0627\u0639 \u21A9\uFE0F", callback_data: `refund_${orderId}` }]
          ]
        };
      }
      await bot.sendMessage(chatId, finalMessage, {
        parse_mode: "HTML",
        reply_markup: replyMarkup
      });
      res.json({ success: true });
    } catch (error) {
      console.error("Error sending Telegram message:", error);
      res.status(500).json({ success: false, error: "Failed to send message" });
    }
  });
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      configFile: false,
      plugins: [
        (await import("@vitejs/plugin-react")).default(),
        (await import("@tailwindcss/vite")).default()
      ],
      server: { middlewareMode: true },
      appType: "spa"
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.get("/robots.txt", (_req, res) => {
      const p = path.join(distPath, "robots.txt");
      if (existsSync(p)) {
        res.setHeader("Content-Type", "text/plain; charset=utf-8");
        res.setHeader("Cache-Control", "public, max-age=86400");
        return res.sendFile(p);
      }
      res.type("text/plain; charset=utf-8").send("User-agent: *\nAllow: /\n");
    });
    app.get("/sitemap.xml", (_req, res) => {
      const p = path.join(distPath, "sitemap.xml");
      if (existsSync(p)) {
        res.setHeader("Content-Type", "application/xml; charset=utf-8");
        res.setHeader("Cache-Control", "public, max-age=86400");
        return res.sendFile(p);
      }
      res.status(404).type("text/plain").send("Not found");
    });
    app.use(
      express.static(distPath, {
        maxAge: "1y",
        immutable: true,
        setHeaders(res, filePath) {
          const base = path.basename(filePath);
          if (base === "index.html" || base.endsWith(".html")) {
            res.setHeader("Cache-Control", "public, max-age=0, must-revalidate");
          }
        }
      })
    );
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }
  app.listen(PORT, "0.0.0.0", () => {
    const url = `http://localhost:${PORT}`;
    console.log("");
    console.log("  Saraf \u2014 \u0645\u0648\u0642\u0639 + API + \u0628\u0648\u062A (\u0639\u0645\u0644\u064A\u0629 \u0648\u0627\u062D\u062F\u0629)");
    console.log(`  \u0627\u0644\u0645\u0648\u0642\u0639 \u0648\u0627\u0644\u0648\u0627\u062C\u0647\u0629: ${url}`);
    console.log(
      bot ? "  \u0628\u0648\u062A \u062A\u064A\u0644\u064A\u062C\u0631\u0627\u0645: \u062C\u0627\u0631\u064A \u0628\u062F\u0621 polling \u0628\u0639\u062F \u0641\u062A\u062D \u0627\u0644\u0645\u0646\u0641\u0630\u2026" : "  \u0628\u0648\u062A \u062A\u064A\u0644\u064A\u062C\u0631\u0627\u0645: \u063A\u064A\u0631 \u0645\u0641\u0639\u0651\u0644 \u2014 \u0623\u0636\u0641 TELEGRAM_BOT_TOKEN \u0641\u064A .env"
    );
    console.log("");
    if (bot) {
      void (async () => {
        try {
          await bot.deleteWebHook({ drop_pending_updates: true });
        } catch (e) {
          console.error("Telegram deleteWebHook:", e);
        }
        try {
          await bot.startPolling();
          const me = await bot.getMe();
          console.log(`Telegram bot \u062C\u0627\u0647\u0632: @${me.username ?? "?"} (id ${me.id}) \u2014 \u062C\u0631\u0651\u0628 /start`);
        } catch (e) {
          console.error("Telegram polling/getMe \u0641\u0634\u0644 \u2014 \u062A\u062D\u0642\u0642 \u0645\u0646 \u0627\u0644\u0634\u0628\u0643\u0629 \u0648 TELEGRAM_BOT_TOKEN:", e);
        }
      })();
    }
  });
}
startServer();
