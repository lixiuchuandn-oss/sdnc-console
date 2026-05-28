import React from 'react';
import { Alert, Card, Table } from 'antd';
import type { MaasDashboardResponse } from '../../../../../../services/maasApi';
import { maasDashboardEventColumns } from '../../lib/maasDashboardEventColumns';
import {
  MAAS_OVERVIEW_CARD_BODY_STYLES,
  MAAS_OVERVIEW_CARD_HEADER_STYLES,
  MAAS_OVERVIEW_CARD_SHADOW,
} from '../../lib/maasOverviewCardStyles';

type Props = {
  data: MaasDashboardResponse | null;
  connected: boolean;
  machines: MaasDashboardResponse['machines'] | undefined;
};

const MaasDashboardEventsCard: React.FC<Props> = ({ data, connected, machines }) => (
  <Card
    title="最近动态"
    size="small"
    className="dashboard-overview-activity-card"
    style={{ marginTop: 16, boxShadow: MAAS_OVERVIEW_CARD_SHADOW }}
    styles={{
      header: MAAS_OVERVIEW_CARD_HEADER_STYLES,
      body: MAAS_OVERVIEW_CARD_BODY_STYLES,
    }}
  >
    {connected && machines?.total === 0 ? (
      <Alert
        type="info"
        showIcon
        message="暂无机器"
        description="可前往「网络发现」查看未纳管设备，或在 MAAS 中新增机器。"
        style={{ marginBottom: 12 }}
      />
    ) : null}
    <Table
      className="std-table"
      bordered={false}
      rowKey={(r, i) => `${r.time}-${r.hostname}-${i}`}
      columns={maasDashboardEventColumns}
      dataSource={data?.recent_events ?? []}
      scroll={{ x: true }}
      locale={{ emptyText: connected ? '暂无事件' : '—' }}
      pagination={false}
    />
  </Card>
);

export default MaasDashboardEventsCard;
