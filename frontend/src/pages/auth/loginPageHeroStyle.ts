import { useMemo } from 'react';
import type { CSSProperties } from 'react';

/**
 * 登录页背景图（/login 与 /admin/login 共用）。
 *
 * - 默认使用 `public/images/login-hero.png`（随仓库提供）。
 * - 覆盖：构建/运行环境设置 `REACT_APP_LOGIN_HERO_IMAGE=/images/other.png` 或完整 URL。
 * - 关闭背景图（仅渐变色/背景色）：`REACT_APP_LOGIN_HERO_IMAGE=none`
 */
const DEFAULT_RELATIVE = 'images/login-hero.png';

const rawFromEnv = String(process.env.REACT_APP_LOGIN_HERO_IMAGE || '').trim();
const useNoHero = /^none$/i.test(rawFromEnv);
const heroRaw = useNoHero ? '' : rawFromEnv || DEFAULT_RELATIVE;

function resolvePublicUrl(relOrAbs: string): string {
  if (relOrAbs.startsWith('http')) return relOrAbs;
  if (relOrAbs.startsWith('/')) return `${(process.env.PUBLIC_URL || '').replace(/\/$/, '')}${relOrAbs}`;
  return `${(process.env.PUBLIC_URL || '').replace(/\/$/, '')}/${relOrAbs.replace(/^\//, '')}`;
}

export const LOGIN_PAGE_HERO_IMAGE = heroRaw ? resolvePublicUrl(heroRaw) : '';

/** 宽屏插画：主体偏左、右侧留白多，取右侧区域落在视口后更易衬在居中表单后 */
const HERO_BG_POSITION = 'right center';

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
        backgroundPosition: `${HERO_BG_POSITION}, center`,
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
      backgroundPosition: HERO_BG_POSITION,
      backgroundRepeat: 'no-repeat',
    };
  }, [useGradient, gradientStart, gradientEnd, backgroundColor]);
}
