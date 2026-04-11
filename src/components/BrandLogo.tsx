import type {ImgHTMLAttributes} from 'react';

const sizeStyles = {
  /** تابات الجوال وأماكن ضيقة */
  xs: 'h-6 w-6 min-h-[1.5rem] min-w-[1.5rem]',
  sm: 'h-10 w-10 min-h-[2.5rem] min-w-[2.5rem]',
  md: 'h-12 w-12 min-h-[3rem] min-w-[3rem]',
  lg: 'h-14 w-14 min-h-[3.5rem] min-w-[3.5rem]',
  xl: 'h-20 w-20 min-h-[5rem] min-w-[5rem]',
} as const;

export type BrandLogoSize = keyof typeof sizeStyles;

type Props = Omit<ImgHTMLAttributes<HTMLImageElement>, 'src' | 'decoding'> & {
  /** فارغ عند وجود عنوان بجانب الصورة (يتجنب تكرار للقارئ الشاشة) */
  alt?: string;
  size?: BrandLogoSize;
  /** First paint / LCP — use on splash and primary headers */
  priority?: boolean;
};

/** Square logo asset; intrinsic 512×512 assumed for crisp downscaling on phones */
export function BrandLogo({alt = '', size = 'md', priority = false, className = '', style, ...rest}: Props) {
  return (
    <img
      src="/icons/logo.png"
      alt={alt}
      width={512}
      height={512}
      decoding={priority ? 'sync' : 'async'}
      fetchPriority={priority ? 'high' : 'auto'}
      loading={priority ? 'eager' : 'lazy'}
      draggable={false}
      className={`bg-transparent object-contain object-center select-none [image-rendering:auto] ${sizeStyles[size]} ${className}`}
      style={{ backgroundColor: 'transparent', ...style }}
      {...rest}
    />
  );
}
