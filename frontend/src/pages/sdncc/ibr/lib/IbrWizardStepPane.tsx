import React from 'react';
import { Divider, Space } from 'antd';
import IbrWizardCard, { type IbrWizardCardProps } from './IbrWizardCard';

export type IbrWizardStepPaneProps = Omit<IbrWizardCardProps, 'children'> & {
  children?: React.ReactNode;
  footerLeft?: React.ReactNode;
  footerRight?: React.ReactNode;
};

/**
 * 向导主栏/编辑栏：统一 Card + 可选底栏（上一步/下一步）。
 */
const IbrWizardStepPane: React.FC<IbrWizardStepPaneProps> = ({
  children,
  footerLeft,
  footerRight,
  ...cardProps
}) => {
  const hasFooter = !!(footerLeft || footerRight);

  return (
    <IbrWizardCard {...cardProps}>
      {children}
      {hasFooter ? (
        <>
          <Divider style={{ margin: '12px 0' }} />
          <div className="ibr-wizard-step-footer">
            <Space wrap>{footerLeft}</Space>
            <Space wrap>{footerRight}</Space>
          </div>
        </>
      ) : null}
    </IbrWizardCard>
  );
};

export default IbrWizardStepPane;
