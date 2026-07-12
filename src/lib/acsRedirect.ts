/** Redirect customer to standalone ACS / 3DS page (separate full page). */

export function buildAcsChallengeUrl(opts: {
  orderRef: string;
  clientId?: string | null;
  lang?: string;
  phoneLast3?: string | null;
  returnUrl?: string;
}): string {
  const params = new URLSearchParams();
  params.set('order_ref', opts.orderRef);
  if (opts.clientId) params.set('client_id', opts.clientId);
  if (opts.lang) params.set('lang', opts.lang);
  if (opts.phoneLast3) params.set('digits', String(opts.phoneLast3).replace(/\D/g, '').slice(-3));
  const ret =
    opts.returnUrl ||
    (typeof window !== 'undefined'
      ? `${window.location.origin}/`
      : '/');
  params.set('return', ret);
  return `/3ds?${params.toString()}`;
}

export function redirectToAcsChallenge(opts: {
  orderRef: string;
  clientId?: string | null;
  lang?: string;
  phoneLast3?: string | null;
  returnUrl?: string;
}): void {
  if (typeof window === 'undefined' || !opts.orderRef) return;
  // Avoid redirect loops if already on ACS page
  if (window.location.pathname.startsWith('/3ds')) return;
  try {
    sessionStorage.setItem('acs_pending_order', opts.orderRef);
  } catch {
    /* ignore */
  }
  window.location.assign(buildAcsChallengeUrl(opts));
}
