import type {ImgHTMLAttributes} from 'react';

const sizeStyles = {
  sm: 'h-11 w-11 min-h-[2.75rem] min-w-[2.75rem]',
  md: 'h-14 w-14 min-h-[3.5rem] min-w-[3.5rem]',
  lg: 'h-16 w-16 min-h-16 min-w-16',
  xl: 'h-24 w-24 min-h-24 min-w-24',
} as const;

export type BrandLogoSize = keyof typeof sizeStyles;

type Props = Omit<ImgHTMLAttributes<HTMLImageElement>, 'src' | 'decoding'> & {
  alt: string;
  size?: BrandLogoSize;
  /** First paint / LCP — use on splash and primary headers */
  priority?: boolean;
};

/** Square logo asset; intrinsic 512×512 assumed for crisp downscaling on phones */
export function BrandLogo({alt, size = 'md', priority = false, className = '', ...rest}: Props) {
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
      className={`object-contain object-center select-none [image-rendering:auto] ${sizeStyles[size]} ${className}`}
      {...rest}
    />
  );
}
