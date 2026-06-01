/**
 * Harvester - 虚拟机恢复弹窗
 */
import React, { useCallback, useEffect, useState, useMemo } from 'react';
import { Modal, Form, Input, message, Alert, Switch, Tooltip, Radio, Select } from 'antd';
import { stopCloudProviderEcs } from '../../../../../../services/api';
import { createHarvesterVirtualMachineRestore, fetchHarvesterVmRestoreTaskList } from 'services/harvester/cbr';
import { translateKnownApiErrorMessage } from '../../../../../../utils/k8sErrorMessages';
import {
  ensureHarvesterRestoreTargetVmAlias,
  RESTORE_VM_ALIAS_MAX_WAIT_MS,
} from '../../ecs/lib/vmTowerAlias';
import {
  assertVmRestoreReplaceAllowed,
  buildVmRestoreInitialFormValues,
  buildVmRestorePayload,
  isVmAliasConflictInNamespace,
  isVmNameConflictInNamespace,
  resolveVmRestoreResourceContext,
  VM_RESTORE_K8S_NAME_PATTERN,
} from '../lib/vmRestoreModalUtils';
import { findInProgressHarvesterRestoreForBackup } from '../lib/vmRestoreTaskStatus';

interface Props {
  open: boolean;
  onCancel: () => void;
  onSuccess: () => void;
  cloudId: string;
  resource: any;
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
  vms,
}) => {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [keepMacAddress, setKeepMacAddress] = useState(false);
  const [checkingRestores, setCheckingRestores] = useState(false);
  const [blockingRestore, setBlockingRestore] = useState<{
    namespace: string;
    name: string;
    statusText: string;
  } | null>(null);
  const newVM = Form.useWatch('newVM', form);

  const ctx = useMemo(
    () => resolveVmRestoreResourceContext(resource, vms),
    [resource, vms],
  );

  useEffect(() => {
    if (open && ctx) {
      form.resetFields();
      setKeepMacAddress(false);
      form.setFieldsValue(buildVmRestoreInitialFormValues(ctx));
    }
  }, [open, ctx, form]);

  useEffect(() => {
    if (!open || !ctx) return;
    if (ctx.isSourceVmInRecycleBin) {
      form.setFieldsValue({ newVM: true });
    }
  }, [open, ctx, form]);

  const loadInProgressRestoreForSource = useCallback(async () => {
    if (!cloudId || !ctx) {
      setBlockingRestore(null);
      return null;
    }
    const { namespace, sourceName } = ctx;
    setCheckingRestores(true);
    try {
      const restores = await fetchHarvesterVmRestoreTaskList(cloudId, true);
      const hit = findInProgressHarvesterRestoreForBackup(restores, namespace, sourceName);
      setBlockingRestore(hit);
      return hit;
    } catch {
      setBlockingRestore(null);
      return null;
    } finally {
      setCheckingRestores(false);
    }
  }, [cloudId, ctx]);

  useEffect(() => {
    if (!open || !ctx) {
      setBlockingRestore(null);
      return;
    }
    void loadInProgressRestoreForSource();
  }, [open, ctx, loadInProgressRestoreForSource]);

  const handleOk = async () => {
    if (!ctx) return;
    try {
      const values = await form.validateFields();

      const inProgress = (await loadInProgressRestoreForSource()) ?? blockingRestore;
      if (inProgress) {
        message.warning(
          `该${resourceType === 'snapshot' ? '快照' : '备份'}已有进行中的恢复任务（${inProgress.namespace}/${inProgress.name}，${inProgress.statusText}），请等待完成后再试`,
        );
        return;
      }

      setLoading(true);

      if (values.newVM === false) {
        assertVmRestoreReplaceAllowed(ctx);
        if (ctx.isSourceVmRunning) {
          message.loading('源虚拟机正在运行，正在停止...', 0);
          try {
            await stopCloudProviderEcs(cloudId, `${ctx.namespace}/${ctx.sourceVmName}`, true);
            await new Promise((resolve) => setTimeout(resolve, 3000));
          } finally {
            message.destroy();
          }
        }
      }

      const payload = buildVmRestorePayload({
        values,
        ctx,
        resource,
        resourceType,
      });

      await createHarvesterVirtualMachineRestore(cloudId, ctx.namespace, payload);

      if (values.newVM === true) {
        void ensureHarvesterRestoreTargetVmAlias(cloudId, payload, {
          maxWaitMs: RESTORE_VM_ALIAS_MAX_WAIT_MS,
        }).catch((e) => {
          console.warn('Failed to set alias for restored VM:', e);
        });
      }

      message.success('恢复任务创建成功');
      window.dispatchEvent(new CustomEvent('harvester:restore-created'));
      onSuccess();
    } catch (e: any) {
      const raw =
        e?.message ||
        e?.responseData?.message ||
        (typeof e?.responseData === 'string' ? e.responseData : '') ||
        '';
      message.error(
        `创建失败: ${translateKnownApiErrorMessage(String(raw || '请检查表单与集群状态'))}`,
      );
    } finally {
      setLoading(false);
    }
  };

  if (!resource || !ctx) return null;

  const {
    namespace,
    sourceName,
    sourceVmName,
    sourceVmDisplay,
    isSourceVmExists,
    isSourceVmInRecycleBin,
    canReplaceSourceVm,
  } = ctx;

  return (
    <Modal
      title="恢复虚拟机"
      open={open}
      onOk={handleOk}
      onCancel={onCancel}
      confirmLoading={loading || checkingRestores}
      okButtonProps={{ disabled: !!blockingRestore }}
      destroyOnHidden
    >
      <Alert
        message={newVM === false ? '将替换目标虚拟机' : '将新建虚拟机'}
        description={
          blockingRestore
            ? `该${resourceType === 'snapshot' ? '快照' : '备份'}已有进行中的恢复任务（${blockingRestore.namespace}/${blockingRestore.name}，${blockingRestore.statusText}），请等待完成后再发起新的恢复。`
            : newVM === false
              ? isSourceVmInRecycleBin
                ? '源虚拟机在回收站中，不允许使用替换模式，请使用新建虚拟机或先从回收站还原后再操作。'
                : isSourceVmExists
                  ? '替换模式会自动停止目标虚拟机后执行恢复。'
                  : '目标虚拟机不存在，无法执行替换。'
              : '新建模式会创建一个新的虚拟机，不会覆盖现有虚拟机。'
        }
        type={blockingRestore ? 'error' : 'warning'}
        showIcon
        style={{ marginBottom: 16 }}
      />
      <Form form={form} layout="vertical">
        <Form.Item label={resourceType === 'snapshot' ? '源快照' : '源备份'}>
          <Input value={sourceName} disabled />
        </Form.Item>

        <Form.Item label="源虚拟机">
          <Input value={sourceVmDisplay} disabled />
        </Form.Item>

        <Form.Item
          name="name"
          label="恢复任务名称"
          rules={[{ required: true, message: '请输入恢复任务名称' }]}
        >
          <Input placeholder="请输入恢复任务名称" />
        </Form.Item>

        <Form.Item name="newVM" label="恢复模式">
          <Radio.Group>
            <Radio value={true}>新建虚拟机</Radio>
            <Tooltip
              title={
                !isSourceVmExists
                  ? '目标虚拟机不存在，无法替换'
                  : isSourceVmInRecycleBin
                    ? '虚拟机在回收站中时不允许替换，请使用新建虚拟机或先从回收站还原'
                    : undefined
              }
            >
              <span style={{ display: 'inline-block' }}>
                <Radio value={false} disabled={!canReplaceSourceVm}>
                  替换虚拟机
                </Radio>
              </span>
            </Tooltip>
          </Radio.Group>
        </Form.Item>

        {newVM === true && (
          <>
            <Form.Item label="目标虚拟机名称">
              <Input value={sourceVmName || '-'} disabled />
            </Form.Item>
            <Form.Item
              name="newVmName"
              label="K8s 资源名称"
              rules={[
                { required: true, message: '请输入K8s资源名称' },
                {
                  validator: async (_, value) => {
                    const name = String(value || '').trim();
                    if (!name) return;
                    if (!VM_RESTORE_K8S_NAME_PATTERN.test(name)) {
                      throw new Error(
                        '名称仅支持小写字母、数字和-，且不能以-开头/结尾，不支持中文',
                      );
                    }
                    if (name.length > 63) {
                      throw new Error('名称长度不能超过 63 个字符');
                    }
                    if (isVmNameConflictInNamespace(name, namespace, vms)) {
                      throw new Error('虚拟机名称已存在');
                    }
                  },
                },
              ]}
              tooltip="Kubernetes 资源名称，仅支持小写字母、数字和连字符"
            >
              <Input placeholder="例如：restore-vm-1234567890" />
            </Form.Item>
            <Form.Item
              name="displayName"
              label="显示名称（别名）"
              tooltip="用于显示的友好名称，支持中文。如果不填写，将使用K8s资源名称"
              rules={[
                {
                  validator: async (_, value) => {
                    const s = String(value ?? '').trim();
                    if (!s) return Promise.resolve();
                    if (isVmAliasConflictInNamespace(s, namespace, vms)) {
                      return Promise.reject(new Error('云主机名称和已有云主机名称重复，请修改'));
                    }
                    return Promise.resolve();
                  },
                },
              ]}
            >
              <Input placeholder="例如：测试虚拟机-恢复" />
            </Form.Item>
          </>
        )}

        {newVM === false && (
          <Form.Item label="目标虚拟机名称">
            <Input value={sourceVmDisplay} disabled />
          </Form.Item>
        )}

        {resourceType === 'backup' && newVM === true && (
          <Form.Item name="keepMacAddress" label="MAC 地址保留" valuePropName="checked">
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
            <Select options={[{ label: 'Retain', value: 'retain' }]} />
          </Form.Item>
        )}
      </Form>
    </Modal>
  );
};

export default VmRestoreModal;
