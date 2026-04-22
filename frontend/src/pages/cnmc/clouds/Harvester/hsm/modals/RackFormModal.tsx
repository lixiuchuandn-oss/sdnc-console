import React, { useEffect } from 'react';
import { Form, Input, InputNumber, message, Modal } from 'antd';
import {
  type DatacenterRack,
  createDatacenterRack,
  patchDatacenterRack,
} from '../../../../../../services/datacenterTopologyApi';

export type RackFormModalProps =
  | {
      mode: 'create';
      open: boolean;
      onClose: () => void;
      onSuccess: () => void;
      cloudId: string;
      defaultSortOrder: number;
    }
  | {
      mode: 'edit';
      open: boolean;
      rack: DatacenterRack | null;
      onClose: () => void;
      onSuccess: () => void;
      cloudId: string;
    };

const RackFormModal: React.FC<RackFormModalProps> = (props) => {
  const { open, onClose, onSuccess, cloudId, mode } = props;
  const [form] = Form.useForm();

  const defaultSortOrder = mode === 'create' ? props.defaultSortOrder : 0;
  const rack = mode === 'edit' ? props.rack : null;

  useEffect(() => {
    if (!open) return;
    if (mode === 'create') {
      form.resetFields();
      form.setFieldsValue({ sortOrder: defaultSortOrder });
    } else if (mode === 'edit' && rack) {
      form.setFieldsValue({
        name: rack.name,
        sortOrder: Number(rack.sortOrder) || 0,
      });
    }
  }, [open, mode, defaultSortOrder, rack, form]);

  const handleOk = async () => {
    if (mode === 'edit' && !rack) return;
    try {
      const v = await form.validateFields();
      const name = String(v.name || '').trim();
      if (!name) return;
      if (mode === 'create') {
        const raw = v.sortOrder;
        const sortOrder =
          raw === null || raw === undefined || (typeof raw === 'string' && raw.trim() === '')
            ? undefined
            : Math.trunc(Number(raw));
        await createDatacenterRack(cloudId, {
          name,
          ...(sortOrder !== undefined && Number.isFinite(sortOrder) ? { sortOrder } : {}),
        });
        message.success('已添加机柜');
      } else {
        if (!rack) return;
        const sortOrder = Math.trunc(Number(v.sortOrder));
        await patchDatacenterRack(cloudId, rack.id, { name, sortOrder });
        message.success('已更新');
      }
      form.resetFields();
      onClose();
      onSuccess();
    } catch (e: any) {
      if (e?.errorFields) return;
      message.error(
        e?.response?.data?.message ||
          e?.message ||
          (mode === 'create' ? '创建失败' : '更新失败'),
      );
    }
  };

  const title = mode === 'create' ? '添加机柜' : '编辑机柜';

  return (
    <Modal
      title={title}
      open={open}
      centered
      onCancel={() => {
        onClose();
        form.resetFields();
      }}
      onOk={() => void handleOk()}
      destroyOnHidden
      width={520}
    >
      <Form form={form} layout="vertical">
        <Form.Item name="name" rules={[{ required: true, message: '请输入机柜名称' }]}>
          <Input
            prefix="机柜名称"
            maxLength={64}
            placeholder={mode === 'create' ? '例如：A列-01' : '请输入机柜名称'}
            style={{ width: '100%' }}
          />
        </Form.Item>
        <Form.Item
          name="sortOrder"
          rules={
            mode === 'edit' ? [{ required: true, message: '请输入展示序号' }] : undefined
          }
        >
          <InputNumber
            min={0}
            max={999999}
            step={1}
            style={{ width: '100%' }}
            prefix="展示序号"
            placeholder={mode === 'create' ? '可选' : '请输入展示序号'}
          />
        </Form.Item>
      </Form>
    </Modal>
  );
};

export default RackFormModal;
