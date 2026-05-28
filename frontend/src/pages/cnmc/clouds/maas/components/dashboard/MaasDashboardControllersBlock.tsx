import React from 'react';
import { Card, Table, Typography } from 'antd';
import type { MaasControllerView } from '../../../../../../services/maasApi';
import { maasControllerColumns } from '../../lib/maasControllerColumns';
import { MAAS_CONTROLLERS_SECTION_ID } from '../../lib/maasDashboardUtils';
import {
  MAAS_OVERVIEW_CARD_BODY_STYLES,
  MAAS_OVERVIEW_CARD_HEADER_STYLES,
  MAAS_OVERVIEW_CARD_SHADOW,
} from '../../lib/maasOverviewCardStyles';

type Props = {
  connected: boolean;
  regionCtrl: MaasControllerView[];
  rackCtrl: MaasControllerView[];
};

const cardStyles = {
  header: MAAS_OVERVIEW_CARD_HEADER_STYLES,
  body: MAAS_OVERVIEW_CARD_BODY_STYLES,
};

const MaasDashboardControllersBlock: React.FC<Props> = ({
  connected,
  regionCtrl,
  rackCtrl,
}) => (
  <div id={MAAS_CONTROLLERS_SECTION_ID}>
    <Card
      title="Region 控制器"
      size="small"
      style={{ marginTop: 16, boxShadow: MAAS_OVERVIEW_CARD_SHADOW }}
      styles={cardStyles}
    >
      <Table
        className="std-table"
        bordered={false}
        rowKey={(r) => r.system_id}
        columns={maasControllerColumns}
        dataSource={regionCtrl}
        scroll={{ x: true }}
        locale={{ emptyText: connected ? '暂无 Region 控制器数据' : '—' }}
        pagination={false}
      />
    </Card>

    <Card
      title="Rack 控制器"
      size="small"
      style={{ marginTop: 16, boxShadow: MAAS_OVERVIEW_CARD_SHADOW }}
      styles={cardStyles}
      extra={
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          MAAS 服务节点，非物理机架
        </Typography.Text>
      }
    >
      <Table
        className="std-table"
        bordered={false}
        rowKey={(r) => r.system_id}
        columns={maasControllerColumns}
        dataSource={rackCtrl}
        scroll={{ x: true }}
        locale={{ emptyText: connected ? '暂无 Rack 控制器数据' : '—' }}
        pagination={false}
      />
    </Card>
  </div>
);

export default MaasDashboardControllersBlock;
