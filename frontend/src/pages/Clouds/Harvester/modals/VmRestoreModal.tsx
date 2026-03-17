/**
 * Harvester - 虚拟机恢复弹窗
 *
 * 支持从「备份」或「快照」恢复虚拟机：
 * - 支持新建 VM 或替换已有 VM；
 * - 备份恢复时可选是否保留 MAC 地址；
 * - 针对快照恢复，兼容 Harvester API 对 VirtualMachineRestore 的要求：
 *   - 一律使用 apiVersion: harvesterhci.io/v1beta1；
 *   - 快照恢复走 virtualMachineBackupName/Namespace 字段传递来源信息；
 *   - 替换模式下传 deletionPolicy=retain，避免删除策略冲突。
 */
import React, { useEffect, useState, useMemo } from 'react';
import { Modal, Form, Input, message, Alert, Switch, Tooltip, Radio, Select } from 'antd';
import { createHarvesterVirtualMachineRestore, stopHarvesterVm } from '../../../../services/harvesterApi';

/**
 * 组件入参
 * - visible: 弹窗是否可见
 * - onCancel: 关闭回调
 * - onSuccess: 创建恢复任务成功回调
 * - cloudId: 云 ID
 * - resource: 源备份/快照记录
 * - resourceType: 资源类型 backup/snapshot
 * - vms: 当前集群中 VM 列表（用于辅助判断目标 VM 运行状态等）
 */
interface Props {
  open: boolean;
  onCancel: () => void;
  onSuccess: () => void;
  cloudId: string;
  resource: any; // The snapshot or backup record
  resourceType: 'backup' | 'snapshot';
  vms?: any[];
}

const VmRestoreModal: React.FC<Props> = ({ 
  open, 
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

  const raw = useMemo(() => {
    if (!resource) return null;
    return (resource as any).rawData || (resource as any).raw || resource;
  }, [resource]);

  const namespace = useMemo(() => {
    return raw?.metadata?.namespace || (resource as any)?.namespace || '';
  }, [raw, resource]);

  const sourceName = useMemo(() => {
    return raw?.metadata?.name || (resource as any)?.name || '';
  }, [raw, resource]);

  const sourceVmName = useMemo(() => {
    const fromSpec = raw?.spec?.source?.name;
    const fromCompat = (resource as any)?.targetVm;
    const name = fromSpec || fromCompat || '';
    return name && name !== '-' ? name : '';
  }, [raw, resource]);

  const sourceVmObj = useMemo(() => {
    if (!vms || !namespace || !sourceVmName) return null;
    return (vms || []).find((vm: any) => {
      const vmNs = vm?.metadata?.namespace || vm?.namespace || '';
      const vmName = vm?.metadata?.name || vm?.name || '';
      return String(vmNs) === String(namespace) && String(vmName) === String(sourceVmName);
    }) || null;
  }, [vms, namespace, sourceVmName]);

  const sourceVmAlias = useMemo(() => {
    const fromRecord = (resource as any)?.targetVmAlias;
    if (fromRecord && fromRecord !== '-') return String(fromRecord);
    const fromVm = sourceVmObj?.metadata?.annotations?.['tower.io/alias'] || sourceVmObj?.alias;
    if (fromVm) return String(fromVm);
    return sourceVmName || '-';
  }, [resource, sourceVmObj, sourceVmName]);

  const sourceVmDisplay = useMemo(() => {
    if (!sourceVmName) return '-';
    if (!sourceVmAlias || sourceVmAlias === '-' || sourceVmAlias === sourceVmName) return sourceVmName;
    return `${sourceVmAlias} (${sourceVmName})`;
  }, [sourceVmAlias, sourceVmName]);

  const isSourceVmExists = useMemo(() => {
    return !!sourceVmObj;
  }, [sourceVmObj]);

  const isSourceVmRunning = useMemo(() => {
    if (!sourceVmObj) return false;
    const status = sourceVmObj?.status?.printableStatus || sourceVmObj?.status?.phase || sourceVmObj?.status || '';
    const s = String(status).toLowerCase();
    return s === 'running' || s === 'starting';
  }, [sourceVmObj]);

  // 弹窗打开时重置表单并初始化默认值
  useEffect(() => {
    if (open && resource) {
      form.resetFields();
      setKeepMacAddress(false);
      const base = sourceVmName || sourceName || 'vm';
      const suggestedNewVmName = `restore-${base}-${Math.floor(Date.now() / 1000)}`;
      form.setFieldsValue({
        name: `restore-${sourceName}-${Math.floor(Date.now() / 1000)}`,
        newVM: true,
        deletionPolicy: 'retain',
        newVmName: suggestedNewVmName,
        keepMacAddress: false,
      });
    }
  }, [open, resource, form, sourceName, sourceVmName]);

  /**
   * 提交创建虚拟机恢复任务：
   * - snapshot 恢复：统一走 backup 风格字段，并根据 newVM/deletionPolicy 区分新建/替换；
   * - backup 恢复：支持 newVM + keepMacAddress 组合。
   */
  const handleOk = async () => {
    try {
      const values = await form.validateFields();
      setLoading(true);

      const targetName = values.newVM === false ? sourceVmName : values.newVmName;
      if (!targetName) throw new Error('目标虚拟机名称为空');

      if (values.newVM === false) {
        if (!isSourceVmExists) throw new Error('源虚拟机不存在，无法执行替换');
        if (isSourceVmRunning) {
          message.loading('源虚拟机正在运行，正在停止...', 0);
          try {
            await stopHarvesterVm(cloudId, namespace, sourceVmName, true);
            await new Promise(resolve => setTimeout(resolve, 3000));
          } finally {
            message.destroy();
          }
        }
      }
      
      const payload: any = {
        apiVersion: 'harvesterhci.io/v1beta1',
        kind: 'VirtualMachineRestore',
        metadata: {
          name: values.name,
          namespace,
          annotations: {
            'tower.io/description': 'Created via Compute Tower',
            'tower.io/restoreTask': 'true',
            'tower.io/restoreMode': values.newVM ? 'new' : 'replace',
            'tower.io/restoreSource': `${namespace}/${sourceName}`,
            'tower.io/restoreTarget': `${namespace}/${targetName}`
          }
        },
        spec: {
          target: {
            apiGroup: 'kubevirt.io',
            kind: 'VirtualMachine',
            name: targetName
          }
        }
      };

      payload.spec.virtualMachineBackupName = sourceName;
      payload.spec.virtualMachineBackupNamespace = namespace;
      if (values.newVM === false) payload.spec.deletionPolicy = 'retain';

      if (resourceType === 'snapshot') {
        if (values.newVM === false) {
          payload.spec.deletionPolicy = 'retain';
        } else {
          payload.spec.newVM = true;
        }
      } else {
        if (values.newVM !== undefined) payload.spec.newVM = values.newVM;
        if (values.keepMacAddress !== undefined) payload.spec.keepMacAddress = values.keepMacAddress;
      }

      await createHarvesterVirtualMachineRestore(
        cloudId,
        namespace,
        payload
      );

      message.success('恢复任务创建成功');
      // 触发恢复任务创建事件，通知恢复任务列表刷新
      window.dispatchEvent(new CustomEvent('harvester:restore-created'));
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
      open={open}
      onOk={handleOk}
      onCancel={onCancel}
      confirmLoading={loading}
      destroyOnHidden
    >
      <Alert
        message={newVM === false ? '将替换目标虚拟机' : '将新建虚拟机'}
        description={
          newVM === false
            ? (isSourceVmExists ? '替换模式会自动停止目标虚拟机后执行恢复。' : '目标虚拟机不存在，无法执行替换。')
            : '新建模式会创建一个新的虚拟机，不会覆盖现有虚拟机。'
        }
        type="warning"
        showIcon
        style={{ marginBottom: 16 }}
      />
      <Form
        form={form}
        layout="vertical"
      >
        <Form.Item label={resourceType === 'snapshot' ? '源快照' : '源备份'}>
          <Input value={sourceName} disabled />
        </Form.Item>

        <Form.Item label="源虚拟机">
          <Input value={sourceVmDisplay} disabled />
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
          name="newVM"
          label="恢复模式"
        >
          <Radio.Group>
            <Radio value={true}>新建虚拟机</Radio>
            <Radio value={false} disabled={!isSourceVmExists}>替换虚拟机</Radio>
          </Radio.Group>
        </Form.Item>

        {newVM === true && (
          <>
            <Form.Item label="目标虚拟机名称">
              <Input value={sourceVmName || '-'} disabled />
            </Form.Item>
            <Form.Item
              name="newVmName"
              label="新虚拟机名称"
              rules={[
                { required: true, message: '请输入新虚拟机名称' },
                {
                  validator: async (_, value) => {
                    const name = String(value || '').trim();
                    if (!name) return;
                    // [修复] 验证名称格式：仅支持小写字母、数字和-，不支持中文
                    if (!/^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/.test(name)) {
                      throw new Error('名称仅支持小写字母、数字和-，且不能以-开头/结尾，不支持中文');
                    }
                    if (name.length > 63) {
                      throw new Error('名称长度不能超过 63 个字符');
                    }
                    const conflict = (vms || []).some((vm: any) => {
                      const vmNs = vm?.metadata?.namespace || vm?.namespace || '';
                      const vmName = vm?.metadata?.name || vm?.name || '';
                      return String(vmNs) === String(namespace) && String(vmName) === String(name);
                    });
                    if (conflict) throw new Error('虚拟机名称已存在');
                  }
                }
              ]}
            >
              <Input placeholder="请输入新虚拟机名称（仅支持小写字母、数字和-）" />
            </Form.Item>
          </>
        )}

        {newVM === false && (
          <Form.Item label="目标虚拟机名称">
            <Input value={sourceVmDisplay} disabled />
          </Form.Item>
        )}

        {/* [修复] MAC地址保留字段：新建虚拟机时也需要显示 */}
        {resourceType === 'backup' && (
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

        {resourceType === 'snapshot' && newVM === false && (
          <Form.Item
            name="deletionPolicy"
            label="删除策略"
            rules={[{ required: true, message: '请选择删除策略' }]}
          >
            <Select
              options={[
                { label: 'Retain', value: 'retain' },
              ]}
            />
          </Form.Item>
        )}
      </Form>
    </Modal>
  );
};

export default VmRestoreModal;
