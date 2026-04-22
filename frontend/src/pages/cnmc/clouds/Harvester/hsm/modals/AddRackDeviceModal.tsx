import React, { useEffect } from 'react';
import { Form, Input, InputNumber, message, Modal, Select } from 'antd';
import {
  type DatacenterRack,
  type DatacenterRackDevice,
  createRackDevice,
  patchRackDevice,
} from '../../../../../../services/datacenterTopologyApi';

function nextSlotOrderForRack(rack: DatacenterRack): number {
  const ds = rack.devices || [];
  if (!ds.length) return 0;
  return Math.max(...ds.map((d) => Number(d.slotOrder) || 0)) + 1;
}

function withOptionForValue(
  options: { value: string; label: string }[],
  value: string | null | undefined,
  labelHint = '（当前值，列表中未找到）',
): { value: string; label: string }[] {
  const v = String(value || '').trim();
  if (!v) return options;
  if (options.some((o) => o.value === v)) return options;
  return [...options, { value: v, label: `${v}${labelHint}` }];
}

export type AddRackDeviceModalProps = {
  open: boolean;
  rack: DatacenterRack | null;
  /** 非空则为编辑当前机架条；空为新增 */
  editingDevice: DatacenterRackDevice | null;
  onClose: () => void;
  onSuccess: () => void;
  cloudId: string;
  nodeOptions: { value: string; label: string }[];
  switchSelectOptions: { value: string; label: string }[];
};

const AddRackDeviceModal: React.FC<AddRackDeviceModalProps> = ({
  open,
  rack,
  editingDevice,
  onClose,
  onSuccess,
  cloudId,
  nodeOptions,
  switchSelectOptions,
}) => {
  const [form] = Form.useForm();
  const isEdit = !!editingDevice;

  useEffect(() => {
    if (!open || !rack) return;
    if (editingDevice) {
      form.setFieldsValue({
        sourceKind: editingDevice.sourceKind,
        refKey: editingDevice.refKey ?? undefined,
        customLabel: editingDevice.customLabel ?? undefined,
        slotOrder: Number(editingDevice.slotOrder) || 0,
      });
    } else {
      form.resetFields();
      form.setFieldsValue({
        sourceKind: 'switch',
        slotOrder: nextSlotOrderForRack(rack),
      });
    }
  }, [open, rack, editingDevice, form]);

  const handleOk = async () => {
    if (!rack) return;
    try {
      const v = await form.validateFields();
      const kind = v.sourceKind as string;
      const slotOrder = Number(v.slotOrder) || 0;

      if (isEdit && editingDevice) {
        if (kind === 'custom') {
          const label = String(v.customLabel || '').trim();
          await patchRackDevice(cloudId, rack.id, editingDevice.id, {
            slotOrder,
            customLabel: label || null,
          });
        } else {
          await patchRackDevice(cloudId, rack.id, editingDevice.id, {
            slotOrder,
            refKey: String(v.refKey || '').trim() || null,
          });
        }
        message.success('已更新设备');
      } else if (kind === 'custom') {
        const label = String(v.customLabel || '').trim();
        await createRackDevice(cloudId, rack.id, {
          sourceKind: 'custom',
          customLabel: label || null,
          slotOrder,
        });
        message.success('已添加设备');
      } else if (kind === 'node') {
        await createRackDevice(cloudId, rack.id, {
          sourceKind: 'node',
          refKey: String(v.refKey || '').trim(),
          slotOrder,
        });
        message.success('已添加设备');
      } else {
        await createRackDevice(cloudId, rack.id, {
          sourceKind: 'switch',
          refKey: String(v.refKey || '').trim(),
          slotOrder,
        });
        message.success('已添加设备');
      }
      form.resetFields();
      onClose();
      onSuccess();
    } catch (e: any) {
      if (e?.errorFields) return;
      message.error(e?.response?.data?.message || e?.message || (isEdit ? '更新失败' : '添加失败'));
    }
  };

  const nodeOpts = withOptionForValue(
    nodeOptions,
    isEdit && editingDevice?.sourceKind === 'node' ? editingDevice.refKey : undefined,
  );
  const switchOpts = withOptionForValue(
    switchSelectOptions,
    isEdit && editingDevice?.sourceKind === 'switch' ? editingDevice.refKey : undefined,
  );

  const title = isEdit
    ? rack
      ? `编辑机架条「${rack.name}」`
      : '编辑机架条'
    : rack
      ? `向机柜 ${rack.name} 添加设备`
      : '添加设备';

  return (
    <Modal
      title={title}
      open={open}
      centered
      onCancel={() => onClose()}
      onOk={() => void handleOk()}
      destroyOnHidden
      width={520}
    >
      <Form form={form} layout="vertical">
        <Form.Item name="sourceKind" rules={[{ required: true }]} initialValue="switch">
          <Select
            prefix="设备类型"
            style={{ width: '100%' }}
            disabled={isEdit}
            options={[
              { value: 'switch', label: '物理交换机' },
              { value: 'node', label: '物理服务器' },
              { value: 'custom', label: '占位插板' },
            ]}
            onChange={() => {
              form.resetFields(['refKey', 'customLabel']);
            }}
          />
        </Form.Item>
        <Form.Item noStyle shouldUpdate={(p, c) => p.sourceKind !== c.sourceKind}>
          {() => {
            const k = form.getFieldValue('sourceKind');
            if (k === 'node') {
              return (
                <Form.Item
                  key="rack-device-refKey-node"
                  name="refKey"
                  rules={[{ required: true, message: '请选择物理服务器' }]}
                >
                  <Select
                    showSearch
                    optionFilterProp="label"
                    options={nodeOpts}
                    placeholder="请选择物理服务器"
                    prefix="选择设备"
                  />
                </Form.Item>
              );
            }
            if (k === 'switch') {
              return (
                <Form.Item
                  key="rack-device-refKey-switch"
                  name="refKey"
                  rules={[{ required: true, message: '请选择一台交换机' }]}
                >
                  <Select
                    showSearch
                    optionFilterProp="label"
                    options={switchOpts}
                    placeholder="请选择物理交换机"
                    prefix="选择设备"
                  />
                </Form.Item>
              );
            }
            if (k === 'custom' && isEdit) {
              return (
                <Form.Item name="customLabel">
                  <Input
                    prefix="显示名称"
                    placeholder="可选，留空则显示为「自定义」"
                    maxLength={128}
                    allowClear
                  />
                </Form.Item>
              );
            }
            return null;
          }}
        </Form.Item>
        <Form.Item name="slotOrder" initialValue={0}>
          <InputNumber
            min={0}
            max={9999}
            style={{ width: '100%' }}
            prefix="机柜排序"
            placeholder="请输入排序"
          />
        </Form.Item>
      </Form>
    </Modal>
  );
};

export default AddRackDeviceModal;
