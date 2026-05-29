import React, { useEffect, useMemo, useState } from 'react';
import { App, Modal, Form, Input, InputNumber, Select, Radio, Spin } from 'antd';
import { createHuaweiServer, fetchHuaweiFlavors, fetchHuaweiAvailabilityZones, fetchHuaweiImages, fetchHuaweiKeypairs } from '../../../../../services/huaweiApi';

type Props = {
  open: boolean;
  cloudId: string;
  vpcs: any[];
  subnets: any[];
  secGroups: any[];
  onClose: () => void;
  onSuccess: () => void;
};

const rootVolTypeOptions = [
  { label: '高IO (SAS)', value: 'SAS' },
  { label: '超高IO (SSD)', value: 'SSD' },
  { label: '普通IO (SATA)', value: 'SATA' },
  { label: '通用型SSD (GPSSD)', value: 'GPSSD' },
];

const EcsCreateModal: React.FC<Props> = ({ open, cloudId, vpcs, subnets, secGroups, onClose, onSuccess }) => {
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const [loadingDeps, setLoadingDeps] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [flavors, setFlavors] = useState<any[]>([]);
  const [zones, setZones] = useState<any[]>([]);
  const [images, setImages] = useState<any[]>([]);
  const [keypairs, setKeypairs] = useState<any[]>([]);
  const [loginType, setLoginType] = useState<'password' | 'keypair'>('password');

  useEffect(() => {
    if (!open || !cloudId) return;
    form.resetFields();
    setLoginType('password');
    form.setFieldsValue({ rootVolumeType: 'SAS', rootVolumeSize: 40, count: 1 });
    const load = async () => {
      setLoadingDeps(true);
      try {
        const [fJson, zJson, imgGold, imgPriv, kpJson]: any[] = await Promise.all([
          fetchHuaweiFlavors(cloudId).catch(() => null),
          fetchHuaweiAvailabilityZones(cloudId).catch(() => null),
          fetchHuaweiImages(cloudId, { imagetype: 'gold' }).catch(() => null),
          fetchHuaweiImages(cloudId, { imagetype: 'private' }).catch(() => null),
          fetchHuaweiKeypairs(cloudId).catch(() => null),
        ]);
        setFlavors((fJson?.data?.flavors) || (fJson?.flavors) || []);
        setZones((zJson?.data?.availabilityZoneInfo) || (zJson?.availabilityZoneInfo) || []);
        const pImg = (j: any) => (j?.data?.images) || (j?.images) || [];
        setImages([...pImg(imgPriv), ...pImg(imgGold)]);
        const kpRaw = (kpJson?.data?.keypairs) || (kpJson?.keypairs) || [];
        setKeypairs(Array.isArray(kpRaw) ? kpRaw.map((x: any) => x?.keypair || x) : []);
      } catch (e: any) { message.error(e?.message || '加载创建依赖失败'); }
      finally { setLoadingDeps(false); }
    };
    load();
  }, [open, cloudId, form, message]);

  const flavorOptions = useMemo(() => flavors.map((f: any) => ({ label: `${f?.name || f?.id}（${f?.vcpus}vCPU ${f?.ram ? Math.round(Number(f.ram) / 1024) : '?'}GB）`, value: f?.id || f?.name })), [flavors]);
  const zoneOptions = useMemo(() => zones.filter((z: any) => z?.zoneState?.available !== false).map((z: any) => ({ label: z?.zoneName, value: z?.zoneName })), [zones]);
  const imageOptions = useMemo(() => images.map((i: any) => ({ label: `${i?.name}（${i?.os_version || i?.__imagetype || ''}）`, value: i?.id })), [images]);
  const vpcOptions = useMemo(() => (vpcs || []).map((v: any) => ({ label: `${v?.name || v?.id}`, value: v?.id })), [vpcs]);
  const keypairOptions = useMemo(() => keypairs.map((k: any) => ({ label: k?.name, value: k?.name })), [keypairs]);

  const selectedVpc = Form.useWatch('vpcid', form);
  const subnetOptions = useMemo(() => (subnets || []).filter((s: any) => !selectedVpc || String(s?.vpc_id || '') === String(selectedVpc)).map((s: any) => ({ label: `${s?.name || s?.id}（${s?.cidr || ''}）`, value: s?.id })), [subnets, selectedVpc]);
  const sgOptions = useMemo(() => (secGroups || []).map((g: any) => ({ label: `${g?.name || g?.id}`, value: g?.id })), [secGroups]);

  const handleOk = async () => {
    try {
      const v = await form.validateFields();
      setSubmitting(true);
      await createHuaweiServer(cloudId, {
        name: v.name,
        imageRef: v.imageRef,
        flavorRef: v.flavorRef,
        vpcid: v.vpcid,
        subnetId: v.subnetId,
        availabilityZone: v.availabilityZone,
        rootVolumeType: v.rootVolumeType,
        rootVolumeSize: v.rootVolumeSize,
        count: v.count,
        securityGroupIds: v.securityGroupIds,
        ...(loginType === 'password' ? { adminPass: v.adminPass } : { keyName: v.keyName }),
      });
      message.success('创建实例指令已下发');
      onSuccess();
    } catch (e: any) { if (e?.errorFields) return; message.error(e?.message || '创建实例失败'); }
    finally { setSubmitting(false); }
  };

  return (
    <Modal title="创建云主机" open={open} onCancel={onClose} onOk={handleOk} confirmLoading={submitting} okText="创建" cancelText="取消" width={680} destroyOnHidden>
      <Spin spinning={loadingDeps} tip="加载创建依赖...">
        <Form form={form} layout="vertical">
          <Form.Item name="availabilityZone" label="可用区"><Select showSearch optionFilterProp="label" placeholder="不选则由系统分配" options={zoneOptions} allowClear /></Form.Item>
          <Form.Item name="imageRef" label="镜像" rules={[{ required: true, message: '请选择镜像' }]}><Select showSearch optionFilterProp="label" placeholder="请选择镜像" options={imageOptions} /></Form.Item>
          <Form.Item name="flavorRef" label="规格" rules={[{ required: true, message: '请选择规格' }]}><Select showSearch optionFilterProp="label" placeholder="请选择规格" options={flavorOptions} /></Form.Item>
          <Form.Item name="vpcid" label="虚拟私有云 VPC" rules={[{ required: true, message: '请选择 VPC' }]}><Select showSearch optionFilterProp="label" placeholder="请选择 VPC" options={vpcOptions} onChange={() => form.setFieldsValue({ subnetId: undefined })} /></Form.Item>
          <Form.Item name="subnetId" label="子网" rules={[{ required: true, message: '请选择子网' }]}><Select showSearch optionFilterProp="label" placeholder="请选择子网" options={subnetOptions} /></Form.Item>
          <Form.Item name="securityGroupIds" label="安全组"><Select mode="multiple" showSearch optionFilterProp="label" placeholder="可多选" options={sgOptions} /></Form.Item>
          <Form.Item name="rootVolumeType" label="系统盘类型" rules={[{ required: true }]}><Select options={rootVolTypeOptions} /></Form.Item>
          <Form.Item name="rootVolumeSize" label="系统盘大小 (GB)" rules={[{ required: true }]}><InputNumber min={40} max={1024} style={{ width: '100%' }} /></Form.Item>
          <Form.Item label="登录凭证">
            <Radio.Group value={loginType} onChange={(e) => setLoginType(e.target.value)} options={[{ label: '密码', value: 'password' }, { label: '密钥对', value: 'keypair' }]} optionType="button" />
          </Form.Item>
          {loginType === 'password' ? (
            <Form.Item name="adminPass" label="登录密码" rules={[{ required: true, message: '请输入密码' }, { min: 8, message: '至少 8 位' }]}><Input.Password placeholder="含大小写字母、数字、特殊字符" /></Form.Item>
          ) : (
            <Form.Item name="keyName" label="密钥对" rules={[{ required: true, message: '请选择密钥对' }]}><Select showSearch optionFilterProp="label" placeholder={keypairOptions.length ? '请选择密钥对' : '暂无密钥对'} options={keypairOptions} /></Form.Item>
          )}
          <Form.Item name="name" label="实例名称"><Input placeholder="选填" maxLength={64} allowClear /></Form.Item>
          <Form.Item name="count" label="购买数量" rules={[{ required: true }]}><InputNumber min={1} max={100} style={{ width: '100%' }} /></Form.Item>
        </Form>
      </Spin>
    </Modal>
  );
};

export default EcsCreateModal;
