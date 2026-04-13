import React, { useEffect, useMemo, useState } from 'react';
import { Modal, Form, Input, Alert, message } from 'antd';
import { harvesterVmAction, patchHarvesterVm, fetchHarvesterVmDetail } from '../../../../../../services/harvesterApi';

interface Props {
  open: boolean;
  onCancel: () => void;
  onSuccess?: (created: { namespace: string; name: string }) => void;
  cloudId: string;
  sourceVm: any;
  existingVms?: any[];
}

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
  const [loading, setLoading] = useState(false);

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

  useEffect(() => {
    if (!open) return;
    form.resetFields();
    const now = Date.now();
    const base = srcName ? `${srcName}-clone-${String(now).slice(-4)}` : `vm-clone-${String(now).slice(-4)}`;
    const defaultK8sName = toK8sName(base) || '';
    const defaultDisplayName = srcAlias ? `${srcAlias}-克隆` : '';
    form.setFieldsValue({
      name: defaultK8sName,
      displayName: defaultDisplayName,
    });
  }, [open, form, srcNamespace, srcName, srcAlias]);

  const handleOk = async () => {
    try {
      const values = await form.validateFields();
      const targetName = String(values.name || '').trim();
      if (!srcName) throw new Error('无法解析源虚拟机名称');
      if (!srcNamespace) throw new Error('无法解析源虚拟机命名空间');

      setLoading(true);

      // 克隆时使用 Manual runStrategy，避免卷未就绪时自动启动导致 VM 一直处于启动中状态
      // 等待卷就绪后，用户可以手动启动 VM
      const runStrategy = 'Manual';

      // 使用 Harvester 标准的直接克隆方式
      await harvesterVmAction(
        cloudId,
        srcNamespace,
        srcName,
        'clone',
        {
          targetVm: targetName,
          runStrategy: runStrategy
        }
      );

      // 等待 VM 创建后，添加克隆任务标记和别名
      try {
        // 等待一小段时间让 VM 创建
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        // 尝试获取新创建的 VM
        let retries = 3;
        while (retries > 0) {
          try {
            const newVm = await fetchHarvesterVmDetail(cloudId, srcNamespace, targetName);
            if (newVm) {
              // 准备要设置的注解
              const annotations: any = {
                'tower.io/cloneTask': JSON.stringify({
                  sourceVm: `${srcNamespace}/${srcName}`,
                  sourceVmName: srcName,
                  sourceVmNamespace: srcNamespace,
                  cloneType: 'standard',
                  createdAt: new Date().toISOString(),
                }),
              };
              
              // 如果用户输入了显示名称，设置为别名
              const displayName = String(values.displayName || '').trim();
              if (displayName) {
                annotations['tower.io/alias'] = displayName;
              }
              
              await patchHarvesterVm(
                cloudId,
                srcNamespace,
                targetName,
                {
                  metadata: {
                    annotations,
                  },
                }
              );
              break;
            }
          } catch (e: any) {
            if (e?.status === 404 || e?.message?.includes('not found')) {
              retries--;
              if (retries > 0) {
                await new Promise(resolve => setTimeout(resolve, 1000));
                continue;
              }
            }
            // 如果添加注解失败，不影响克隆流程，只记录错误
            console.warn('Failed to add clone task annotation:', e);
            break;
          }
        }
      } catch (e: any) {
        // 添加注解失败不影响克隆流程
        console.warn('Failed to add clone task annotation:', e);
      }

      // 立即关闭弹窗，不阻塞用户
      message.success({
        content: `克隆任务已提交！新虚拟机 ${srcNamespace}/${targetName} 正在后台创建中，卷克隆可能需要几分钟。请在「云主机」列表中查看该虚拟机，状态列会显示「克隆: 进行中」或「克隆: 完成」。`,
        duration: 8,
      });
      onSuccess?.({ namespace: srcNamespace, name: targetName });
      onCancel();
    } catch (e: any) {
      const errorMsg = String(e?.message || '未知错误');
      // 如果是卷未就绪错误，说明任务已提交，只是卷还在克隆中
      if (errorMsg.includes('not ready for workloads') || errorMsg.includes('AttachVolume')) {
        const targetName = String(form.getFieldValue('name') || '').trim();
        // 即使出现错误，也尝试添加克隆标记和别名
        try {
          await new Promise(resolve => setTimeout(resolve, 2000));
          let retries = 3;
          while (retries > 0) {
            try {
              const newVm = await fetchHarvesterVmDetail(cloudId, srcNamespace, targetName);
              if (newVm) {
                const annotations: any = {
                  'tower.io/cloneTask': JSON.stringify({
                    sourceVm: `${srcNamespace}/${srcName}`,
                    sourceVmName: srcName,
                    sourceVmNamespace: srcNamespace,
                    cloneType: 'standard',
                    createdAt: new Date().toISOString(),
                  }),
                };
                
                // 如果用户输入了显示名称，设置为别名
                const displayName = String(form.getFieldValue('displayName') || '').trim();
                if (displayName) {
                  annotations['tower.io/alias'] = displayName;
                }
                
                await patchHarvesterVm(
                  cloudId,
                  srcNamespace,
                  targetName,
                  {
                    metadata: {
                      annotations,
                    },
                  }
                );
                break;
              }
            } catch (e: any) {
              if (e?.status === 404 || e?.message?.includes('not found')) {
                retries--;
                if (retries > 0) {
                  await new Promise(resolve => setTimeout(resolve, 1000));
                  continue;
                }
              }
              break;
            }
          }
        } catch (e) {
          console.warn('Failed to add clone task annotation:', e);
        }

        message.warning({
          content: `克隆任务已提交！新虚拟机 ${srcNamespace}/${targetName} 正在后台创建中，卷正在克隆（这是正常过程）。请在「云主机」列表中查看该虚拟机，状态列会显示「克隆: 进行中」或「克隆: 完成」。`,
          duration: 8,
        });
        if (targetName) {
          onSuccess?.({ namespace: srcNamespace, name: targetName });
        }
        onCancel();
      } else {
        message.error(`克隆失败: ${errorMsg}`);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      title="克隆虚拟机"
      open={open}
      onCancel={onCancel}
      onOk={handleOk}
      confirmLoading={loading}
      destroyOnHidden
      width={560}
    >
      <Alert
        message="使用标准克隆方式"
        description="将直接克隆虚拟机和所有卷，无需创建快照，速度更快。克隆任务提交后将在后台进行，卷克隆可能需要几分钟。克隆完成后，新虚拟机将处于停止状态，等待卷就绪后您可手动启动。在「云主机」列表中，该虚拟机的状态列会显示「克隆: 进行中」或「克隆: 完成」。"
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
      />
      <Form form={form} layout="vertical">
        <Form.Item label="源虚拟机">
          <Input value={srcAlias ? `${srcAlias} (${srcNamespace}/${srcName})` : `${srcNamespace}/${srcName}`} disabled />
        </Form.Item>

        <Form.Item label="目标命名空间">
          <Input value={srcNamespace || '-'} disabled />
        </Form.Item>

        <Form.Item
          name="name"
          label="K8s 资源名称"
          rules={[
            { required: true, message: '请输入K8s资源名称' },
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
          tooltip="Kubernetes 资源名称，仅支持小写字母、数字和连字符"
        >
          <Input placeholder="例如：my-vm-clone" />
        </Form.Item>
        <Form.Item
          name="displayName"
          label="显示名称（别名）"
          tooltip="用于显示的友好名称，支持中文。如果不填写，将使用K8s资源名称"
        >
          <Input placeholder="例如：测试虚拟机-克隆" />
        </Form.Item>
      </Form>
    </Modal>
  );
};

export default VmCloneModal;
