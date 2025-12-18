import React, { useEffect, useRef, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Space, Button } from 'antd';
import PageContainer from '../../components/PageContainer';
import RFB from 'novnc-core';
import { API_BASE_URL } from '../../services/api';

const WebVNCPage: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  const wsUrl = (params.get('url') || '').trim();
  const screenRef = useRef<HTMLDivElement | null>(null);
  const rfbRef = useRef<any>(null);
  const [connecting, setConnecting] = useState(false);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      try { rfbRef.current?.disconnect(); } catch {}
      rfbRef.current = null;
      setConnected(false);
      setConnecting(false);
      setError(null);
    };
  }, []);

  const handleConnect = async () => {
    setError(null);
    const url = wsUrl;
    if (!url) { setError('缺少 VNC 地址参数 ?url='); return; }
    if (!screenRef.current) { setError('界面未就绪'); return; }
    setConnecting(true);
    try {
      const rfb = new RFB(screenRef.current, url, { shared: true });
      rfbRef.current = rfb;
      try {
        rfb.viewOnly = false;
        rfb.scaleViewport = true;
        if ('resizeSession' in rfb) (rfb as any).resizeSession = true;
      } catch {}
      rfb.addEventListener('connect', () => {
        setConnected(true);
        setConnecting(false);
      });
      rfb.addEventListener('disconnect', (e: any) => {
        setConnected(false);
        setConnecting(false);
        const msg = e?.detail?.reason || 'VNC 连接已断开';
        setError(msg);
        try { rfbRef.current?.disconnect(); } catch {}
      });
    } catch (e: any) {
      setConnecting(false);
      setConnected(false);
      setError(e?.message || '无法建立 VNC 连接');
    }
  };

  useEffect(() => {
    handleConnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wsUrl]);

  const handleClose = () => {
    try { rfbRef.current?.disconnect(); } catch {}
    rfbRef.current = null;
    setConnected(false);
  };

  return (
    <PageContainer title={''} asCard={false} contentPadding={0} pagePadding={0}>
      <div style={{ background: '#1e1e1e', height: 'calc(100vh - 64px)', borderRadius: 0 }}>
        <div style={{ height: 40, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 16px', background: '#252526' }}>
          <Space>
            <Button size="small" onClick={() => navigate(-1)} style={{ background: '#3c3c3c', color: '#fff' }}>返回</Button>
            <Button size="small" onClick={handleConnect} disabled={connecting} type="primary">重新连接</Button>
            <Button size="small" onClick={handleClose}>断开</Button>
          </Space>
          <span style={{ color: '#d4d4d4' }}>{connected ? '已连接' : (connecting ? '连接中' : (error || '未连接'))}</span>
        </div>
        <div style={{ height: 'calc(100vh - 64px - 40px - 28px)', minHeight: 520, display: 'flex', flexDirection: 'column', background: '#1e1e1e', overflow: 'hidden' }}>
          <div style={{ flex: 1, overflow: 'auto' }} ref={screenRef} />
        </div>
        <div style={{ height: 28, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 16px', background: '#007acc', color: '#fff' }}>
          <span>WebVNC</span>
          <span>{connected ? '已连接' : '未连接'}</span>
        </div>
      </div>
    </PageContainer>
  );
};

export default WebVNCPage;
