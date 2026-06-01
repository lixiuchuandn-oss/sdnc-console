/**
 * CronJob 详情抽屉。
 */
import React from 'react';
import { Drawer, Tabs, Descriptions, Tag, Space, Typography } from 'antd';
import { ClockCircleOutlined } from '@ant-design/icons';
import { parseToChinese } from '../CronExpressionHelper';
import {
  CRON_MACROS,
  getMacroLabel,
  renderCronJobStatus,
  calculateAge,
  formatTime,
} from '../../lib/jobs/jobHelpers';
import CronJobJobsList from './CronJobJobsList';

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
          <Descriptions.Item label="项目">{metadata.namespace}</Descriptions.Item>
          <Descriptions.Item label="状态">{renderCronJobStatus(cronjob)}</Descriptions.Item>
          <Descriptions.Item label="运行时长">{calculateAge(metadata.creationTimestamp)}</Descriptions.Item>
          <Descriptions.Item label="调度计划" span={2}>
            <Space direction="vertical">
              <Tag icon={<ClockCircleOutlined />}>{schedule}</Tag>
              {(() => {
                const chineseDesc = parseToChinese(schedule);
                return chineseDesc ? <Tag color="blue">{chineseDesc}</Tag> : null;
              })()}
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

export default CronJobDetailDrawer;
