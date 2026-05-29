import React, { useEffect, useMemo, useState } from 'react';
import { App, Modal, Form, Input, InputNumber, Select, Radio, Spin } from 'antd';
import {
  createCloudProviderEcs,
  fetchCloudProviderImages,
  fetchCloudProviderInstanceTypes,
  fetchCloudProviderZones,
  fetchCloudProviderKeyPairs,
} from '../../../../../services/aliyunApi';

type Props = {
  open: boolean;
  cloudId: string;
  securityGroups: any[];
  vswitches: any[];
  onCancel: () => void;
  onOk: () => void;
};

const systemDiskCategoryOptions = [
  { label: 'ESSD 云盘', value: 'cloud_essd' },
  { label: 'SSD 云盘', value: 'cloud_ssd' },
  { label: '高效云盘', value: 'cloud_efficiency' },
];

const EcsCreateModalAliyun: React.FC<Props> = ({ open, cloudId, securityGroups, vswitches, onCancel, onOk }) => {
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const [loadingDeps, setLoadingDeps] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [images, setImages] = useState<any[]>([]);
  const [instanceTypes, setInstanceTypes] = useState<any[]>([]);
  const [zones, setZones] = useState<any[]>([]);
  const [keyPairs, setKeyPairs] = useState<any[]>([]);
  const [loginType, setLoginType] = useState<'password' | 'keyPair'>('password');

  useEffect(() => {
    if (!open || !cloudId) return;
    form.resetFields();
    setLoginType('password');
    form.setFieldsValue({ instanceChargeType: 'PostPaid', amount: 1, systemDiskCategory: 'cloud_essd', systemDiskSize: 40, internetMaxBandwidthOut: 0 });
    const load = async () => {
      setLoadingDeps(true);
      try {
        const [imgSelf, imgSys, typesJson, zonesJson, kpJson] = await Promise.all([
          fetchCloudProviderImages(cloudId, { owner: 'self', pageSize: 100 }).catch(() => null),
          fetchCloudProviderImages(cloudId, { owner: 'system', pageSize: 100 }).catch(() => null),
          fetchCloudProviderInstanceTypes(cloudId).catch(() => null),
          fetchCloudProviderZones(cloudId).catch(() => null),
          fetchCloudProviderKeyPairs(cloudId).catch(() => null),
        ]);
        const parseImgs = (j: any) => (j?.data?.Images?.Image) || (j?.Images?.Image) || [];
        setImages([...parseImgs(imgSelf), ...parseImgs(imgSys)]);
        setInstanceTypes((typesJson?.data?.InstanceTypes?.InstanceType) || (typesJson?.InstanceTypes?.InstanceType) || []);
        setZones((zonesJson?.data?.Zones?.Zone) || (zonesJson?.Zones?.Zone) || []);
        setKeyPairs((kpJson?.data?.KeyPairs?.KeyPair) || (kpJson?.KeyPairs?.KeyPair) || []);
      } catch (e: any) {
        message.error(e?.message || '加载创建依赖失败');
      } finally {
        setLoadingDeps(false);
      }
    };
    load();
  }, [open, cloudId, form, message]);

  const imageOptions = useMemo(() => images.map((i: any) => ({ label: `${i?.OSName || i?.ImageName || i?.ImageId}（${i?.ImageId}）`, value: i?.ImageId })), [images]);
  const typeOptions = useMemo(() => instanceTypes.map((t: any) => ({ label: `${t?.InstanceTypeId}（${t?.CpuCoreCount}vCPU ${t?.MemorySize}GB）`, value: t?.InstanceTypeId })), [instanceTypes]);
  const zoneOptions = useMemo(() => zones.map((z: any) => ({ label: `${z?.LocalName || z?.ZoneId}（${z?.ZoneId}）`, value: z?.ZoneId })), [zones]);
  const sgOptions = useMemo(() => (securityGroups || []).map((g: any) => ({ label: `${g?.SecurityGroupName || g?.SecurityGroupId}（${g?.SecurityGroupId}）`, value: g?.SecurityGroupId || g?.id })), [securityGroups]);
  const keyPairOptions = useMemo(() => (keyPairs || []).map((k: any) => ({ label: k?.KeyPairName, value: k?.KeyPairName })), [keyPairs]);

  const selectedZone = Form.useWatch('zoneId', form);
  const vSwitchOptions = useMemo(() => {
    return (vswitches || [])
      .filter((s: any) => !selectedZone || String(s?.ZoneId || s?.zone || '') === String(selectedZone))
      .map((s: any) => ({ label: `${s?.VSwitchName || s?.VSwitchId}（${s?.CidrBlock || ''}）`, value: s?.VSwitchId || s?.id }));
  }, [vswitches, selectedZone]);

  const handleOk = async () => {
    try {
      const values = await form.validateFields();
      setSubmitting(true);
      await createCloudProviderEcs(cloudId, {
        imageId: values.imageId,
        instanceType: values.instanceType,
        securityGroupId: values.securityGroupId,
        vSwitchId: values.vSwitchId,
        zoneId: values.zoneId,
        amount: values.amount,
        instanceName: values.instanceName,
        instanceChargeType: values.instanceChargeType,
        systemDiskCategory: values.systemDiskCategory,
        systemDiskSize: values.systemDiskSize,
        internetMaxBandwidthOut: values.internetMaxBandwidthOut,
        ...(values.internetMaxBandwidthOut > 0 ? { internetChargeType: 'PayByTraffic' } : {}),
        ...(loginType === 'password' ? { password: values.password } : { keyPairName: values.keyPairName }),
      });
      message.success('创建实例指令已下发');
      onOk();
    } catch (e: any) {
      if (e?.errorFields) return;
      message.error(e?.message || '创建实例失败');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal title="创建云主机" open={open} onCancel={onCancel} onOk={handleOk} confirmLoading={submitting} okText="创建" cancelText="取消" width={680} destroyOnClose>
      <Spin spinning={loadingDeps} tip="加载创建依赖...">
        <Form form={form} layout="vertical">
          <Form.Item name="instanceChargeType" label="计费方式" rules={[{ required: true }]}>
            <Radio.Group options={[{ label: '按量付费', value: 'PostPaid' }, { label: '包年包月', value: 'PrePaid' }]} optionType="button" />
          </Form.Item>
          <Form.Item name="zoneId" label="可用区"><Select showSearch optionFilterProp="label" placeholder="不选则由系统分配" options={zoneOptions} allowClear /></Form.Item>
          <Form.Item name="imageId" label="镜像" rules={[{ required: true, message: '请选择镜像' }]}>
            <Select showSearch optionFilterProp="label" placeholder="请选择镜像" options={imageOptions} />
          </Form.Item>
          <Form.Item name="instanceType" label="实例规格" rules={[{ required: true, message: '请选择实例规格' }]}>
            <Select showSearch optionFilterProp="label" placeholder="请选择规格" options={typeOptions} />
          </Form.Item>
          <Form.Item name="vSwitchId" label="交换机" rules={[{ required: true, message: '请选择交换机' }]} extra={selectedZone ? '已按所选可用区过滤' : '建议先选可用区'}>
            <Select showSearch optionFilterProp="label" placeholder="请选择交换机" options={vSwitchOptions} />
          </Form.Item>
          <Form.Item name="securityGroupId" label="安全组" rules={[{ required: true, message: '请选择安全组' }]}>
            <Select showSearch optionFilterProp="label" placeholder="请选择安全组" options={sgOptions} />
          </Form.Item>
          <Form.Item name="systemDiskCategory" label="系统盘类型" rules={[{ required: true }]}>
            <Select options={systemDiskCategoryOptions} />
          </Form.Item>
          <Form.Item name="systemDiskSize" label="系统盘大小 (GB)" rules={[{ required: true }]}>
            <InputNumber min={20} max={2048} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="internetMaxBandwidthOut" label="公网带宽 (Mbps，0 表示不分配公网 IP)">
            <InputNumber min={0} max={1000} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item label="登录凭证">
            <Radio.Group
              value={loginType}
              onChange={(e) => setLoginType(e.target.value)}
              options={[{ label: '自定义密码', value: 'password' }, { label: 'SSH 密钥对', value: 'keyPair' }]}
              optionType="button"
            />
          </Form.Item>
          {loginType === 'password' ? (
            <Form.Item name="password" label="登录密码" rules={[{ required: true, message: '请输入密码' }, { min: 8, message: '至少 8 位' }]}>
              <Input.Password placeholder="8-30 位，含大小写字母、数字、符号" />
            </Form.Item>
          ) : (
            <Form.Item name="keyPairName" label="密钥对" rules={[{ required: true, message: '请选择密钥对' }]}>
              <Select showSearch optionFilterProp="label" placeholder={keyPairOptions.length ? '请选择密钥对' : '暂无密钥对，请先创建'} options={keyPairOptions} />
            </Form.Item>
          )}
          <Form.Item name="instanceName" label="实例名称"><Input placeholder="选填" maxLength={128} allowClear /></Form.Item>
          <Form.Item name="amount" label="购买数量" rules={[{ required: true }]}>
            <InputNumber min={1} max={100} style={{ width: '100%' }} />
          </Form.Item>
        </Form>
      </Spin>
    </Modal>
  );
};

export default EcsCreateModalAliyun;
