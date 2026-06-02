import React, { useEffect } from 'react';
import { Form, Input, InputNumber, Modal, Select } from 'antd';
import type {
  FailureDomainRow,
  FailureDomainType,
} from 'services/harvester/failureDomains';
import { FAILURE_DOMAIN_TYPE_LABELS } from 'services/harvester/failureDomains';

export type FailureDomainFormValues = {
  name: string;
  domainType: FailureDomainType;
  description?: string;
  sortOrder?: number;
};

type Props = {
  open: boolean;
  editing: FailureDomainRow | null;
  onClose: () => void;
  onSubmit: (values: FailureDomainFormValues) => Promise<void>;
  saving: boolean;
};

const TYPE_OPTIONS = (Object.keys(FAILURE_DOMAIN_TYPE_LABELS) as FailureDomainType[]).map(
  (v) => ({ value: v, label: FAILURE_DOMAIN_TYPE_LABELS[v] }),
);

const FailureDomainFormModal: React.FC<Props> = ({
  open,
  editing,
  onClose,
  onSubmit,
  saving,
}) => {
  const [form] = Form.useForm<FailureDomainFormValues>();

  useEffect(() => {
    if (!open) return;
    if (editing) {
      form.setFieldsValue({
        name: editing.name,
        domainType: editing.domainType,
        description: editing.description,
        sortOrder: editing.sortOrder,
      });
    } else {
      form.resetFields();
      form.setFieldsValue({ domainType: 'rack' });
    }
  }, [open, editing, form]);

  return (
    <Modal
      title={editing ? '编辑故障域' : '创建故障域'}
      open={open}
      onCancel={onClose}
      confirmLoading={saving}
      destroyOnClose
      onOk={() => {
        void form.validateFields().then((values) => onSubmit(values));
      }}
    >
      <Form form={form} layout="vertical">
        <Form.Item
          name="name"
          label="名称"
          rules={[{ required: true, message: '请输入故障域名称' }]}
        >
          <Input placeholder="如 rack-a、zone-1" maxLength={64} />
        </Form.Item>
        <Form.Item name="domainType" label="类型" rules={[{ required: true }]}>
          <Select options={TYPE_OPTIONS} />
        </Form.Item>
        <Form.Item name="description" label="描述">
          <Input.TextArea rows={2} maxLength={256} />
        </Form.Item>
        <Form.Item name="sortOrder" label="排序">
          <InputNumber min={0} style={{ width: '100%' }} />
        </Form.Item>
      </Form>
    </Modal>
  );
};

export default FailureDomainFormModal;
