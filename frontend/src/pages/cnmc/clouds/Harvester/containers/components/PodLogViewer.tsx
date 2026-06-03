/**
 * PodLogViewer.tsx
 * Pod 日志查看组件
 * 
 * 功能：
 * 1. 展示 Pod 容器日志（纯文本）
 * 2. 支持选择 container（多容器 Pod）
 * 3. 支持 tailLines 设置（默认 100，可选 500/1000/全部）
 * 4. 自动刷新（开关）
 * 5. 下载日志按钮
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Select, Button, Space, Spin, Empty, Tooltip, message } from 'antd';
import {
  DownloadOutlined,
  SyncOutlined,
  PauseCircleOutlined,
  PlayCircleOutlined,
} from '@ant-design/icons';
import { fetchHarvesterPodLog } from '../../../../../../services/harvesterApi';

export interface PodLogViewerProps {
  /** 云环境 ID */
  cloudId: string;
  /** 命名空间 */
  namespace: string;
  /** Pod 名称 */
  podName: string;
  /** 容器列表 */
  containers: string[];
  /** 组件高度（默认 400px） */
  height?: number | string;
  /** 是否显示标题栏（默认 true） */
  showHeader?: boolean;
  /** 自定义样式 */
  style?: React.CSSProperties;
  /** 日志加载完成回调 */
  onLoad?: (logs: string) => void;
  /** 日志加载错误回调 */
  onError?: (error: Error) => void;
  /** 初始 tail 行数（默认 100） */
  defaultTailLines?: number;
}

const TailLinesOptions = [
  { label: '100行', value: 100 },
  { label: '500行', value: 500 },
  { label: '1000行', value: 1000 },
  { label: '2000行', value: 2000 },
  { label: '全部', value: 0 },
];

const PodLogViewer: React.FC<PodLogViewerProps> = ({
  cloudId,
  namespace,
  podName,
  containers,
  height = 400,
  showHeader = true,
  style,
  onLoad,
  onError,
  defaultTailLines = 100,
}) => {
  // 状态
  const [logs, setLogs] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [selectedContainer, setSelectedContainer] = useState<string>('');
  const [tailLines, setTailLines] = useState<number>(defaultTailLines);
  const [autoRefresh, setAutoRefresh] = useState(false);

  // Refs
  const logRef = useRef<HTMLPreElement>(null);
  const autoRefreshTimerRef = useRef<NodeJS.Timeout | null>(null);
  const prevContainersRef = useRef<string[]>([]); // 初始化为空数组

  /**
   * 加载日志
   */
  const loadLogs = useCallback(async () => {
    if (!cloudId || !namespace || !podName) return;

    setLoading(true);
    try {
      // 单容器 Pod 不需要指定容器名，多容器 Pod 必须指定
      const containerParam = containers.length === 1 ? undefined : selectedContainer;
      // 如果是多容器但还没选择，也尝试不传（可能后端会返回默认容器的日志）
      const finalContainerParam = containerParam || (containers.length > 0 ? undefined : undefined);
      const tailLinesParam = tailLines === 0 ? undefined : tailLines;

      const result = await fetchHarvesterPodLog(
        cloudId,
        namespace,
        podName,
        finalContainerParam,
        tailLinesParam
      );

      const logContent = result || '暂无日志';
      setLogs(logContent);
      onLoad?.(logContent);
    } catch (e: any) {
      const errorMsg = `加载日志失败: ${e?.message || e}`;
      setLogs(errorMsg);
      onError?.(e);
    } finally {
      setLoading(false);
    }
  }, [cloudId, namespace, podName, selectedContainer, tailLines, containers.length, onLoad, onError]);

  /**
   * 自动滚动到底部
   */
  const scrollToBottom = useCallback(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, []);

  /**
   * 下载日志
   */
  const downloadLogs = useCallback(() => {
    if (!logs || logs === '暂无日志' || logs.startsWith('加载日志失败')) {
      message.warning('没有可下载的日志内容');
      return;
    }

    const blob = new Blob([logs], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${podName}_${selectedContainer || containers[0] || 'container'}_${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.log`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    message.success('日志下载成功');
  }, [logs, podName, selectedContainer, containers]);

  /**
   * 切换自动刷新
   */
  const toggleAutoRefresh = useCallback(() => {
    setAutoRefresh((prev) => !prev);
  }, []);

  // 容器列表变化时，设置选中项
  useEffect(() => {
    if (containers.length > 0 && !selectedContainer) {
      setSelectedContainer(containers[0]);
    }
    prevContainersRef.current = containers;
  }, [containers, selectedContainer]);

  // 加载日志 - 当容器列表准备好后自动加载
  useEffect(() => {
    if (containers.length > 0) {
      loadLogs();
    }
  }, [loadLogs, containers.length]);

  // 日志更新后自动滚动到底部
  useEffect(() => {
    scrollToBottom();
  }, [logs, scrollToBottom]);

  // 自动刷新逻辑
  useEffect(() => {
    if (autoRefresh) {
      autoRefreshTimerRef.current = setInterval(() => {
        loadLogs();
      }, 5000); // 每 5 秒刷新一次
    } else {
      if (autoRefreshTimerRef.current) {
        clearInterval(autoRefreshTimerRef.current);
        autoRefreshTimerRef.current = null;
      }
    }

    return () => {
      if (autoRefreshTimerRef.current) {
        clearInterval(autoRefreshTimerRef.current);
      }
    };
  }, [autoRefresh, loadLogs]);

  // 构建容器选项
  const containerOptions = containers.map((c) => ({ label: c, value: c }));

  // 计算高度
  const containerHeight = typeof height === 'number' ? `${height}px` : height;
  const logHeight = showHeader
    ? `calc(${containerHeight} - 48px)` // 减去 header 高度
    : containerHeight;

  return (
    <div
      className="pod-log-viewer"
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: containerHeight,
        border: '1px solid #e5e6eb',
        borderRadius: 8,
        overflow: 'hidden',
        backgroundColor: '#1e1e1e',
        ...style,
      }}
    >
      {/* Header 工具栏 */}
      {showHeader && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '8px 12px',
            backgroundColor: '#2b2b2b',
            borderBottom: '1px solid #3c3c3c',
            gap: 12,
            flexWrap: 'wrap',
          }}
        >
          {/* 左侧：Container 选择 */}
          <Space size={8}>
            {containers.length > 1 ? (
              <Select
                size="small"
                value={selectedContainer}
                onChange={setSelectedContainer}
                style={{ width: 160 }}
                placeholder="选择容器"
                options={containerOptions}
              />
            ) : containers.length === 1 ? (
              <span style={{ color: '#d4d4d4', fontSize: 12 }}>
                容器: {containers[0]}
              </span>
            ) : null}
          </Space>

          {/* 右侧：行数、自动刷新、下载、刷新 */}
          <Space size={8}>
            <Select
              size="small"
              value={tailLines}
              onChange={setTailLines}
              style={{ width: 90 }}
              options={TailLinesOptions}
            />

            <Tooltip title={autoRefresh ? '停止自动刷新' : '开启自动刷新 (5s)'}>
              <Button
                size="small"
                icon={autoRefresh ? <PauseCircleOutlined /> : <PlayCircleOutlined />}
                onClick={toggleAutoRefresh}
                type={autoRefresh ? 'primary' : 'default'}
                ghost={autoRefresh}
              >
                {autoRefresh ? '自动刷新中' : '自动刷新'}
              </Button>
            </Tooltip>

            <Tooltip title="刷新">
              <Button
                size="small"
                icon={<SyncOutlined spin={loading} />}
                onClick={loadLogs}
                loading={loading}
              />
            </Tooltip>

            <Tooltip title="下载日志">
              <Button
                size="small"
                icon={<DownloadOutlined />}
                onClick={downloadLogs}
                disabled={!logs || logs === '暂无日志'}
              />
            </Tooltip>
          </Space>
        </div>
      )}

      {/* 日志内容区域 */}
      <div style={{ position: 'relative', flex: 1, overflow: 'hidden' }}>
        {loading && !logs ? (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              height: '100%',
              color: '#d4d4d4',
            }}
          >
            <Spin size="small" style={{ marginRight: 8 }} />
            加载中...
          </div>
        ) : !logs || logs === '暂无日志' ? (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              height: '100%',
            }}
          >
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description="暂无日志"
              style={{ color: '#d4d4d4' }}
            />
          </div>
        ) : (
          <pre
            ref={logRef}
            style={{
              margin: 0,
              padding: 12,
              height: logHeight,
              overflow: 'auto',
              backgroundColor: '#1e1e1e',
              color: '#d4d4d4',
              fontSize: 12,
              fontFamily: 'Consolas, Monaco, "Courier New", monospace',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-all',
              lineHeight: 1.6,
            }}
          >
            {logs}
          </pre>
        )}

        {/* 加载中遮罩（非首次加载时显示） */}
        {loading && logs && (
          <div
            style={{
              position: 'absolute',
              top: 0,
              right: 0,
              padding: '4px 8px',
              backgroundColor: 'rgba(0, 0, 0, 0.6)',
              borderBottomLeftRadius: 4,
              color: '#d4d4d4',
              fontSize: 12,
              display: 'flex',
              alignItems: 'center',
              gap: 4,
            }}
          >
            <SyncOutlined spin />
            刷新中...
          </div>
        )}
      </div>
    </div>
  );
};

export default PodLogViewer;
