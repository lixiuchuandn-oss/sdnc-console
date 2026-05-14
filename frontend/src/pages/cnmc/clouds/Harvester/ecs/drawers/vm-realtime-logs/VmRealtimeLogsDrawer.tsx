/**
 * 虚拟机实时日志抽屉（自包含模块）。
 * 壳层与 VmSpecConfigDrawer 一致（VmSecondaryDrawerShell：无正文标题行）。
 */
import React from "react";
import VmSecondaryDrawerShell from "../shared/components/VmSecondaryDrawerShell";
import VmRealtimeLogsContent from "./VmRealtimeLogsContent";

export interface VmRealtimeLogsDrawerProps {
  open: boolean;
  onClose: () => void;
  cloudId?: string;
  vmData: any;
}

const VmRealtimeLogsDrawer: React.FC<VmRealtimeLogsDrawerProps> = ({
  open,
  onClose,
  cloudId,
  vmData,
}) => {
  return (
    <VmSecondaryDrawerShell
      open={open}
      onClose={onClose}
      fillViewport
      destroyOnHidden
    >
      <VmRealtimeLogsContent
        cloudId={cloudId}
        record={vmData}
        active={open}
      />
    </VmSecondaryDrawerShell>
  );
};

export default VmRealtimeLogsDrawer;
