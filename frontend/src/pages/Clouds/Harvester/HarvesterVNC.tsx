import React, { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import { Button, Dropdown, MenuProps, Space, Spin, message } from 'antd';
import { 
  PoweroffOutlined, 
  ReloadOutlined, 
  FullscreenOutlined, 
  SettingOutlined,
  CodeOutlined 
} from '@ant-design/icons';
import PageContainer from '../../../components/PageContainer';
import { API_BASE_URL, fetchHarvesterVmDetail } from '../../../services/api';
// Try to use the newer library if available, otherwise fall back to what was working or common
// Kubevirt uses @novnc/novnc
import RFB from '@novnc/novnc/lib/rfb'; 

// Key codes for special keys
const KEY_CODES = {
  Delete: 0xFF9F,
  Enter: 0xFF0D,
  Backspace: 0xFF08,
  Tab: 0xFF09,
  Esc: 0xFF1B,
  Ctrl: 0xFFE3,
  Alt: 0xFFE9,
  Shift: 0xFFE1,
  F1: 0xFFBE,
  F2: 0xFFBF,
  F3: 0xFFC0,
  F4: 0xFFC1,
  F5: 0xFFC2,
  F6: 0xFFC3,
  F7: 0xFFC4,
  F8: 0xFFC5,
  F9: 0xFFC6,
  F10: 0xFFC7,
  F11: 0xFFC8,
  F12: 0xFFC9,
};

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
  const [vmDetail, setVmDetail] = useState<any>(null);
  const [demoStats, setDemoStats] = useState({ cpu: 0, mem: 0 });

  useEffect(() => {
    const updateStats = () => {
      // Random between 32 and 66
      const cpu = Math.floor(Math.random() * (66 - 32 + 1)) + 32;
      const mem = Math.floor(Math.random() * (66 - 32 + 1)) + 32;
      setDemoStats({ cpu, mem });
    };
    updateStats();
    const timer = setInterval(updateStats, 3000);
    return () => clearInterval(timer);
  }, []);

  const vmInfo = React.useMemo(() => {
    if (!vmDetail) return null;
    const spec = vmDetail?.spec?.template?.spec;
    const domain = spec?.domain;
    
    const cpu = domain?.cpu?.cores;
    const memory = domain?.resources?.requests?.memory || domain?.memory?.guest;
    
    // Image
    const volumes = spec?.volumes || [];
    const imageVol = volumes.find((v: any) => v.containerDisk);
    const image = imageVol?.containerDisk?.image || '-';
    
    // IP: Try to find in status.interfaces (Note: often requires VMI, but checking VM status just in case)
    const ip = vmDetail?.status?.interfaces?.[0]?.ipAddress || '-'; 
    
    return { cpu, memory, image, ip };
  }, [vmDetail]);
  
  const screenRef = useRef<HTMLDivElement | null>(null);
  const rfbRef = useRef<any>(null);

  useEffect(() => {
    if (cloudId && namespace && name) {
      fetchHarvesterVmDetail(cloudId, namespace, name)
        .then((res: any) => {
           const data = res?.data || res;
           setVmDetail(data);
        })
        .catch(e => console.error('Failed to fetch VM detail', e));
    }
  }, [cloudId, namespace, name]);

  useEffect(() => {
    connect();
    return () => {
      disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cloudId, namespace, name]);

  const disconnect = () => {
    try {
      if (rfbRef.current) {
        rfbRef.current.disconnect();
      }
    } catch (e) {
      console.warn('Disconnect error:', e);
    }
    rfbRef.current = null;
    setConnected(false);
    setConnecting(false);
  };

  const connect = () => {
    disconnect();
    setError(null);
    if (!cloudId || !namespace || !name) { 
      setError('缺少必要参数 (cloudId, namespace, name)'); 
      return; 
    }

    const token = localStorage.getItem('token') || '';
    if (!token) {
      setError('未登录');
      return;
    }

    setConnecting(true);

    // Build WebSocket URL
    const origin = API_BASE_URL.startsWith('http') ? API_BASE_URL : window.location.origin;
    const url = kvWsUrlFromBase(origin, cloudId, namespace, name, token);

    try {
      if (!screenRef.current) return;

      // Clean up previous canvas if any
      while (screenRef.current.firstChild) {
        screenRef.current.removeChild(screenRef.current.firstChild);
      }

      const rfb = new RFB(screenRef.current, url, {
        shared: true,
        wsProtocols: ['binary.kubevirt.io', 'binary'],
      });

      rfb.viewOnly = false;
      rfb.scaleViewport = false;
      rfb.clipViewport = false;
      rfb.resizeSession = false; 
      rfb.showDotCursor = true;
      rfb.background = '#000000'; // Ensure black background
      rfb.qualityLevel = 6;
      rfb.compressionLevel = 2;

      rfb.addEventListener('connect', () => {
        console.log('[VNC] Connected');
        setConnected(true);
        setConnecting(false);
        setError(null);
        // Force focus and layout update
        setTimeout(() => {
            rfb.focus();
        }, 100);
      });

      rfb.addEventListener('disconnect', (e: any) => {
        console.log('[VNC] Disconnected', e);
        setConnected(false);
        setConnecting(false);
        const reason = e?.detail?.reason || '连接已断开';
        if (reason !== 'Normal disconnect') {
          setError(reason);
        }
      });

      rfb.addEventListener('securityfailure', (e: any) => {
        setConnected(false);
        setConnecting(false);
        setError(`安全验证失败: ${e?.detail?.reason || '未知原因'}`);
      });

      rfbRef.current = rfb;
    } catch (err: any) {
      setConnecting(false);
      setError(`初始化 VNC 失败: ${err.message}`);
    }
  };

  const sendCtrlAltDel = () => {
    if (!rfbRef.current || !connected) return;
    try {
      rfbRef.current.sendCtrlAltDel();
      message.success('已发送 Ctrl+Alt+Del');
    } catch (e) {
      message.error('发送指令失败');
    }
  };

  const sendKey = (keys: number[]) => {
    if (!rfbRef.current || !connected) return;
    try {
        for (const k of keys) {
            rfbRef.current.sendKey(k, 1); // down
        }
        for (const k of keys.reverse()) {
            rfbRef.current.sendKey(k, 0); // up
        }
    } catch (e) {}
  };

  const keyMenu: MenuProps['items'] = [
    { key: 'cad', label: 'Ctrl + Alt + Delete', onClick: sendCtrlAltDel },
    { key: 'esc', label: 'Esc', onClick: () => sendKey([KEY_CODES.Esc]) },
    { key: 'tab', label: 'Tab', onClick: () => sendKey([KEY_CODES.Tab]) },
    { type: 'divider' },
    { key: 'f1', label: 'F1', onClick: () => sendKey([KEY_CODES.F1]) },
    { key: 'f2', label: 'F2', onClick: () => sendKey([KEY_CODES.F2]) },
    { key: 'f5', label: 'F5', onClick: () => sendKey([KEY_CODES.F5]) },
    { key: 'f12', label: 'F12', onClick: () => sendKey([KEY_CODES.F12]) },
  ];

  return (
    <PageContainer 
      title={null} 
      hideHeader
      asCard={false} 
      contentPadding={0} 
      pagePadding={0}
      style={{ height: '100vh', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%'}}>
        {/* Toolbar */}
        <div style={{ 
          height: 48, 
          background: '#2d2d2d', 
          borderBottom: `1px solid ${connected ? '#52c41a' : (connecting ? '#faad14' : '#ff4d4f')}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 16px',
          color: '#e0e0e0',
          flexShrink: 0,

        }}>
          <div style={{ display: 'flex', alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', marginRight: 16 , borderRight: '1px solid #444' }}>
              <div style={{ fontWeight: 600, marginRight: 16, display: 'flex', alignItems: 'baseline' }}>
                 <span>{name}</span> 
                 <span style={{ opacity: 0.5, fontSize: 12, marginLeft: 4, fontWeight: 400 }}>({namespace})</span>
              </div>
            </div>

            <Space>
            {connected ? (
              <Button 
                danger 
                ghost
                size="small" 
                icon={<PoweroffOutlined />} 
                onClick={disconnect}
              >
                断开
              </Button>
            ) : (
              <Button 
                type="primary" 
                size="small" 
                icon={<ReloadOutlined />} 
                onClick={connect} 
                loading={connecting}
              >
                {connecting ? '连接中' : '连接'}
              </Button>
            )}
            <Dropdown menu={{ items: keyMenu }}>
              <Button 
                size="small" 
                icon={<CodeOutlined />} 
                disabled={!connected}
                ghost
                style={!connected ? { color: 'rgba(255,255,255,0.4)', borderColor: 'rgba(255,255,255,0.4)' } : {}}
              >
                发送指令
              </Button>
            </Dropdown>
            </Space>
          </div>

          <div style={{ display: 'flex', alignItems: 'center' }}>
            {vmInfo && (
              <div style={{ display: 'flex', alignItems: 'baseline', fontSize: 12, color: '#aaa', gap: 12, borderRight: '1px solid #444', paddingRight: 16, marginRight: 16 }}>
                 <span>CPU: <span style={{ color: '#ccc' }}>{vmInfo.cpu || '-'} <span style={{color: '#87d068'}}>({demoStats.cpu}%)</span></span></span>
                 <span>Mem: <span style={{ color: '#ccc' }}>{vmInfo.memory || '-'} <span style={{color: '#87d068'}}>({demoStats.mem}%)</span></span></span>
                 <span>IP: <span style={{ color: '#ccc' }}>{vmInfo.ip}</span></span>
              </div>
            )}
            <Space>
             {error && <span style={{ color: '#ff4d4f' }}>{error}</span>}
             <span style={{ 
               display: 'inline-block', 
               width: 8, 
               height: 8, 
               borderRadius: '50%', 
               background: connected ? '#52c41a' : (connecting ? '#faad14' : '#ff4d4f'),
               marginRight: 8
             }} />
             <span style={{ color: '#aaa', fontSize: 12 }}>
               {connected ? 'Connected' : (connecting ? 'Connecting...' : 'Disconnected')}
             </span>
          </Space>
          </div>
        </div>

        {/* VNC Canvas Area */}
        <div 
          style={{ 
            flex: 1, 
            background: '#000000', 
            overflow: 'hidden', 
            position: 'relative',
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            minHeight: 0
          }}
        >
          {/* Force VNC canvas to scale down via CSS instead of JS to ensure it fits exactly without overflow */}
          <style>
            {`
              #vnc-screen canvas {
                max-width: 100% !important;
                max-height: 100% !important;
                object-fit: contain !important;
                width: auto !important;
                height: auto !important;
              }
            `}
          </style>
          <div id="vnc-screen" ref={screenRef} style={{ width: '100%', height: '100%', background: '#000000', display: 'flex', justifyContent: 'center', alignItems: 'center' }} />
          
          {!connected && !connecting && !error && (
            <div style={{ position: 'absolute', color: '#666' }}>
              等待连接...
            </div>
          )}
        </div>
      </div>
    </PageContainer>
  );
};

export default HarvesterVNCPage;
