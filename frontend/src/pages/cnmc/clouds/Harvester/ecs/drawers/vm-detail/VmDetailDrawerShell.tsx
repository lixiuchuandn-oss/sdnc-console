/**
 * 虚拟机详情抽屉 · 壳层 UI：`VmDetailDrawer`（数据装配）+ `VmDetailDrawerShell`（Drawer/工具栏/Tab 骨架）。
 * 默认导出为对外入口；样式 token 同步导出。
 */
import React, { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import {
  Drawer,
  Segmented,
  Button,
  Dropdown,
  Tag,
  Tooltip,
  message,
} from "antd";
import {
  PlayCircleOutlined,
  PoweroffOutlined,
  ReloadOutlined,
  PauseCircleOutlined,
  CodeOutlined,
  EllipsisOutlined,
  DesktopOutlined,
  DatabaseOutlined,
  CloseOutlined,
  SyncOutlined,
  LineChartOutlined,
  InfoCircleOutlined,
  ExclamationCircleOutlined,
  SlidersOutlined,
} from "@ant-design/icons";
import { cnVmStatus } from "../../../../../../../utils/harvesterUtils";
import { runHarvesterSectionRefresh } from "../../../shared/lib/harvesterSectionRefresh";
import { VmPerformance } from "./tabs/VmPerformance";
import VmBackupTab from "./tabs/VmBackupTab";
import VmDetailTab from "./tabs/VmDetailTab";
import VmNicManageDrawer from "../vm-nic-manage";
import VmDiskManageDrawer from "../vm-disk-manage";
import VmCloudInitDrawer from "../vm-cloud-init";
import VmSpecConfigDrawer from "../vm-spec-config/VmSpecConfigDrawer";
import VmSpecPerformanceDrawer from "../vm-spec-config/VmSpecPerformanceDrawer";
import VmHotplugSettingsDrawer from "../vm-spec-config/VmHotplugSettingsDrawer";
import {
  VmNodeAffinityDrawer,
  VmNodeSchedulingDrawer,
  VmPodAffinityDrawer,
} from "../vm-node-scheduling";
import { VmVmPolicyDrawer } from "../vm-vm-policy";
import VmGpuManageDrawer from "../vm-gpu-manage";
import VmUsbManageDrawer from "../vm-usb-manage";
import VmDiagnosisDrawer from "../vm-diagnosis";
import VmRealtimeLogsDrawer from "../vm-realtime-logs";
import { OsIcon } from "../../../../../../../components/OsIcon";
import VmSaveAsTemplateModal from "../../modals/VmSaveAsTemplateModal";
import {
  VM_DETAIL_DRAWER_TEXT_SECONDARY,
} from "./lib/uiTokens";
import type { MenuProps } from "antd";
import type { VmDetailDrawerSafeRead } from "../../lib/vmSafeRead";
import type { VmDetailDrawerProps } from "./shell/types";
import { useEnsureHarvesterNadsLoaded } from "../shared/lib/useEnsureHarvesterNadsLoaded";

const LazyHarvesterCrdMetadataDrawer = React.lazy(
  () => import("../../../shared/components/HarvesterCrdMetadataDrawer"),
);

export type VmDetailDrawerShellProps = Pick<
  VmDetailDrawerProps,
  | "open"
  | "onClose"
  | "record"
  | "cloudId"
  | "namespaces"
  | "onRefresh"
  | "onBackupsInventoryChanged"
> & {
  vmData: any;
  SafeRead: VmDetailDrawerSafeRead;
  refreshing: boolean;
  fetchAggregated: (manual?: boolean) => Promise<void>;
  activeTab: string;
  handleTabChange: (key: string) => void;
  hasEcsWrite: boolean;
  hasConsoleWrite: boolean;
  cpuUsage: number | null;
  memUsage: number | null;
  backups: any[];
  schedules: any[];
  backupsLoading: boolean;
  schedulesLoading: boolean;
  fetchBackups: (force?: boolean, skipSync?: boolean) => Promise<void>;
  fetchSchedules: (force?: boolean, skipSync?: boolean) => Promise<void>;
  nads: any[];
  vpcs: any[];
  subnets: any[];
  nicManageOpen: boolean;
  setNicManageOpen: (v: boolean) => void;
  diskManageOpen: boolean;
  setDiskManageOpen: (v: boolean) => void;
  cloudInitManageOpen: boolean;
  setCloudInitManageOpen: (v: boolean) => void;
  vmPolicyManageOpen: boolean;
  setVmPolicyManageOpen: (v: boolean) => void;
  vmPolicyDrawerLatestVm: any;
  setVmPolicyDrawerLatestVm: (v: any) => void;
  gpuManageOpen: boolean;
  setGpuManageOpen: (v: boolean) => void;
  gpuDrawerLatestVm: any;
  setGpuDrawerLatestVm: (v: any) => void;
  usbManageOpen: boolean;
  setUsbManageOpen: (v: boolean) => void;
  usbDrawerLatestVm: any;
  setUsbDrawerLatestVm: (v: any) => void;
  specConfigOpen: boolean;
  setSpecConfigOpen: (v: boolean) => void;
  performanceSettingsOpen: boolean;
  setPerformanceSettingsOpen: (v: boolean) => void;
  perfDrawerLatestVm: any;
  setPerfDrawerLatestVm: (v: any) => void;
  hotplugSettingsOpen: boolean;
  setHotplugSettingsOpen: (v: boolean) => void;
  hotplugDrawerLatestVm: any;
  setHotplugDrawerLatestVm: (v: any) => void;
  nodeSchedulingOpen: boolean;
  setNodeSchedulingOpen: (v: boolean) => void;
  nodeAffinityOpen: boolean;
  setNodeAffinityOpen: (v: boolean) => void;
  podAffinityOpen: boolean;
  setPodAffinityOpen: (v: boolean) => void;
  nodeSchedDrawerLatestVm: any;
  setNodeSchedDrawerLatestVm: (v: any) => void;
  showTemplateModal: boolean;
  setShowTemplateModal: (v: boolean) => void;
  opsYamlDrawerOpen: boolean;
  setOpsYamlDrawerOpen: (v: boolean) => void;
  diagnosisDrawerOpen: boolean;
  setDiagnosisDrawerOpen: (v: boolean) => void;
  realtimeLogsDrawerOpen: boolean;
  setRealtimeLogsDrawerOpen: (v: boolean) => void;
  actionItems: MenuProps["items"];
  status: string;
  hasGenerationInfo: boolean;
  isConfigOutOfSync: boolean;
  vmGeneration: number | undefined;
  observedGeneration: number | undefined;
  isHotPlugConfigured: boolean;
  isRunning: boolean;
  isHotPlugPendingRestart: boolean;
  isHotPlugInProgress: boolean;
  isHotPlugEffective: boolean;
  isMigratable: boolean;
  hotPlugCpuError: any;
  vmDisks: any[];
  vmNics: any[];
  vmPassthroughNics: any[];
  vmGpus: any[];
  vmUsb: any[];
  isStopped: boolean;
  isPaused: boolean;
  handleConsole: () => void;
  handleStart: () => void;
  handleStop: (force?: boolean) => void;
  handleReboot: () => void;
  handlePause: () => void;
  handleUnpause: () => void;
  vmImages: any[];
  /** 详情与 GPU 抽屉共用的集群 GPU 资源列表；未定义时由 GPU 抽屉自行拉取 */
  vmDetailGpuResources?: any[];
  /** 详情与 USB 抽屉共用的 USB 资源列表；未定义时由 USB 抽屉自行拉取 */
  vmDetailUsbResources?: any[];
};

const VmDetailDrawerShell: React.FC<VmDetailDrawerShellProps> = (p) => {
  const cloudId = p.cloudId ?? "";
  /** 查看 YAML：首次打开后保持挂载，仅用 open 切换，以便关闭抽屉有关闭动画并与父抽屉 push 同步 */
  const [yamlDrawerEverOpened, setYamlDrawerEverOpened] = useState(false);
  useEffect(() => {
    if (p.opsYamlDrawerOpen) setYamlDrawerEverOpened(true);
  }, [p.opsYamlDrawerOpen]);
  const { ensureNadsLoaded } = useEnsureHarvesterNadsLoaded(cloudId);

  const ecsWriteDenied = useCallback(() => {
    message.error(
      "当前账号没有云主机操作权限（需要 clouds.ecs:write 或 clouds:write 权限）",
    );
  }, []);

  const resourceConfigMenuItems: MenuProps["items"] = useMemo(() => {
    const gated = (fn: () => void) => () => {
      if (!p.hasEcsWrite) {
        ecsWriteDenied();
        return;
      }
      fn();
    };
    const d = !p.hasEcsWrite;
    return [
      {
        key: "toolbar_spec_adjust",
        label: "调整规格",
        disabled: d,
        onClick: gated(() => p.setSpecConfigOpen(true)),
      },
      {
        key: "toolbar_disk_manage",
        label: "磁盘管理",
        disabled: d,
        onClick: gated(() => p.setDiskManageOpen(true)),
      },
      {
        key: "toolbar_nic_manage",
        label: "网卡管理",
        disabled: d,
        onClick: gated(() => p.setNicManageOpen(true)),
      },
      {
        key: "toolbar_gpu",
        label: "GPU管理",
        disabled: d,
        onClick: gated(() => p.setGpuManageOpen(true)),
      },
      {
        key: "toolbar_usb",
        label: "USB管理",
        disabled: d,
        onClick: gated(() => p.setUsbManageOpen(true)),
      },
    ];
  }, [p, ecsWriteDenied]);

  return (
    <>
      <Drawer
        open={p.open}
        onClose={p.onClose}
        width={800}
        placement="right"
        closable={false}
        zIndex={1000}
        keyboard={
          !(
            p.specConfigOpen ||
            p.performanceSettingsOpen ||
            p.hotplugSettingsOpen ||
            p.nicManageOpen ||
            p.diskManageOpen ||
            p.cloudInitManageOpen ||
            p.vmPolicyManageOpen ||
            p.gpuManageOpen ||
            p.usbManageOpen ||
            p.nodeSchedulingOpen ||
            p.nodeAffinityOpen ||
            p.podAffinityOpen ||
            p.opsYamlDrawerOpen
          )
        }
        push={{ distance: 180 }}
        styles={{
          content: { background: "#fff" },
          body: {
            padding: 0,
            background: "#fff",
            display: "flex",
            flexDirection: "column",
            fontFamily: "inherit",
            fontSize: 14,
          },
        }}
      >
        <div
          style={{
            background: "#fff",
            padding: "16px 24px",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            flexShrink: 0,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div
              style={{
                width: 38,
                height: 38,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <OsIcon
                osName={p.SafeRead.osName(p.vmData)}
                style={{ fontSize: 32 }}
              />
            </div>
            <div>
              <div style={{ fontSize: 14, fontWeight: 500, lineHeight: 1.2 }}>
                {p.SafeRead.name(p.vmData)}
              </div>
              <div style={{ fontSize: 12, color: VM_DETAIL_DRAWER_TEXT_SECONDARY }}>
                ID: {p.SafeRead.vmId(p.vmData)}
              </div>
            </div>
            <Tag
              color={p.isRunning ? "success" : "default"}
              style={{ margin: 0 }}
            >
              {cnVmStatus(p.status)}
            </Tag>

            {p.hasGenerationInfo && (
              <Tooltip
                title={
                  p.isConfigOutOfSync
                    ? `配置未完全同步：当前 VM generation = ${p.vmGeneration}，最新已同步版本 = ${p.observedGeneration}。这通常表示最近一次规格/配置变更仍在同步或落盘过程中。`
                    : `配置已同步：当前 VM generation = ${p.vmGeneration}，同步版本 = ${p.observedGeneration}。`
                }
              >
                <Tag
                  color={p.isConfigOutOfSync ? "processing" : "default"}
                  style={{
                    margin: 0,
                    display: "flex",
                    alignItems: "center",
                    gap: 4,
                  }}
                >
                  <InfoCircleOutlined />
                  {p.isConfigOutOfSync ? "变更同步中" : "配置已同步"}
                </Tag>
              </Tooltip>
            )}

            {p.isHotPlugConfigured &&
              (p.isRunning || p.isHotPlugPendingRestart) && (
                <Tooltip
                  title={
                    p.isHotPlugInProgress
                      ? "热扩容进行中：当前正在执行 CPU 或内存热扩容操作，期间禁止再次发起新的热扩容/规格变更。"
                      : p.isHotPlugPendingRestart
                        ? "热扩容已配置但未完全生效：需要先重启虚拟机，才能开启 CPU/内存热插拔能力。"
                        : p.isHotPlugEffective
                          ? "热扩容已启用：当前虚拟机支持在不重启的前提下增加 CPU / 内存（受 maxSockets/maxMemory 上限约束）。"
                          : p.isHotPlugConfigured && !p.isMigratable
                            ? "热扩容不可用：CPU 和内存热扩容都需要 VM 可迁移（当前不可迁移），请检查 PVC 是否为共享存储（ReadWriteMany）或移除阻止迁移的设备。"
                            : "热扩容状态异常：已存在配置标记，但状态条件无法判定为生效/在途/待重启，请查看事件或日志。"
                  }
                >
                  <Tag
                    color={
                      p.isHotPlugInProgress
                        ? "processing"
                        : p.isHotPlugPendingRestart
                          ? "warning"
                          : p.isHotPlugEffective
                            ? "success"
                            : p.isHotPlugConfigured && !p.isMigratable
                              ? "warning"
                              : "default"
                    }
                    style={{
                      margin: 0,
                      display: "flex",
                      alignItems: "center",
                      gap: 4,
                    }}
                  >
                    <InfoCircleOutlined />
                    {p.isHotPlugInProgress
                      ? "热扩容中"
                      : p.isHotPlugPendingRestart
                        ? "热扩容待重启"
                        : p.isHotPlugEffective
                          ? "热扩容已启用"
                          : p.isHotPlugConfigured && !p.isMigratable
                            ? "热扩容不可用"
                            : "热扩容异常"}
                  </Tag>
                </Tooltip>
              )}

            {p.hotPlugCpuError && (
              <Tooltip
                title={`CPU 热插拔失败: ${p.hotPlugCpuError.message || "未知错误"}`}
              >
                <Tag
                  color="error"
                  style={{
                    margin: 0,
                    display: "flex",
                    alignItems: "center",
                    gap: 4,
                  }}
                >
                  <ExclamationCircleOutlined /> CPU 热插拔失败
                </Tag>
              </Tooltip>
            )}
          </div>
          <div style={{ display: "flex", alignItems: "center" }}>
            <Button
              type="text"
              icon={<SyncOutlined spin={p.refreshing} />}
              onClick={() => p.fetchAggregated(true)}
              style={{
                width: 32,
                height: 32,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                borderRadius: 4,
                padding: 0,
                color: VM_DETAIL_DRAWER_TEXT_SECONDARY,
              }}
            />
            <Button
              type="text"
              onClick={p.onClose}
              style={{
                width: 32,
                height: 32,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                borderRadius: 4,
                fontSize: 16,
                padding: 0,
                color: VM_DETAIL_DRAWER_TEXT_SECONDARY,
              }}
            >
              <CloseOutlined />
            </Button>
          </div>
        </div>

        <div
          style={{
            background: "#fff",
            padding: "0 24px 4px",
            flexShrink: 0,
          }}
        >
          <div
            style={{
              padding: 4,
              background: "#fff",
              borderRadius: 8,
              display: "flex",
              gap: 4,
              alignItems: "center",
              border: "1px solid #e0e0e0",
            }}
          >
            <Tooltip title={undefined}>
              <span>
                {p.hasConsoleWrite ? (
                  <Button
                    className="vm-toolbar-btn"
                    type="text"
                    size="small"
                    icon={
                      <CodeOutlined
                        style={{ color: p.isStopped ? undefined : "#1890ff" }}
                      />
                    }
                    onClick={p.handleConsole}
                    disabled={p.isStopped}
                    style={{ fontSize: 14 }}
                  >
                    打开终端
                  </Button>
                ) : null}
              </span>
            </Tooltip>

            {p.hasEcsWrite ? (
              <>
                <Tooltip title={undefined}>
                  <span>
                    <Button
                      className="vm-toolbar-btn"
                      type="text"
                      size="small"
                      icon={
                        <PlayCircleOutlined
                          style={{ color: p.isStopped ? "#1890ff" : undefined }}
                        />
                      }
                      onClick={p.handleStart}
                      disabled={!p.isStopped}
                      style={{ fontSize: 14 }}
                    >
                      开机
                    </Button>
                  </span>
                </Tooltip>

                <Tooltip title={undefined}>
                  <span>
                    <Button
                      className="vm-toolbar-btn"
                      type="text"
                      size="small"
                      icon={
                        <PoweroffOutlined
                          style={{ color: p.isStopped ? undefined : "#1890ff" }}
                        />
                      }
                      onClick={() => p.handleStop(false)}
                      disabled={p.isStopped}
                      style={{ fontSize: 14 }}
                    >
                      关机
                    </Button>
                  </span>
                </Tooltip>

                <Tooltip title={undefined}>
                  <span>
                    <Button
                      className="vm-toolbar-btn"
                      type="text"
                      size="small"
                      icon={
                        <ReloadOutlined
                          style={{ color: p.isStopped ? undefined : "#1890ff" }}
                        />
                      }
                      onClick={p.handleReboot}
                      disabled={p.isStopped}
                      style={{ fontSize: 14 }}
                    >
                      重启
                    </Button>
                  </span>
                </Tooltip>

                <Tooltip title={undefined}>
                  <span>
                    <Button
                      className="vm-toolbar-btn"
                      type="text"
                      size="small"
                      icon={
                        <PauseCircleOutlined
                          style={{ color: p.isRunning ? "#1890ff" : undefined }}
                        />
                      }
                      onClick={p.handlePause}
                      disabled={!p.isRunning}
                      style={{ fontSize: 14 }}
                    >
                      暂停
                    </Button>
                  </span>
                </Tooltip>

                <Tooltip title={undefined}>
                  <span>
                    <Button
                      className="vm-toolbar-btn"
                      type="text"
                      size="small"
                      icon={
                        <PlayCircleOutlined
                          style={{ color: p.isPaused ? "#1890ff" : undefined }}
                        />
                      }
                      onClick={p.handleUnpause}
                      disabled={!p.isPaused}
                      style={{ fontSize: 14 }}
                    >
                      恢复
                    </Button>
                  </span>
                </Tooltip>

                <Tooltip title={undefined}>
                  <span>
                    <Dropdown
                      menu={{ items: resourceConfigMenuItems }}
                      trigger={["click"]}
                    >
                      <Button
                        className="vm-toolbar-btn"
                        type="text"
                        size="small"
                        icon={<SlidersOutlined style={{ color: "#1890ff" }} />}
                        style={{ fontSize: 14 }}
                        aria-haspopup="menu"
                        aria-label="资源配置"
                      >
                        资源配置
                      </Button>
                    </Dropdown>
                  </span>
                </Tooltip>
              </>
            ) : null}

            <div style={{ flex: 1 }} />

            <Tooltip title={undefined}>
              <span>
                <Dropdown menu={{ items: p.actionItems }} trigger={["click"]}>
                  <Button
                    className="vm-toolbar-btn"
                    type="text"
                    size="small"
                    icon={<EllipsisOutlined style={{ color: "#1890ff" }} />}
                  />
                </Dropdown>
              </span>
            </Tooltip>

          </div>
        </div>

        <div style={{ background: "#fff", padding: "0 24px", flexShrink: 0 }}>
          <div style={{ padding: "0 0 24px 0" }}>
            <div
              style={{
                padding: 4,
                background: "#fff",
                borderRadius: 8,
                border: "1px solid #e0e0e0",
              }}
            >
              <Segmented
                size="small"
                value={p.activeTab}
                onChange={(val) => p.handleTabChange(String(val))}
                options={[
                  { label: "详情", value: "detail", icon: <DesktopOutlined /> },
                  {
                    label: "性能",
                    value: "performance",
                    icon: <LineChartOutlined />,
                  },
                  {
                    label: "备份/快照",
                    value: "backup_snapshot",
                    icon: <DatabaseOutlined />,
                  },
                ]}
              />
            </div>
          </div>
        </div>

        <style>{`
          .vm-toolbar-btn {
               background: #f5f7fa;
               border: none !important;
               color: ${VM_DETAIL_DRAWER_TEXT_SECONDARY};
           }
           .vm-toolbar-btn:hover:not(:disabled) {
               background: #e6f7ff !important;
               color: #1890ff !important;
           }
           .vm-toolbar-btn:hover:not(:disabled) .anticon {
               color: #1890ff !important;
           }
          .minimal-scroll::-webkit-scrollbar {
              width: 6px;
              height: 6px;
          }
          .minimal-scroll::-webkit-scrollbar-track {
              background: transparent;
          }
          .minimal-scroll::-webkit-scrollbar-thumb {
              background: #e0e0e0;
              border-radius: 3px;
          }
          .minimal-scroll::-webkit-scrollbar-thumb:hover {
              background: #ccc;
          }
          .minimal-scroll::-webkit-scrollbar-button {
              display: none;
          }
      `}</style>
        <div
          className="minimal-scroll"
          style={{ padding: "0 24px 24px", flex: 1, overflowY: "auto" }}
        >
          {p.activeTab === "detail" && (
            <VmDetailTab
              vmData={p.vmData}
              cpuCores={p.SafeRead.cpu(p.vmData)}
              memorySpec={p.SafeRead.memory(p.vmData)}
              cpuUsage={p.cpuUsage}
              memUsage={p.memUsage}
              vmDisks={p.vmDisks}
              vmNics={p.vmNics}
              vmPassthroughNics={p.vmPassthroughNics}
              vmGpus={p.vmGpus}
              vmUsb={p.vmUsb}
            />
          )}

          {p.activeTab === "performance" && (
            <VmPerformance
              cloudId={cloudId}
              namespace={p.SafeRead.namespace(p.vmData)}
              name={p.SafeRead.vmId(p.vmData)}
            />
          )}

          {p.activeTab === "backup_snapshot" && (
            <div style={{ padding: "0 0 24px" }}>
              <VmBackupTab
                cloudId={cloudId}
                record={p.vmData}
                backups={p.backups}
                schedules={p.schedules}
                backupsLoading={p.backupsLoading}
                schedulesLoading={p.schedulesLoading}
                onRefresh={(force, silent) => {
                  const skipSync = silent || false;
                  p.fetchBackups(force, skipSync);
                  p.fetchSchedules(force, skipSync);
                }}
                onBackupsInventoryChanged={p.onBackupsInventoryChanged}
                namespaces={p.namespaces ?? []}
              />
            </div>
          )}

        </div>

        <VmSaveAsTemplateModal
          open={p.showTemplateModal}
          onClose={() => p.setShowTemplateModal(false)}
          cloudId={cloudId}
          vmNamespace={p.SafeRead.namespace(p.vmData)}
          vmName={p.SafeRead.vmId(p.vmData)}
          vmDisplayName={p.SafeRead.name(p.vmData)}
        />
        <VmNicManageDrawer
          open={p.nicManageOpen}
          onClose={() => p.setNicManageOpen(false)}
          vmData={p.vmData}
          cloudId={cloudId}
          nads={p.nads}
          vpcs={p.vpcs}
          subnets={p.subnets}
          displayRows={p.vmNics}
          hasEcsWrite={p.hasEcsWrite}
          onApplied={async () => {
            await p.fetchAggregated(false);
            void runHarvesterSectionRefresh(p.onRefresh, { force: true });
          }}
        />
        <VmDiskManageDrawer
          open={p.diskManageOpen}
          onClose={() => p.setDiskManageOpen(false)}
          vmData={p.vmData}
          cloudId={cloudId}
          diskDisplayRows={p.vmDisks}
          hasEcsWrite={p.hasEcsWrite}
          onApplied={async () => {
            await p.fetchAggregated(false);
            void runHarvesterSectionRefresh(p.onRefresh, { force: true });
          }}
        />
        <VmCloudInitDrawer
          open={p.cloudInitManageOpen}
          onClose={() => p.setCloudInitManageOpen(false)}
          cloudId={cloudId}
          vmData={p.vmData}
          hasEcsWrite={p.hasEcsWrite}
          onApplied={async () => {
            await p.fetchAggregated(false);
            void runHarvesterSectionRefresh(p.onRefresh, { force: true });
          }}
        />
        <VmDiagnosisDrawer
          open={p.diagnosisDrawerOpen}
          onClose={() => p.setDiagnosisDrawerOpen(false)}
          cloudId={cloudId}
          vmData={p.vmData}
        />
        <VmRealtimeLogsDrawer
          open={p.realtimeLogsDrawerOpen}
          onClose={() => p.setRealtimeLogsDrawerOpen(false)}
          cloudId={cloudId}
          vmData={p.vmData}
        />
        {(yamlDrawerEverOpened || p.opsYamlDrawerOpen) ? (
          <Suspense fallback={null}>
            <LazyHarvesterCrdMetadataDrawer
              open={p.opsYamlDrawerOpen}
              onClose={() => p.setOpsYamlDrawerOpen(false)}
              cloudId={cloudId}
              record={p.vmData}
              onSuccess={() =>
                void runHarvesterSectionRefresh(p.onRefresh, { force: true })
              }
            />
          </Suspense>
        ) : null}
        <VmVmPolicyDrawer
          open={p.vmPolicyManageOpen}
          onClose={() => p.setVmPolicyManageOpen(false)}
          vmData={p.vmData}
          cloudId={cloudId}
          latestVm={p.vmPolicyDrawerLatestVm}
          setLatestVm={p.setVmPolicyDrawerLatestVm}
          hasEcsWrite={p.hasEcsWrite}
          onApplied={async () => {
            await p.fetchAggregated(false);
            void runHarvesterSectionRefresh(p.onRefresh, { force: true });
          }}
        />
        <VmGpuManageDrawer
          open={p.gpuManageOpen}
          onClose={() => p.setGpuManageOpen(false)}
          cloudId={cloudId}
          record={p.vmData}
          latestVm={p.gpuDrawerLatestVm}
          setLatestVm={p.setGpuDrawerLatestVm}
          ensureNadsLoaded={ensureNadsLoaded}
          images={p.vmImages}
          gpuResourcesProp={p.vmDetailGpuResources}
          hasEcsWrite={p.hasEcsWrite}
          onApplied={async () => {
            await p.fetchAggregated(false);
            void runHarvesterSectionRefresh(p.onRefresh, { force: true });
          }}
        />
        <VmUsbManageDrawer
          open={p.usbManageOpen}
          onClose={() => p.setUsbManageOpen(false)}
          cloudId={cloudId}
          record={p.vmData}
          latestVm={p.usbDrawerLatestVm}
          setLatestVm={p.setUsbDrawerLatestVm}
          ensureNadsLoaded={ensureNadsLoaded}
          images={p.vmImages}
          usbResourcesProp={p.vmDetailUsbResources}
          hasEcsWrite={p.hasEcsWrite}
          onApplied={async () => {
            await p.fetchAggregated(false);
            void runHarvesterSectionRefresh(p.onRefresh, { force: true });
          }}
        />
        <VmSpecConfigDrawer
          open={p.specConfigOpen}
          onClose={() => p.setSpecConfigOpen(false)}
          vmData={p.vmData}
          cloudId={cloudId}
          hasEcsWrite={p.hasEcsWrite}
          onApplied={async () => {
            await p.fetchAggregated(false);
            void runHarvesterSectionRefresh(p.onRefresh, { force: true });
          }}
        />
        <VmSpecPerformanceDrawer
          open={p.performanceSettingsOpen}
          onClose={() => p.setPerformanceSettingsOpen(false)}
          vmData={p.vmData}
          cloudId={cloudId}
          latestVm={p.perfDrawerLatestVm}
          setLatestVm={p.setPerfDrawerLatestVm}
          hasEcsWrite={p.hasEcsWrite}
          onApplied={async () => {
            await p.fetchAggregated(false);
            void runHarvesterSectionRefresh(p.onRefresh, { force: true });
          }}
        />
        <VmHotplugSettingsDrawer
          open={p.hotplugSettingsOpen}
          onClose={() => p.setHotplugSettingsOpen(false)}
          cloudId={cloudId}
          record={p.vmData}
          latestVm={p.hotplugDrawerLatestVm}
          setLatestVm={p.setHotplugDrawerLatestVm}
          ensureNadsLoaded={ensureNadsLoaded}
          images={p.vmImages}
          onApplied={async () => {
            await p.fetchAggregated(false);
            void runHarvesterSectionRefresh(p.onRefresh, { force: true });
          }}
        />
        <VmNodeSchedulingDrawer
          open={p.nodeSchedulingOpen}
          onClose={() => p.setNodeSchedulingOpen(false)}
          vmData={p.vmData}
          cloudId={cloudId}
          latestVm={p.nodeSchedDrawerLatestVm}
          setLatestVm={p.setNodeSchedDrawerLatestVm}
          hasEcsWrite={p.hasEcsWrite}
          onApplied={async () => {
            await p.fetchAggregated(false);
            void runHarvesterSectionRefresh(p.onRefresh, { force: true });
          }}
        />
        <VmNodeAffinityDrawer
          open={p.nodeAffinityOpen}
          onClose={() => p.setNodeAffinityOpen(false)}
          vmData={p.vmData}
          cloudId={cloudId}
          latestVm={p.nodeSchedDrawerLatestVm}
          setLatestVm={p.setNodeSchedDrawerLatestVm}
          hasEcsWrite={p.hasEcsWrite}
          onApplied={async () => {
            await p.fetchAggregated(false);
            void runHarvesterSectionRefresh(p.onRefresh, { force: true });
          }}
        />
        <VmPodAffinityDrawer
          open={p.podAffinityOpen}
          onClose={() => p.setPodAffinityOpen(false)}
          vmData={p.vmData}
          cloudId={cloudId}
          latestVm={p.nodeSchedDrawerLatestVm}
          setLatestVm={p.setNodeSchedDrawerLatestVm}
          hasEcsWrite={p.hasEcsWrite}
          onApplied={async () => {
            await p.fetchAggregated(false);
            void runHarvesterSectionRefresh(p.onRefresh, { force: true });
          }}
        />
      </Drawer>
    </>
  );
};

export default VmDetailDrawerShell;
