import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  CodeOutlined,
  FullscreenExitOutlined,
  FullscreenOutlined,
  ReloadOutlined,
} from '@ant-design/icons';
import { Alert, Button, Space, Spin, Tag, Tooltip } from 'antd';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import 'xterm/css/xterm.css';
import { API_BASE_URL } from 'services/api';
import { getToken } from 'utils/tokenStorage';

const XTERM_THEME = {
  background: '#0c0c0c',
  foreground: '#d4d4d4',
  cursor: '#aeafad',
  cursorAccent: '#0c0c0c',
  selectionBackground: '#264f78',
  black: '#0c0c0c',
  red: '#f14c4c',
  green: '#23d18b',
  yellow: '#f5f543',
  blue: '#3b8eea',
  magenta: '#d670d6',
  cyan: '#29b8db',
  white: '#d4d4d4',
  brightBlack: '#666666',
  brightRed: '#f14c4c',
  brightGreen: '#23d18b',
  brightYellow: '#f5f543',
  brightBlue: '#3b8eea',
  brightMagenta: '#d670d6',
  brightCyan: '#29b8db',
  brightWhite: '#ffffff',
};

const DEFAULT_COLS = 100;
const DEFAULT_ROWS = 28;
const MIN_TERMINAL_PX = 64;

export type WebSshConnectParams = {
  host: string;
  port?: number;
  username: string;
  password: string;
  bootstrap?: 'linux' | 'none';
};

export type WebSshTerminalProps = {
  active: boolean;
  connect: WebSshConnectParams | null;
  height?: number | string;
  fillParent?: boolean;
  title?: string;
  subtitle?: string;
  footerHint?: string;
};

type WsPayload = { type: string; data?: string; message?: string };

function hostHasLayout(el: HTMLElement | null): boolean {
  if (!el) return false;
  const rect = el.getBoundingClientRect();
  return rect.width >= MIN_TERMINAL_PX && rect.height >= MIN_TERMINAL_PX;
}

/** 用 proposeDimensions + resize，避免 fit() 在渲染器未就绪时触发 Viewport 异常 */
function applyFit(
  fit: FitAddon,
  term: Terminal,
): { cols: number; rows: number } | null {
  const dims = fit.proposeDimensions();
  if (!dims || dims.cols < 2 || dims.rows < 2) return null;
  term.resize(dims.cols, dims.rows);
  return dims;
}

const WebSshTerminal: React.FC<WebSshTerminalProps> = ({
  active,
  connect,
  height = 420,
  fillParent = false,
  title = 'SSH 终端',
  subtitle,
  footerHint,
}) => {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const dataListenerRef = useRef<{ dispose: () => void } | null>(null);
  const sessionGenRef = useRef(0);

  const [hostReady, setHostReady] = useState(false);
  const [termReady, setTermReady] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [termSize, setTermSize] = useState({ cols: 0, rows: 0 });

  const endpointLabel = connect
    ? `${connect.username}@${connect.host}:${connect.port ?? 22}`
    : '—';

  const syncResizeToServer = useCallback((cols: number, rows: number) => {
    const ws = socketRef.current;
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'resize', data: { cols, rows } }));
    }
  }, []);

  const fitTerminal = useCallback(() => {
    const host = hostRef.current;
    const fit = fitRef.current;
    const term = termRef.current;
    if (!hostHasLayout(host) || !fit || !term) return null;
    try {
      const dims = applyFit(fit, term);
      if (!dims) return null;
      setTermSize(dims);
      syncResizeToServer(dims.cols, dims.rows);
      return dims;
    } catch {
      return null;
    }
  }, [syncResizeToServer]);

  const disconnect = useCallback(() => {
    sessionGenRef.current += 1;
    dataListenerRef.current?.dispose?.();
    dataListenerRef.current = null;
    try {
      socketRef.current?.close();
    } catch {
      /* ignore */
    }
    socketRef.current = null;
    setConnected(false);
    setConnecting(false);
  }, []);

  const buildWsUrl = useCallback(() => {
    const token = getToken() || '';
    const base = (API_BASE_URL || window.location.origin).replace(/^http/i, 'ws');
    const url = new URL(`${base}/ws/ssh`);
    url.searchParams.set('token', token);
    return url.toString();
  }, []);

  const startSession = useCallback(() => {
    if (!connect || !termRef.current || !termReady) return;

    const gen = sessionGenRef.current + 1;
    sessionGenRef.current = gen;

    try {
      socketRef.current?.close();
    } catch {
      /* ignore */
    }
    socketRef.current = null;
    setConnected(false);

    setError(null);
    setConnecting(true);
    termRef.current.clear();

    const dims = fitTerminal();
    const cols = dims?.cols ?? termRef.current.cols ?? DEFAULT_COLS;
    const rows = dims?.rows ?? termRef.current.rows ?? DEFAULT_ROWS;

    const ws = new WebSocket(buildWsUrl());
    socketRef.current = ws;

    ws.onopen = () => {
      if (sessionGenRef.current !== gen) return;
      ws.send(
        JSON.stringify({
          type: 'connect',
          data: {
            host: connect.host,
            port: connect.port ?? 22,
            username: connect.username,
            password: connect.password,
            cols,
            rows,
            bootstrap: connect.bootstrap ?? 'linux',
          },
        }),
      );
    };

    ws.onmessage = (ev) => {
      if (sessionGenRef.current !== gen) return;
      let msg: WsPayload | null = null;
      try {
        msg = JSON.parse(String(ev.data));
      } catch {
        msg = null;
      }
      if (!msg) return;
      const term = termRef.current;
      if (!term) return;

      switch (msg.type) {
        case 'ready':
          setConnecting(false);
          setConnected(true);
          fitTerminal();
          term.focus();
          break;
        case 'data':
          if (msg.data && termReady) term.write(msg.data);
          break;
        case 'error':
          setConnecting(false);
          setConnected(false);
          setError(msg.message || 'SSH 连接失败');
          try {
            term.writeln(`\r\n\x1b[31m${msg.message || 'SSH 连接失败'}\x1b[0m\r\n`);
          } catch {
            /* ignore */
          }
          break;
        case 'close':
          setConnecting(false);
          setConnected(false);
          break;
        default:
          break;
      }
    };

    ws.onerror = () => {
      if (sessionGenRef.current !== gen) return;
      setConnecting(false);
      setConnected(false);
      setError('WebSocket 连接失败');
    };

    ws.onclose = () => {
      if (sessionGenRef.current !== gen) return;
      setConnecting(false);
      setConnected(false);
    };
  }, [buildWsUrl, connect, disconnect, fitTerminal, termReady]);

  // 1) 等待宿主 div 有有效尺寸（抽屉动画结束、flex 布局完成）
  useEffect(() => {
    if (!active) {
      setHostReady(false);
      return;
    }

    const el = hostRef.current;
    if (!el) return;

    let cancelled = false;
    const probe = () => {
      if (cancelled) return;
      if (hostHasLayout(el)) setHostReady(true);
    };

    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(probe) : null;
    ro?.observe(el);
    probe();
    const t1 = window.setTimeout(probe, 80);
    const t2 = window.setTimeout(probe, 320);

    return () => {
      cancelled = true;
      ro?.disconnect();
      window.clearTimeout(t1);
      window.clearTimeout(t2);
      setHostReady(false);
    };
  }, [active]);

  // 2) 宿主就绪后再 open xterm
  useEffect(() => {
    if (!active || !hostReady || !hostRef.current) {
      setTermReady(false);
      return;
    }
    if (termRef.current) return;

    const host = hostRef.current;
    if (!hostHasLayout(host)) return;

    const term = new Terminal({
      cols: DEFAULT_COLS,
      rows: DEFAULT_ROWS,
      cursorBlink: true,
      fontSize: 13,
      lineHeight: 1.2,
      fontFamily: 'Consolas, "Cascadia Mono", "Courier New", monospace',
      theme: XTERM_THEME,
      convertEol: true,
      scrollback: 5000,
      screenReaderMode: false,
    });
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(host);

    termRef.current = term;
    fitRef.current = fitAddon;

    dataListenerRef.current = term.onData((data) => {
      const ws = socketRef.current;
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'input', data }));
      }
    });

    const dims = applyFit(fitAddon, term);
    if (dims) setTermSize(dims);
    setTermReady(true);

    const onWinResize = () => fitTerminal();
    window.addEventListener('resize', onWinResize);
    const ro =
      typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver(() => fitTerminal())
        : null;
    ro?.observe(host);

    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', onWinResize);
      disconnect();
      dataListenerRef.current?.dispose?.();
      dataListenerRef.current = null;
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
      setTermReady(false);
    };
  }, [active, hostReady, disconnect, fitTerminal]);

  // 3) 终端就绪后再建连
  useEffect(() => {
    if (!active || !connect || !termReady) return;
    const t = window.setTimeout(() => startSession(), 100);
    return () => window.clearTimeout(t);
  }, [active, connect, termReady, startSession]);

  useEffect(() => {
    const onFsChange = () => {
      setIsFullscreen(document.fullscreenElement === rootRef.current);
      window.setTimeout(() => fitTerminal(), 200);
    };
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, [fitTerminal]);

  const toggleFullscreen = useCallback(() => {
    const el = rootRef.current;
    if (!el) return;
    if (document.fullscreenElement === el) {
      void document.exitFullscreen();
    } else {
      void el.requestFullscreen();
    }
  }, []);

  if (!active) return null;

  const statusTag = error ? (
    <Tag color="error">失败</Tag>
  ) : connected ? (
    <Tag color="success">已连接</Tag>
  ) : connecting ? (
    <Tag color="processing">连接中</Tag>
  ) : !termReady ? (
    <Tag color="default">初始化</Tag>
  ) : (
    <Tag>未连接</Tag>
  );

  return (
    <div
      ref={rootRef}
      className={`web-ssh-terminal${fillParent ? ' web-ssh-terminal--fill' : ''}${isFullscreen ? ' web-ssh-terminal--fullscreen' : ''}`}
      style={fillParent ? undefined : { height }}
    >
      <div className="web-ssh-terminal__header">
        <Space size="middle" className="web-ssh-terminal__header-lead">
          <CodeOutlined className="web-ssh-terminal__header-icon" />
          <div className="web-ssh-terminal__header-text">
            <span className="web-ssh-terminal__title">{title}</span>
            {subtitle ? <span className="web-ssh-terminal__subtitle">{subtitle}</span> : null}
          </div>
          {statusTag}
        </Space>
        <Space size={4} className="web-ssh-terminal__header-actions">
          <Tooltip title="重新连接">
            <Button
              type="text"
              size="small"
              className="web-ssh-terminal__icon-btn"
              icon={<ReloadOutlined />}
              onClick={() => startSession()}
              disabled={!connect || connecting || !termReady}
            />
          </Tooltip>
          <Tooltip title={isFullscreen ? '退出全屏' : '全屏'}>
            <Button
              type="text"
              size="small"
              className="web-ssh-terminal__icon-btn"
              icon={isFullscreen ? <FullscreenExitOutlined /> : <FullscreenOutlined />}
              onClick={toggleFullscreen}
            />
          </Tooltip>
        </Space>
      </div>

      {error && !connected ? (
        <div className="web-ssh-terminal__alert">
          <Alert type="error" showIcon message={error} />
        </div>
      ) : null}

      <div className="web-ssh-terminal__body">
        {(!hostReady || !termReady || (connecting && !connected)) ? (
          <div className="web-ssh-terminal__overlay">
            <Spin
              tip={
                !hostReady
                  ? '正在准备终端区域…'
                  : !termReady
                    ? '正在初始化终端…'
                    : '正在建立 SSH 会话…'
              }
            />
          </div>
        ) : null}
        <div ref={hostRef} className="web-ssh-terminal__xterm-host" />
      </div>

      <div className="web-ssh-terminal__footer">
        <span className="web-ssh-terminal__endpoint" title={endpointLabel}>
          {endpointLabel}
        </span>
        {footerHint ? (
          <span className="web-ssh-terminal__hint" title={footerHint}>
            {footerHint}
          </span>
        ) : null}
        <span className="web-ssh-terminal__size">
          {termSize.cols > 0 ? `${termSize.cols}×${termSize.rows}` : '—'}
        </span>
      </div>
    </div>
  );
};

export default WebSshTerminal;
