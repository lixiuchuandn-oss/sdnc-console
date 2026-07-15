import React from 'react';
import IbrWizardPageHeader, { type IbrWizardPageHeaderProps } from './IbrWizardPageHeader';
import IbrWizardShell, { type IbrWizardShellProps } from './IbrWizardShell';

export type IbrWizardPageProps = Pick<
  IbrWizardPageHeaderProps,
  'title' | 'subtitle' | 'meta' | 'extra' | 'onBack' | 'showBreadcrumb'
> &
  Pick<IbrWizardShellProps, 'layout' | 'steps' | 'mirror' | 'main' | 'preview'> & {
    /** Modal 等挂在壳层之后 */
    children?: React.ReactNode;
    className?: string;
    style?: React.CSSProperties;
  };

/**
 * IBR 向导独立页面壳：顶栏 + linear/compare 栅格；Modal 等放 children。
 */
const IbrWizardPage: React.FC<IbrWizardPageProps> = ({
  title,
  subtitle,
  meta,
  extra,
  onBack,
  showBreadcrumb,
  layout,
  steps,
  mirror,
  main,
  preview,
  children,
  className,
  style,
}) => (
  <div className={['ibr-wizard-page', className].filter(Boolean).join(' ')} style={style}>
    <IbrWizardPageHeader
      title={title}
      subtitle={subtitle}
      meta={meta}
      extra={extra}
      onBack={onBack}
      showBreadcrumb={showBreadcrumb}
    />
    <div className="ibr-wizard-page-body">
      <IbrWizardShell layout={layout} steps={steps} mirror={mirror} main={main} preview={preview} />
    </div>
    {children}
  </div>
);

export default IbrWizardPage;
