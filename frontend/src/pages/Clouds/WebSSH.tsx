import React, { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import { Row, Col, Form, Input, Button, Space, Alert, Radio, Card, Tag } from 'antd';
import { FullscreenOutlined, FullscreenExitOutlined, MenuFoldOutlined, MenuUnfoldOutlined } from '@ant-design/icons';
import PageContainer from '../../components/PageContainer';
import { API_BASE_URL } from '../../services/api';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import 'xterm/css/xterm.css';

function wsUrlFromBase(baseHttp: string): string {
  const token = localStorage.getItem('token') || '';
  const base = baseHttp.replace(/^http/, 'ws');
  const sep = base.endsWith('/') ? '' : '/';
  return `${base}${sep}ws/ssh?token=${encodeURIComponent(token)}`;
}

const WebSSHPage: React.FC = () => {
  const navigate = useNavigate();
  const { id } = useParams();
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  const [form] = Form.useForm();
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [authMethod, setAuthMethod] = useState<'password' | 'privateKey'>('password');
  const [siderCollapsed, setSiderCollapsed] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [latencyMs, setLatencyMs] = useState<number | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const termContainerRef = useRef<HTMLDivElement | null>(null);
  const dataListenerRef = useRef<any>(null);
  const pingTimerRef = useRef<any>(null);

  useEffect(() => {
    const host = params.get('host') || '';
    const user = params.get('user') || 'root';
    const port = Number(params.get('port') || '22');
    form.setFieldsValue({ host, username: user, port });
  }, [location.search]);

  useEffect(() => {
    if (!termRef.current) {
      const isEdge = /Edg\//.test(navigator.userAgent);
      const term = new Terminal({
        cursorBlink: true,
        convertEol: true,
        disableStdin: false,
        scrollback: 10000,
        fontFamily: 'Consolas, Menlo, monospace',
        fontSize: 13,
        cols: 120,
        rows: 30,
        theme: { background: '#1e1e1e', foreground: '#d4d4d4', cursor: '#ffffff' },
        allowTransparency: false,
        screenReaderMode: false,
        macOptionIsMeta: false,
        macOptionClickForcesSelection: false,
        rightClickSelectsWord: true,
        allowProposedApi: true,
        windowsMode: isEdge,
        letterSpacing: isEdge ? 0 : undefined,
        lineHeight: isEdge ? 1.2 : undefined,
      });
      const fitAddon = new FitAddon();
      term.loadAddon(fitAddon);
      try { term.attachCustomKeyEventHandler(() => true); } catch {}
      termRef.current = term;
      fitRef.current = fitAddon;
    }
    if (termContainerRef.current && termRef.current) {
      requestAnimationFrame(() => {
        termRef.current?.open(termContainerRef.current!);
        try { termRef.current?.focus(); } catch {}
        requestAnimationFrame(() => {
          try { fitRef.current?.fit(); } catch {}
        });
        try {
          const root = (termRef.current as any)?.element as HTMLElement | null;
          const viewport = root?.querySelector('.xterm-viewport') as HTMLElement | null;
          if (viewport) {
            viewport.style.overflow = 'hidden';
            viewport.style.background = '#1e1e1e';
          }
        } catch {}
      });
    }
    return () => {
      try { socketRef.current?.close(); } catch {}
      try { dataListenerRef.current?.dispose?.(); } catch {}
      dataListenerRef.current = null;
      try { termRef.current?.dispose(); } catch {}
      termRef.current = null;
      fitRef.current = null;
      setConnected(false);
      setConnecting(false);
      setError(null);
    };
  }, []);

  useEffect(() => {
    const onResize = () => { try { fitRef.current?.fit(); } catch {} };
    window.addEventListener('resize', onResize);
    const onAnyKey = (e: KeyboardEvent) => {
      try {
        const target = e.target as HTMLElement | null;
        if (termContainerRef.current && target && termContainerRef.current.contains(target)) {
          termRef.current?.focus();
        }
      } catch {}
    };
    window.addEventListener('keydown', onAnyKey, { capture: true } as any);
    return () => { window.removeEventListener('resize', onResize); window.removeEventListener('keydown', onAnyKey as any); };
  }, []);

  const handleConnect = async () => {
    setError(null);
    const values = await form.validateFields();
    const { host, username, port } = values;
    const password = values.password;
    const privateKey = values.privateKey;
    const passphrase = values.passphrase;
    const override = (process.env.REACT_APP_WS_URL || '').trim();
    const origin = typeof window !== 'undefined' ? window.location.origin : API_BASE_URL;
    const hostOnly = typeof window !== 'undefined' ? window.location.hostname : 'localhost';
    const scheme = typeof window !== 'undefined' ? window.location.protocol.replace('http', 'ws') : 'ws:';
    const bases: string[] = [];
    bases.push(override || origin);
    bases.push(`${scheme}//${hostOnly}:4002`);
    bases.push(`${scheme}//${hostOnly}:3001`);
    if (!bases.includes(API_BASE_URL)) bases.push(API_BASE_URL);
    let idx = 0;

    const startWithBase = (base: string) => {
      const url = wsUrlFromBase(base);
      const ws = new WebSocket(url);
      socketRef.current = ws;
      setConnecting(true);

      ws.onopen = () => {
        ws.send(JSON.stringify({ type: 'connect', data: { host, username, port: Number(port) || 22, cols: termRef.current?.cols || 120, rows: termRef.current?.rows || 30, ...(authMethod === 'privateKey' ? { privateKey, passphrase } : { password }) } }));
      };
      ws.onmessage = (ev) => {
        let msg: any = null;
        try { msg = JSON.parse(String(ev.data)); } catch { msg = null; }
        if (!msg) return;
        switch (msg.type) {
          case 'ready':
            setConnected(true);
            setConnecting(false);
            termRef.current?.focus();
            try { fitRef.current?.fit(); } catch {}
            const activateTerminal = () => {
              try {
                const term = termRef.current;
                if (term && socketRef.current) {
                  socketRef.current.send(JSON.stringify({ type: 'resize', data: { cols: term.cols, rows: term.rows } }));
                }
              } catch {}
              setTimeout(() => { socketRef.current?.send(JSON.stringify({ type: 'input', data: '\r' })); }, 100);
              setTimeout(() => { socketRef.current?.send(JSON.stringify({ type: 'input', data: ' ' })); }, 300);
              setTimeout(() => { socketRef.current?.send(JSON.stringify({ type: 'input', data: '\r' })); }, 500);
              setTimeout(() => { socketRef.current?.send(JSON.stringify({ type: 'input', data: '\x03' })); }, 700);
            };
            setTimeout(activateTerminal, 100);
            try { if (pingTimerRef.current) clearInterval(pingTimerRef.current); } catch {}
            pingTimerRef.current = setInterval(() => {
              try {
                const t = Date.now();
                socketRef.current?.send(JSON.stringify({ type: 'ping' }));
                const handlePong = (e: MessageEvent) => {
                  try {
                    const obj = JSON.parse(String(e.data || ''));
                    if (obj && obj.type === 'pong') {
                      setLatencyMs(Date.now() - t);
                      ws.removeEventListener('message', handlePong as any);
                    }
                  } catch {}
                };
                ws.addEventListener('message', handlePong as any);
              } catch {}
            }, 5000);
            break;
          case 'data':
            termRef.current?.write(String(msg.data || ''));
            break;
          case 'error':
            setError(String(msg.message || '连接错误'));
            setConnecting(false);
            break;
          case 'close':
            setConnected(false);
            setConnecting(false);
            try { if (pingTimerRef.current) clearInterval(pingTimerRef.current); } catch {}
            break;
          case 'pong':
            break;
          default:
            break;
        }
      };
      ws.onerror = () => {
        setConnecting(false);
        idx += 1;
        if (idx < bases.length) {
          startWithBase(bases[idx]);
          return;
        }
        setError('WebSocket 错误，无法建立连接');
      };
      ws.onclose = (ev) => {
        setConnected(false);
        setConnecting(false);
        try { if (ev?.reason) setError(ev.reason); } catch {}
        try { if (pingTimerRef.current) clearInterval(pingTimerRef.current); } catch {}
      };
    };
    startWithBase(bases[idx]);
    if (dataListenerRef.current) {
      try { dataListenerRef.current.dispose?.(); } catch {}
    }
    dataListenerRef.current = termRef.current?.onData((data) => {
      if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
        socketRef.current.send(JSON.stringify({ type: 'input', data }));
      }
    });
  };

  const handleClose = () => {
    try { socketRef.current?.send(JSON.stringify({ type: 'close' })); } catch {}
    try { socketRef.current?.close(); } catch {}
    try { dataListenerRef.current?.dispose?.(); } catch {}
    dataListenerRef.current = null;
    setConnected(false);
  };

  return (
    <PageContainer title={''} asCard={false} contentPadding={0} pagePadding={0}>
      <div style={{ background: '#1e1e1e', height: 'calc(100vh - 64px)', borderRadius: 0 }}>
        <div style={{ height: 40, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 16px', background: '#252526', borderTopLeftRadius: 0, borderTopRightRadius: 0 }}>
          <Space>
            <Tag color="#2b7489" style={{ marginRight: 0 }}>{String(form.getFieldValue('username') || 'root')}@{String(form.getFieldValue('host') || '')}</Tag>
            <Tag color="#3f3f46" style={{ marginRight: 0 }}>:{String(form.getFieldValue('port') || 22)}</Tag>
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
              <Form form={form} layout="vertical" initialValues={{ host: '', username: 'root', port: 22, password: '' }}>
                <Form.Item name="host" label={<span style={{ color: '#d4d4d4' }}>主机</span>} rules={[{ required: true, message: '请输入主机' }]}> 
                  <Input placeholder="IP 或主机名" style={{ background: '#1e1e1e', color: '#d4d4d4', borderColor: '#3c3c3c' }} />
                </Form.Item>
                <Form.Item name="username" label={<span style={{ color: '#d4d4d4' }}>用户</span>} rules={[{ required: true, message: '请输入用户' }]}> 
                  <Input style={{ background: '#1e1e1e', color: '#d4d4d4', borderColor: '#3c3c3c' }} />
                </Form.Item>
                <Form.Item name="port" label={<span style={{ color: '#d4d4d4' }}>端口</span>} rules={[{ required: true, message: '请输入端口' }]}> 
                  <Input style={{ background: '#1e1e1e', color: '#d4d4d4', borderColor: '#3c3c3c' }} />
                </Form.Item>
                <Form.Item label={<span style={{ color: '#d4d4d4' }}>认证</span>}>
                  <Radio.Group value={authMethod} onChange={(e)=> setAuthMethod(e.target.value)}>
                    <Radio.Button value="password">密码</Radio.Button>
                    <Radio.Button value="privateKey">私钥</Radio.Button>
                  </Radio.Group>
                </Form.Item>
                {authMethod === 'password' ? (
                  <Form.Item name="password" label={<span style={{ color: '#d4d4d4' }}>密码</span>} rules={[{ required: true, message: '请输入密码' }]}> 
                    <Input.Password style={{ background: '#1e1e1e', color: '#d4d4d4', borderColor: '#3c3c3c' }} />
                  </Form.Item>
                ) : (
                  <>
                    <Form.Item name="privateKey" label={<span style={{ color: '#d4d4d4' }}>私钥</span>} rules={[{ required: true, message: '请输入私钥' }]}> 
                      <Input.TextArea rows={6} placeholder={'-----BEGIN OPENSSH PRIVATE KEY-----\n...\n-----END OPENSSH PRIVATE KEY-----'} style={{ background: '#1e1e1e', color: '#d4d4d4', borderColor: '#3c3c3c' }} />
                    </Form.Item>
                    <Form.Item name="passphrase" label={<span style={{ color: '#d4d4d4' }}>短语</span>}> 
                      <Input.Password placeholder="如私钥已加密则填写" style={{ background: '#1e1e1e', color: '#d4d4d4', borderColor: '#3c3c3c' }} />
                    </Form.Item>
                  </>
                )}
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
              <div style={{ flex: 1, overflow: 'auto' }} ref={termContainerRef} tabIndex={0} onMouseDown={()=>{ try { termRef.current?.focus(); } catch {} }} />
            </div>
          </Col>
        </Row>

        <div style={{ height: 28, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 16px', background: '#007acc', color: '#fff', borderBottomLeftRadius: 0, borderBottomRightRadius: 0 }}>
          <span>WebSSH</span>
          <span>{connected ? '已连接' : '未连接'} · {termRef.current?.rows || 0}x{termRef.current?.cols || 0} · {latencyMs!==null? `${latencyMs}ms`:'--'}</span>
        </div>
      </div>
    </PageContainer>
  );
};

export default WebSSHPage;