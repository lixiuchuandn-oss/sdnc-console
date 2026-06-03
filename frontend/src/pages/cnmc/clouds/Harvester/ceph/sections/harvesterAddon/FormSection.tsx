import React from 'react';
import { Typography } from 'antd';
import { ADDON_FORM_SECTION_CLASS } from './addonUiConstants';

type FormSectionProps = {
  title: string;
  description?: string;
  extra?: React.ReactNode;
  children: React.ReactNode;
};

/** 表单分区标题，替代嵌套小 Card，与平台详情页风格一致 */
const FormSection: React.FC<FormSectionProps> = ({ title, description, extra, children }) => (
  <section className={ADDON_FORM_SECTION_CLASS}>
    <div className="harvester-addon-form-section-header">
      <Typography.Title level={5} className="harvester-addon-form-section-title">
        {title}
      </Typography.Title>
      {extra}
    </div>
    {description ? (
      <Typography.Paragraph type="secondary" className="harvester-addon-form-section-desc">
        {description}
      </Typography.Paragraph>
    ) : null}
    {children}
  </section>
);

export default FormSection;
