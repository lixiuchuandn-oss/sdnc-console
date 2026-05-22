/**
 * Xinference 资源池 · 注册模型（自定义模型注册，独立于模型广场）
 */
import React, { useState } from 'react';
import { Alert, Tabs, Typography } from 'antd';
import { FormOutlined } from '@ant-design/icons';
import PageDetailSection from '../../../../../components/PageDetailSection';
import RegisterModelForm from '../components/RegisterModelForm';
import {
  XINFERENCE_GALLERY_MODEL_TYPES,
  modelTypeLabel,
  type XinferenceGalleryModelType,
} from '../lib/xinferenceModelRegistry';

type Props = {
  poolId: string;
};

const RegisterModelSection: React.FC<Props> = ({ poolId }) => {
  const [modelType, setModelType] = useState<XinferenceGalleryModelType>('LLM');

  if (!poolId) {
    return <Alert type="warning" message="缺少资源池参数" showIcon />;
  }

  return (
    <PageDetailSection
      title="注册模型"
      icon={<FormOutlined style={{ color: '#1677ff', fontSize: 20 }} />}
      asCard={false}
    >
      <Tabs
        activeKey={modelType}
        onChange={(k) => setModelType(k as XinferenceGalleryModelType)}
        items={XINFERENCE_GALLERY_MODEL_TYPES.map((t) => ({ key: t.key, label: t.label }))}
        tabBarExtraContent={
          <Typography.Text type="secondary">注册 {modelTypeLabel(modelType)} 到资源池</Typography.Text>
        }
      />
      <div style={{ marginTop: 12 }}>
        <RegisterModelForm poolId={poolId} modelType={modelType} />
      </div>
    </PageDetailSection>
  );
};

export default RegisterModelSection;
