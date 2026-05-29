import React, { useMemo } from 'react';
import { Descriptions, Typography } from 'antd';
import { DashboardOutlined } from '@ant-design/icons';
import { OverviewCard, overviewTitleIcon } from '../../../../../../components/overview';
import type { Cloud } from '../../../../pools/lib/poolProviders';
import { resolvePoolTypeLabel } from '../../../../pools/lib/poolProviders';
import { formatMaasDateTime, maskMaasApiKey } from '../../lib/maasPoolConfigFormat';
import { MAAS_CONFIG_SECTION_ID } from '../../lib/maasDashboardUtils';
import { MaasToolbarRefresh } from '../../lib/maasToolbar';

type Props = {
  cloud: Cloud | null;
  loading?: boolean;
  onRefresh?: () => void;
};

const MaasDashboardPoolConfigCard: React.FC<Props> = ({ cloud, loading, onRefresh }) => {
  const cfg = useMemo(() => (cloud?.config || {}) as Record<string, unknown>, [cloud]);

  return (
    <div id={MAAS_CONFIG_SECTION_ID}>
      <OverviewCard
        title="资源池信息"
        icon={overviewTitleIcon(<DashboardOutlined />)}
        extra={
          onRefresh ? (
            <MaasToolbarRefresh loading={loading} onRefresh={onRefresh} />
          ) : undefined
        }
        style={{ marginBottom: 16 }}
        bodyStyle={{ padding: '16px 20px' }}
      >
        <Descriptions column={{ xs: 1, sm: 2, lg: 3 }} size="middle">
        <Descriptions.Item label="名称">{cloud?.name || '—'}</Descriptions.Item>
        <Descriptions.Item label="类型">
          {resolvePoolTypeLabel(String(cloud?.type || ''))}
        </Descriptions.Item>
        <Descriptions.Item label="描述" span={2}>
          {cloud?.description || '—'}
        </Descriptions.Item>
        <Descriptions.Item label="MAAS Endpoint" span={2}>
          <Typography.Text copyable={!!cloud?.endpoint}>
            {cloud?.endpoint || '—'}
          </Typography.Text>
        </Descriptions.Item>
        <Descriptions.Item label="API Key">{maskMaasApiKey(String(cfg.apiKey || ''))}</Descriptions.Item>
        <Descriptions.Item label="忽略 TLS">
          {cfg.ignoreTls === false ? '否' : '是'}
        </Descriptions.Item>
        <Descriptions.Item label="最近检测">
          {formatMaasDateTime(cloud?.lastTestAt)}
        </Descriptions.Item>
        <Descriptions.Item label="创建时间">
          {formatMaasDateTime(cloud?.createdAt)}
        </Descriptions.Item>
        <Descriptions.Item label="更新时间">
          {formatMaasDateTime(cloud?.updatedAt)}
        </Descriptions.Item>
      </Descriptions>
        <Typography.Paragraph type="secondary" style={{ marginBottom: 0, marginTop: 12 }}>
          凭证保存在 Tower <code>config.apiKey</code>，由后端 OAuth1 PLAINTEXT 代理访问 MAAS API v2。
        </Typography.Paragraph>
      </OverviewCard>
    </div>
  );
};

export default MaasDashboardPoolConfigCard;
