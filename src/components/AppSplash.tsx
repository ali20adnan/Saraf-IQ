import {useCallback, useEffect, useRef, useState} from 'react';
import {motion} from 'motion/react';
import {BrandLogo} from './BrandLogo';

const INTRO_MAX_MS = 14_000;
const MIN_VISIBLE_MS = 900;
const REDUCED_MOTION_HOLD_MS = 1_000;
const DESKTOP_INTRO_MS = 650;
/** عرض ≤ هذا يُعتبر هاتفًا لعرض فيديو التحميل فقط */
const PHONE_MAX_WIDTH_PX = 767;

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

/**
 * فيديو اختياري: `public/splash/intro.webm` و/أو `intro.mp4`
 * — يُعرض على الهاتف فقط (عرض ≤767px). على الحاسوب: خلفية نظيفة + شعار بدون فيديو.
 * — `object-contain` بدل `object-cover` حتى لا يُكبَّر الفيديو/الملصق ويصبح ضبابيًا.
 */
export function AppSplash({appTitle, settingsReady, onComplete}: Props) {
  const mountRef = useRef<number>(Date.now());
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;
  const videoRef = useRef<HTMLVideoElement>(null);

  const isPhoneViewport = usePhoneViewport();
  const [introDone, setIntroDone] = useState(false);
  const [visible, setVisible] = useState(true);

  const [wantsVideo, setWantsVideo] = useState(() => {
    if (typeof window === 'undefined') return false;
    if (!window.matchMedia(`(max-width: ${PHONE_MAX_WIDTH_PX}px)`).matches) return false;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return false;
    return true;
  });

  useEffect(() => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (reduce) {
      setWantsVideo(false);
      const t = window.setTimeout(() => setIntroDone(true), REDUCED_MOTION_HOLD_MS);
      return () => window.clearTimeout(t);
    }

    if (!isPhoneViewport) {
      setWantsVideo(false);
      const t = window.setTimeout(() => setIntroDone(true), DESKTOP_INTRO_MS);
      return () => window.clearTimeout(t);
    }

    setWantsVideo(true);
    const maxTimer = window.setTimeout(() => setIntroDone(true), INTRO_MAX_MS);
    return () => window.clearTimeout(maxTimer);
  }, [isPhoneViewport]);

  const tryPlay = useCallback(() => {
    const el = videoRef.current;
    if (!el || !wantsVideo) return;
    el.play().catch(() => {
      setWantsVideo(false);
      setIntroDone(true);
    });
  }, [wantsVideo]);

  useEffect(() => {
    if (!settingsReady || !introDone) return;
    const elapsed = Date.now() - mountRef.current;
    const wait = Math.max(0, MIN_VISIBLE_MS - elapsed);
    const t = window.setTimeout(() => {
      setVisible(false);
      window.setTimeout(() => onCompleteRef.current(), 320);
    }, wait);
    return () => window.clearTimeout(t);
  }, [settingsReady, introDone]);

  const handleVideoEnded = () => setIntroDone(true);
  const handleVideoError = () => {
    setWantsVideo(false);
    setIntroDone(true);
  };

  const showVideoLayer = isPhoneViewport && wantsVideo;

  return (
    <motion.div
      role="status"
      aria-busy="true"
      aria-label={appTitle}
      className="fixed inset-0 z-[100] flex flex-col items-center justify-center overflow-hidden bg-[#F8FAFC]"
      style={{
        paddingTop: 'env(safe-area-inset-top)',
        paddingBottom: 'env(safe-area-inset-bottom)',
        paddingLeft: 'env(safe-area-inset-left)',
        paddingRight: 'env(safe-area-inset-right)',
      }}
      initial={{opacity: 1}}
      animate={{opacity: visible ? 1 : 0}}
      transition={{duration: 0.28}}
    >
      {showVideoLayer && (
        <video
          ref={videoRef}
          className="absolute inset-0 h-full w-full bg-[#F8FAFC] object-contain object-center"
          playsInline
          muted
          preload="auto"
          onLoadedMetadata={tryPlay}
          onCanPlay={tryPlay}
          onEnded={handleVideoEnded}
          onError={handleVideoError}
        >
          <source src="/splash/intro.webm" type="video/webm" />
          <source src="/splash/intro.mp4" type="video/mp4" />
        </video>
      )}

      <div
        className={`absolute inset-0 bg-gradient-to-b ${
          showVideoLayer
            ? 'from-black/15 via-transparent to-[#F8FAFC]/90'
            : 'from-[#F8FAFC] via-[#F8FAFC] to-[#F8FAFC]'
        }`}
        aria-hidden
      />

      <div className="relative z-10 flex flex-col items-center gap-6 px-6 text-center">
        <motion.div
          initial={{scale: 0.94, opacity: 0}}
          animate={{scale: 1, opacity: 1}}
          transition={{duration: 0.45, ease: [0.22, 1, 0.36, 1]}}
          className="rounded-[2rem] bg-white/95 p-4 shadow-[0_20px_60px_rgba(0,0,0,0.12)] ring-1 ring-black/5 backdrop-blur-sm supports-[backdrop-filter]:bg-white/85"
        >
          <BrandLogo alt={appTitle} size="xl" priority className="drop-shadow-sm" />
        </motion.div>
        <div className="flex flex-col items-center gap-3">
          <p className="text-lg font-black tracking-tight text-gray-900 drop-shadow-sm">{appTitle}</p>
          <div
            className="h-9 w-9 rounded-full border-[3px] border-red-600 border-t-transparent animate-spin motion-reduce:animate-none motion-reduce:opacity-40"
            aria-hidden
          />
          <span className="sr-only">Loading</span>
        </div>
      </div>
    </motion.div>
  );
}
