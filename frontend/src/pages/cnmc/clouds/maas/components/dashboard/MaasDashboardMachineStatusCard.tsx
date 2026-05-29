import React from 'react';
import { HddTwoTone } from '@ant-design/icons';
import {
  OverviewCard,
  OverviewStatusBar,
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
    mk('ready', '可用', m?.ready ?? 0, '#52c41a', 'ready'),
    mk('deployed', '运行中', m?.deployed ?? 0, '#1677ff', 'deployed'),
    mk(
      'provisioning',
      '进行中',
      m?.provisioning ?? 0,
      '#faad14',
      'provisioning',
    ),
    mk('error', '异常', m?.error ?? 0, '#ff4d4f', 'error'),
    mk('other', '其它', m?.other ?? 0, '#bfbfbf', 'other'),
  ];

  return (
    <OverviewCard
      title="机器状态分布"
      icon={<HddTwoTone style={{ fontSize: 20 }} />}
      extra={
        <span style={{ fontSize: 12, color: 'rgba(0,0,0,.45)' }}>
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
