import type { ServerTransaction } from "../types/transaction.js";

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
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

export type OrderCallbackAction = "complete" | "cancel" | "refund" | "suspend";

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
  return null;
}

/** أوامر /start و /start@BotName و /start payload (تيليجرام يرسلها كما هي) */
export function isStartCommand(text: string | undefined): boolean {
  if (!text) return false;
  return /^\/start(?:@\S+)?(?:\s|$)/.test(text.trim());
}

export function buildNewOrderMessagePayload(tx: ServerTransaction, profileName: string) {
  let finalMessage = `🚀 <b>طلب جديد (New Order)</b> 🚀\n`;
  finalMessage += `ــــــــــــــــــــــــــــــــــــــــــــــــــ\n`;
  finalMessage += `🏪 <b>اسم الحساب (الموقع):</b> ${escapeHtml(profileName)}\n`;
  finalMessage += `🧾 <b>رقم الطلب:</b> ${escapeHtml(tx.order_ref)}\n`;
  finalMessage += `👤 <b>المصدر:</b> طلب عبر الموقع / التطبيق\n`;
  finalMessage += `💰 <b>المبلغ:</b> ${tx.amount} IQD\n`;
  finalMessage += `💳 <b>الطريقة:</b> ${escapeHtml(tx.method)}\n`;
  finalMessage += `📊 <b>النوع:</b> ${tx.type === "buy" ? "شراء" : "بيع"}\n`;
  if (tx.details) {
    finalMessage += `📱 <b>تفاصيل:</b> ${escapeHtml(tx.details)}\n`;
  }
  finalMessage += `\n<i>التحديث من الأزرار يظهر للعميل في السجل.</i>`;

  const reply_markup = {
    inline_keyboard: [
      [{ text: "تم إكمال الطلب ✅", callback_data: `complete_${tx.order_ref}` }],
      [
        { text: "تعليق ⏸", callback_data: `suspend_${tx.order_ref}` },
        { text: "إلغاء الطلب ❌", callback_data: `cancel_${tx.order_ref}` },
      ],
      [{ text: "استرجاع ↩️", callback_data: `refund_${tx.order_ref}` }],
    ],
  };

  return { text: finalMessage, reply_markup };
}

