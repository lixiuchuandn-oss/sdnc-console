/**
 * 资源变配弹窗右侧表单区：按 `selectedKey` 渲染各子表单（从 VmReconfigureModal 抽出）。
 */
import React from 'react';
import { Form, Select, message, Row, Col } from 'antd';
import type { FormInstance } from 'antd/es/form';

import ChangeSpec from './ChangeSpec';
import HotPlugSettings from './HotPlugSettings';
import CpuAdvanced from './CpuAdvanced';
import ChangeGpu from './ChangeGpu';
import ChangeUsb from './ChangeUsb';
import ChangeOs from './ChangeOs';
import ChangeNodeScheduling from './ChangeNodeScheduling';
import ChangeNodeAffinity from './ChangeNodeAffinity';
import ExpandDisk from './ExpandDisk';
import AddDataDisk from './AddDataDisk';
import DetachDataDisk from './DetachDataDisk';
import ChangePrimaryNic from './ChangePrimaryNic';
import ChangeSecondaryNic from './ChangeSecondaryNic';
import { isSystemStorageClass } from '../../../../../../../utils/harvesterUtils';
import type { ExpandDiskCandidate } from './lib/vmReconfigureDiskCandidates';

export type VmReconfigureModalContentProps = {
  form: FormInstance<any>;
  selectedKey: string;
  cloudId: string;
  record: any | null;
  latestVm: any | null;
  scs: any[];
  images: any[];
  gpuResources: any[];
  usbResources: any[];
  nads: any[];
  vpcs: any[];
  subnets: any[];
  setVpcs: (v: any[]) => void;
  nodes: any[];
  reloadNodes: () => Promise<any>;
  gpuLoading: boolean;
  usbLoading: boolean;
  reloadScs: () => Promise<void> | void;
  reloadImages: () => Promise<void> | void;
  reloadGpuResources: () => Promise<void> | void;
  reloadUsbResources: () => Promise<void> | void;
  reloadNads: () => Promise<any>;
  reloadVpcs: () => Promise<any>;
  reloadSubnets: () => Promise<any>;
  selectedGpuKeys: string[];
  setSelectedGpuKeys: (k: string[] | ((prev: string[]) => string[])) => void;
  selectedUsbKeys: string[];
  setSelectedUsbKeys: (k: string[] | ((prev: string[]) => string[])) => void;
  currentCpu: number;
  currentMemory: number;
  isHotPlugConfiguredOnVmVal: boolean;
  isRestartRequired: boolean;
  maxSockets: number | undefined;
  maxMemory: number | undefined;
  architecture: any;
  isHotPlugInProgress: boolean;
  expandDiskCandidates: ExpandDiskCandidate[];
  loadExpandDiskSize: (pvcName: string) => Promise<void>;
  systemDiskSize: number | null;
  systemDiskLoading: boolean;
  availableDiskPvcs: any[];
  handleDetachDisk: (diskName: string) => Promise<void>;
  refreshVm: () => Promise<void>;
  diskDetaching: boolean;
  currentOsImageId: string | undefined;
  currentOsImageResolvedLabel: string;
  isArm64Vm: boolean;
};

export const VmReconfigureModalContent: React.FC<VmReconfigureModalContentProps> = (p) => {
  const scOptions = (p.scs || [])
    .filter((x: any) => !isSystemStorageClass(x?.metadata?.name || x?.name))
    .map((x: any) => ({ value: x?.metadata?.name || x?.name, label: x?.metadata?.name || x?.name }));

  switch (p.selectedKey) {
    case 'change_spec':
      return (
        <ChangeSpec
          form={p.form}
          currentCpu={p.currentCpu}
          currentMemory={p.currentMemory}
          isHotPlugEnabledOnVm={p.isHotPlugConfiguredOnVmVal}
          isRestartRequired={p.isRestartRequired}
          maxSockets={p.maxSockets}
          maxMemory={p.maxMemory}
          architecture={p.architecture}
          disabled={p.isHotPlugInProgress}
        />
      );
    case 'hotplug_settings':
      return (
        <HotPlugSettings
          form={p.form}
          currentCpu={p.currentCpu}
          currentMemory={p.currentMemory}
          isHotPlugEnabledOnVm={p.isHotPlugConfiguredOnVmVal}
          maxSockets={p.maxSockets}
          maxMemory={p.maxMemory}
          architecture={p.architecture}
          disabled={p.isHotPlugInProgress}
        />
      );
    case 'cpu_advanced': {
      const domain = (p.latestVm || p.record)?.spec?.template?.spec?.domain;
      const cpuSpec = domain?.cpu;
      const resources = domain?.resources;
      const vmCpuState = {
        cpu: cpuSpec || null,
        resources: resources || null,
      };
      return (
        <CpuAdvanced
          form={p.form}
          cloudId={p.cloudId}
          vmCpuState={vmCpuState}
          vmCpuDebugText={JSON.stringify(vmCpuState, null, 2)}
        />
      );
    }
    case 'change_gpu': {
      const activeVm = p.latestVm || p.record;
      const domain = activeVm?.spec?.template?.spec?.domain;
      const hostDevices = domain?.devices?.hostDevices || [];
      const gpus = domain?.devices?.gpus || [];
      const inferredMode = gpus.length > 0 ? 'vgpu' : hostDevices.length > 0 ? 'passthrough' : 'none';
      const currentMode = p.form.getFieldValue('gpuMode') || inferredMode;
      const effectiveMode = currentMode === 'none' ? inferredMode : currentMode;
      const vmAssigned = effectiveMode === 'vgpu' ? gpus : hostDevices;
      const currentVmGpuResourceNames = (Array.isArray(vmAssigned) ? vmAssigned : [])
        .map((x: any) => x?.deviceName)
        .filter(Boolean);
      return (
        <ChangeGpu
          form={p.form}
          gpuResources={p.gpuResources}
          selectedGpuKeys={p.selectedGpuKeys}
          setSelectedGpuKeys={p.setSelectedGpuKeys}
          gpuLoading={p.gpuLoading}
          reloadGpuResources={p.reloadGpuResources}
          currentVmGpuResourceNames={currentVmGpuResourceNames}
        />
      );
    }
    case 'change_usb': {
      const activeVm = p.latestVm || p.record;
      const domain = activeVm?.spec?.template?.spec?.domain;
      const hostDevices = domain?.devices?.hostDevices || [];
      const usb = (Array.isArray(hostDevices) ? hostDevices : []).filter((d: any) => {
        const n = String(d?.name || '').toLowerCase();
        const dn = String(d?.deviceName || '').toLowerCase();
        return n.startsWith('usb') || dn.includes('usb');
      });
      const currentVmUsbResourceNames = usb.map((x: any) => x?.deviceName).filter(Boolean);
      return (
        <ChangeUsb
          form={p.form}
          usbResources={p.usbResources}
          selectedUsbKeys={p.selectedUsbKeys}
          setSelectedUsbKeys={p.setSelectedUsbKeys}
          usbLoading={p.usbLoading}
          reloadUsbResources={p.reloadUsbResources}
          currentVmUsbResourceNames={currentVmUsbResourceNames}
        />
      );
    }
    case 'change_node_scheduling':
      return (
        <ChangeNodeScheduling
          form={p.form}
          cloudId={p.cloudId}
          record={p.latestVm || p.record}
          nodes={p.nodes}
          reloadNodes={p.reloadNodes}
          nodesLoading={false}
        />
      );
    case 'change_node_affinity':
      return (
        <ChangeNodeAffinity form={p.form} cloudId={p.cloudId} record={p.latestVm || p.record} />
      );
    case 'vm_policy':
      return (
        <>
          <div>
            <Row gutter={12} style={{ marginBottom: 0 }}>
              <Col span={6}>
                <div style={{ lineHeight: '32px' }}>运行策略</div>
              </Col>
              <Col span={18}>
                <Form.Item name="runStrategy" rules={[{ required: true, message: '请选择运行策略' }]} noStyle>
                  <Select
                    placeholder="选择运行策略"
                    style={{ width: 320 }}
                    options={[
                      { value: 'Always', label: 'Always（始终运行）' },
                      { value: 'RerunOnFailure', label: 'RerunOnFailure（失败自动重启）' },
                      { value: 'Manual', label: 'Manual（手动控制）' },
                      { value: 'Halted', label: 'Halted（保持停止）' },
                    ]}
                    onChange={(v) => {
                      if (String(v) === 'Halted') message.warning('设置为 Halted 后实例将保持停止状态');
                    }}
                  />
                </Form.Item>
                <div style={{ marginBottom: 24 }} />
              </Col>
            </Row>

            <Row gutter={12} style={{ marginBottom: 0 }}>
              <Col span={6}>
                <div style={{ lineHeight: '32px' }}>驱逐策略</div>
              </Col>
              <Col span={18}>
                <Form.Item name="evictionStrategy" noStyle>
                  <Select
                    placeholder="选择驱逐策略"
                    allowClear
                    style={{ width: 320 }}
                    options={[
                      { value: 'LiveMigrateIfPossible', label: 'LiveMigrateIfPossible（尽可能热迁移）' },
                      { value: 'LiveMigrate', label: 'LiveMigrate（强制热迁移）' },
                      { value: 'None', label: 'None（不迁移）' },
                    ]}
                    onChange={(v) => {
                      if (String(v) === 'None') message.warning('驱逐策略为 None 时，节点维护/驱逐可能导致实例不可用');
                    }}
                  />
                </Form.Item>
                <div style={{ marginBottom: 24 }} />
              </Col>
            </Row>
          </div>
        </>
      );

    case 'change_os':
      return (
        <ChangeOs
          form={p.form}
          images={p.images}
          reloadImages={p.reloadImages}
          storageClasses={p.scs}
          reloadStorageClasses={p.reloadScs}
          defaultStorageClassName={
            p.scs.find((x) => x?.metadata?.annotations?.['storageclass.kubernetes.io/is-default-class'] === 'true')
              ?.metadata?.name
          }
          currentOsImageId={p.currentOsImageId}
          currentOsImageLabel={p.currentOsImageResolvedLabel || undefined}
          isArm64={p.isArm64Vm}
        />
      );
    case 'expand_disk':
      return (
        <ExpandDisk
          form={p.form}
          expandDiskCandidates={p.expandDiskCandidates}
          loadExpandDiskSize={p.loadExpandDiskSize}
          expandDiskCurrentSizeGi={p.systemDiskSize}
          loading={p.systemDiskLoading}
        />
      );
    case 'add_disk':
      return (
        <AddDataDisk
          form={p.form}
          scOptions={scOptions}
          reloadScs={p.reloadScs}
          pvcOptions={p.availableDiskPvcs}
          images={p.images || []}
          reloadImages={p.reloadImages}
        />
      );
    case 'add_cdrom':
      return (
        <AddDataDisk
          kind="cdrom"
          form={p.form}
          scOptions={scOptions}
          reloadScs={p.reloadScs}
          images={p.images || []}
          reloadImages={p.reloadImages}
        />
      );
    case 'detach_disk':
      return (
        <DetachDataDisk
          record={p.latestVm || p.record}
          cloudId={p.cloudId}
          onDetach={p.handleDetachDisk}
          onRefresh={p.refreshVm}
          loading={p.diskDetaching}
        />
      );

    case 'change_primary_nic':
      return (
        <ChangePrimaryNic
          form={p.form}
          nads={p.nads}
          vpcs={p.vpcs}
          subnets={p.subnets}
          reloadNads={p.reloadNads}
          reloadVpcs={p.reloadVpcs}
          reloadSubnets={p.reloadSubnets}
          setVpcs={p.setVpcs}
        />
      );
    case 'change_secondary_nic':
      return (
        <ChangeSecondaryNic
          form={p.form}
          nads={p.nads}
          vpcs={p.vpcs}
          subnets={p.subnets}
          reloadNads={p.reloadNads}
          reloadVpcs={p.reloadVpcs}
          reloadSubnets={p.reloadSubnets}
          setVpcs={p.setVpcs}
        />
      );

    default:
      return null;
  }
};
