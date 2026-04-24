import React, { useMemo } from 'react';
import { Alert, Card, Descriptions, Space, Tag, Typography } from 'antd';
import { InfoCircleOutlined } from '@ant-design/icons';
import { getProviderName, resolvePoolTypeLabel } from '../../../../pools/poolProviders';
import '../styles/rancher-overview.css';

const { Text, Paragraph } = Typography;

export interface RancherCloud {
  id: string;
  name: string;
  region: string;
  type: string;
  status?: string;
  endpoint?: string;
  description?: string;
  config?: {
    provider?: string;
    rancherUrl?: string;
    clusterId?: string;
    projectId?: string;
    ignoreTls?: boolean;
    [k: string]: any;
  };
  createdAt?: string;
  updatedAt?: string;
  lastTestAt?: string;
}

const statusColor = (s?: string) => {
  const v = String(s || '').toLowerCase();
  if (v === 'online') return 'success';
  if (v === 'maintenance') return 'warning';
  if (v === 'offline') return 'default';
  return 'default';
};

const RancherOverviewSection: React.FC<{
  cloud: RancherCloud | null;
  loading?: boolean;
}> = ({ cloud, loading }) => {
  const typeLabel = useMemo(() => resolvePoolTypeLabel(cloud?.type), [cloud?.type]);
  const vendorLabel = useMemo(
    () => getProviderName(cloud?.config?.provider) || '—',
    [cloud?.config?.provider],
  );

  const baseUrl = useMemo(() => {
    return (
      (cloud?.config?.rancherUrl && String(cloud.config.rancherUrl)) ||
      (cloud?.endpoint && String(cloud.endpoint)) ||
      '—'
    );
  }, [cloud?.config?.rancherUrl, cloud?.endpoint]);

  if (!cloud && !loading) {
    return <Alert type="info" showIcon message="未加载到资源池信息" />;
  }

  return (
    <div className="rancher-pool-overview rancher-detail-wrap rancher-detail-overview">
      <Space direction="vertical" size="large" style={{ width: '100%' }}>
        <Alert
          type="info"
          showIcon
          icon={<InfoCircleOutlined />}
          message="容器云管理视图"
          description={
            <Paragraph style={{ marginBottom: 0 }}>
              资源类型为「容器云」时，在下方选择具体厂商（当前已支持 Rancher）。本页展示该接入的控制面与凭证概览；后续可对接
              <code> /v3 </code> 等 API 扩展集群与工作负载子 Tab。
            </Paragraph>
          }
        />

        <Card title="基本信息" loading={loading}>
          <Descriptions column={1} size="small" bordered>
            <Descriptions.Item label="资源池名称">{cloud?.name || '—'}</Descriptions.Item>
            <Descriptions.Item label="资源类型">
              <Tag color="blue">{typeLabel}</Tag>
            </Descriptions.Item>
            <Descriptions.Item label="厂商 / 子类型">
              <Tag color="geekblue">{vendorLabel}</Tag>
            </Descriptions.Item>
            <Descriptions.Item label="连接状态">
              {cloud?.status ? <Tag color={statusColor(cloud.status)}>{cloud.status}</Tag> : '—'}
            </Descriptions.Item>
            <Descriptions.Item label="Region">{cloud?.region || '—'}</Descriptions.Item>
            <Descriptions.Item label="Rancher 地址">
              <Text copyable={!!baseUrl && baseUrl !== '—'}>{baseUrl}</Text>
            </Descriptions.Item>
            <Descriptions.Item label="描述">{cloud?.description || '—'}</Descriptions.Item>
            <Descriptions.Item label="忽略 TLS 校验">
              {cloud?.config?.ignoreTls === true ? '是' : cloud?.config?.ignoreTls === false ? '否' : '—'}
            </Descriptions.Item>
          </Descriptions>
        </Card>

        <Card title="可选范围">
          <Descriptions column={1} size="small" bordered>
            <Descriptions.Item label="集群 ID（若已配置）">
              {cloud?.config?.clusterId ? <Text code>{String(cloud.config.clusterId)}</Text> : '—'}
            </Descriptions.Item>
            <Descriptions.Item label="项目 / Project（若已配置）">
              {cloud?.config?.projectId ? <Text code>{String(cloud.config.projectId)}</Text> : '—'}
            </Descriptions.Item>
          </Descriptions>
        </Card>
      </Space>
    </div>
  );
};

export default RancherOverviewSection;
