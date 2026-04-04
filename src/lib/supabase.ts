import {createClient, type SupabaseClient} from '@supabase/supabase-js';

function defaultUrl(): string {
  const u = import.meta.env.VITE_SUPABASE_URL;
  return u && u.startsWith('http') ? u : 'https://placeholder-project.supabase.co';
}

function defaultKey(): string {
  return import.meta.env.VITE_SUPABASE_ANON_KEY || 'placeholder-anon-key';
}

function publicConfigUrl(): string {
  const origin = import.meta.env.VITE_APP_API_ORIGIN?.replace(/\/$/, '').trim();
  if (origin && origin.startsWith('http')) {
    return `${origin}/api/public-config`;
  }
  return '/api/public-config';
}

export let supabase: SupabaseClient;

export async function initSupabase(): Promise<void> {
  let url = defaultUrl();
  let key = defaultKey();

  if (import.meta.env.PROD) {
    try {
      const res = await fetch(publicConfigUrl(), {
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
      // يبقى العنوان من VITE_* عند البناء المحلي أو عند فشل الشبكة
    }
  }

  supabase = createClient(url, key);
}
