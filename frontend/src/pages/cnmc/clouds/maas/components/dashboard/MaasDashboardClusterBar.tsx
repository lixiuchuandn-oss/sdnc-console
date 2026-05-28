import React from 'react';
import { Card, Space, Tag, Typography } from 'antd';
import { CheckCircleOutlined, CloseCircleOutlined } from '@ant-design/icons';
import {
  CLOUD_STATUS_MAP,
  type Cloud,
} from '../../../../pools/lib/poolProviders';
import type { MaasDashboardResponse } from '../../../../../../services/maasApi';
import { MaasToolbarRefresh } from '../../lib/maasToolbar';
import {
  MAAS_OVERVIEW_CARD_BODY_STYLES,
  MAAS_OVERVIEW_CARD_HEADER_STYLES,
  MAAS_OVERVIEW_CARD_SHADOW,
} from '../../lib/maasOverviewCardStyles';

type Props = {
  data: MaasDashboardResponse | null;
  cloud: Cloud | null;
  loading: boolean;
  connected: boolean;
  onRefresh: () => void;
};

const MaasDashboardClusterBar: React.FC<Props> = ({
  data,
  cloud,
  loading,
  connected,
  onRefresh,
}) => {
  const towerStatusKey = String(cloud?.status || '').toLowerCase();
  const towerStatusLabel = CLOUD_STATUS_MAP[towerStatusKey] || towerStatusKey || '—';

  return (
    <Card
      size="small"
      className="dashboard-overview-metric-card"
      style={{ marginBottom: 16, boxShadow: MAAS_OVERVIEW_CARD_SHADOW }}
      styles={{
        header: MAAS_OVERVIEW_CARD_HEADER_STYLES,
        body: { ...MAAS_OVERVIEW_CARD_BODY_STYLES, padding: '12px 16px 16px' },
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: 16,
        }}
      >
        <Space wrap size={[16, 8]} align="center" style={{ flex: 1, minWidth: 0 }}>
          <Typography.Text strong style={{ fontSize: 16 }}>
            {data?.region?.name || cloud?.name || '—'}
          </Typography.Text>
          <Typography.Text type="secondary" copyable={!!data?.region?.endpoint}>
            {data?.region?.endpoint || cloud?.endpoint || '—'}
          </Typography.Text>
          {data?.region?.maas_version ? (
            <Tag color="blue">MAAS {data.region.maas_version}</Tag>
          ) : null}
          <Tag
            color={
              towerStatusKey === 'online'
                ? 'success'
                : towerStatusKey === 'offline'
                  ? 'error'
                  : 'warning'
            }
          >
            Tower {towerStatusLabel}
          </Tag>
          {connected ? (
            <Tag icon={<CheckCircleOutlined />} color="success">
              MAAS 已连接
            </Tag>
          ) : (
            <Tag icon={<CloseCircleOutlined />} color="error">
              MAAS 未连接
            </Tag>
          )}
          {data?.sync?.images_importing ? <Tag color="processing">镜像同步中</Tag> : null}
        </Space>
        <div className="toolbar-actions">
          <MaasToolbarRefresh loading={loading} onRefresh={onRefresh} />
        </div>
      </div>
    </Card>
  );
};

export default MaasDashboardClusterBar;
