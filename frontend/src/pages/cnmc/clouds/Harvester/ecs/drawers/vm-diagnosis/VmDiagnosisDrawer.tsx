/**
 * 虚拟机启动/调度问题诊断抽屉（自包含模块，不依赖 vm-detail）。
 * 壳层与 VmSpecConfigDrawer 一致（VmSecondaryDrawerShell：无正文标题行）。
 */
import React from "react";
import VmSecondaryDrawerShell from "../shared/components/VmSecondaryDrawerShell";
import VmDiagnosisContent from "./VmDiagnosisContent";

export interface VmDiagnosisDrawerProps {
  open: boolean;
  onClose: () => void;
  cloudId?: string;
  vmData: any;
}

const VmDiagnosisDrawer: React.FC<VmDiagnosisDrawerProps> = ({
  open,
  onClose,
  cloudId,
  vmData,
}) => {
  return (
    <VmSecondaryDrawerShell open={open} onClose={onClose} destroyOnClose>
      <VmDiagnosisContent
        cloudId={cloudId}
        record={vmData}
        active={open}
      />
    </VmSecondaryDrawerShell>
  );
};

export default VmDiagnosisDrawer;
