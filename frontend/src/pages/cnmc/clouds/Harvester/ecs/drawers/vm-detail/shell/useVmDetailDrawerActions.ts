import React, { useCallback } from "react";
import { message } from "antd";
import {
  pauseHarvesterVm,
  unpauseHarvesterVm,
  abortHarvesterMigration,
} from "../../../../../../../../services/harvesterApi";
import {
  rebootCloudProviderEcs,
  startCloudProviderEcs,
  stopCloudProviderEcs,
} from "../../../../../../../../services/api";
import type { VmDetailDrawerSafeRead } from "../../../lib/vmSafeRead";
import { runHarvesterSectionRefresh } from "../../../../shared/lib/harvesterSectionRefresh";
import {
  confirmHighRiskOperation,
} from "../../../../shared/lib/highRiskConfirm";
import { VM_ABORT_MIGRATION_RISK_ITEMS } from "../../../../shared/lib/highRiskOperationPresets";
import { openVmDetailEjectCdromModal } from "../VmDetailEjectCdromModal";

export function useVmDetailDrawerActions(opts: {
  cloudId: string;
  vmData: any;
  SafeRead: VmDetailDrawerSafeRead;
  hasEcsWrite: boolean;
  hasConsoleWrite: boolean;
  onRefresh?: (force?: boolean) => void;
  setShowTemplateModal: (v: boolean) => void;
}) {
  const {
    cloudId,
    vmData,
    SafeRead,
    hasEcsWrite,
    hasConsoleWrite,
    onRefresh,
    setShowTemplateModal,
  } = opts;

  const handleStart = async () => {
    if (!hasEcsWrite) {
      message.error(
        "当前账号没有云主机操作权限（需要 clouds.ecs:write 或 clouds:write 权限）",
      );
      return;
    }
    try {
      const ns = SafeRead.namespace(vmData);
      const name = SafeRead.vmId(vmData);
      await startCloudProviderEcs(cloudId, `${ns}/${name}`);
      message.success("启动指令已发送");
      void runHarvesterSectionRefresh(onRefresh, { force: true });
    } catch (e: any) {
      message.error(e.message || "启动失败");
    }
  };

  const handleStop = async (force = false) => {
    if (!hasEcsWrite) {
      message.error(
        "当前账号没有云主机操作权限（需要 clouds.ecs:write 或 clouds:write 权限）",
      );
      return;
    }
    try {
      const ns = SafeRead.namespace(vmData);
      const name = SafeRead.vmId(vmData);
      await stopCloudProviderEcs(cloudId, `${ns}/${name}`, force);
      message.success("停止指令已发送");
      void runHarvesterSectionRefresh(onRefresh, { force: true });
    } catch (e: any) {
      message.error(e.message || "停止失败");
    }
  };

  const handleReboot = async () => {
    if (!hasEcsWrite) {
      message.error(
        "当前账号没有云主机操作权限（需要 clouds.ecs:write 或 clouds:write 权限）",
      );
      return;
    }
    try {
      const ns = SafeRead.namespace(vmData);
      const name = SafeRead.vmId(vmData);
      const instanceId = `${ns}/${name}`;
      await rebootCloudProviderEcs(cloudId, instanceId);
      message.success("重启指令已发送");
      void runHarvesterSectionRefresh(onRefresh, { force: true });
    } catch (e: any) {
      message.error(e.message || "重启失败");
    }
  };

  const handlePause = async () => {
    if (!hasEcsWrite) {
      message.error(
        "当前账号没有云主机操作权限（需要 clouds.ecs:write 或 clouds:write 权限）",
      );
      return;
    }
    try {
      const ns = SafeRead.namespace(vmData);
      const name = SafeRead.vmId(vmData);
      await pauseHarvesterVm(cloudId, ns, name);
      message.success("暂停指令已发送");
      void runHarvesterSectionRefresh(onRefresh, { force: true });
    } catch (e: any) {
      message.error(e.message || "暂停失败");
    }
  };

  const handleUnpause = async () => {
    if (!hasEcsWrite) {
      message.error(
        "当前账号没有云主机操作权限（需要 clouds.ecs:write 或 clouds:write 权限）",
      );
      return;
    }
    try {
      const ns = SafeRead.namespace(vmData);
      const name = SafeRead.vmId(vmData);
      await unpauseHarvesterVm(cloudId, ns, name);
      message.success("恢复指令已发送");
      void runHarvesterSectionRefresh(onRefresh, { force: true });
    } catch (e: any) {
      message.error(e.message || "恢复失败");
    }
  };

  const handleConsole = async () => {
    if (!hasConsoleWrite) {
      message.error(
        "当前账号没有控制台操作权限（需要 clouds.ecs:write 权限）",
      );
      return;
    }
    const ns = SafeRead.namespace(vmData);
    const name = SafeRead.vmId(vmData);
    if (ns && name) {
      const url = `/clouds/${encodeURIComponent(cloudId)}/harvester/vnc?cloudId=${encodeURIComponent(cloudId)}&namespace=${encodeURIComponent(ns)}&name=${encodeURIComponent(name)}`;
      window.open(url, "_blank");
    } else {
      message.warning("无法解析实例信息");
    }
  };

  const handleSaveAsTemplate = useCallback(async () => {
    if (!hasEcsWrite) {
      message.error(
        "当前账号没有云主机操作权限（需要 clouds.ecs:write 或 clouds:write 权限）",
      );
      return;
    }
    setShowTemplateModal(true);
  }, [hasEcsWrite, setShowTemplateModal]);

  const handleEjectCdrom = useCallback(() => {
    openVmDetailEjectCdromModal({
      vmData,
      cloudId,
      SafeRead,
      hasEcsWrite,
      onRefresh,
    });
  }, [cloudId, vmData, onRefresh, SafeRead, hasEcsWrite]);

  const handleAbortMigration = useCallback(() => {
    const vmName = SafeRead.name(vmData);
    void confirmHighRiskOperation({
      title: "确认中止迁移？",
      description: `确定要中止虚拟机 ${vmName} 的迁移任务吗？`,
      riskItems: VM_ABORT_MIGRATION_RISK_ITEMS,
      targetName: vmName,
      operationSummary: `中止虚拟机「${vmName}」的迁移任务`,
      confirmText: "中止迁移",
      onConfirm: async () => {
        const hide = message.loading("正在中止迁移...", 0);
        try {
          const ns = SafeRead.namespace(vmData);
          const name = SafeRead.vmId(vmData);
          const instanceId = `${ns}/${name}`;
          await abortHarvesterMigration(cloudId, instanceId);
          message.success("已发送中止迁移指令");
          void runHarvesterSectionRefresh(onRefresh, { force: true });
        } catch (e: any) {
          message.error(`中止迁移失败: ${e.message || "未知错误"}`);
          throw e;
        } finally {
          hide();
        }
      },
    }).catch(() => {});
  }, [cloudId, vmData, onRefresh, SafeRead]);

  return {
    handleStart,
    handleStop,
    handleReboot,
    handlePause,
    handleUnpause,
    handleConsole,
    handleSaveAsTemplate,
    handleEjectCdrom,
    handleAbortMigration,
  };
}
