import React from 'react';
import { Table, Typography } from 'antd';
import { ControlOutlined, CloudOutlined } from '@ant-design/icons';
import { OverviewCard, overviewTitleIcon } from '../../../../../../components/overview';
import type { MaasControllerView } from '../../../../../../services/maasApi';
import { maasControllerColumns } from '../../lib/maasControllerColumns';
import { MAAS_CONTROLLERS_SECTION_ID } from '../../lib/maasDashboardUtils';

type Props = {
  connected: boolean;
  regionCtrl: MaasControllerView[];
  rackCtrl: MaasControllerView[];
};

const MaasDashboardControllersBlock: React.FC<Props> = ({
  connected,
  regionCtrl,
  rackCtrl,
}) => (
  <div id={MAAS_CONTROLLERS_SECTION_ID}>
    <OverviewCard
      title="Region 控制器"
      icon={overviewTitleIcon(<ControlOutlined />)}
      style={{ marginTop: 16 }}
      bodyStyle={{ padding: '8px 16px 16px' }}
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
    </OverviewCard>

    <OverviewCard
      title="Rack 控制器"
      icon={overviewTitleIcon(<CloudOutlined />)}
      style={{ marginTop: 16 }}
      bodyStyle={{ padding: '8px 16px 16px' }}
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
    </OverviewCard>
  </div>
);

export default MaasDashboardControllersBlock;
