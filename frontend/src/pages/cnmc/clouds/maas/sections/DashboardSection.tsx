import React, { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Alert, Card, Col, Row, Skeleton, Typography } from 'antd';
import { DashboardOutlined } from '@ant-design/icons';
import PageDetailSection from '../../../../../components/PageDetailSection';
import { maasPoolPathForTab } from '../../../../../layouts/admin/maas/maasPoolSidebar';
import MaasDashboardControllersBlock from '../components/dashboard/MaasDashboardControllersBlock';
import MaasDashboardEventsCard from '../components/dashboard/MaasDashboardEventsCard';
import MaasDashboardMachineStatusCard from '../components/dashboard/MaasDashboardMachineStatusCard';
import MaasDashboardMetricRow from '../components/dashboard/MaasDashboardMetricRow';
import MaasDashboardPoolConfigCard from '../components/dashboard/MaasDashboardPoolConfigCard';
import { MaasToolbarRefresh } from '../lib/maasToolbar';
import { useMaasDashboard } from '../hooks/useMaasDashboard';
import {
  MAAS_CONFIG_SECTION_ID,
  maasScrollToSection,
} from '../lib/maasDashboardUtils';
import '../../../dashboard/Dashboard.css';

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
    <PageDetailSection
      asCard={false}
      showHeaderTitle
      icon={<DashboardOutlined />}
      title={data?.region?.name || cloud?.name || '资源概览'}
      extra={
        <div className="toolbar-actions">
          <MaasToolbarRefresh loading={loading} onRefresh={() => void load()} />
        </div>
      }
    >
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
            <Typography.Link
              onClick={() => maasScrollToSection(MAAS_CONFIG_SECTION_ID)}
            >
              查看连接配置
            </Typography.Link>
          }
          style={{ marginBottom: 16 }}
        />
      ) : null}
      {warn && !error ? (
        <Alert
          type="warning"
          showIcon
          message={warn}
          style={{ marginBottom: 16 }}
        />
      ) : null}
      {loading && !data ? (
        <div>
          <Row gutter={[16, 16]}>
            {Array.from({ length: 8 }).map((_, i) => (
              <Col key={i} xs={24} sm={12} lg={6} style={{ display: 'flex' }}>
                <Card
                  size="small"
                  className="overview-card"
                  style={{ width: '100%' }}
                >
                  <Skeleton.Button
                    active
                    size="small"
                    style={{ width: 92, height: 14 }}
                  />
                  <div style={{ marginTop: 14 }}>
                    <Skeleton.Button
                      active
                      size="large"
                      style={{ width: 72, height: 32 }}
                    />
                  </div>
                </Card>
              </Col>
            ))}
          </Row>
        </div>
      ) : (
        <>
          <MaasDashboardMetricRow
            data={data}
            connected={connected}
            machines={machines}
            regionCtrl={regionCtrl}
            rackCtrl={rackCtrl}
            onGoTab={goTab}
          />
          <MaasDashboardMachineStatusCard
            connected={connected}
            machines={machines}
            onGoTab={goTab}
          />
          <MaasDashboardEventsCard
            data={data}
            connected={connected}
            machines={machines}
          />
          <MaasDashboardPoolConfigCard cloud={cloud} />
          <MaasDashboardControllersBlock
            connected={connected}
            regionCtrl={regionCtrl}
            rackCtrl={rackCtrl}
          />
        </>
      )}
    </PageDetailSection>
  );
};

export default DashboardSection;
