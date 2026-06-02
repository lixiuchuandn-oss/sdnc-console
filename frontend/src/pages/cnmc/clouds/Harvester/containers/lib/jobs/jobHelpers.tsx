/**
 * Job / CronJob 列表与详情共用：Cron 宏、失败解析、状态渲染、时间格式化。
 */
import React from 'react';
import { Tag, Space, Tooltip } from 'antd';
import {
  ClockCircleOutlined,
  CloseCircleOutlined,
  ExclamationCircleOutlined,
  InfoCircleOutlined,
} from '@ant-design/icons';

export const CRON_MACROS: Record<string, { expression: string; label: string }> = {
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
export const getMacroLabel = (expression: string): string | null => {
  const macro = CRON_MACROS[expression.trim().toLowerCase()];
  return macro ? macro.label : null;
};

/**
 * 错误类型定义
 */
export interface FailureInfo {
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
 * 获取错误类型颜色（预留）
 */
const _getErrorColor = (type: string): string => {
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
export const renderJobStatus = (job: any) => {
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
export const renderCronJobStatus = (cronjob: any) => {
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
export const formatTime = (timestamp?: string) => {
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
export const calculateAge = (timestamp?: string) => {
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
