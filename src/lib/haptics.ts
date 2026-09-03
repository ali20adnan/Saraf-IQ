// Haptic feedback — Capacitor (bundled with the app; no-op on web)

import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics';

export { ImpactStyle, NotificationType };

const isNative = (): boolean => {
  return (
    typeof window !== 'undefined' &&
    typeof (window as unknown as { Capacitor?: { isNativePlatform: () => boolean } }).Capacitor !== 'undefined' &&
    (window as unknown as { Capacitor?: { isNativePlatform: () => boolean } }).Capacitor?.isNativePlatform() === true
  );
};

export const haptics = {
  async light() {
    if (isNative()) await Haptics.impact({ style: ImpactStyle.Light });
  },

  async medium() {
    if (isNative()) await Haptics.impact({ style: ImpactStyle.Medium });
  },

  async heavy() {
    if (isNative()) await Haptics.impact({ style: ImpactStyle.Heavy });
  },

  async success() {
    if (isNative()) await Haptics.notification({ type: NotificationType.Success });
  },

  async error() {
    if (isNative()) await Haptics.notification({ type: NotificationType.Error });
  },

  async warning() {
    if (isNative()) await Haptics.notification({ type: NotificationType.Warning });
  },

  async vibrate() {
    if (isNative()) {
      await Haptics.vibrate({ duration: 50 });
    } else if (typeof navigator !== 'undefined' && navigator.vibrate) {
      navigator.vibrate(50);
    }
  },
};
