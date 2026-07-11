import { useMemo } from 'react';
import type { CSSProperties } from 'react';

/**
 * 登录页背景图（/admin/login；/login 重定向至同页）。
 *
 * - 默认使用 `public/images/login-hero-light.png`（浅色极简风：左侧 3D 算力塔 + 多云连接，右侧大面积留白衬白卡）。
 * - 旧的深色太空插画仍保留为 `public/images/login-hero.png`，可经环境变量切回。
 * - 覆盖：构建/运行环境设置 `REACT_APP_LOGIN_HERO_IMAGE=/images/other.png` 或完整 URL。
 * - 关闭背景图（仅渐变色/背景色）：`REACT_APP_LOGIN_HERO_IMAGE=none`
 */
const DEFAULT_RELATIVE = 'images/login-hero-light.png';

const rawFromEnv = String(process.env.REACT_APP_LOGIN_HERO_IMAGE || '').trim();
const useNoHero = /^none$/i.test(rawFromEnv);
const heroRaw = useNoHero ? '' : rawFromEnv || DEFAULT_RELATIVE;

function resolvePublicUrl(relOrAbs: string): string {
  if (relOrAbs.startsWith('http')) return relOrAbs;
  if (relOrAbs.startsWith('/')) return `${(process.env.PUBLIC_URL || '').replace(/\/$/, '')}${relOrAbs}`;
  return `${(process.env.PUBLIC_URL || '').replace(/\/$/, '')}/${relOrAbs.replace(/^\//, '')}`;
}

export const LOGIN_PAGE_HERO_IMAGE = heroRaw ? resolvePublicUrl(heroRaw) : '';

/** 宽屏插画：主体（算力塔）偏左、右侧留白多；靠左定位保证窄屏裁切优先保留左侧主体，右侧留白衬白卡 */
const HERO_BG_POSITION = 'left center';

/** 浅色主题兜底背景（图片加载前或缺图时） */
const DEFAULT_FALLBACK_BG = '#eef2f8';

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
        backgroundColor: backgroundColor || DEFAULT_FALLBACK_BG,
      };
    }
    return {
      backgroundColor: backgroundColor || DEFAULT_FALLBACK_BG,
      backgroundImage: `url(${url})`,
      backgroundSize: 'cover',
      backgroundPosition: HERO_BG_POSITION,
      backgroundRepeat: 'no-repeat',
    };
  }, [useGradient, gradientStart, gradientEnd, backgroundColor]);
}
