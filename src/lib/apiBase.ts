import sarafApi from '../../public/saraf-api.json';

type SarafApiFile = { apiOrigin?: string };

function normalizeOrigin(s: string | undefined): string {
  return (s ?? '').replace(/\/$/, '').trim();
}

/**
 * أولوية: VITE_APP_API_ORIGIN من البناء، ثم في الإنتاج: apiOrigin من public/saraf-api.json (يُضمَّن في JS ولا يعتمد على env).
 * في التطوير (npm run dev) يُرجع فارغاً لاستخدام /api على localhost.
 */
function resolveApiOrigin(): string {
  const fromEnv = normalizeOrigin(import.meta.env.VITE_APP_API_ORIGIN);
  if (fromEnv && /^https?:\/\//i.test(fromEnv)) {
    return fromEnv;
  }

  if (import.meta.env.DEV) {
    return '';
  }

  const fromFile = normalizeOrigin((sarafApi as SarafApiFile).apiOrigin);
  if (fromFile && /^https?:\/\//i.test(fromFile)) {
    return fromFile;
  }

  return '';
}

const cachedBase = resolveApiOrigin();

export function getApiOrigin(): string {
  return cachedBase;
}

/**
 * طلبات Express على Railway. في المتصفح + dev: مسارات نسبية.
 * في إنتاج الويب أو APK: أصل كامل من env أو saraf-api.json.
 */
export function apiUrl(path: string): string {
  const p = path.startsWith('/') ? path : `/${path}`;
  if (cachedBase) {
    return `${cachedBase}${p}`;
  }
  return p;
}

/** روابط تُفتح في المتصفح (تحميل APK، تقارير، إلخ) */
export function apiAbsoluteUrl(path: string): string {
  const rel = apiUrl(path);
  if (/^https?:\/\//i.test(rel)) {
    return rel;
  }
  if (typeof window !== 'undefined' && window.location?.origin) {
    return `${window.location.origin}${rel}`;
  }
  return rel;
}
