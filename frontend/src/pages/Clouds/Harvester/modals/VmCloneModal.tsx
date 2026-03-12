import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Modal, Form, Input, Steps, Alert, Descriptions, Typography, Space } from 'antd';
import { createHarvesterVirtualMachineBackup, createHarvesterVirtualMachineRestore } from '../../../../services/harvesterApi';

interface Props {
  open: boolean;
  onCancel: () => void;
  onSuccess?: (created: { namespace: string; name: string }) => void;
  cloudId: string;
  sourceVm: any;
  existingVms?: any[];
}

type Phase = 'form' | 'running' | 'success' | 'error';

const toK8sName = (raw: string, maxLen = 63) => {
  const s = String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '');
  if (!s) return '';
  if (s.length <= maxLen) return s;
  const cut = s.slice(0, maxLen).replace(/-+$/, '');
  return cut;
};

const VmCloneModal: React.FC<Props> = ({ open, onCancel, onSuccess, cloudId, sourceVm, existingVms }) => {
  const [form] = Form.useForm();
  const [phase, setPhase] = useState<Phase>('form');
  const [runningStep, setRunningStep] = useState(0);
  const [errorStep, setErrorStep] = useState<number | null>(null);
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [snapshotName, setSnapshotName] = useState<string>('');
  const [restoreName, setRestoreName] = useState<string>('');
  const stopRef = useRef(false);

  const srcNamespace = String(sourceVm?.metadata?.namespace || sourceVm?.namespace || '').trim();
  const srcName = String(sourceVm?.metadata?.name || sourceVm?.name || '').trim();
  const srcAlias = String(sourceVm?.metadata?.annotations?.['tower.io/alias'] || sourceVm?.alias || '').trim();

  const existingNameSet = useMemo(() => {
    const set = new Set<string>();
    (existingVms || []).forEach((v: any) => {
      const ns = String(v?.metadata?.namespace || v?.namespace || '').trim();
      const name = String(v?.metadata?.name || v?.name || '').trim();
      if (ns && name) set.add(`${ns}/${name}`);
    });
    return set;
  }, [existingVms]);

  const steps = useMemo(() => ['提交克隆点', '提交恢复任务'], []);

  useEffect(() => {
    if (!open) return;
    stopRef.current = false;
    setPhase('form');
    setRunningStep(0);
    setErrorStep(null);
    setErrorMessage('');
    setSnapshotName('');
    setRestoreName('');

    const now = Date.now();
    const base = srcName ? `${srcName}-clone-${String(now).slice(-4)}` : `vm-clone-${String(now).slice(-4)}`;
    form.resetFields();
    form.setFieldsValue({
      name: toK8sName(base) || '',
    });
  }, [open, form, srcNamespace, srcName]);

  const close = () => {
    stopRef.current = true;
    onCancel();
  };

  const okText = useMemo(() => {
    if (phase === 'form') return '克隆';
    if (phase === 'running') return '执行中';
    return '关闭';
  }, [phase]);

  const okDisabled = phase === 'running';

  const canCancel = true;

  const handleOk = async () => {
    if (phase === 'success' || phase === 'error') {
      close();
      return;
    }
    if (phase !== 'form') return;

    let stepIndex = 0;
    try {
      const values = await form.validateFields();
      const targetName = String(values.name || '').trim();
      if (!srcName) throw new Error('无法解析源虚拟机名称');
      if (!srcNamespace) throw new Error('无法解析源虚拟机命名空间');

      setPhase('running');
      setRunningStep(stepIndex);
      setErrorStep(null);
      setErrorMessage('');

      const snap = toK8sName(`clone-${srcName}-${Date.now()}`);
      if (!snap) throw new Error('无法生成快照名称');
      setSnapshotName(snap);

      await createHarvesterVirtualMachineBackup(cloudId, srcNamespace, {
        name: snap,
        vmName: srcName,
        type: 'snapshot',
        alias: snap,
      });

      if (stopRef.current) return;
      stepIndex = 1;
      setRunningStep(stepIndex);

      const restore = toK8sName(`clone-${targetName}-${Date.now()}`);
      if (!restore) throw new Error('无法生成恢复任务名称');
      setRestoreName(restore);

      const payload: any = {
        apiVersion: 'harvesterhci.io/v1beta1',
        kind: 'VirtualMachineRestore',
        metadata: {
          name: restore,
          namespace: srcNamespace,
          annotations: {
            'tower.io/description': 'Created via Compute Tower',
            'tower.io/cloneTask': 'true',
            'tower.io/cloneSourceVm': `${srcNamespace}/${srcName}`,
            'tower.io/cloneTargetVm': `${srcNamespace}/${targetName}`,
          },
        },
        spec: {
          target: {
            apiGroup: 'kubevirt.io',
            kind: 'VirtualMachine',
            name: targetName,
          },
          virtualMachineBackupName: snap,
          virtualMachineBackupNamespace: srcNamespace,
          newVM: true,
        },
      };

      await createHarvesterVirtualMachineRestore(cloudId, srcNamespace, payload);

      setPhase('success');
      onSuccess?.({ namespace: srcNamespace, name: targetName });
    } catch (e: any) {
      const msg = String(e?.message || '克隆失败');
      setPhase('error');
      setErrorMessage(msg);
      setErrorStep(stepIndex);
    }
  };

  const stepItems = useMemo(() => {
    return steps.map((title, idx) => {
      const isErr = phase === 'error' && errorStep === idx;
      const isDone = (phase === 'success' && idx < steps.length) || (phase === 'running' && idx < runningStep);
      const isCurrent = phase === 'running' && idx === runningStep;
      const status: any = isErr ? 'error' : isDone ? 'finish' : isCurrent ? 'process' : 'wait';
      return { title, status };
    });
  }, [steps, phase, errorStep, runningStep]);

  const body = (
    <>
      {phase === 'form' ? (
        <Form form={form} layout="vertical">
          <Form.Item label="源虚拟机">
            <Input value={srcAlias ? `${srcAlias} (${srcNamespace}/${srcName})` : `${srcNamespace}/${srcName}`} disabled />
          </Form.Item>

          <Form.Item label="目标命名空间">
            <Input value={srcNamespace || '-'} disabled />
          </Form.Item>

          <Form.Item
            name="name"
            label="新虚拟机名称"
            rules={[
              { required: true, message: '请输入新虚拟机名称' },
              {
                validator: async (_, value) => {
                  const name = String(value || '').trim();
                  if (!name) return Promise.resolve();
                  if (name === srcName) return Promise.reject(new Error('新名称不能与源虚拟机相同'));
                  if (!/^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/.test(name)) {
                    return Promise.reject(new Error('名称仅支持小写字母、数字和-，且不能以-开头/结尾'));
                  }
                  if (name.length > 63) return Promise.reject(new Error('名称长度不能超过 63'));
                  if (existingNameSet.has(`${srcNamespace}/${name}`)) return Promise.reject(new Error('该命名空间下已存在同名虚拟机'));
                  return Promise.resolve();
                },
              },
            ]}
          >
            <Input placeholder="例如：my-vm-clone" />
          </Form.Item>
        </Form>
      ) : (
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          <Steps size="small" items={stepItems} />

          {phase === 'error' ? <Alert type="error" showIcon message={errorMessage || '克隆失败'} /> : null}
          {phase === 'success' ? <Alert type="success" showIcon message="克隆成功" /> : null}

          <Descriptions size="small" column={1} bordered>
            <Descriptions.Item label="源虚拟机">{`${srcNamespace}/${srcName}`}</Descriptions.Item>
            <Descriptions.Item label="快照任务">{snapshotName || '-'}</Descriptions.Item>
            <Descriptions.Item label="恢复任务">{restoreName || '-'}</Descriptions.Item>
            <Descriptions.Item label="新虚拟机">{`${srcNamespace}/${form.getFieldValue('name') || '-'}`}</Descriptions.Item>
          </Descriptions>

          {phase === 'running' ? (
            <Typography.Text type="secondary">任务已提交，后续进度请在「克隆任务」中查看。</Typography.Text>
          ) : null}
        </Space>
      )}
    </>
  );

  return (
    <Modal
      title="克隆虚拟机"
      open={open}
      onCancel={close}
      onOk={handleOk}
      okText={okText}
      cancelText={phase === 'form' ? '取消' : '关闭'}
      okButtonProps={{ disabled: okDisabled }}
      cancelButtonProps={{ disabled: !canCancel }}
      maskClosable={canCancel}
      destroyOnHidden
      width={560}
    >
      {body}
    </Modal>
  );
};

export default VmCloneModal;
