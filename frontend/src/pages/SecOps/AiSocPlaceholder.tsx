import React from 'react';
import { Result, Button, Spin } from 'antd';
import PageContainer from '../../components/PageContainer';
import { RocketOutlined } from '@ant-design/icons';

type Props = {
  title: string;
  module: string;
};

const AiSocPlaceholder: React.FC<Props> = ({ title, module }) => {
  // TODO: Fetch configured URL from backend using 'module' key
  // For now, show a placeholder
  const iframeUrl = ''; 

  return (
    <PageContainer
      title={title}
      subtitle={`AI SOC中心 - ${title} (外部集成)`}
    >
      {iframeUrl ? (
        <iframe 
          src={iframeUrl} 
          style={{ width: '100%', height: '80vh', border: 'none' }} 
          title={title}
        />
      ) : (
        <Result
          icon={<RocketOutlined />}
          title={`${title} 功能即将上线`}
          subTitle="该功能模块将由 AI SOC 平台提供，请在后台配置集成地址。"
          extra={
            <Button type="primary" disabled>
              配置集成地址
            </Button>
          }
        />
      )}
    </PageContainer>
  );
};

export default AiSocPlaceholder;
