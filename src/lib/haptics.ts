// Haptic feedback for mobile - Capacitor optional

type HapticsPlugin = {
  impact: (options: { style: 'light' | 'medium' | 'heavy' }) => Promise<void>;
  notification: (options: { type: 'success' | 'warning' | 'error' }) => Promise<void>;
  vibrate: () => Promise<void>;
};

// Dynamically import Capacitor Haptics
let Haptics: HapticsPlugin | null = null;

// Lazy load haptics
const loadHaptics = async (): Promise<HapticsPlugin | null> => {
  if (Haptics) return Haptics;
  try {
    // Only load in native environment
    if (typeof window !== 'undefined' && 
        typeof (window as unknown as { Capacitor?: { isNativePlatform: () => boolean } }).Capacitor !== 'undefined' &&
        (window as unknown as { Capacitor?: { isNativePlatform: () => boolean } }).Capacitor?.isNativePlatform() === true) {
      // @ts-ignore - Capacitor may not be installed
      const module = await import('@capacitor/haptics');
      Haptics = module.Haptics as HapticsPlugin;
      return Haptics;
    }
    return null;
  } catch {
    return null;
  }
};

export const ImpactStyle = {
  Light: 'light' as const,
  Medium: 'medium' as const,
  Heavy: 'heavy' as const,
};

export const NotificationType = {
  Success: 'success' as const,
  Warning: 'warning' as const,
  Error: 'error' as const,
};

// Check if running on native mobile
const isNative = (): boolean => {
  return typeof window !== 'undefined' && 
         typeof (window as unknown as { Capacitor?: { isNativePlatform: () => boolean } }).Capacitor !== 'undefined' &&
         (window as unknown as { Capacitor?: { isNativePlatform: () => boolean } }).Capacitor?.isNativePlatform() === true;
};

export const haptics = {
  // Light feedback for small interactions
  async light() {
    const h = await loadHaptics();
    if (h && isNative()) {
      await h.impact({ style: 'light' });
    }
  },

  // Medium feedback for buttons
  async medium() {
    const h = await loadHaptics();
    if (h && isNative()) {
      await h.impact({ style: 'medium' });
    }
  },

  // Heavy feedback for important actions
  async heavy() {
    const h = await loadHaptics();
    if (h && isNative()) {
      await h.impact({ style: 'heavy' });
    }
  },

  // Success feedback
  async success() {
    const h = await loadHaptics();
    if (h && isNative()) {
      await h.notification({ type: 'success' });
    }
  },

  // Error feedback
  async error() {
    const h = await loadHaptics();
    if (h && isNative()) {
      await h.notification({ type: 'error' });
    }
  },

  // Warning feedback
  async warning() {
    const h = await loadHaptics();
    if (h && isNative()) {
      await h.notification({ type: 'warning' });
    }
  },

  // Vibrate pattern
  async vibrate() {
    if (isNative()) {
      const h = await loadHaptics();
      if (h) await h.vibrate();
    } else if (typeof navigator !== 'undefined' && navigator.vibrate) {
      navigator.vibrate(50);
    }
  },
};
