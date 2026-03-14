import React, { useEffect, useMemo, useState } from 'react';
import { Modal, Form, Input, Alert, message } from 'antd';
import { harvesterVmAction, patchHarvesterVm, fetchHarvesterVmDetail } from '../../../../services/harvesterApi';

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
    form.setFieldsValue({
      name: toK8sName(base) || '',
    });
  }, [open, form, srcNamespace, srcName]);

  const handleOk = async () => {
    // 检查源 VM 是否在运行（在 try 块外部定义，以便在 catch 块中使用）
    const sourceVmRunning = sourceVm?.status?.printableStatus === 'Running' || 
                            sourceVm?.status?.ready === true ||
                            sourceVm?.status?.phase === 'Running';

    try {
      const values = await form.validateFields();
      const targetName = String(values.name || '').trim();
      if (!srcName) throw new Error('无法解析源虚拟机名称');
      if (!srcNamespace) throw new Error('无法解析源虚拟机命名空间');

      setLoading(true);

      // 克隆时，将新 VM 的 runStrategy 设置为 Halted，避免在卷克隆完成前启动
      // 这样可以避免存储卷挂载冲突（卷还在克隆中时，VM 不应该尝试启动）
      // 用户可以在卷克隆完成后手动启动新 VM
      const runStrategy = 'Halted';

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

      // 等待 VM 创建后，添加克隆任务标记
      try {
        // 等待一小段时间让 VM 创建
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        // 尝试获取新创建的 VM
        let retries = 3;
        while (retries > 0) {
          try {
            const newVm = await fetchHarvesterVmDetail(cloudId, srcNamespace, targetName);
            if (newVm) {
              // 给新 VM 添加克隆任务标记
              const cloneTaskAnnotation = JSON.stringify({
                sourceVm: `${srcNamespace}/${srcName}`,
                sourceVmName: srcName,
                sourceVmNamespace: srcNamespace,
                cloneType: 'standard',
                createdAt: new Date().toISOString(),
              });
              
              await patchHarvesterVm(
                cloudId,
                srcNamespace,
                targetName,
                {
                  metadata: {
                    annotations: {
                      'tower.io/cloneTask': cloneTaskAnnotation,
                    },
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
      const sourceVmStatus = sourceVmRunning ? '（源虚拟机正在运行）' : '';
      message.success({
        content: `克隆任务已提交！新虚拟机 ${srcNamespace}/${targetName} 已创建为停止状态${sourceVmStatus}，卷克隆可能需要几分钟时间。卷克隆完成后，您需要手动启动新虚拟机。您可以在「快照/备份 → 克隆任务」中查看进度。`,
        duration: 10,
      });
      onSuccess?.({ namespace: srcNamespace, name: targetName });
      onCancel();
    } catch (e: any) {
      const errorMsg = String(e?.message || '未知错误');
      // 如果是卷未就绪错误，说明任务已提交，只是卷还在克隆中
      if (errorMsg.includes('not ready for workloads') || errorMsg.includes('AttachVolume')) {
        const targetName = String(form.getFieldValue('name') || '').trim();
        // 即使出现错误，也尝试添加克隆标记
        try {
          await new Promise(resolve => setTimeout(resolve, 2000));
          let retries = 3;
          while (retries > 0) {
            try {
              const newVm = await fetchHarvesterVmDetail(cloudId, srcNamespace, targetName);
              if (newVm) {
                const cloneTaskAnnotation = JSON.stringify({
                  sourceVm: `${srcNamespace}/${srcName}`,
                  sourceVmName: srcName,
                  sourceVmNamespace: srcNamespace,
                  cloneType: 'standard',
                  createdAt: new Date().toISOString(),
                });
                await patchHarvesterVm(
                  cloudId,
                  srcNamespace,
                  targetName,
                  {
                    metadata: {
                      annotations: {
                        'tower.io/cloneTask': cloneTaskAnnotation,
                      },
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

        const sourceVmStatus = sourceVmRunning ? '（源虚拟机正在运行）' : '';
        message.warning({
          content: `克隆任务已提交！新虚拟机 ${srcNamespace}/${targetName} 已创建为停止状态${sourceVmStatus}，卷正在克隆（这是正常过程）。卷克隆完成后，您需要手动启动新虚拟机。您可以在「快照/备份 → 克隆任务」中查看进度。`,
          duration: 10,
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
      destroyOnClose
      width={560}
    >
      <Alert
        message="使用标准克隆方式"
        description="将直接克隆虚拟机和所有卷，无需创建快照，速度更快。新虚拟机将以停止状态创建，避免在卷克隆完成前启动导致存储卷挂载冲突。卷克隆可能需要几分钟时间，完成后您需要手动启动新虚拟机。您可以在「快照/备份 → 克隆任务」中查看卷克隆进度。"
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
    </Modal>
  );
};

export default VmCloneModal;
