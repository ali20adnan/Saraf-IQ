/**
 * تسجيل Service Worker مرة واحدة فقط، مع وعد يكتمل عند انتهاء precache (أو مهلة).
 * على تطبيق Capacitor الأصلي لا ننتظر الويب طويلاً — المحتوى مضمَّن محلياً.
 */
import {registerSW} from 'virtual:pwa-register';

let settled = false;
let resolveReady!: () => void;

export const whenPrecacheReady = new Promise<void>((resolve) => {
  resolveReady = () => {
    if (settled) return;
    settled = true;
    resolve();
  };

  registerSW({
    immediate: true,
    onOfflineReady() {
      resolveReady();
    },
  });

  const MAX_WAIT_MS = 14_000;
  setTimeout(resolveReady, MAX_WAIT_MS);

  if (typeof window !== 'undefined') {
    const cap = (window as unknown as {Capacitor?: {isNativePlatform?: () => boolean}}).Capacitor;
    if (cap?.isNativePlatform?.()) {
      setTimeout(resolveReady, 600);
    }
  }
});
