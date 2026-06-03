/**
 * 部署向导 · 单步内容区布局（与 Operate Tab 说明 Alert / 表单宽度一致）。
 */
import React from 'react';
import HarvesterAddonTabFormShell, {
  type HarvesterAddonTabFormShellProps,
} from './HarvesterAddonTabFormShell';

export type HarvesterAddonWizardStepShellProps = Omit<
  HarvesterAddonTabFormShellProps,
  'contentMinHeight'
>;

const HarvesterAddonWizardStepShell: React.FC<HarvesterAddonWizardStepShellProps> = (props) => (
  <HarvesterAddonTabFormShell {...props} />
);

export default HarvesterAddonWizardStepShell;
