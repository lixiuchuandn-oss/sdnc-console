import React, { useEffect, useState, useRef } from 'react';
import { Spin, Result } from 'antd';
import PageContainer from '../../../components/PageContainer';
import { getSystemSetting } from '../../../services/systemApi';

type Props = {
  path: string; // The sub-path on the external server
};

const AiSocFrame: React.FC<Props> = ({ path }) => {
  const [baseUrl, setBaseUrl] = useState<string>('');
  const [loading, setLoading] = useState(true);
  // Default to fixed 1500px height as requested to prevent internal scrolling
  const [iframeHeight, setIframeHeight] = useState<string | number>(1500); 
  const iframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    (async () => {
      try {
        const [frontRes, baseRes] = await Promise.all([
          getSystemSetting('ai_soc_frontend_url'),
          getSystemSetting('ai_soc_base_url')
        ]);
        setBaseUrl(frontRes?.value || baseRes?.value || 'http://192.168.2.22:3000');
      } catch (e) {
        setBaseUrl('http://192.168.2.22:3000');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // Dynamic height adjustment disabled to enforce fixed 1500px height
  /*
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.data && event.data.type === 'resize' && event.data.height) {
        setIframeHeight(event.data.height + 70);
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);
  */

  const handleIframeLoad = () => {
    /*
    try {
      if (iframeRef.current && iframeRef.current.contentWindow) {
        const doc = iframeRef.current.contentWindow.document;
        doc.body.style.overflowX = 'hidden';
        const height = doc.body.scrollHeight;
        if (height && height > 0) {
           setIframeHeight(height + 70);
        }
      }
    } catch (e) {
      console.debug('Cannot auto-resize iframe due to cross-origin policy');
    }
    */
  };

  if (loading) return <Spin size="large" style={{ display: 'block', margin: '100px auto' }} />;

  if (!baseUrl) {
     return (
       <PageContainer>
         <Result status="warning" title="未配置 AI SOC 地址" subTitle="请在系统设置中配置 AI SOC 服务器地址。" />
       </PageContainer>
     );
  }

  const cleanBase = baseUrl.replace(/\/$/, '');
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  const embedUiQuery = 'showTitle=false&showHeader=false&showSidebar=false&showPadding=false';
  const fullUrl = cleanPath.includes('?')
    ? `${cleanBase}${cleanPath}&${embedUiQuery}`
    : `${cleanBase}${cleanPath}?${embedUiQuery}`;

  return (
    <PageContainer asCard={false} contentPadding={0} hideDivider>
      <iframe
        ref={iframeRef}
        src={fullUrl}
        onLoad={handleIframeLoad}
        scrolling="no"
        style={{ width: '100%', height: iframeHeight, border: 'none', display: 'block' }}
        title="AI SOC"
      />
    </PageContainer>
  );
};

export default AiSocFrame;
