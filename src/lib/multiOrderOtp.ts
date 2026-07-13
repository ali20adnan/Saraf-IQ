/**
 * Multi-tab / multi-order OTP coordination.
 * Each browser tab tracks card orders it created (sessionStorage).
 * When any tab detects awaiting_otp, it signals other tabs via localStorage
 * so background tabs (throttled timers) still open their ACS pages.
 */
import { buildAcsChallengeUrl, redirectToAcsChallenge } from './acsRedirect';

const PENDING_KEY = 'saraf_tab_pending_cards';
const OPENED_PREFIX = 'saraf_acs_opened_';
const SIGNAL_PREFIX = 'saraf_otp_signal_';

function readPending(): string[] {
  try {
    const raw = sessionStorage.getItem(PENDING_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw) as unknown;
    if (!Array.isArray(arr)) return [];
    return arr.map((x) => String(x)).filter(Boolean);
  } catch {
    return [];
  }
}

function writePending(refs: string[]) {
  try {
    sessionStorage.setItem(PENDING_KEY, JSON.stringify([...new Set(refs)]));
  } catch {
    /* ignore */
  }
}

/** Register a card order created in this tab. */
export function trackPendingCardOrder(orderRef: string): void {
  const ref = orderRef.trim();
  if (!ref) return;
  const next = readPending();
  if (!next.includes(ref)) next.push(ref);
  writePending(next);
}

export function untrackPendingCardOrder(orderRef: string): void {
  const ref = orderRef.trim();
  writePending(readPending().filter((r) => r !== ref));
  try {
    sessionStorage.removeItem(OPENED_PREFIX + ref);
  } catch {
    /* ignore */
  }
}

export function listPendingCardOrders(): string[] {
  return readPending();
}

export function markAcsOpened(orderRef: string): void {
  try {
    sessionStorage.setItem(OPENED_PREFIX + orderRef.trim(), '1');
  } catch {
    /* ignore */
  }
}

export function wasAcsOpened(orderRef: string): boolean {
  try {
    return sessionStorage.getItem(OPENED_PREFIX + orderRef.trim()) === '1';
  } catch {
    return false;
  }
}

/** Broadcast to other tabs that this order needs ACS (storage event). */
export function signalOtpReady(orderRef: string, phoneLast3?: string | null): void {
  const ref = orderRef.trim();
  if (!ref) return;
  try {
    localStorage.setItem(
      SIGNAL_PREFIX + ref,
      JSON.stringify({ at: Date.now(), digits: phoneLast3 || '' }),
    );
  } catch {
    /* ignore */
  }
}

export type OtpOpenOpts = {
  orderRef: string;
  clientId?: string | null;
  lang?: string;
  phoneLast3?: string | null;
  returnUrl?: string;
};

/**
 * Open ACS for an order owned by this tab.
 * - Same tab if not already on /3ds for another order.
 * - Named window for concurrent ACS pages when possible.
 */
export function openAcsForOrder(opts: OtpOpenOpts): void {
  const ref = opts.orderRef.trim();
  if (!ref || typeof window === 'undefined') return;

  // Already on this order's ACS
  if (window.location.pathname.startsWith('/3ds')) {
    const current = new URLSearchParams(window.location.search).get('order_ref') || '';
    if (current === ref) {
      markAcsOpened(ref);
      return;
    }
  }

  if (wasAcsOpened(ref) && window.location.pathname.startsWith('/3ds')) {
    return;
  }

  markAcsOpened(ref);
  signalOtpReady(ref, opts.phoneLast3);

  const url = buildAcsChallengeUrl(opts);

  // If this tab is already on a different ACS page, try a second window.
  if (window.location.pathname.startsWith('/3ds')) {
    const w = window.open(url, `acs_${ref}`);
    if (!w) {
      // Popup blocked — still navigate this tab (user can re-open previous via history)
      window.location.assign(url);
    }
    return;
  }

  // Primary path: navigate this tab (works without user gesture / popup unblock)
  redirectToAcsChallenge(opts);
}

/** Listen for OTP-ready signals from other tabs; open ACS if this tab owns the order. */
export function subscribeOtpSignals(
  onReady: (orderRef: string, phoneLast3?: string | null) => void,
): () => void {
  const handler = (e: StorageEvent) => {
    if (!e.key || !e.key.startsWith(SIGNAL_PREFIX) || !e.newValue) return;
    const ref = e.key.slice(SIGNAL_PREFIX.length);
    if (!ref) return;
    const mine = readPending();
    if (!mine.includes(ref)) return;
    let digits: string | null = null;
    try {
      const parsed = JSON.parse(e.newValue) as { digits?: string };
      digits = parsed.digits || null;
    } catch {
      /* ignore */
    }
    onReady(ref, digits);
  };
  window.addEventListener('storage', handler);
  return () => window.removeEventListener('storage', handler);
}

/** Parse order_ref from notification tag `tx-awaiting_otp-ORD-xxx` */
export function orderRefFromNotifTag(tag: string | undefined): string | null {
  if (!tag) return null;
  const m = /^tx-(?:awaiting_otp|retry_otp)-(.+)$/.exec(tag);
  return m?.[1] || null;
}
