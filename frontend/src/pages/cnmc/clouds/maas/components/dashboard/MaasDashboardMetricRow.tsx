import React from 'react';
import { Row } from 'antd';
import type { MaasControllerView, MaasDashboardResponse } from '../../../../../../services/maasApi';
import MaasOverviewMetricCard from '../MaasOverviewMetricCard';
import { MaasDashStatIcon } from '../../lib/maasDashboardStatIcons';
import {
  MAAS_CONTROLLERS_SECTION_ID,
  maasControllerFooter,
  maasControllerOnlineCount,
  maasDashValue,
  maasOsImageFooter,
  maasScrollToSection,
} from '../../lib/maasDashboardUtils';

type Props = {
  data: MaasDashboardResponse | null;
  connected: boolean;
  machines: MaasDashboardResponse['machines'] | undefined;
  regionCtrl: MaasControllerView[];
  rackCtrl: MaasControllerView[];
  onGoTab: (tab: 'machines' | 'discoveries' | 'images', extra?: string) => void;
};

const MaasDashboardMetricRow: React.FC<Props> = ({
  data,
  connected,
  machines,
  regionCtrl,
  rackCtrl,
  onGoTab,
}) => {
  const regionOnline = maasControllerOnlineCount(regionCtrl);
  const regionTotal = regionCtrl.length;
  const rackOnline = maasControllerOnlineCount(rackCtrl);
  const rackTotal = rackCtrl.length;

  return (
    <Row gutter={[16, 16]} className="dashboard-overview-row">
      <MaasOverviewMetricCard
        title="Region 控制器"
        icon={MaasDashStatIcon.region}
        value={maasDashValue(connected, regionOnline)}
        total={connected && regionTotal > 0 ? regionTotal : undefined}
        footer={connected ? maasControllerFooter(regionCtrl) : undefined}
        connected={connected}
        onClick={() => maasScrollToSection(MAAS_CONTROLLERS_SECTION_ID)}
      />
      <MaasOverviewMetricCard
        title="Rack 控制器"
        icon={MaasDashStatIcon.rack}
        value={maasDashValue(connected, rackOnline)}
        total={connected && rackTotal > 0 ? rackTotal : undefined}
        footer={connected ? maasControllerFooter(rackCtrl) : undefined}
        connected={connected}
        onClick={() => maasScrollToSection(MAAS_CONTROLLERS_SECTION_ID)}
      />
      <MaasOverviewMetricCard
        title="机器总数"
        icon={MaasDashStatIcon.machines}
        value={maasDashValue(connected, machines?.total ?? 0)}
        connected={connected}
        onClick={() => onGoTab('machines')}
      />
      <MaasOverviewMetricCard
        title="可用"
        icon={MaasDashStatIcon.ready}
        value={maasDashValue(connected, machines?.ready ?? 0)}
        connected={connected}
        onClick={() => onGoTab('machines', 'status=ready')}
      />
      <MaasOverviewMetricCard
        title="运行中"
        icon={MaasDashStatIcon.deployed}
        value={maasDashValue(connected, machines?.deployed ?? 0)}
        connected={connected}
        onClick={() => onGoTab('machines', 'status=deployed')}
      />
      <MaasOverviewMetricCard
        title="异常"
        icon={MaasDashStatIcon.error}
        value={maasDashValue(connected, machines?.error ?? 0)}
        connected={connected}
        onClick={() => onGoTab('machines', 'status=error')}
      />
      <MaasOverviewMetricCard
        title="网络发现"
        icon={MaasDashStatIcon.discoveries}
        value={maasDashValue(connected, data?.discoveries_count ?? 0)}
        connected={connected}
        onClick={() => onGoTab('discoveries')}
      />
      <MaasOverviewMetricCard
        title="操作系统镜像"
        icon={MaasDashStatIcon.images}
        value={maasDashValue(connected, data?.os_images_count ?? 0)}
        footer={maasOsImageFooter(data, connected)}
        connected={connected}
        onClick={() => onGoTab('images')}
      />
    </Row>
  );
};

export default MaasDashboardMetricRow;
