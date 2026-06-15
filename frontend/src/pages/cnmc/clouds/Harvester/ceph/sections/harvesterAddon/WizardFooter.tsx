import React from 'react';
import { Space } from 'antd';
import { ADDON_WIZARD_FOOTER_CLASS } from './addonUiConstants';

export type WizardFooterProps = {
  left?: React.ReactNode;
  children: React.ReactNode;
};

const WizardFooter: React.FC<WizardFooterProps> = ({ left, children }) => (
  <div className={ADDON_WIZARD_FOOTER_CLASS}>
    <Space wrap>{left}</Space>
    <Space wrap>{children}</Space>
  </div>
);

export default WizardFooter;
