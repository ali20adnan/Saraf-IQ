import { Activity, CheckCircle2, Clock, RefreshCw, ShieldAlert } from 'lucide-react';

export function OtpEtaNotice({ text }: { text: string }) {
  return (
    <div className="w-full flex items-start gap-3 rounded-2xl border border-red-100 bg-gradient-to-br from-red-50/90 to-white px-4 py-3 shadow-sm text-start">
      <div className="w-9 h-9 rounded-xl bg-red-100 flex items-center justify-center shrink-0">
        <Clock className="w-4 h-4 text-red-600" />
      </div>
      <p className="text-sm font-bold text-red-900 leading-relaxed flex-1 pt-1.5">{text}</p>
    </div>
  );
}

type CardProcessingToOtpScreenProps = {
  lang: string;
  etaText: string;
  layout?: 'card' | 'inline';
};

export function CardProcessingToOtpScreen({
  lang,
  etaText,
  layout = 'card',
}: CardProcessingToOtpScreenProps) {
  const body = (
    <div className="flex flex-col items-center space-y-5 w-full">
      <Activity className="w-12 h-12 text-red-600 animate-pulse" aria-hidden />
      <h3 className="font-black text-xl text-center text-gray-900">
        {lang === 'ar' ? 'جاري معالجة الدفع...' : 'Processing payment...'}
      </h3>
      <p className="text-gray-500 text-center text-sm font-medium leading-relaxed max-w-sm">
        {lang === 'ar'
          ? 'انتظر حتى تجهّز صفحة التحقق في البنك (3DS)'
          : 'Wait until the bank 3DS verification page is ready'}
      </p>
      <div className="w-full max-w-sm">
        <OtpEtaNotice text={etaText} />
      </div>
    </div>
  );

  if (layout === 'inline') {
    return (
      <div className="p-6 sm:p-10 min-h-[50vh] flex flex-col items-center justify-center bg-white">
        {body}
      </div>
    );
  }

  // Full-page wait (default) — always visible after card submit
  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-gray-50/95 p-4"
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <div className="w-full max-w-md bg-white rounded-2xl border border-gray-100 p-8 shadow-xl shadow-gray-200/80">
        {body}
      </div>
    </div>
  );
}

type OtpVerificationExtrasProps = {
  t: (key: string, fallback?: string) => string;
  otpAttempts: number;
  otpMaxAttempts: number;
  otpRemaining: number;
  otpRetryNotice: boolean;
  otpResendNotice: boolean;
  otpState: 'input' | 'checking' | 'failed';
};

export function OtpVerificationExtras({
  t,
  otpAttempts,
  otpMaxAttempts,
  otpRemaining,
  otpRetryNotice,
  otpResendNotice,
  otpState,
}: OtpVerificationExtrasProps) {
  const attemptCurrent = Math.min(otpAttempts + 1, otpMaxAttempts);
  return (
    <div className="w-full space-y-3">
      <div className="flex items-center justify-between gap-3 rounded-2xl border border-gray-200 bg-gray-50 px-4 py-2.5">
        <span className="text-xs font-bold text-gray-600">
          {t('otpAttemptLabel')
            .replace('{current}', String(attemptCurrent))
            .replace('{max}', String(otpMaxAttempts))}
        </span>
        {otpRemaining < otpMaxAttempts && (
          <span className="text-[11px] font-black text-red-700 bg-red-50 px-2.5 py-1 rounded-full border border-red-100 whitespace-nowrap">
            {t('otpRemainingAttempts').replace('{count}', String(otpRemaining))}
          </span>
        )}
      </div>

      {otpRetryNotice && otpState === 'input' && (
        <div
          role="alert"
          className="flex items-start gap-2.5 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3"
        >
          <ShieldAlert className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
          <p className="text-sm font-bold text-amber-900 text-start leading-relaxed">{t('otpWrongRetry')}</p>
        </div>
      )}

      {otpResendNotice && (
        <div className="flex items-center gap-2.5 rounded-2xl border border-gray-200 bg-white px-4 py-3 shadow-sm">
          <CheckCircle2 className="w-4 h-4 text-red-600 shrink-0" />
          <p className="text-sm font-bold text-gray-700 text-start">{t('otpResendSent')}</p>
        </div>
      )}
    </div>
  );
}

type OtpResendButtonProps = {
  t: (key: string, fallback?: string) => string;
  loading: boolean;
  cooldown: number;
  disabled: boolean;
  onResend: () => void;
};

export function OtpResendButton({ t, loading, cooldown, disabled, onResend }: OtpResendButtonProps) {
  return (
    <button
      type="button"
      onClick={onResend}
      disabled={disabled}
      className="w-full flex items-center justify-center gap-2 py-3.5 rounded-2xl border border-gray-200 bg-white text-gray-800 font-bold text-sm hover:bg-gray-50 hover:border-gray-300 disabled:opacity-50 disabled:cursor-not-allowed transition-all active:scale-[0.99] shadow-sm"
    >
      {loading ? (
        <Activity className="w-4 h-4 animate-pulse text-red-600" />
      ) : (
        <>
          <RefreshCw className={`w-4 h-4 text-red-600 ${cooldown > 0 ? 'opacity-50' : ''}`} />
          <span>{cooldown > 0 ? t('otpResendWait').replace('{sec}', String(cooldown)) : t('otpResend')}</span>
        </>
      )}
    </button>
  );
}