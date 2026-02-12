import React, { useEffect, useState, useMemo } from 'react';
import { Modal, Form, Input, message, Alert, Switch, Radio, Tooltip, Select } from 'antd';
import { createHarvesterVirtualMachineRestore } from '../../../../services/harvesterApi';

interface Props {
  visible: boolean;
  onCancel: () => void;
  onSuccess: () => void;
  cloudId: string;
  resource: any; // The snapshot or backup record
  resourceType: 'backup' | 'snapshot';
  vms?: any[];
}

const VmRestoreModal: React.FC<Props> = ({ 
  visible, 
  onCancel, 
  onSuccess, 
  cloudId, 
  resource,
  resourceType,
  vms
}) => {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [keepMacAddress, setKeepMacAddress] = useState(false);
  const newVM = Form.useWatch('newVM', form);
  const targetVmName = Form.useWatch('targetVmName', form);

  const targetVmObj = useMemo(() => {
    if (!vms || !targetVmName || !resource) return null;
    return vms.find(v => v.metadata.name === targetVmName && v.metadata.namespace === resource.namespace);
  }, [vms, targetVmName, resource]);

  const isTargetVmExists = useMemo(() => {
    if (!resource || !vms || vms.length === 0) return false;
    const originalTargetVmName = resource.targetVm || '';
    if (!originalTargetVmName || originalTargetVmName === '-') return false;
    return vms.some(vm => {
      const vmName = vm.name || vm.metadata?.name;
      return vmName === originalTargetVmName;
    });
  }, [resource, vms]);

  const isTargetVmRunning = useMemo(() => {
    if (!targetVmObj) return false;
    const status = targetVmObj.status?.printableStatus || targetVmObj.status?.phase;
    return String(status).toLowerCase() === 'running' || String(status).toLowerCase() === 'starting';
  }, [targetVmObj]);

  useEffect(() => {
    if (visible && resource) {
      form.resetFields();
      setKeepMacAddress(false);
      form.setFieldsValue({
        name: `restore-${resource.name}-${Math.floor(Date.now() / 1000)}`,
        targetVmName: resource.targetVm !== '-' ? resource.targetVm : '',
        newVM: true,
        deletionPolicy: 'Delete', // Default to Delete
        keepMacAddress: false // Default to Keep MAC (Disabled) -> Reset MAC
      });
    }
  }, [visible, resource, form]);

  useEffect(() => {
    if (isTargetVmRunning || !isTargetVmExists) {
      const currentNewVM = form.getFieldValue('newVM');
      if (currentNewVM === false) {
        form.setFieldsValue({ newVM: true });
      }
    }
  }, [isTargetVmRunning, isTargetVmExists, form]);

  const handleOk = async () => {
    try {
      const values = await form.validateFields();
      setLoading(true);
      
      const isSnapshot = resourceType === 'snapshot';
      const payload: any = {
        apiVersion: 'harvesterhci.io/v1beta1',
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
        // 按照用户提供的参考参数，整机快照恢复也使用backup字段来传递信息
        payload.spec.virtualMachineBackupName = resource.name;
        payload.spec.virtualMachineBackupNamespace = resource.namespace;
        // 当选择替换虚拟机时，需要传deletionPolicy为retain以避免删除策略冲突，且不需要传newVM字段
        if (values.newVM === false) {
          // 替换模式：添加deletionPolicy字段，不需要传newVM字段
          // 注意：快照类型需要小写的deletionPolicy值
          payload.spec.deletionPolicy = (values.deletionPolicy || "retain").toLowerCase();
        } else {
          // 新建模式：添加newVM字段
          payload.spec.newVM = true;
        }
      } else {
        payload.spec.virtualMachineBackupName = resource.name;
        payload.spec.virtualMachineBackupNamespace = resource.namespace;
        // Harvester Backup specific options
        if (values.newVM !== undefined) payload.spec.newVM = values.newVM;
        // The UI label is "MAC Address Keep" (Enabled/Disabled).
        // If Enabled (true) -> Keep MAC -> keepMacAddress = true.
        // If Disabled (false) -> Reset MAC -> keepMacAddress = false.
        if (values.keepMacAddress !== undefined) {
          payload.spec.keepMacAddress = values.keepMacAddress;
        }
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
        message={isTargetVmRunning ? "目标虚拟机正在运行中" : (!isTargetVmExists ? "目标虚拟机不存在" : "注意")}
        description={isTargetVmRunning 
          ? "目标虚拟机正在运行中，无法执行替换操作，只能进行新建虚拟机操作。如需替换，请先停止虚拟机。" 
          : (!isTargetVmExists 
            ? "目标虚拟机不存在，无法执行替换操作。将创建一个新的虚拟机。"
            : "恢复操作将停止并替换目标虚拟机。如果目标虚拟机不存在，将会创建一个新的虚拟机。")}
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

        <Form.Item 
          name="newVM" 
          label="恢复模式"
        >
           <Radio.Group onChange={() => form.setFieldsValue({ deletionPolicy: resourceType === 'snapshot' ? 'retain' : 'Delete' })}>
              <Radio value={true}>新建虚拟机</Radio>
              <Radio value={false} disabled={isTargetVmRunning || !isTargetVmExists}>
                替换虚拟机
                {isTargetVmRunning && <span style={{fontSize: 12, color: '#ff4d4f', marginLeft: 8}}>(运行中，不可用)</span>}
                {!isTargetVmExists && <span style={{fontSize: 12, color: '#ff4d4f', marginLeft: 8}}>(虚拟机不存在，不可用)</span>}
              </Radio>
           </Radio.Group>
        </Form.Item>

        {resourceType === 'backup' && newVM === true && (
          <Form.Item 
            name="keepMacAddress" 
            label="MAC 地址保留"
            valuePropName="checked"
          >
            <Tooltip title="启用后将保留虚拟机的MAC地址">
              <Switch 
                checked={keepMacAddress}
                onChange={(checked) => {
                  setKeepMacAddress(checked);
                  form.setFieldsValue({ keepMacAddress: checked });
                }}
              />
            </Tooltip>
          </Form.Item>
        )}

        {newVM === false && (
          <Form.Item 
            name="deletionPolicy" 
            label="删除以前的虚拟磁盘"
            initialValue="retain"
          >
            <Select>
              {resourceType !== 'snapshot' && (
                <Select.Option value="delete">Delete</Select.Option>
              )}
              <Select.Option value="retain">Retain</Select.Option>
            </Select>
          </Form.Item>
        )}
      </Form>
    </Modal>
  );
};

export default VmRestoreModal;
