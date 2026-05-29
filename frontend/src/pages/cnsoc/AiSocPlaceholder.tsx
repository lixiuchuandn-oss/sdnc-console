import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Result, Button } from 'antd';
import PageContainer from '../../components/PageContainer';
import { RocketOutlined } from '@ant-design/icons';
import tsgzBg from '../../assets/tsgz.png';

type Props = {
  title: string;
  module: string;
};

const AiSocPlaceholder: React.FC<Props> = ({ title }) => {
  const navigate = useNavigate();
  // TODO: Fetch configured URL from backend using 'module' key
  // For now, show a placeholder
  const iframeUrl = '';

  return (
    <PageContainer asCard={false} contentPadding={0} hideDivider>
      {iframeUrl ? (
        <iframe
          src={iframeUrl}
          style={{ width: '100%', height: '80vh', border: 'none' }}
          title={title}
        />
      ) : (
        <div
          style={{
            position: 'relative',
            width: '100%',
            height: 600,
            backgroundColor: '#000',
            backgroundImage: `url(${tsgzBg})`,
            backgroundSize: 'contain',
            backgroundRepeat: 'no-repeat',
            backgroundPosition: 'center',
            borderRadius: 8,
            overflow: 'hidden',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {/* Dark Overlay */}
          <div
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              height: '100%',
              backgroundColor: 'rgba(0, 0, 0, 0.6)',
              zIndex: 1,
            }}
          />

          {/* Content */}
          <div style={{ position: 'relative', zIndex: 2 }}>
            <Result
              icon={<RocketOutlined style={{ color: '#1890ff' }} />}
              title={<span style={{ color: '#fff' }}>{`${title} 功能即将上线`}</span>}
              subTitle={
                <span style={{ color: 'rgba(255, 255, 255, 0.8)' }}>
                  该功能模块将由 AI SOC 平台提供，请在后台配置集成地址。
                </span>
              }
              extra={
                <Button type="primary" onClick={() => navigate('/admin/aisoc/report')}>
                  前往安全报告页面
                </Button>
              }
            />
          </div>
        </div>
      )}
    </PageContainer>
  );
};

export default AiSocPlaceholder;
