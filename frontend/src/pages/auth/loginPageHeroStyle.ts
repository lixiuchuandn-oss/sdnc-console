import { useMemo } from 'react';
import type { CSSProperties } from 'react';

/**
 * 登录页可选背景图。留空则仅使用系统设置中的渐变色/背景色（避免内置素材水印等问题）。
 * 需要背景图时设置：`REACT_APP_LOGIN_HERO_IMAGE=/images/your.png`（相对于 public）。
 */
const heroFromEnv = String(process.env.REACT_APP_LOGIN_HERO_IMAGE || '').trim();
export const LOGIN_PAGE_HERO_IMAGE = heroFromEnv
  ? heroFromEnv.startsWith('http') || heroFromEnv.startsWith('/')
    ? heroFromEnv
    : `${(process.env.PUBLIC_URL || '').replace(/\/$/, '')}/${heroFromEnv.replace(/^\//, '')}`
  : '';

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
    const url = LOGIN_PAGE_HERO_IMAGE;
    if (useGradient) {
      if (!url) {
        return {
          background: `linear-gradient(135deg, ${gradientStart} 0%, ${gradientEnd} 100%)`,
        };
      }
      return {
        backgroundImage: `url(${url}), linear-gradient(135deg, ${gradientStart} 0%, ${gradientEnd} 100%)`,
        backgroundSize: 'cover, cover',
        backgroundPosition: 'left center, center',
        backgroundRepeat: 'no-repeat, no-repeat',
      };
    }
    if (!url) {
      return {
        backgroundColor: backgroundColor || '#e6edf5',
      };
    }
    return {
      backgroundColor: backgroundColor || '#e6edf5',
      backgroundImage: `url(${url})`,
      backgroundSize: 'cover',
      backgroundPosition: 'left center',
      backgroundRepeat: 'no-repeat',
    };
  }, [useGradient, gradientStart, gradientEnd, backgroundColor]);
}
