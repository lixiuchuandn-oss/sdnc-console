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
import { Modal, Form, Input, Select, message } from 'antd';
import { createHarvesterVirtualMachineBackup } from 'services/harvester/cbr';
import { isSystemNamespace } from '../../../../../../utils/harvesterUtils';
import { translateKnownApiErrorMessage } from '../../../../../../utils/k8sErrorMessages';

/**
 * 组件入参
 * - open: 弹窗是否可见
 * - onCancel: 关闭回调
 * - onSuccess: 创建成功回调
 * - cloudId: 云 ID
 * - namespaces: 命名空间列表
 * - vms: 虚拟机列表
 * - initialType: 默认创建类型（备份/快照）
 */
interface Props {
  open: boolean;
  onCancel: () => void;
  onSuccess: (created?: { namespace: string; name: string }) => void;
  cloudId: string;
  namespaces: any[];
  vms: any[];
  initialType?: 'backup' | 'snapshot';
  initialVm?: any;
  initialNamespace?: string;
}

const VmBackupCreateModal: React.FC<Props> = ({ 
  open, 
  onCancel, 
  onSuccess, 
  cloudId, 
  namespaces, 
  vms,
  initialType = 'backup',
  initialVm,
  initialNamespace
}) => {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [type, setType] = useState<'backup' | 'snapshot'>(initialType);
  const [selectedNamespace, setSelectedNamespace] = useState<string>('');
  const lockToInitialVm = !!initialVm;

  // 弹窗打开时重置表单，并根据 initialType 初始化当前类型
  useEffect(() => {
    if (open) {
      form.resetFields();
      setType(initialType);
      
      const initValues: any = { type: initialType };
      
      if (initialNamespace) {
        initValues.namespace = initialNamespace;
        setSelectedNamespace(initialNamespace);
      }
      
      if (initialVm) {
        initValues.vmName = initialVm.name || initialVm.metadata?.name;
        // 如果有 initialVm，确保 namespace 也被选中（通常 initialNamespace 应该同时传递）
        if (!initialNamespace && initialVm.metadata?.namespace) {
           initValues.namespace = initialVm.metadata.namespace;
           setSelectedNamespace(initialVm.metadata.namespace);
        }
      }

      form.setFieldsValue(initValues);
    }
  }, [open, initialType, initialVm, initialNamespace, form]);

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
      onSuccess({ namespace: values.namespace, name: values.name });
    } catch (e: any) {
      const raw =
        e?.message ||
        e?.responseData?.message ||
        (typeof e?.responseData === 'string' ? e.responseData : '') ||
        '';
      const friendly = translateKnownApiErrorMessage(String(raw || '请检查表单与集群配置'));
      message.error(`创建失败: ${friendly}`);
    } finally {
      setLoading(false);
    }
  };

  const filteredVms = lockToInitialVm
    ? [initialVm]
    : vms.filter(vm => !selectedNamespace || vm.namespace === selectedNamespace || (vm.metadata && vm.metadata.namespace === selectedNamespace));
  // 过滤掉系统命名空间，仅保留业务命名空间
  // 当 initialVm 存在时，只显示该虚拟机所在的命名空间
  const filteredNamespaces = namespaces
    .filter(ns => !isSystemNamespace(ns.metadata?.name || ns.name))
    .filter(ns => {
      if (!initialVm) return true;
      const vmNamespace = initialVm.namespace || initialVm.metadata?.namespace;
      return ns.metadata?.name === vmNamespace || ns.name === vmNamespace;
    });

  return (
    <Modal
      title={`创建${type === 'backup' ? '虚拟机备份' : '虚拟机快照'}`}
      open={open}
      onOk={handleOk}
      onCancel={onCancel}
      confirmLoading={loading}
      okText="创建"
      cancelText="取消"
      destroyOnHidden
    >
      <Form
        form={form}
        layout="vertical"
        initialValues={{ type: initialType }}
      >
        <Form.Item
          name="name"
          label="显示名称（别名）"
          rules={[
            { required: true, message: '请输入显示名称' }
          ]}
          tooltip="用于显示的友好名称，支持中文。K8s资源名称将自动生成（格式：id-vmb-随机字符串 或 id-vms-随机字符串）"
        >
          <Input placeholder="例如：生产环境备份-2024" />
        </Form.Item>

        <Form.Item
          name="namespace"
          label="项目"
          rules={[{ required: true, message: '请选择项目' }]}
        >
          <Select 
            placeholder="请选择项目"
            onChange={val => {
              setSelectedNamespace(val);
              form.setFieldsValue({ vmName: undefined });
            }}
            showSearch
            optionFilterProp="children"
            disabled={lockToInitialVm}
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
            disabled={!selectedNamespace || lockToInitialVm}
          >
            {filteredVms.map(vm => {
              const alias = vm.metadata?.annotations?.['tower.io/alias'];
              const name = vm.name || vm.metadata.name;
              const displayName = alias ? `${alias} (${name})` : name;
              return (
                <Select.Option key={vm.id || vm.metadata.uid} value={name}>
                  {displayName}
                </Select.Option>
              );
            })}
          </Select>
        </Form.Item>
      </Form>
    </Modal>
  );
};

export default VmBackupCreateModal;
