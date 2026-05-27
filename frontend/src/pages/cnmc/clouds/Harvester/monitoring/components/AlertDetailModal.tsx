/**
 * 告警详情 Modal（复用组件）
 * 站点内「运维告警概览」与「告警处理状态」列表共用此组件。
 * 展示字段按 Alertmanager v2 业务场景分组：基本信息 / 位置 / 时间 / 通知 / 详情 / 跳转。
 */
import React from 'react';
import { LinkOutlined } from '@ant-design/icons';
import { Button, Descriptions, Modal, Space, Tag, Typography } from 'antd';
import { SEVERITY_MAP } from '../constants';
import { ALERT_LEVEL_CRITICAL, ALERT_LEVEL_INFO, ALERT_LEVEL_WARNING } from '../context/MonitoringContext';
import { formatDateTimeDetailed, formatDuration, getAlertGroupLabel, type ParsedAlert } from '../lib/prometheusAlerts';

interface AlertDetailModalProps {
  open: boolean;
  onClose: () => void;
  record: ParsedAlert | null;
  /** PrometheusRule 分组缓存（key = labels.prometheus_rule_name），用于展示分组别名 */
  rulesGroupMap?: Record<string, string>;
}

function renderLevel(
  level: typeof ALERT_LEVEL_CRITICAL | typeof ALERT_LEVEL_WARNING | typeof ALERT_LEVEL_INFO,
): React.ReactNode {
  if (level === ALERT_LEVEL_CRITICAL) return <Tag color="error">{SEVERITY_MAP.SEVERITY_CRITICAL}</Tag>;
  if (level === ALERT_LEVEL_WARNING) return <Tag color="warning">{SEVERITY_MAP.SEVERITY_WARNING}</Tag>;
  if (level === ALERT_LEVEL_INFO) return <Tag color="processing">{SEVERITY_MAP.SEVERITY_INFO}</Tag>;
  return <Tag>{level}</Tag>;
}

function renderAlertState(row: ParsedAlert): React.ReactNode {
  const state = (row.state ?? '').toLowerCase();
  if (state === 'suppressed' || (row.silencedBy?.length ?? 0) > 0 || (row.inhibitedBy?.length ?? 0) > 0) {
    const reason = (row.silencedBy?.length ?? 0) > 0 ? '已静默' : '已抑制';
    return <Tag color="default">{reason}</Tag>;
  }
  if (state === 'active' || !state) return <Tag color="error">正在告警</Tag>;
  if (state === 'unprocessed') return <Tag color="warning">正在告警</Tag>;
  return <Tag>{row.state}</Tag>;
}

function resolveHostFromInstance(row: ParsedAlert): string {
  if (row.node) return row.node;
  const inst = (row.instance ?? '').toString().trim();
  if (!inst) return '';
  const firstPart = inst.split(',')[0] ?? inst;
  return firstPart.split(':')[0]?.trim() ?? '';
}

/** 去掉 Alertmanager receiver 路径首段命名空间（第一个 `/` 及其之前部分） */
function stripReceiverNamespacePrefix(name: string): string {
  const trimmed = String(name ?? '').trim();
  const slashIdx = trimmed.indexOf('/');
  return slashIdx >= 0 ? trimmed.slice(slashIdx + 1) : trimmed;
}

/** Alertmanager 路由默认黑洞接收器，展示通知对象时排除并格式化路径 */
function filterDisplayReceivers(receivers: string[] | undefined): string[] {
  if (!receivers?.length) return [];
  return receivers
    .map((name) => String(name ?? '').trim())
    .filter((trimmed) => trimmed && trimmed !== 'null-receiver' && !trimmed.endsWith('/null-receiver'))
    .map(stripReceiverNamespacePrefix);
}

/**
 * @param open - 是否打开
 * @param onClose - 关闭回调
 * @param record - 告警记录
 * @param rulesGroupMap - 告警分组别名映射（可选）
 * @returns 告警详情 Modal
 */
const AlertDetailModal: React.FC<AlertDetailModalProps> = ({ open, onClose, record, rulesGroupMap }) => {
  const displayReceivers = filterDisplayReceivers(record?.receivers);

  return (
    <Modal
      open={open}
      onCancel={onClose}
      title="告警详情"
      footer={<Button onClick={onClose}>关闭</Button>}
      width={900}
      destroyOnHidden
    >
      {record ? (
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          <Descriptions column={2} bordered size="small" labelStyle={{ width: 110 }}>
            <Descriptions.Item label="告警名称" span={2}>
              <Space size={8} wrap>
                <Typography.Text strong>{record.title || record.alertname || '-'}</Typography.Text>
                {renderLevel(record.level)}
                {renderAlertState(record)}
              </Space>
            </Descriptions.Item>

            <Descriptions.Item label="告警分组">
              {getAlertGroupLabel(record, rulesGroupMap)}
            </Descriptions.Item>
            <Descriptions.Item label="告警项目">{record.namespace || '-'}</Descriptions.Item>
            <Descriptions.Item label="触发原因" span={2}>
              <Typography.Text style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                {record.description || '-'}
              </Typography.Text>
            </Descriptions.Item>
            <Descriptions.Item label="触发时间">
              {formatDateTimeDetailed(record.startsAtRaw)}
            </Descriptions.Item>
            <Descriptions.Item label="最近更新">
              {formatDateTimeDetailed(record.updatedAtRaw || record.activeAtRaw)}
            </Descriptions.Item>
            <Descriptions.Item label="持续时间" span={2}>
              {formatDuration(record)}
            </Descriptions.Item>
            <Descriptions.Item label="告警节点">{resolveHostFromInstance(record) || '-'}</Descriptions.Item>
            <Descriptions.Item label="告警实例">{record.instance || '-'}</Descriptions.Item>
            <Descriptions.Item label="告警Pod">{record.pod || '-'}</Descriptions.Item>
            <Descriptions.Item label="告警容器">{record.container || '-'}</Descriptions.Item>
            <Descriptions.Item label="通知策略/通知对象" span={2}>
              {displayReceivers.length > 0 ? (
                <Space size={[6, 6]} wrap>
                  {displayReceivers.map((r) => (
                    <Tag key={r} color="blue" style={{ marginInlineEnd: 0 }}>
                      {r}
                    </Tag>
                  ))}
                </Space>
              ) : (
                '-'
              )}
            </Descriptions.Item>
          </Descriptions>
        </Space>
      ) : (
        <Typography.Text type="secondary">暂无数据</Typography.Text>
      )}
    </Modal>
  );
};

export default AlertDetailModal;
