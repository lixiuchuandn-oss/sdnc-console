/**
 * ==============================================================================
 * 模块名称: Harvester 容器任务视图 (JobsSection)
 * 文件路径: frontend/src/pages/cnmc/clouds/Harvester/containers/sections/JobsSection.tsx
 * ==============================================================================
 * 
 * [功能描述]
 * 该组件负责展示和管理 Harvester/Kubernetes 任务资源，包括：
 * 1. Job 列表展示与管理
 * 2. CronJob 列表展示与管理
 * 
 * [核心逻辑]
 * 1. 任务类型切换: 通过 Segmented 切换 Job 和 CronJob
 * 2. 命名空间筛选: 支持按命名空间过滤
 * 3. 操作功能: 删除
 */

import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { Table, Tabs, Segmented, Select, Button, Tag, Space, App, Drawer, Descriptions, Input, Modal, Tooltip, Alert, Spin, Divider, Typography, Form } from 'antd';
import yaml from 'js-yaml';
import YamlEditor from '../../../../../../components/YamlEditor';
import { ReloadOutlined, ClockCircleOutlined, FileTextOutlined, ExclamationCircleOutlined, CloseCircleOutlined, InfoCircleOutlined, SearchOutlined, EditTwoTone, EyeOutlined } from '@ant-design/icons';
import PageDetailSection from '../../../../../../components/PageDetailSection';
import ResourceActionsDropdown from '../../../../../../components/ResourceActionsDropdown';
import { useTableColumnSettings } from '../../../../../../hooks/useTableColumnSettings';
import TableColumnSettingsButton from '../../../../../../components/TableColumnSettingsButton';
import {
  deleteHarvesterJob,
  deleteHarvesterCronJob,
  suspendHarvesterCronJob,
  resumeHarvesterCronJob,
  triggerHarvesterCronJob,
  fetchHarvesterJobPods,
  fetchHarvesterJobEvents,
  fetchHarvesterPodLog,
  fetchHarvesterCronJobJobs,
  createHarvesterContainerResource,
  patchHarvesterContainerResource,
} from '../../../../../../services/harvesterApi';
import { JobForm, CronJobForm } from '../components';

/**
 * Cron 宏表达式映射
 */
const CRON_MACROS: Record<string, { expression: string; label: string }> = {
  '@yearly': { expression: '0 0 1 1 *', label: '每年一次' },
  '@annually': { expression: '0 0 1 1 *', label: '每年一次' },
  '@monthly': { expression: '0 0 1 * *', label: '每月一次' },
  '@weekly': { expression: '0 0 * * 0', label: '每周一次' },
  '@daily': { expression: '0 0 * * *', label: '每天一次' },
  '@midnight': { expression: '0 0 * * *', label: '每天一次' },
  '@hourly': { expression: '0 * * * *', label: '每小时一次' },
};

/**
 * 获取宏表达式的中文说明
 */
const getMacroLabel = (expression: string): string | null => {
  const macro = CRON_MACROS[expression.trim().toLowerCase()];
  return macro ? macro.label : null;
};

type Props = {
  jobs: any[];
  cronjobs: any[];
  loading: boolean;
  namespacesOptions: string[];
  cloudId: string;
  nsValue?: string;
  onNsChange: (v?: string) => void;
  onRefresh: (force?: boolean) => void;
  imagePullSecrets?: Array<{ metadata: { name: string; namespace: string } }>;
  secretsWithCredentials?: any[];
  createDefaultNamespace?: string;
};

/**
 * 错误类型定义
 */
interface FailureInfo {
  type: 'image_pull' | 'crash_loop' | 'oom' | 'error' | 'deadline' | 'unknown';
  reason: string;
  message: string;
  exitCode?: number;
  suggestion: string;
}

/**
 * 解析 Job 失败原因
 */
const parseJobFailure = (job: any): FailureInfo | null => {
  const status = job?.status;
  const conditions = status?.conditions || [];
  
  // 找到失败条件
  const failedCondition = conditions.find((c: any) => c.type === 'Failed' && c.status === 'True');
  if (!failedCondition) return null;
  
  const reason = failedCondition.reason || '';
  const message = failedCondition.message || '';
  const msgLower = message.toLowerCase();
  
  // ImagePullBackOff / ErrImagePull
  if (msgLower.includes('imagepullbackoff') || msgLower.includes('errimagepull') || msgLower.includes('back-off pulling image')) {
    const imageMatch = message.match(/["']([^"']+:\/\/[^"']+|[\w\.\-\/]+:?[\w\.\-]*)["']/);
    const image = imageMatch ? imageMatch[1] : '镜像';
    return {
      type: 'image_pull',
      reason: '镜像拉取失败',
      message: `无法拉取镜像: ${image}`,
      suggestion: '请检查：1. 镜像名称是否正确 2. 镜像仓库是否可访问 3. 镜像仓库凭证是否配置',
    };
  }
  
  // CrashLoopBackOff
  if (msgLower.includes('crashloopbackoff')) {
    return {
      type: 'crash_loop',
      reason: '容器反复崩溃',
      message: '容器启动后反复崩溃，已进入退避重试',
      suggestion: '请检查：1. 容器启动命令是否正确 2. 应用程序配置是否有误 3. 查看容器日志获取详细错误',
    };
  }
  
  // OOMKilled
  if (msgLower.includes('oomkilled') || msgLower.includes('out of memory')) {
    return {
      type: 'oom',
      reason: '内存不足',
      message: '容器因内存不足被系统终止 (OOMKilled)',
      suggestion: '请检查：1. 增加容器内存限制 2. 优化应用程序内存使用 3. 检查是否存在内存泄漏',
    };
  }
  
  // DeadlineExceeded
  if (reason === 'DeadlineExceeded' || msgLower.includes('deadline exceeded')) {
    return {
      type: 'deadline',
      reason: '执行超时',
      message: 'Job 执行时间超过设定的活跃期限 (activeDeadlineSeconds)',
      suggestion: '请检查：1. 增加 activeDeadlineSeconds 时间限制 2. 优化任务执行效率 3. 检查任务是否陷入死循环',
    };
  }
  
  // BackoffLimitExceeded
  if (reason === 'BackoffLimitExceeded') {
    return {
      type: 'error',
      reason: '重试次数超限',
      message: message || 'Job 重试次数超过限制 (backoffLimit)',
      suggestion: '请检查：1. 查看 Pod 日志获取详细错误 2. 修复应用程序问题 3. 如需可增加 backoffLimit',
    };
  }
  
  // Exit Code Error
  const exitCodeMatch = message.match(/exit code (\d+)/i);
  if (exitCodeMatch) {
    const exitCode = parseInt(exitCodeMatch[1], 10);
    return {
      type: 'error',
      reason: '启动命令执行失败',
      message: `容器启动命令返回非零退出码: ${exitCode}`,
      exitCode,
      suggestion: '请检查：1. 启动命令是否正确 2. 应用程序依赖是否完整 3. 查看容器日志获取详细错误信息',
    };
  }
  
  // 默认错误
  return {
    type: 'unknown',
    reason: reason || '执行失败',
    message: message || 'Job 执行失败',
    suggestion: '请查看 Pod 日志获取详细的错误信息',
  };
};

/**
 * 获取错误类型颜色
 */
const getErrorColor = (type: string): string => {
  switch (type) {
    case 'image_pull': return '#ff4d4f';
    case 'crash_loop': return '#faad14';
    case 'oom': return '#722ed1';
    case 'deadline': return '#1890ff';
    case 'error': return '#ff4d4f';
    default: return '#ff4d4f';
  }
};

/**
 * 获取错误类型图标
 */
const getErrorIcon = (type: string) => {
  switch (type) {
    case 'image_pull': return <CloseCircleOutlined />;
    case 'crash_loop': return <ExclamationCircleOutlined />;
    case 'oom': return <InfoCircleOutlined />;
    case 'deadline': return <ClockCircleOutlined />;
    case 'error': return <CloseCircleOutlined />;
    default: return <CloseCircleOutlined />;
  }
};

/**
 * Job 状态渲染
 */
const renderJobStatus = (job: any) => {
  const status = job?.status;
  const conditions = status?.conditions || [];
  
  // 检查是否完成
  const completeCondition = conditions.find((c: any) => c.type === 'Complete');
  const failedCondition = conditions.find((c: any) => c.type === 'Failed');
  
  if (failedCondition && failedCondition.status === 'True') {
    const failureInfo = parseJobFailure(job);
    
    const tooltipContent = failureInfo ? (
      <div style={{ maxWidth: 350 }}>
        <div style={{ fontWeight: 'bold', marginBottom: 8, color: '#ff4d4f' }}>
          {getErrorIcon(failureInfo.type)} {failureInfo.reason}
        </div>
        <div style={{ marginBottom: 8, color: 'rgba(255,255,255,0.85)' }}>
          {failureInfo.message}
        </div>
        <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.65)', borderTop: '1px solid rgba(255,255,255,0.2)', paddingTop: 8 }}>
          💡 {failureInfo.suggestion}
        </div>
      </div>
    ) : (
      <div>
        <div style={{ fontWeight: 'bold', color: '#ff4d4f' }}>执行失败</div>
        <div style={{ color: 'rgba(255,255,255,0.85)' }}>{failedCondition.message || failedCondition.reason || '未知错误'}</div>
      </div>
    );
    
    return (
      <Tooltip 
        title={tooltipContent} 
        placement="topLeft"
        color="#1f1f1f"
        overlayStyle={{ maxWidth: 400 }}
      >
        <Tag color="red" style={{ cursor: 'pointer' }}>
          <Space size={4}>
            <ExclamationCircleOutlined />
            失败
          </Space>
        </Tag>
      </Tooltip>
    );
  }
  
  if (completeCondition && completeCondition.status === 'True') {
    return <Tag color="green">成功</Tag>;
  }
  
  // 检查是否正在运行
  const active = status?.active || 0;
  if (active > 0) {
    return <Tag color="blue">运行中</Tag>;
  }
  
  // 检查是否正在终止
  if (job?.metadata?.deletionTimestamp) {
    return <Tag color="orange">终止中</Tag>;
  }
  
  return <Tag color="default">等待中</Tag>;
};

/**
 * CronJob 状态渲染
 */
const renderCronJobStatus = (cronjob: any) => {
  const spec = cronjob?.spec;
  
  // 检查是否暂停
  if (spec?.suspend) {
    return <Tag color="orange">已暂停</Tag>;
  }
  
  return <Tag color="green">活跃</Tag>;
};

/**
 * 格式化时间
 */
const formatTime = (timestamp?: string) => {
  if (!timestamp) return '-';
  try {
    const date = new Date(timestamp);
    return date.toLocaleString('zh-CN');
  } catch {
    return timestamp;
  }
};

/**
 * 计算运行时长
 */
const calculateAge = (timestamp?: string) => {
  if (!timestamp) return '-';
  try {
    const created = new Date(timestamp).getTime();
    const now = Date.now();
    const diff = now - created;
    
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    
    if (days > 0) return `${days}d${hours}h`;
    if (hours > 0) return `${hours}h${minutes}m`;
    return `${minutes}m`;
  } catch {
    return '-';
  }
};

/**
 * Job 失败详情组件
 */
const JobFailureDetails: React.FC<{ job: any }> = ({ job }) => {
  const failureInfo = parseJobFailure(job);
  const status = job?.status || {};
  const conditions = status?.conditions || [];
  const failedCondition = conditions.find((c: any) => c.type === 'Failed' && c.status === 'True');
  
  if (!failedCondition && !failureInfo) return null;
  
  // 提取原始 condition 信息
  const rawReason = failedCondition?.reason || '';
  const rawMessage = failedCondition?.message || '';
  
  return (
    <>
      <Divider orientation="left" style={{ color: '#ff4d4f' }}>
        <Space>
          <CloseCircleOutlined />
          失败原因
        </Space>
      </Divider>
      
      {failureInfo ? (
        <Alert
          type="error"
          showIcon
          icon={getErrorIcon(failureInfo.type)}
          message={
            <Space direction="vertical" size={4} style={{ width: '100%' }}>
              <span style={{ fontWeight: 'bold', fontSize: 14 }}>{failureInfo.reason}</span>
              <span style={{ color: 'rgba(0,0,0,0.65)' }}>{failureInfo.message}</span>
              {failureInfo.exitCode !== undefined && (
                <Tag color="red">退出码: {failureInfo.exitCode}</Tag>
              )}
            </Space>
          }
          description={
            <div style={{ marginTop: 12, padding: 12, background: '#f6ffed', borderRadius: 4, border: '1px solid #b7eb8f' }}>
              <div style={{ fontWeight: 'bold', color: '#52c41a', marginBottom: 8 }}>
                <InfoCircleOutlined /> 建议解决方案
              </div>
              <div style={{ color: 'rgba(0,0,0,0.65)', lineHeight: 1.8 }}>
                {failureInfo.suggestion}
              </div>
            </div>
          }
          style={{ marginBottom: 16 }}
        />
      ) : (
        <Alert
          type="error"
          showIcon
          message={rawReason || '执行失败'}
          description={rawMessage || 'Job 执行失败，请查看 Pod 日志获取详细信息'}
          style={{ marginBottom: 16 }}
        />
      )}
      
      {/* 原始条件信息（可折叠） */}
      {failedCondition && (
        <div style={{ marginTop: 8, padding: 12, background: '#f5f5f5', borderRadius: 4 }}>
          <div style={{ fontWeight: 'bold', marginBottom: 8, color: '#666' }}>原始状态信息</div>
          <Descriptions column={1} size="small" bordered>
            <Descriptions.Item label="条件类型">{failedCondition.type}</Descriptions.Item>
            <Descriptions.Item label="状态">{failedCondition.status}</Descriptions.Item>
            <Descriptions.Item label="原因">{failedCondition.reason || '-'}</Descriptions.Item>
            <Descriptions.Item label="消息" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
              <div style={{ maxHeight: 150, overflow: 'auto' }}>{failedCondition.message || '-'}</div>
            </Descriptions.Item>
            <Descriptions.Item label="最后转换时间">{formatTime(failedCondition.lastTransitionTime)}</Descriptions.Item>
          </Descriptions>
        </div>
      )}
    </>
  );
};

/**
 * Job 日志查看组件
 */
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

/**
 * Job 事件列表组件
 */
const JobEventsViewer: React.FC<{
  job: any;
  pods: any[];
}> = ({ job, pods }) => {
  const [jobEvents, setJobEvents] = useState<any[]>([]);
  const [podEvents, setPodEvents] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!job) return;

    const loadEvents = async () => {
      setLoading(true);
      try {
        // 从 job 的 status.conditions 中提取事件信息
        const conditions = job.status?.conditions || [];
        const eventsFromConditions = conditions.map((c: any, idx: number) => ({
          key: `job-${idx}`,
          type: c.status === 'True' ? 'Normal' : 'Warning',
          reason: c.type,
          message: c.message || '-',
          count: 1,
          lastTimestamp: c.lastTransitionTime || c.lastProbeTime,
          source: 'Job',
        }));
        setJobEvents(eventsFromConditions);

        // 从 pods 的 status.conditions 中提取事件信息
        const allPodEvents: any[] = [];
        pods.forEach((pod, podIdx) => {
          const conditions = pod.status?.conditions || [];
          conditions.forEach((c: any, idx: number) => {
            allPodEvents.push({
              key: `pod-${podIdx}-${idx}`,
              type: c.status === 'True' ? 'Normal' : 'Warning',
              reason: c.type,
              message: c.message || '-',
              count: 1,
              lastTimestamp: c.lastTransitionTime || c.lastProbeTime,
              source: `Pod: ${pod.metadata.name}`,
            });
          });

          // 添加容器状态相关事件
          const containerStatuses = pod.status?.containerStatuses || [];
          containerStatuses.forEach((cs: any) => {
            if (cs.state?.waiting?.reason) {
              allPodEvents.push({
                key: `pod-${podIdx}-container-${cs.name}`,
                type: 'Warning',
                reason: cs.state.waiting.reason,
                message: cs.state.waiting.message || '-',
                count: cs.restartCount || 1,
                lastTimestamp: pod.status.startTime,
                source: `Pod: ${pod.metadata.name}/${cs.name}`,
              });
            }
            if (cs.state?.terminated?.reason) {
              allPodEvents.push({
                key: `pod-${podIdx}-term-${cs.name}`,
                type: cs.state.terminated.exitCode === 0 ? 'Normal' : 'Warning',
                reason: cs.state.terminated.reason,
                message: `Exit Code: ${cs.state.terminated.exitCode}`,
                count: 1,
                lastTimestamp: cs.state.terminated.finishedAt,
                source: `Pod: ${pod.metadata.name}/${cs.name}`,
              });
            }
          });
        });
        setPodEvents(allPodEvents);
      } finally {
        setLoading(false);
      }
    };

    loadEvents();
  }, [job, pods]);

  const allEvents = useMemo(() => {
    return [...jobEvents, ...podEvents].sort((a, b) => {
      const timeA = new Date(a.lastTimestamp || 0).getTime();
      const timeB = new Date(b.lastTimestamp || 0).getTime();
      return timeB - timeA; // 倒序
    });
  }, [jobEvents, podEvents]);

  const columns = [
    {
      title: '类型',
      dataIndex: 'type',
      width: 80,
      render: (v: string) => <Tag color={v === 'Normal' ? 'blue' : 'red'}>{v}</Tag>,
    },
    {
      title: '原因',
      dataIndex: 'reason',
      width: 130,
    },
    {
      title: '消息',
      dataIndex: 'message',
      ellipsis: true,
      render: (v: string) => <span style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{v}</span>,
    },
    {
      title: '来源',
      dataIndex: 'source',
      width: 180,
      render: (v: string) => <Tag>{v}</Tag>,
    },
    {
      title: '时间',
      dataIndex: 'lastTimestamp',
      width: 160,
      render: formatTime,
    },
  ];

  return (
    <Spin spinning={loading}>
      <div style={{ marginBottom: 8, color: '#666', fontSize: 12 }}>
        显示 Job 和关联 Pod 的状态变更事件
      </div>
      <Table
        dataSource={allEvents}
        columns={columns}
        pagination={false}
        locale={{ emptyText: '暂无事件' }}
        scroll={{ y: 'calc(100vh - 300px)' }}
      />
    </Spin>
  );
};

/**
 * Job 详情抽屉组件
 */
const JobDetailDrawer: React.FC<{
  job: any;
  visible: boolean;
  cloudId: string;
  onClose: () => void;
}> = ({ job, visible, cloudId, onClose }) => {
  const [pods, setPods] = useState<any[]>([]);
  const [podsLoading, setPodsLoading] = useState(false);
  const [activeTab, setActiveTab] = useState('overview');

  // 加载关联 Pod
  useEffect(() => {
    if (visible && job && cloudId) {
      const loadPods = async () => {
        setPodsLoading(true);
        try {
          const result = await fetchHarvesterJobPods(
            cloudId,
            job.metadata.namespace,
            job.metadata.name,
          );
          setPods(result?.data?.items || []);
        } catch (e: any) {
          console.error('加载 Job Pods 失败:', e);
          setPods([]);
        } finally {
          setPodsLoading(false);
        }
      };
      loadPods();
    }
  }, [visible, job, cloudId]);

  // 重置 Tab 当抽屉关闭时
  useEffect(() => {
    if (!visible) {
      setActiveTab('overview');
      setPods([]);
    }
  }, [visible]);

  if (!job) return null;

  const metadata = job?.metadata || {};
  const spec = job?.spec || {};
  const status = job?.status || {};

  // 获取失败原因
  const getFailureReason = () => {
    const conditions = status.conditions || [];
    const failedCondition = conditions.find((c: any) => c.type === 'Failed' && c.status === 'True');
    if (failedCondition?.message) {
      return failedCondition.message;
    }
    return null;
  };

  const failureReason = getFailureReason();

  const tabItems = [
    {
      key: 'overview',
      label: '概览',
      children: (
        <div>
          {failureReason && (
            <Alert
              message="Job 执行失败"
              description={failureReason}
              type="error"
              showIcon
              style={{ marginBottom: 16 }}
            />
          )}
          <Descriptions column={2} bordered size="small">
            <Descriptions.Item label="名称">{metadata.name}</Descriptions.Item>
            <Descriptions.Item label="命名空间">{metadata.namespace}</Descriptions.Item>
            <Descriptions.Item label="状态">{renderJobStatus(job)}</Descriptions.Item>
            <Descriptions.Item label="运行时长">{calculateAge(metadata.creationTimestamp)}</Descriptions.Item>
            <Descriptions.Item label="完成数">{status.succeeded || 0}</Descriptions.Item>
            <Descriptions.Item label="失败数">{status.failed || 0}</Descriptions.Item>
            <Descriptions.Item label="活跃数">{status.active || 0}</Descriptions.Item>
            <Descriptions.Item label="并行数">{spec.parallelism || 1}</Descriptions.Item>
            <Descriptions.Item label="关联 Pod" span={2}>
              {podsLoading ? (
                <Spin size="small" />
              ) : pods.length > 0 ? (
                <Space size={4} wrap>
                  {pods.map((pod) => (
                    <Tag key={pod.metadata.name} color="blue">
                      {pod.metadata.name} ({pod.status.phase})
                    </Tag>
                  ))}
                </Space>
              ) : (
                <span style={{ color: '#999' }}>暂无关联 Pod</span>
              )}
            </Descriptions.Item>
            <Descriptions.Item label="创建时间" span={2}>{formatTime(metadata.creationTimestamp)}</Descriptions.Item>
            <Descriptions.Item label="完成时间" span={2}>{formatTime(status.completionTime)}</Descriptions.Item>
            <Descriptions.Item label="开始时间" span={2}>{formatTime(status.startTime)}</Descriptions.Item>
            <Descriptions.Item label="标签" span={2}>
              <Space size={4} wrap>
                {Object.entries(metadata.labels || {}).map(([k, v]) => (
                  <Tag key={k}>{k}={String(v)}</Tag>
                ))}
              </Space>
            </Descriptions.Item>
          </Descriptions>
        </div>
      ),
    },
    {
      key: 'logs',
      label: (
        <span>
          <FileTextOutlined style={{ marginRight: 4 }} />
          日志
        </span>
      ),
      children: <JobLogViewer cloudId={cloudId} pods={pods} />,
    },
    {
      key: 'events',
      label: '事件',
      children: <JobEventsViewer job={job} pods={pods} />,
    },
  ];

  return (
    <Drawer
      title={`Job 详情: ${metadata.name}`}
      placement="right"
      width={800}
      open={visible}
      onClose={onClose}
    >
      <Tabs activeKey={activeTab} onChange={setActiveTab} items={tabItems} />
    </Drawer>
  );
};

/**
 * CronJob 关联 Job 列表组件
 */
const CronJobJobsList: React.FC<{
  cloudId: string;
  cronjob: any;
}> = ({ cloudId, cronjob }) => {
  const [jobs, setJobs] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const { message } = App.useApp();

  useEffect(() => {
    if (!cronjob) return;
    
    const loadJobs = async () => {
      setLoading(true);
      try {
        const result = await fetchHarvesterCronJobJobs(
          cloudId,
          cronjob.metadata.namespace,
          cronjob.metadata.name
        );
        setJobs(result?.data?.items || []);
      } catch (e: any) {
        message.error('加载关联 Job 失败');
      } finally {
        setLoading(false);
      }
    };

    loadJobs();
  }, [cloudId, cronjob, message]);

  if (loading) return <Spin />;
  
  if (jobs.length === 0) {
    return <Alert message="暂无关联的 Job" type="info" showIcon />;
  }

  return (
    <Table
      dataSource={jobs}
      rowKey={(r) => r.metadata?.name}
      columns={[
        { title: '名称', dataIndex: ['metadata', 'name'], key: 'name' },
        { title: '状态', key: 'status', render: (_, record) => renderJobStatus(record) },
        { title: '创建时间', dataIndex: ['metadata', 'creationTimestamp'], key: 'time', render: formatTime },
      ]}
      pagination={false}
    />
  );
};

/**
 * CronJob 详情抽屉组件
 */
const { Text } = Typography;

const CronJobDetailDrawer: React.FC<{
  cronjob: any;
  visible: boolean;
  onClose: () => void;
  cloudId: string;
}> = ({ cronjob, visible, onClose, cloudId }) => {
  if (!cronjob) return null;
  
  const metadata = cronjob?.metadata || {};
  const spec = cronjob?.spec || {};
  const status = cronjob?.status || {};

  const schedule = spec.schedule || '';
  const macroLabel = getMacroLabel(schedule);
  const macroInfo = CRON_MACROS[schedule.trim().toLowerCase()];

  const tabItems = [
    {
      key: 'overview',
      label: '概览',
      children: (
        <Descriptions column={2} bordered size="small">
          <Descriptions.Item label="名称">{metadata.name}</Descriptions.Item>
          <Descriptions.Item label="命名空间">{metadata.namespace}</Descriptions.Item>
          <Descriptions.Item label="状态">{renderCronJobStatus(cronjob)}</Descriptions.Item>
          <Descriptions.Item label="运行时长">{calculateAge(metadata.creationTimestamp)}</Descriptions.Item>
          <Descriptions.Item label="调度计划" span={2}>
            <Space direction="vertical">
              <Tag icon={<ClockCircleOutlined />}>{schedule}</Tag>
              {macroLabel && (
                <div>
                  <Tag color="orange">宏表达式</Tag>
                  <Text type="secondary"> {macroLabel}</Text>
                </div>
              )}
              {macroInfo && (
                <div style={{ fontSize: 12, color: '#888' }}>
                  实际表达式：<code>{macroInfo.expression}</code>
                </div>
              )}
            </Space>
          </Descriptions.Item>
          <Descriptions.Item label="并发策略">{spec.concurrencyPolicy || 'Allow'}</Descriptions.Item>
          <Descriptions.Item label="暂停">{spec.suspend ? '是' : '否'}</Descriptions.Item>
          <Descriptions.Item label="成功历史限制">{spec.successfulJobsHistoryLimit || 3}</Descriptions.Item>
          <Descriptions.Item label="失败历史限制">{spec.failedJobsHistoryLimit || 1}</Descriptions.Item>
          <Descriptions.Item label="上次调度时间">{formatTime(status.lastScheduleTime)}</Descriptions.Item>
          <Descriptions.Item label="创建时间">{formatTime(metadata.creationTimestamp)}</Descriptions.Item>
          <Descriptions.Item label="标签" span={2}>
            <Space size={4} wrap>
              {Object.entries(metadata.labels || {}).map(([k, v]) => (
                <Tag key={k}>{k}={String(v)}</Tag>
              ))}
            </Space>
          </Descriptions.Item>
        </Descriptions>
      ),
    },
    {
      key: 'jobs',
      label: '关联 Job',
      children: <CronJobJobsList cloudId={cloudId} cronjob={cronjob} />,
    },
  ];
  
  return (
    <Drawer
      title={`CronJob 详情: ${metadata.name}`}
      placement="right"
      width={800}
      open={visible}
      onClose={onClose}
    >
      <Tabs items={tabItems} defaultActiveKey="overview" />
    </Drawer>
  );
};

/**
 * Job 表格组件
 */
const JobTable: React.FC<{
  data: any[];
  loading: boolean;
  cloudId: string;
  onRefresh: (force?: boolean) => void;
  namespacesOptions: string[];
  nsValue?: string;
  onNsChange: (v?: string) => void;
  imagePullSecrets: Array<{ metadata: { name: string; namespace: string } }>;
  secretsWithCredentials?: any[];
  defaultNamespace?: string;
  createModalVisible: boolean;
  onCreateModalChange: (visible: boolean) => void;
}> = ({ data, loading, cloudId, onRefresh, namespacesOptions, nsValue, onNsChange, imagePullSecrets, secretsWithCredentials, defaultNamespace, createModalVisible, onCreateModalChange }) => {
  const { modal, message } = App.useApp();
  const [keyword, setKeyword] = useState('');
  const [selectedKeys, setSelectedKeys] = useState<React.Key[]>([]);
  const [detailVisible, setDetailVisible] = useState(false);
  const [currentJob, setCurrentJob] = useState<any>(null);
  const [aliasModalVisible, setAliasModalVisible] = useState(false);
  const [aliasRecord, setAliasRecord] = useState<any>(null);
  const [aliasSubmitting, setAliasSubmitting] = useState(false);
  const [aliasForm] = Form.useForm<{ alias?: string }>();
  const [yamlModalVisible, setYamlModalVisible] = useState(false);
  const [yamlContent, setYamlContent] = useState('');

  const apiPath = '/apis/batch/v1/jobs';
  
  // 过滤并排序数据（按创建时间倒序）
  const filteredData = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    const filtered = data.filter((item: any) => {
      const name = item?.metadata?.name || '';
      const ns = item?.metadata?.namespace || '';
      if (kw && !name.toLowerCase().includes(kw) && !ns.toLowerCase().includes(kw)) {
        return false;
      }
      return true;
    });
    
    // 按创建时间倒序排列（最新的在最上面）
    return filtered.sort((a: any, b: any) => {
      const timeA = new Date(a?.metadata?.creationTimestamp || 0).getTime();
      const timeB = new Date(b?.metadata?.creationTimestamp || 0).getTime();
      return timeB - timeA;
    });
  }, [data, keyword]);
  
  // 查看详情
  const handleViewDetail = useCallback((job: any) => {
    setCurrentJob(job);
    setDetailVisible(true);
  }, []);
  
  // 删除操作
  const handleDelete = useCallback(async (job: any) => {
    const namespace = job?.metadata?.namespace;
    const name = job?.metadata?.name;
    
    try {
      await deleteHarvesterJob(cloudId, namespace, name);
      message.success('删除成功');
      onRefresh();
    } catch (e: any) {
      message.error(e?.message || '删除失败');
    }
  }, [cloudId, message, onRefresh]);

  // 重试操作：删除后重新创建
  const handleRetry = useCallback(async (job: any) => {
    const namespace = job?.metadata?.namespace;
    const name = job?.metadata?.name;
    
    try {
      // 1. 先删除失败的 Job
      await deleteHarvesterJob(cloudId, namespace, name);
      
      // 2. 准备新的 Job 配置（移除不需要的字段）
      const newJob = {
        apiVersion: 'batch/v1',
        kind: 'Job',
        metadata: {
          name: name,
          namespace: namespace,
          labels: job?.metadata?.labels,
        },
        spec: job?.spec,
      };
      
      // 3. 重新创建
      await createHarvesterContainerResource(
        cloudId,
        '/apis/batch/v1/jobs',
        namespace,
        newJob
      );
      
      message.success('Job 已重新创建');
      onRefresh();
    } catch (e: any) {
      message.error(e?.message || '重试失败');
    }
  }, [cloudId, message, onRefresh]);

  // 别名编辑
  const handleOpenAliasModal = useCallback((record: any) => {
    const currentAlias = record?.metadata?.annotations?.['tower.io/alias'] || '';
    setAliasRecord(record);
    setAliasModalVisible(true);
    aliasForm.setFieldsValue({ alias: String(currentAlias || '') });
  }, [aliasForm]);

  const handleSubmitAlias = useCallback(async (nextAliasRaw?: string) => {
    if (!aliasRecord) return false;
    const ns = aliasRecord?.metadata?.namespace;
    const name = aliasRecord?.metadata?.name;
    if (!ns || !name) {
      message.error('未能解析资源命名空间或名称');
      return false;
    }

    const next = String(nextAliasRaw || '').trim();
    const prev = String(aliasRecord?.metadata?.annotations?.['tower.io/alias'] || '').trim();
    if (next === prev) {
      setAliasModalVisible(false);
      return true;
    }

    const hasAnnotations = !!aliasRecord?.metadata?.annotations;
    const hasPrev = !!aliasRecord?.metadata?.annotations?.['tower.io/alias'];
    const aliasPath = '/metadata/annotations/tower.io~1alias';

    const patchBody: any[] = [];
    if (!next) {
      if (hasPrev) patchBody.push({ op: 'remove', path: aliasPath });
    } else {
      if (!hasAnnotations) {
        patchBody.push({ op: 'add', path: '/metadata/annotations', value: { 'tower.io/alias': next } });
      } else {
        patchBody.push({ op: 'add', path: aliasPath, value: next });
      }
    }

    if (patchBody.length === 0) {
      setAliasModalVisible(false);
      return true;
    }

    setAliasSubmitting(true);
    try {
      await patchHarvesterContainerResource(cloudId, apiPath, ns, name, patchBody);
      message.success(next ? '名称修改成功' : '已清空别名');
      setAliasModalVisible(false);
      setAliasRecord(null);
      aliasForm.resetFields();
      onRefresh();
      return true;
    } catch (e: any) {
      console.error(e);
      message.error(e?.message || '名称修改失败');
      return false;
    } finally {
      setAliasSubmitting(false);
    }
  }, [aliasRecord, apiPath, cloudId, message, onRefresh, aliasForm]);

  // 查看 YAML
  const handleViewYaml = useCallback((record: any) => {
    try {
      const yamlStr = yaml.dump(record, { indent: 2, lineWidth: -1, noRefs: true });
      setYamlContent(yamlStr);
      setYamlModalVisible(true);
    } catch (e: any) {
      message.error('生成 YAML 失败: ' + e.message);
    }
  }, [message]);

  // 表格列定义
  const columns = useMemo(() => [
    {
      title: '名称',
      key: 'name',
      width: 180,
      ellipsis: true,
      render: (_: any, record: any) => {
        const alias = record?.metadata?.annotations?.['tower.io/alias'];
        const id = record?.metadata?.name || '';
        const hasAlias = !!alias;

        return (
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <a onClick={() => handleViewDetail(record)} style={{ color: '#1890ff' }}>{hasAlias ? alias : id}</a>
            <Tooltip title={hasAlias ? '修改别名' : '设置别名'}>
              <Button
                type="text"
                size="small"
                icon={<EditTwoTone />}
                onClick={(e) => {
                  e.stopPropagation();
                  handleOpenAliasModal(record);
                }}
              />
            </Tooltip>
          </span>
        );
      },
    },
    {
      title: 'ID',
      dataIndex: ['metadata', 'name'],
      key: 'id',
      width: 200,
      ellipsis: true,
      render: (id: string) => <span style={{ color: '#888', fontSize: 12 }}>{id}</span>,
    },
    {
      title: '命名空间',
      dataIndex: ['metadata', 'namespace'],
      key: 'namespace',
      width: 120,
      ellipsis: true,
      render: (ns: string) => <Tag>{ns}</Tag>,
    },
    {
      title: '状态',
      key: 'status',
      width: 100,
      render: (_: any, record: any) => renderJobStatus(record),
    },
    {
      title: '完成数',
      key: 'completions',
      width: 100,
      render: (_: any, record: any) => {
        const succeeded = record?.status?.succeeded || 0;
        const completions = record?.spec?.completions || succeeded;
        return `${succeeded}/${completions}`;
      },
    },
    {
      title: '运行时长',
      key: 'age',
      width: 100,
      render: (_: any, record: any) => calculateAge(record?.metadata?.creationTimestamp),
    },
    {
      title: '创建时间',
      dataIndex: ['metadata', 'creationTimestamp'],
      key: 'creationTimestamp',
      width: 180,
      render: formatTime,
    },
    {
      title: '操作',
      key: 'actions',
      width: 120,
      render: (_: any, record: any) => {
        // 检查 Job 是否失败
        const conditions = record?.status?.conditions || [];
        const failedCondition = conditions.find((c: any) => c.type === 'Failed' && c.status === 'True');
        const isFailed = !!failedCondition || (record?.status?.failed > 0);
        
        const items = [
          {
            key: 'detail',
            label: '详情',
            onClick: () => handleViewDetail(record),
          },
          {
            key: 'yaml',
            label: '查看 YAML',
            icon: <EyeOutlined />,
            onClick: () => handleViewYaml(record),
          },
          // 失败状态显示重试按钮
          ...(isFailed ? [{
            key: 'retry',
            label: '重试',
            onClick: () => {
              modal.confirm({
                title: '确认重试',
                content: `确定要重新创建 Job "${record?.metadata?.name}" 吗？这将先删除原 Job 并使用相同配置重新创建。`,
                onOk: () => handleRetry(record),
              });
            },
          }] : []),
          {
            key: 'delete',
            label: '删除',
            danger: true,
            onClick: () => {
              modal.confirm({
                title: '确认删除',
                content: `确定要删除 Job "${record?.metadata?.name}" 吗？`,
                okType: 'danger',
                onOk: () => handleDelete(record),
              });
            },
          },
        ];
        
        return <ResourceActionsDropdown items={items} buttonProps={{ className: 'row-actions-trigger' }} />;
      },
    },
  ], [handleViewDetail, handleViewYaml, handleOpenAliasModal, handleDelete, modal]);
  
  // 使用列设置 Hook
  const { displayColumns: tableColumns } = useTableColumnSettings(
    columns,
    'harvester-containers-jobs',
  );
  
  return (
    <div>
      <div className="page-toolbar">
        <div className="toolbar-container">
          <Input
            className="toolbar-search"
            allowClear
            placeholder="名称/命名空间"
            suffix={<SearchOutlined style={{ color: 'rgba(0,0,0,.45)' }} />}
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
          />
          <Select
            className="toolbar-filter-sm"
            placeholder="筛选命名空间"
            allowClear
            showSearch
            optionFilterProp="label"
            value={nsValue || undefined}
            onChange={onNsChange}
            options={namespacesOptions.map((ns) => ({ label: ns, value: ns }))}
          />
          <button
            type="button"
            className="toolbar-reset-btn"
            onClick={() => {
              setKeyword('');
              onNsChange(undefined);
            }}
          >
            重置
          </button>
        </div>
        <div className="toolbar-actions">
          <Button type="primary" onClick={() => onCreateModalChange(true)}>
            创建 Job
          </Button>
          <TableColumnSettingsButton
            allColumns={columns}
            settingsKey="harvester-containers-jobs"
          />
          <Tooltip title="刷新">
            <Button type="default" icon={<ReloadOutlined />} onClick={() => onRefresh()} />
          </Tooltip>
        </div>
      </div>
      
      <Table
        className="std-table"
        bordered={false}
        rowKey={(record) => `${record?.metadata?.namespace}/${record?.metadata?.name}`}
        columns={tableColumns}
        dataSource={filteredData}
        loading={loading}
        scroll={{ x: 'max-content' }}
        pagination={{
          size: 'small',
          showTotal: (total) => `共 ${total} 条`,
        }}
        rowSelection={{
          selectedRowKeys: selectedKeys,
          onChange: setSelectedKeys,
        }}
      />
      
      {/* Job 详情抽屉 */}
      <JobDetailDrawer
        job={currentJob}
        visible={detailVisible}
        cloudId={cloudId}
        onClose={() => {
          setDetailVisible(false);
          setCurrentJob(null);
        }}
      />
      
      {/* 别名编辑 Modal */}
      <Modal
        title="名称修改"
        open={aliasModalVisible}
        centered
        okText="保存"
        cancelText="取消"
        confirmLoading={aliasSubmitting}
        onOk={async () => {
          try {
            const values = await aliasForm.validateFields();
            await handleSubmitAlias(values?.alias);
          } catch {}
        }}
        onCancel={() => {
          if (aliasSubmitting) return;
          setAliasModalVisible(false);
          setAliasRecord(null);
          aliasForm.resetFields();
        }}
      >
        <Form form={aliasForm} layout="vertical">
          <Form.Item
            name="alias"
            label="名称"
            rules={[
              { max: 64, message: '别名最长 64 个字符' },
              { required: true, message: '请输入名称' },
            ]}
          >
            <Input
              autoFocus
              placeholder="请输入名称（留空则清空别名）"
              maxLength={64}
              onPressEnter={async () => {
                if (aliasSubmitting) return;
                try {
                  const values = await aliasForm.validateFields();
                  await handleSubmitAlias(values?.alias);
                } catch {}
              }}
            />
          </Form.Item>
        </Form>
      </Modal>

      {/* YAML 查看 Modal */}
      <Modal
        title="YAML 查看"
        open={yamlModalVisible}
        onCancel={() => setYamlModalVisible(false)}
        footer={null}
        width={800}
      >
        <YamlEditor
          value={yamlContent}
          onChange={() => {}}
          maxHeight={500}
          readOnly
        />
      </Modal>
      
      {/* 创建 Job Modal */}
      <Modal
        title="创建 Job"
        open={createModalVisible}
        onCancel={() => onCreateModalChange(false)}
        footer={null}
        width={800}
        destroyOnClose
      >
        <JobForm
          cloudId={cloudId}
          namespacesOptions={namespacesOptions}
          imagePullSecrets={imagePullSecrets}
          secretsWithCredentials={secretsWithCredentials}
          onSuccess={() => {
            onCreateModalChange(false);
            onRefresh(true);
          }}
          onCancel={() => onCreateModalChange(false)}
          defaultNamespace={defaultNamespace}
        />
      </Modal>
    </div>
  );
};

/**
 * CronJob 表格组件
 */
const CronJobTable: React.FC<{
  data: any[];
  loading: boolean;
  cloudId: string;
  onRefresh: (force?: boolean) => void;
  namespacesOptions: string[];
  nsValue?: string;
  onNsChange: (v?: string) => void;
  imagePullSecrets: Array<{ metadata: { name: string; namespace: string } }>;
  secretsWithCredentials?: any[];
  defaultNamespace?: string;
  createModalVisible: boolean;
  onCreateModalChange: (visible: boolean) => void;
}> = ({ data, loading, cloudId, onRefresh, namespacesOptions, nsValue, onNsChange, imagePullSecrets, secretsWithCredentials, defaultNamespace, createModalVisible, onCreateModalChange }) => {
  const { modal, message } = App.useApp();
  const [keyword, setKeyword] = useState('');
  const [selectedKeys, setSelectedKeys] = useState<React.Key[]>([]);
  const [detailVisible, setDetailVisible] = useState(false);
  const [currentCronJob, setCurrentCronJob] = useState<any>(null);
  const [aliasModalVisible, setAliasModalVisible] = useState(false);
  const [aliasRecord, setAliasRecord] = useState<any>(null);
  const [aliasSubmitting, setAliasSubmitting] = useState(false);
  const [aliasForm] = Form.useForm<{ alias?: string }>();
  const [yamlModalVisible, setYamlModalVisible] = useState(false);
  const [yamlContent, setYamlContent] = useState('');

  const apiPath = '/apis/batch/v1/cronjobs';
  
  // 过滤并排序数据
  const filteredData = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    const filtered = data.filter((item: any) => {
      const name = item?.metadata?.name || '';
      const ns = item?.metadata?.namespace || '';
      if (kw && !name.toLowerCase().includes(kw) && !ns.toLowerCase().includes(kw)) {
        return false;
      }
      return true;
    });
    
    // 按创建时间倒序排列（最新的在最上面）
    return filtered.sort((a: any, b: any) => {
      const timeA = new Date(a?.metadata?.creationTimestamp || 0).getTime();
      const timeB = new Date(b?.metadata?.creationTimestamp || 0).getTime();
      return timeB - timeA;
    });
  }, [data, keyword]);
  
  // 查看详情
  const handleViewDetail = useCallback((cronjob: any) => {
    setCurrentCronJob(cronjob);
    setDetailVisible(true);
  }, []);
  
  // 删除操作
  const handleDelete = useCallback(async (cronjob: any) => {
    const namespace = cronjob?.metadata?.namespace;
    const name = cronjob?.metadata?.name;
    
    try {
      await deleteHarvesterCronJob(cloudId, namespace, name);
      message.success('删除成功');
      onRefresh();
    } catch (e: any) {
      message.error(e?.message || '删除失败');
    }
  }, [cloudId, message, onRefresh]);
  
  // 暂停 CronJob
  const handleSuspend = useCallback(async (cronjob: any) => {
    const namespace = cronjob?.metadata?.namespace;
    const name = cronjob?.metadata?.name;
    
    try {
      await suspendHarvesterCronJob(cloudId, namespace, name);
      message.success('已暂停');
      onRefresh();
    } catch (e: any) {
      message.error(e?.message || '暂停失败');
    }
  }, [cloudId, message, onRefresh]);
  
  // 恢复 CronJob
  const handleResume = useCallback(async (cronjob: any) => {
    const namespace = cronjob?.metadata?.namespace;
    const name = cronjob?.metadata?.name;
    
    try {
      await resumeHarvesterCronJob(cloudId, namespace, name);
      message.success('已恢复');
      onRefresh();
    } catch (e: any) {
      message.error(e?.message || '恢复失败');
    }
  }, [cloudId, message, onRefresh]);
  
  // 手动触发 CronJob
  const handleTrigger = useCallback(async (cronjob: any) => {
    const namespace = cronjob?.metadata?.namespace;
    const name = cronjob?.metadata?.name;
    
    try {
      await triggerHarvesterCronJob(cloudId, namespace, name);
      message.success('已触发执行');
      onRefresh();
    } catch (e: any) {
      message.error(e?.message || '触发失败');
    }
  }, [cloudId, message, onRefresh]);

  // 别名编辑
  const handleOpenAliasModal = useCallback((record: any) => {
    const currentAlias = record?.metadata?.annotations?.['tower.io/alias'] || '';
    setAliasRecord(record);
    setAliasModalVisible(true);
    aliasForm.setFieldsValue({ alias: String(currentAlias || '') });
  }, [aliasForm]);

  const handleSubmitAlias = useCallback(async (nextAliasRaw?: string) => {
    if (!aliasRecord) return false;
    const ns = aliasRecord?.metadata?.namespace;
    const name = aliasRecord?.metadata?.name;
    if (!ns || !name) {
      message.error('未能解析资源命名空间或名称');
      return false;
    }

    const next = String(nextAliasRaw || '').trim();
    const prev = String(aliasRecord?.metadata?.annotations?.['tower.io/alias'] || '').trim();
    if (next === prev) {
      setAliasModalVisible(false);
      return true;
    }

    const hasAnnotations = !!aliasRecord?.metadata?.annotations;
    const hasPrev = !!aliasRecord?.metadata?.annotations?.['tower.io/alias'];
    const aliasPath = '/metadata/annotations/tower.io~1alias';

    const patchBody: any[] = [];
    if (!next) {
      if (hasPrev) patchBody.push({ op: 'remove', path: aliasPath });
    } else {
      if (!hasAnnotations) {
        patchBody.push({ op: 'add', path: '/metadata/annotations', value: { 'tower.io/alias': next } });
      } else {
        patchBody.push({ op: 'add', path: aliasPath, value: next });
      }
    }

    if (patchBody.length === 0) {
      setAliasModalVisible(false);
      return true;
    }

    setAliasSubmitting(true);
    try {
      await patchHarvesterContainerResource(cloudId, apiPath, ns, name, patchBody);
      message.success(next ? '名称修改成功' : '已清空别名');
      setAliasModalVisible(false);
      setAliasRecord(null);
      aliasForm.resetFields();
      onRefresh();
      return true;
    } catch (e: any) {
      console.error(e);
      message.error(e?.message || '名称修改失败');
      return false;
    } finally {
      setAliasSubmitting(false);
    }
  }, [aliasRecord, apiPath, cloudId, message, onRefresh, aliasForm]);

  // 查看 YAML
  const handleViewYaml = useCallback((record: any) => {
    try {
      const yamlStr = yaml.dump(record, { indent: 2, lineWidth: -1, noRefs: true });
      setYamlContent(yamlStr);
      setYamlModalVisible(true);
    } catch (e: any) {
      message.error('生成 YAML 失败: ' + e.message);
    }
  }, [message]);
  
  // 表格列定义
  const columns = useMemo(() => [
    {
      title: '名称',
      key: 'name',
      width: 180,
      ellipsis: true,
      render: (_: any, record: any) => {
        const alias = record?.metadata?.annotations?.['tower.io/alias'];
        const id = record?.metadata?.name || '';
        const hasAlias = !!alias;

        return (
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <a onClick={() => handleViewDetail(record)} style={{ color: '#1890ff' }}>{hasAlias ? alias : id}</a>
            <Tooltip title={hasAlias ? '修改别名' : '设置别名'}>
              <Button
                type="text"
                size="small"
                icon={<EditTwoTone />}
                onClick={(e) => {
                  e.stopPropagation();
                  handleOpenAliasModal(record);
                }}
              />
            </Tooltip>
          </span>
        );
      },
    },
    {
      title: 'ID',
      dataIndex: ['metadata', 'name'],
      key: 'id',
      width: 200,
      ellipsis: true,
      render: (id: string) => <span style={{ color: '#888', fontSize: 12 }}>{id}</span>,
    },
    {
      title: '命名空间',
      dataIndex: ['metadata', 'namespace'],
      key: 'namespace',
      width: 120,
      ellipsis: true,
      render: (ns: string) => <Tag>{ns}</Tag>,
    },
    {
      title: '状态',
      key: 'status',
      width: 100,
      render: (_: any, record: any) => renderCronJobStatus(record),
    },
    {
      title: '调度计划',
      dataIndex: ['spec', 'schedule'],
      key: 'schedule',
      width: 180,
      render: (schedule: string) => {
        const macroLabel = getMacroLabel(schedule);
        return (
          <Tooltip title={macroLabel ? `${schedule} (${macroLabel})` : schedule}>
            <Tag icon={<ClockCircleOutlined />}>
              {macroLabel || schedule}
            </Tag>
          </Tooltip>
        );
      },
    },
    {
      title: '最后一次执行',
      dataIndex: ['status', 'lastScheduleTime'],
      key: 'lastScheduleTime',
      width: 180,
      render: formatTime,
    },
    {
      title: '创建时间',
      dataIndex: ['metadata', 'creationTimestamp'],
      key: 'creationTimestamp',
      width: 180,
      render: formatTime,
    },
    {
      title: '操作',
      key: 'actions',
      width: 160,
      render: (_: any, record: any) => {
        const isSuspended = record?.spec?.suspend;
        const items = [
          {
            key: 'detail',
            label: '详情',
            onClick: () => handleViewDetail(record),
          },
          {
            key: 'yaml',
            label: '查看 YAML',
            icon: <EyeOutlined />,
            onClick: () => handleViewYaml(record),
          },
          {
            key: 'trigger',
            label: '立即执行',
            onClick: () => {
              modal.confirm({
                title: '确认执行',
                content: `确定要立即触发 CronJob "${record?.metadata?.name}" 吗？`,
                onOk: () => handleTrigger(record),
              });
            },
          },
          isSuspended ? {
            key: 'resume',
            label: '恢复',
            onClick: () => {
              modal.confirm({
                title: '确认恢复',
                content: `确定要恢复 CronJob "${record?.metadata?.name}" 吗？`,
                onOk: () => handleResume(record),
              });
            },
          } : {
            key: 'suspend',
            label: '暂停',
            onClick: () => {
              modal.confirm({
                title: '确认暂停',
                content: `确定要暂停 CronJob "${record?.metadata?.name}" 吗？`,
                onOk: () => handleSuspend(record),
              });
            },
          },
          {
            key: 'delete',
            label: '删除',
            danger: true,
            onClick: () => {
              modal.confirm({
                title: '确认删除',
                content: `确定要删除 CronJob "${record?.metadata?.name}" 吗？`,
                okType: 'danger',
                onOk: () => handleDelete(record),
              });
            },
          },
        ];
        
        return <ResourceActionsDropdown items={items} buttonProps={{ className: 'row-actions-trigger' }} />;
      },
    },
  ], [handleViewDetail, handleViewYaml, handleOpenAliasModal, handleDelete, handleSuspend, handleResume, handleTrigger, modal]);
  
  // 使用列设置 Hook
  const { displayColumns: tableColumns } = useTableColumnSettings(
    columns,
    'harvester-containers-cronjobs',
  );
  
  return (
    <div>
      <div className="page-toolbar">
        <div className="toolbar-container">
          <Input
            className="toolbar-search"
            allowClear
            placeholder="名称/命名空间"
            suffix={<SearchOutlined style={{ color: 'rgba(0,0,0,.45)' }} />}
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
          />
          <Select
            className="toolbar-filter-sm"
            placeholder="筛选命名空间"
            allowClear
            showSearch
            optionFilterProp="label"
            value={nsValue || undefined}
            onChange={onNsChange}
            options={namespacesOptions.map((ns) => ({ label: ns, value: ns }))}
          />
          <button
            type="button"
            className="toolbar-reset-btn"
            onClick={() => {
              setKeyword('');
              onNsChange(undefined);
            }}
          >
            重置
          </button>
        </div>
        <div className="toolbar-actions">
          <Button type="primary" onClick={() => onCreateModalChange(true)}>
            创建 CronJob
          </Button>
          <TableColumnSettingsButton
            allColumns={columns}
            settingsKey="harvester-containers-cronjobs"
          />
          <Tooltip title="刷新">
            <Button type="default" icon={<ReloadOutlined />} onClick={() => onRefresh()} />
          </Tooltip>
        </div>
      </div>
      
      <Table
        className="std-table"
        bordered={false}
        rowKey={(record) => `${record?.metadata?.namespace}/${record?.metadata?.name}`}
        columns={tableColumns}
        dataSource={filteredData}
        loading={loading}
        scroll={{ x: 'max-content' }}
        pagination={{
          size: 'small',
          showTotal: (total) => `共 ${total} 条`,
        }}
        rowSelection={{
          selectedRowKeys: selectedKeys,
          onChange: setSelectedKeys,
        }}
      />
      
      {/* CronJob 详情抽屉 */}
      <CronJobDetailDrawer
        cronjob={currentCronJob}
        visible={detailVisible}
        onClose={() => {
          setDetailVisible(false);
          setCurrentCronJob(null);
        }}
        cloudId={cloudId}
      />
      
      {/* 别名编辑 Modal */}
      <Modal
        title="名称修改"
        open={aliasModalVisible}
        centered
        okText="保存"
        cancelText="取消"
        confirmLoading={aliasSubmitting}
        onOk={async () => {
          try {
            const values = await aliasForm.validateFields();
            await handleSubmitAlias(values?.alias);
          } catch {}
        }}
        onCancel={() => {
          if (aliasSubmitting) return;
          setAliasModalVisible(false);
          setAliasRecord(null);
          aliasForm.resetFields();
        }}
      >
        <Form form={aliasForm} layout="vertical">
          <Form.Item
            name="alias"
            label="名称"
            rules={[
              { max: 64, message: '别名最长 64 个字符' },
              { required: true, message: '请输入名称' },
            ]}
          >
            <Input
              autoFocus
              placeholder="请输入名称（留空则清空别名）"
              maxLength={64}
              onPressEnter={async () => {
                if (aliasSubmitting) return;
                try {
                  const values = await aliasForm.validateFields();
                  await handleSubmitAlias(values?.alias);
                } catch {}
              }}
            />
          </Form.Item>
        </Form>
      </Modal>

      {/* YAML 查看 Modal */}
      <Modal
        title="YAML 查看"
        open={yamlModalVisible}
        onCancel={() => setYamlModalVisible(false)}
        footer={null}
        width={800}
      >
        <YamlEditor
          value={yamlContent}
          onChange={() => {}}
          maxHeight={500}
          readOnly
        />
      </Modal>
      
      {/* 创建 CronJob Modal */}
      <Modal
        title="创建 CronJob"
        open={createModalVisible}
        onCancel={() => onCreateModalChange(false)}
        footer={null}
        width={800}
        destroyOnClose
      >
        <CronJobForm
          cloudId={cloudId}
          namespacesOptions={namespacesOptions}
          imagePullSecrets={imagePullSecrets}
          secretsWithCredentials={secretsWithCredentials}
          onSuccess={() => {
            onCreateModalChange(false);
            onRefresh(true);
          }}
          onCancel={() => onCreateModalChange(false)}
          defaultNamespace={defaultNamespace}
        />
      </Modal>
    </div>
  );
};

/**
 * Jobs Section 主组件
 */
const JobsSection: React.FC<Props> = ({
  jobs,
  cronjobs,
  loading,
  namespacesOptions,
  cloudId,
  nsValue,
  onNsChange,
  onRefresh,
  imagePullSecrets = [],
  secretsWithCredentials = [],
  createDefaultNamespace,
}) => {
  const formDefaultNs = createDefaultNamespace ?? nsValue;
  const [activeTab, setActiveTab] = useState<'job' | 'cronjob'>('job');
  const [jobCreateVisible, setJobCreateVisible] = useState(false);
  const [cronjobCreateVisible, setCronjobCreateVisible] = useState(false);
  
  // 根据 nsValue 过滤数据
  const filteredJobs = useMemo(() => {
    if (!nsValue) return jobs;
    return jobs.filter((item: any) => item?.metadata?.namespace === nsValue);
  }, [jobs, nsValue]);
  
  const filteredCronJobs = useMemo(() => {
    if (!nsValue) return cronjobs;
    return cronjobs.filter((item: any) => item?.metadata?.namespace === nsValue);
  }, [cronjobs, nsValue]);
  
  return (
    <PageDetailSection asCard={false}>
      <Segmented
        style={{ marginBottom: 12 }}
        value={activeTab}
        onChange={(v) => setActiveTab(v as 'job' | 'cronjob')}
        options={[
          { label: `一次性任务 (${filteredJobs.length})`, value: 'job' },
          { label: `定时任务 (${filteredCronJobs.length})`, value: 'cronjob' },
        ]}
      />
      {activeTab === 'job' ? (
        <JobTable
          key="job"
          data={filteredJobs}
          loading={loading}
          cloudId={cloudId}
          onRefresh={onRefresh}
          namespacesOptions={namespacesOptions}
          nsValue={nsValue}
          onNsChange={onNsChange}
          imagePullSecrets={imagePullSecrets}
          secretsWithCredentials={secretsWithCredentials}
          defaultNamespace={formDefaultNs}
          createModalVisible={jobCreateVisible}
          onCreateModalChange={setJobCreateVisible}
        />
      ) : (
        <CronJobTable
          key="cronjob"
          data={filteredCronJobs}
          loading={loading}
          cloudId={cloudId}
          onRefresh={onRefresh}
          namespacesOptions={namespacesOptions}
          nsValue={nsValue}
          onNsChange={onNsChange}
          imagePullSecrets={imagePullSecrets}
          secretsWithCredentials={secretsWithCredentials}
          defaultNamespace={formDefaultNs}
          createModalVisible={cronjobCreateVisible}
          onCreateModalChange={setCronjobCreateVisible}
        />
      )}
    </PageDetailSection>
  );
};

export default JobsSection;
