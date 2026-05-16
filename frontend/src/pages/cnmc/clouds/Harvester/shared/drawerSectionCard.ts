/**
 * Harvester 云详情内抽屉表单分区 Card：无边框、浅灰底（多域可共用）。
 */
import type { CardProps } from 'antd';

export function getHarvesterDrawerSectionCardProps(): Pick<CardProps, 'bordered' | 'style'> {
  return {
    bordered: false,
    style: { background: '#f5f5f5' },
  };
}
