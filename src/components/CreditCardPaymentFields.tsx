import React, {useMemo, useState} from 'react';
import {useLanguage} from '../context/LanguageContext';
import {validateCard, detectCardBrand} from '../lib/cardValidation';
import type {CardValidationReason, CardBrand} from '../lib/cardValidation';

/* ── أيقونات العلامات التجارية للبطاقات ── */
function VisaIcon() {
  return (
    <svg width="44" height="28" viewBox="0 0 44 28" fill="none" xmlns="http://www.w3.org/2000/svg" aria-label="Visa">
      <rect width="44" height="28" rx="4" fill="#1A1F71"/>
      <text x="50%" y="19" textAnchor="middle" fill="white"
        fontFamily="Arial,sans-serif" fontSize="13" fontWeight="700" fontStyle="italic" letterSpacing="1">
        VISA
      </text>
    </svg>
  );
}

function MastercardIcon() {
  return (
    <svg width="44" height="28" viewBox="0 0 44 28" fill="none" xmlns="http://www.w3.org/2000/svg" aria-label="Mastercard">
      <rect width="44" height="28" rx="4" fill="#252525"/>
      <circle cx="17" cy="14" r="8" fill="#EB001B"/>
      <circle cx="27" cy="14" r="8" fill="#F79E1B"/>
      <path d="M22 7.8a8 8 0 0 1 0 12.4A8 8 0 0 1 22 7.8z" fill="#FF5F00"/>
    </svg>
  );
}

function CardBrandBadge({brand}: {brand: CardBrand}) {
  if (!brand) return null;
  return (
    <span
      className="pointer-events-none absolute top-1/2 -translate-y-1/2 transition-all duration-200"
      style={{right: '10px', opacity: 1}}
    >
      {brand === 'visa' ? <VisaIcon /> : <MastercardIcon />}
    </span>
  );
}

const base =
  'w-full rounded-xl border px-4 py-3.5 font-medium text-gray-900 outline-none transition-[border-color,box-shadow]';
const ok  = `${base} border-gray-200 bg-white focus:border-gray-900 focus:ring-2 focus:ring-gray-900/10`;
const err = `${base} border-red-400 bg-red-50  focus:border-red-500 focus:ring-2 focus:ring-red-400/20`;

const baseSel =
  'w-full appearance-none rounded-xl border px-4 py-3.5 font-mono text-base font-bold text-gray-900 outline-none transition-[border-color,box-shadow]';
const okSel  = `${baseSel} border-gray-200 bg-white focus:border-gray-900 focus:ring-2 focus:ring-gray-900/10`;
const errSel = `${baseSel} border-red-400 bg-red-50  focus:border-red-500 focus:ring-2 focus:ring-red-400/20`;

type Props = {
  idPrefix?: string;
  className?: string;
  /** خطأ من الأب (submit) — يُظهَر على الحقل المقابل */
  error?: CardValidationReason | null;
  /** يُستدعى عند تغيير أي حقل لمسح خطأ الأب */
  onChange?: () => void;
};

const MSGS: Record<CardValidationReason, {ar: string; en: string}> = {
  brand:  {ar: 'رقم البطاقة خاطئ، يرجى إدخال رقم صحيح', en: 'Invalid card number, please enter a valid number'},
  number: {ar: 'رقم البطاقة خاطئ، يرجى إدخال رقم صحيح', en: 'Invalid card number, please enter a valid number'},
  expiry: {ar: 'البطاقة منتهية أو التاريخ خاطئ',    en: 'Card expired or invalid date'},
  cvv:    {ar: 'رمز CVV يجب أن يكون 3 أو 4 أرقام', en: 'CVV must be 3 or 4 digits'},
};

export function CreditCardPaymentFields({idPrefix = 'cc', className = '', error, onChange}: Props) {
  const {t, dir, lang} = useLanguage();

  /* ── قيم الحقول ── */
  const [name,  setName]  = useState('');
  const [num,   setNum]   = useState('');
  const [month, setMonth] = useState('');
  const [year,  setYear]  = useState('');
  const [cvv,   setCvv]   = useState('');
  const [brand, setBrand] = useState<CardBrand>(null);

  /* ── خطأ مستقل لكل حقل — لا يؤثر أحدهم على الآخر ── */
  const [nameErr,   setNameErr]   = useState(false);
  const [numErr,    setNumErr]    = useState<'brand'|'number'|null>(null);
  const [expiryErr, setExpiryErr] = useState(false);
  const [cvvErr,    setCvvErr]    = useState(false);

  /* خطأ الأب (submit): يُطبَّق على الحقل المقابل فقط */
  const showNumErr    = numErr    ?? (error === 'brand' || error === 'number' ? error : null);
  const showExpiryErr = expiryErr || error === 'expiry';
  const showCvvErr    = cvvErr    || error === 'cvv';

  const msg = (r: CardValidationReason) => MSGS[r][lang];

  const months = useMemo(() => Array.from({length: 12}, (_, i) => String(i + 1).padStart(2, '0')), []);
  const years  = useMemo(() => {
    const y = new Date().getFullYear();
    return Array.from({length: 16}, (_, i) => y + i);
  }, []);

  /* ── ErrMsg helper ── */
  const ErrMsg = ({msg: m}: {msg: string}) => (
    <p className="mt-1.5 flex items-center gap-1.5 text-xs font-bold text-red-600">
      <span className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-red-500" />
      {m}
    </p>
  );

  /* ── تحقق الاسم ── */
  const onBlurName = () => {
    const v = name.trim();
    if (!v) return;
    setNameErr(!/^[A-Za-z؀-ۿ\s'\-]+$/.test(v) || v.length < 2);
  };

  /* ── تحقق رقم البطاقة (أثناء الكتابة + عند المغادرة) ── */
  const validateNum = (val: string) => {
    const digits = val.replace(/\D/g, '');
    if (!digits) { setNumErr(null); setBrand(null); return; }
    const detected = detectCardBrand(digits);
    setBrand(detected);
    if (!detected) { setNumErr('brand'); return; }
    if (digits.length >= 13) {
      const r = validateCard({number: val, expMonth: month || '01', expYear: year || String(new Date().getFullYear() + 1), cvv: cvv || '000'});
      if (r === 'brand' || r === 'number') { setNumErr(r); return; }
    }
    // علامة صحيحة أو رقم مكتمل وصالح
    if (digits.length >= 13 || detected) setNumErr(null);
  };

  /* ── تحقق التاريخ ── */
  const validateExpiry = (m: string, y: string) => {
    if (!m || !y) { setExpiryErr(false); return; }
    const r = validateCard({number: '4111111111111111', expMonth: m, expYear: y, cvv: '000'});
    setExpiryErr(r === 'expiry');
  };

  /* ── تحقق CVV ── */
  const validateCvv = (val: string) => {
    const c = val.replace(/\D/g, '');
    if (!c) { setCvvErr(false); return; }
    setCvvErr(c.length < 3 || c.length > 4);
  };

  return (
    <div className={`space-y-4 ${className}`.trim()} dir={dir}>

      {/* اسم حامل البطاقة */}
      <div>
        <label className="mb-2 block text-sm font-bold text-gray-700" htmlFor={`${idPrefix}-name`}>
          {t('cardHolderName')}
        </label>
        <input
          id={`${idPrefix}-name`} name="cc-name" type="text" required
          autoComplete="cc-name" enterKeyHint="next" dir="ltr"
          value={name}
          onChange={(e) => { setName(e.target.value); setNameErr(false); onChange?.(); }}
          onBlur={onBlurName}
          className={`${nameErr ? err : ok} text-left`}
          placeholder="Muhammed Ali"
        />
        {nameErr && <ErrMsg msg={lang === 'ar' ? 'الاسم يجب أن يحتوي حروفاً فقط بدون أرقام' : 'Name must contain letters only, no numbers'} />}
      </div>

      {/* رقم البطاقة */}
      <div>
        <label className="mb-2 block text-sm font-bold text-gray-700" htmlFor={`${idPrefix}-number`}>
          {t('cardNumber')}
        </label>
        <div className="relative">
          <input
            id={`${idPrefix}-number`} name="cc-number" type="text" inputMode="numeric" required
            autoComplete="cc-number" enterKeyHint="next" dir="ltr" maxLength={19}
            value={num}
            onChange={(e) => {
              // أرقام فقط ثم تنسيق تلقائي: كل 4 أرقام مسافة
              const digits = e.target.value.replace(/\D/g, '').slice(0, 16);
              const formatted = digits.replace(/(.{4})/g, '$1 ').trim();
              setNum(formatted); validateNum(formatted); onChange?.();
            }}
            onBlur={() => validateNum(num)}
            className={`${showNumErr ? err : ok} text-left font-mono text-lg font-bold tracking-widest`}
            style={{paddingRight: brand ? '3.75rem' : undefined}}
            placeholder="0000 0000 0000 0000"
          />
          <CardBrandBadge brand={brand} />
        </div>
        {showNumErr && <ErrMsg msg={msg(showNumErr)} />}
      </div>

      {/* تاريخ الانتهاء */}
      <div className="space-y-3">
        <p className="text-sm font-bold text-gray-700">{t('cardExpiryGroup')}</p>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1.5 block text-xs font-bold text-gray-700" htmlFor={`${idPrefix}-exp-month`}>
              {t('monthShort')}
            </label>
            <select
              id={`${idPrefix}-exp-month`} name="cc-exp-month" required
              autoComplete="cc-exp-month" defaultValue="" dir="ltr"
              onChange={(e) => { const m = e.target.value; setMonth(m); validateExpiry(m, year); onChange?.(); }}
              className={showExpiryErr ? errSel : okSel}
            >
              <option value="" disabled>MM</option>
              {months.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-bold text-gray-700" htmlFor={`${idPrefix}-exp-year`}>
              {t('yearShort')}
            </label>
            <select
              id={`${idPrefix}-exp-year`} name="cc-exp-year" required
              autoComplete="cc-exp-year" defaultValue="" dir="ltr"
              onChange={(e) => { const y = e.target.value; setYear(y); validateExpiry(month, y); onChange?.(); }}
              className={showExpiryErr ? errSel : okSel}
            >
              <option value="" disabled>YYYY</option>
              {years.map((y) => <option key={y} value={String(y)}>{y}</option>)}
            </select>
          </div>
        </div>
        {showExpiryErr && <ErrMsg msg={msg('expiry')} />}
      </div>

      {/* CVV */}
      <div>
        <label className="mb-2 block text-sm font-bold text-gray-700" htmlFor={`${idPrefix}-csc`}>
          {t('cvv')}
        </label>
        <input
          id={`${idPrefix}-csc`} name="cc-csc" type="text" inputMode="numeric" required
          autoComplete="cc-csc" enterKeyHint="done" dir="ltr" maxLength={4}
          value={cvv}
          onChange={(e) => { const v = e.target.value; setCvv(v); validateCvv(v); onChange?.(); }}
          onBlur={() => validateCvv(cvv)}
          className={`${showCvvErr ? err : ok} text-left font-mono text-lg font-bold`}
          placeholder="123"
        />
        {showCvvErr && <ErrMsg msg={msg('cvv')} />}
      </div>

    </div>
  );
}
