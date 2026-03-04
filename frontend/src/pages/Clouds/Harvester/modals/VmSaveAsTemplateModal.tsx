import React, { useEffect, useState } from 'react';
import { Modal, Form, Input, Select, message } from 'antd';
import { saveHarvesterVmAsTemplate } from '../../../../services/harvesterApi';
import { isSystemNamespace } from '../../../../utils/harvesterUtils';

type Props = {
  open: boolean;
  onClose: () => void;
  cloudId: string;
  vmNamespace: string;
  vmName: string;
  vmDisplayName?: string;
  namespacesOptions?: string[];
  isTenant?: boolean;
  onSuccess?: () => void;
};

const VmSaveAsTemplateModal: React.FC<Props> = ({
  open,
  onClose,
  cloudId,
  vmNamespace,
  vmName,
  vmDisplayName,
  namespacesOptions = [],
  isTenant = false,
  onSuccess,
}) => {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    form.resetFields();
    form.setFieldsValue({
      alias: vmDisplayName || vmName,
      description: '',
      targetNamespace: vmNamespace,
    });
  }, [open, form, vmDisplayName, vmName, vmNamespace]);

  const handleOk = async () => {
    try {
      const values = await form.validateFields();
      setLoading(true);

      const payload: any = {};
      if (typeof values.alias === 'string' && values.alias.trim()) payload.alias = values.alias.trim();
      if (typeof values.description === 'string' && values.description.trim()) payload.description = values.description.trim();
      if (!isTenant && typeof values.targetNamespace === 'string' && values.targetNamespace.trim()) {
        payload.namespace = values.targetNamespace.trim();
      }

      await saveHarvesterVmAsTemplate(cloudId, vmNamespace, vmName, payload);
      message.success('已根据当前实例配置创建模板');
      onSuccess?.();
      onClose();
    } catch (e: any) {
      if (String(e?.errorFields?.length || 0) !== '0') return;
      message.error(e?.message || '保存为模板失败');
    } finally {
      setLoading(false);
    }
  };

  const namespaceOptions = (namespacesOptions || [])
    .filter((ns) => {
      if (!ns) return false;
      if (isSystemNamespace(ns)) return false;
      return true;
    })
    .map((ns) => ({ value: ns, label: ns }));

  return (
    <Modal
      title="保存为模板"
      open={open}
      onCancel={onClose}
      onOk={handleOk}
      confirmLoading={loading}
      destroyOnHidden
    >
      <Form form={form} layout="vertical">
        <Form.Item name="alias" label="模板别名" rules={[{ required: true, message: '请输入模板别名' }]}>
          <Input placeholder="请输入模板别名" />
        </Form.Item>

        <Form.Item name="description" label="描述">
          <Input.TextArea placeholder="请输入描述（可选）" rows={3} />
        </Form.Item>

        {!isTenant && (
          <Form.Item name="targetNamespace" label="保存到命名空间" rules={[{ required: true, message: '请选择命名空间' }]}>
            <Select
              showSearch
              allowClear={false}
              options={namespaceOptions}
              placeholder="请选择命名空间"
            />
          </Form.Item>
        )}
      </Form>
    </Modal>
  );
};

export default VmSaveAsTemplateModal;

