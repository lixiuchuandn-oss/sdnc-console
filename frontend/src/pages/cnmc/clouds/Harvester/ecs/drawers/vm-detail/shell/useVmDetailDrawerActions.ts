import React, { useCallback } from "react";
import { Modal, message } from "antd";
import { ExclamationCircleOutlined } from "@ant-design/icons";
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
      onRefresh && onRefresh(true);
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
      onRefresh && onRefresh(true);
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
      onRefresh && onRefresh(true);
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
      onRefresh && onRefresh(true);
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
      onRefresh && onRefresh(true);
    } catch (e: any) {
      message.error(e.message || "恢复失败");
    }
  };

  const handleConsole = async () => {
    if (!hasConsoleWrite) {
      message.error(
        "当前账号没有控制台操作权限（需要 clouds.console:write 权限）",
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
    Modal.confirm({
      title: "确认中止迁移？",
      icon: React.createElement(ExclamationCircleOutlined),
      content: `确定要中止虚拟机 ${SafeRead.name(vmData)} 的迁移任务吗？`,
      okText: "中止迁移",
      okType: "danger",
      onOk: async () => {
        const hide = message.loading("正在中止迁移...", 0);
        try {
          const ns = SafeRead.namespace(vmData);
          const name = SafeRead.vmId(vmData);
          const instanceId = `${ns}/${name}`;
          await abortHarvesterMigration(cloudId, instanceId);
          message.success("已发送中止迁移指令");
          onRefresh && onRefresh(true);
        } catch (e: any) {
          message.error(`中止迁移失败: ${e.message || "未知错误"}`);
        } finally {
          hide();
        }
      },
    });
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
