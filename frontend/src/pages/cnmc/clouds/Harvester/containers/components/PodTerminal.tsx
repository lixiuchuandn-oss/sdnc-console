import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Select, Spin, message, Space, Button, Tag } from 'antd';
import { FullscreenOutlined, ReloadOutlined, CloseOutlined } from '@ant-design/icons';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import { WebglAddon } from 'xterm-addon-webgl';
import 'xterm/css/xterm.css';
import { API_BASE_URL } from '../../../../../../services/api';
import { getToken } from '../../../../../../utils/tokenStorage';

export interface PodTerminalProps {
  visible: boolean;
  cloudId: string;
  namespace: string;
  podName: string;
  containers: string[];
  defaultContainer?: string;
  onClose: () => void;
}

const PodTerminal: React.FC<PodTerminalProps> = ({
  visible,
  cloudId,
  namespace,
  podName,
  containers,
  defaultContainer,
  onClose,
}) => {
  const [selectedContainer, setSelectedContainer] = useState<string>('');
  const [connecting, setConnecting] = useState(false);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const termContainerRef = useRef<HTMLDivElement | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const dataListenerRef = useRef<any>(null);

  // 初始化容器选择
  useEffect(() => {
    if (containers && containers.length > 0) {
      const defaultCont = defaultContainer || containers[0];
      setSelectedContainer(containers.includes(defaultCont) ? defaultCont : containers[0]);
    }
  }, [containers, defaultContainer]);

  // 初始化终端
  useEffect(() => {
    if (visible && termContainerRef.current && !termRef.current) {
      // 创建新终端实例
      const term = new Terminal({
        cursorBlink: true,
        cursorStyle: 'block',
        convertEol: true,
        disableStdin: false,
        scrollback: 10000,
        fontFamily: '"Microsoft YaHei Mono", "Noto Sans Mono CJK SC", Consolas, "Courier New", monospace',
        fontSize: 14,
        letterSpacing: 0,
        cols: 80,
        rows: 24,
        theme: {
          background: '#1e1e1e',
          foreground: '#d4d4d4',
          cursor: '#ffffff',
          cursorAccent: '#1e1e1e',
        },
        // 禁用屏幕阅读器模式以确保正确计算字符宽度
        screenReaderMode: false,
      });

      const fitAddon = new FitAddon();
      term.loadAddon(fitAddon);

      // 加载 WebGL 插件以获得更好的渲染性能
      try {
        const webglAddon = new WebglAddon();
        term.loadAddon(webglAddon);
      } catch (e) {
        console.warn('[PodTerminal] WebGL 不可用，回退到默认渲染器');
      }

      // 打开终端
      term.open(termContainerRef.current);
      term.focus();



      // 延迟 fit 确保容器已渲染
      setTimeout(() => {
        fitAddon.fit();
      }, 100);

      termRef.current = term;
      fitRef.current = fitAddon;
    }

    return () => {
      if (!visible) {
        disconnect();
        dataListenerRef.current?.dispose?.();
        termRef.current?.dispose();
        termRef.current = null;
        fitRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  // 构建 WebSocket URL
  const buildWsUrl = useCallback((command?: string) => {
    const token = getToken() || '';
    const baseUrl = (API_BASE_URL || window.location.origin).replace(/^http/, 'ws');
    // 默认使用 /bin/sh，因为所有镜像都有 sh（Alpine 等精简镜像没有 bash）
    const cmd = command || '/bin/sh';
    const params = new URLSearchParams({
      token,
      cloudId,
      namespace,
      podName,
      container: selectedContainer,
      command: cmd,
      cols: String(termRef.current?.cols || 80),
      rows: String(termRef.current?.rows || 24),
    });
    return `${baseUrl}/ws/kv-pod-exec?${params}`;
  }, [cloudId, namespace, podName, selectedContainer]);

  // 发送 resize 消息
  const sendResize = useCallback((cols: number, rows: number) => {
    if (socketRef.current?.readyState === WebSocket.OPEN) {
      const resizeMsg = JSON.stringify({ Width: cols, Height: rows });
      const encoder = new TextEncoder();
      const msgBytes = encoder.encode(resizeMsg);
      const buffer = new Uint8Array(1 + msgBytes.length);
      buffer[0] = 4;
      buffer.set(msgBytes, 1);
      socketRef.current.send(buffer);
    }
  }, []);

  // 连接 WebSocket
  const connect = useCallback(() => {
    if (!selectedContainer) {
      message.warning('请选择容器');
      return;
    }

    const term = termRef.current;
    if (!term) return;

    disconnect();
    setError(null);
    setConnecting(true);
    setConnected(false);

    // 清空终端内容
    term.clear();

    const ws = new WebSocket(buildWsUrl());
    ws.binaryType = 'arraybuffer';
    socketRef.current = ws;

    ws.onopen = () => {
      setConnecting(false);
      setConnected(true);
      term.focus();

      // 发送 resize
      sendResize(term.cols, term.rows);

      // 设置输入监听器
      dataListenerRef.current = term.onData((data) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(data);
        }
      });

      // 发送 Enter 唤醒 shell
      setTimeout(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send('\r');
        }
      }, 200);

      // 设置彩色提示符和别名（延迟执行，确保 shell 已启动）
      setTimeout(() => {
        if (ws.readyState === WebSocket.OPEN) {
          // 设置 PS1 显示彩色路径: 用户名@主机名:当前路径$
          // \[\e[32m\] 绿色用户名
          // \[\e[33m\] 黄色主机名
          // \[\e[36m\] 青色路径
          ws.send("export PS1='\\[\\e[32m\\]\\u\\[\\e[0m\\]@\\[\\e[33m\\]\\h\\[\\e[0m\\]:\\[\\e[36m\\]\\w\\[\\e[0m\\]\\$ '\r");
        }
      }, 500);

      // 设置 ls 颜色别名
      setTimeout(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send("alias ls='ls --color=auto' 2>/dev/null || alias ls='ls -G'\r");
        }
      }, 700);

      // 显示当前 shell 信息
      setTimeout(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send("echo '=== Shell Info: $(echo $0) ==='\r");
        }
      }, 900);
    };

    ws.onmessage = (event) => {
      if (event.data instanceof ArrayBuffer) {
        // 使用 TextDecoder 确保正确解码 UTF-8
        const decoder = new TextDecoder('utf-8');
        const text = decoder.decode(event.data);
        term.write(text);
      } else if (event.data instanceof Blob) {
        event.data.arrayBuffer().then((buffer) => {
          const decoder = new TextDecoder('utf-8');
          const text = decoder.decode(buffer);
          term.write(text);
        });
      } else if (typeof event.data === 'string') {
        term.write(event.data);
      }
    };

    ws.onerror = () => {
      setError('连接错误');
      setConnecting(false);
      term.write('\r\n\x1b[31m连接错误\x1b[0m\r\n');
    };

    ws.onclose = (event) => {
      setConnected(false);
      setConnecting(false);
      if (event.code !== 1000) {
        const reason = event.reason || '连接已断开';
        setError(reason);
        term.write(`\r\n\x1b[31m${reason}\x1b[0m\r\n`);
      }
      dataListenerRef.current?.dispose?.();
      dataListenerRef.current = null;
    };
  }, [buildWsUrl, selectedContainer, sendResize]);

  // 断开连接
  const disconnect = useCallback(() => {
    dataListenerRef.current?.dispose?.();
    dataListenerRef.current = null;
    socketRef.current?.close();
    socketRef.current = null;
    setConnected(false);
  }, []);

  // 自动连接
  useEffect(() => {
    const timer = setTimeout(() => {
      if (visible && selectedContainer && !connected && !connecting && termRef.current) {
        connect();
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [visible, selectedContainer, connect]);

  // 窗口大小变化
  useEffect(() => {
    const onResize = () => {
      if (termRef.current && fitRef.current) {
        try {
          fitRef.current.fit();
        } catch {}
      }
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const handleReconnect = () => {
    connect();
  };

  const handleClose = () => {
    disconnect();
    onClose();
  };

  if (!visible) return null;

  const headerHeight = 40;
  const footerHeight = 28;

  return (
    <div
      style={{
        position: 'fixed',
        top: isFullscreen ? 0 : '10%',
        left: isFullscreen ? 0 : '50%',
        transform: isFullscreen ? 'none' : 'translateX(-50%)',
        width: isFullscreen ? '100vw' : Math.min(900, window.innerWidth * 0.9),
        height: isFullscreen ? '100vh' : Math.min(500, window.innerHeight * 0.8),
        maxWidth: '100vw',
        maxHeight: '100vh',
        background: '#1e1e1e',
        borderRadius: isFullscreen ? 0 : 8,
        boxShadow: isFullscreen ? 'none' : '0 4px 20px rgba(0,0,0,0.3)',
        zIndex: 1050,
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* 顶部工具栏 */}
      <div
        style={{
          height: headerHeight,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 12px',
          background: '#252526',
          borderBottom: '1px solid #3c3c3c',
          flexShrink: 0,
        }}
      >
        <Space>
          <Select
            value={selectedContainer}
            onChange={(val) => {
              setSelectedContainer(val);
              // 切换容器后重新连接
              setTimeout(() => connect(), 100);
            }}
            style={{ width: 200 }}
            options={containers.map((c) => ({ label: c, value: c }))}
            disabled={connecting}
          />
          {connected && <Tag color="green">已连接</Tag>}
          {connecting && <Tag color="blue">连接中...</Tag>}
          {error && <Tag color="red">{error}</Tag>}
        </Space>
        <Space>
          <Button size="small" icon={<ReloadOutlined />} onClick={handleReconnect} disabled={connecting}>
            重连
          </Button>
          <Button size="small" icon={<FullscreenOutlined />} onClick={() => setIsFullscreen(!isFullscreen)}>
            {isFullscreen ? '退出全屏' : '全屏'}
          </Button>
          <Button size="small" icon={<CloseOutlined />} onClick={handleClose}>
            关闭
          </Button>
        </Space>
      </div>

      {/* 终端容器 */}
      <div
        ref={termContainerRef}
        style={{
          flex: '1 1 auto',
          minHeight: 0,
          padding: '8px 8px 8px 16px',  // 增加左边距
          background: '#1e1e1e',
          position: 'relative',
        }}
      >
        {connecting && (
          <div
            style={{
              position: 'absolute',
              top: '50%',
              left: '50%',
              transform: 'translate(-50%, -50%)',
              zIndex: 10,
            }}
          >
            <Spin tip="连接中..." />
          </div>
        )}
      </div>

      {/* 底部状态栏 */}
      <div
        style={{
          height: footerHeight,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 12px',
          background: '#252526',
          borderTop: '1px solid #3c3c3c',
          flexShrink: 0,
          fontSize: 12,
          color: '#cccccc',
        }}
      >
        <span title={`Pod: ${namespace}/${podName}`}>
          {namespace}/{podName}
        </span>
        <span style={{ color: '#888', fontSize: 11 }}>
          提示: 支持彩色输出，使用 ls 查看文件颜色区分
        </span>
        <span>
          {termRef.current?.cols || 0}x{termRef.current?.rows || 0}
        </span>
      </div>
    </div>
  );
};

export default PodTerminal;