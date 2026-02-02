import React, { useEffect, useMemo, useState } from 'react';
import { Button, Form, Row, Col, Modal, Spin, message, Space } from 'antd';
import { CheckOutlined, ProfileOutlined, DesktopOutlined, HddOutlined, GlobalOutlined, SettingOutlined } from '@ant-design/icons';
import './InstanceWizard.css';
import { useNavigate, useParams } from 'react-router-dom';
import StepBasic from './StepBasic';
import StepCompute from './StepCompute';
import StepDisks from './StepDisks';
import StepNetworks from './StepNetworks';
import StepOthers from './StepOthers';
import WizardSummary from './WizardSummary';
import { useHarvesterData } from './useHarvesterData';
import { validateAndGetGpu, initialWizardValues, filterNodes, validateImageSize, handleAutoStart, constructVmPayload, handleRootPvcChange } from './VmWizardUtils';
import { createHarvesterVm, fetchHarvesterCapabilities } from '../../../../services/api';

const VmCreateWizardModal: React.FC = () => {
  const navigate = useNavigate();
  const { id } = useParams();
  const cloudId = id as string;
  const [form] = Form.useForm();
  const [wizardData, setWizardData] = useState<any>({});
  const [step, setStep] = useState<number>(0);
  const [submitting, setSubmitting] = useState(false);
  const [autoStart, setAutoStart] = useState<boolean>(false);
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
    namespaces, reloadNamespaces, namespaceOptions,
    nads, reloadNads, nadOptions,
    nodes, nodesLoading, reloadNodes,
    clouds, loadClouds, cloudOptions, currentProvider,
    kubeSubnets, reloadKubeSubnets, kubeSubnetOptions,
    kubeVpcs, reloadKubeVpcs, kubeVpcOptions,
    gpuResources, reloadGpuResources,
    usbResources, reloadUsbResources,
    storageClasses, storageClassLoading, reloadStorageClasses, defaultStorageClassName
  } = useHarvesterData(cloudId, currentCloudId, form);

  useEffect(() => {
    loadClouds();
  }, [loadClouds]);

  useEffect(() => {
    const load = async () => {
      if (!currentCloudId && cloudId === 'all') return;
      if (!form.getFieldValue('namespace')) { try { form.setFieldsValue({ namespace: 'default' }); } catch {} }
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
  }, [cloudId, currentCloudId, reloadImages, reloadNamespaces, reloadNads, reloadNodes]);

  useEffect(() => {
    if (step === 4) { try { reloadUsbResources(); } catch {} }
  }, [step, reloadUsbResources]);

  useEffect(() => {
    if (step === 1) { try { reloadGpuResources(); } catch {} }
  }, [step, reloadGpuResources]);

  useEffect(() => {
    try { reloadGpuResources(); } catch {}
  }, [cloudId, currentCloudId, reloadGpuResources]);

  useEffect(() => {
    try { setFormSnapshot(form.getFieldsValue()); } catch {}
  }, []);


  const filteredNodes = useMemo(() => filterNodes(nodes, nodeKeyword), [nodes, nodeKeyword]);








  const steps = ['基本信息','计算资源','虚拟磁盘','虚拟网卡','其它选项'];
  const getStepIcon = (i: number): React.ReactNode => {
    const icons = [<ProfileOutlined />, <DesktopOutlined />, <HddOutlined />, <GlobalOutlined />, <SettingOutlined />];
    return icons[i] || <ProfileOutlined />;
  };

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
      if (!v.primaryNic || !v.primaryNic.name) { throw new Error('请选择主网卡网络（NAD）'); }

      let selectedGpu: any = null;
      let finalGpuResName: string | undefined = undefined;
      if (v.gpuMode) {
        let list = Array.isArray(gpuResources) ? gpuResources : [];
        if (list.length === 0) { 
           try { await reloadGpuResources(); } catch {} 
        }
        try {
            const res = validateAndGetGpu({ v, gpuResources: list, hostModeState, selectedNodeName });
            if (res) {
                selectedGpu = res.selectedGpu;
                finalGpuResName = res.finalGpuResName;
                if (res.warning) message.info(res.warning);
            }
        } catch (e: any) { throw new Error(e?.message || 'GPU 资源不可用'); }
      }

      const payload = constructVmPayload({
        v, memGi, hostModeState, selectedNodeName, gpuResources: gpuResources || [], selectedGpu, capabilities
      });

      await createHarvesterVm(cid, payload);

      if (autoStart) {
        await handleAutoStart(cid, v);
      }
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
        mask: { backdropFilter: 'blur(4px)', backgroundColor: 'rgba(0,0,0,0.45)' },
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
                  kubeSubnetOptions={kubeSubnetOptions}
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
                  autoStart={autoStart}
                  setAutoStart={setAutoStart}
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
            autoStart={autoStart}
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
