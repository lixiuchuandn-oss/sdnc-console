import React, { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import { Row, Col, Form, Input, Button, Space, Alert, Card, Tag, InputNumber } from 'antd';
import { FullscreenOutlined, FullscreenExitOutlined, MenuFoldOutlined, MenuUnfoldOutlined } from '@ant-design/icons';
import PageContainer from '../../components/PageContainer';
import { API_BASE_URL } from '../../services/api';
import RFB from 'novnc-core';

function wsUrlFromBase(baseHttp: string, host: string, port: number, token: string): string {
  const base = baseHttp.replace(/^http/, 'ws');
  const sep = base.endsWith('/') ? '' : '/';
  const q = `token=${encodeURIComponent(token)}&host=${encodeURIComponent(host)}&port=${encodeURIComponent(String(port || 5900))}`;
  return `${base}${sep}ws/vnc?${q}`;
}

function kvWsUrlFromBase(baseHttp: string, cloudId: string, namespace: string, name: string, token: string): string {
  const base = baseHttp.replace(/^http/, 'ws');
  const sep = base.endsWith('/') ? '' : '/';
  const q = `token=${encodeURIComponent(token)}&cloudId=${encodeURIComponent(cloudId)}&namespace=${encodeURIComponent(namespace)}&name=${encodeURIComponent(name)}`;
  return `${base}${sep}ws/kv-vnc?${q}`;
}

const WebVNCPage: React.FC = () => {
  const navigate = useNavigate();
  const { id } = useParams();
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  const [aliyunVncUrl, setAliyunVncUrl] = useState<string>('');
  const [form] = Form.useForm();
  const [connecting, setConnecting] = useState(false);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [siderCollapsed, setSiderCollapsed] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const screenRef = useRef<HTMLDivElement | null>(null);
  const rfbRef = useRef<any>(null);

  useEffect(() => {
    const host = params.get('host') || '';
    const port = Number(params.get('port') || '5900');
    form.setFieldsValue({ host, port, password: '' });
    const raw = params.get('aliyunVncUrl') || '';
    setAliyunVncUrl(raw);
  }, [location.search]);

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
    const kvCloudId = params.get('kvCloudId') || '';
    const kvNs = params.get('namespace') || '';
    const kvName = params.get('name') || '';
    const values = kvCloudId ? { host: '', port: 5900, password: '' } : await form.validateFields();
    const host = String(values.host || '');
    const port = Number(values.port) || 5900;
    const password = String(values.password || '');
    const override = (process.env.REACT_APP_WS_URL || '').trim();
    const origin = typeof window !== 'undefined' ? window.location.origin : API_BASE_URL;
    const token = localStorage.getItem('token') || '';
    const bases: string[] = [];
    bases.push(override || origin);
    const hostOnly = typeof window !== 'undefined' ? window.location.hostname : 'localhost';
    const scheme = typeof window !== 'undefined' ? window.location.protocol.replace('http', 'ws') : 'ws:';
    bases.push(`${scheme}//${hostOnly}:4002`);
    bases.push(`${scheme}//${hostOnly}:3001`);
    if (!bases.includes(API_BASE_URL)) bases.push(API_BASE_URL);

    let idx = 0;
    const startWithBase = (base: string) => {
      if (!screenRef.current) {
        setError('界面未就绪');
        return;
      }
      setConnecting(true);
      try {
        const url = (() => {
          if (kvCloudId && kvNs && kvName) return kvWsUrlFromBase(base, kvCloudId, kvNs, kvName, token);
          return aliyunVncUrl && aliyunVncUrl.trim() ? aliyunVncUrl : wsUrlFromBase(base, host, port, token);
        })();
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
          if (kvCloudId) {
            try { rfbRef.current?.disconnect(); } catch {}
            idx += 1;
            if (idx < bases.length) {
              startWithBase(bases[idx]);
              return;
            }
          }
        });
        if (!kvCloudId) {
          rfb.addEventListener('credentialsrequired', () => {
            try { rfb.sendCredentials({ username: '', password }); } catch {}
          });
        }
      } catch (e: any) {
        setConnecting(false);
        setConnected(false);
        if (!aliyunVncUrl || !aliyunVncUrl.trim()) {
          idx += 1;
          if (idx < bases.length) {
            startWithBase(bases[idx]);
            return;
          }
        }
        setError(e?.message || '无法建立 VNC 连接');
      }
    };
    startWithBase(bases[idx]);
  };

  useEffect(() => {
    if (aliyunVncUrl && aliyunVncUrl.trim()) {
      handleConnect();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aliyunVncUrl]);

  const handleClose = () => {
    try { rfbRef.current?.disconnect(); } catch {}
    rfbRef.current = null;
    setConnected(false);
  };

  return (
    <PageContainer title={''} asCard={false} contentPadding={0} pagePadding={0}>
      <div style={{ background: '#1e1e1e', height: 'calc(100vh - 64px)', borderRadius: 0 }}>
        <div style={{ height: 40, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 16px', background: '#252526', borderTopLeftRadius: 0, borderTopRightRadius: 0 }}>
          <Space>
            <Tag color="#2b7489" style={{ marginRight: 0 }}>{String(form.getFieldValue('host') || '')}</Tag>
            <Tag color="#3f3f46" style={{ marginRight: 0 }}>:{String(form.getFieldValue('port') || 5900)}</Tag>
          </Space>
          <Space>
            <Button size="small" type="text" style={{ color: '#d4d4d4' }} onClick={()=> setSiderCollapsed(v=>!v)} icon={siderCollapsed? <MenuUnfoldOutlined />:<MenuFoldOutlined />} />
            <Button size="small" type="text" style={{ color: '#d4d4d4' }} onClick={()=> setFullscreen(f=>!f)} icon={fullscreen? <FullscreenExitOutlined />:<FullscreenOutlined />} />
            <Button size="small" onClick={() => navigate(-1)} style={{ background: '#3c3c3c', color: '#fff' }}>返回</Button>
            <Button size="small" onClick={handleConnect} disabled={connecting} type="primary">重新连接</Button>
            <Button size="small" onClick={handleClose}>断开</Button>
          </Space>
        </div>

        <Row gutter={0} style={{ padding: 0, margin: 0 }}>
          <Col flex={siderCollapsed || fullscreen ? '0px' : '320px'} style={{ display: siderCollapsed || fullscreen ? 'none' : 'block' }}>
            <div style={{ height: 'calc(100vh - 64px - 40px - 28px)', minHeight: 520, background: '#252526', padding: 12 }}>
              <div style={{ color: '#d4d4d4', marginBottom: 8 }}>连接参数</div>
              <Form form={form} layout="vertical" initialValues={{ host: '', port: 5900, password: '' }}>
                <Form.Item name="host" label={<span style={{ color: '#d4d4d4' }}>主机</span>} rules={[{ required: true, message: '请输入主机' }]}>
                  <Input placeholder="IP 或主机名" style={{ background: '#1e1e1e', color: '#d4d4d4', borderColor: '#3c3c3c' }} />
                </Form.Item>
                <Form.Item name="port" label={<span style={{ color: '#d4d4d4' }}>端口</span>} rules={[{ required: true, message: '请输入端口' }]}>
                  <InputNumber min={1} max={65535} style={{ width: '100%', background: '#1e1e1e', color: '#d4d4d4', borderColor: '#3c3c3c' }} />
                </Form.Item>
                <Form.Item name="password" label={<span style={{ color: '#d4d4d4' }}>密码</span>}>
                  <Input.Password placeholder="如果 VNC 要求密码" style={{ background: '#1e1e1e', color: '#d4d4d4', borderColor: '#3c3c3c' }} />
                </Form.Item>
                <Form.Item>
                  <Space>
                    <Button type="primary" onClick={handleConnect} loading={connecting} disabled={connected}>连接</Button>
                    <Button onClick={handleClose}>关闭</Button>
                  </Space>
                </Form.Item>
                {error && <Alert style={{ marginTop: 8 }} type="error" message={error} />}
              </Form>
            </div>
          </Col>

          <Col flex="auto">
            <div style={{ height: 'calc(100vh - 64px - 40px - 28px)', minHeight: 520, display: 'flex', flexDirection: 'column', background: '#1e1e1e', overflow: 'hidden' }}>
              <div style={{ flex: 1, overflow: 'auto' }} ref={screenRef} />
            </div>
          </Col>
        </Row>

        <div style={{ height: 28, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 16px', background: '#007acc', color: '#fff', borderBottomLeftRadius: 0, borderBottomRightRadius: 0 }}>
          <span>WebVNC</span>
          <span>{connected ? '已连接' : '未连接'}</span>
        </div>
      </div>
    </PageContainer>
  );
};

export default WebVNCPage;
