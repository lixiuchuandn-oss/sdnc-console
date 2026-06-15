import React from 'react';
import { ADDON_WIZARD_STACK_CLASS } from './addonUiConstants';

export type HarvesterAddonWizardFormStackProps = {
  children: React.ReactNode;
};

/** 向导步骤内表单区块纵向栈（统一 24px 间距，替代各区块 marginBottom 叠加） */
const HarvesterAddonWizardFormStack: React.FC<HarvesterAddonWizardFormStackProps> = ({ children }) => (
  <div className={ADDON_WIZARD_STACK_CLASS}>{children}</div>
);

export default HarvesterAddonWizardFormStack;
