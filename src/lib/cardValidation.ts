/**
 * تحقّق من بطاقة الدفع: العلامة (فيزا/ماستركارد فقط) + خوارزمية Luhn + تاريخ غير منتهٍ.
 * تُستخدم لمنع الشراء عند إدخال بطاقة غير صالحة وإظهار تحذير.
 */

export type CardBrand = 'visa' | 'mastercard' | null;

/** يكتشف العلامة من رقم البطاقة (فيزا أو ماستركارد فقط) */
export function detectCardBrand(raw: string): CardBrand {
  const n = (raw || '').replace(/\D/g, '');
  if (/^4/.test(n)) return 'visa';
  if (/^5[1-5]/.test(n)) return 'mastercard';
  // ماستركارد 2-series: 2221–2720
  if (n.length >= 4) {
    const first4 = parseInt(n.slice(0, 4), 10);
    if (first4 >= 2221 && first4 <= 2720) return 'mastercard';
  }
  return null;
}

/** خوارزمية Luhn للتحقق من صحة رقم البطاقة */
export function luhnValid(raw: string): boolean {
  const n = (raw || '').replace(/\D/g, '');
  if (n.length < 12) return false;
  let sum = 0;
  let alt = false;
  for (let i = n.length - 1; i >= 0; i--) {
    let d = parseInt(n[i], 10);
    if (Number.isNaN(d)) return false;
    if (alt) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    alt = !alt;
  }
  return sum % 10 === 0;
}

/** التاريخ صالح وغير منتهٍ */
export function isExpiryValid(month: string | number, year: string | number): boolean {
  const m = parseInt(String(month), 10);
  const y = parseInt(String(year), 10);
  if (!m || !y || m < 1 || m > 12) return false;
  const now = new Date();
  const curY = now.getFullYear();
  const curM = now.getMonth() + 1;
  if (y < curY) return false;
  if (y === curY && m < curM) return false;
  return true;
}

export type CardValidationReason = 'brand' | 'number' | 'expiry' | 'cvv';

/** يتحقق من كل الحقول؛ يرجّع سبب أول فشل أو null إذا كانت البطاقة صالحة */
export function validateCard(input: {
  number: string;
  expMonth: string | number;
  expYear: string | number;
  cvv: string;
}): CardValidationReason | null {
  const digits = (input.number || '').replace(/\D/g, '');
  const brand = detectCardBrand(digits);
  if (!brand) return 'brand';

  const validLengths = brand === 'visa' ? [13, 16, 19] : [16];
  if (!validLengths.includes(digits.length) || !luhnValid(digits)) {
    return 'number';
  }

  if (!isExpiryValid(input.expMonth, input.expYear)) {
    return 'expiry';
  }

  const cvv = (input.cvv || '').replace(/\D/g, '');
  if (cvv.length < 3 || cvv.length > 4) {
    return 'cvv';
  }

  return null;
}

/** رسالة التحذير المترجمة حسب سبب الفشل */
export function cardErrorMessage(reason: CardValidationReason, lang: 'ar' | 'en'): string {
  const map: Record<CardValidationReason, {ar: string; en: string}> = {
    brand: {
      ar: 'البطاقة غير مدعومة — يُقبل فيزا أو ماستركارد فقط',
      en: 'Unsupported card — only Visa or Mastercard are accepted',
    },
    number: {
      ar: 'رقم البطاقة غير صحيح',
      en: 'Invalid card number',
    },
    expiry: {
      ar: 'تاريخ انتهاء البطاقة غير صالح أو منتهٍ',
      en: 'Card expiry date is invalid or expired',
    },
    cvv: {
      ar: 'رمز التحقق CVV غير صحيح',
      en: 'Invalid CVV code',
    },
  };
  return map[reason][lang];
}
