import React, {useCallback, useEffect, useRef, useState} from 'react';
import {Check, X, ZoomIn} from 'lucide-react';

type Props = {
  /** الصورة الأصلية المختارة (data URL) */
  src: string;
  /** نسبة العرض إلى الارتفاع لإطار الاقتصاص (نفس نسبة الكاروسيل) */
  aspect: number;
  lang: 'ar' | 'en';
  onCancel: () => void;
  onCrop: (dataUrl: string) => void;
};

/**
 * أداة اقتصاص خفيفة (بدون مكتبات): اسحب لتحريك الصورة، وكبّر بالشريط.
 * تُصدِّر الجزء الظاهر داخل الإطار كـ JPEG مضغوط بنفس نسبة الكاروسيل،
 * فيُعرض كاملاً عبر object-cover دون قصّ إضافي.
 */
export function CarouselImageCropper({src, aspect, lang, onCancel, onCrop}: Props) {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const drag = useRef({startX: 0, startY: 0, ox: 0, oy: 0, active: false});
  const [nat, setNat] = useState<{w: number; h: number} | null>(null);
  const [vp, setVp] = useState({w: 320, h: Math.round(320 / aspect)});
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({x: 0, y: 0});

  // أبعاد الصورة الطبيعية
  useEffect(() => {
    const im = new Image();
    im.onload = () => {
      setNat({w: im.naturalWidth, h: im.naturalHeight});
      setZoom(1);
    };
    im.src = src;
  }, [src]);

  // قياس عرض إطار المعاينة بشكل متجاوب
  useEffect(() => {
    const measure = () => {
      const el = viewportRef.current;
      if (!el) return;
      const w = el.clientWidth;
      setVp({w, h: Math.round(w / aspect)});
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [aspect]);

  const coverScale = nat ? Math.max(vp.w / nat.w, vp.h / nat.h) : 1;
  const effScale = coverScale * zoom;
  const dW = nat ? nat.w * effScale : 0;
  const dH = nat ? nat.h * effScale : 0;

  const clamp = useCallback(
    (o: {x: number; y: number}) => ({
      x: Math.min(0, Math.max(vp.w - dW, o.x)),
      y: Math.min(0, Math.max(vp.h - dH, o.y)),
    }),
    [vp.w, vp.h, dW, dH],
  );

  // توسيط عند تحميل الصورة أو تغيّر المقاس
  useEffect(() => {
    if (!nat) return;
    setOffset(clamp({x: (vp.w - dW) / 2, y: (vp.h - dH) / 2}));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nat, vp.w, vp.h, coverScale]);

  // إعادة ضبط الحدود عند التكبير
  useEffect(() => {
    setOffset((o) => clamp(o));
  }, [clamp]);

  const onPointerDown = (e: React.PointerEvent) => {
    drag.current = {startX: e.clientX, startY: e.clientY, ox: offset.x, oy: offset.y, active: true};
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag.current.active) return;
    setOffset(
      clamp({
        x: drag.current.ox + (e.clientX - drag.current.startX),
        y: drag.current.oy + (e.clientY - drag.current.startY),
      }),
    );
  };
  const onPointerUp = () => {
    drag.current.active = false;
  };

  const doCrop = () => {
    if (!nat) return;
    const OUT_W = 1000;
    const OUT_H = Math.round(OUT_W / aspect);
    const canvas = document.createElement('canvas');
    canvas.width = OUT_W;
    canvas.height = OUT_H;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const sx = -offset.x / effScale;
    const sy = -offset.y / effScale;
    const sW = vp.w / effScale;
    const sH = vp.h / effScale;
    const im = new Image();
    im.onload = () => {
      ctx.drawImage(im, sx, sy, sW, sH, 0, 0, OUT_W, OUT_H);
      onCrop(canvas.toDataURL('image/jpeg', 0.85));
    };
    im.src = src;
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-4"
      dir={lang === 'ar' ? 'rtl' : 'ltr'}
      onClick={onCancel}
    >
      <div className="w-full max-w-md space-y-4 rounded-3xl bg-white p-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="font-black text-gray-900">{lang === 'ar' ? 'اقتصاص الصورة' : 'Crop Image'}</h3>
          <button onClick={onCancel} className="rounded-xl p-1.5 text-gray-500 hover:bg-gray-100">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div
          ref={viewportRef}
          className="relative w-full touch-none select-none overflow-hidden rounded-2xl bg-gray-900"
          style={{height: vp.h, cursor: drag.current.active ? 'grabbing' : 'grab'}}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          {nat && (
            <img
              src={src}
              alt=""
              draggable={false}
              style={{position: 'absolute', left: offset.x, top: offset.y, width: dW, height: dH, maxWidth: 'none'}}
            />
          )}
          <div className="pointer-events-none absolute inset-0 rounded-2xl ring-2 ring-inset ring-white/70" />
        </div>

        <div className="flex items-center gap-3">
          <ZoomIn className="h-4 w-4 shrink-0 text-gray-500" />
          <input
            type="range"
            min={1}
            max={4}
            step={0.01}
            value={zoom}
            onChange={(e) => setZoom(parseFloat(e.target.value))}
            className="h-2 w-full accent-red-600"
          />
        </div>

        <p className="text-center text-xs text-gray-400">
          {lang === 'ar' ? 'اسحب لتحريك الصورة، واستخدم الشريط للتكبير' : 'Drag to move, use the slider to zoom'}
        </p>

        <div className="flex gap-2">
          <button onClick={onCancel} className="flex-1 rounded-2xl bg-gray-100 py-3 font-bold text-gray-700 active:scale-[0.99]">
            {lang === 'ar' ? 'إلغاء' : 'Cancel'}
          </button>
          <button
            onClick={doCrop}
            disabled={!nat}
            className="flex flex-1 items-center justify-center gap-2 rounded-2xl bg-red-600 py-3 font-black text-white disabled:opacity-50 active:scale-[0.99]"
          >
            <Check className="h-4 w-4" />
            {lang === 'ar' ? 'حفظ' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
