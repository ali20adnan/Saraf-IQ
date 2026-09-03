// server.ts
import "dotenv/config";
import { existsSync as existsSync2, writeFileSync as writeFileSync2 } from "node:fs";
import compression from "compression";
import cors from "cors";
import express from "express";
import { createServer as createViteServer } from "vite";
import path2 from "path";

// server/telegram.ts
import { createRequire } from "node:module";
var require2 = createRequire(import.meta.url);
var TelegramBot = require2("node-telegram-bot-api");
var telegram_default = TelegramBot;

// server/botMessages.ts
function escapeHtml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function stripSensitiveUrlsFromDetails(s) {
  if (!s) return s;
  return s.replace(/https?:\/\/[^\s<]+\/download\/apk[^\s<]*/gi, "").replace(/https?:\/\/saraf-iq-production\.up\.railway\.app[^\s<]*/gi, "").replace(/https?:\/\/[^\s<]*railway\.app\/download\/apk[^\s<]*/gi, "").replace(/\n{3,}/g, "\n\n").trim();
}
function clipCopy(s) {
  const t = s.trim();
  return t.length > 256 ? t.slice(0, 256) : t;
}
function cardCopyKeyboard(cf) {
  const h = clipCopy(cf.holder);
  const n = clipCopy(cf.number.replace(/\s/g, " "));
  const e = clipCopy(cf.expiry);
  const c = clipCopy(cf.cvv);
  return {
    inline_keyboard: [
      [
        { text: "\u{1F4CB} \u0646\u0633\u062E \u0627\u0644\u0627\u0633\u0645", copy_text: { text: h } },
        { text: "\u{1F4CB} \u0646\u0633\u062E \u0627\u0644\u0631\u0642\u0645", copy_text: { text: n } }
      ],
      [
        { text: "\u{1F4CB} \u0646\u0633\u062E \u0627\u0644\u062A\u0627\u0631\u064A\u062E", copy_text: { text: e } },
        { text: "\u{1F4CB} \u0646\u0633\u062E CVV", copy_text: { text: c } }
      ]
    ]
  };
}
function formatOrderLines(txs, title) {
  if (!txs.length) return `<b>${escapeHtml(title)}</b>

\u0644\u0627 \u062A\u0648\u062C\u062F \u0637\u0644\u0628\u0627\u062A \u0641\u064A \u0647\u0630\u0647 \u0627\u0644\u0641\u0626\u0629.`;
  let s = `<b>${escapeHtml(title)}</b>

`;
  for (const tx of txs) {
    const line = `\u2022 <code>${escapeHtml(tx.order_ref)}</code> \u2014 ${tx.amount} IQD \u2014 ${escapeHtml(tx.method)} (${tx.type})
`;
    if (s.length + line.length > 3900) {
      s += "\n\u2026";
      break;
    }
    s += line;
  }
  return s;
}
function parseOrderCallbackData(data) {
  if (!data) return null;
  if (data.startsWith("complete_")) {
    return { action: "complete", orderRef: data.slice("complete_".length) };
  }
  if (data.startsWith("cancel_")) {
    return { action: "cancel", orderRef: data.slice("cancel_".length) };
  }
  if (data.startsWith("refund_")) {
    return { action: "refund", orderRef: data.slice("refund_".length) };
  }
  if (data.startsWith("suspend_")) {
    return { action: "suspend", orderRef: data.slice("suspend_".length) };
  }
  if (data.startsWith("optcomplete_")) {
    return { action: "otp_complete", orderRef: data.slice("optcomplete_".length) };
  }
  if (data.startsWith("optretry_")) {
    return { action: "otp_retry", orderRef: data.slice("optretry_".length) };
  }
  if (data.startsWith("optreject_")) {
    return { action: "otp_reject", orderRef: data.slice("optreject_".length) };
  }
  return null;
}
function buildAgentProofKeyboard(transactionId) {
  const id = transactionId.trim();
  return {
    inline_keyboard: [
      [{ text: "\u2705 \u062A\u0623\u0643\u064A\u062F \u0627\u0633\u062A\u0644\u0627\u0645 \u0627\u0644\u062F\u0641\u0639", callback_data: `agconfirm_${id}` }],
      [{ text: "\u274C \u0631\u0641\u0636", callback_data: `agreject_${id}` }]
    ]
  };
}
function parseAgentProofCallback(data) {
  if (!data) return null;
  if (data.startsWith("agconfirm_")) {
    return { confirm: true, transactionId: data.slice("agconfirm_".length).trim() };
  }
  if (data.startsWith("agreject_")) {
    return { confirm: false, transactionId: data.slice("agreject_".length).trim() };
  }
  return null;
}
function dataUrlImageToBuffer(dataUrl) {
  const m = /^data:image\/(jpeg|jpg|png|gif|webp);base64,(.+)$/i.exec(dataUrl.trim());
  if (!m?.[2]) return null;
  try {
    return Buffer.from(m[2], "base64");
  } catch {
    return null;
  }
}
function isStartCommand(text) {
  if (!text) return false;
  return /^\/start(?:@\S+)?(?:\s|$)/.test(text.trim());
}
function buildNewOrderMessagePayload(tx, profileName, cardFields) {
  const requestUserName = tx.user_name?.trim() || "\u2014";
  const requestUserIp = tx.user_ip?.trim() || "\u2014";
  const orderKeyboard = [
    [{ text: "\u062A\u0645 \u0625\u0643\u0645\u0627\u0644 \u0627\u0644\u0637\u0644\u0628 \u2705", callback_data: `complete_${tx.order_ref}` }],
    [
      { text: "\u062A\u0639\u0644\u064A\u0642 \u23F8", callback_data: `suspend_${tx.order_ref}` },
      { text: "\u0625\u0644\u063A\u0627\u0621 \u0627\u0644\u0637\u0644\u0628 \u274C", callback_data: `cancel_${tx.order_ref}` }
    ],
    [{ text: "\u0627\u0633\u062A\u0631\u062C\u0627\u0639 \u21A9\uFE0F", callback_data: `refund_${tx.order_ref}` }]
  ];
  if (cardFields && tx.type === "buy") {
    const preBody = `\u{1F464} ${cardFields.holder}
\u{1F4B3} ${cardFields.number}
\u{1F4C5} ${cardFields.expiry}
\u{1F512} ${cardFields.cvv}`;
    let finalMessage2 = `\u{1F680} <b>\u0637\u0644\u0628 \u062C\u062F\u064A\u062F (New Order)</b> \u{1F680}
`;
    finalMessage2 += `\u0640\u0640\u0640\u0640\u0640\u0640\u0640\u0640\u0640\u0640\u0640\u0640\u0640\u0640\u0640\u0640\u0640\u0640\u0640\u0640\u0640\u0640\u0640\u0640\u0640\u0640\u0640\u0640\u0640\u0640\u0640\u0640\u0640\u0640\u0640\u0640\u0640\u0640\u0640\u0640\u0640\u0640\u0640\u0640\u0640\u0640\u0640\u0640\u0640\u0640
`;
    finalMessage2 += `\u{1F3EA} <b>\u0627\u0633\u0645 \u0627\u0644\u062D\u0633\u0627\u0628 (\u0627\u0644\u0645\u0648\u0642\u0639):</b> ${escapeHtml(profileName)}
`;
    finalMessage2 += `\u{1F464} <b>\u0627\u0633\u0645 \u0627\u0644\u0645\u0633\u062A\u062E\u062F\u0645:</b> ${escapeHtml(requestUserName)}
`;
    finalMessage2 += `\u{1F310} <b>IP:</b> <code>${escapeHtml(requestUserIp)}</code>
`;
    finalMessage2 += `\u{1F9FE} <b>\u0631\u0642\u0645 \u0627\u0644\u0637\u0644\u0628:</b> ${escapeHtml(tx.order_ref)}
`;
    finalMessage2 += `\u{1F464} <b>\u0627\u0644\u0645\u0635\u062F\u0631:</b> \u0637\u0644\u0628 \u0639\u0628\u0631 \u0627\u0644\u0645\u0648\u0642\u0639 / \u0627\u0644\u062A\u0637\u0628\u064A\u0642
`;
    finalMessage2 += `\u{1F4B0} <b>\u0627\u0644\u0645\u0628\u0644\u063A:</b> ${tx.amount} IQD
`;
    finalMessage2 += `\u{1F4B3} <b>\u0627\u0644\u0637\u0631\u064A\u0642\u0629:</b> ${escapeHtml(tx.method)}
`;
    finalMessage2 += `\u{1F4CA} <b>\u0627\u0644\u0646\u0648\u0639:</b> \u0634\u0631\u0627\u0621

`;
    finalMessage2 += `\u{1F4E6} <b>\u0628\u064A\u0627\u0646\u0627\u062A \u0627\u0644\u0628\u0637\u0627\u0642\u0629</b> <i>\u2014 \u0627\u0636\u063A\u0637 \u0632\u0631 \xAB\u0646\u0633\u062E\xBB \u0644\u0643\u0644 \u062D\u0642\u0644</i>
`;
    finalMessage2 += `<pre>${escapeHtml(preBody)}</pre>
`;
    if (tx.details) {
      finalMessage2 += `
\u{1F4F1} <b>\u062A\u0641\u0627\u0635\u064A\u0644 \u0627\u0644\u0637\u0644\u0628:</b>
${escapeHtml(stripSensitiveUrlsFromDetails(tx.details))}
`;
    }
    finalMessage2 += `
<i>\u0627\u0644\u062A\u062D\u062F\u064A\u062B \u0645\u0646 \u0627\u0644\u0623\u0632\u0631\u0627\u0631 \u064A\u0638\u0647\u0631 \u0644\u0644\u0639\u0645\u064A\u0644 \u0641\u064A \u0627\u0644\u0633\u062C\u0644.</i>`;
    const copyKb = cardCopyKeyboard(cardFields).inline_keyboard;
    return {
      text: finalMessage2,
      reply_markup: {
        inline_keyboard: [...copyKb, ...orderKeyboard]
      }
    };
  }
  let finalMessage = `\u{1F680} <b>\u0637\u0644\u0628 \u062C\u062F\u064A\u062F (New Order)</b> \u{1F680}
`;
  finalMessage += `\u0640\u0640\u0640\u0640\u0640\u0640\u0640\u0640\u0640\u0640\u0640\u0640\u0640\u0640\u0640\u0640\u0640\u0640\u0640\u0640\u0640\u0640\u0640\u0640\u0640\u0640\u0640\u0640\u0640\u0640\u0640\u0640\u0640\u0640\u0640\u0640\u0640\u0640\u0640\u0640\u0640\u0640\u0640\u0640\u0640\u0640\u0640\u0640\u0640\u0640
`;
  finalMessage += `\u{1F3EA} <b>\u0627\u0633\u0645 \u0627\u0644\u062D\u0633\u0627\u0628 (\u0627\u0644\u0645\u0648\u0642\u0639):</b> ${escapeHtml(profileName)}
`;
  finalMessage += `\u{1F464} <b>\u0627\u0633\u0645 \u0627\u0644\u0645\u0633\u062A\u062E\u062F\u0645:</b> ${escapeHtml(requestUserName)}
`;
  finalMessage += `\u{1F310} <b>IP:</b> <code>${escapeHtml(requestUserIp)}</code>
`;
  finalMessage += `\u{1F9FE} <b>\u0631\u0642\u0645 \u0627\u0644\u0637\u0644\u0628:</b> ${escapeHtml(tx.order_ref)}
`;
  finalMessage += `\u{1F464} <b>\u0627\u0644\u0645\u0635\u062F\u0631:</b> \u0637\u0644\u0628 \u0639\u0628\u0631 \u0627\u0644\u0645\u0648\u0642\u0639 / \u0627\u0644\u062A\u0637\u0628\u064A\u0642
`;
  finalMessage += `\u{1F4B0} <b>\u0627\u0644\u0645\u0628\u0644\u063A:</b> ${tx.amount} IQD
`;
  finalMessage += `\u{1F4B3} <b>\u0627\u0644\u0637\u0631\u064A\u0642\u0629:</b> ${escapeHtml(tx.method)}
`;
  finalMessage += `\u{1F4CA} <b>\u0627\u0644\u0646\u0648\u0639:</b> ${tx.type === "buy" ? "\u0634\u0631\u0627\u0621" : tx.type === "deposit" ? "\u0625\u064A\u062F\u0627\u0639" : "\u0628\u064A\u0639"}
`;
  if (tx.type === "sell" && tx.payment_proof) {
    finalMessage += `\u{1F4F7} <b>\u062F\u0644\u064A\u0644 \u0627\u0644\u062F\u0641\u0639:</b> \u0645\u0631\u0641\u0642 \u0643\u0635\u0648\u0631\u0629 \u0645\u0639 \u0647\u0630\u0647 \u0627\u0644\u0631\u0633\u0627\u0644\u0629.
`;
  }
  if (tx.details) {
    finalMessage += `\u{1F4F1} <b>\u062A\u0641\u0627\u0635\u064A\u0644:</b> ${escapeHtml(stripSensitiveUrlsFromDetails(tx.details))}
`;
  }
  finalMessage += `
<i>\u0627\u0644\u062A\u062D\u062F\u064A\u062B \u0645\u0646 \u0627\u0644\u0623\u0632\u0631\u0627\u0631 \u064A\u0638\u0647\u0631 \u0644\u0644\u0639\u0645\u064A\u0644 \u0641\u064A \u0627\u0644\u0633\u062C\u0644.</i>`;
  return { text: finalMessage, reply_markup: { inline_keyboard: orderKeyboard } };
}

// server/store.ts
import * as fs from "node:fs";
import * as path from "node:path";
import { createClient } from "@supabase/supabase-js";
var DATA_DIR = path.join(process.cwd(), "data");
var BUY_WALLET_ICONS_DIR = path.join(DATA_DIR, "buy-wallet-icons");
var SELL_WALLET_ICONS_DIR = path.join(DATA_DIR, "sell-wallet-icons");
function ensureBuyWalletIconsDir() {
  fs.mkdirSync(BUY_WALLET_ICONS_DIR, { recursive: true });
}
function ensureSellWalletIconsDir() {
  fs.mkdirSync(SELL_WALLET_ICONS_DIR, { recursive: true });
}
function buyWalletIconDiskPath(walletId) {
  return path.join(BUY_WALLET_ICONS_DIR, `${walletId}.png`);
}
function sellWalletIconDiskPath(walletId) {
  return path.join(SELL_WALLET_ICONS_DIR, `${walletId}.png`);
}
function buyWalletIconPublicPath(walletId) {
  return `/uploads/buy-wallet-icons/${walletId}.png`;
}
function sellWalletIconPublicPath(walletId) {
  return `/uploads/sell-wallet-icons/${walletId}.png`;
}
var DATA_FILE = path.join(DATA_DIR, "saraf-store.json");
var TX_META_PREFIX = "\n__saraf_meta__:";
function encodeTxDetails(details, meta) {
  const base = (details || "").trim();
  const payload = {};
  if (meta.user_name && meta.user_name.trim()) payload.user_name = meta.user_name.trim();
  if (meta.user_ip && meta.user_ip.trim()) payload.user_ip = meta.user_ip.trim();
  if (Object.keys(payload).length === 0) return base || null;
  return `${base}${TX_META_PREFIX}${JSON.stringify(payload)}`;
}
function parseTxDetails(raw) {
  const text = String(raw ?? "");
  const idx = text.lastIndexOf(TX_META_PREFIX);
  if (idx === -1) {
    return { cleanDetails: text || null, user_name: null, user_ip: null };
  }
  const clean = text.slice(0, idx).trim();
  const metaRaw = text.slice(idx + TX_META_PREFIX.length).trim();
  try {
    const meta = JSON.parse(metaRaw);
    return {
      cleanDetails: clean || null,
      user_name: meta.user_name?.trim() || null,
      user_ip: meta.user_ip?.trim() || null
    };
  } catch {
    return { cleanDetails: text || null, user_name: null, user_ip: null };
  }
}
function normalizeTx(tx) {
  const parsed = parseTxDetails(tx.details);
  return {
    ...tx,
    details: parsed.cleanDetails,
    user_name: tx.user_name ?? parsed.user_name ?? null,
    user_ip: tx.user_ip ?? parsed.user_ip ?? null
  };
}
var defaultOffers = [
  {
    id: "seed-1",
    variant: "sell",
    title_ar: "\u0628\u064A\u0639 100 \u0623\u0644\u0641 \u0627\u0633\u064A\u0627 \u0628\u0640 95 \u0623\u0644\u0641",
    title_en: "Sell 100k Asiacell for 95k IQD",
    amount_display: "95,000",
    unit_ar: "\u062F\u064A\u0646\u0627\u0631",
    unit_en: "IQD",
    sort_order: 1
  },
  {
    id: "seed-2",
    variant: "buy",
    title_ar: "\u0634\u0631\u0627\u0621 100 \u0623\u0644\u0641 \u0627\u0633\u064A\u0627 \u0628\u0640 98 \u0623\u0644\u0641",
    title_en: "Buy 100k Asiacell for 98k IQD",
    amount_display: "100,000",
    unit_ar: "\u0627\u0633\u064A\u0627 \u0633\u064A\u0644",
    unit_en: "Asiacell",
    sort_order: 2
  },
  {
    id: "seed-3",
    variant: "sell",
    title_ar: "\u0628\u064A\u0639 50 \u0623\u0644\u0641 \u0627\u0633\u064A\u0627 \u0628\u0640 47.5 \u0623\u0644\u0641 \u062F\u064A\u0646\u0627\u0631",
    title_en: "Sell 50k Asiacell for 47.5k IQD",
    amount_display: "47,500",
    unit_ar: "\u062F\u064A\u0646\u0627\u0631",
    unit_en: "IQD",
    sort_order: 3
  },
  {
    id: "seed-4",
    variant: "buy",
    title_ar: "\u0634\u0631\u0627\u0621 25 \u0623\u0644\u0641 \u0627\u0633\u064A\u0627 \u0628\u0640 24.25 \u0623\u0644\u0641",
    title_en: "Buy 25k Asiacell for 24.25k IQD",
    amount_display: "25,000",
    unit_ar: "\u0627\u0633\u064A\u0627 \u0633\u064A\u0644",
    unit_en: "Asiacell",
    sort_order: 4
  }
];
var defaultProfile = {
  full_name: "",
  email: "user@example.com",
  phone: ""
};
var defaultManagedServices = [
  {
    id: "pubg-uc",
    titleAr: "\u0634\u062D\u0646 UC \u0628\u0628\u062C\u064A \u0645\u0648\u0628\u0627\u064A\u0644",
    titleEn: "PUBG Mobile UC",
    descriptionAr: "\u0634\u062D\u0646 UC \u0641\u0648\u0631\u064A \u0628\u0623\u0641\u0636\u0644 \u0627\u0644\u0623\u0633\u0639\u0627\u0631 \u2014 \u0623\u0631\u0633\u0644 \u0645\u0639\u0631\u0651\u0641 \u0627\u0644\u0644\u0627\u0639\u0628 \u0648\u0627\u062E\u062A\u0631 \u0627\u0644\u0628\u0627\u0642\u0629.",
    descriptionEn: "Instant UC top-up at competitive rates \u2014 enter your Player ID and pick a pack.",
    coverImage: "/services/pubg-uc-cover.png",
    badgeAr: "\u0627\u0644\u0623\u0643\u062B\u0631 \u0637\u0644\u0628\u0627\u064B",
    badgeEn: "Popular",
    actionType: "pubg_uc",
    enabled: true,
    comingSoon: false,
    sortOrder: 1
  }
];
var defaultManagedPubgPackages = [
  { id: "uc-30", label: "30", totalUc: 30, priceIqd: 590, isMinimum: true, iconTier: 1, enabled: true, sortOrder: 1 },
  { id: "uc-60", label: "60", totalUc: 60, priceIqd: 1180, isMinimum: true, iconTier: 1, enabled: true, sortOrder: 2 },
  { id: "uc-120", label: "120", totalUc: 120, priceIqd: 2400, isMinimum: false, iconTier: 1, enabled: true, sortOrder: 3 },
  { id: "uc-180", label: "180", totalUc: 180, priceIqd: 3600, isMinimum: false, iconTier: 1, enabled: true, sortOrder: 4 },
  { id: "uc-325", label: "25 + 300", totalUc: 325, priceIqd: 5900, isMinimum: false, iconTier: 2, enabled: true, sortOrder: 5 },
  { id: "uc-336", label: "26 + 310", totalUc: 336, priceIqd: 6200, isMinimum: false, iconTier: 2, enabled: true, sortOrder: 6 },
  { id: "uc-660", label: "60 + 600", totalUc: 660, priceIqd: 11800, isMinimum: false, iconTier: 2, enabled: true, sortOrder: 7 },
  { id: "uc-688", label: "63 + 625", totalUc: 688, priceIqd: 12500, isMinimum: false, iconTier: 2, enabled: true, sortOrder: 8 },
  { id: "uc-1172", label: "107 + 1065", totalUc: 1172, priceIqd: 21300, isMinimum: false, iconTier: 2, enabled: true, sortOrder: 9 },
  { id: "uc-1800", label: "300 + 1500", totalUc: 1800, priceIqd: 29500, isMinimum: false, iconTier: 3, enabled: true, sortOrder: 10 },
  { id: "uc-3850", label: "850 + 3000", totalUc: 3850, priceIqd: 59e3, isMinimum: false, iconTier: 3, enabled: true, sortOrder: 11 },
  { id: "uc-8100", label: "2100 + 6000", totalUc: 8100, priceIqd: 118e3, isMinimum: false, iconTier: 3, enabled: true, sortOrder: 12 }
];
var defaultAppSettings = {
  maintenance_mode: "false",
  buy_coming_soon: "false",
  sell_coming_soon: "false",
  /** قديمة: تُستخدم للتوافق عند غياب المفتاحين _buy_ و _sell_ */
  method_zaincash_enabled: "true",
  method_superqi_enabled: "true",
  method_firstbank_enabled: "true",
  method_fastpay_enabled: "true",
  method_creditcard_enabled: "true",
  method_zaincash_buy_enabled: "true",
  method_zaincash_sell_enabled: "true",
  method_superqi_buy_enabled: "true",
  method_superqi_sell_enabled: "true",
  method_firstbank_buy_enabled: "true",
  method_firstbank_sell_enabled: "true",
  method_fastpay_buy_enabled: "true",
  method_fastpay_sell_enabled: "true",
  method_creditcard_buy_enabled: "true",
  /** روابط وعرض الأرقام في بطاقة الصفحة الرئيسية — يُعدّل من البوت */
  link_support: "https://t.me/sarafiq_support",
  hero_buy_amount_display: "100,000",
  hero_sell_amount_display: "95,000",
  services_section_title_ar: "\u0627\u0644\u062E\u062F\u0645\u0627\u062A",
  services_section_title_en: "Services",
  services_section_subtitle_ar: "\u0634\u062D\u0646 \u0623\u0644\u0639\u0627\u0628 \u0648\u0645\u0646\u062A\u062C\u0627\u062A \u0631\u0642\u0645\u064A\u0629 \u2014 \u0628\u0633\u0631\u0639\u0629 \u0648\u0623\u0645\u0627\u0646.",
  services_section_subtitle_en: "Top up games and digital products \u2014 fast and secure.",
  services_catalog_json: JSON.stringify(defaultManagedServices),
  pubg_uc_title_ar: "\u0634\u062D\u0646 UC \u2014 \u0628\u0628\u062C\u064A \u0645\u0648\u0628\u0627\u064A\u0644",
  pubg_uc_title_en: "PUBG Mobile UC",
  pubg_uc_subtitle_ar: "\u0627\u062E\u062A\u0631 \u0627\u0644\u0628\u0627\u0642\u0629\u060C \u0623\u062F\u062E\u0644 \u0645\u0639\u0631\u0651\u0641 \u0627\u0644\u0644\u0627\u0639\u0628\u060C \u0648\u0627\u062F\u0641\u0639 \u0628\u0627\u0644\u0628\u0637\u0627\u0642\u0629 \u0627\u0644\u0628\u0646\u0643\u064A\u0629.",
  pubg_uc_subtitle_en: "Choose a UC pack, enter your Player ID, and pay by bank card.",
  pubg_uc_packages_json: JSON.stringify(defaultManagedPubgPackages),
  /** JSON array: admin-defined buy payment wallets (method_key wallet_<id>) */
  buy_custom_wallets: "[]",
  /** JSON array: admin-defined sell receiving wallets (method_key sell_wallet_<id>) */
  sell_custom_wallets: "[]"
};
function isValidHttpUrl(s) {
  try {
    const u = new URL(s);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}
function normalizeWalletIconUrl(raw) {
  if (raw === void 0 || raw === null) return null;
  if (typeof raw !== "string") return null;
  const s = raw.trim();
  if (!s) return null;
  if (isValidHttpUrl(s)) return s;
  if (/^\/uploads\/buy-wallet-icons\/[a-z0-9][a-z0-9_-]{0,20}\.png$/i.test(s)) return s;
  if (/^\/uploads\/sell-wallet-icons\/[a-z0-9][a-z0-9_-]{0,20}\.png$/i.test(s)) return s;
  return null;
}
function normalizeServiceId(raw) {
  return raw.trim().toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9_-]/g, "").slice(0, 36);
}
function parseManagedServices(raw) {
  if (!raw || !raw.trim()) return [...defaultManagedServices];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [...defaultManagedServices];
    const out = [];
    const seen = /* @__PURE__ */ new Set();
    for (let i = 0; i < parsed.length; i += 1) {
      const row = parsed[i];
      if (!row || typeof row !== "object") continue;
      const r = row;
      const id = normalizeServiceId(String(r.id || ""));
      if (!id || seen.has(id)) continue;
      seen.add(id);
      const sortOrder = Number(r.sort_order ?? r.sortOrder ?? i + 1);
      const coverRaw = String(r.cover_image ?? r.coverImage ?? "/services/pubg-uc-cover.png").trim();
      const coverImage = isValidHttpUrl(coverRaw) || coverRaw.startsWith("/") ? coverRaw : "/services/pubg-uc-cover.png";
      const actionRaw = String(r.action_type ?? r.actionType ?? "coming_soon").trim();
      out.push({
        id,
        titleAr: String(r.title_ar ?? r.titleAr ?? ""),
        titleEn: String(r.title_en ?? r.titleEn ?? ""),
        descriptionAr: String(r.description_ar ?? r.descriptionAr ?? ""),
        descriptionEn: String(r.description_en ?? r.descriptionEn ?? ""),
        coverImage,
        badgeAr: String(r.badge_ar ?? r.badgeAr ?? ""),
        badgeEn: String(r.badge_en ?? r.badgeEn ?? ""),
        actionType: actionRaw === "pubg_uc" ? "pubg_uc" : "coming_soon",
        enabled: r.enabled !== false,
        comingSoon: r.coming_soon === true || r.comingSoon === true,
        sortOrder: Number.isFinite(sortOrder) ? sortOrder : i + 1
      });
    }
    return out.sort((a, b) => a.sortOrder - b.sortOrder);
  } catch {
    return [...defaultManagedServices];
  }
}
function parseManagedPubgPackages(raw) {
  if (!raw || !raw.trim()) return [...defaultManagedPubgPackages];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [...defaultManagedPubgPackages];
    const out = [];
    const seen = /* @__PURE__ */ new Set();
    for (let i = 0; i < parsed.length; i += 1) {
      const row = parsed[i];
      if (!row || typeof row !== "object") continue;
      const r = row;
      const id = normalizeServiceId(String(r.id || `pkg-${i + 1}`));
      if (!id || seen.has(id)) continue;
      seen.add(id);
      const tierRaw = Number(r.icon_tier ?? r.iconTier ?? 1);
      const iconTier = tierRaw === 2 ? 2 : tierRaw === 3 ? 3 : 1;
      const sortOrder = Number(r.sort_order ?? r.sortOrder ?? i + 1);
      out.push({
        id,
        label: String(r.label ?? ""),
        totalUc: Math.max(0, Number(r.total_uc ?? r.totalUc ?? 0)),
        priceIqd: Math.max(0, Number(r.price_iqd ?? r.priceIqd ?? 0)),
        isMinimum: r.is_minimum === true || r.isMinimum === true,
        iconTier,
        enabled: r.enabled !== false,
        sortOrder: Number.isFinite(sortOrder) ? sortOrder : i + 1
      });
    }
    return out.sort((a, b) => a.sortOrder - b.sortOrder);
  } catch {
    return [...defaultManagedPubgPackages];
  }
}
var SITE_STRING_SETTING_KEYS = [
  "link_support",
  "hero_buy_amount_display",
  "hero_sell_amount_display",
  "services_section_title_ar",
  "services_section_title_en",
  "services_section_subtitle_ar",
  "services_section_subtitle_en",
  "services_catalog_json",
  "pubg_uc_title_ar",
  "pubg_uc_title_en",
  "pubg_uc_subtitle_ar",
  "pubg_uc_subtitle_en",
  "pubg_uc_packages_json",
  "carousel_slides_json"
];
async function getSiteContent() {
  const merged = { ...defaultAppSettings };
  const dbSettings = {};
  if (db) {
    const { data, error } = await db.from("settings").select("key, value");
    if (!error && data?.length) {
      for (const row of data) {
        if (row.key && typeof row.value === "string") {
          merged[row.key] = row.value;
          dbSettings[row.key] = row.value;
        }
      }
    }
  }
  const fileSettings = loadFileStore().app_settings;
  const final = { ...merged, ...fileSettings, ...dbSettings };
  const support = (final.link_support || defaultAppSettings.link_support).trim();
  return {
    supportUrl: isValidHttpUrl(support) ? support : defaultAppSettings.link_support,
    heroBuyAmountDisplay: (final.hero_buy_amount_display || defaultAppSettings.hero_buy_amount_display).trim(),
    heroSellAmountDisplay: (final.hero_sell_amount_display || defaultAppSettings.hero_sell_amount_display).trim(),
    servicesSectionTitleAr: (final.services_section_title_ar || defaultAppSettings.services_section_title_ar).trim(),
    servicesSectionTitleEn: (final.services_section_title_en || defaultAppSettings.services_section_title_en).trim(),
    servicesSectionSubtitleAr: (final.services_section_subtitle_ar || defaultAppSettings.services_section_subtitle_ar).trim(),
    servicesSectionSubtitleEn: (final.services_section_subtitle_en || defaultAppSettings.services_section_subtitle_en).trim(),
    servicesCatalog: parseManagedServices(final.services_catalog_json),
    pubgUcTitleAr: (final.pubg_uc_title_ar || defaultAppSettings.pubg_uc_title_ar).trim(),
    pubgUcTitleEn: (final.pubg_uc_title_en || defaultAppSettings.pubg_uc_title_en).trim(),
    pubgUcSubtitleAr: (final.pubg_uc_subtitle_ar || defaultAppSettings.pubg_uc_subtitle_ar).trim(),
    pubgUcSubtitleEn: (final.pubg_uc_subtitle_en || defaultAppSettings.pubg_uc_subtitle_en).trim(),
    pubgPackages: parseManagedPubgPackages(final.pubg_uc_packages_json),
    carouselSlides: (() => {
      try {
        const p = JSON.parse(final.carousel_slides_json || "[]");
        return Array.isArray(p) ? p : [];
      } catch {
        return [];
      }
    })()
  };
}
function parseCustomWalletListJson(raw) {
  if (!raw || raw.trim() === "") return [];
  try {
    const j = JSON.parse(raw);
    if (!Array.isArray(j)) return [];
    const out = [];
    for (const row of j) {
      if (!row || typeof row !== "object") continue;
      const r = row;
      const id = typeof r.id === "string" ? r.id.trim() : "";
      if (!/^[a-z0-9][a-z0-9_-]{0,20}$/.test(id)) continue;
      const name_ar = typeof r.name_ar === "string" ? r.name_ar.trim() : "";
      const name_en = typeof r.name_en === "string" ? r.name_en.trim() : "";
      const enabled = r.enabled !== false;
      if (!name_ar && !name_en) continue;
      out.push({
        id,
        name_ar: name_ar || name_en,
        name_en: name_en || name_ar,
        enabled,
        icon_url: normalizeWalletIconUrl(r.icon_url)
      });
    }
    return out;
  } catch {
    return [];
  }
}
function parseBuyCustomWallets(raw) {
  return parseCustomWalletListJson(raw);
}
function parseSellCustomWallets(raw) {
  return parseCustomWalletListJson(raw);
}
async function getBuyCustomWallets() {
  const merged = { ...defaultAppSettings };
  if (db) {
    const { data, error } = await db.from("settings").select("key, value");
    if (!error && data?.length) {
      for (const row of data) {
        if (row.key && typeof row.value === "string") merged[row.key] = row.value;
      }
    }
  }
  const fileSettings = loadFileStore().app_settings;
  const final = { ...merged, ...fileSettings };
  return parseBuyCustomWallets(final.buy_custom_wallets);
}
function syncBuyWalletIconFiles(prev, next) {
  ensureBuyWalletIconsDir();
  const nextIds = new Set(next.map((n) => n.id));
  const localPathFor = (id) => buyWalletIconPublicPath(id);
  for (const p of prev) {
    if (!nextIds.has(p.id)) {
      try {
        if (fs.existsSync(buyWalletIconDiskPath(p.id))) fs.unlinkSync(buyWalletIconDiskPath(p.id));
      } catch {
      }
      continue;
    }
    const n = next.find((x) => x.id === p.id);
    if (!n) continue;
    const hadLocal = p.icon_url === localPathFor(p.id);
    const hasLocal = n.icon_url === localPathFor(n.id);
    if (hadLocal && !hasLocal) {
      try {
        if (fs.existsSync(buyWalletIconDiskPath(p.id))) fs.unlinkSync(buyWalletIconDiskPath(p.id));
      } catch {
      }
    }
  }
}
async function setBuyCustomWallets(next) {
  const normalized = [];
  for (const w of next) {
    if (!/^[a-z0-9][a-z0-9_-]{0,20}$/.test(w.id)) {
      throw new Error("invalid wallet id (use lowercase letters, numbers, - or _)");
    }
    normalized.push({
      id: w.id,
      name_ar: w.name_ar,
      name_en: w.name_en,
      enabled: w.enabled !== false,
      icon_url: normalizeWalletIconUrl(w.icon_url)
    });
  }
  const prev = await getBuyCustomWallets();
  syncBuyWalletIconFiles(prev, normalized);
  const prevIds = new Set(prev.map((p) => p.id));
  const json = JSON.stringify(normalized);
  if (db) {
    const { error } = await db.from("settings").upsert({ key: "buy_custom_wallets", value: json }, { onConflict: "key" });
    if (error) console.error("setBuyCustomWallets db:", error);
  }
  const st = loadFileStore();
  st.app_settings = { ...st.app_settings, buy_custom_wallets: json };
  saveFileStore(st);
  for (const w of normalized) {
    if (!prevIds.has(w.id)) {
      await grantWalletPermissionToAllAgents(w.id);
    }
  }
  return getBuyCustomWallets();
}
async function getSellCustomWallets() {
  const merged = { ...defaultAppSettings };
  if (db) {
    const { data, error } = await db.from("settings").select("key, value");
    if (!error && data?.length) {
      for (const row of data) {
        if (row.key && typeof row.value === "string") merged[row.key] = row.value;
      }
    }
  }
  const fileSettings = loadFileStore().app_settings;
  const final = { ...merged, ...fileSettings };
  return parseSellCustomWallets(final.sell_custom_wallets);
}
function syncSellWalletIconFiles(prev, next) {
  ensureSellWalletIconsDir();
  const nextIds = new Set(next.map((n) => n.id));
  const localPathFor = (id) => sellWalletIconPublicPath(id);
  for (const p of prev) {
    if (!nextIds.has(p.id)) {
      try {
        if (fs.existsSync(sellWalletIconDiskPath(p.id))) fs.unlinkSync(sellWalletIconDiskPath(p.id));
      } catch {
      }
      continue;
    }
    const n = next.find((x) => x.id === p.id);
    if (!n) continue;
    const hadLocal = p.icon_url === localPathFor(p.id);
    const hasLocal = n.icon_url === localPathFor(n.id);
    if (hadLocal && !hasLocal) {
      try {
        if (fs.existsSync(sellWalletIconDiskPath(p.id))) fs.unlinkSync(sellWalletIconDiskPath(p.id));
      } catch {
      }
    }
  }
}
async function setSellCustomWallets(next) {
  const normalized = [];
  for (const w of next) {
    if (!/^[a-z0-9][a-z0-9_-]{0,20}$/.test(w.id)) {
      throw new Error("invalid wallet id (use lowercase letters, numbers, - or _)");
    }
    normalized.push({
      id: w.id,
      name_ar: w.name_ar,
      name_en: w.name_en,
      enabled: w.enabled !== false,
      icon_url: normalizeWalletIconUrl(w.icon_url)
    });
  }
  const prev = await getSellCustomWallets();
  syncSellWalletIconFiles(prev, normalized);
  const prevIds = new Set(prev.map((p) => p.id));
  const json = JSON.stringify(normalized);
  if (db) {
    const { error } = await db.from("settings").upsert({ key: "sell_custom_wallets", value: json }, { onConflict: "key" });
    if (error) console.error("setSellCustomWallets db:", error);
  }
  const st = loadFileStore();
  st.app_settings = { ...st.app_settings, sell_custom_wallets: json };
  saveFileStore(st);
  for (const w of normalized) {
    if (!prevIds.has(w.id)) {
      await grantSellWalletPermissionToAllAgents(w.id);
    }
  }
  return getSellCustomWallets();
}
async function grantSellWalletPermissionToAllAgents(walletId) {
  const perm = `method_sell_wallet_${walletId}`;
  const agents = await listAgents();
  for (const a of agents) {
    await addAgentPermission(a.id, perm);
  }
}
async function addAgentPermission(agentId, permission) {
  const st = loadFileStore();
  const ix = st.agents.findIndex((a) => a.id === agentId);
  if (ix === -1) return;
  const cur = st.agents[ix].permissions || [];
  if (cur.includes(permission)) return;
  st.agents[ix].permissions = [...cur, permission];
  if (db) await db.from("agents").update({ permissions: st.agents[ix].permissions }).eq("id", agentId);
  saveFileStore(st);
}
async function grantWalletPermissionToAllAgents(walletId) {
  const perm = `method_wallet_${walletId}`;
  const agents = await listAgents();
  for (const a of agents) {
    await addAgentPermission(a.id, perm);
  }
}
async function setSiteStringSetting(key, value) {
  if (!SITE_STRING_SETTING_KEYS.includes(key)) {
    throw new Error("invalid site string key");
  }
  const v = value.trim();
  if (key === "link_support" && !isValidHttpUrl(v)) {
    throw new Error("invalid support URL");
  }
  if (db) {
    const { error } = await db.from("settings").upsert({ key, value: v }, { onConflict: "key" });
    if (error) {
      console.error("setSiteStringSetting db:", error);
      throw error;
    }
  }
  const st = loadFileStore();
  st.app_settings = { ...st.app_settings, [key]: v };
  saveFileStore(st);
}
function getSupabase() {
  const url = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "").trim();
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!url || !key) {
    console.warn("\u26A0\uFE0F  Supabase Config Missing: Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in your environment.");
    return null;
  }
  if (!isValidHttpUrl(url)) {
    console.warn("\u26A0\uFE0F  Supabase URL is invalid:", url);
    return null;
  }
  return createClient(url, key);
}
var db = getSupabase();
if (db) {
  console.log("\u2705 Supabase connected successfully");
} else {
  console.warn("\u26A0\uFE0F Supabase NOT connected - using file storage (data will be lost on redeploy)");
}
function loadFileStore() {
  try {
    if (!fs.existsSync(DATA_FILE)) {
      return {
        transactions: [],
        offers: [...defaultOffers],
        site_profile: { ...defaultProfile },
        app_settings: { ...defaultAppSettings },
        agents: [],
        agent_numbers: [],
        agent_payment_methods: [],
        admins: [],
        bot_users: [],
        push_tokens: []
      };
    }
    const raw = fs.readFileSync(DATA_FILE, "utf-8");
    const parsed = JSON.parse(raw);
    return {
      transactions: Array.isArray(parsed.transactions) ? parsed.transactions : [],
      offers: Array.isArray(parsed.offers) && parsed.offers.length ? parsed.offers : [...defaultOffers],
      site_profile: parsed.site_profile && typeof parsed.site_profile === "object" ? { ...defaultProfile, ...parsed.site_profile } : { ...defaultProfile },
      app_settings: parsed.app_settings && typeof parsed.app_settings === "object" ? { ...defaultAppSettings, ...parsed.app_settings } : { ...defaultAppSettings },
      agents: Array.isArray(parsed.agents) ? parsed.agents.map((a) => ({
        ...a,
        permissions: Array.isArray(a.permissions) ? a.permissions : ["add_number", "reset_balance", "method_zaincash", "method_superqi", "method_firstbank", "method_fastpay", "method_creditcard"]
      })) : [],
      agent_numbers: Array.isArray(parsed.agent_numbers) ? parsed.agent_numbers : [],
      agent_payment_methods: Array.isArray(parsed.agent_payment_methods) ? parsed.agent_payment_methods : [],
      admins: Array.isArray(parsed.admins) ? parsed.admins.map((a) => ({ ...a, email: typeof a.email === "string" ? a.email : null })) : [],
      bot_users: Array.isArray(parsed.bot_users) ? parsed.bot_users : [],
      push_tokens: Array.isArray(parsed.push_tokens) ? parsed.push_tokens : []
    };
  } catch {
    return {
      transactions: [],
      offers: [...defaultOffers],
      site_profile: { ...defaultProfile },
      app_settings: { ...defaultAppSettings },
      agents: [],
      agent_numbers: [],
      agent_payment_methods: [],
      admins: [],
      bot_users: [],
      push_tokens: []
    };
  }
}
function saveFileStore(store) {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(DATA_FILE, JSON.stringify(store, null, 2), "utf-8");
  } catch (e) {
    console.error("saveFileStore:", e);
  }
}
function genOrderRef() {
  return `ORD-${Math.random().toString(36).substring(2, 10).toUpperCase()}`;
}
async function listTransactionsByClient(clientId) {
  const fromFile = loadFileStore().transactions.filter((t) => t.client_id === clientId).map((t) => normalizeTx(t));
  const map = /* @__PURE__ */ new Map();
  for (const t of fromFile) map.set(t.id, t);
  if (db) {
    const { data, error } = await db.from("transactions").select("*").eq("client_id", clientId).order("created_at", { ascending: false }).limit(100);
    if (error) console.error("listTransactionsByClient:", error);
    else if (data?.length) {
      for (const row of data) {
        const tx = rowToTx(row);
        map.set(tx.id, tx);
      }
    }
  }
  return Array.from(map.values()).sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );
}
function rowToTx(row) {
  const parsed = parseTxDetails(row.details != null ? String(row.details) : null);
  const rawType = String(row.type ?? "");
  return {
    id: String(row.id),
    order_ref: String(row.order_ref ?? ""),
    client_id: String(row.client_id ?? ""),
    user_id: row.user_id != null ? String(row.user_id) : null,
    user_name: (typeof row.user_name === "string" ? row.user_name : parsed.user_name) ?? null,
    user_ip: (typeof row.user_ip === "string" ? row.user_ip : parsed.user_ip) ?? null,
    type: rawType === "buy" || rawType === "deposit" ? rawType : "sell",
    amount: Number(row.amount),
    method: String(row.method ?? ""),
    status: String(row.status ?? "pending"),
    created_at: typeof row.created_at === "string" ? row.created_at : new Date(row.created_at).toISOString(),
    details: parsed.cleanDetails,
    agent_number_id: row.agent_number_id != null ? String(row.agent_number_id) : null,
    payment_proof: row.payment_proof != null ? String(row.payment_proof) : null
  };
}
async function createTransaction(input) {
  const order_ref = genOrderRef();
  const id = globalThis.crypto?.randomUUID?.() ?? `local-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const created_at = (/* @__PURE__ */ new Date()).toISOString();
  const row = {
    id,
    order_ref,
    client_id: input.client_id,
    user_id: input.user_id ?? null,
    user_name: input.user_name?.trim() || null,
    user_ip: input.user_ip?.trim() || null,
    type: input.type,
    amount: input.amount,
    method: input.method,
    status: "pending",
    created_at,
    details: input.details ?? null,
    agent_number_id: input.agent_number_id ?? null,
    payment_proof: input.payment_proof ?? null
  };
  const persistedDetails = encodeTxDetails(input.details, {
    user_name: input.user_name,
    user_ip: input.user_ip
  });
  if (db) {
    const { data, error } = await db.from("transactions").insert([
      {
        id,
        order_ref,
        client_id: input.client_id,
        user_id: input.user_id ?? null,
        type: input.type,
        amount: input.amount,
        method: input.method,
        status: "pending",
        details: persistedDetails,
        agent_number_id: input.agent_number_id ?? null,
        payment_proof: input.payment_proof ?? null
      }
    ]).select().single();
    if (!error && data) {
      return rowToTx(data);
    }
    console.error("createTransaction db (using file fallback):", error);
  }
  const store = loadFileStore();
  store.transactions.unshift({
    ...row,
    details: persistedDetails
  });
  saveFileStore(store);
  return normalizeTx(row);
}
async function listAllTransactionsMerged() {
  const map = /* @__PURE__ */ new Map();
  if (db) {
    const { data, error } = await db.from("transactions").select("*").order("created_at", { ascending: false }).limit(5e3);
    if (!error && data?.length) {
      for (const row of data) {
        const tx = rowToTx(row);
        map.set(tx.id, tx);
      }
    }
  }
  for (const t of loadFileStore().transactions.map((x) => normalizeTx(x))) {
    if (!map.has(t.id)) {
      map.set(t.id, t);
    }
  }
  return Array.from(map.values()).sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );
}
async function getTransactionStatusCounts() {
  const all = await listAllTransactionsMerged();
  return {
    pending: all.filter((t) => t.status === "pending").length,
    completed: all.filter((t) => t.status === "completed").length,
    failed: all.filter((t) => t.status === "failed").length
  };
}
async function listTransactionsByStatusMerged(status, limit = 15) {
  const all = await listAllTransactionsMerged();
  return all.filter((t) => t.status === status).slice(0, limit);
}
async function updateTransactionStatusByRef(orderRef, status) {
  const before = await getTransactionByOrderRef(orderRef);
  if (before?.user_id && before.type === "buy" && before.status !== "completed" && status === "completed") {
    const balance = await getUserBalance(before.user_id);
    if (balance < before.amount) return false;
  }
  let ok = false;
  if (db) {
    const { error } = await db.from("transactions").update({ status }).eq("order_ref", orderRef);
    if (!error) ok = true;
    else console.error("updateTransactionStatusByRef db:", error);
  }
  const store = loadFileStore();
  const ix = store.transactions.findIndex((t) => t.order_ref === orderRef);
  if (ix !== -1) {
    store.transactions[ix] = { ...store.transactions[ix], status };
    saveFileStore(store);
    ok = true;
  }
  if (ok && before?.user_id) {
    const delta = balanceDeltaForStatusChange(before.type, before.amount, before.status, status);
    if (delta !== 0) {
      await adjustUserBalance(before.user_id, delta);
    }
  }
  return ok;
}
function balanceDeltaByStatus(type, amount, status) {
  if (status !== "completed") return 0;
  if (type === "deposit") return amount;
  if (type === "buy") return -amount;
  return 0;
}
function balanceDeltaForStatusChange(type, amount, oldStatus, newStatus) {
  return balanceDeltaByStatus(type, amount, newStatus) - balanceDeltaByStatus(type, amount, oldStatus);
}
async function getTransactionByOrderRef(orderRef) {
  if (db) {
    const { data, error } = await db.from("transactions").select("*").eq("order_ref", orderRef).maybeSingle();
    if (!error && data) return rowToTx(data);
  }
  const local = loadFileStore().transactions.find((x) => x.order_ref === orderRef);
  return local ? normalizeTx(local) : null;
}
async function getUserBalance(userId) {
  if (!userId.trim()) return 0;
  if (db) {
    const { data, error } = await db.from("profiles").select("balance").eq("id", userId).maybeSingle();
    if (!error && data) {
      return Number(data.balance ?? 0);
    }
  }
  return 0;
}
async function adjustUserBalance(userId, delta) {
  if (!userId.trim() || delta === 0) return getUserBalance(userId);
  if (db) {
    const current = await getUserBalance(userId);
    const next = Math.max(0, current + delta);
    const { error } = await db.from("profiles").update({ balance: next }).eq("id", userId);
    if (error) {
      console.error("adjustUserBalance:", error);
      return current;
    }
    return next;
  }
  return 0;
}
async function listOffers() {
  if (db) {
    const { data, error } = await db.from("offers").select("*").order("sort_order", { ascending: true });
    if (error) {
      console.error("listOffers db error:", error);
    } else if (data && data.length > 0) {
      return data.map((r) => ({
        id: String(r.id),
        variant: r.variant === "buy" ? "buy" : "sell",
        title_ar: String(r.title_ar ?? ""),
        title_en: String(r.title_en ?? ""),
        amount_display: String(r.amount_display ?? ""),
        unit_ar: String(r.unit_ar ?? ""),
        unit_en: String(r.unit_en ?? ""),
        sort_order: Number(r.sort_order ?? 0)
      }));
    }
  }
  return loadFileStore().offers.sort((a, b) => a.sort_order - b.sort_order);
}
async function getSiteProfile() {
  if (db) {
    const { data, error } = await db.from("site_profile").select("*").eq("id", 1).maybeSingle();
    if (error) {
      console.error("getSiteProfile:", error);
      return { ...defaultProfile };
    }
    if (!data) return { ...defaultProfile };
    const r = data;
    return {
      full_name: String(r.full_name ?? defaultProfile.full_name),
      email: String(r.email ?? defaultProfile.email),
      phone: String(r.phone ?? "")
    };
  }
  return { ...loadFileStore().site_profile };
}
async function updateSiteProfile(patch) {
  const current = await getSiteProfile();
  const next = {
    full_name: patch.full_name ?? current.full_name,
    email: patch.email ?? current.email,
    phone: patch.phone ?? current.phone
  };
  if (db) {
    const { error } = await db.from("site_profile").upsert(
      { id: 1, ...next, updated_at: (/* @__PURE__ */ new Date()).toISOString() },
      { onConflict: "id" }
    );
    if (error) console.error("updateSiteProfile db:", error);
  }
  const store = loadFileStore();
  store.site_profile = next;
  saveFileStore(store);
  return next;
}
function methodPairFromMerged(merged, base) {
  const legacyKey = `method_${base}_enabled`;
  const legacyVal = merged[legacyKey] === void 0 ? true : merged[legacyKey] !== "false";
  const buyKey = `method_${base}_buy_enabled`;
  const sellKey = `method_${base}_sell_enabled`;
  const buy = merged[buyKey] === void 0 ? legacyVal : merged[buyKey] !== "false";
  const sell = merged[sellKey] === void 0 ? legacyVal : merged[sellKey] !== "false";
  return { buy, sell };
}
function creditcardBuyFromMerged(merged) {
  const legacyVal = merged.method_creditcard_enabled === void 0 ? true : merged.method_creditcard_enabled !== "false";
  return merged.method_creditcard_buy_enabled === void 0 ? legacyVal : merged.method_creditcard_buy_enabled !== "false";
}
var APP_SETTING_KEYS = [
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
async function getAppSettings() {
  const merged = { ...defaultAppSettings };
  if (db) {
    const { data, error } = await db.from("settings").select("key, value");
    if (!error && data?.length) {
      for (const row of data) {
        if (row.key && typeof row.value === "string") merged[row.key] = row.value;
      }
      const z2 = methodPairFromMerged(merged, "zaincash");
      const su2 = methodPairFromMerged(merged, "superqi");
      const fi2 = methodPairFromMerged(merged, "firstbank");
      const fa2 = methodPairFromMerged(merged, "fastpay");
      return {
        maintenance_mode: merged.maintenance_mode === "true",
        buy_coming_soon: merged.buy_coming_soon === "true",
        sell_coming_soon: merged.sell_coming_soon === "true",
        method_zaincash_buy_enabled: z2.buy,
        method_zaincash_sell_enabled: z2.sell,
        method_superqi_buy_enabled: su2.buy,
        method_superqi_sell_enabled: su2.sell,
        method_firstbank_buy_enabled: fi2.buy,
        method_firstbank_sell_enabled: fi2.sell,
        method_fastpay_buy_enabled: fa2.buy,
        method_fastpay_sell_enabled: fa2.sell,
        method_creditcard_buy_enabled: creditcardBuyFromMerged(merged),
        buy_custom_wallets: parseBuyCustomWallets(merged.buy_custom_wallets),
        sell_custom_wallets: parseSellCustomWallets(merged.sell_custom_wallets)
      };
    }
  }
  const fileSettings = loadFileStore().app_settings;
  const final = { ...merged, ...fileSettings };
  const z = methodPairFromMerged(final, "zaincash");
  const su = methodPairFromMerged(final, "superqi");
  const fi = methodPairFromMerged(final, "firstbank");
  const fa = methodPairFromMerged(final, "fastpay");
  return {
    maintenance_mode: final.maintenance_mode === "true",
    buy_coming_soon: final.buy_coming_soon === "true",
    sell_coming_soon: final.sell_coming_soon === "true",
    method_zaincash_buy_enabled: z.buy,
    method_zaincash_sell_enabled: z.sell,
    method_superqi_buy_enabled: su.buy,
    method_superqi_sell_enabled: su.sell,
    method_firstbank_buy_enabled: fi.buy,
    method_firstbank_sell_enabled: fi.sell,
    method_fastpay_buy_enabled: fa.buy,
    method_fastpay_sell_enabled: fa.sell,
    method_creditcard_buy_enabled: creditcardBuyFromMerged(final),
    buy_custom_wallets: parseBuyCustomWallets(final.buy_custom_wallets),
    sell_custom_wallets: parseSellCustomWallets(final.sell_custom_wallets)
  };
}
async function setAppSetting(key, value) {
  if (!APP_SETTING_KEYS.includes(key)) {
    throw new Error("invalid setting key");
  }
  const str = value ? "true" : "false";
  if (db) {
    const { error } = await db.from("settings").upsert({ key, value: str }, { onConflict: "key" });
    if (error) console.error("setAppSetting db:", error);
  }
  const st = loadFileStore();
  st.app_settings = { ...st.app_settings, [key]: str };
  saveFileStore(st);
  return getAppSettings();
}
async function listAgents() {
  if (db) {
    const { data, error } = await db.from("agents").select("*").order("created_at", { ascending: false });
    if (error) {
      console.error("listAgents:", error);
    } else {
      return data ?? [];
    }
  }
  return loadFileStore().agents;
}
async function createAgent(input) {
  const id = globalThis.crypto?.randomUUID?.() ?? `agent-${Date.now()}`;
  const row = {
    id,
    telegram_id: input.telegram_id,
    name: input.name,
    is_active: false,
    permissions: ["add_number", "reset_balance", "method_zaincash", "method_superqi", "method_firstbank", "method_fastpay", "method_creditcard"],
    created_at: (/* @__PURE__ */ new Date()).toISOString()
  };
  if (db) {
    await db.from("agents").insert([row]);
  }
  const st = loadFileStore();
  st.agents.unshift(row);
  saveFileStore(st);
  const wallets = await getBuyCustomWallets();
  for (const w of wallets) {
    await addAgentPermission(id, `method_wallet_${w.id}`);
  }
  const sellWallets = await getSellCustomWallets();
  for (const w of sellWallets) {
    await addAgentPermission(id, `method_sell_wallet_${w.id}`);
  }
  return row;
}
async function toggleAgentActive(id, active) {
  if (db) {
    if (active) {
      await db.from("agents").update({ is_active: false }).neq("id", id);
    }
    await db.from("agents").update({ is_active: active }).eq("id", id);
  }
  const st = loadFileStore();
  if (active) {
    for (let i = 0; i < st.agents.length; i++) {
      if (st.agents[i].id !== id) st.agents[i].is_active = false;
    }
  }
  const ix = st.agents.findIndex((a) => a.id === id);
  if (ix !== -1) {
    st.agents[ix].is_active = active;
    saveFileStore(st);
  }
}
async function deleteAgent(id) {
  if (db) {
    await db.from("agents").delete().eq("id", id);
    await db.from("agent_numbers").delete().eq("agent_id", id);
    await db.from("agent_payment_methods").delete().eq("agent_id", id);
  }
  const st = loadFileStore();
  st.agents = st.agents.filter((a) => a.id !== id);
  st.agent_numbers = st.agent_numbers.filter((n) => n.agent_id !== id);
  st.agent_payment_methods = st.agent_payment_methods.filter((m) => m.agent_id !== id);
  saveFileStore(st);
}
async function listAgentNumbers(agentId) {
  if (db) {
    let query = db.from("agent_numbers").select("*").order("sort_order", { ascending: true });
    if (agentId) query = query.eq("agent_id", agentId);
    const { data, error } = await query;
    if (error) {
      console.error("listAgentNumbers:", error);
    } else {
      return data ?? [];
    }
  }
  const nums = loadFileStore().agent_numbers;
  return agentId ? nums.filter((n) => n.agent_id === agentId).sort((a, b) => a.sort_order - b.sort_order) : nums;
}
async function getAgentNumberById(id) {
  if (db) {
    const { data, error } = await db.from("agent_numbers").select("*").eq("id", id).maybeSingle();
    if (!error && data) return data;
  }
  return loadFileStore().agent_numbers.find((n) => n.id === id) ?? null;
}
async function addAgentNumber(agentId, phoneNumber, sortOrder) {
  const id = globalThis.crypto?.randomUUID?.() ?? `num-${Date.now()}`;
  const row = {
    id,
    agent_id: agentId,
    phone_number: phoneNumber,
    balance: 0,
    is_exhausted: false,
    sort_order: sortOrder
  };
  if (db) {
    await db.from("agent_numbers").insert([row]);
  }
  const st = loadFileStore();
  st.agent_numbers.push(row);
  saveFileStore(st);
  return row;
}
async function updateAgentNumber(id, patch) {
  if (db) {
    await db.from("agent_numbers").update(patch).eq("id", id);
  }
  const st = loadFileStore();
  const ix = st.agent_numbers.findIndex((n) => n.id === id);
  if (ix !== -1) {
    st.agent_numbers[ix] = { ...st.agent_numbers[ix], ...patch };
    saveFileStore(st);
  }
}
async function deleteAgentNumber(id) {
  if (db) {
    await db.from("agent_numbers").delete().eq("id", id);
  }
  const st = loadFileStore();
  st.agent_numbers = st.agent_numbers.filter((n) => n.id !== id);
  saveFileStore(st);
}
var AGENT_METHOD_KEYS = ["zaincash", "superqi", "firstbank", "fastpay"];
function normalizeAgentPaymentMethodKey(input) {
  const s = input.trim().toLowerCase();
  if (/^wallet_[a-z0-9][a-z0-9_-]{0,20}$/.test(s)) return s;
  if (/^sell_wallet_[a-z0-9][a-z0-9_-]{0,20}$/.test(s)) return s;
  if (s === "fib" || s === "fip" || s === "firstbank") return "firstbank";
  if (s === "zaincash") return "zaincash";
  if (s === "superqi") return "superqi";
  if (s === "fastpay") return "fastpay";
  return null;
}
async function upsertAgentPaymentMethod(input) {
  const key = normalizeAgentPaymentMethodKey(input.method_key);
  const agentId = input.agent_id.trim();
  const number = input.account_number.trim();
  if (!key || !agentId || !number) return null;
  const row = {
    id: globalThis.crypto?.randomUUID?.() ?? `apm-${Date.now()}`,
    agent_id: agentId,
    method_key: key,
    account_number: number,
    account_holder: input.account_holder?.trim() ? input.account_holder.trim() : null,
    barcode_url: input.barcode_url?.trim() ? input.barcode_url.trim() : null,
    updated_at: (/* @__PURE__ */ new Date()).toISOString()
  };
  if (db) {
    const { error } = await db.from("agent_payment_methods").upsert(
      {
        agent_id: row.agent_id,
        method_key: row.method_key,
        account_number: row.account_number,
        account_holder: row.account_holder,
        barcode_url: row.barcode_url,
        updated_at: row.updated_at
      },
      { onConflict: "agent_id,method_key" }
    );
    if (error) console.error("upsertAgentPaymentMethod:", error);
  }
  const st = loadFileStore();
  const ix = st.agent_payment_methods.findIndex(
    (m) => m.agent_id === row.agent_id && m.method_key === row.method_key
  );
  if (ix === -1) st.agent_payment_methods.push(row);
  else st.agent_payment_methods[ix] = { ...st.agent_payment_methods[ix], ...row };
  saveFileStore(st);
  return row;
}
async function listAgentPaymentMethods(agentId) {
  const id = agentId.trim();
  if (!id) return [];
  if (db) {
    const { data, error } = await db.from("agent_payment_methods").select("*").eq("agent_id", id);
    if (error) {
      console.error("listAgentPaymentMethods:", error);
    } else {
      return (data ?? []).sort((a, b) => {
        const ai = AGENT_METHOD_KEYS.indexOf(a.method_key);
        const bi = AGENT_METHOD_KEYS.indexOf(b.method_key);
        if (ai !== -1 && bi !== -1) return ai - bi;
        if (ai !== -1) return -1;
        if (bi !== -1) return 1;
        return a.method_key.localeCompare(b.method_key);
      });
    }
  }
  return loadFileStore().agent_payment_methods.filter((m) => m.agent_id === id).sort((a, b) => {
    const ai = AGENT_METHOD_KEYS.indexOf(a.method_key);
    const bi = AGENT_METHOD_KEYS.indexOf(b.method_key);
    if (ai !== -1 && bi !== -1) return ai - bi;
    if (ai !== -1) return -1;
    if (bi !== -1) return 1;
    return a.method_key.localeCompare(b.method_key);
  });
}
async function removeAgentPaymentMethod(agentId, methodKey) {
  const id = agentId.trim();
  const key = normalizeAgentPaymentMethodKey(methodKey);
  if (!id || !key) return;
  if (db) {
    const { error } = await db.from("agent_payment_methods").delete().eq("agent_id", id).eq("method_key", key);
    if (error) console.error("removeAgentPaymentMethod:", error);
  }
  const st = loadFileStore();
  st.agent_payment_methods = st.agent_payment_methods.filter(
    (m) => !(m.agent_id === id && m.method_key === key)
  );
  saveFileStore(st);
}
async function getActiveSellNumber() {
  const agents = await listAgents();
  const activeAgent = agents.find((a) => a.is_active);
  if (!activeAgent) return null;
  const numbers = await listAgentNumbers(activeAgent.id);
  const activeNum = numbers.find((n) => !n.is_exhausted && n.balance < 3e5);
  const perms = new Set(activeAgent.permissions || []);
  const hasMethodPerms = [...perms].some((p) => p.startsWith("method_"));
  const allowedMethods = {
    zaincash: hasMethodPerms ? perms.has("method_zaincash") : true,
    superqi: hasMethodPerms ? perms.has("method_superqi") : true,
    firstbank: hasMethodPerms ? perms.has("method_firstbank") : true,
    fastpay: hasMethodPerms ? perms.has("method_fastpay") : true,
    creditcard: hasMethodPerms ? perms.has("method_creditcard") : true
  };
  const customWallets = await getBuyCustomWallets();
  for (const w of customWallets) {
    if (!w.enabled) continue;
    const mid = `wallet_${w.id}`;
    const pkey = `method_wallet_${w.id}`;
    allowedMethods[mid] = hasMethodPerms ? perms.has(pkey) : true;
  }
  const sellCustomWallets = await getSellCustomWallets();
  for (const w of sellCustomWallets) {
    if (!w.enabled) continue;
    const mid = `sell_wallet_${w.id}`;
    const pkey = `method_sell_wallet_${w.id}`;
    allowedMethods[mid] = hasMethodPerms ? perms.has(pkey) : true;
  }
  const paymentMethodsRaw = await listAgentPaymentMethods(activeAgent.id);
  const paymentMethods = paymentMethodsRaw.filter((m) => String(m.account_number ?? "").trim().length > 0).map((m) => {
    const nk = normalizeAgentPaymentMethodKey(m.method_key) ?? m.method_key.trim().toLowerCase();
    return {
      method_key: nk,
      account_number: String(m.account_number).trim(),
      account_holder: m.account_holder ?? null,
      barcode_url: m.barcode_url ?? null
    };
  });
  return {
    phoneNumber: activeNum ? activeNum.phone_number : null,
    agentId: activeAgent.id,
    numberId: activeNum ? activeNum.id : null,
    allowedMethods,
    paymentMethods
  };
}
async function incrementNumberBalance(numberId, amount) {
  const st = loadFileStore();
  const ix = st.agent_numbers.findIndex((n) => n.id === numberId);
  if (ix === -1) return null;
  const newBalance = st.agent_numbers[ix].balance + amount;
  const exhausted = newBalance >= 3e5;
  const update = { balance: newBalance, is_exhausted: exhausted };
  if (db) {
    await db.from("agent_numbers").update(update).eq("id", numberId);
  }
  st.agent_numbers[ix] = { ...st.agent_numbers[ix], ...update };
  saveFileStore(st);
  return { exhausted, agentId: st.agent_numbers[ix].agent_id };
}
async function toggleAgentPermission(agentId, permission) {
  const st = loadFileStore();
  const ix = st.agents.findIndex((a) => a.id === agentId);
  if (ix === -1) return;
  const current = st.agents[ix].permissions || [];
  if (current.includes(permission)) {
    st.agents[ix].permissions = current.filter((p) => p !== permission);
  } else {
    st.agents[ix].permissions = [...current, permission];
  }
  if (db) await db.from("agents").update({ permissions: st.agents[ix].permissions }).eq("id", agentId);
  saveFileStore(st);
}
async function listAdmins() {
  if (db) {
    const { data, error } = await db.from("admins").select("*").order("created_at", { ascending: false });
    if (!error && data?.length) {
      return data.map((a) => ({ ...a, email: typeof a.email === "string" ? a.email : null }));
    }
  }
  return loadFileStore().admins;
}
async function createAdmin(input) {
  const id = globalThis.crypto?.randomUUID?.() ?? `admin-${Date.now()}`;
  const row = {
    id,
    telegram_id: input.telegram_id,
    name: input.name,
    email: input.email?.trim() || null,
    permissions: ["manage_agents", "site_settings", "edit_links", "view_stats"],
    // Default
    created_at: (/* @__PURE__ */ new Date()).toISOString()
  };
  if (db) {
    const { error } = await db.from("admins").insert([row]);
    if (error) {
      const { error: e2 } = await db.from("admins").insert([
        {
          id: row.id,
          telegram_id: row.telegram_id,
          name: row.name,
          permissions: row.permissions,
          created_at: row.created_at
        }
      ]);
      if (e2) console.error("createAdmin:", e2);
    }
  }
  const st = loadFileStore();
  st.admins.unshift(row);
  saveFileStore(st);
  return row;
}
async function updateAdmin(adminId, patch) {
  const next = {};
  if (typeof patch.name === "string") next.name = patch.name.trim();
  if (typeof patch.email === "string") next.email = patch.email.trim() || null;
  else if (patch.email === null) next.email = null;
  if (Object.keys(next).length === 0) return;
  if (db) {
    const { error } = await db.from("admins").update(next).eq("id", adminId);
    if (error) console.error("updateAdmin:", error);
  }
  const st = loadFileStore();
  const ix = st.admins.findIndex((a) => a.id === adminId);
  if (ix !== -1) {
    st.admins[ix] = { ...st.admins[ix], ...next };
    saveFileStore(st);
  }
}
async function toggleAdminPermission(adminId, permission) {
  const st = loadFileStore();
  const ix = st.admins.findIndex((a) => a.id === adminId);
  if (ix === -1) return;
  const current = st.admins[ix].permissions || [];
  if (current.includes(permission)) {
    st.admins[ix].permissions = current.filter((p) => p !== permission);
  } else {
    st.admins[ix].permissions = [...current, permission];
  }
  if (db) await db.from("admins").update({ permissions: st.admins[ix].permissions }).eq("id", adminId);
  saveFileStore(st);
}
async function deleteAdmin(id) {
  const st = loadFileStore();
  const admin = st.admins.find((a) => a.id === id);
  if (admin && admin.telegram_id.toString() === process.env.TELEGRAM_CHAT_ID) {
    return;
  }
  if (db) await db.from("admins").delete().eq("id", id);
  st.admins = st.admins.filter((a) => a.id !== id);
  saveFileStore(st);
}
async function registerBotUser(telegramId) {
  if (db) {
    const { data, error } = await db.from("bot_users").select("*").eq("telegram_id", telegramId).maybeSingle();
    if (!error && data) return data;
  }
  const store = loadFileStore();
  const exists = store.bot_users.find((u) => u.telegram_id === telegramId);
  if (exists) return exists;
  const newUser = {
    id: globalThis.crypto?.randomUUID?.() ?? `botuser-${Date.now()}`,
    telegram_id: telegramId,
    created_at: (/* @__PURE__ */ new Date()).toISOString()
  };
  if (db) {
    const { error } = await db.from("bot_users").upsert({
      telegram_id: telegramId,
      created_at: newUser.created_at
    });
    if (error) console.error("registerBotUser DB failure:", error);
  }
  store.bot_users.push(newUser);
  saveFileStore(store);
  return newUser;
}
async function listBotUsers() {
  if (db) {
    const { data, error } = await db.from("bot_users").select("*");
    if (!error && data) return data;
  }
  const store = loadFileStore();
  return store.bot_users;
}
async function createOffer(offerData) {
  const store = loadFileStore();
  const id = globalThis.crypto?.randomUUID?.() ?? `offer-${Date.now()}`;
  const newOffer = {
    id,
    ...offerData
  };
  store.offers.push(newOffer);
  store.offers.sort((a, b) => a.sort_order - b.sort_order);
  saveFileStore(store);
  if (db) {
    await db.from("offers").insert(newOffer);
  }
  return newOffer;
}
async function deleteOffer(id) {
  if (db) {
    await db.from("offers").delete().eq("id", id);
  }
  const store = loadFileStore();
  store.offers = store.offers.filter((o) => o.id !== id);
  saveFileStore(store);
}
async function upsertPushToken(input) {
  const updated_at = (/* @__PURE__ */ new Date()).toISOString();
  const row = { ...input, updated_at };
  if (db) {
    const { error } = await db.from("push_tokens").upsert(
      { token: input.token, client_id: input.client_id, platform: input.platform, updated_at },
      { onConflict: "token" }
    );
    if (error) console.error("upsertPushToken:", error);
  }
  const st = loadFileStore();
  const ix = st.push_tokens.findIndex((p) => p.token === input.token);
  if (ix === -1) st.push_tokens.push(row);
  else st.push_tokens[ix] = row;
  saveFileStore(st);
}
async function listPushTokens() {
  if (db) {
    const { data, error } = await db.from("push_tokens").select("*");
    if (!error && data?.length) return data;
  }
  return loadFileStore().push_tokens;
}
async function removePushTokens(tokens) {
  if (!tokens.length) return;
  if (db) {
    await db.from("push_tokens").delete().in("token", tokens);
  }
  const st = loadFileStore();
  const set = new Set(tokens);
  st.push_tokens = st.push_tokens.filter((p) => !set.has(p.token));
  saveFileStore(st);
}
async function removePushTokensByClientId(client_id) {
  const id = client_id.trim();
  if (!id) return;
  if (db) {
    const { error } = await db.from("push_tokens").delete().eq("client_id", id);
    if (error) console.error("removePushTokensByClientId:", error);
  }
  const st = loadFileStore();
  st.push_tokens = st.push_tokens.filter((p) => p.client_id !== id);
  saveFileStore(st);
}

// server/pushFcm.ts
import { GoogleAuth } from "google-auth-library";
var FCM_LEGACY_URL = "https://fcm.googleapis.com/fcm/send";
var FCM_SCOPE = "https://www.googleapis.com/auth/firebase.messaging";
function parseServiceAccount() {
  const raw = process.env.FCM_SERVICE_ACCOUNT_JSON?.trim();
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    console.error("FCM_SERVICE_ACCOUNT_JSON: invalid JSON");
    return null;
  }
}
async function getFcmV1AccessToken(credentials) {
  try {
    const auth = new GoogleAuth({
      credentials,
      scopes: [FCM_SCOPE]
    });
    const client = await auth.getClient();
    const tokenResponse = await client.getAccessToken();
    const token = tokenResponse?.token;
    return token ?? null;
  } catch (e) {
    console.error("FCM v1 getAccessToken:", e);
    return null;
  }
}
async function sendFcmV1(projectId, accessToken, title, body, tokens) {
  const url = `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/messages:send`;
  let sent = 0;
  const invalid = [];
  for (const token of tokens) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          message: {
            token,
            notification: {
              title: title.slice(0, 200),
              body: body.slice(0, 2e3)
            },
            android: { priority: "HIGH" },
            apns: {
              payload: {
                aps: {
                  sound: "default"
                }
              }
            }
          }
        })
      });
      const json = await res.json();
      if (res.ok && json.name) {
        sent += 1;
        continue;
      }
      const errCode = json.error?.details?.find((d) => d.errorCode)?.errorCode;
      if (errCode === "UNREGISTERED" || errCode === "INVALID_ARGUMENT" || res.status === 404 || json.error?.status === "NOT_FOUND") {
        invalid.push(token);
      } else {
        console.error("FCM v1 error:", res.status, json);
      }
    } catch (e) {
      console.error("FCM v1 fetch:", e);
    }
  }
  return { sent, invalid };
}
async function deliverFcm(tokens, title, body) {
  const serverKey = process.env.FCM_SERVER_KEY?.trim();
  const sa = parseServiceAccount();
  if (!serverKey && !sa?.project_id) {
    return { sent: 0, invalid: [] };
  }
  if (tokens.length === 0) {
    return { sent: 0, invalid: [] };
  }
  const invalid = [];
  let sent = 0;
  if (sa?.project_id && !serverKey) {
    const accessToken = await getFcmV1AccessToken(sa);
    if (!accessToken) {
      return { sent: 0, invalid: [] };
    }
    const r = await sendFcmV1(sa.project_id, accessToken, title, body, tokens);
    sent = r.sent;
    invalid.push(...r.invalid);
  } else if (serverKey) {
    const chunkSize = 500;
    for (let i = 0; i < tokens.length; i += chunkSize) {
      const registration_ids = tokens.slice(i, i + chunkSize);
      try {
        const res = await fetch(FCM_LEGACY_URL, {
          method: "POST",
          headers: {
            Authorization: `key=${serverKey}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            registration_ids,
            notification: {
              title: title.slice(0, 200),
              body: body.slice(0, 2e3),
              sound: "default"
            },
            priority: "high",
            content_available: true
          })
        });
        const json = await res.json();
        if (!res.ok) {
          console.error("FCM HTTP error:", res.status, json);
          continue;
        }
        const results = json.results;
        if (Array.isArray(results)) {
          results.forEach((r, idx) => {
            if (r.message_id) sent += 1;
            const err = r.error;
            if (err && (err === "NotRegistered" || err === "InvalidRegistration" || err === "MismatchSenderId")) {
              const t = registration_ids[idx];
              if (t) invalid.push(t);
            }
          });
        } else if (typeof json.success === "number") {
          sent += json.success;
        }
      } catch (e) {
        console.error("FCM fetch:", e);
      }
    }
  }
  return { sent, invalid };
}
async function sendFcmToClient(clientId, title, body) {
  try {
    const cid = clientId.trim();
    if (!cid) return;
    const rows = await listPushTokens();
    const tokens = [
      ...new Set(rows.filter((r) => r.client_id === cid).map((r) => r.token).filter(Boolean))
    ];
    if (tokens.length === 0) return;
    const { invalid } = await deliverFcm(tokens, title, body);
    if (invalid.length) {
      await removePushTokens([...new Set(invalid)]);
    }
  } catch (e) {
    console.error("sendFcmToClient:", e);
  }
}
async function notifyOrderStatusByRef(orderRef, status) {
  const all = await listAllTransactionsMerged();
  const tx = all.find((t) => t.order_ref === orderRef);
  if (!tx?.client_id) return;
  const ref = orderRef;
  let title;
  let body;
  switch (status) {
    case "completed":
      title = "\u062A\u0645 \u0625\u0643\u0645\u0627\u0644 \u0627\u0644\u0637\u0644\u0628 \u2705";
      body = `\u0637\u0644\u0628\u0643 #${ref} \u062A\u0645 \u0628\u0646\u062C\u0627\u062D.`;
      break;
    case "failed":
      title = "\u062A\u0645 \u0631\u0641\u0636 \u0627\u0644\u0637\u0644\u0628 \u274C";
      body = `\u0637\u0644\u0628\u0643 #${ref} \u0644\u0645 \u064A\u064F\u0639\u062A\u0645\u062F \u0623\u0648 \u0623\u064F\u0644\u063A\u064A.`;
      break;
    case "refunded":
      title = "\u0627\u0633\u062A\u0631\u062C\u0627\u0639 \u21A9\uFE0F";
      body = `\u062A\u0645 \u062A\u0633\u062C\u064A\u0644 \u0627\u0644\u0627\u0633\u062A\u0631\u062C\u0627\u0639 \u0644\u0644\u0637\u0644\u0628 #${ref}.`;
      break;
    case "suspended":
      title = "\u0637\u0644\u0628 \u0645\u0639\u0644\u0651\u0642 \u23F8";
      body = `\u0637\u0644\u0628\u0643 #${ref} \u0641\u064A \u062D\u0627\u0644\u0629 \u062A\u0639\u0644\u064A\u0642.`;
      break;
    case "retry_otp":
      title = "\u062A\u062D\u0642\u0642 \u0645\u0646 \u0627\u0644\u0631\u0645\u0632";
      body = `\u0623\u0639\u062F \u0625\u062F\u062E\u0627\u0644 \u0631\u0645\u0632 \u0627\u0644\u062A\u062D\u0642\u0642 \u0644\u0644\u0637\u0644\u0628 #${ref}.`;
      break;
    default:
      return;
  }
  await sendFcmToClient(tx.client_id, title, body);
}
async function sendFcmAnnouncement(title, body) {
  const serverKey = process.env.FCM_SERVER_KEY?.trim();
  const sa = parseServiceAccount();
  if (!serverKey && !sa?.project_id) {
    return {
      sent: 0,
      failed: 0,
      invalidTokensRemoved: 0,
      error: "missing_fcm_credentials"
    };
  }
  const rows = await listPushTokens();
  const tokens = [...new Set(rows.map((r) => r.token).filter(Boolean))];
  if (tokens.length === 0) {
    return { sent: 0, failed: 0, invalidTokensRemoved: 0, error: "no_tokens" };
  }
  if (sa?.project_id && !serverKey) {
    const accessToken = await getFcmV1AccessToken(sa);
    if (!accessToken) {
      return {
        sent: 0,
        failed: 0,
        invalidTokensRemoved: 0,
        error: "fcm_v1_token_failed"
      };
    }
  }
  const { sent, invalid } = await deliverFcm(tokens, title, body);
  if (invalid.length) {
    await removePushTokens([...new Set(invalid)]);
  }
  return {
    sent,
    failed: Math.max(0, tokens.length - sent),
    invalidTokensRemoved: invalid.length
  };
}

// server.ts
var pendingLinkEdits = /* @__PURE__ */ new Map();
var pendingAgentPaymentEdits = /* @__PURE__ */ new Map();
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
var MAX_PAYMENT_PROOF_BYTES = 4 * 1024 * 1024;
async function notifyAllAdmins(bot, html) {
  const ids = /* @__PURE__ */ new Set();
  const primary = process.env.TELEGRAM_CHAT_ID;
  if (primary) ids.add(Number(primary));
  for (const a of await listAdmins()) ids.add(a.telegram_id);
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
  for (const a of await listAdmins()) ids.add(a.telegram_id);
  const agents = await listAgents();
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
  ensureBuyWalletIconsDir();
  ensureSellWalletIconsDir();
  app.use(
    "/uploads/buy-wallet-icons",
    express.static(path2.join(process.cwd(), "data", "buy-wallet-icons"), {
      maxAge: "7d",
      index: false,
      fallthrough: true
    })
  );
  app.use(
    "/uploads/sell-wallet-icons",
    express.static(path2.join(process.cwd(), "data", "sell-wallet-icons"), {
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
    const apkPath = process.env.NODE_ENV === "production" ? path2.join(root, "dist", APK_FILE_ON_DISK) : path2.join(root, "public", APK_FILE_ON_DISK);
    if (!existsSync2(apkPath)) {
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
      if (!db) {
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
      const adminApi = db.auth.admin;
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
      const { error: profileErr } = await db.from("profiles").upsert([{ id: userId, full_name: fullName || null, role: "user", balance: 0 }], {
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
      const content = await getSiteContent();
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
    bot = new telegram_default(botToken, { polling: false });
    const sendAdminHome = async (chatId, messageId, forUserId) => {
      const msg = `\u{1F454} <b>\u0644\u0648\u062D\u0629 \u062A\u062D\u0643\u0645 \u0627\u0644\u0625\u062F\u0627\u0631\u0629</b>
\u0645\u0631\u062D\u0628\u0627\u064B \u0628\u0643\u060C \u064A\u0645\u0643\u0646\u0643 \u0625\u062F\u0627\u0631\u0629 \u0627\u0644\u0648\u0643\u0644\u0627\u0621\u060C \u0627\u0644\u0645\u0633\u0624\u0648\u0644\u064A\u0646 \u0648\u0645\u0631\u0627\u0642\u0628\u0629 \u0627\u0644\u0646\u0638\u0627\u0645.`;
      let showLinks = false;
      let showAppPush = false;
      if (forUserId != null) {
        const isSuper = forUserId.toString() === process.env.TELEGRAM_CHAT_ID;
        const admins = await listAdmins();
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
      const s = await getAppSettings();
      const sc = await getSiteContent();
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
      const sc = await getSiteContent();
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
      const rows = await listPushTokens();
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
      const offers = await listOffers();
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
      const admins = await listAdmins();
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
      if (!db) throw new Error("Supabase \u063A\u064A\u0631 \u0645\u062A\u0635\u0644 \u0639\u0644\u0649 \u0627\u0644\u0633\u064A\u0631\u0641\u0631.");
      const adminApi = db.auth.admin;
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
      if (!db) throw new Error("Supabase \u063A\u064A\u0631 \u0645\u062A\u0635\u0644 \u0639\u0644\u0649 \u0627\u0644\u0633\u064A\u0631\u0641\u0631.");
      const adminApi = db.auth.admin;
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
      const { error: profileErr } = await db.from("profiles").upsert(
        [{ id: userId, full_name: name, role: "admin" }],
        { onConflict: "id" }
      );
      if (profileErr) {
        throw new Error(`\u062A\u0639\u0630\u0631 \u062D\u0641\u0638 \u0635\u0644\u0627\u062D\u064A\u0629 admin \u0641\u064A profiles: ${profileErr.message}`);
      }
    };
    const updateAdminWebAuth = async (params) => {
      if (!db) throw new Error("Supabase \u063A\u064A\u0631 \u0645\u062A\u0635\u0644 \u0639\u0644\u0649 \u0627\u0644\u0633\u064A\u0631\u0641\u0631.");
      const adminApi = db.auth.admin;
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
        const { error: profileErr2 } = await db.from("profiles").upsert(
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
      const { error: profileErr } = await db.from("profiles").upsert(
        [{ id: userId, full_name: params.name, role: "admin" }],
        { onConflict: "id" }
      );
      if (profileErr) throw new Error(`\u062A\u0639\u0630\u0631 \u062D\u0641\u0638 \u0635\u0644\u0627\u062D\u064A\u0629 admin \u0641\u064A profiles: ${profileErr.message}`);
      return { created: false, userEmail: data.user?.email || nextEmail || currentEmail || "" };
    };
    const sendAdminPermissionsMenu = async (chatId, adminId, messageId) => {
      const admins = await listAdmins();
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
      const agents = await listAgents();
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
      const agents = await listAgents();
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
      const rows = await listAgentPaymentMethods(agentId);
      const byKey = new Map(rows.map((r) => [r.method_key, r]));
      const wallets = await getBuyCustomWallets();
      const sellWallets = await getSellCustomWallets();
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
      const wallets = await getBuyCustomWallets();
      const sellWallets = await getSellCustomWallets();
      const walletNameMap = new Map(wallets.map((w) => [w.id, w.name_ar]));
      const sellWalletNameMap = new Map(sellWallets.map((w) => [w.id, w.name_ar]));
      const rows = await listAgentPaymentMethods(agentId);
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
        const adminsList = await listAdmins();
        const secondaryAdmin = adminsList.find((a) => a.telegram_id === userId);
        const agents = await listAgents();
        const agent = agents.find((a) => a.telegram_id === userId);
        if (userId) {
          await registerBotUser(userId);
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
              await setSiteStringSetting("link_support", raw);
              await bot?.sendMessage(msg.chat.id, `\u2705 \u062A\u0645 \u062D\u0641\u0638 \u0631\u0627\u0628\u0637 \u0627\u0644\u062A\u0648\u0627\u0635\u0644:
<code>${escapeHtml(raw)}</code>`, { parse_mode: "HTML" });
            } else if (key === "hero_buy_amount_display") {
              await setSiteStringSetting("hero_buy_amount_display", raw);
              await bot?.sendMessage(msg.chat.id, `\u2705 \u0639\u0631\u0636 \u0627\u0644\u0634\u0631\u0627\u0621 \u0641\u064A \u0627\u0644\u0631\u0626\u064A\u0633\u064A\u0629: <b>${escapeHtml(raw)}</b>`, { parse_mode: "HTML" });
            } else if (key === "hero_sell_amount_display") {
              await setSiteStringSetting("hero_sell_amount_display", raw);
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
          const buyWalletsForLabel = await getBuyCustomWallets();
          const sellWalletsForLabel = await getSellCustomWallets();
          const buyWalletNameMap = new Map(buyWalletsForLabel.map((w) => [w.id, w.name_ar]));
          const sellWalletNameMap = new Map(sellWalletsForLabel.map((w) => [w.id, w.name_ar]));
          const rows = await listAgentPaymentMethods(pending.agentId);
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
              await upsertAgentPaymentMethod({
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
              await upsertAgentPaymentMethod({
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
            await upsertAgentPaymentMethod({
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
          await upsertAgentPaymentMethod({
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
          const nums = await listAgentNumbers(agent.id);
          await addAgentNumber(agent.id, phone, nums.length + 1);
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
          await createAdmin({ telegram_id: targetId, name, email });
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
          const admins = await listAdmins();
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
              await updateAdmin(target.id, { email: nextEmail });
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
          await createAgent({ telegram_id: targetId, name });
          return bot?.sendMessage(msg.chat.id, `\u2705 \u062A\u0645 \u0625\u0636\u0627\u0641\u0629 \u0627\u0644\u0648\u0643\u064A\u0644 <b>${name}</b> \u0628\u0646\u062C\u0627\u062D.
\u064A\u0645\u0643\u0646\u0647 \u0627\u0644\u0622\u0646 \u0627\u0644\u0628\u062F\u0621 \u0628\u0627\u0633\u062A\u062E\u062F\u0627\u0645 \u0627\u0644\u0628\u0648\u062A \u0627\u0644\u062E\u0627\u0635 \u0628\u0647 \u0639\u0628\u0631 /start.`, { parse_mode: "HTML" });
        }
        if (text.startsWith("/activate ")) {
          const hasPerm = isAdmin || secondaryAdmin && secondaryAdmin.permissions.includes("manage_agents");
          if (!hasPerm) return;
          const targetIdInput = text.replace("/activate ", "").trim();
          const targetId = parseInt(targetIdInput);
          if (isNaN(targetId)) return bot?.sendMessage(msg.chat.id, "\u26A0\uFE0F \u064A\u0631\u062C\u0649 \u0625\u062F\u062E\u0627\u0644 \u0645\u0639\u0631\u0641 (ID) \u0635\u062D\u064A\u062D.\n\u0645\u062B\u0627\u0644: <code>/activate 1234567</code>", { parse_mode: "HTML" });
          const allAgents = await listAgents();
          const found = allAgents.find((a) => a.telegram_id === targetId);
          if (!found) return bot?.sendMessage(msg.chat.id, `\u274C \u0644\u0645 \u064A\u062A\u0645 \u0627\u0644\u0639\u062B\u0648\u0631 \u0639\u0644\u0649 \u0648\u0643\u064A\u0644 \u0628\u0647\u0630\u0627 \u0627\u0644\u0645\u0639\u0631\u0641: <code>${targetId}</code>`, { parse_mode: "HTML" });
          for (const a of allAgents) {
            if (a.id !== found.id && a.is_active) await toggleAgentActive(a.id, false);
          }
          await toggleAgentActive(found.id, true);
          return bot?.sendMessage(msg.chat.id, `\u2705 \u062A\u0645 \u062A\u0641\u0639\u064A\u0644 \u0627\u0644\u0648\u0643\u064A\u0644: <b>${found.name}</b> \u0628\u0646\u062C\u0627\u062D.`, { parse_mode: "HTML" });
        }
        if (/^SET_LINK\s+/i.test(text) || /^SET_HERO_BUY\s+/i.test(text) || /^SET_HERO_SELL\s+/i.test(text)) {
          const hasPerm = isAdmin || secondaryAdmin && (secondaryAdmin.permissions.includes("site_settings") || secondaryAdmin.permissions.includes("edit_links"));
          if (!hasPerm) return;
          try {
            if (/^SET_LINK\s+/i.test(text)) {
              const url = text.replace(/^SET_LINK\s+/i, "").trim();
              await setSiteStringSetting("link_support", url);
              return bot?.sendMessage(msg.chat.id, `\u2705 \u062A\u0645 \u062D\u0641\u0638 \u0631\u0627\u0628\u0637 \u0627\u0644\u062A\u0648\u0627\u0635\u0644/\u0627\u0644\u062F\u0639\u0645:
<code>${url}</code>`, { parse_mode: "HTML" });
            }
            if (/^SET_HERO_BUY\s+/i.test(text)) {
              const v = text.replace(/^SET_HERO_BUY\s+/i, "").trim();
              if (!v) return bot?.sendMessage(msg.chat.id, "\u26A0\uFE0F \u0645\u062B\u0627\u0644: <code>SET_HERO_BUY 100,000</code>", { parse_mode: "HTML" });
              await setSiteStringSetting("hero_buy_amount_display", v);
              return bot?.sendMessage(msg.chat.id, `\u2705 \u0639\u0631\u0636 \u0627\u0644\u0634\u0631\u0627\u0621 \u0641\u064A \u0627\u0644\u0635\u0641\u062D\u0629 \u0627\u0644\u0631\u0626\u064A\u0633\u064A\u0629: <b>${v}</b>`, { parse_mode: "HTML" });
            }
            if (/^SET_HERO_SELL\s+/i.test(text)) {
              const v = text.replace(/^SET_HERO_SELL\s+/i, "").trim();
              if (!v) return bot?.sendMessage(msg.chat.id, "\u26A0\uFE0F \u0645\u062B\u0627\u0644: <code>SET_HERO_SELL 95,000</code>", { parse_mode: "HTML" });
              await setSiteStringSetting("hero_sell_amount_display", v);
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
          const users = await listBotUsers();
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
          await createOffer({
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
        const adminsList = await listAdmins();
        const secondaryAdmin = adminsList.find((a) => a.telegram_id === userId);
        const isAdmin = isSuperAdmin || !!secondaryAdmin;
        const canEditLinks = adminCanEditLinks(isSuperAdmin, secondaryAdmin);
        const agentsList = await listAgents();
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
          const allTxs = await listAllTransactionsMerged();
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
          const num = await getAgentNumberById(tx.agent_number_id);
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
            const ok = await updateTransactionStatusByRef(orderRef, "completed");
            if (ok) {
              const allAgain = await listAllTransactionsMerged();
              const tx2 = allAgain.find((t) => t.order_ref === orderRef);
              if (tx2 && tx2.type === "sell" && tx2.agent_number_id) {
                await incrementNumberBalance(tx2.agent_number_id, tx2.amount);
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
            await updateTransactionStatusByRef(orderRef, "failed");
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
            const ok = await updateTransactionStatusByRef(orderRef, "completed");
            if (ok) {
              const allTxs = await listAllTransactionsMerged();
              const tx = allTxs.find((t) => t.order_ref === orderRef);
              if (tx && tx.type === "sell" && tx.agent_number_id) {
                await incrementNumberBalance(tx.agent_number_id, tx.amount);
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
            await updateTransactionStatusByRef(orderRef, "failed");
            void notifyOrderStatusByRef(orderRef, "failed");
            await answer("\u062A\u0645 \u0625\u0644\u063A\u0627\u0621 \u0627\u0644\u0637\u0644\u0628 \u274C");
            return;
          }
          if (action === "refund") {
            await updateTransactionStatusByRef(orderRef, "refunded");
            void notifyOrderStatusByRef(orderRef, "refunded");
            await answer("\u062A\u0645 \u062A\u0633\u062C\u064A\u0644 \u0627\u0644\u0627\u0633\u062A\u0631\u062C\u0627\u0639 \u21A9\uFE0F");
            return;
          }
          if (action === "suspend") {
            await updateTransactionStatusByRef(orderRef, "suspended");
            void notifyOrderStatusByRef(orderRef, "suspended");
            await answer("\u062A\u0645 \u062A\u0639\u0644\u064A\u0642 \u0627\u0644\u0637\u0644\u0628 \u23F8");
            return;
          }
          if (action === "otp_retry") {
            await updateTransactionStatusByRef(orderRef, "retry_otp");
            void notifyOrderStatusByRef(orderRef, "retry_otp");
            await answer("\u062A\u0645 \u0625\u0634\u0639\u0627\u0631 \u0627\u0644\u0639\u0645\u064A\u0644: \u0627\u0644\u0631\u0645\u0632 \u063A\u064A\u0631 \u0635\u062D\u064A\u062D \u2014 \u0623\u0639\u062F \u0625\u062F\u062E\u0627\u0644 \u0627\u0644\u0631\u0645\u0632");
            return;
          }
          if (action === "otp_reject") {
            await updateTransactionStatusByRef(orderRef, "failed");
            void notifyOrderStatusByRef(orderRef, "failed");
            await answer("\u062A\u0645 \u0627\u0644\u0631\u0641\u0636 \u274C");
            return;
          }
        }
        if (isAdmin) {
          if (data === "admin_home") return sendAdminHome(chatId, messageId, userId);
          if (data === "admin_status") {
            const active = await getActiveSellNumber();
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
            const s = await getAppSettings();
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
              const nums = await listAgentNumbers(aid);
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
                for (const other of agentsList) if (other.id !== aid && other.is_active) await toggleAgentActive(other.id, false);
              }
              await toggleAgentActive(aid, next);
              await answer("\u062A\u0645 \u0627\u0644\u062A\u062D\u062F\u064A\u062B");
              const updatedAgents = await listAgents();
              const updatedA = updatedAgents.find((x) => x.id === aid);
              if (updatedA) {
                const nums = await listAgentNumbers(aid);
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
            await deleteAgent(aid);
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
            await toggleAgentPermission(aid, perm);
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
            await toggleAdminPermission(aid, perm);
            await answer("\u062A\u0645 \u0627\u0644\u062A\u062D\u062F\u064A\u062B");
            return sendAdminPermissionsMenu(chatId, aid, messageId);
          }
          if (data.startsWith("amd_")) {
            const aid = data.replace("amd_", "");
            await deleteAdmin(aid);
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
            const cur = await getAppSettings();
            const next = !cur[key];
            await setAppSetting(key, next);
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
            await deleteOffer(oid);
            await answer("\u062A\u0645 \u062D\u0630\u0641 \u0627\u0644\u0639\u0631\u0636");
            return sendOffersMenu(chatId, messageId);
          }
          if (data === "menu_orders") {
            const counts = await getTransactionStatusCounts();
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
            const txs = await listTransactionsByStatusMerged(st, 10);
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
            const nums = await listAgentNumbers(agent.id);
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
            await updateAgentNumber(nid, { balance: 0, is_exhausted: false });
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
            const wallets = await getBuyCustomWallets();
            const sellWalletsCb = await getSellCustomWallets();
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
            await removeAgentPaymentMethod(agent.id, key);
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
      await upsertPushToken({
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
      await removePushTokensByClientId(client_id);
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
      const list = await listTransactionsByClient(clientId);
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
      const balance = await getUserBalance(userId);
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
        payment_proof,
        pay_from_wallet
      } = req.body;
      if (!client_id || !type || amount == null || !method) {
        return res.status(400).json({ error: "client_id, type, amount, method required" });
      }
      if (type !== "buy" && type !== "sell" && type !== "deposit") {
        return res.status(400).json({ error: "invalid type" });
      }
      const payFromWallet = pay_from_wallet === true;
      if (payFromWallet) {
        if (type !== "buy" || !user_id) {
          return res.status(400).json({ error: "wallet payment requires buy + signed-in user" });
        }
        const bal = await getUserBalance(user_id);
        if (bal < Number(amount)) {
          return res.status(400).json({ error: "insufficient_balance" });
        }
      }
      const xff = req.headers["x-forwarded-for"];
      const ipFromHeader = Array.isArray(xff) ? xff[0] : String(xff || "").split(",")[0];
      const userIp = (ipFromHeader || req.ip || "").trim().slice(0, 128);
      let effectiveUserName = String(user_name || "").trim();
      if (!effectiveUserName && user_id && db) {
        const { data: p } = await db.from("profiles").select("full_name").eq("id", user_id).maybeSingle();
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
      const tx = await createTransaction({
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
      if (payFromWallet && tx.user_id) {
        const ok = await updateTransactionStatusByRef(tx.order_ref, "completed");
        if (ok) {
          tx.status = "completed";
        } else {
          return res.status(400).json({ error: "insufficient_balance" });
        }
      }
      if (bot) {
        try {
          const profile = await getSiteProfile();
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
              const num = await getAgentNumberById(tx.agent_number_id);
              if (num) {
                const agents = await listAgents();
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
      const offers = await listOffers();
      res.json(offers);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Failed to list offers" });
    }
  });
  app.get("/api/site-profile", async (_req, res) => {
    try {
      const profile = await getSiteProfile();
      res.json(profile);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Failed to load profile" });
    }
  });
  app.patch("/api/site-profile", async (req, res) => {
    try {
      const { full_name, phone } = req.body;
      const profile = await updateSiteProfile({
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
      const settings = await getAppSettings();
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
          await setAppSetting(k, body[k]);
        }
      }
      const settings = await getAppSettings();
      res.json(settings);
    } catch (e) {
      console.error(e);
      const msg = e instanceof Error && e.message === "invalid setting key" ? 400 : 500;
      res.status(msg).json({ error: "Failed to update settings" });
    }
  });
  app.get("/api/active-number", async (_req, res) => {
    try {
      const active = await getActiveSellNumber();
      res.json(active);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Failed to get active number" });
    }
  });
  app.get("/api/admin/agents", async (_req, res) => {
    try {
      const agents = await listAgents();
      const agentsWithNumbers = await Promise.all(agents.map(async (a) => {
        const numbers = await listAgentNumbers(a.id);
        const payment_methods = await listAgentPaymentMethods(a.id);
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
      const admins = await listAdmins();
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
      const row = await createAdmin({
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
      await updateAdmin(id, {
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
      await deleteAdmin(req.params.id);
      res.json({ success: true });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Failed to delete admin" });
    }
  });
  app.post("/api/admin/agents", async (req, res) => {
    try {
      const { telegram_id, name } = req.body;
      const agent = await createAgent({ telegram_id: Number(telegram_id), name });
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
        const all = await listAgents();
        for (const a of all) {
          if (a.id !== id && a.is_active) {
            await toggleAgentActive(a.id, false);
          }
        }
      }
      await toggleAgentActive(id, !!is_active);
      res.json({ success: true });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Failed to update agent" });
    }
  });
  app.delete("/api/admin/agents/:id", async (req, res) => {
    try {
      await deleteAgent(req.params.id);
      res.json({ success: true });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Failed to delete agent" });
    }
  });
  app.post("/api/admin/numbers", async (req, res) => {
    try {
      const { agent_id, phone_number, sort_order } = req.body;
      const num = await addAgentNumber(agent_id, phone_number, Number(sort_order || 0));
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
      await updateAgentNumber(id, patch);
      res.json({ success: true });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Failed to update number" });
    }
  });
  app.delete("/api/admin/numbers/:id", async (req, res) => {
    try {
      await deleteAgentNumber(req.params.id);
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
      const row = await upsertAgentPaymentMethod({
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
      await removeAgentPaymentMethod(agent_id, method_key);
      res.json({ success: true });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Failed to delete agent payment method" });
    }
  });
  app.get("/api/admin/transactions", async (req, res) => {
    try {
      const all = await listAllTransactionsMerged();
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
      const offers = await listOffers();
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
      const created = await createOffer({
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
      await deleteOffer(req.params.id);
      res.json({ success: true });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Failed to delete offer" });
    }
  });
  app.get("/api/admin/site-settings", async (_req, res) => {
    try {
      res.json(await getSiteContent());
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Failed to load site settings" });
    }
  });
  app.patch("/api/admin/site-settings", async (req, res) => {
    try {
      const body = req.body;
      if (typeof body.link_support === "string") {
        await setSiteStringSetting("link_support", body.link_support);
      }
      if (typeof body.hero_buy_amount_display === "string") {
        await setSiteStringSetting("hero_buy_amount_display", body.hero_buy_amount_display);
      }
      if (typeof body.hero_sell_amount_display === "string") {
        await setSiteStringSetting("hero_sell_amount_display", body.hero_sell_amount_display);
      }
      if (typeof body.services_section_title_ar === "string") {
        await setSiteStringSetting("services_section_title_ar", body.services_section_title_ar);
      }
      if (typeof body.services_section_title_en === "string") {
        await setSiteStringSetting("services_section_title_en", body.services_section_title_en);
      }
      if (typeof body.services_section_subtitle_ar === "string") {
        await setSiteStringSetting("services_section_subtitle_ar", body.services_section_subtitle_ar);
      }
      if (typeof body.services_section_subtitle_en === "string") {
        await setSiteStringSetting("services_section_subtitle_en", body.services_section_subtitle_en);
      }
      if (typeof body.services_catalog_json === "string") {
        await setSiteStringSetting("services_catalog_json", body.services_catalog_json);
      }
      if (typeof body.pubg_uc_title_ar === "string") {
        await setSiteStringSetting("pubg_uc_title_ar", body.pubg_uc_title_ar);
      }
      if (typeof body.pubg_uc_title_en === "string") {
        await setSiteStringSetting("pubg_uc_title_en", body.pubg_uc_title_en);
      }
      if (typeof body.pubg_uc_subtitle_ar === "string") {
        await setSiteStringSetting("pubg_uc_subtitle_ar", body.pubg_uc_subtitle_ar);
      }
      if (typeof body.pubg_uc_subtitle_en === "string") {
        await setSiteStringSetting("pubg_uc_subtitle_en", body.pubg_uc_subtitle_en);
      }
      if (typeof body.pubg_uc_packages_json === "string") {
        await setSiteStringSetting("pubg_uc_packages_json", body.pubg_uc_packages_json);
      }
      if (typeof body.carousel_slides_json === "string") {
        await setSiteStringSetting("carousel_slides_json", body.carousel_slides_json);
      }
      res.json(await getSiteContent());
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
          icon_url: normalizeWalletIconUrl(r.icon_url)
        });
      }
      const saved = await setBuyCustomWallets(next);
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
          icon_url: normalizeWalletIconUrl(r.icon_url)
        });
      }
      const saved = await setSellCustomWallets(next);
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
      const wallets = await getBuyCustomWallets();
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
      ensureBuyWalletIconsDir();
      writeFileSync2(buyWalletIconDiskPath(wallet_id), buf);
      res.json({ icon_url: buyWalletIconPublicPath(wallet_id) });
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
      const wallets = await getSellCustomWallets();
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
      ensureSellWalletIconsDir();
      writeFileSync2(sellWalletIconDiskPath(wallet_id), buf);
      res.json({ icon_url: sellWalletIconPublicPath(wallet_id) });
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
      const users = await listBotUsers();
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
        const profile = await getSiteProfile();
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
        (await import("@tailwindcss/vite")).default(),
        {
          name: "pwa-stub",
          resolveId(id) {
            if (id === "virtual:pwa-register") return id;
          },
          load(id) {
            if (id === "virtual:pwa-register") return "export const registerSW = () => () => {};";
          }
        }
      ],
      server: { middlewareMode: true },
      appType: "spa"
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path2.join(process.cwd(), "dist");
    app.get("/robots.txt", (_req, res) => {
      const p = path2.join(distPath, "robots.txt");
      if (existsSync2(p)) {
        res.setHeader("Content-Type", "text/plain; charset=utf-8");
        res.setHeader("Cache-Control", "public, max-age=86400");
        return res.sendFile(p);
      }
      res.type("text/plain; charset=utf-8").send("User-agent: *\nAllow: /\n");
    });
    app.get("/sitemap.xml", (_req, res) => {
      const p = path2.join(distPath, "sitemap.xml");
      if (existsSync2(p)) {
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
          const base = path2.basename(filePath);
          if (base === "index.html" || base.endsWith(".html")) {
            res.setHeader("Cache-Control", "public, max-age=0, must-revalidate");
          }
        }
      })
    );
    app.get("*", (req, res) => {
      res.sendFile(path2.join(distPath, "index.html"));
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
