/**
 * Harvester - 创建虚拟机备份/快照弹窗
 *
 * 负责为指定命名空间下的虚拟机创建：
 * - 虚拟机备份 (backup)
 * - 虚拟机快照 (snapshot)
 *
 * 主要流程：
 * - 过滤掉系统命名空间，只允许业务命名空间；
 * - 根据所选命名空间过滤可用 VM 列表；
 * - 提交时调用 createHarvesterVirtualMachineBackup，传入 name/vmName/type。
 */
import React, { useEffect, useState } from 'react';
import { Modal, Form, Input, Select, Radio, message } from 'antd';
import { createHarvesterVirtualMachineBackup } from '../../../../services/harvesterApi';
import { isSystemNamespace } from '../../../../utils/harvesterUtils';

/**
 * 组件入参
 * - visible: 弹窗是否可见
 * - onCancel: 关闭回调
 * - onSuccess: 创建成功回调
 * - cloudId: 云 ID
 * - namespaces: 命名空间列表
 * - vms: 虚拟机列表
 * - initialType: 默认创建类型（备份/快照）
 */
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

  // 弹窗打开时重置表单，并根据 initialType 初始化当前类型
  useEffect(() => {
    if (visible) {
      form.resetFields();
      setType(initialType);
      form.setFieldsValue({ type: initialType });
    }
  }, [visible, initialType, form]);

  /**
   * 校验表单并提交创建：
   * - 仅需 name / namespace / vmName + type；
   * - alias 简单与 name 保持一致。
   */
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

  // 根据所选命名空间过滤可选 VM；只展示当前命名空间内的虚机
  const filteredVms = vms.filter(vm => !selectedNamespace || vm.namespace === selectedNamespace || (vm.metadata && vm.metadata.namespace === selectedNamespace));
  // 过滤掉系统命名空间，仅保留业务命名空间
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
