import React from 'react';
import { Card } from 'antd';
import type { CardProps } from 'antd';
import { IBR_WIZARD_STICKY_CARD_STYLE } from './ibrWizardLayout';

export type IbrWizardCardProps = Omit<CardProps, 'size' | 'variant'> & {
  /** sticky 顶栏（步骤 / 预览） */
  sticky?: boolean;
};

/**
 * IBR 向导外栏统一 Card：small + outlined + 统一标题样式（.ibr-wizard-card）。
 */
const IbrWizardCard: React.FC<IbrWizardCardProps> = ({ sticky, className, style, ...rest }) => (
  <Card
    size="small"
    variant="outlined"
    className={['ibr-wizard-card', className].filter(Boolean).join(' ')}
    style={sticky ? { ...IBR_WIZARD_STICKY_CARD_STYLE, ...style } : style}
    {...rest}
  />
);

export default IbrWizardCard;

/** 「第 N 步：标题」；compare 可加「设备回读 / 配置编辑」后缀 */
export function ibrWizardStepCardTitle(stepIndex: number, stepTitle: string, suffix?: string): string {
  const base = `第 ${stepIndex + 1} 步：${stepTitle}`;
  return suffix ? `${base} ${suffix}` : base;
}
