import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Button, Col, Form, Input, Modal, Row, Select, Space, Typography, message } from 'antd';
import {
  createSdrsTask,
  fetchSdrsPools,
  fetchSdrsVmDisks,
  type SdrsMigratableDisk,
  type SdrsPoolSummary,
} from 'services/harvester/storageDrs';

export type StorageDrsMigrateModalProps = {
  open: boolean;
  cloudId: string;
  onClose: () => void;
  onSuccess: () => void;
};

type FormValues = {
  vmNamespace: string;
  vmName: string;
  pvcName: string;
  targetPool: string;
};

const StorageDrsMigrateModal: React.FC<StorageDrsMigrateModalProps> = ({
  open,
  cloudId,
  onClose,
  onSuccess,
}) => {
  const [form] = Form.useForm<FormValues>();
  const [submitting, setSubmitting] = useState(false);
  const [loadingDisks, setLoadingDisks] = useState(false);
  const [disks, setDisks] = useState<SdrsMigratableDisk[]>([]);
  const [pools, setPools] = useState<SdrsPoolSummary[]>([]);
  const [loadError, setLoadError] = useState<string | undefined>();

  const migratableDisks = useMemo(() => disks.filter((d) => d.migratable), [disks]);

  const loadPools = useCallback(async () => {
    try {
      const json = await fetchSdrsPools(cloudId);
      const data = (json as { data?: SdrsPoolSummary[] })?.data ?? [];
      setPools(data);
    } catch {
      setPools([]);
    }
  }, [cloudId]);

  useEffect(() => {
    if (!open) return;
    form.resetFields();
    setDisks([]);
    setLoadError(undefined);
    void loadPools();
  }, [open, form, loadPools]);

  const loadDisks = useCallback(async () => {
    const ns = String(form.getFieldValue('vmNamespace') || '').trim();
    const vmName = String(form.getFieldValue('vmName') || '').trim();
    if (!ns || !vmName) {
      message.warning('请填写命名空间与云主机名称');
      return;
    }
    setLoadingDisks(true);
    setLoadError(undefined);
    setDisks([]);
    form.setFieldsValue({ pvcName: undefined, targetPool: undefined });
    try {
      const json = await fetchSdrsVmDisks(cloudId, ns, vmName);
      const data = (json as { data?: SdrsMigratableDisk[] })?.data ?? [];
      setDisks(data);
      if (data.length === 0) {
        setLoadError('未找到可解析的云盘');
      }
    } catch (e: unknown) {
      const err = e as { message?: string };
      setLoadError(err?.message || '加载云盘失败');
    } finally {
      setLoadingDisks(false);
    }
  }, [cloudId, form]);

  const handleSubmit = useCallback(async () => {
    try {
      const values = await form.validateFields();
      setSubmitting(true);
      await createSdrsTask(cloudId, {
        vmNamespace: values.vmNamespace.trim(),
        vmName: values.vmName.trim(),
        pvcName: values.pvcName,
        targetPool: values.targetPool,
      });
      message.success('迁移任务已创建');
      onSuccess();
      onClose();
    } catch (e: unknown) {
      const err = e as { message?: string; errorFields?: unknown[] };
      if (err?.errorFields) return;
      message.error(err?.message || '创建任务失败');
    } finally {
      setSubmitting(false);
    }
  }, [cloudId, form, onClose, onSuccess]);

  const selectedPvc = Form.useWatch('pvcName', form);
  const selectedDisk = useMemo(
    () => migratableDisks.find((d) => d.pvcName === selectedPvc),
    [migratableDisks, selectedPvc],
  );

  const poolOptions = useMemo(() => {
    const srcPool = selectedDisk?.pool;
    return pools
      .filter((p) => p.name && p.name !== srcPool)
      .map((p) => ({
        value: p.name,
        label: p.usedPercent != null ? `${p.name}（已用 ${p.usedPercent}%）` : p.name,
      }));
  }, [pools, selectedDisk?.pool]);

  const diskHint =
    migratableDisks.length > 0
      ? `已加载 ${migratableDisks.length} 块可迁移云盘`
      : disks.length > 0
        ? '当前云主机暂无可迁移云盘'
        : null;

  return (
    <Modal
      title="手动存储迁移"
      open={open}
      onCancel={onClose}
      onOk={() => void handleSubmit()}
      confirmLoading={submitting}
      okText="创建任务"
      destroyOnClose
      width={560}
    >
      <Alert
        type="info"
        showIcon
        message="填写云主机后查询云盘，再选择目标存储池创建迁移任务。"
        style={{ marginBottom: 16 }}
      />

      <Form form={form} layout="vertical" requiredMark="optional">
        <Row gutter={16}>
          <Col xs={24} sm={12}>
            <Form.Item
              name="vmNamespace"
              label="命名空间"
              rules={[{ required: true, message: '请输入命名空间' }]}
            >
              <Input placeholder="例如 default" onBlur={() => void loadDisks()} />
            </Form.Item>
          </Col>
          <Col xs={24} sm={12}>
            <Form.Item
              name="vmName"
              label="云主机名称"
              rules={[{ required: true, message: '请输入云主机名称' }]}
            >
              <Input placeholder="云主机名称" onBlur={() => void loadDisks()} />
            </Form.Item>
          </Col>
        </Row>

        <Form.Item label="云盘查询" style={{ marginBottom: loadError || disks.some((d) => !d.migratable) ? 12 : 24 }}>
          <Space wrap align="center">
            <Button loading={loadingDisks} onClick={() => void loadDisks()}>
              查询云盘
            </Button>
            {diskHint ? (
              <Typography.Text type="secondary" style={{ fontSize: 13 }}>
                {diskHint}
              </Typography.Text>
            ) : null}
          </Space>
        </Form.Item>

        {loadError ? (
          <Alert type="warning" showIcon message={loadError} style={{ marginBottom: 16 }} />
        ) : null}
        {disks.some((d) => !d.migratable) ? (
          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 16 }}
            message="部分云盘不可迁移（非块存储或未绑定）"
          />
        ) : null}

        <Form.Item
          name="pvcName"
          label="源云盘"
          rules={[{ required: true, message: '请选择源云盘' }]}
          extra={
            selectedDisk
              ? `当前存储池：${selectedDisk.pool}/${selectedDisk.image}`
              : undefined
          }
        >
          <Select
            placeholder="选择要迁移的云盘"
            options={migratableDisks.map((d) => ({
              value: d.pvcName,
              label: `${d.pvcName}（${d.pool}/${d.image}）`,
            }))}
            disabled={migratableDisks.length === 0}
            showSearch
            optionFilterProp="label"
          />
        </Form.Item>

        <Form.Item
          name="targetPool"
          label="目标存储池"
          rules={[{ required: true, message: '请选择目标存储池' }]}
        >
          <Select
            placeholder="选择目标存储池"
            options={poolOptions}
            disabled={!selectedPvc}
            showSearch
            optionFilterProp="label"
          />
        </Form.Item>
      </Form>
    </Modal>
  );
};

export default StorageDrsMigrateModal;
