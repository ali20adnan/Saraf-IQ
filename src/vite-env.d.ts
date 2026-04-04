/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_ANON_KEY: string;
  /** Optional full URL to APK (e.g. CDN). Defaults to /download/apk on same origin */
  readonly VITE_APK_URL?: string;
}
