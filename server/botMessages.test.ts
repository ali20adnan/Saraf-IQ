import { describe, expect, it } from "vitest";
import {
  buildNewOrderMessagePayload,
  escapeHtml,
  formatOrderLines,
  isStartCommand,
  parseOrderCallbackData,
} from "./botMessages";
import type { ServerTransaction } from "../types/transaction.js";

describe("escapeHtml", () => {
  it("يهرب < و > و &", () => {
    expect(escapeHtml(`a<b>c&d`)).toBe("a&lt;b&gt;c&amp;d");
  });

  it("يترك النص العادي كما هو", () => {
    expect(escapeHtml("طلب 123")).toBe("طلب 123");
  });
});

describe("isStartCommand", () => {
  it("يتعرّف على /start و /start@Bot و باراميتر", () => {
    expect(isStartCommand("/start")).toBe(true);
    expect(isStartCommand("/start@MyBot")).toBe(true);
    expect(isStartCommand("  /start ref  ")).toBe(true);
    expect(isStartCommand("/help")).toBe(false);
    expect(isStartCommand(undefined)).toBe(false);
  });
});

describe("parseOrderCallbackData", () => {
  it("يستخرج إكمال الطلب", () => {
    expect(parseOrderCallbackData("complete_ORD-ABC123")).toEqual({
      action: "complete",
      orderRef: "ORD-ABC123",
    });
  });

  it("يستخرج الإلغاء والاسترجاع والتعليق", () => {
    expect(parseOrderCallbackData("cancel_X1")).toEqual({ action: "cancel", orderRef: "X1" });
    expect(parseOrderCallbackData("refund_X1")).toEqual({ action: "refund", orderRef: "X1" });
    expect(parseOrderCallbackData("suspend_X1")).toEqual({ action: "suspend", orderRef: "X1" });
  });

  it("يرجع null لقيم غير معروفة", () => {
    expect(parseOrderCallbackData(undefined)).toBeNull();
    expect(parseOrderCallbackData("menu_orders")).toBeNull();
    expect(parseOrderCallbackData("complete")).toBeNull();
  });
});

describe("formatOrderLines", () => {
  it("يعرض رسالة فارغة عند عدم وجود طلبات", () => {
    const s = formatOrderLines([], "عنوان");
    expect(s).toContain("لا توجد طلبات");
    expect(s).toContain("عنوان");
  });

  it("يعرض أسطر الطلبات مع هروب HTML", () => {
    const txs: ServerTransaction[] = [
      {
        id: "1",
        order_ref: "ORD-1",
        client_id: "c",
        type: "sell",
        amount: 5000,
        method: "زين <test>",
        status: "pending",
        created_at: new Date().toISOString(),
      },
    ];
    const s = formatOrderLines(txs, "قائمة");
    expect(s).toContain("ORD-1");
    expect(s).toContain("5000");
    expect(s).toContain("&lt;test&gt;");
  });
});

describe("buildNewOrderMessagePayload", () => {
  const tx: ServerTransaction = {
    id: "u1",
    order_ref: "ORD-XYZ",
    client_id: "c1",
    type: "buy",
    amount: 10000,
    method: "بطاقة",
    status: "pending",
    created_at: new Date().toISOString(),
    details: 'ملاحظة "خاصة"',
  };

  it("يضمّن رقم الطلب وأزرار callback متسقة", () => {
    const { text, reply_markup } = buildNewOrderMessagePayload(tx, "متجر تجريبي");
    expect(text).toContain("ORD-XYZ");
    expect(text).toContain("10000");
    expect(text).toContain("شراء");
    const rows = reply_markup.inline_keyboard;
    const allData = rows.flat().map((b) => b.callback_data);
    expect(allData).toContain("complete_ORD-XYZ");
    expect(allData).toContain("cancel_ORD-XYZ");
    expect(allData).toContain("refund_ORD-XYZ");
    expect(allData).toContain("suspend_ORD-XYZ");
  });

  it("يهرب HTML في اسم الحساب والتفاصيل", () => {
    const malicious = buildNewOrderMessagePayload(
      { ...tx, details: "<script>" },
      "<b>اسم</b>"
    );
    expect(malicious.text).not.toContain("<script>");
    expect(malicious.text).toContain("&lt;script&gt;");
    expect(malicious.text).toContain("&lt;b&gt;");
  });
});
