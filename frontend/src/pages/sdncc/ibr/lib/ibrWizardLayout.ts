import type { CSSProperties } from 'react';

/** IBR 向导外层布局：线性创建 vs 双列对比（可按步骤切换） */

export type IbrWizardLayoutMode = 'linear' | 'compare';

export const IBR_WIZARD_GUTTER = 16;

/** Ant Design 24 栅格；步骤列固定 4，切换模式时侧栏宽度稳定 */
export const IBR_WIZARD_SPANS = {
  linear: { steps: 4, main: 13, preview: 7 },
  compare: { steps: 4, mirror: 7, main: 7, preview: 6 },
} as const;

export const IBR_WIZARD_STICKY_CARD_STYLE: CSSProperties = {
  position: 'sticky',
  top: 16,
};
