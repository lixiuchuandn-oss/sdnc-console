import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Collapse, Form, Modal, Select } from 'antd';
import { fetchMaasImages, maasMachineOp } from '../../../../../services/maasApi';
import type { MaasImageGroup } from '../lib/maasImages';

type Props = {
  poolId: string;
  systemId: string | null;
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
};

type DeployChoice = {
  group_id: string;
  osystem: string;
  distro_series: string;
  label: string;
  useHweKernel: boolean;
};

function buildDeployChoice(group: MaasImageGroup, variantResourceId?: string | number): DeployChoice {
  const variant =
    variantResourceId != null
      ? group.variants.find((v) => String(v.resource_id) === String(variantResourceId))
      : undefined;
  const arch = (variant?.architecture || '').toLowerCase();
  return {
    group_id: group.group_id,
    osystem: group.osystem,
    distro_series: group.distro_series,
    label: variant ? `${group.display_name} — ${variant.label}` : group.display_name,
    useHweKernel: arch.includes('hwe'),
  };
}

const MaasDeployModal: React.FC<Props> = ({
  poolId,
  systemId,
  open,
  onClose,
  onSuccess,
}) => {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [groups, setGroups] = useState<MaasImageGroup[]>([]);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const selectedGroupId = Form.useWatch('osGroup', form) as string | undefined;
  const _selectedVariantId = Form.useWatch('kernelVariant', form) as string | undefined;

  const selectedGroup = useMemo(
    () => groups.find((g) => g.group_id === selectedGroupId),
    [groups, selectedGroupId],
  );

  useEffect(() => {
    if (!open || !poolId) return;
    let cancelled = false;
    void (async () => {
      setLoadErr(null);
      try {
        const res = await fetchMaasImages(poolId, { deployable: true, skipCache: true });
        const items = Array.isArray(res?.items) ? res.items : [];
        if (!res?.ok) {
          if (!cancelled) {
            setLoadErr(res?.message || '加载可部署操作系统失败');
            setGroups([]);
          }
          return;
        }
        if (!cancelled) setGroups(items);
      } catch (e: unknown) {
        if (!cancelled) {
          setLoadErr(e instanceof Error ? e.message : '加载可部署操作系统失败');
          setGroups([]);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, poolId]);

  useEffect(() => {
    if (!selectedGroup) return;
    const def = selectedGroup.variants.find((v) => v.is_default);
    form.setFieldsValue({
      kernelVariant: def ? String(def.resource_id) : undefined,
    });
  }, [selectedGroup, form]);

  const handleOk = async () => {
    if (!systemId) return;
    try {
      const v = await form.validateFields();
      const group = groups.find((g) => g.group_id === v.osGroup);
      if (!group) return;
      const choice = buildDeployChoice(group, v.kernelVariant);
      setLoading(true);
      const body: Record<string, string> = {
        osystem: choice.osystem,
        distro_series: choice.distro_series,
      };
      if (choice.useHweKernel) {
        body.hwe_kernel = '1';
      }
      const res = await maasMachineOp(poolId, systemId, 'deploy', body);
      if (!res?.ok) {
        Modal.error({ title: '部署失败', content: res?.message || '未知错误' });
        return;
      }
      Modal.success({
        title: '已提交',
        content: `已提交部署：${choice.label}`,
      });
      onSuccess();
      onClose();
      form.resetFields();
    } catch {
      /* validation */
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      title={`部署操作系统 — ${systemId}`}
      open={open}
      onCancel={onClose}
      onOk={() => void handleOk()}
      confirmLoading={loading}
      destroyOnClose
      width={520}
    >
      {loadErr ? <Alert type="warning" showIcon message={loadErr} style={{ marginBottom: 12 }} /> : null}
      <Form form={form} layout="vertical">
        <Form.Item
          name="osGroup"
          label="操作系统"
          rules={[{ required: true, message: '请选择操作系统' }]}
        >
          <Select
            placeholder="Ubuntu 22.04 LTS、CentOS 7 …"
            options={groups.map((g) => ({
              value: g.group_id,
              label: g.display_name,
            }))}
            showSearch
            optionFilterProp="label"
            notFoundContent={loadErr ? undefined : '暂无就绪操作系统，请先在「操作系统镜像」页同步'}
          />
        </Form.Item>
        {selectedGroup && selectedGroup.variant_count > 1 ? (
          <Collapse
            ghost
            items={[
              {
                key: 'kernel',
                label: '高级：内核版本',
                children: (
                  <Form.Item name="kernelVariant" label="内核变体" style={{ marginBottom: 0 }}>
                    <Select
                      options={selectedGroup.variants.map((v) => ({
                        value: String(v.resource_id),
                        label: `${v.label}${v.is_default ? '（默认）' : ''} · ${v.architecture}`,
                      }))}
                    />
                  </Form.Item>
                ),
              },
            ]}
          />
        ) : null}
      </Form>
    </Modal>
  );
};

export default MaasDeployModal;
