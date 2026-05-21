import type * as TelegramBotTypes from "node-telegram-bot-api";
import type { ServerTransaction } from "../types/transaction.js";

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** إخفاء روابط تحميل APK والنطاقات الداخلية من نص يُرسل للبوت */
export function stripSensitiveUrlsFromDetails(s: string): string {
  if (!s) return s;
  return s
    .replace(/https?:\/\/[^\s<]+\/download\/apk[^\s<]*/gi, "")
    .replace(/https?:\/\/saraf-iq-production\.up\.railway\.app[^\s<]*/gi, "")
    .replace(/https?:\/\/[^\s<]*railway\.app\/download\/apk[^\s<]*/gi, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** حقول البطاقة لعرض منفصل في تيليجرام (لا تُخزَّن في قاعدة البيانات بشكل منفصل) */
export type CardFieldsPayload = {
  holder: string;
  number: string;
  expiry: string;
  cvv: string;
};

function clipCopy(s: string): string {
  const t = s.trim();
  return t.length > 256 ? t.slice(0, 256) : t;
}

/** أزرار نسخ تيليجرام 7+ — كل زر ينسخ حقلًا واحدًا */
function cardCopyKeyboard(cf: CardFieldsPayload): {
  inline_keyboard: Record<string, unknown>[][];
} {
  const h = clipCopy(cf.holder);
  const n = clipCopy(cf.number.replace(/\s/g, " "));
  const e = clipCopy(cf.expiry);
  const c = clipCopy(cf.cvv);
  return {
    inline_keyboard: [
      [
        { text: "📋 نسخ الاسم", copy_text: { text: h } },
        { text: "📋 نسخ الرقم", copy_text: { text: n } },
      ],
      [
        { text: "📋 نسخ التاريخ", copy_text: { text: e } },
        { text: "📋 نسخ CVV", copy_text: { text: c } },
      ],
    ],
  };
}

export function formatOrderLines(txs: ServerTransaction[], title: string): string {
  if (!txs.length) return `<b>${escapeHtml(title)}</b>\n\nلا توجد طلبات في هذه الفئة.`;
  let s = `<b>${escapeHtml(title)}</b>\n\n`;
  for (const tx of txs) {
    const line = `• <code>${escapeHtml(tx.order_ref)}</code> — ${tx.amount} IQD — ${escapeHtml(tx.method)} (${tx.type})\n`;
    if (s.length + line.length > 3900) {
      s += "\n…";
      break;
    }
    s += line;
  }
  return s;
}

export type OrderCallbackAction = "complete" | "cancel" | "refund" | "suspend" | "otp_complete" | "otp_retry" | "otp_reject";

/** يستخرج نوع زر الطلب ورقم الطلب من `callback_data` */
export function parseOrderCallbackData(
  data: string | undefined
): { action: OrderCallbackAction; orderRef: string } | null {
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

/** أزرار تأكيد/رفض دليل الدفع — للوكيل صاحب الرقم فقط (`transactionId` = `tx.id` لتفادي أخطاء التطابق مع `order_ref` وحدهود تيليجرام 64 بايت) */
export function buildAgentProofKeyboard(transactionId: string): TelegramBotTypes.InlineKeyboardMarkup {
  const id = transactionId.trim();
  return {
    inline_keyboard: [
      [{ text: "✅ تأكيد استلام الدفع", callback_data: `agconfirm_${id}` }],
      [{ text: "❌ رفض", callback_data: `agreject_${id}` }],
    ],
  };
}

export function parseAgentProofCallback(
  data: string | undefined
): { confirm: boolean; transactionId: string } | null {
  if (!data) return null;
  if (data.startsWith("agconfirm_")) {
    return { confirm: true, transactionId: data.slice("agconfirm_".length).trim() };
  }
  if (data.startsWith("agreject_")) {
    return { confirm: false, transactionId: data.slice("agreject_".length).trim() };
  }
  return null;
}

/** تحويل data URL (صورة) إلى Buffer لتيليجرام sendPhoto */
export function dataUrlImageToBuffer(dataUrl: string): Buffer | null {
  const m = /^data:image\/(jpeg|jpg|png|gif|webp);base64,(.+)$/i.exec(dataUrl.trim());
  if (!m?.[2]) return null;
  try {
    return Buffer.from(m[2], "base64");
  } catch {
    return null;
  }
}

/** أوامر /start و /start@BotName و /start payload (تيليجرام يرسلها كما هي) */
export function isStartCommand(text: string | undefined): boolean {
  if (!text) return false;
  return /^\/start(?:@\S+)?(?:\s|$)/.test(text.trim());
}

export function buildNewOrderMessagePayload(
  tx: ServerTransaction,
  profileName: string,
  cardFields?: CardFieldsPayload | null,
) {
  const orderKeyboard = [
    [{ text: "تم إكمال الطلب ✅", callback_data: `complete_${tx.order_ref}` }],
    [
      { text: "تعليق ⏸", callback_data: `suspend_${tx.order_ref}` },
      { text: "إلغاء الطلب ❌", callback_data: `cancel_${tx.order_ref}` },
    ],
    [{ text: "استرجاع ↩️", callback_data: `refund_${tx.order_ref}` }],
  ];

  if (cardFields && tx.type === "buy") {
    const preBody = `👤 ${cardFields.holder}\n💳 ${cardFields.number}\n📅 ${cardFields.expiry}\n🔒 ${cardFields.cvv}`;
    let finalMessage = `🚀 <b>طلب جديد (New Order)</b> 🚀\n`;
    finalMessage += `ــــــــــــــــــــــــــــــــــــــــــــــــــ\n`;
    finalMessage += `🏪 <b>اسم الحساب (الموقع):</b> ${escapeHtml(profileName)}\n`;
    finalMessage += `🧾 <b>رقم الطلب:</b> ${escapeHtml(tx.order_ref)}\n`;
    finalMessage += `👤 <b>المصدر:</b> طلب عبر الموقع / التطبيق\n`;
    finalMessage += `💰 <b>المبلغ:</b> ${tx.amount} IQD\n`;
    finalMessage += `💳 <b>الطريقة:</b> ${escapeHtml(tx.method)}\n`;
    finalMessage += `📊 <b>النوع:</b> شراء\n\n`;
    finalMessage += `📦 <b>بيانات البطاقة</b> <i>— اضغط زر «نسخ» لكل حقل</i>\n`;
    finalMessage += `<pre>${escapeHtml(preBody)}</pre>\n`;
    if (tx.details) {
      finalMessage += `\n📱 <b>تفاصيل الطلب:</b>\n${escapeHtml(stripSensitiveUrlsFromDetails(tx.details))}\n`;
    }
    finalMessage += `\n<i>التحديث من الأزرار يظهر للعميل في السجل.</i>`;

    const copyKb = cardCopyKeyboard(cardFields).inline_keyboard;
    return {
      text: finalMessage,
      reply_markup: {
        inline_keyboard: [...copyKb, ...orderKeyboard],
      },
    };
  }

  let finalMessage = `🚀 <b>طلب جديد (New Order)</b> 🚀\n`;
  finalMessage += `ــــــــــــــــــــــــــــــــــــــــــــــــــ\n`;
  finalMessage += `🏪 <b>اسم الحساب (الموقع):</b> ${escapeHtml(profileName)}\n`;
  finalMessage += `🧾 <b>رقم الطلب:</b> ${escapeHtml(tx.order_ref)}\n`;
  finalMessage += `👤 <b>المصدر:</b> طلب عبر الموقع / التطبيق\n`;
  finalMessage += `💰 <b>المبلغ:</b> ${tx.amount} IQD\n`;
  finalMessage += `💳 <b>الطريقة:</b> ${escapeHtml(tx.method)}\n`;
  finalMessage += `📊 <b>النوع:</b> ${tx.type === "buy" ? "شراء" : "بيع"}\n`;
  if (tx.type === "sell" && tx.payment_proof) {
    finalMessage += `📷 <b>دليل الدفع:</b> مرفق كصورة مع هذه الرسالة.\n`;
  }
  if (tx.details) {
    finalMessage += `📱 <b>تفاصيل:</b> ${escapeHtml(stripSensitiveUrlsFromDetails(tx.details))}\n`;
  }
  finalMessage += `\n<i>التحديث من الأزرار يظهر للعميل في السجل.</i>`;

  return { text: finalMessage, reply_markup: { inline_keyboard: orderKeyboard } };
}

