/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface ImportMetaEnv {
  /** يُستبدل في الإنتاج عند نجاح GET /api/public-config (متغيرات Railway على الخادم) */
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
  /** Optional full URL to APK (e.g. CDN). Defaults to /download/apk on same origin */
  readonly VITE_APK_URL?: string;
  /**
   * أصل خادم Railway (مثال: https://xxx.up.railway.app) — لطلب /api/public-config من تطبيق Capacitor
   * عندما لا يكون نفس المنشأ (same-origin).
   */
  readonly VITE_APP_API_ORIGIN?: string;
}
