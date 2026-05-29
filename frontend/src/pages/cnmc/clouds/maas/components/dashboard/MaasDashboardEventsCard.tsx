import React from 'react';
import { Alert, Table } from 'antd';
import { ProfileOutlined } from '@ant-design/icons';
import { OverviewCard, overviewTitleIcon } from '../../../../../../components/overview';
import type { MaasDashboardResponse } from '../../../../../../services/maasApi';
import { maasDashboardEventColumns } from '../../lib/maasDashboardEventColumns';

type Props = {
  data: MaasDashboardResponse | null;
  connected: boolean;
  machines: MaasDashboardResponse['machines'] | undefined;
};

const MaasDashboardEventsCard: React.FC<Props> = ({ data, connected, machines }) => (
  <OverviewCard
    title="最近动态"
    icon={overviewTitleIcon(<ProfileOutlined />)}
    className="dashboard-overview-activity-card"
    style={{ marginTop: 16 }}
    bodyStyle={{ padding: '8px 16px 16px' }}
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
  </OverviewCard>
);

export default MaasDashboardEventsCard;
