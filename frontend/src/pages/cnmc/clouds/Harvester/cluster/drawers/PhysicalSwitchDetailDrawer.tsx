/**
 * 物理交换机（ASW-CTL 单实例）侧滑详情 — 归属 Harvester/cluster/drawers。
 * 端口前面板在 Cloudmap「资源总览 → 机房拓扑」机柜内嵌 `embeddedSwitchPortPanel`。
 */
import React from 'react';
import { Button, Drawer } from 'antd';
import PhysicalSwitchProbeTabs, {
  type PhysicalSwitchProbeTabKey,
} from '../components/PhysicalSwitchProbeTabs';

export type PhysicalSwitchDetailDrawerProps = {
  open: boolean;
  record: any | null;
  onClose: () => void;
  /** 本次打开抽屉时默认选中的 Tab（仅在 open 由关→开时应用一次） */
  initialTab?: PhysicalSwitchProbeTabKey;
  /** 从集群重新拉取 ASW-CTL 列表/探测数据（由 Section 注入）；与云详情 `onRefresh(force)` 约定一致 */
  onRefreshFromCluster?: (force?: boolean) => void;
  refreshLoading?: boolean;
};

const PhysicalSwitchDetailDrawer: React.FC<PhysicalSwitchDetailDrawerProps> = ({
  open,
  record,
  onClose,
  initialTab = 'overview',
  onRefreshFromCluster,
  refreshLoading = false,
}) => {
  return (
    <Drawer
      title="交换机详情"
      extra={
        onRefreshFromCluster ? (
          <Button size="small" onClick={() => onRefreshFromCluster(true)} loading={refreshLoading}>
            刷新
          </Button>
        ) : null
      }
      placement="right"
      width="min(1000px, 96vw)"
      open={open && !!record}
      onClose={onClose}
      destroyOnHidden
    >
      {record ? <PhysicalSwitchProbeTabs record={record} initialTab={initialTab} /> : null}
    </Drawer>
  );
};

export default PhysicalSwitchDetailDrawer;
