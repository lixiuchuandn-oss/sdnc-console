/**
 * Job 详情抽屉。
 */
import React, { useState, useEffect } from 'react';
import { Drawer, Tabs, Descriptions, Tag, Space, Alert, Spin } from 'antd';
import { FileTextOutlined } from '@ant-design/icons';
import { fetchHarvesterJobPods } from '../../../../../../../services/harvesterApi';
import { renderJobStatus, calculateAge, formatTime } from '../../lib/jobs/jobHelpers';
import JobLogViewer from './JobLogViewer';
import JobEventsViewer from './JobEventsViewer';

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
          <Descriptions column={2} bordered size="small" labelStyle={{ whiteSpace: 'nowrap' }}>
            <Descriptions.Item label="名称">{metadata.name}</Descriptions.Item>
            <Descriptions.Item label="项目">{metadata.namespace}</Descriptions.Item>
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

export default JobDetailDrawer;
