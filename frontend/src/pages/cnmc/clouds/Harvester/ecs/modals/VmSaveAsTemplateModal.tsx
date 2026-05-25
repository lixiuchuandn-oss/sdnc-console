import React, { useEffect, useState } from 'react';
import { Modal, Form, Input, message } from 'antd';
import { saveHarvesterVmAsTemplate } from 'services/harvester/vm';
import { translateKnownApiErrorMessage } from '../../../../../../utils/k8sErrorMessages';
type Props = {
  open: boolean;
  onClose: () => void;
  cloudId: string;
  vmNamespace: string;
  vmName: string;
  vmDisplayName?: string;
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
    });
  }, [open, form, vmDisplayName, vmName]);

  const handleOk = async () => {
    try {
      const values = await form.validateFields();
      setLoading(true);

      const payload: any = {};
      if (typeof values.alias === 'string' && values.alias.trim()) payload.alias = values.alias.trim();
      if (typeof values.description === 'string' && values.description.trim()) payload.description = values.description.trim();
      /** 业务规则：模板必须与虚拟机同命名空间，不允许改存到其他 namespace */
      if (!isTenant && String(vmNamespace || '').trim()) {
        payload.namespace = String(vmNamespace).trim();
      }

      await saveHarvesterVmAsTemplate(cloudId, vmNamespace, vmName, payload);
      message.success('已根据当前实例配置创建模板。在云主机模板页面能看到模板数据');
      onSuccess?.();
      onClose();
    } catch (e: any) {
      if (String(e?.errorFields?.length || 0) !== '0') return;
      const raw = String(e?.message ?? '').trim();
      message.error(raw ? translateKnownApiErrorMessage(raw) : '保存为模板失败');
    } finally {
      setLoading(false);
    }
  };

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
        {/** 命名空间不展示：业务上模板必须与 VM 同 namespace，提交时仍写入 payload（见 handleOk） */}
      </Form>
    </Modal>
  );
};

export default VmSaveAsTemplateModal;

