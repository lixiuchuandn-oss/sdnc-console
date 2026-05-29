import React from 'react';
import PageDetailSection from '../PageDetailSection';
import OverviewSectionSpin from './OverviewSectionSpin';

type Props = {
  loading?: boolean;
  /** 错误/警告提示，置于 Spin 外以便加载时仍可见 */
  alerts?: React.ReactNode;
  /** 资源池信息卡（含刷新钮） */
  poolCard: React.ReactNode;
  children: React.ReactNode;
};

/**
 * 资源池概览页统一布局：
 * 告警在外 → 资源池信息卡 + 下方内容共用一个 OverviewSectionSpin。
 */
const OverviewDashboardLayout: React.FC<Props> = ({ loading, alerts, poolCard, children }) => (
  <PageDetailSection asCard={false}>
    {alerts}
    <OverviewSectionSpin loading={loading}>
      {poolCard}
      {children}
    </OverviewSectionSpin>
  </PageDetailSection>
);

export default OverviewDashboardLayout;
