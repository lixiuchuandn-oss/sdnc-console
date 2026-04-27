import { useMemo } from 'react';
import type { CSSProperties } from 'react';

/**
 * 全屏背景图：public/images/11111.png（/login 与 /admin/login 共用）
 * 源文件可替换为同路径同名，或改此处文件名。
 */
export const LOGIN_PAGE_HERO_IMAGE = `${(process.env.PUBLIC_URL || '').replace(/\/$/, '')}/images/11111.png`;

export function useLoginPageHeroStyle(params: {
  backgroundColor?: string;
  gradientStart?: string;
  gradientEnd?: string;
}): CSSProperties {
  const { backgroundColor, gradientStart: g0, gradientEnd: g1 } = params;
  const gradientStart = g0 || backgroundColor;
  const gradientEnd = g1 || backgroundColor;
  const useGradient = Boolean(gradientStart && gradientEnd && gradientStart !== gradientEnd);

  return useMemo(() => {
    if (useGradient) {
      return {
        backgroundImage: `url(${LOGIN_PAGE_HERO_IMAGE}), linear-gradient(135deg, ${gradientStart} 0%, ${gradientEnd} 100%)`,
        backgroundSize: 'cover, cover',
        backgroundPosition: 'left center, center',
        backgroundRepeat: 'no-repeat, no-repeat',
      };
    }
    return {
      backgroundColor: backgroundColor || '#e6edf5',
      backgroundImage: `url(${LOGIN_PAGE_HERO_IMAGE})`,
      backgroundSize: 'cover',
      backgroundPosition: 'left center',
      backgroundRepeat: 'no-repeat',
    };
  }, [useGradient, gradientStart, gradientEnd, backgroundColor]);
}
