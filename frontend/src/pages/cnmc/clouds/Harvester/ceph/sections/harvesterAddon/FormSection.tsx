import React from 'react';
import { Typography } from 'antd';

type FormSectionProps = {
  title: string;
  description?: string;
  extra?: React.ReactNode;
  children: React.ReactNode;
};

/** 表单分区标题，替代嵌套小 Card，与平台详情页风格一致 */
const FormSection: React.FC<FormSectionProps> = ({ title, description, extra, children }) => (
  <section style={{ marginBottom: 28 }}>
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        gap: 12,
        marginBottom: description ? 8 : 16,
        paddingBottom: 8,
        borderBottom: '1px solid rgba(0,0,0,.06)',
      }}
    >
      <Typography.Title level={5} style={{ margin: 0, fontWeight: 600 }}>
        {title}
      </Typography.Title>
      {extra}
    </div>
    {description ? (
      <Typography.Paragraph type="secondary" style={{ marginBottom: 16, maxWidth: 720 }}>
        {description}
      </Typography.Paragraph>
    ) : null}
    {children}
  </section>
);

export default FormSection;
