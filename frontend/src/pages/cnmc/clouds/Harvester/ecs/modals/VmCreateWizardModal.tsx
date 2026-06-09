/**
 * Harvester - 云主机创建向导弹窗
 * frontend/src/pages/cnmc/clouds/Harvester/modals/VmCreateWizardModal.tsx
 *
 * === 功能描述 ===
 * 多步骤创建云主机的核心入口容器，管理整个创建流程的状态和步骤切换。
 * 包含基本信息、计算资源、虚拟磁盘、虚拟网卡、其它选项五个步骤。
 *
 * === 核心逻辑 ===
 * 1. [状态管理]:
 *    - 各步骤表单域在同一 Form 内同时挂载，仅通过 CSS 切换可见步（方案 A），避免卸载丢值。
 *    - `formSnapshot` 用于右侧摘要展示（与 onValuesChange / 切步时同步）。
 * 2. [数据加载]:
 *    - 通过 `useHarvesterData` Hook 统一加载镜像、卷、NAD、节点等基础数据。
 *    - 根据选择的资源池 (Cloud) 动态刷新相关资源。
 * 3. [步骤控制]:
 *    - `next()`: 校验当前步骤的关键字段，通过后进入下一步。
 *    - `submit()`: 最终校验所有字段，构造 Payload 并调用 API 创建 VM。
 * 4. [模板应用]:
 *    - 支持从现有 VM 或模板 (Template) 初始化表单数据。
 *
 * === 交互依赖 ===
 * - 上游: 路由参数 (cloudId) 或 State (fromTemplate, fromVm)。
 * - 下游: `createHarvesterVm` API 接口。
 * - 子组件: StepBasic, StepCompute, StepDisks, StepNetworks, StepOthers, WizardSummary。
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Form, Row, Col, Modal, App, Space, Spin } from 'antd';
import { CheckOutlined, ProfileOutlined, DesktopOutlined, HddOutlined, GlobalOutlined, SettingOutlined, KeyOutlined } from '@ant-design/icons';
import './VmCreateWizard/InstanceWizard.css';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import StepBasic from './VmCreateWizard/StepBasic';
import StepCompute from './VmCreateWizard/StepCompute';
import StepDisks from './VmCreateWizard/StepDisks';
import StepNetworks from './VmCreateWizard/StepNetworks';
import StepLoginSettings from './VmCreateWizard/StepLoginSettings';
import StepOthers from './VmCreateWizard/StepOthers';
import WizardSummary from './VmCreateWizard/WizardSummary';
import { useHarvesterData } from './VmCreateWizard/useHarvesterData';
import { generateVmWizardStyleDisplayName } from '../../../../../../utils/harvesterUtils';
import { validateAndGetGpu, initialWizardValues, filterNodes, validateImageSize, constructVmPayload, handleRootPvcChange, generateUniqueVmId, applyTemplateToWizardForm, parseSizeToGi } from './VmCreateWizard/VmWizardUtils';
import { findDeploymentSetById, applyDeploymentSetToWizardForm } from '../lib/vmDeploymentSet';
import {
  applyDeploymentSetExclusive,
  collectVmWizardMetricAutoScheduledConflicts,
  getVmWizardMetricAutoScheduledConflictMessage,
} from '../lib/vmSchedulingExclusion';
import type { DeploymentSetRow } from 'services/harvester/deploymentSets';
import { validateVmPerformanceAdvancedForm } from '../lib/numaHugepagesSpec';
import { hasLabelModeNodeSelector } from '../lib/vmFailureDomainNodeSelector';
import {
  clearVmAdvancedSchedulingFormFields,
  vmFailureDomainRequiredMessage,
} from '../lib/vmAdvancedSchedulingLabels';
import { fetchHarvesterCapabilities, createHarvesterVm } from 'services/harvester/vm';
import { fetchCloudProviderEcs } from '../../../../../../services/api';
import { useAuth } from '../../../../../../contexts/AuthContext';
import { hasPermissionForAction } from '../../../../../../utils/accessMapping';
import { CLOUD_VM_CREATE_WIZARD_WRITE } from '../../../../../../constants/cloudPermissions';
import { translateKnownApiErrorMessage } from '../../../../../../utils/k8sErrorMessages';
import {
  extractCloudProviderEcsList,
  validateVmCreateWizardNicsAgainstPeerVms,
  validateVmCreateWizardNicsMacIpAndSubnet,
} from '../lib/vmNicMacIpValidation';

type Props = {
  isTenant?: boolean;
};

const VmCreateWizardModal: React.FC<Props> = ({ isTenant: propIsTenant = false }) => {
  const { message } = App.useApp();
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const { id } = useParams();
  const cloudId = id as string;

  // [Fix] isTenant priority: 1. props 2. location.state 3. default false
  const stateIsTenant = (location.state as any)?.isTenant;
  const isTenant = propIsTenant || stateIsTenant || false;

  const [form] = Form.useForm();
  /** 订阅表单 `namespace` 字段（业务上称「项目」），供 useHarvesterData 过滤卷选项；避免在 Form 未挂载时调用 form.getFieldValue 触发 antd 警告 */
  const watchNamespace = Form.useWatch('namespace', form);
  // 当前步骤索引、提交状态（表单值由单一 Form 持有，方案 A 各步同挂）
  const [step, setStep] = useState<number>(0);
  const [submitting, setSubmitting] = useState(false);
  const [currentCloudId, setCurrentCloudId] = useState<string | undefined>(cloudId !== 'all' ? cloudId : undefined);
  const [selectedNetIdx, setSelectedNetIdx] = useState<number | null>(null);
  const [hostModeState, setHostModeState] = useState<string>('auto');
  const [netModeState, setNetModeState] = useState<string>('flat_subnet');
  const [selectedNodeName, setSelectedNodeName] = useState<string | null>(null);
  const [nodeKeyword, setNodeKeyword] = useState<string>('');
  const [initialVmName] = useState<string>(() => generateVmWizardStyleDisplayName('vm'));
  const [memPreset, setMemPreset] = useState<string>('4');
  const [memGi, setMemGi] = useState<number>(4);
  const [formSnapshot, setFormSnapshot] = useState<any>({});
  const [selectedGpuKey, setSelectedGpuKey] = useState<string | null>(null);
  const [capabilities, setCapabilities] = useState<any>(null);
  const [existingVms, setExistingVms] = useState<any[]>([]);
  const lastValidationErrorTypeRef = useRef<string | null>(null);
  /** 防止连点/双击在 setSubmitting 生效前并发提交，导致重复创建 VM */
  const submitInFlightRef = useRef(false);
  const [deploymentSets, setDeploymentSets] = useState<DeploymentSetRow[]>([]);

  const {
    images, imageLoading, reloadImages,
    availableVolumes, reloadVolumes, volumeOptions,
    namespaces, reloadNamespaces, namespaceOptions,
    reloadNads, nadOptions,
    nodes, nodesLoading, reloadNodes,
    clouds, loadClouds, cloudOptions, currentProvider,
    kubeSubnets, reloadKubeSubnets,
    reloadKubeVpcs, kubeVpcOptions,
    gpuResources, reloadGpuResources,
    pciDevices, reloadPciDevices,
    usbResources, usbResourcesLoaded, usbResourcesLoading, reloadUsbResources,
    storageClasses, storageClassLoading, reloadStorageClasses, defaultStorageClassName,
    sshKeyOptions, sshKeysLoaded, sshKeysLoading, reloadSshKeys
  } = useHarvesterData(cloudId, currentCloudId, form, isTenant, watchNamespace);

  const fromTemplateState = (location.state as any)?.fromTemplate;
  const fromVmState = (location.state as any)?.fromVm;

  const canUseVmCreateWizard = useMemo(() => {
    const perms = (user?.permissions ?? []) as string[];
    return hasPermissionForAction(perms, CLOUD_VM_CREATE_WIZARD_WRITE);
  }, [user?.permissions]);

  useEffect(() => {
    if (authLoading) return;
    if (!user) return;
    if (!canUseVmCreateWizard) {
      message.error('当前账号没有虚拟机创建向导权限');
      navigate(-1);
    }
  }, [authLoading, user, canUseVmCreateWizard, message, navigate]);

  useEffect(() => {
    const cid = currentCloudId || (cloudId !== 'all' ? cloudId : undefined);
    if (!cid) {
      setExistingVms([]);
      return;
    }
    fetchCloudProviderEcs(cid, false)
      .then((json: any) => {
        const list: any[] = Array.isArray(json?.data)
          ? json.data
          : Array.isArray(json?.data?.items)
            ? json.data.items
            : Array.isArray(json?.items)
              ? json.items
              : [];
        setExistingVms(Array.isArray(list) ? list : []);
      })
      .catch(() => {
        setExistingVms([]);
      });
  }, [currentCloudId, cloudId]);

  useEffect(() => {
    try {
      const name = String(form.getFieldValue('name') || '').trim();
      const ns = String(form.getFieldValue('namespace') || '').trim();
      if (!name || !ns) return;
      form.validateFields(['name']).catch(() => {});
    } catch {}
  }, [existingVms, form]);

  useEffect(() => {
    if (fromTemplateState && fromTemplateState.namespace && fromTemplateState.name) {
      try {
        form.setFieldsValue({
          namespace: fromTemplateState.namespace,
        });
      } catch {}
    } else if (fromVmState && fromVmState.metadata?.namespace) {
      try {
        form.setFieldsValue({
          namespace: fromVmState.metadata.namespace,
        });
      } catch {}
    }
  }, [fromTemplateState, fromVmState, form]);

  useEffect(() => {
    if (fromTemplateState && fromTemplateState.template) {
      try {
        applyTemplateToWizardForm({
          form,
          template: fromTemplateState.template,
          images,
          availableVolumes,
          nadOptions,
          kubeSubnets,
        });
        const m = form.getFieldValue('memory');
        if (m) setMemGi(parseSizeToGi(m));
      } catch {}
    } else if (fromVmState) {
      // 从现有 VM 克隆：复用 applyTemplateToWizardForm (因为 VM 结构与 Template 结构在 spec.template 部分兼容)
      try {
        applyTemplateToWizardForm({
          form,
          template: fromVmState,
          images,
          availableVolumes,
          nadOptions,
          kubeSubnets,
        });
        const m = form.getFieldValue('memory');
        if (m) setMemGi(parseSizeToGi(m));
        // 重置名称，避免与原 VM 冲突
        form.setFieldsValue({ name: undefined });
      } catch {}
    }
  }, [fromTemplateState, fromVmState, form, images, availableVolumes, nadOptions, kubeSubnets]);

  // 首次挂载时加载云列表，用于“跨资源池创建 VM”场景
  useEffect(() => {
    loadClouds();
  }, [loadClouds]);

  // 当 cloudId / currentCloudId 变化时：
  // - 查询 Harvester 能力（推荐机型等）；
  // - 刷新 images/namespaces/nads/nodes 等基础数据。
  useEffect(() => {
    const load = async () => {
      if (!currentCloudId && cloudId === 'all') return;
      const cid = currentCloudId || (cloudId !== 'all' ? cloudId : undefined);
      try { reloadImages(); } catch {}
      try { reloadNamespaces(); } catch {}
      try { reloadNads(); } catch {}
      try { reloadNodes(); } catch {}
      if (cid) {
        try {
          const caps = await fetchHarvesterCapabilities(cid);
          setCapabilities(caps?.data || null);
          const rec = String(caps?.data?.recommendedMachineType || '').trim();
          if (rec) { try { form.setFieldsValue({ machineType: rec }); } catch {} }
        } catch {}
      }
    };
    load();
  }, [cloudId, currentCloudId, reloadImages, reloadNamespaces, reloadNads, reloadNodes, form]);

  useEffect(() => {
    if (step === 3) {
      try {
        void reloadPciDevices();
      } catch {
        /* ignore */
      }
    }
  }, [step, reloadPciDevices]);

  // 进入“计算资源”步骤时，如有需要刷新 GPU 资源
  useEffect(() => {
    if (step === 1) { try { reloadGpuResources(); } catch {} }
  }, [step, reloadGpuResources]);

  // cloudId 或 currentCloudId 变化时，尝试刷新 GPU 资源
  useEffect(() => {
    try { reloadGpuResources(); } catch {}
  }, [cloudId, currentCloudId, reloadGpuResources]);

  // 组件初始化时记录一份表单快照，便于右侧摘要展示
  useEffect(() => {
    try { setFormSnapshot(form.getFieldsValue(true)); } catch {}
  }, [form]);

  // 根据关键字过滤可选节点列表，用于“调度到指定主机”
  const filteredNodes = useMemo(() => filterNodes(nodes, nodeKeyword), [nodes, nodeKeyword]);

  // 计算集群是否为 ARM64 架构
  const isArm64 = useMemo(() => {
    if (nodes && nodes.length > 0) {
      const n = nodes[0];
      const arch = n?.status?.nodeInfo?.architecture || n?.architecture || '';
      return String(arch).toLowerCase() === 'arm64' || String(arch).toLowerCase() === 'aarch64';
    }
    return false;
  }, [nodes]);








  // 向导步骤标签
  const steps = ['基本信息','计算与规格','存储与磁盘','网络与连接','登录与凭据','高级设置'];
  const getStepIcon = (i: number): React.ReactNode => {
    const icons = [<ProfileOutlined />, <DesktopOutlined />, <HddOutlined />, <GlobalOutlined />, <KeyOutlined />, <SettingOutlined />];
    return icons[i] || <ProfileOutlined />;
  };

  const [stepValid, setStepValid] = useState<boolean[]>(()=> Array(steps.length).fill(false));

  /**
   * 进入下一步：
   * - 离开当前步骤前进行验证；
   * - 同步右侧摘要快照；
   * - 步骤索引不会超过最后一步。
   */
  const next = async () => {
    const isValid = await handleStepValidation(step);
    if (!isValid) {
      if (lastValidationErrorTypeRef.current !== 'cpu-manager') {
        message.error('请完整填写必填项');
      }
      return;
    }

    try { setFormSnapshot(form.getFieldsValue(true)); } catch {}
    setStep(Math.min(steps.length - 1, step + 1));
  };

  const prev = async () => {
    const isValid = await handleStepValidation(step);
    if (isValid) {
      try { setFormSnapshot(form.getFieldsValue(true)); } catch {}
    }
    setStep(Math.max(0, step - 1));
  };
  
  // [辅助函数] 获取当前步骤需要校验的字段列表
  const getStepFields = (stepIdx: number): any[] => {
    switch (stepIdx) {
      case 0: // Basic
        return ['cloudId', 'namespace', 'name', 'hostMode', 'clusterArch', 'machineType', 'failureDomainName', 'description'];
      case 1: // Compute
        return ['cpu', 'memory', 'hotExpandEnabled', 'cpuSockets', 'cpuCores', 'cpuThreads', 'cpuModel', 'cpuModelCustom', 'gpuMode', 'gpuList'];
      case 2: // Disks
        return ['rootSourceType', 'image', 'rootPvc', 'rootSize', 'rootName', 'rootDeviceType', 'rootBus', 'storageClassName', 'extraDisks'];
      case 3: // Networks
        return [
          'netMode', 
          ['primaryNic', 'name'], 
          ['primaryNic', 'vpc'], 
          ['primaryNic', 'subnet'], 
          ['primaryNic', 'type'], 
          ['primaryNic', 'model'], 
          'netIfaces'
        ];
      case 4: // Login
        return ['loginMethod', 'loginAccount', 'loginPassword', 'sshNames', 'userData'];
      case 5: // Others
        return [
          'runStrategy', 
          'evictionStrategy', 
          'bootUseEfi', 
          'efiPersistent', 
          'efiSecureBoot', 
          'tpmEnabled', 
          'tpmPersistent', 
          'useUsbTablet', 
          'installGuestAgent', 
          'sshNames', 
          'usbDevices'
        ];
      default:
        return [];
    }
  };

  /**
   * 验证指定步骤（默认为当前步骤），并更新步骤状态 stepValid
   * @param targetStep 若不传则验证当前 step
   * @returns Promise<boolean> 验证是否通过
   */
  const handleStepValidation = async (targetStep: number = step): Promise<boolean> => {
    const fields = getStepFields(targetStep);
    try {
      lastValidationErrorTypeRef.current = null;
      await form.validateFields(fields);

      // 网络步骤：MAC / 静态IP 仅在 VPC / 扁平子网展示，须单独按模式校验
      if (targetStep === 3) {
        const extraNetPaths: (string | number)[][] = [];
        const netMode = String(form.getFieldValue('netMode') || '');
        if (netMode === 'vpc' || netMode === 'flat_subnet') {
          extraNetPaths.push(['primaryNic', 'macAddress'], ['primaryNic', 'ipAddress']);
        }
        if (netMode === 'passthrough' || netMode === 'passthrough_sriov') {
          extraNetPaths.push(['primaryNic', 'passthroughBindNode'], ['primaryNic', 'passthroughPick']);
        }
        const netIfaces = form.getFieldValue('netIfaces');
        if (Array.isArray(netIfaces)) {
          netIfaces.forEach((row: any, i: number) => {
            const m = String(row?.mode || '');
            if (m === 'vpc' || m === 'flat_subnet') {
              extraNetPaths.push(['netIfaces', i, 'macAddress'], ['netIfaces', i, 'ipAddress']);
            }
            if (m === 'passthrough' || m === 'passthrough_sriov') {
              extraNetPaths.push(
                ['netIfaces', i, 'passthroughBindNode'],
                ['netIfaces', i, 'passthroughPick'],
              );
            }
          });
        }
        if (extraNetPaths.length > 0) {
          await form.validateFields(extraNetPaths);
        }
        const vNet = form.getFieldsValue(true) as any;
        const nicDupErr = validateVmCreateWizardNicsMacIpAndSubnet(
          vNet,
          kubeSubnets || [],
        );
        if (nicDupErr) {
          message.error(nicDupErr);
          throw new Error('nic-mac-ip');
        }
        const nicNs = String(form.getFieldValue('namespace') || '').trim();
        if (nicNs) {
          let peerListForStep: any[] = existingVms;
          const cidForPeer =
            currentCloudId || (cloudId !== 'all' ? cloudId : undefined);
          if (cidForPeer) {
            try {
              const json: any = await fetchCloudProviderEcs(cidForPeer, true);
              const extracted = extractCloudProviderEcsList(json);
              if (extracted.length > 0) peerListForStep = extracted;
            } catch {
              /* 回退 existingVms */
            }
          }
          const nicPeerErr = validateVmCreateWizardNicsAgainstPeerVms(
            vNet,
            peerListForStep,
            nicNs,
          );
          if (nicPeerErr) {
            message.error(nicPeerErr);
            throw new Error('nic-peer');
          }
        }
      }
      
      // Step 0 额外校验：若选择指定主机模式，必须选中主机
      if (targetStep === 0 && hostModeState === 'node' && !selectedNodeName) {
        throw new Error('Node not selected');
      }
      if (targetStep === 0 && hostModeState === 'label') {
        const v0 = form.getFieldsValue(true);
        if (!hasLabelModeNodeSelector({ failureDomainName: v0.failureDomainName })) {
          message.error(vmFailureDomainRequiredMessage());
          throw new Error('Failure domain not selected');
        }
      }

      if (targetStep === 1) {
        const needBinding = !!form.getFieldValue('dedicatedCPUPlacement');
        if (needBinding) {
          const checkCpuManager = (node: any) => {
            const anns = node?.metadata?.annotations || node?.annotations || {};
            const raw = anns['harvesterhci.io/cpu-manager-update-status'];
            if (!raw) return false;
            try {
              const obj = typeof raw === 'string' ? JSON.parse(raw) : raw;
              const p = String(obj?.policy || '').toLowerCase();
              const s = String(obj?.status || '').toLowerCase();
              return p === 'static' && s === 'success';
            } catch {
              return false;
            }
          };
          let ok = false;
          if (hostModeState === 'node' && selectedNodeName) {
            const node = (nodes || []).find((n: any) => String(n?.metadata?.name || n?.name || '') === String(selectedNodeName));
            ok = !!(node && checkCpuManager(node));
          } else {
            ok = (nodes || []).some((n: any) => checkCpuManager(n));
          }
          if (!ok) {
            message.error('当前物理节点未开启CPU管理');
            lastValidationErrorTypeRef.current = 'cpu-manager';
            throw new Error('CPU manager not enabled');
          }
        }
      }

      if (targetStep === 2) {
        const list = form.getFieldValue('extraDisks') || [];
        const nested = Array.isArray(list) ? list.map((_: any, i: number) => ['extraDisks', i, 'name']) : [];
        if (nested.length > 0) {
          await form.validateFields(nested);
        }
      }

      const metricConflictMsg = getVmWizardMetricAutoScheduledConflictMessage(
        form.getFieldsValue(true) as Record<string, unknown>,
      );
      if (metricConflictMsg) {
        message.error(metricConflictMsg);
        throw new Error('metric-auto-scheduled-conflict');
      }

      setStepValid((prev) => { const a = [...prev]; a[targetStep] = true; return a; });
      return true;
    } catch (error) {
      setStepValid((prev) => { const a = [...prev]; a[targetStep] = false; return a; });
      return false;
    }
  };



  

  /**
   * 最终提交创建云主机：
   * - 从 Form 读取完整值（各步已同挂，无需多份合并）；
   * - 创建 VM，并在需要时执行自动开机。
   */
  const submit = async () => {
    // 校验前置步骤是否已通过
    // 找到第一个未校验通过的步骤（不包括当前步骤，当前步骤由 validateFields 校验）
    const firstInvalidStep = stepValid.findIndex((valid, idx) => !valid && idx < steps.length - 1);
    if (firstInvalidStep !== -1) {
      message.error(`请先完善第 ${firstInvalidStep + 1} 步的信息`);
      setStep(firstInvalidStep);
      return;
    }

    if (submitInFlightRef.current) return;
    submitInFlightRef.current = true;
    setSubmitting(true);
    try {
      await form.validateFields();
      const v = form.getFieldsValue(true) as any;

      const flatUsed: string[] = [];
      if (String(v.netMode || '') === 'flat_subnet' && v?.primaryNic?.subnet) flatUsed.push(String(v.primaryNic.subnet));
      const netIfList = Array.isArray(v.netIfaces) ? v.netIfaces : [];
      netIfList.forEach((it: any) => {
        if (String(it?.mode || '') === 'flat_subnet' && it?.subnet) flatUsed.push(String(it.subnet));
      });
      if (new Set(flatUsed).size !== flatUsed.length) {
        message.error('同一扁平子网在同一云主机内只能使用一次');
        setStep(3);
        return;
      }

      const pickNs = (x: unknown) => {
        if (x === undefined || x === null) return undefined;
        const s = String(x).trim();
        return s ? s : undefined;
      };
      const resolvedNamespace =
        pickNs(v.namespace) || pickNs(watchNamespace) || pickNs((formSnapshot as any)?.namespace);
      if (!resolvedNamespace) {
        message.error('未能读取项目，请返回第一步确认「项目」已选择');
        setStep(0);
        return;
      }
      v.namespace = resolvedNamespace;

      const metricConflictMsg = getVmWizardMetricAutoScheduledConflictMessage(v);
      if (metricConflictMsg) {
        message.error(metricConflictMsg);
        const conflicts = collectVmWizardMetricAutoScheduledConflicts(v);
        if (conflicts.includes('GPU')) setStep(1);
        else if (conflicts.some((c) => c === '直通网卡' || c === '直通SR-IOV')) setStep(3);
        else if (conflicts.includes('USB设备')) setStep(5);
        else setStep(0);
        return;
      }

      const sizeError = validateImageSize(v, images || []);
      if (sizeError) { message.error(sizeError); return; }

      const perfErr = validateVmPerformanceAdvancedForm({
        hugepagesEnabled: v.hugepagesEnabled,
        hugepagesPageSize: v.hugepagesPageSize,
        hotExpandEnabled: v.hotExpandEnabled,
        memory: v.memory,
        memoryLimitGi: v.memoryLimitGi,
        numaMode: v.numaMode,
        numaManualNodeCount: v.numaManualNodeCount,
        dedicatedCPUPlacement:
          v.dedicatedCPUPlacement || v.numaMode === 'auto' || v.numaMode === 'manual',
        cpuSockets: v.cpuSockets,
        cpuCores: v.cpuCores,
        cpuThreads: v.cpuThreads,
        cpu: v.cpu,
      });
      if (perfErr) {
        message.error(perfErr);
        setStep(1);
        return;
      }

      const cid = currentCloudId || (cloudId !== 'all' ? cloudId : undefined);
      if (!cid) { throw new Error('请选择资源池'); }

      let peerListForNic: any[] = existingVms;
      try {
        const json: any = await fetchCloudProviderEcs(cid, true);
        const extracted = extractCloudProviderEcsList(json);
        if (extracted.length > 0) peerListForNic = extracted;
      } catch {
        /* 使用内存中的 existingVms */
      }

      const nicDupSubmitErr = validateVmCreateWizardNicsMacIpAndSubnet(
        v,
        kubeSubnets || [],
      );
      if (nicDupSubmitErr) {
        message.error(nicDupSubmitErr);
        setStep(3);
        return;
      }
      const nicPeerSubmitErr = validateVmCreateWizardNicsAgainstPeerVms(
        v,
        peerListForNic,
        resolvedNamespace,
      );
      if (nicPeerSubmitErr) {
        message.error(nicPeerSubmitErr);
        setStep(3);
        return;
      }

      if (hostModeState === 'node' && !selectedNodeName) { throw new Error('请选择主机'); }
      if (
        hostModeState === 'label' &&
        !hasLabelModeNodeSelector({ failureDomainName: v.failureDomainName })
      ) {
        message.error(vmFailureDomainRequiredMessage());
        return;
      }
      // Primary NIC name is optional now (defaults to Pod Network)

      if (v.dedicatedCPUPlacement) {
        const checkCpuManager = (node: any) => {
          const anns = node?.metadata?.annotations || node?.annotations || {};
          const raw = anns['harvesterhci.io/cpu-manager-update-status'];
          if (!raw) return false;
          try {
            const obj = typeof raw === 'string' ? JSON.parse(raw) : raw;
            const p = String(obj?.policy || '').toLowerCase();
            const s = String(obj?.status || '').toLowerCase();
            return p === 'static' && s === 'success';
          } catch {
            return false;
          }
        };
        let ok = false;
        if (hostModeState === 'node' && selectedNodeName) {
          const node = (nodes || []).find((n: any) => String(n?.metadata?.name || n?.name || '') === String(selectedNodeName));
          ok = !!(node && checkCpuManager(node));
        } else {
          ok = (nodes || []).some((n: any) => checkCpuManager(n));
        }
        if (!ok) { message.error('当前物理节点未开启CPU管理'); return; }
      }

      let selectedGpu: any = null;
      // let finalGpuResName: string | undefined = undefined;
      if (v.gpuMode && String(v.gpuMode).toLowerCase() !== 'none') {
        let list = Array.isArray(gpuResources) ? gpuResources : [];
        if (list.length === 0) { 
           try { await reloadGpuResources(); } catch {} 
        }
        try {
            const res = validateAndGetGpu({ v, gpuResources: list, hostModeState, selectedNodeName });
            if (res) {
                selectedGpu = res.selectedGpu;
                // finalGpuResName = res.finalGpuResName;
                if (res.warning) message.info(res.warning);
            }
        } catch (e: any) { throw new Error(e?.message || 'GPU 资源不可用'); }
      }

      const pciNodes = new Set<string>();
      const primNic = v.primaryNic || {};
      if (
        (String(v.netMode) === 'passthrough' || String(v.netMode) === 'passthrough_sriov') &&
        String(primNic.passthroughSource || '') === 'pci-host' &&
        String(primNic.pciNodeName || '').trim()
      ) {
        pciNodes.add(String(primNic.pciNodeName).trim());
      }
      (Array.isArray(v.netIfaces) ? v.netIfaces : []).forEach((nic: any) => {
        if (
          (String(nic?.mode || '') === 'passthrough' || String(nic?.mode || '') === 'passthrough_sriov') &&
          String(nic?.passthroughSource || '') === 'pci-host' &&
          String(nic?.pciNodeName || '').trim()
        ) {
          pciNodes.add(String(nic.pciNodeName).trim());
        }
      });
      if (pciNodes.size > 1) {
        message.error('多块 PCI 直通网卡须位于同一节点。');
        return;
      }
      if (pciNodes.size === 1 && hostModeState === 'node' && selectedNodeName) {
        const only = [...pciNodes][0];
        if (only && String(selectedNodeName) !== only) {
          message.error('所选主机与 PCI 直通网卡所在节点不一致，请将调度改为「自动」或选择与网卡相同的节点。');
          return;
        }
      }
      if (selectedGpu && pciNodes.size === 1) {
        const gn = String(selectedGpu?.node || selectedGpu?.nodeName || '').trim();
        const pn = [...pciNodes][0];
        if (gn && pn && gn !== pn) {
          message.error('GPU 与 PCI 直通网卡不在同一节点，请调整 GPU 或网卡选择。');
          return;
        }
      }

      const usbNodes = new Set<string>();
      const usbRns = (Array.isArray(v.usbDevices) ? v.usbDevices : [])
        .map((x: unknown) => String(x ?? '').trim())
        .filter(Boolean);
      if (usbRns.length > 0) {
        const usbList = Array.isArray(usbResources) ? usbResources : [];
        for (const rn of usbRns) {
          const found = usbList.find(
            (x: any) => String(x?.resourceName || '').trim() === rn,
          );
          const node = String(
            found?.nodeName || found?.node || found?.raw?.status?.nodeName || '',
          ).trim();
          if (node) usbNodes.add(node);
        }
        if (usbNodes.size > 1) {
          message.error('多块 USB 设备须位于同一节点。');
          return;
        }
        if (usbNodes.size === 1) {
          const un = [...usbNodes][0];
          if (pciNodes.size === 1 && un !== [...pciNodes][0]) {
            message.error('USB 与 PCI 直通网卡不在同一节点，请调整设备选择。');
            return;
          }
          if (selectedGpu) {
            const gn = String(selectedGpu?.node || selectedGpu?.nodeName || '').trim();
            if (gn && un && gn !== un) {
              message.error('USB 与 GPU 不在同一节点，请调整设备选择。');
              return;
            }
          }
          if (hostModeState === 'node' && selectedNodeName && un !== String(selectedNodeName)) {
            message.error('所选主机与 USB 设备所在节点不一致，请将调度改为「自动」或选择与 USB 相同的节点。');
            return;
          }
        }
      }

      // ...
      // 生成唯一ID
      const vmId = await generateUniqueVmId(cid, v.namespace || 'default');

      const payload = constructVmPayload({
        v, memGi, hostModeState, selectedNodeName, gpuResources: gpuResources || [], selectedGpu, capabilities, vmId, // 传入 vmId
        nadOptions: nadOptions || [],
        usbResources: usbResources || [],
        deploymentSet:
          hostModeState === 'node'
            ? null
            : findDeploymentSetById(deploymentSets, v.deploymentSetId) ?? null,
        isArm64: (function() {
            if (nodes && nodes.length > 0) {
                 const n = nodes[0];
                 const arch = n?.status?.nodeInfo?.architecture || n?.architecture || '';
                 return String(arch).toLowerCase() === 'arm64' || String(arch).toLowerCase() === 'aarch64';
            }
            return false;
        })()
      });

      await createHarvesterVm(cid, payload);

      message.success('创建成功');
      sessionStorage.setItem('cloud_console_refresh_after_create', String(cid));
      const bg = (location.state as { backgroundLocation?: { pathname?: string; search?: string; hash?: string } } | null)
        ?.backgroundLocation;
      if (bg?.pathname) {
        navigate(`${bg.pathname}${bg.search || ''}${bg.hash || ''}`, { replace: true });
      } else {
        navigate(-1);
      }
    } catch (e: any) {
      message.error(translateKnownApiErrorMessage(String(e?.message || e || '创建失败')));
    } finally {
      submitInFlightRef.current = false;
      setSubmitting(false);
    }
  };

  if (authLoading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '60vh' }}>
        <Spin size="large" />
      </div>
    );
  }
  if (user && !canUseVmCreateWizard) {
    return null;
  }

  return (
    <Modal
      title="创建云主机"
      open
      destroyOnHidden
      footer={null}
      width={'70vw'}
      centered
      styles={{
        body: { height: '80vh', maxHeight: '80vh', overflow: 'hidden'}
      }}
      onCancel={() => navigate(-1)}
    >
      <Row gutter={[0, 0]} style={{ height: '100%' }}>
          <Col span={5}>
            <div className="wizard-sidebar">
              <div>
                {steps.map((t, idx)=> (
                  <div
                    key={t}
                    className={`wizard-step ${step===idx?'active':''} ${stepValid[idx] ? 'completed' : ''}`}
                    onClick={async ()=> {
                      // 离开当前步骤前进行验证并保存数据
                      const isValid = await handleStepValidation(step);
                      if (isValid) {
                          try { setFormSnapshot(form.getFieldsValue(true)); } catch {}
                      }
                      setStep(idx);
                    }}
                  >
                    <div className="wizard-step-icon">
                      {stepValid[idx] ? (<CheckOutlined />) : (getStepIcon(idx))}
                    </div>
                    <span className="wizard-step-text">{t}</span>
                  </div>
                ))}
              </div>
            </div>
          </Col>
          <Col span={12} style={{ height: '100%' }}>
            <div className="wizard-section">
              <Form form={form} layout="vertical" initialValues={initialWizardValues(memGi, initialVmName, cloudId)} onValuesChange={(changed:any)=> { 
                if (Object.prototype.hasOwnProperty.call(changed, 'hostMode')) {
                  setHostModeState(changed.hostMode);
                  if (changed.hostMode === 'node') {
                    try {
                      clearVmAdvancedSchedulingFormFields(form);
                      applyDeploymentSetToWizardForm(form, null);
                    } catch {}
                  }
                  if (changed.hostMode !== 'auto') {
                    try { form.setFieldsValue({ metricAutoScheduled: false }); } catch {}
                  }
                }
                if (Object.prototype.hasOwnProperty.call(changed, 'metricAutoScheduled') && changed.metricAutoScheduled === true) {
                  const metricConflictMsg = getVmWizardMetricAutoScheduledConflictMessage(
                    form.getFieldsValue(true) as Record<string, unknown>,
                  );
                  if (metricConflictMsg) {
                    message.error(metricConflictMsg);
                    try { form.setFieldsValue({ metricAutoScheduled: false }); } catch {}
                  } else {
                    try { applyDeploymentSetToWizardForm(form, null); } catch {}
                  }
                }
                if (Object.prototype.hasOwnProperty.call(changed, 'deploymentSetId') && changed.deploymentSetId) {
                  try {
                    const set = findDeploymentSetById(deploymentSets, changed.deploymentSetId);
                    if (set) {
                      applyDeploymentSetExclusive(form, set);
                    } else {
                      form.setFieldsValue({ metricAutoScheduled: false });
                    }
                  } catch {}
                }
                if (Object.prototype.hasOwnProperty.call(changed, 'netMode')) { setNetModeState(changed.netMode); }
                if (Object.prototype.hasOwnProperty.call(changed, 'rootSourceType')) {
                  // 切换来源时清理互斥字段
                  const t = changed.rootSourceType;
                  if (t === 'image') { try { form.setFieldsValue({ rootPvc: undefined }); } catch {} }
                  if (t === 'existing') { try { form.setFieldsValue({ image: undefined }); } catch {} }
                }
                if (Object.prototype.hasOwnProperty.call(changed, 'rootPvc')) {
                  handleRootPvcChange(form, availableVolumes || [], changed.rootPvc);
                }
                
                  try { setFormSnapshot(form.getFieldsValue(true)); } catch {}
                }}>
            <div className="wizard-step-scroll">
              <div
                className={`wizard-step-panel ${step === 0 ? 'is-active' : ''}`}
                aria-hidden={step !== 0}
              >
                <StepBasic
                  form={form}
                  existingVms={existingVms}
                  cloudId={cloudId}
                  currentCloudId={currentCloudId}
                  setCurrentCloudId={setCurrentCloudId}
                  cloudOptions={cloudOptions}
                  namespaceOptions={namespaceOptions}
                  reloadNamespaces={reloadNamespaces}
                  hostModeState={hostModeState}
                  setHostModeState={setHostModeState}
                  nodeKeyword={nodeKeyword}
                  setNodeKeyword={setNodeKeyword}
                  nodesLoading={nodesLoading}
                  reloadNodes={reloadNodes}
                  currentProvider={currentProvider}
                  selectedNodeName={selectedNodeName}
                  setSelectedNodeName={setSelectedNodeName}
                  filteredNodes={filteredNodes}
                  isTenant={isTenant}
                  namespaceRecords={namespaces}
                  onDeploymentSetsLoaded={setDeploymentSets}
                />
              </div>
              <div
                className={`wizard-step-panel ${step === 1 ? 'is-active' : ''}`}
                aria-hidden={step !== 1}
              >
                <StepCompute
                  form={form}
                  isArm64={isArm64}
                  memPreset={memPreset}
                  setMemPreset={setMemPreset}
                  memGi={memGi}
                  setMemGi={setMemGi}
                  gpuResources={gpuResources}
                  reloadGpuResources={reloadGpuResources}
                  selectedGpuKey={selectedGpuKey}
                  setSelectedGpuKey={setSelectedGpuKey}
                  setFormSnapshot={setFormSnapshot}
                />
              </div>
              <div
                className={`wizard-step-panel ${step === 2 ? 'is-active' : ''}`}
                aria-hidden={step !== 2}
              >
                <StepDisks
                  form={form}
                  imageLoading={imageLoading}
                  reloadImages={reloadImages}
                  images={images}
                  defaultStorageClassName={defaultStorageClassName}
                  reloadStorageClasses={reloadStorageClasses}
                  volumeOptions={volumeOptions}
                  reloadVolumes={reloadVolumes}
                  availableVolumes={availableVolumes}
                  storageClasses={storageClasses}
                  storageClassLoading={storageClassLoading}
                  isArm64={isArm64}
                />
              </div>
              <div
                className={`wizard-step-panel ${step === 3 ? 'is-active' : ''}`}
                aria-hidden={step !== 3}
              >
                <StepNetworks
                  form={form}
                  netModeState={netModeState}
                  setNetModeState={setNetModeState}
                  nadOptions={nadOptions}
                  reloadNads={reloadNads}
                  kubeVpcOptions={kubeVpcOptions}
                  reloadKubeVpcs={reloadKubeVpcs}
                  kubeSubnets={kubeSubnets}
                  reloadKubeSubnets={reloadKubeSubnets}
                  pciDevices={pciDevices}
                  nodes={nodes}
                  nodesLoading={nodesLoading}
                  reloadNodes={reloadNodes}
                  scheduleHostMode={hostModeState}
                  scheduleSelectedNode={selectedNodeName}
                  reloadPciDevices={reloadPciDevices}
                  selectedNetIdx={selectedNetIdx}
                  setSelectedNetIdx={setSelectedNetIdx}
                  cloudId={currentCloudId || (cloudId !== 'all' ? cloudId : undefined)}
                  existingVms={existingVms}
                />
              </div>
              <div
                className={`wizard-step-panel ${step === 4 ? 'is-active' : ''}`}
                aria-hidden={step !== 4}
              >
                <StepLoginSettings
                  form={form}
                  sshKeyOptions={sshKeyOptions}
                  sshKeysLoaded={sshKeysLoaded}
                  sshKeysLoading={sshKeysLoading}
                  reloadSshKeys={reloadSshKeys}
                />
              </div>
              <div
                className={`wizard-step-panel ${step === 5 ? 'is-active' : ''}`}
                aria-hidden={step !== 5}
              >
                <StepOthers
                  form={form}
                  usbResources={usbResources}
                  usbResourcesLoaded={usbResourcesLoaded}
                  usbResourcesLoading={usbResourcesLoading}
                  reloadUsbResources={reloadUsbResources}
                />
              </div>
            </div>
            </Form>
            </div>
          </Col>
        <Col span={7} style={{ height: '100%' }}>
          <WizardSummary
            formSnapshot={formSnapshot}
            currentCloudId={currentCloudId}
            cloudId={cloudId}
            clouds={clouds}
            hostModeState={hostModeState}
            selectedNodeName={selectedNodeName}
            netModeState={netModeState}
            kubeSubnets={kubeSubnets}
            memGi={memGi}
            deploymentSets={deploymentSets}
          >
            <div className="wizard-preview-actions">
              <Space>
                <Button onClick={()=> navigate(-1)}>取消</Button>
                <Button disabled={step===0} onClick={prev}>上一步</Button>
                <Button
                  type="primary"
                  loading={submitting}
                  disabled={submitting}
                  onClick={()=> { if (step < steps.length - 1) { next(); } else { submit(); } }}
                >
                  {step < steps.length - 1 ? '下一步' : '创建'}
                </Button>
              </Space>
            </div>
          </WizardSummary>
        </Col>
        </Row>
    </Modal>
  );
};

export default VmCreateWizardModal;
