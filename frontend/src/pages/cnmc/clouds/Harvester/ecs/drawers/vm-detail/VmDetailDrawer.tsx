/**
 * ==============================================================================
 * 模块名称: 虚拟机详情抽屉 (VM Detail Drawer)
 * 文件路径: frontend/src/pages/cnmc/clouds/Harvester/ecs/drawers/vm-detail/VmDetailDrawer.tsx
 * （根目录：`VmDetailDrawer.tsx` / `VmDetailDrawerShell.tsx` / `useVmDetailMoreMenu.tsx` / `VmDetailEjectCdromModal.tsx`；Tab：`tabs/`；设计 token：`lib/uiTokens`；数据与控制：`shell/use*`、`shell/types`；侧栏子抽屉与本目录同级：vm-disk-manage / vm-nic-manage / vm-cloud-init / vm-vm-policy / vm-node-scheduling / vm-diagnosis / vm-realtime-logs）
 * 目录归属：ECS 域（弹性计算）；PaaS 等场景可临时引用本抽屉，后续可替换为各自实例详情抽屉。
 * ==============================================================================
 *
 * [功能描述]
 * 以 Drawer 形式展示 Harvester 虚拟机的详情信息，并提供常用运维操作入口（开关机/重启/暂停/控制台/备份等）。
 * 该组件会在打开时拉取“聚合详情数据”，并通过 SSE 接收实时状态更新，确保抽屉内状态与列表/集群保持一致。
 *
 * [核心逻辑]
 * 1. [状态同步]: 将外部 record 同步到内部 vmData（见 shell/useVmDetailDrawerController）
 * 2. [数据聚合]: fetchHarvesterVMAggregated（同上）
 * 3. [实时更新]: /resources/ecs/stream SSE（同上）
 * 4. [性能指标]: Prometheus range query（同上）
 * 5. [操作入口]: 根目录 `useVmDetailMoreMenu`、`VmDetailEjectCdromModal`（`openVmDetailEjectCdromModal`）；电源/迁移等 `shell/useVmDetailDrawerActions`
 *
 * ------------------------------------------------------------------------------
 * [交互/依赖说明 (Dependencies & Interactions)]
 * ------------------------------------------------------------------------------
 * 1. 数据流向:
 *    上游页面(传入 record/volumes/namespaces) -> VmDetailDrawer -> harvesterApi/monitoringApi/SSE -> UI 渲染
 *
 * 2. 关键依赖/接口:
 *    - GET  /api/clouds/:id/resources/ecs/stream (SSE: vm_status/vm_deleted)
 *    - harvesterApi: fetchHarvesterVMAggregated / pauseHarvesterVm / unpauseHarvesterVm
 *    - services/api: startCloudProviderEcs / stopCloudProviderEcs / rebootCloudProviderEcs
 *    - harvesterApi: patchHarvesterVm / deleteHarvesterPVC / fetchHarvesterBackups / fetchHarvesterScheduleVmBackups
 *    - monitoringApi: fetchMetricRange (Prometheus range query)
 * ==============================================================================
 */
import React, { useMemo } from "react";
import { createVmDetailDrawerSafeRead } from "../../lib/vmSafeRead";
import type { VmDetailDrawerProps } from "./shell/types";
import { useVmDetailDrawerController } from "./shell/useVmDetailDrawerController";
import { useVmDetailDrawerDerived } from "./shell/useVmDetailDrawerDerived";
import { useVmDetailDrawerActions } from "./shell/useVmDetailDrawerActions";
import { useVmDetailMoreMenu } from "./useVmDetailMoreMenu";
import VmDetailDrawerShell from "./VmDetailDrawerShell";

const VmDetailDrawer: React.FC<VmDetailDrawerProps> = (props) => {
  const {
    open,
    onClose,
    record,
    cloudId = "",
    namespaces = [],
    onRefresh,
    onBackup,
    onSnapshot,
    onClone,
    onMigrate,
    onDelete,
  } = props;

  const ctrl = useVmDetailDrawerController(props);

  const SafeRead = useMemo(
    () =>
      createVmDetailDrawerSafeRead(
        ctrl.volumes,
        ctrl.vpcs,
        ctrl.subnets,
        ctrl.nads,
        ctrl.vmImages,
        ctrl.vmPvcs,
      ),
    [
      ctrl.volumes,
      ctrl.vpcs,
      ctrl.subnets,
      ctrl.nads,
      ctrl.vmImages,
      ctrl.vmPvcs,
    ],
  );

  const derived = useVmDetailDrawerDerived(
    ctrl.vmData,
    SafeRead,
    ctrl.vmDetailGpuResources,
    ctrl.vmDetailUsbResources,
  );

  const actions = useVmDetailDrawerActions({
    cloudId,
    vmData: ctrl.vmData,
    SafeRead,
    hasEcsWrite: ctrl.hasEcsWrite,
    hasConsoleWrite: ctrl.hasConsoleWrite,
    onRefresh,
    setShowTemplateModal: ctrl.setShowTemplateModal,
  });

  const actionItems = useVmDetailMoreMenu({
    vmData: ctrl.vmData,
    hasEcsWrite: ctrl.hasEcsWrite,
    isRunning: derived.isRunning,
    isStopped: derived.isStopped,
    isMigrating: derived.isMigrating,
    isCdromBoot: derived.isCdromBoot,
    onBackup,
    onSnapshot,
    onClone,
    onMigrate,
    onDelete,
    setOpsYamlDrawerOpen: ctrl.setOpsYamlDrawerOpen,
    handleSaveAsTemplate: actions.handleSaveAsTemplate,
    handleEjectCdrom: actions.handleEjectCdrom,
    handleAbortMigration: actions.handleAbortMigration,
    handleStop: actions.handleStop,
    setDiagnosisDrawerOpen: ctrl.setDiagnosisDrawerOpen,
    setRealtimeLogsDrawerOpen: ctrl.setRealtimeLogsDrawerOpen,
  });

  return (
    <VmDetailDrawerShell
      open={open}
      onClose={onClose}
      record={record}
      cloudId={cloudId}
      namespaces={namespaces}
      onRefresh={onRefresh}
      vmData={ctrl.vmData}
      SafeRead={SafeRead}
      refreshing={ctrl.refreshing}
      fetchAggregated={ctrl.fetchAggregated}
      activeTab={ctrl.activeTab}
      handleTabChange={ctrl.handleTabChange}
      hasEcsWrite={ctrl.hasEcsWrite}
      hasConsoleWrite={ctrl.hasConsoleWrite}
      cpuUsage={ctrl.cpuUsage}
      memUsage={ctrl.memUsage}
      backups={ctrl.backups}
      schedules={ctrl.schedules}
      backupsLoading={ctrl.backupsLoading}
      schedulesLoading={ctrl.schedulesLoading}
      fetchBackups={ctrl.fetchBackups}
      fetchSchedules={ctrl.fetchSchedules}
      nads={ctrl.nads}
      vpcs={ctrl.vpcs}
      subnets={ctrl.subnets}
      nicManageOpen={ctrl.nicManageOpen}
      setNicManageOpen={ctrl.setNicManageOpen}
      diskManageOpen={ctrl.diskManageOpen}
      setDiskManageOpen={ctrl.setDiskManageOpen}
      cloudInitManageOpen={ctrl.cloudInitManageOpen}
      setCloudInitManageOpen={ctrl.setCloudInitManageOpen}
      vmPolicyManageOpen={ctrl.vmPolicyManageOpen}
      setVmPolicyManageOpen={ctrl.setVmPolicyManageOpen}
      vmPolicyDrawerLatestVm={ctrl.vmPolicyDrawerLatestVm}
      setVmPolicyDrawerLatestVm={ctrl.setVmPolicyDrawerLatestVm}
      gpuManageOpen={ctrl.gpuManageOpen}
      setGpuManageOpen={ctrl.setGpuManageOpen}
      gpuDrawerLatestVm={ctrl.gpuDrawerLatestVm}
      setGpuDrawerLatestVm={ctrl.setGpuDrawerLatestVm}
      usbManageOpen={ctrl.usbManageOpen}
      setUsbManageOpen={ctrl.setUsbManageOpen}
      usbDrawerLatestVm={ctrl.usbDrawerLatestVm}
      setUsbDrawerLatestVm={ctrl.setUsbDrawerLatestVm}
      specConfigOpen={ctrl.specConfigOpen}
      setSpecConfigOpen={ctrl.setSpecConfigOpen}
      performanceSettingsOpen={ctrl.performanceSettingsOpen}
      setPerformanceSettingsOpen={ctrl.setPerformanceSettingsOpen}
      perfDrawerLatestVm={ctrl.perfDrawerLatestVm}
      setPerfDrawerLatestVm={ctrl.setPerfDrawerLatestVm}
      hotplugSettingsOpen={ctrl.hotplugSettingsOpen}
      setHotplugSettingsOpen={ctrl.setHotplugSettingsOpen}
      hotplugDrawerLatestVm={ctrl.hotplugDrawerLatestVm}
      setHotplugDrawerLatestVm={ctrl.setHotplugDrawerLatestVm}
      nodeSchedulingOpen={ctrl.nodeSchedulingOpen}
      setNodeSchedulingOpen={ctrl.setNodeSchedulingOpen}
      nodeAffinityOpen={ctrl.nodeAffinityOpen}
      setNodeAffinityOpen={ctrl.setNodeAffinityOpen}
      nodeSchedDrawerLatestVm={ctrl.nodeSchedDrawerLatestVm}
      setNodeSchedDrawerLatestVm={ctrl.setNodeSchedDrawerLatestVm}
      showTemplateModal={ctrl.showTemplateModal}
      setShowTemplateModal={ctrl.setShowTemplateModal}
      opsYamlDrawerOpen={ctrl.opsYamlDrawerOpen}
      setOpsYamlDrawerOpen={ctrl.setOpsYamlDrawerOpen}
      diagnosisDrawerOpen={ctrl.diagnosisDrawerOpen}
      setDiagnosisDrawerOpen={ctrl.setDiagnosisDrawerOpen}
      realtimeLogsDrawerOpen={ctrl.realtimeLogsDrawerOpen}
      setRealtimeLogsDrawerOpen={ctrl.setRealtimeLogsDrawerOpen}
      actionItems={actionItems}
      status={derived.status}
      hasGenerationInfo={derived.hasGenerationInfo}
      isConfigOutOfSync={derived.isConfigOutOfSync}
      vmGeneration={derived.vmGeneration}
      observedGeneration={derived.observedGeneration}
      isHotPlugConfigured={derived.isHotPlugConfigured}
      isRunning={derived.isRunning}
      isHotPlugPendingRestart={derived.isHotPlugPendingRestart}
      isHotPlugInProgress={derived.isHotPlugInProgress}
      isHotPlugEffective={derived.isHotPlugEffective}
      isMigratable={derived.isMigratable}
      hotPlugCpuError={derived.hotPlugCpuError}
      vmDisks={derived.vmDisks}
      vmNics={derived.vmNics}
      vmGpus={derived.vmGpus}
      vmUsb={derived.vmUsb}
      isStopped={derived.isStopped}
      isPaused={derived.isPaused}
      handleConsole={actions.handleConsole}
      handleStart={actions.handleStart}
      handleStop={actions.handleStop}
      handleReboot={actions.handleReboot}
      handlePause={actions.handlePause}
      handleUnpause={actions.handleUnpause}
      vmImages={ctrl.vmImages}
      vmDetailGpuResources={ctrl.vmDetailGpuResources}
      vmDetailUsbResources={ctrl.vmDetailUsbResources}
    />
  );
};

export default VmDetailDrawer;
