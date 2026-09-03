/**
 * تسجيل Service Worker مرة واحدة فقط، مع وعد يكتمل عند انتهاء precache (أو مهلة قصيرة).
 * على Capacitor: لا ننتظر SW — المحتوى مضمَّن محلياً.
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

  if (typeof window !== 'undefined') {
    try {
      const cap = (window as unknown as {Capacitor?: {isNativePlatform?: () => boolean}}).Capacitor;
      if (cap?.isNativePlatform?.()) {
        resolveReady();
      }
    } catch {
      // ignore
    }
  }

  registerSW({
    immediate: true,
    onOfflineReady() {
      resolveReady();
    },
  });

  /** سقف قصير — لا نحجز الشاشة الافتتاحية أكثر من ~ثانية بسبب الـ SW */
  const MAX_WAIT_MS = 450;
  setTimeout(resolveReady, MAX_WAIT_MS);
});
