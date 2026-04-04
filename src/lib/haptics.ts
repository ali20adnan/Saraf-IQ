// Haptic feedback for mobile — Capacitor optional (dynamic import for native)

import type { HapticsPlugin } from '@capacitor/haptics';
import { ImpactStyle, NotificationType } from '@capacitor/haptics';

export { ImpactStyle, NotificationType };

let Haptics: HapticsPlugin | null = null;

const loadHaptics = async (): Promise<HapticsPlugin | null> => {
  if (Haptics) return Haptics;
  try {
    if (
      typeof window !== 'undefined' &&
      typeof (window as unknown as { Capacitor?: { isNativePlatform: () => boolean } }).Capacitor !== 'undefined' &&
      (window as unknown as { Capacitor?: { isNativePlatform: () => boolean } }).Capacitor?.isNativePlatform() === true
    ) {
      const module = await import('@capacitor/haptics');
      Haptics = module.Haptics;
      return Haptics;
    }
    return null;
  } catch {
    return null;
  }
};

const isNative = (): boolean => {
  return (
    typeof window !== 'undefined' &&
    typeof (window as unknown as { Capacitor?: { isNativePlatform: () => boolean } }).Capacitor !== 'undefined' &&
    (window as unknown as { Capacitor?: { isNativePlatform: () => boolean } }).Capacitor?.isNativePlatform() === true
  );
};

export const haptics = {
  async light() {
    const h = await loadHaptics();
    if (h && isNative()) await h.impact({ style: ImpactStyle.Light });
  },

  async medium() {
    const h = await loadHaptics();
    if (h && isNative()) await h.impact({ style: ImpactStyle.Medium });
  },

  async heavy() {
    const h = await loadHaptics();
    if (h && isNative()) await h.impact({ style: ImpactStyle.Heavy });
  },

  async success() {
    const h = await loadHaptics();
    if (h && isNative()) await h.notification({ type: NotificationType.Success });
  },

  async error() {
    const h = await loadHaptics();
    if (h && isNative()) await h.notification({ type: NotificationType.Error });
  },

  async warning() {
    const h = await loadHaptics();
    if (h && isNative()) await h.notification({ type: NotificationType.Warning });
  },

  async vibrate() {
    if (isNative()) {
      const h = await loadHaptics();
      if (h) await h.vibrate({ duration: 50 });
    } else if (typeof navigator !== 'undefined' && navigator.vibrate) {
      navigator.vibrate(50);
    }
  },
};
