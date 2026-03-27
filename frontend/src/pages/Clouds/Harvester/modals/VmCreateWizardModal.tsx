/**
 * Harvester - 云主机创建向导弹窗
 * frontend/src/pages/Clouds/Harvester/modals/VmCreateWizardModal.tsx
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
import { Button, Form, Row, Col, Modal, App, Space } from 'antd';
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
import { validateAndGetGpu, initialWizardValues, filterNodes, validateImageSize, constructVmPayload, handleRootPvcChange, generateUniqueVmId, applyTemplateToWizardForm, parseSizeToGi } from './VmCreateWizard/VmWizardUtils';
import { fetchHarvesterCapabilities, createHarvesterVm } from '../../../../services/harvesterApi';
import { fetchCloudProviderEcs } from '../../../../services/api';

type Props = {
  isTenant?: boolean;
};

const VmCreateWizardModal: React.FC<Props> = ({ isTenant: propIsTenant = false }) => {
  const { message } = App.useApp();
  const navigate = useNavigate();
  const location = useLocation();
  const { id } = useParams();
  const cloudId = id as string;

  // [Fix] isTenant priority: 1. props 2. location.state 3. default false
  const stateIsTenant = (location.state as any)?.isTenant;
  const isTenant = propIsTenant || stateIsTenant || false;

  const [form] = Form.useForm();
  /** 订阅命名空间，供 useHarvesterData 过滤卷选项；避免在 Form 未挂载时调用 form.getFieldValue 触发 antd 警告 */
  const watchNamespace = Form.useWatch('namespace', form);
  // 当前步骤索引、提交状态（表单值由单一 Form 持有，方案 A 各步同挂）
  const [step, setStep] = useState<number>(0);
  const [submitting, setSubmitting] = useState(false);
  const [currentCloudId, setCurrentCloudId] = useState<string | undefined>(cloudId !== 'all' ? cloudId : undefined);
  const [selectedDiskIdx, setSelectedDiskIdx] = useState<number | null>(null);
  const [selectedNetIdx, setSelectedNetIdx] = useState<number | null>(null);
  const [hostModeState, setHostModeState] = useState<string>('auto');
  const [netModeState, setNetModeState] = useState<string>('flat_subnet');
  const [selectedNodeName, setSelectedNodeName] = useState<string | null>(null);
  const [nodeKeyword, setNodeKeyword] = useState<string>('');
  const [initialVmName] = useState<string>(()=> `vm-${Math.random().toString(36).slice(2,6)}-${Date.now().toString(36).slice(-4)}`);
  const [memPreset, setMemPreset] = useState<string>('4');
  const [memGi, setMemGi] = useState<number>(4);
  const [formSnapshot, setFormSnapshot] = useState<any>({});
  const [selectedGpuKey, setSelectedGpuKey] = useState<string | null>(null);
  const [capabilities, setCapabilities] = useState<any>(null);
  const [existingVms, setExistingVms] = useState<any[]>([]);
  const lastValidationErrorTypeRef = useRef<string | null>(null);
  /** 防止连点/双击在 setSubmitting 生效前并发提交，导致重复创建 VM */
  const submitInFlightRef = useRef(false);

  const {
    images, imageLoading, reloadImages, imageOptions,
    availableVolumes, reloadVolumes, volumeOptions,
    reloadNamespaces, namespaceOptions,
    reloadNads, nadOptions,
    nodes, nodesLoading, reloadNodes,
    clouds, loadClouds, cloudOptions, currentProvider,
    kubeSubnets, reloadKubeSubnets,
    reloadKubeVpcs, kubeVpcOptions,
    gpuResources, reloadGpuResources,
    usbResources, reloadUsbResources,
    storageClasses, storageClassLoading, reloadStorageClasses, defaultStorageClassName,
    sshKeyOptions, reloadSshKeys
  } = useHarvesterData(cloudId, currentCloudId, form, isTenant, watchNamespace);

  const fromTemplateState = (location.state as any)?.fromTemplate;
  const fromVmState = (location.state as any)?.fromVm;

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

  // 进入“登录设置/其它选项”步骤时，懒加载 SSH 密钥 / USB 资源
  useEffect(() => {
    if (step === 4) {
      try { reloadSshKeys(); } catch {}
    }
    if (step === 5) {
      try { reloadUsbResources(); } catch {}
      try { reloadSshKeys(); } catch {}
    }
  }, [step, reloadUsbResources, reloadSshKeys]);

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
        return ['cloudId', 'namespace', 'name', 'hostMode', 'clusterArch', 'machineType', 'nodeSelectorPairs', 'description', 'group'];
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
          ['primaryNic', 'macAddress'], 
          ['primaryNic', 'ipAddress'], 
          ['primaryNic', 'gateway'], 
          ['primaryNic', 'dns'],
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
          'userData', 
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
      
      // Step 0 额外校验：若选择指定主机模式，必须选中主机
      if (targetStep === 0 && hostModeState === 'node' && !selectedNodeName) {
        throw new Error('Node not selected');
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
        message.error('未能读取命名空间，请返回第一步确认「命名空间」已选择');
        setStep(0);
        return;
      }
      v.namespace = resolvedNamespace;

      const sizeError = validateImageSize(v, images || []);
      if (sizeError) { message.error(sizeError); return; }

      const cid = currentCloudId || (cloudId !== 'all' ? cloudId : undefined);
      if (!cid) { throw new Error('请选择资源池'); }
      if (hostModeState === 'node' && !selectedNodeName) { throw new Error('请选择主机'); }
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

      // ...
      // 生成唯一ID
      const vmId = await generateUniqueVmId(cid, v.namespace || 'default');

      const payload = constructVmPayload({
        v, memGi, hostModeState, selectedNodeName, gpuResources: gpuResources || [], selectedGpu, capabilities, vmId, // 传入 vmId
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
      message.error(e?.message || '创建失败');
    } finally {
      submitInFlightRef.current = false;
      setSubmitting(false);
    }
  };

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
                if (Object.prototype.hasOwnProperty.call(changed, 'hostMode')) { setHostModeState(changed.hostMode); }
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
                  imageOptions={imageOptions}
                  imageLoading={imageLoading}
                  reloadImages={reloadImages}
                  images={images}
                  defaultStorageClassName={defaultStorageClassName}
                  reloadStorageClasses={reloadStorageClasses}
                  initialVmName={initialVmName}
                  volumeOptions={volumeOptions}
                  reloadVolumes={reloadVolumes}
                  availableVolumes={availableVolumes}
                  storageClasses={storageClasses}
                  storageClassLoading={storageClassLoading}
                  selectedDiskIdx={selectedDiskIdx}
                  setSelectedDiskIdx={setSelectedDiskIdx}
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
                  selectedNetIdx={selectedNetIdx}
                  setSelectedNetIdx={setSelectedNetIdx}
                />
              </div>
              <div
                className={`wizard-step-panel ${step === 4 ? 'is-active' : ''}`}
                aria-hidden={step !== 4}
              >
                <StepLoginSettings
                  form={form}
                  sshKeyOptions={sshKeyOptions}
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
                  reloadUsbResources={reloadUsbResources}
                  sshKeyOptions={sshKeyOptions}
                  reloadSshKeys={reloadSshKeys}
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
