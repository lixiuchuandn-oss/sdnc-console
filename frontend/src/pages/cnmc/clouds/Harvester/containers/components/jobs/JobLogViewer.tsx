/**
 * Job 关联 Pod 日志查看。
 */
import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { Select, Button, Space, Alert } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { fetchHarvesterPodLog } from '../../../../../../../services/harvesterApi';

const JobLogViewer: React.FC<{
  cloudId: string;
  pods: any[];
}> = ({ cloudId, pods }) => {
  const [logs, setLogs] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [selectedPod, setSelectedPod] = useState<string>('');
  const [selectedContainer, setSelectedContainer] = useState<string>('');
  const [tailLines, setTailLines] = useState<number>(100);
  const logRef = useRef<HTMLPreElement>(null);

  // 获取所有可选择的容器
  const podOptions = useMemo(() => {
    return pods.map((pod) => ({
      label: `${pod.metadata.name} (${pod.status.phase})`,
      value: pod.metadata.name,
      containers: pod.spec.containers?.map((c: any) => c.name) || [],
    }));
  }, [pods]);

  // 当前选中 Pod 的容器列表
  const containerOptions = useMemo(() => {
    const pod = pods.find((p) => p.metadata.name === selectedPod);
    return pod?.spec.containers?.map((c: any) => ({ label: c.name, value: c.name })) || [];
  }, [pods, selectedPod]);

  // 当 Pod 列表变化时，默认选中第一个
  useEffect(() => {
    if (pods.length > 0 && !selectedPod) {
      setSelectedPod(pods[0].metadata.name);
    }
  }, [pods, selectedPod]);

  // 当 Pod 变化时，默认选中第一个容器
  useEffect(() => {
    if (containerOptions.length > 0) {
      setSelectedContainer(containerOptions[0].value);
    } else {
      setSelectedContainer('');
    }
  }, [containerOptions]);

  // 加载日志
  const loadLogs = useCallback(async () => {
    if (!selectedPod || !selectedContainer) {
      setLogs('请选择一个 Pod 和容器');
      return;
    }
    const pod = pods.find((p) => p.metadata.name === selectedPod);
    if (!pod) return;

    setLoading(true);
    try {
      const result = await fetchHarvesterPodLog(
        cloudId,
        pod.metadata.namespace,
        selectedPod,
        selectedContainer,
        tailLines,
      );
      setLogs(result || '暂无日志');
    } catch (e: any) {
      setLogs(`加载日志失败: ${e?.message || e}`);
    } finally {
      setLoading(false);
    }
  }, [cloudId, pods, selectedPod, selectedContainer, tailLines]);

  // 自动加载日志
  useEffect(() => {
    if (selectedPod && selectedContainer) {
      loadLogs();
    }
  }, [selectedPod, selectedContainer, tailLines, loadLogs]);

  // 自动滚动到底部
  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [logs]);

  if (pods.length === 0) {
    return <Alert message="暂无关联 Pod" type="info" showIcon />;
  }

  return (
    <div>
      <Space style={{ marginBottom: 16 }}>
        <Select
          placeholder="选择 Pod"
          value={selectedPod}
          onChange={setSelectedPod}
          style={{ width: 220 }}
          options={podOptions}
        />
        <Select
          placeholder="选择容器"
          value={selectedContainer}
          onChange={setSelectedContainer}
          style={{ width: 150 }}
          options={containerOptions}
          disabled={containerOptions.length === 0}
        />
        <Select
          value={tailLines}
          onChange={setTailLines}
          style={{ width: 100 }}
          options={[
            { label: '100行', value: 100 },
            { label: '500行', value: 500 },
            { label: '1000行', value: 1000 },
            { label: '2000行', value: 2000 },
          ]}
        />
        <Button onClick={loadLogs} loading={loading} icon={<ReloadOutlined />}>
          刷新
        </Button>
      </Space>
      <pre
        ref={logRef}
        style={{
          background: '#1e1e1e',
          color: '#d4d4d4',
          padding: 16,
          borderRadius: 8,
          height: 'calc(100vh - 320px)',
          overflow: 'auto',
          fontSize: 12,
          fontFamily: 'Consolas, Monaco, monospace',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-all',
        }}
      >
        {loading ? '加载中...' : logs}
      </pre>
    </div>
  );
};

export default JobLogViewer;
