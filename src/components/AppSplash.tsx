import {useEffect, useRef, useState} from 'react';
import {motion} from 'motion/react';
import {whenPrecacheReady} from '../lib/pwaRegister';
import {BrandLogo} from './BrandLogo';

/** أصول واجهة تُحمَّل أثناء الشاشة لتصفح أخف لاحقاً */
const PRELOAD_IMAGES = [
  '/icons/logo.png',
  '/icons/zaincash.png',
  '/icons/superqi.png',
  '/icons/firstbank.png',
  '/icons/fastpay.png',
];

const MIN_VISIBLE_MS = 900;
const REDUCED_MOTION_HOLD_MS = 1_000;
const DESKTOP_INTRO_MS = 650;
/** مدة كافية لعرض الحركة على الهاتف بدون فيديو ثقيل — أسلس للـ APK */
const PHONE_MOTION_INTRO_MS = 2_400;
/** أجهزة ضعيفة: إدخال أقصر وبدون خلفية متحركة ثقيلة */
const PHONE_LOW_END_INTRO_MS = 900;
const PHONE_MAX_WIDTH_PX = 767;

function useLowEndDevice() {
  const [low, setLow] = useState(false);
  useEffect(() => {
    const cores = typeof navigator !== 'undefined' ? (navigator.hardwareConcurrency ?? 8) : 8;
    const mem = typeof navigator !== 'undefined' ? ((navigator as Navigator & {deviceMemory?: number}).deviceMemory ?? 8) : 8;
    setLow(cores <= 4 || mem <= 4);
  }, []);
  return low;
}

type Props = {
  appTitle: string;
  settingsReady: boolean;
  onComplete: () => void;
};

function usePhoneViewport() {
  const [isPhone, setIsPhone] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia(`(max-width: ${PHONE_MAX_WIDTH_PX}px)`).matches : false,
  );

  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${PHONE_MAX_WIDTH_PX}px)`);
    const onChange = () => setIsPhone(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  return isPhone;
}

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduced(mq.matches);
    const fn = () => setReduced(mq.matches);
    mq.addEventListener('change', fn);
    return () => mq.removeEventListener('change', fn);
  }, []);
  return reduced;
}

/** خلفية حركية خفيفة (transform/opacity فقط — مناسبة للـ GPU) */
function PhoneMotionBackdrop() {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden bg-[#07070c]">
      <motion.div
        className="absolute -left-[20%] top-[15%] h-[min(85vw,380px)] w-[min(85vw,380px)] rounded-full bg-red-600/30 blur-[72px]"
        animate={{x: [0, 24, 0], y: [0, 16, 0], scale: [1, 1.06, 1], opacity: [0.45, 0.65, 0.45]}}
        transition={{duration: 5.5, repeat: Infinity, ease: 'easeInOut'}}
      />
      <motion.div
        className="absolute -right-[15%] bottom-[20%] h-[min(70vw,320px)] w-[min(70vw,320px)] rounded-full bg-rose-500/20 blur-[64px]"
        animate={{x: [0, -20, 0], y: [0, -12, 0], scale: [1, 1.1, 1], opacity: [0.35, 0.55, 0.35]}}
        transition={{duration: 4.8, repeat: Infinity, ease: 'easeInOut', delay: 0.4}}
      />
      <motion.div
        className="absolute left-1/2 top-[40%] h-[min(60vw,280px)] w-[min(60vw,280px)] -translate-x-1/2 rounded-full bg-white/5 blur-[48px]"
        animate={{opacity: [0.15, 0.28, 0.15]}}
        transition={{duration: 3.2, repeat: Infinity, ease: 'easeInOut'}}
      />
      <div
        className="absolute inset-0 bg-gradient-to-b from-black/20 via-transparent to-black/70"
        aria-hidden
      />
    </div>
  );
}

/**
 * بدون ملف فيديو: حركة سلسة خفيفة على الهاتف (أصغر حجمًا للـ APK وأقل تقطيعًا من mp4).
 * سطح المكتب: شاشة فاتحة قصيرة.
 */
export function AppSplash({appTitle, settingsReady, onComplete}: Props) {
  const mountRef = useRef<number>(Date.now());
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  const isPhoneViewport = usePhoneViewport();
  const prefersReducedMotion = usePrefersReducedMotion();

  const [introDone, setIntroDone] = useState(false);
  const [visible, setVisible] = useState(true);
  const [bootAssetsReady, setBootAssetsReady] = useState(false);
  const [swCacheReady, setSwCacheReady] = useState(false);
  const lowEndDevice = useLowEndDevice();

  useEffect(() => {
    if (typeof document === 'undefined') return;
    if (lowEndDevice) {
      document.documentElement.classList.add('saraf-low-end');
    } else {
      document.documentElement.classList.remove('saraf-low-end');
    }
  }, [lowEndDevice]);

  useEffect(() => {
    let cancelled = false;
    whenPrecacheReady.then(() => {
      if (!cancelled) setSwCacheReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const fontsReady = document.fonts.ready;
    const imagesReady = Promise.all(
      PRELOAD_IMAGES.map(
        (src) =>
          new Promise<void>((resolve) => {
            const img = new Image();
            img.onload = () => resolve();
            img.onerror = () => resolve();
            img.src = src;
          }),
      ),
    );
    Promise.all([fontsReady, imagesReady]).then(() => {
      if (!cancelled) setBootAssetsReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const phoneMotion = isPhoneViewport && !prefersReducedMotion && !lowEndDevice;
  const phoneReduced = isPhoneViewport && (prefersReducedMotion || lowEndDevice);

  useEffect(() => {
    if (!isPhoneViewport) {
      const t = window.setTimeout(() => setIntroDone(true), DESKTOP_INTRO_MS);
      return () => window.clearTimeout(t);
    }
    if (phoneReduced) {
      const ms = lowEndDevice ? PHONE_LOW_END_INTRO_MS : REDUCED_MOTION_HOLD_MS;
      const t = window.setTimeout(() => setIntroDone(true), ms);
      return () => window.clearTimeout(t);
    }
    const t = window.setTimeout(() => setIntroDone(true), PHONE_MOTION_INTRO_MS);
    const cap = window.setTimeout(() => setIntroDone(true), 12_000);
    return () => {
      window.clearTimeout(t);
      window.clearTimeout(cap);
    };
  }, [isPhoneViewport, phoneReduced, lowEndDevice]);

  useEffect(() => {
    if (!settingsReady || !introDone || !bootAssetsReady || !swCacheReady) return;
    const elapsed = Date.now() - mountRef.current;
    const wait = Math.max(0, MIN_VISIBLE_MS - elapsed);
    const timer = window.setTimeout(() => {
      setVisible(false);
      window.setTimeout(() => onCompleteRef.current(), 300);
    }, wait);
    return () => window.clearTimeout(timer);
  }, [settingsReady, introDone, bootAssetsReady, swCacheReady]);

  const darkPhone = phoneMotion;

  return (
    <motion.div
      role="status"
      aria-busy="true"
      aria-label={appTitle}
      className={`fixed inset-0 z-[100] flex flex-col overflow-hidden ${
        darkPhone ? 'bg-[#07070c]' : 'bg-[#F8FAFC]'
      }`}
      style={{
        paddingTop: 'env(safe-area-inset-top)',
        paddingBottom: 'env(safe-area-inset-bottom)',
        paddingLeft: 'env(safe-area-inset-left)',
        paddingRight: 'env(safe-area-inset-right)',
      }}
      initial={{opacity: 1}}
      animate={{opacity: visible ? 1 : 0}}
      transition={{duration: 0.3}}
    >
      {phoneMotion && <PhoneMotionBackdrop />}

      <div
        className={`relative z-10 flex min-h-0 flex-1 flex-col items-center justify-center px-6 ${
          darkPhone ? 'gap-10 pb-8' : 'gap-8'
        }`}
      >
        {phoneMotion && (
          <motion.div
            initial={{scale: 0.88, opacity: 0}}
            animate={{scale: 1, opacity: 1}}
            transition={{type: 'spring', stiffness: 280, damping: 24}}
            className="relative"
          >
            <motion.div
              animate={{y: [0, -7, 0]}}
              transition={{duration: 2.4, repeat: Infinity, ease: 'easeInOut'}}
            >
              <div className="rounded-[2rem] bg-white/95 p-6 shadow-[0_28px_80px_rgba(0,0,0,0.5)] ring-1 ring-white/25">
                <BrandLogo alt={appTitle} size="xl" priority className="drop-shadow-sm" />
              </div>
            </motion.div>
          </motion.div>
        )}

        {(phoneReduced || !isPhoneViewport) && (
          <motion.div
            initial={{scale: 0.92, opacity: 0}}
            animate={{scale: 1, opacity: 1}}
            transition={{duration: 0.4, ease: [0.22, 1, 0.36, 1]}}
            className="rounded-[2rem] bg-white p-5 shadow-[0_24px_64px_rgba(15,23,42,0.08)] ring-1 ring-gray-200/80"
          >
            <BrandLogo alt={appTitle} size="xl" priority className="drop-shadow-sm" />
          </motion.div>
        )}

        <div className="flex max-w-sm flex-col items-center gap-4 text-center">
          <p
            className={`text-lg font-black tracking-tight sm:text-xl ${
              darkPhone ? 'text-white drop-shadow-[0_2px_14px_rgba(0,0,0,0.9)]' : 'text-gray-900'
            }`}
          >
            {appTitle}
          </p>
          <div
            className={darkPhone ? 'saraf-loading-bar saraf-loading-bar--on-video' : 'saraf-loading-bar'}
            aria-hidden
          />
          <p
            className={`text-xs font-semibold uppercase tracking-[0.2em] ${
              darkPhone ? 'text-white/65' : 'text-gray-400'
            }`}
          >
            Loading
          </p>
        </div>

        <span className="sr-only">Loading</span>
      </div>
    </motion.div>
  );
}
