import React, { useEffect, useState } from 'react';
import { Modal, Form, Input, Select, Radio, message } from 'antd';
import { createHarvesterVirtualMachineBackup } from '../../../../services/harvesterApi';
import { isSystemNamespace } from '../../../../utils/harvesterUtils';

interface Props {
  visible: boolean;
  onCancel: () => void;
  onSuccess: () => void;
  cloudId: string;
  namespaces: any[];
  vms: any[];
  initialType?: 'backup' | 'snapshot';
}

const VmBackupCreateModal: React.FC<Props> = ({ 
  visible, 
  onCancel, 
  onSuccess, 
  cloudId, 
  namespaces, 
  vms,
  initialType = 'backup'
}) => {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [type, setType] = useState<'backup' | 'snapshot'>(initialType);
  const [selectedNamespace, setSelectedNamespace] = useState<string>('');

  useEffect(() => {
    if (visible) {
      form.resetFields();
      setType(initialType);
      form.setFieldsValue({ type: initialType });
    }
  }, [visible, initialType, form]);

  const handleOk = async () => {
    try {
      const values = await form.validateFields();
      setLoading(true);
      
      await createHarvesterVirtualMachineBackup(
        cloudId,
        values.namespace,
        {
          name: values.name,
          vmName: values.vmName,
          type: type,
          alias: values.name
        }
      );

      message.success(`${type === 'backup' ? '备份' : '快照'}创建成功`);
      onSuccess();
    } catch (e: any) {
      message.error(`创建失败: ${e.message}`);
    } finally {
      setLoading(false);
    }
  };

  const filteredVms = vms.filter(vm => !selectedNamespace || vm.namespace === selectedNamespace || (vm.metadata && vm.metadata.namespace === selectedNamespace));
  const filteredNamespaces = namespaces.filter(ns => !isSystemNamespace(ns.metadata?.name || ns.name));

  return (
    <Modal
      title={`创建${type === 'backup' ? '虚拟机备份' : '虚拟机快照'}`}
      open={visible}
      onOk={handleOk}
      onCancel={onCancel}
      confirmLoading={loading}
      destroyOnClose
    >
      <Form
        form={form}
        layout="vertical"
        initialValues={{ type: initialType }}
      >
        <Form.Item
          name="name"
          label="名称"
          rules={[
            { required: true, message: '请输入名称' }
          ]}
        >
          <Input placeholder="请输入名称" />
        </Form.Item>

        <Form.Item
          name="namespace"
          label="命名空间"
          rules={[{ required: true, message: '请选择命名空间' }]}
        >
          <Select 
            placeholder="请选择命名空间"
            onChange={val => {
              setSelectedNamespace(val);
              form.setFieldsValue({ vmName: undefined });
            }}
            showSearch
            optionFilterProp="children"
          >
            {filteredNamespaces.map(ns => (
              <Select.Option key={ns.metadata.name} value={ns.metadata.name}>
                {ns.metadata.name}
              </Select.Option>
            ))}
          </Select>
        </Form.Item>

        <Form.Item
          name="vmName"
          label="目标虚拟机"
          rules={[{ required: true, message: '请选择虚拟机' }]}
        >
          <Select 
            placeholder="请选择虚拟机"
            showSearch
            optionFilterProp="children"
            disabled={!selectedNamespace}
          >
            {filteredVms.map(vm => (
              <Select.Option key={vm.id || vm.metadata.uid} value={vm.name || vm.metadata.name}>
                {vm.name || vm.metadata.name}
              </Select.Option>
            ))}
          </Select>
        </Form.Item>
      </Form>
    </Modal>
  );
};

export default VmBackupCreateModal;
