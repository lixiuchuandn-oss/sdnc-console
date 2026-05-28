import React, { useMemo } from 'react';
import { Card, Descriptions, Typography } from 'antd';
import type { Cloud } from '../../../../pools/lib/poolProviders';
import { resolvePoolTypeLabel } from '../../../../pools/lib/poolProviders';
import { formatMaasDateTime, maskMaasApiKey } from '../../lib/maasPoolConfigFormat';
import { MAAS_CONFIG_SECTION_ID } from '../../lib/maasDashboardUtils';
import {
  MAAS_OVERVIEW_CARD_BODY_STYLES,
  MAAS_OVERVIEW_CARD_HEADER_STYLES,
  MAAS_OVERVIEW_CARD_SHADOW,
} from '../../lib/maasOverviewCardStyles';

type Props = {
  cloud: Cloud | null;
};

const MaasDashboardPoolConfigCard: React.FC<Props> = ({ cloud }) => {
  const cfg = useMemo(() => (cloud?.config || {}) as Record<string, unknown>, [cloud]);

  return (
    <Card
      id={MAAS_CONFIG_SECTION_ID}
      title="Tower 资源池"
      size="small"
      style={{ marginTop: 16, boxShadow: MAAS_OVERVIEW_CARD_SHADOW }}
      styles={{
        header: MAAS_OVERVIEW_CARD_HEADER_STYLES,
        body: MAAS_OVERVIEW_CARD_BODY_STYLES,
      }}
    >
      <Descriptions column={{ xs: 1, sm: 2 }} size="middle">
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
    </Card>
  );
};

export default MaasDashboardPoolConfigCard;
