/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_ANON_KEY: string;
  /** Optional full URL to APK (e.g. CDN). Defaults to /saraf-iq-debug.apk */
  readonly VITE_APK_URL?: string;
}
