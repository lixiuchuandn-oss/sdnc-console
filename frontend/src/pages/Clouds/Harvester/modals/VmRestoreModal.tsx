import React, { useEffect, useState } from 'react';
import { Modal, Form, Input, message, Alert, Switch, Radio } from 'antd';
import { createHarvesterVirtualMachineRestore } from '../../../../services/harvesterApi';

interface Props {
  visible: boolean;
  onCancel: () => void;
  onSuccess: () => void;
  cloudId: string;
  resource: any; // The snapshot or backup record
  resourceType: 'backup' | 'snapshot';
}

const VmRestoreModal: React.FC<Props> = ({ 
  visible, 
  onCancel, 
  onSuccess, 
  cloudId, 
  resource,
  resourceType
}) => {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (visible && resource) {
      form.resetFields();
      form.setFieldsValue({
        name: `restore-${resource.name}-${Math.floor(Date.now() / 1000)}`,
        targetVmName: resource.targetVm !== '-' ? resource.targetVm : '',
        newVM: true,
        keepMacAddress: false // Default to Reset MAC (Disabled) -> Keep MAC
      });
    }
  }, [visible, resource, form]);

  const handleOk = async () => {
    try {
      const values = await form.validateFields();
      setLoading(true);
      
      const isSnapshot = resourceType === 'snapshot';
      const payload: any = {
        apiVersion: isSnapshot ? 'kubevirt.io/v1' : 'harvesterhci.io/v1beta1',
        kind: 'VirtualMachineRestore',
        metadata: {
          name: values.name,
          namespace: resource.namespace,
          annotations: {
            'tower.io/description': 'Created via Compute Tower'
          }
        },
        spec: {
          target: {
            apiGroup: 'kubevirt.io',
            kind: 'VirtualMachine',
            name: values.targetVmName
          }
        }
      };

      if (resourceType === 'snapshot') {
        payload.spec.virtualMachineSnapshotName = resource.name;
        payload.spec.virtualMachineSnapshotNamespace = resource.namespace;
      } else {
        payload.spec.virtualMachineBackupName = resource.name;
        payload.spec.virtualMachineBackupNamespace = resource.namespace;
        // Harvester Backup specific options
        if (values.newVM !== undefined) payload.spec.newVM = values.newVM;
        // The UI label is "MAC Address Reset" (Enabled/Disabled).
        // If Enabled (true) -> Reset MAC -> keepMacAddress = false.
        // If Disabled (false) -> Keep MAC -> keepMacAddress = true.
        if (values.keepMacAddress !== undefined) payload.spec.keepMacAddress = !values.keepMacAddress;
      }

      await createHarvesterVirtualMachineRestore(
        cloudId,
        resource.namespace,
        payload
      );

      message.success('恢复任务创建成功');
      onSuccess();
    } catch (e: any) {
      message.error(`创建失败: ${e.message}`);
    } finally {
      setLoading(false);
    }
  };

  if (!resource) return null;

  return (
    <Modal
      title="恢复虚拟机"
      open={visible}
      onOk={handleOk}
      onCancel={onCancel}
      confirmLoading={loading}
      destroyOnClose
    >
      <Alert
        message="注意"
        description="恢复操作将停止并替换目标虚拟机。如果目标虚拟机不存在，将会创建一个新的虚拟机。"
        type="warning"
        showIcon
        style={{ marginBottom: 16 }}
      />
      <Form
        form={form}
        layout="vertical"
      >
        <Form.Item label={resourceType === 'snapshot' ? '源快照' : '源备份'}>
          <Input value={resource.name} disabled />
        </Form.Item>

        <Form.Item
          name="name"
          label="恢复任务名称"
          rules={[
            { required: true, message: '请输入恢复任务名称' }
          ]}
        >
          <Input placeholder="请输入恢复任务名称" />
        </Form.Item>

        <Form.Item
          name="targetVmName"
          label="目标虚拟机名称"
          rules={[{ required: true, message: '请输入目标虚拟机名称' }]}
        >
          <Input placeholder="请输入目标虚拟机名称" />
        </Form.Item>

        {resourceType === 'backup' && (
          <div style={{ display: 'flex', gap: 24 }}>
            <Form.Item 
              name="newVM" 
              label="恢复模式"
              style={{ flex: 1 }}
            >
               <Radio.Group>
                  <Radio value={true}>新建虚拟机</Radio>
                  <Radio value={false}>替换虚拟机</Radio>
               </Radio.Group>
            </Form.Item>
            <Form.Item 
              name="keepMacAddress" 
              valuePropName="checked" 
              label="MAC 地址重置"
              style={{ flex: 1 }}
            >
               <Switch checkedChildren="启用" unCheckedChildren="禁用" />
            </Form.Item>
          </div>
        )}
      </Form>
    </Modal>
  );
};

export default VmRestoreModal;
