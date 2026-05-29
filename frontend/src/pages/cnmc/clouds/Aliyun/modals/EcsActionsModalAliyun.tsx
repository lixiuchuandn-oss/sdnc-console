import React, { useEffect, useMemo, useState } from 'react';
import { App, Modal, Form, Input, Select, Typography, Spin } from 'antd';
import {
  modifyCloudProviderEcsSpec,
  resetCloudProviderEcsPassword,
  replaceCloudProviderEcsSystemDisk,
  fetchCloudProviderInstanceTypes,
  fetchCloudProviderImages,
} from '../../../../../services/aliyunApi';

export type EcsActionMode = 'resize' | 'password' | 'replaceDisk' | null;

type Props = {
  open: boolean;
  mode: EcsActionMode;
  cloudId: string;
  instance: any | null;
  onClose: () => void;
  onDone: () => void;
};

const titleMap: Record<string, string> = {
  resize: '变更实例规格',
  password: '重置实例密码',
  replaceDisk: '更换系统盘镜像',
};

const EcsActionsModalAliyun: React.FC<Props> = ({ open, mode, cloudId, instance, onClose, onDone }) => {
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const [submitting, setSubmitting] = useState(false);
  const [loadingDeps, setLoadingDeps] = useState(false);
  const [instanceTypes, setInstanceTypes] = useState<any[]>([]);
  const [images, setImages] = useState<any[]>([]);

  const iid = instance?.InstanceId || instance?.id;

  useEffect(() => {
    if (!open || !mode) return;
    form.resetFields();
    const load = async () => {
      if (mode === 'resize') {
        setLoadingDeps(true);
        try {
          const j: any = await fetchCloudProviderInstanceTypes(cloudId);
          setInstanceTypes((j?.data?.InstanceTypes?.InstanceType) || (j?.InstanceTypes?.InstanceType) || []);
        } catch { /* ignore */ } finally { setLoadingDeps(false); }
      } else if (mode === 'replaceDisk') {
        setLoadingDeps(true);
        try {
          const [self, sys] = await Promise.all([
            fetchCloudProviderImages(cloudId, { owner: 'self', pageSize: 100 }).catch(() => null),
            fetchCloudProviderImages(cloudId, { owner: 'system', pageSize: 100 }).catch(() => null),
          ]);
          const p = (x: any) => (x?.data?.Images?.Image) || (x?.Images?.Image) || [];
          setImages([...p(self), ...p(sys)]);
        } catch { /* ignore */ } finally { setLoadingDeps(false); }
      }
    };
    load();
  }, [open, mode, cloudId, form]);

  const typeOptions = useMemo(() => instanceTypes.map((t: any) => ({ label: `${t?.InstanceTypeId}（${t?.CpuCoreCount}vCPU ${t?.MemorySize}GB）`, value: t?.InstanceTypeId })), [instanceTypes]);
  const imageOptions = useMemo(() => images.map((i: any) => ({ label: `${i?.OSName || i?.ImageName || i?.ImageId}（${i?.ImageId}）`, value: i?.ImageId })), [images]);

  const handleOk = async () => {
    try {
      const values = await form.validateFields();
      if (!iid) return;
      setSubmitting(true);
      if (mode === 'resize') {
        await modifyCloudProviderEcsSpec(cloudId, iid, values.instanceType);
        message.success('变配指令已下发');
      } else if (mode === 'password') {
        await resetCloudProviderEcsPassword(cloudId, iid, values.password);
        message.success('密码已重置，重启后生效');
      } else if (mode === 'replaceDisk') {
        await replaceCloudProviderEcsSystemDisk(cloudId, iid, { imageId: values.imageId, password: values.password || undefined });
        message.success('更换系统盘指令已下发');
      }
      onDone();
    } catch (e: any) {
      if (e?.errorFields) return;
      message.error(e?.message || '操作失败');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal title={mode ? titleMap[mode] : ''} open={open} onCancel={onClose} onOk={handleOk} confirmLoading={submitting} okText="确认" cancelText="取消" destroyOnClose>
      <Spin spinning={loadingDeps}>
        <Typography.Paragraph type="secondary">实例：{instance?.InstanceName || iid || '-'}</Typography.Paragraph>
        <Form form={form} layout="vertical">
          {mode === 'resize' && (
            <Form.Item name="instanceType" label="目标规格" rules={[{ required: true, message: '请选择目标规格' }]} extra="变配通常需实例处于已停止状态">
              <Select showSearch optionFilterProp="label" placeholder="请选择规格" options={typeOptions} />
            </Form.Item>
          )}
          {mode === 'password' && (
            <Form.Item name="password" label="新密码" rules={[{ required: true, message: '请输入新密码' }, { min: 8, message: '至少 8 位' }]} extra="重置后需重启实例生效">
              <Input.Password placeholder="8-30 位，含大小写字母、数字、符号" />
            </Form.Item>
          )}
          {mode === 'replaceDisk' && (
            <>
              <Form.Item name="imageId" label="目标镜像" rules={[{ required: true, message: '请选择目标镜像' }]} extra="更换系统盘将重置系统盘数据，需实例处于已停止状态">
                <Select showSearch optionFilterProp="label" placeholder="请选择镜像" options={imageOptions} />
              </Form.Item>
              <Form.Item name="password" label="新登录密码（选填）">
                <Input.Password placeholder="不填则保持原凭证" />
              </Form.Item>
            </>
          )}
        </Form>
      </Spin>
    </Modal>
  );
};

export default EcsActionsModalAliyun;
