import React from 'react';
import { HddOutlined } from '@ant-design/icons';
import {
  OVERVIEW_COLORS,
  OverviewCard,
  OverviewStatusBar,
  overviewTitleIcon,
  type OverviewStatusSegment,
} from '../../../../../../components/overview';
import type { MaasDashboardResponse } from '../../../../../../services/maasApi';

type Props = {
  connected: boolean;
  machines: MaasDashboardResponse['machines'] | undefined;
  onGoTab: (tab: 'machines', extra?: string) => void;
};

/** 机器状态分布：可用/运行中/进行中/异常/其它 一眼可见，图例可下钻机器列表 */
const MaasDashboardMachineStatusCard: React.FC<Props> = ({
  connected,
  machines,
  onGoTab,
}) => {
  const m = machines;
  const mk = (
    key: string,
    label: string,
    value: number,
    color: string,
    bucket: string,
  ): OverviewStatusSegment => ({
    key,
    label,
    value,
    color,
    onClick:
      connected && value > 0
        ? () => onGoTab('machines', `status=${bucket}`)
        : undefined,
  });

  const segments: OverviewStatusSegment[] = [
    mk('ready', '可用', m?.ready ?? 0, OVERVIEW_COLORS.success, 'ready'),
    mk('deployed', '运行中', m?.deployed ?? 0, OVERVIEW_COLORS.primary, 'deployed'),
    mk(
      'provisioning',
      '进行中',
      m?.provisioning ?? 0,
      OVERVIEW_COLORS.warning,
      'provisioning',
    ),
    mk('error', '异常', m?.error ?? 0, OVERVIEW_COLORS.error, 'error'),
    mk('other', '其它', m?.other ?? 0, '#bfbfbf', 'other'),
  ];

  return (
    <OverviewCard
      title="机器状态分布"
      icon={overviewTitleIcon(<HddOutlined />)}
      extra={
        <span style={{ fontSize: 12, color: OVERVIEW_COLORS.textSecondary }}>
          共 {connected ? (m?.total ?? 0) : '—'} 台
        </span>
      }
      style={{ marginTop: 16 }}
      bodyStyle={{ padding: '16px 20px 20px' }}
    >
      <OverviewStatusBar segments={segments} total={connected ? m?.total : 0} />
    </OverviewCard>
  );
};

export default MaasDashboardMachineStatusCard;
