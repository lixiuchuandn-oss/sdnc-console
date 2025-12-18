import React, { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import { Space, Button } from 'antd';
import PageContainer from '../../../components/PageContainer';
import { API_BASE_URL } from '../../../services/api';
import RFB from 'novnc-core';

function kvWsUrlFromBase(baseHttp: string, cloudId: string, namespace: string, name: string, token: string): string {
  const base = baseHttp.replace(/^http/, 'ws');
  const sep = base.endsWith('/') ? '' : '/';
  const q = `token=${encodeURIComponent(token)}&cloudId=${encodeURIComponent(cloudId)}&namespace=${encodeURIComponent(namespace)}&name=${encodeURIComponent(name)}`;
  return `${base}${sep}ws/kv-vnc?${q}`;
}

const HarvesterVNCPage: React.FC = () => {
  const navigate = useNavigate();
  const { id } = useParams();
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  const cloudId = params.get('cloudId') || id || '';
  const namespace = params.get('namespace') || '';
  const name = params.get('name') || '';
  const [connecting, setConnecting] = useState(false);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const screenRef = useRef<HTMLDivElement | null>(null);
  const rfbRef = useRef<any>(null);

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
    if (!cloudId || !namespace || !name) { setError('缺少参数'); return; }
    const override = (process.env.REACT_APP_WS_URL || '').trim();
    const origin = typeof window !== 'undefined' ? window.location.origin : API_BASE_URL;
    const token = localStorage.getItem('token') || '';
    const bases: string[] = [];
    bases.push(override || origin);
    const hostOnly = typeof window !== 'undefined' ? window.location.hostname : 'localhost';
    const scheme = typeof window !== 'undefined' ? window.location.protocol.replace('http', 'ws') : 'ws:';
    bases.push(`${scheme}//${hostOnly}:4002`);
    bases.push(`${scheme}//${hostOnly}:5001`);
    if (!bases.includes(API_BASE_URL)) bases.push(API_BASE_URL);
    let idx = 0;
    const startWithBase = (base: string) => {
      if (!screenRef.current) { setError('界面未就绪'); return; }
      setConnecting(true);
      try {
        const url = kvWsUrlFromBase(base, cloudId, namespace, name, token);
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
          idx += 1;
          if (idx < bases.length) {
            startWithBase(bases[idx]);
            return;
          }
        });
      } catch (e: any) {
        setConnecting(false);
        setConnected(false);
        idx += 1;
        if (idx < bases.length) {
          startWithBase(bases[idx]);
          return;
        }
        setError(e?.message || '无法建立 VNC 连接');
      }
    };
    startWithBase(bases[idx]);
  };

  useEffect(() => {
    handleConnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cloudId, namespace, name]);

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
          <span>Harvester VNC</span>
          <span>{connected ? '已连接' : '未连接'}</span>
        </div>
      </div>
    </PageContainer>
  );
};

export default HarvesterVNCPage;
