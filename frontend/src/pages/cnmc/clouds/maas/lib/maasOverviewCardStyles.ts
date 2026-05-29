/** 与 CNMC 概览 / Cloudmap 集群总览 Monitoring 卡片对齐 */
export const MAAS_OVERVIEW_CARD_SHADOW = '0 4px 12px rgba(0, 0, 0, 0.08)';

export const MAAS_OVERVIEW_CARD_HEADER_STYLES = {
  padding: '10px 16px 0',
  height: 48,
  minHeight: 48,
  borderBottom: 'none',
} as const;

export const MAAS_OVERVIEW_CARD_BODY_STYLES = {
  flex: 1,
  minHeight: 0,
  display: 'flex',
  flexDirection: 'column' as const,
  justifyContent: 'center' as const,
  padding: '8px 16px 16px',
};

export const MAAS_OVERVIEW_TITLE_ICON_STYLE = {
  fontSize: 20,
  display: 'inline-flex' as const,
  lineHeight: 1,
};
