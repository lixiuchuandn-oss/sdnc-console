/**
 * 详情抽屉右上角「⋯」操作下拉菜单（与 `VmDetailDrawerShell.tsx` 同级，属抽屉壳层 UI）。
 */
import { useMemo } from "react";
import type { MenuProps } from "antd";
import { message } from "antd";
import {
  CopyOutlined,
  SaveOutlined,
  StopOutlined,
  ExportOutlined,
  PoweroffOutlined,
  DeleteOutlined,
  AimOutlined,
  FileSearchOutlined,
  ApartmentOutlined,
  ShareAltOutlined,
  ClusterOutlined,
  CloudUploadOutlined,
  ThunderboltOutlined,
  ColumnWidthOutlined,
  SlidersOutlined,
  FundViewOutlined,
  DashboardOutlined,
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
  setNodeSchedulingOpen: (v: boolean) => void;
  setNodeAffinityOpen: (v: boolean) => void;
  setVmPolicyManageOpen: (v: boolean) => void;
  setCloudInitManageOpen: (v: boolean) => void;
  setPerformanceSettingsOpen: (v: boolean) => void;
  setHotplugSettingsOpen: (v: boolean) => void;
};

const ecsWriteMsg =
  "当前账号没有云主机操作权限（需要 clouds.ecs:write 或 clouds:write 权限）";

export function useVmDetailMoreMenu(ctx: ActionMenuCtx): MenuProps["items"] {
  const {
    vmData,
    hasEcsWrite,
    isRunning,
    isStopped,
    isMigrating,
    isCdromBoot,
    onClone,
    onMigrate,
    onDelete,
    setOpsYamlDrawerOpen,
    handleSaveAsTemplate,
    handleEjectCdrom,
    handleAbortMigration,
    handleStop,
    setDiagnosisDrawerOpen,
    setNodeSchedulingOpen,
    setNodeAffinityOpen,
    setVmPolicyManageOpen,
    setCloudInitManageOpen,
    setPerformanceSettingsOpen,
    setHotplugSettingsOpen,
  } = ctx;

  return useMemo(
    () => {
      const items: MenuProps["items"] = [
        {
          key: "clone",
          label: "克隆",
          icon: <CopyOutlined />,
          disabled: !hasEcsWrite,
          title: undefined,
          onClick: () => {
            if (!hasEcsWrite) {
              message.error(ecsWriteMsg);
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
                    message.error(ecsWriteMsg);
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
                    message.error(ecsWriteMsg);
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
                label: "弹出 CD-ROM",
                icon: <StopOutlined />,
                disabled: !hasEcsWrite,
                title: undefined,
                onClick: handleEjectCdrom,
              },
            ]
          : []),

        {
          key: "sub_perf_tune",
          label: "性能调优",
          icon: <DashboardOutlined />,
          disabled: !hasEcsWrite,
          children: [
            {
              key: "perf_settings",
              label: "性能设置",
              icon: <ThunderboltOutlined />,
              disabled: !hasEcsWrite,
              onClick: () => {
                if (!hasEcsWrite) {
                  message.error(ecsWriteMsg);
                  return;
                }
                setPerformanceSettingsOpen(true);
              },
            },
            {
              key: "hotplug_settings",
              label: "热扩容设置",
              icon: <ColumnWidthOutlined />,
              disabled: !hasEcsWrite,
              onClick: () => {
                if (!hasEcsWrite) {
                  message.error(ecsWriteMsg);
                  return;
                }
                setHotplugSettingsOpen(true);
              },
            },
          ],
        },

        {
          key: "sub_schedule_policy",
          label: "调度策略",
          icon: <SlidersOutlined />,
          disabled: !hasEcsWrite,
          children: [
            {
              key: "node_scheduling",
              label: "节点选择器",
              icon: <ApartmentOutlined />,
              disabled: !hasEcsWrite,
              onClick: () => {
                if (!hasEcsWrite) {
                  message.error(ecsWriteMsg);
                  return;
                }
                setNodeSchedulingOpen(true);
              },
            },
            {
              key: "node_affinity",
              label: "节点亲和性",
              icon: <ShareAltOutlined />,
              disabled: !hasEcsWrite,
              onClick: () => {
                if (!hasEcsWrite) {
                  message.error(ecsWriteMsg);
                  return;
                }
                setNodeAffinityOpen(true);
              },
            },
            {
              key: "vm_policy",
              label: "高可用设置",
              icon: <ClusterOutlined />,
              disabled: !hasEcsWrite,
              onClick: () => {
                if (!hasEcsWrite) {
                  message.error(ecsWriteMsg);
                  return;
                }
                setVmPolicyManageOpen(true);
              },
            },
          ],
        },

        {
          key: "cloud_init_manage",
          label: "CloudInit 管理",
          icon: <CloudUploadOutlined />,
          disabled: !hasEcsWrite,
          onClick: () => {
            if (!hasEcsWrite) {
              message.error(ecsWriteMsg);
              return;
            }
            setCloudInitManageOpen(true);
          },
        },

        {
          key: "sub_diagnosis",
          label: "诊断工具",
          icon: <FundViewOutlined />,
          children: [
            {
              key: "vm_diagnosis",
              label: "运行诊断",
              icon: <AimOutlined />,
              title: undefined,
              onClick: () => setDiagnosisDrawerOpen(true),
            },
            {
              key: "view_yaml",
              label: "查看 YAML",
              icon: <FileSearchOutlined />,
              title: undefined,
              onClick: () => {
                setOpsYamlDrawerOpen(true);
              },
            },
          ],
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
              message.error(ecsWriteMsg);
              return;
            }
            onDelete && onDelete(vmData);
          },
        },
      ] as MenuProps["items"];

      if (hasEcsWrite) return items;

      const readonlyKeys = new Set(["sub_diagnosis"]);
      const compact = (src: MenuProps["items"]): MenuProps["items"] => {
        const out: NonNullable<MenuProps["items"]> = [];
        for (const it of src || []) {
          if (!it) continue;
          if (typeof it === "object" && "type" in it && it.type === "divider") {
            const prev = out[out.length - 1] as any;
            if (!out.length || (prev && prev.type === "divider")) continue;
            out.push(it);
            continue;
          }
          out.push(it);
        }
        while (out.length) {
          const last = out[out.length - 1] as any;
          if (last && last.type === "divider") out.pop();
          else break;
        }
        return out;
      };

      return compact(
        (items || []).filter((it) => {
          if (!it || typeof it !== "object" || !("key" in it)) return false;
          const k = String((it as any).key || "");
          return readonlyKeys.has(k);
        }),
      );
    },
    [
      vmData,
      hasEcsWrite,
      isRunning,
      isStopped,
      isMigrating,
      isCdromBoot,
      onClone,
      onMigrate,
      onDelete,
      setOpsYamlDrawerOpen,
      handleSaveAsTemplate,
      handleEjectCdrom,
      handleAbortMigration,
      handleStop,
      setDiagnosisDrawerOpen,
      setNodeSchedulingOpen,
      setNodeAffinityOpen,
      setVmPolicyManageOpen,
      setCloudInitManageOpen,
      setPerformanceSettingsOpen,
      setHotplugSettingsOpen,
    ],
  );
}
