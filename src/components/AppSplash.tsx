import {useCallback, useEffect, useRef, useState} from 'react';
import {motion} from 'motion/react';
import {BrandLogo} from './BrandLogo';

const INTRO_MAX_MS = 14_000;
const MIN_VISIBLE_MS = 900;
const REDUCED_MOTION_HOLD_MS = 1_000;

type Props = {
  appTitle: string;
  settingsReady: boolean;
  onComplete: () => void;
};

/**
 * Optional intro video: place `public/splash/intro.webm` and/or `public/splash/intro.mp4`.
 * If files are missing, shows logo + subtle loader until settings load (works well on mobile).
 */
export function AppSplash({appTitle, settingsReady, onComplete}: Props) {
  const mountRef = useRef<number>(Date.now());
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;
  const videoRef = useRef<HTMLVideoElement>(null);
  const [introDone, setIntroDone] = useState(false);
  const [useVideo, setUseVideo] = useState(true);
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const reduce =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduce) {
      setUseVideo(false);
      const t = window.setTimeout(() => setIntroDone(true), REDUCED_MOTION_HOLD_MS);
      return () => window.clearTimeout(t);
    }
    const maxTimer = window.setTimeout(() => setIntroDone(true), INTRO_MAX_MS);
    return () => window.clearTimeout(maxTimer);
  }, []);

  const tryPlay = useCallback(() => {
    const el = videoRef.current;
    if (!el || !useVideo) return;
    el.play().catch(() => {
      setUseVideo(false);
      setIntroDone(true);
    });
  }, [useVideo]);

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
    setUseVideo(false);
    setIntroDone(true);
  };

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
      {useVideo && (
        <video
          ref={videoRef}
          className="absolute inset-0 h-full w-full object-cover object-center"
          poster="/icons/logo.png"
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
        className={`absolute inset-0 bg-gradient-to-b from-black/25 via-black/10 to-[#F8FAFC]/95 ${useVideo ? '' : 'from-[#F8FAFC] via-[#F8FAFC] to-[#F8FAFC]'}`}
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
