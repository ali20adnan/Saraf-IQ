import {useCallback, useEffect, useRef, useState} from 'react';
import {motion} from 'motion/react';
import {BrandLogo} from './BrandLogo';

const INTRO_MAX_MS = 14_000;
const MIN_VISIBLE_MS = 900;
const REDUCED_MOTION_HOLD_MS = 1_000;

/** فيديو التحميل: ضع الملف في public/icons/loading.mp4 */
const LOADING_VIDEO = '/icons/loading.mp4';

type Props = {
  appTitle: string;
  settingsReady: boolean;
  onComplete: () => void;
};

/**
 * شاشة تحميل: تعرض loading.mp4 مع طبقة تدرّج وشريط تقدّم غير محدد.
 * بدون فيديو (خطأ / تقليل الحركة): شعار + نفس الشريط على خلفية فاتحة.
 */
export function AppSplash({appTitle, settingsReady, onComplete}: Props) {
  const mountRef = useRef<number>(Date.now());
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;
  const videoRef = useRef<HTMLVideoElement>(null);

  const [introDone, setIntroDone] = useState(false);
  const [visible, setVisible] = useState(true);

  const [wantsVideo, setWantsVideo] = useState(() => {
    if (typeof window === 'undefined') return false;
    return !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  });

  useEffect(() => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) {
      setWantsVideo(false);
      const t = window.setTimeout(() => setIntroDone(true), REDUCED_MOTION_HOLD_MS);
      return () => window.clearTimeout(t);
    }
    setWantsVideo(true);
    const maxTimer = window.setTimeout(() => setIntroDone(true), INTRO_MAX_MS);
    return () => window.clearTimeout(maxTimer);
  }, []);

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

  const showVideo = wantsVideo;

  return (
    <motion.div
      role="status"
      aria-busy="true"
      aria-label={appTitle}
      className={`fixed inset-0 z-[100] flex flex-col overflow-hidden ${
        showVideo ? 'bg-black' : 'bg-[#F8FAFC]'
      }`}
      style={{
        paddingTop: 'env(safe-area-inset-top)',
        paddingBottom: 'env(safe-area-inset-bottom)',
        paddingLeft: 'env(safe-area-inset-left)',
        paddingRight: 'env(safe-area-inset-right)',
      }}
      initial={{opacity: 1}}
      animate={{opacity: visible ? 1 : 0}}
      transition={{duration: 0.32}}
    >
      {showVideo && (
        <video
          ref={videoRef}
          className="pointer-events-none absolute inset-0 h-full w-full select-none bg-black object-contain object-center"
          poster="/icons/logo.png"
          playsInline
          muted
          preload="auto"
          disablePictureInPicture
          controls={false}
          onLoadedMetadata={tryPlay}
          onCanPlay={tryPlay}
          onEnded={handleVideoEnded}
          onError={handleVideoError}
        >
          <source src={LOADING_VIDEO} type="video/mp4" />
        </video>
      )}

      {/* تدرّج للقراءة + إحساس بـ «طبقة علوية» احترافية */}
      <div
        className={`pointer-events-none absolute inset-0 ${
          showVideo
            ? 'bg-gradient-to-t from-black/85 via-black/25 to-black/40'
            : 'bg-gradient-to-b from-[#F8FAFC] via-[#F8FAFC] to-gray-100/90'
        }`}
        aria-hidden
      />

      <div
        className={`relative z-10 flex min-h-0 flex-1 flex-col items-center px-6 ${
          showVideo ? 'justify-end pb-10 sm:pb-14' : 'justify-center gap-8'
        }`}
      >
        {!showVideo && (
          <motion.div
            initial={{scale: 0.92, opacity: 0}}
            animate={{scale: 1, opacity: 1}}
            transition={{duration: 0.4, ease: [0.22, 1, 0.36, 1]}}
            className="rounded-[2rem] bg-white p-5 shadow-[0_24px_64px_rgba(15,23,42,0.08)] ring-1 ring-gray-200/80"
          >
            <BrandLogo alt={appTitle} size="xl" priority className="drop-shadow-sm" />
          </motion.div>
        )}

        <div className={`flex max-w-sm flex-col items-center gap-4 text-center ${showVideo ? 'w-full' : ''}`}>
          <p
            className={`text-lg font-black tracking-tight sm:text-xl ${
              showVideo ? 'text-white drop-shadow-[0_2px_12px_rgba(0,0,0,0.85)]' : 'text-gray-900'
            }`}
          >
            {appTitle}
          </p>
          <div
            className={showVideo ? 'saraf-loading-bar saraf-loading-bar--on-video' : 'saraf-loading-bar'}
            aria-hidden
          />
          <p
            className={`text-xs font-semibold uppercase tracking-[0.2em] ${
              showVideo ? 'text-white/70' : 'text-gray-400'
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
