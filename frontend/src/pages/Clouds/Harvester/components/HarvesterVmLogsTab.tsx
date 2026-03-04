import React, { useEffect, useState, useRef, useCallback } from 'react';
import { Typography, Button, Select, Space, Empty, Spin, Checkbox } from 'antd';
import { ReloadOutlined, VerticalAlignBottomOutlined, DeleteOutlined } from '@ant-design/icons';
import { API_BASE_URL } from '../../../../services/api';
import { fetchHarvesterVmPod } from '../../../../services/loggingApi';

const { Text } = Typography;

/** 与 Harvester 官方一致：时间范围 + 行数范围 */
const RANGE_OPTIONS = [
  { label: '30 分钟', value: '30m', sinceSeconds: 1800 },
  { label: '1 小时', value: '1h', sinceSeconds: 3600 },
  { label: '前500行', value: '500l', tailLines: 500 },
  { label: '前1000行', value: '1000l', tailLines: 1000 },
  { label: '前5000行', value: '5000l', tailLines: 5000 },
];

interface HarvesterVmLogsTabProps {
  cloudId?: string;
  record: any;
  active: boolean;
}

// 简单的日志行结构
interface LogLine {
  id: string; // 唯一ID，用于 React key
  timestamp: string;
  level: string;
  component: string;
  message: string;
  raw: string; // 原始文本
}

function buildLogWsUrl(
  baseHttp: string,
  cloudId: string,
  namespace: string,
  podName: string,
  token: string,
  rangeOption: { sinceSeconds?: number; tailLines?: number }
): string {
  const base = baseHttp.replace(/^http/, 'ws');
  const sep = base.endsWith('/') ? '' : '/';
  const q = new URLSearchParams({
    token,
    cloudId,
    namespace,
    podName,
    container: 'compute',
  });
  if (rangeOption.tailLines) {
    q.set('tailLines', String(rangeOption.tailLines));
  } else {
    q.set('sinceSeconds', String(rangeOption.sinceSeconds ?? 1800));
  }
  return `${base}${sep}ws/kv-pod-log?${q}`;
}

/** 限制日志行数 */
const MAX_LOG_LINES = 10000;

/** 解析单行日志为对象 */
function parseLogLine(line: string): LogLine {
  const id = Math.random().toString(36).substring(2, 9);
  if (!line || !line.trim()) {
    return { id, timestamp: '', level: '', component: '', message: '', raw: line };
  }

  // 尝试匹配 "Timestamp JSON" 格式
  const match = line.match(/^(\S+)\s+(\{.*\})$/);
  if (match) {
    const timestamp = match[1];
    const jsonStr = match[2];
    try {
      const obj = JSON.parse(jsonStr);
      const level = obj.level || obj.severity || '';
      const component = obj.component || '';
      const msg = obj.msg || obj.message || obj.error || JSON.stringify(obj);
      
      return { id, timestamp, level, component, message: msg, raw: line };
    } catch {
      // JSON 解析失败
    }
  }
  return { id, timestamp: '', level: '', component: '', message: line, raw: line };
}

/** 获取日志级别对应的颜色 */
function getLevelColor(level: string): string {
  const l = (level || '').toLowerCase();
  if (l === 'error' || l === 'err' || l === 'fatal') return '#ff4d4f'; // Red
  if (l === 'warn' || l === 'warning') return '#faad14'; // Orange
  if (l === 'info' || l === 'information') return '#52c41a'; // Green
  if (l === 'debug' || l === 'trace') return '#1890ff'; // Blue
  return '#d4d4d4'; // Default
}

/** 获取日志级别对应的图标 */
function getLevelIcon(level: string): string {
  const l = (level || '').toLowerCase();
  if (l === 'error' || l === 'err' || l === 'fatal') return '🔴';
  if (l === 'warn' || l === 'warning') return '🟠';
  if (l === 'info' || l === 'information') return '🟢';
  if (l === 'debug' || l === 'trace') return '🔵';
  return '⚪';
}

/** 
 * 日志汉化规则库 
 * 包含精确匹配和正则替换
 */
const TRANSLATION_RULES = [
  // 常见 Harvester/K8s/Libvirt 错误
  { re: /Failed to freeze vmi/i, repl: '虚拟机文件系统冻结失败 (通常由于未安装 QEMU Guest Agent 导致)' },
  { re: /unable to execute QEMU agent command '(.+?)'/i, repl: "无法执行 QEMU 代理命令 '$1' (请检查 VM 内是否安装 qemu-guest-agent 并正在运行)" },
  { re: /guest-fsfreeze-freeze/i, repl: '文件系统冻结指令' },
  { re: /virError\(Code=(\d+), Domain=(\d+), Message='(.+?)'\)/i, repl: "Libvirt 错误 (代码=$1, 域=$2): $3" },
  { re: /internal error: (.+)/i, repl: "内部错误: $1" },
  { re: /Synced vmi/i, repl: '虚拟机状态已同步' },
  { re: /Domain not found/i, repl: '未找到虚拟机域' },
  { re: /Connection refused/i, repl: '连接被拒绝' },
  { re: /No such file or directory/i, repl: '文件或目录不存在' },
  { re: /failed to resolve image/i, repl: '无法解析镜像' },
  { re: /pulling image/i, repl: '正在拉取镜像' },
  { re: /successfully pulled image/i, repl: '镜像拉取成功' },
  { re: /created container/i, repl: '已创建容器' },
  { re: /started container/i, repl: '已启动容器' },
  { re: /killing container/i, repl: '正在终止容器' },
  { re: /Back-off restarting failed container/i, repl: '容器启动失败，正在重试 (Back-off)' },
  { re: /Liveness probe failed/i, repl: '存活探针检测失败' },
  { re: /Readiness probe failed/i, repl: '就绪探针检测失败' },
  { re: /Volume mount failed/i, repl: '卷挂载失败' },
  { re: /MountVolume.SetUp failed for volume/i, repl: '执行卷挂载 SetUp 失败' },
  { re: /failed to add (.+?) to snapshot set/i, repl: '无法将卷 $1 添加到快照集 (VSS 快照失败，请检查 Windows 客户机内的 VSS 服务状态)' },
];

function translateLogMessage(msg: string): string {
  if (!msg) return msg;
  let text = msg;
  for (const rule of TRANSLATION_RULES) {
    if (rule.re.test(text)) {
      text = text.replace(rule.re, rule.repl);
    }
  }
  return text;
}

/** 防抖更新日志 */
const LOG_DEBOUNCE_MS = 100;

/** 解析 WebSocket 消息 */
async function parseWsData(data: string | Blob | ArrayBuffer): Promise<string> {
  if (typeof data === 'string') return data;
  if (data instanceof Blob) return data.text();
  return new TextDecoder().decode(data);
}

/** 判断云主机是否运行中 */
function isVmRunning(record: any): boolean {
  const status = typeof record?.status === 'string'
    ? record.status
    : record?.status?.printableStatus || record?.status?.phase || record?.Status || '';
  return ['running'].includes(String(status).toLowerCase());
}

const HarvesterVmLogsTab: React.FC<HarvesterVmLogsTabProps> = ({
  cloudId,
  record,
  active,
}) => {
  const [logLines, setLogLines] = useState<LogLine[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [rangeValue, setRangeValue] = useState('30m');
  const [autoScroll, setAutoScroll] = useState(true);
  const [enableFormatting, setEnableFormatting] = useState(true);
  const [enableTranslation, setEnableTranslation] = useState(true); // 默认开启汉化

  const wsRef = useRef<WebSocket | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const rawBufferRef = useRef<string[]>([]);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);
  const abortControllerRef = useRef<AbortController | null>(null);

  const ns = record?.metadata?.namespace || record?.namespace;
  const vmName = record?.metadata?.name || record?.name;
  const running = isVmRunning(record);

  /** 批量处理 Buffer 中的日志并更新 State */
  const processBuffer = useCallback(() => {
    if (!mountedRef.current) return;
    
    setLogLines(prev => {
      const newLines = rawBufferRef.current.map(parseLogLine);
      rawBufferRef.current = []; // 清空 buffer
      
      const combined = [...prev, ...newLines];
      // 限制总行数
      if (combined.length > MAX_LOG_LINES) {
        return combined.slice(combined.length - MAX_LOG_LINES);
      }
      return combined;
    });
  }, []);

  /** 追加日志 */
  const appendLogs = useCallback((text: string) => {
    if (!text) return;
    // 简单按换行符分割，可能需要处理边界情况
    const lines = text.split('\n');
    for (const line of lines) {
      if (line) rawBufferRef.current.push(line);
    }
    
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    debounceTimerRef.current = setTimeout(() => {
      debounceTimerRef.current = null;
      processBuffer();
    }, LOG_DEBOUNCE_MS);
  }, [processBuffer]);

  /** 立即刷新 */
  const flushLogs = useCallback(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    processBuffer();
  }, [processBuffer]);

  const disconnect = useCallback(() => {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    if (wsRef.current) {
      try {
        wsRef.current.close(1000, '用户关闭');
      } catch {}
      wsRef.current = null;
    }
    setConnected(false);
  }, []);

  const connect = useCallback(() => {
    if (!active || !cloudId || !ns || !vmName || !running) return;

    const token = localStorage.getItem('token') || '';
    if (!token) {
      setError('未登录');
      return;
    }

    disconnect();
    setError(null);
    setLogLines([]);
    rawBufferRef.current = [];
    setLoading(true);

    const ac = new AbortController();
    abortControllerRef.current = ac;
    const opt = RANGE_OPTIONS.find((o) => o.value === rangeValue) || RANGE_OPTIONS[0];
    const rangeParam = opt.tailLines ? { tailLines: opt.tailLines } : { sinceSeconds: opt.sinceSeconds };

    fetchHarvesterVmPod(cloudId, ns, vmName, { signal: ac.signal })
      .then(({ podName }) => {
        if (!mountedRef.current || ac.signal.aborted) return;
        const origin = API_BASE_URL.startsWith('http') ? API_BASE_URL : window.location.origin;
        const url = buildLogWsUrl(origin, cloudId, ns, podName, token, rangeParam);

        const ws = new WebSocket(url);
        wsRef.current = ws;

        ws.onopen = () => {
          if (!mountedRef.current) {
            try { ws.close(); } catch {}
            return;
          }
          setConnected(true);
          setLoading(false);
          setLogLines([]);
        };

        ws.onmessage = (ev) => {
          if (!mountedRef.current) return;
          parseWsData(ev.data).then(appendLogs).catch(() => {});
        };

        ws.onclose = (ev) => {
          wsRef.current = null;
          if (mountedRef.current) {
            setConnected(false);
            setLoading(false);
            flushLogs();
            if (ev.code !== 1000 && ev.code !== 1001) {
              const reason = ev.reason || '';
              // 过滤掉因为连接关闭导致的 "aborted" 噪音，避免显示晦涩的错误
              if (reason.toLowerCase().includes('aborted')) {
                return;
              }
              setError(reason || `连接关闭 (${ev.code})`);
            }
          }
        };

        ws.onerror = () => {
          if (mountedRef.current) setError('WebSocket 连接错误');
        };
      })
      .catch((e: any) => {
        if (mountedRef.current && !ac.signal.aborted) {
          setLoading(false);
          setError(e?.message || '获取 Pod 失败');
        }
      });
  }, [active, cloudId, ns, vmName, rangeValue, running, disconnect, appendLogs, flushLogs]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      disconnect();
    };
  }, [disconnect]);

  useEffect(() => {
    if (active && cloudId && ns && vmName && running) {
      connect();
    }
    return () => disconnect();
  }, [active, cloudId, ns, vmName, running, connect, disconnect]);

  // Auto-scroll
  useEffect(() => {
    if (autoScroll && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [logLines, autoScroll]);

  const handleScroll = () => {
    if (!containerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = containerRef.current;
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 50;
    setAutoScroll(isAtBottom);
  };

  const scrollToBottom = () => {
    setAutoScroll(true);
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  };

  const handleClear = () => {
    setLogLines([]);
    rawBufferRef.current = [];
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
  };

  const handleRefresh = useCallback(() => {
    setError(null);
    connect();
  }, [connect]);

  const isInterruptedError = error && (error.includes('远程日志流已中断') || error.includes('aborted'));

  // 如果是中断错误，显示更友好的提示，而不是技术性的“流错误”
  const displayError = isInterruptedError 
    ? '远程日志流已中断' 
    : error;

  if (!ns || !vmName) {
    return (
      <div style={{ padding: 24, textAlign: 'center' }}>
        <Empty description="无法解析 VM 命名空间或名称" />
      </div>
    );
  }

  if (!running) {
    return (
      <div style={{ padding: 24, textAlign: 'center' }}>
        <Empty description="云主机未运行，无法获取实时日志。请先启动云主机。" />
      </div>
    );
  }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div
        style={{
          padding: '12px 16px',
          borderBottom: '1px solid #e8e8e8',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          background: '#fff',
          borderRadius: '8px 8px 0 0',
          flexShrink: 0,
        }}
      >
        <Space>
          <Text type="secondary" style={{ fontSize: 12 }}>
            显示范围：
          </Text>
          <Select
            size="small"
            value={rangeValue}
            onChange={setRangeValue}
            options={RANGE_OPTIONS}
            style={{ width: 130 }}
            disabled={loading}
          />
          <Checkbox 
            checked={enableFormatting} 
            onChange={(e) => setEnableFormatting(e.target.checked)}
            style={{ fontSize: 12 }}
          >
            格式化
          </Checkbox>
          <Checkbox 
            checked={enableTranslation} 
            onChange={(e) => setEnableTranslation(e.target.checked)}
            style={{ fontSize: 12 }}
          >
            汉化
          </Checkbox>
          {connected ? (
            <Text type="success" style={{ fontSize: 12 }}>
              实时
            </Text>
          ) : (error || !loading) ? (
            <Text type={isInterruptedError ? "secondary" : "danger"} style={{ fontSize: 12 }}>
              {isInterruptedError ? '已断开' : '断开链接'}
            </Text>
          ) : null}
        </Space>
        <Space>
          {!autoScroll && logLines.length > 0 && (
            <Button
              type="text"
              size="small"
              icon={<VerticalAlignBottomOutlined />}
              onClick={scrollToBottom}
            >
              滚动到底部
            </Button>
          )}
          <Button
            type="text"
            size="small"
            icon={<DeleteOutlined />}
            onClick={handleClear}
            disabled={logLines.length === 0}
          >
            清除
          </Button>
          <Button
            type="text"
            size="small"
            icon={<ReloadOutlined />}
            onClick={handleRefresh}
            loading={loading}
          >
            刷新
          </Button>
        </Space>
      </div>
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        {error && (
          <div
            style={{
              padding: 12,
              background: isInterruptedError ? '#e6f7ff' : '#fff2f0',
              borderBottom: `1px solid ${isInterruptedError ? '#91d5ff' : '#ffccc7'}`,
              color: isInterruptedError ? '#1890ff' : '#cf1322',
            }}
          >
            {displayError}
            {isInterruptedError && <span style={{ marginLeft: 8 }}>请点击上方刷新按钮重新连接。</span>}
          </div>
        )}
        <div
          ref={containerRef}
          onScroll={handleScroll}
          style={{
            flex: 1,
            margin: 0,
            padding: 16,
            overflow: 'auto',
            background: '#1e1e1e',
            color: '#d4d4d4',
            fontSize: 12,
            fontFamily: 'Monaco, Menlo, "Ubuntu Mono", monospace',
            minHeight: 200,
          }}
        >
          {loading && logLines.length === 0 ? (
            <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Spin />
            </div>
          ) : (
            <>
              {logLines.map((line, idx) => {
            if (!enableFormatting) {
              return (
                <div key={idx} style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all', marginBottom: 4 }}>
                  {line.raw}
                </div>
              );
            }

            // 格式化模式
            if (line.timestamp) {
              const icon = getLevelIcon(line.level);
              const color = getLevelColor(line.level);
              
              return (
                <div key={idx} style={{ marginBottom: 12, lineHeight: 1.6, wordBreak: 'break-all' }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start' }}>
                    <span style={{ marginRight: 8, fontSize: 14 }}>{icon}</span>
                    <div>
                      <div style={{ color: '#808080', marginBottom: 2 }}>
                        <span style={{ marginRight: 8 }}>{line.timestamp}</span>
                        {line.level && (
                          <span style={{ 
                            color: color, 
                            fontWeight: 'bold', 
                            marginRight: 8,
                            border: `1px solid ${color}`,
                            padding: '0 4px',
                            borderRadius: 2,
                            fontSize: 10
                          }}>
                            {line.level.toUpperCase()}
                          </span>
                        )}
                        {line.component && <span style={{ color: '#569cd6' }}>[{line.component}]</span>}
                      </div>
                      <div style={{ color: '#d4d4d4' }}>
                        {enableTranslation ? (
                          <span>
                            {translateLogMessage(line.message)}
                            {translateLogMessage(line.message) !== line.message && (
                              <span style={{ color: '#666', fontSize: 11, marginLeft: 8, fontStyle: 'italic' }}>
                                (原文: {line.message})
                              </span>
                            )}
                          </span>
                        ) : (
                          line.message
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            }
            
            // 无法解析的行，普通显示
            return (
              <div key={idx} style={{ marginBottom: 12, display: 'flex', alignItems: 'flex-start' }}>
                <span style={{ marginRight: 8, color: '#666' }}>❯</span>
                <span style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                  {enableTranslation ? translateLogMessage(line.message) : line.message}
                </span>
              </div>
            );
          })}
          {logLines.length === 0 && !loading && '等待日志...'}
        </>
      )}
    </div>
      </div>
    </div>
  );
};

export default HarvesterVmLogsTab;
