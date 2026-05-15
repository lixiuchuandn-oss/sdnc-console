/**
 * 详情抽屉右上角「⋯」操作下拉菜单（与 `VmDetailDrawerShell.tsx` 同级，属抽屉壳层 UI）。
 */
import { useMemo } from "react";
import type { MenuProps } from "antd";
import { message } from "antd";
import {
  DatabaseOutlined,
  HistoryOutlined,
  CopyOutlined,
  SaveOutlined,
  StopOutlined,
  ExportOutlined,
  PoweroffOutlined,
  DeleteOutlined,
  AimOutlined,
  ExceptionOutlined,
  FileSearchOutlined,
} from "@ant-design/icons";
import type { VmDetailDrawerProps } from "./shell/types";

type ActionMenuCtx = Pick<
  VmDetailDrawerProps,
  "onBackup" | "onSnapshot" | "onClone" | "onMigrate" | "onDelete"
> & {
  vmData: any;
  hasEcsWrite: boolean;
  isRunning: boolean;
  isStopped: boolean;
  isMigrating: boolean;
  isCdromBoot: boolean;
  setOpsYamlDrawerOpen: (v: boolean) => void;
  handleSaveAsTemplate: () => void;
  handleEjectCdrom: () => void;
  handleAbortMigration: () => void;
  handleStop: (force?: boolean) => void;
  setDiagnosisDrawerOpen: (v: boolean) => void;
  setRealtimeLogsDrawerOpen: (v: boolean) => void;
};

export function useVmDetailMoreMenu(ctx: ActionMenuCtx): MenuProps["items"] {
  const {
    vmData,
    hasEcsWrite,
    isRunning,
    isStopped,
    isMigrating,
    isCdromBoot,
    onBackup,
    onSnapshot,
    onClone,
    onMigrate,
    onDelete,
    setOpsYamlDrawerOpen,
    handleSaveAsTemplate,
    handleEjectCdrom,
    handleAbortMigration,
    handleStop,
    setDiagnosisDrawerOpen,
    setRealtimeLogsDrawerOpen,
  } = ctx;

  return useMemo(
    () =>
      [
        {
          key: "clone",
          label: "克隆",
          icon: <CopyOutlined />,
          disabled: !hasEcsWrite,
          title: undefined,
          onClick: () => {
            if (!hasEcsWrite) {
              message.error(
                "当前账号没有云主机操作权限（需要 clouds.ecs:write 或 clouds:write 权限）",
              );
              return;
            }
            onClone && onClone(vmData);
          },
        },
        {
          key: "save_template",
          label: "保存模板",
          icon: <SaveOutlined />,
          disabled: !hasEcsWrite,
          title: undefined,
          onClick: handleSaveAsTemplate,
        },

        ...(isMigrating
          ? [
              {
                key: "abort_migration",
                label: "中止迁移",
                icon: <StopOutlined />,
                disabled: !hasEcsWrite,
                title: undefined,
                danger: true,
                onClick: () => {
                  if (!hasEcsWrite) {
                    message.error(
                      "当前账号没有云主机操作权限（需要 clouds.ecs:write 或 clouds:write 权限）",
                    );
                    return;
                  }
                  handleAbortMigration();
                },
              },
            ]
          : [
              {
                key: "migrate",
                label: "热迁移",
                icon: <ExportOutlined />,
                disabled: !hasEcsWrite || !isRunning,
                title: !isRunning
                  ? "只有运行中的实例才能进行热迁移"
                  : undefined,
                onClick: () => {
                  if (!hasEcsWrite) {
                    message.error(
                      "当前账号没有云主机操作权限（需要 clouds.ecs:write 或 clouds:write 权限）",
                    );
                    return;
                  }
                  onMigrate && onMigrate(vmData);
                },
              },
            ]),
        ...(isCdromBoot
          ? [
              {
                key: "eject",
                label: "弹出CD-ROM",
                icon: <StopOutlined />,
                disabled: !hasEcsWrite,
                title: undefined,
                onClick: handleEjectCdrom,
              },
            ]
          : []),

        { type: "divider" },
        {
          key: "vm_diagnosis",
          label: "运行诊断",
          icon: <AimOutlined />,
          title: undefined,
          onClick: () => setDiagnosisDrawerOpen(true),
        },
        {
          key: "view_yaml",
          label: "查看YAML",
          icon: <FileSearchOutlined />,
          title: undefined,
          onClick: () => {
            setOpsYamlDrawerOpen(true);
          },
        },

        { type: "divider" },

        {
          key: "force_stop",
          label: "强制停止",
          icon: <PoweroffOutlined />,
          danger: true,
          disabled: !hasEcsWrite || isStopped,
          title: undefined,
          onClick: () => handleStop(true),
        },
        {
          key: "delete",
          label: "删除",
          icon: <DeleteOutlined />,
          danger: true,
          disabled: !hasEcsWrite,
          title: undefined,
          onClick: () => {
            if (!hasEcsWrite) {
              message.error(
                "当前账号没有云主机操作权限（需要 clouds.ecs:write 或 clouds:write 权限）",
              );
              return;
            }
            onDelete && onDelete(vmData);
          },
        },
      ] as MenuProps["items"],
    [
      vmData,
      hasEcsWrite,
      isRunning,
      isStopped,
      isMigrating,
      isCdromBoot,
      onBackup,
      onSnapshot,
      onClone,
      onMigrate,
      onDelete,
      setOpsYamlDrawerOpen,
      handleSaveAsTemplate,
      handleEjectCdrom,
      handleAbortMigration,
      handleStop,
      setDiagnosisDrawerOpen,
      setRealtimeLogsDrawerOpen,
    ],
  );
}
