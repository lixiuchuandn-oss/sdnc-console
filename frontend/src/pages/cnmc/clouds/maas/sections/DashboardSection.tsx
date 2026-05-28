import React, { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Alert, Spin, Typography } from 'antd';
import PageDetailSection from '../../../../../components/PageDetailSection';
import { maasPoolPathForTab } from '../../../../../layouts/admin/maas/maasPoolSidebar';
import MaasDashboardClusterBar from '../components/dashboard/MaasDashboardClusterBar';
import MaasDashboardControllersBlock from '../components/dashboard/MaasDashboardControllersBlock';
import MaasDashboardEventsCard from '../components/dashboard/MaasDashboardEventsCard';
import MaasDashboardMetricRow from '../components/dashboard/MaasDashboardMetricRow';
import MaasDashboardPoolConfigCard from '../components/dashboard/MaasDashboardPoolConfigCard';
import { useMaasDashboard } from '../hooks/useMaasDashboard';
import { MAAS_CONFIG_SECTION_ID, maasScrollToSection } from '../lib/maasDashboardUtils';

type Props = {
  poolId: string;
};

const DashboardSection: React.FC<Props> = ({ poolId }) => {
  const navigate = useNavigate();
  const {
    loading,
    error,
    warn,
    data,
    cloud,
    connected,
    load,
    machines,
    regionCtrl,
    rackCtrl,
  } = useMaasDashboard(poolId);

  const goTab = useCallback(
    (tab: 'machines' | 'discoveries' | 'images', extra?: string) => {
      const base = maasPoolPathForTab(poolId, tab);
      navigate(extra ? `${base}&${extra}` : base);
    },
    [navigate, poolId],
  );

  return (
    <PageDetailSection asCard={false}>
      {error ? (
        <Alert
          type="error"
          showIcon
          message={error}
          description={
            connected
              ? undefined
              : '请检查下方 Tower 资源池中的 MAAS 地址与 API Key；编辑与连接测试请在资源池管理中操作。'
          }
          action={
            <Typography.Link onClick={() => maasScrollToSection(MAAS_CONFIG_SECTION_ID)}>
              查看连接配置
            </Typography.Link>
          }
          style={{ marginBottom: 16 }}
        />
      ) : null}
      {warn && !error ? (
        <Alert type="warning" showIcon message={warn} style={{ marginBottom: 16 }} />
      ) : null}
      <Spin spinning={loading}>
        <MaasDashboardClusterBar
          data={data}
          cloud={cloud}
          loading={loading}
          connected={connected}
          onRefresh={() => void load()}
        />
        <MaasDashboardMetricRow
          data={data}
          connected={connected}
          machines={machines}
          regionCtrl={regionCtrl}
          rackCtrl={rackCtrl}
          onGoTab={goTab}
        />
        <MaasDashboardEventsCard data={data} connected={connected} machines={machines} />
        <MaasDashboardPoolConfigCard cloud={cloud} />
        <MaasDashboardControllersBlock
          connected={connected}
          regionCtrl={regionCtrl}
          rackCtrl={rackCtrl}
        />
      </Spin>
    </PageDetailSection>
  );
};

export default DashboardSection;
