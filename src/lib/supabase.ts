import {createClient, type SupabaseClient} from '@supabase/supabase-js';

function defaultUrl(): string {
  const u = import.meta.env.VITE_SUPABASE_URL;
  return u && u.startsWith('http') ? u : 'https://placeholder-project.supabase.co';
}

function defaultKey(): string {
  return import.meta.env.VITE_SUPABASE_ANON_KEY || 'placeholder-anon-key';
}

/** إنتاج ثابت — احتياط إن فقد ملف saraf-api.json */
const SARAF_DEFAULT_PRODUCTION_ORIGIN = 'https://saraf-iq-production.up.railway.app';

/**
 * أصل الخادم: 1) VITE_APP_API_ORIGIN 2) public/saraf-api.json 3) في الإنتاج: الافتراضي أعلاه
 */
async function resolveApiOrigin(): Promise<string> {
  const fromEnv = import.meta.env.VITE_APP_API_ORIGIN?.replace(/\/$/, '').trim();
  if (fromEnv?.startsWith('http')) {
    return fromEnv;
  }

  try {
    const res = await fetch('/saraf-api.json', {cache: 'no-store'});
    if (res.ok) {
      const j = (await res.json()) as {apiOrigin?: string};
      const o = j.apiOrigin?.replace(/\/$/, '').trim();
      if (o?.startsWith('http')) {
        return o;
      }
    }
  } catch {
    // يُكمل
  }

  if (import.meta.env.PROD) {
    return SARAF_DEFAULT_PRODUCTION_ORIGIN;
  }

  return '';
}

function publicConfigUrl(base: string): string {
  if (base) {
    return `${base}/api/public-config`;
  }
  return '/api/public-config';
}

export let supabase: SupabaseClient;

export async function initSupabase(): Promise<void> {
  let url = defaultUrl();
  let key = defaultKey();

  if (import.meta.env.PROD) {
    const base = await resolveApiOrigin();
    const configUrl = publicConfigUrl(base);
    try {
      const res = await fetch(configUrl, {
        cache: 'no-store',
        mode: 'cors',
        credentials: 'omit',
      });
      if (res.ok) {
        const cfg = (await res.json()) as {
          supabaseUrl?: string;
          supabaseAnonKey?: string;
        };
        if (
          cfg.supabaseUrl?.startsWith('http') &&
          cfg.supabaseAnonKey &&
          cfg.supabaseAnonKey.length > 20
        ) {
          url = cfg.supabaseUrl;
          key = cfg.supabaseAnonKey;
        }
      }
    } catch {
      // يبقى العنوان من VITE_* أو placeholder
    }
  }

  supabase = createClient(url, key);
}
