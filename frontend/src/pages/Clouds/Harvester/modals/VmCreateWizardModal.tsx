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
 *    - 使用 `wizardData` 累积各步骤的表单数据。
 *    - 使用 `formSnapshot` 实时同步表单状态用于右侧摘要展示。
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
import React, { useEffect, useMemo, useState } from 'react';
import { Button, Form, Row, Col, Modal, message, Space } from 'antd';
import { CheckOutlined, ProfileOutlined, DesktopOutlined, HddOutlined, GlobalOutlined, SettingOutlined } from '@ant-design/icons';
import './VmCreateWizard/InstanceWizard.css';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import StepBasic from './VmCreateWizard/StepBasic';
import StepCompute from './VmCreateWizard/StepCompute';
import StepDisks from './VmCreateWizard/StepDisks';
import StepNetworks from './VmCreateWizard/StepNetworks';
import StepOthers from './VmCreateWizard/StepOthers';
import WizardSummary from './VmCreateWizard/WizardSummary';
import { useHarvesterData } from './VmCreateWizard/useHarvesterData';
import { validateAndGetGpu, initialWizardValues, filterNodes, validateImageSize, constructVmPayload, handleRootPvcChange, generateUniqueVmId, applyTemplateToWizardForm, parseSizeToGi } from './VmCreateWizard/VmWizardUtils';
import { fetchHarvesterCapabilities, createHarvesterVm } from '../../../../services/harvesterApi';

const VmCreateWizardModal: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { id } = useParams();
  const cloudId = id as string;
  const [form] = Form.useForm();
  // 向导全局状态：跨步骤累积的表单数据、当前步骤索引、提交状态等
  const [wizardData, setWizardData] = useState<any>({});
  const [step, setStep] = useState<number>(0);
  const [submitting, setSubmitting] = useState(false);
  const [currentCloudId, setCurrentCloudId] = useState<string | undefined>(cloudId !== 'all' ? cloudId : undefined);
  const [selectedDiskIdx, setSelectedDiskIdx] = useState<number | null>(null);
  const [selectedNetIdx, setSelectedNetIdx] = useState<number | null>(null);
  const [hostModeState, setHostModeState] = useState<string>('auto');
  const [netModeState, setNetModeState] = useState<string>('flat');
  const [selectedNodeName, setSelectedNodeName] = useState<string | null>(null);
  const [nodeKeyword, setNodeKeyword] = useState<string>('');
  const [initialVmName] = useState<string>(()=> `vm-${Math.random().toString(36).slice(2,6)}-${Date.now().toString(36).slice(-4)}`);
  const [memPreset, setMemPreset] = useState<string>('4');
  const [memGi, setMemGi] = useState<number>(4);
  const [formSnapshot, setFormSnapshot] = useState<any>({});
  const [selectedGpuKey, setSelectedGpuKey] = useState<string | null>(null);
  const [capabilities, setCapabilities] = useState<any>(null);

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
  } = useHarvesterData(cloudId, currentCloudId, form);

  const fromTemplateState = (location.state as any)?.fromTemplate;
  const fromVmState = (location.state as any)?.fromVm;

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
      try {
        const cid = currentCloudId || (cloudId !== 'all' ? cloudId : undefined);
        if (cid) {
          const caps = await fetchHarvesterCapabilities(cid);
          setCapabilities(caps?.data || null);
          const rec = String(caps?.data?.recommendedMachineType || '').trim();
          if (rec) { try { form.setFieldsValue({ machineType: rec }); } catch {} }
        }
      } catch {}
      reloadImages();
      reloadNamespaces();
      reloadNads();
      reloadNodes();
    };
    load();
  }, [cloudId, currentCloudId, reloadImages, reloadNamespaces, reloadNads, reloadNodes, form]);

  // 进入“其它选项”步骤时，懒加载 USB 资源和 SSH 密钥
  useEffect(() => {
    if (step === 4) { 
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
    try { setFormSnapshot(form.getFieldsValue()); } catch {}
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
  const steps = ['基本信息','计算资源','虚拟磁盘','虚拟网卡','其它选项'];
  const getStepIcon = (i: number): React.ReactNode => {
    const icons = [<ProfileOutlined />, <DesktopOutlined />, <HddOutlined />, <GlobalOutlined />, <SettingOutlined />];
    return icons[i] || <ProfileOutlined />;
  };

  /**
   * 进入下一步：
   * - 按步骤只校验当前关键字段；
   * - 合并当前表单值到 wizardData，并更新快照；
   * - 步骤索引不会超过最后一步。
   */
  const next = async () => {
    try {
      if (step === 0) {
        await form.validateFields(['namespace','name']);
      }
      if (step === 1) {
        await form.validateFields(['cpu','memory']);
      }
      if (step === 2) {
        await form.validateFields();
      }
      const curr = form.getFieldsValue();
      setWizardData((prev:any)=> ({ ...prev, ...curr }));
      try { setFormSnapshot((prev:any)=> ({ ...prev, ...curr })); } catch {}
      setStep(Math.min(steps.length - 1, step + 1));
    } catch (e:any) {
      message.error('请完整填写必填项');
    }
  };

  

  /**
   * 最终提交创建云主机：
   * - 汇总 wizardData + 当前表单值；
   * - 校验镜像大小与磁盘容量是否匹配；
   * - 构造 VM payload（含宿主调度/GPU/网络/磁盘等）；
   * - 创建 VM，并在需要时执行自动开机。
   */
  const submit = async () => {
    try {
      await form.validateFields();
      const v = { ...wizardData, ...form.getFieldsValue() } as any;
      
      const sizeError = validateImageSize(v, images || []);
      if (sizeError) { message.error(sizeError); return; }

      setSubmitting(true);
      const cid = currentCloudId || (cloudId !== 'all' ? cloudId : undefined);
      if (!cid) { throw new Error('请选择资源池'); }
      if (hostModeState === 'node' && !selectedNodeName) { throw new Error('请选择主机'); }
      // Primary NIC name is optional now (defaults to Pod Network)

      let selectedGpu: any = null;
      // let finalGpuResName: string | undefined = undefined;
      if (v.gpuMode) {
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
      navigate(-1);
    } catch (e: any) {
      message.error(e?.message || '创建失败');
    } finally {
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
                    className={`wizard-step ${step===idx?'active':''} ${idx < step ? 'completed' : ''}`}
                    onClick={()=> setStep(idx)}
                  >
                    <div className="wizard-step-icon">
                      {idx < step ? (<CheckOutlined />) : (getStepIcon(idx))}
                    </div>
                    <span className="wizard-step-text">{t}</span>
                  </div>
                ))}
              </div>
            </div>
          </Col>
          <Col span={12} style={{ height: '100%' }}>
            <div className="wizard-section">
              <Form form={form} layout="vertical" initialValues={initialWizardValues(memGi, initialVmName)} onValuesChange={(changed:any)=> { 
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
                
                  try { setFormSnapshot((prev:any)=> ({ ...prev, ...form.getFieldsValue() })); } catch {}
                }}>
            <div className="wizard-step-scroll">
              {step === 0 && (
                <StepBasic
                  form={form}
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
                />
              )}
              {step === 1 && (
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
              )}
              {step === 2 && (
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
              )}
              {step === 3 && (
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
              )}
              {step === 4 && (
                <StepOthers
                  form={form}
                  usbResources={usbResources}
                  reloadUsbResources={reloadUsbResources}
                  sshKeyOptions={sshKeyOptions}
                  reloadSshKeys={reloadSshKeys}
                />
              )}
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
                <Button type="primary" loading={submitting} onClick={()=> { if (step < steps.length - 1) { next(); } else { submit(); } }}>下一步</Button>
              </Space>
            </div>
          </WizardSummary>
        </Col>
        </Row>
    </Modal>
  );
};

export default VmCreateWizardModal;
