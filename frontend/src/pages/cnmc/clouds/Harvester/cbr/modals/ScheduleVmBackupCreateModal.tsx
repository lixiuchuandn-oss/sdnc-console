/**
 * Harvester - 创建定时备份/快照策略弹窗
 */
import React, { useState, useEffect, useMemo } from 'react';
import { Modal, Form, Input, InputNumber, Switch, Select, message, Alert, Radio, Row, Col } from 'antd';
import { fetchCloudProviderEcs } from '../../../../../../services/api';
import { createHarvesterScheduleVmBackup } from 'services/harvester/cbr';
import { fetchHarvesterNamespaces } from '../../../../../../services/harvesterApi';
import { formatCron } from '../../../../../../utils/cronFormatter';
import {
  buildScheduleCronExpression,
  filterNamespacesForScheduleCreate,
  filterVmsForScheduleCreate,
  parseScheduleVmBackupCreateErrorMessage,
  SCHEDULE_CRON_HOUR_OPTIONS,
  SCHEDULE_CRON_MINUTE_OPTIONS,
  SCHEDULE_CRON_WEEKDAY_OPTIONS,
  type ScheduleCronMode,
  type ScheduleUiCron,
} from '../lib/scheduleVmBackupCreateModalUtils';

interface Props {
  open: boolean;
  onCancel: () => void;
  onSuccess: (created?: {
    namespace: string;
    alias: string;
    vmName: string;
    type: 'backup' | 'snapshot';
    cron: string;
    retain: number;
    maxFailure: number;
    suspend: boolean;
    resourceName?: string;
  }) => void;
  cloudId: string;
  initialNamespace?: string;
  initialVmName?: string;
}

const ScheduleVmBackupCreateModal: React.FC<Props> = ({
  open,
  onCancel,
  onSuccess,
  cloudId,
  initialNamespace,
  initialVmName,
}) => {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [namespaces, setNamespaces] = useState<any[]>([]);
  const [vms, setVms] = useState<any[]>([]);
  const [cronMode, setCronMode] = useState<ScheduleCronMode>('daily');
  const [uiCron, setUiCron] = useState<ScheduleUiCron>({ hour: 2, minute: 0, weekDay: 0 });

  const cronValue = Form.useWatch('cron', form);
  const selectedNamespace = Form.useWatch('namespace', form);

  useEffect(() => {
    if (open && cloudId) {
      loadData();
      form.resetFields();

      const randomMinute = Math.floor(Math.random() * 60);
      setCronMode('daily');
      setUiCron({ hour: 2, minute: randomMinute, weekDay: 0 });

      form.setFieldsValue({
        type: 'backup',
        retain: 10,
        maxFailure: 5,
        suspend: false,
        cron: `${randomMinute} 2 * * *`,
        ...(initialNamespace && { namespace: initialNamespace }),
        ...(initialVmName && { vmName: initialVmName }),
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- open/cloudId/initial* 触发初始化
  }, [open, cloudId, initialNamespace, initialVmName]);

  useEffect(() => {
    if (!open) return;
    const nextCron = buildScheduleCronExpression(cronMode, uiCron);
    if (nextCron == null || cronValue === nextCron) return;
    form.setFieldValue('cron', nextCron);
  }, [cronMode, uiCron, open, cronValue, form]);

  const loadData = async () => {
    try {
      const [nsRes, vmRes] = await Promise.all([
        fetchHarvesterNamespaces(cloudId, false, true).catch(() => ({ data: { items: [] } })),
        fetchCloudProviderEcs(cloudId).catch(() => ({ data: [] })),
      ]);

      const nsItems = nsRes?.data?.items || nsRes?.items || [];
      setNamespaces(nsItems);

      const vmItems = Array.isArray(vmRes?.data) ? vmRes.data : vmRes || [];
      setVms(vmItems);

      if (initialVmName && vmItems.length > 0) {
        const targetVm = vmItems.find(
          (vm: any) => vm.name === initialVmName || vm.metadata?.name === initialVmName,
        );
        const vmNamespace = targetVm?.namespace || targetVm?.metadata?.namespace;
        if (vmNamespace) {
          form.setFieldValue('namespace', vmNamespace);
          return;
        }
      }

      if (nsItems.length > 0) {
        form.setFieldValue('namespace', nsItems[0].metadata?.name || nsItems[0].name);
      }
    } catch (e) {
      console.error(e);
      message.error('加载资源失败');
    }
  };

  const filteredNamespaces = useMemo(
    () => filterNamespacesForScheduleCreate(namespaces, vms, initialVmName),
    [namespaces, vms, initialVmName],
  );

  const filteredVms = useMemo(
    () => filterVmsForScheduleCreate(vms, selectedNamespace, initialVmName),
    [vms, selectedNamespace, initialVmName],
  );

  const handleOk = async () => {
    try {
      const values = await form.validateFields();
      setLoading(true);
      const result = await createHarvesterScheduleVmBackup(cloudId, values);
      message.success('创建成功');
      const resultData = (result as any)?.data ?? result;
      onSuccess({
        namespace: values.namespace,
        alias: values.name,
        vmName: values.vmName,
        type: values.type,
        cron: values.cron,
        retain: values.retain,
        maxFailure: values.maxFailure,
        suspend: values.suspend,
        resourceName: resultData?.metadata?.name || '',
      });
    } catch (e: any) {
      message.error(
        parseScheduleVmBackupCreateErrorMessage(e.message || '创建失败', {
          namespace: form.getFieldValue('namespace'),
          vmName: form.getFieldValue('vmName'),
          vms,
        }),
      );
    } finally {
      setLoading(false);
    }
  };

  const cronPreview = useMemo(() => (cronValue ? formatCron(cronValue) : null), [cronValue]);

  return (
    <Modal
      title="创建定时策略"
      open={open}
      onOk={handleOk}
      onCancel={onCancel}
      confirmLoading={loading}
      okText="创建"
      cancelText="取消"
      width={600}
    >
      <Form form={form} layout="vertical">
        <Form.Item
          name="name"
          label="名称 (别名)"
          rules={[{ required: true, message: '请输入策略名称' }]}
        >
          <Input placeholder="请输入名称" />
        </Form.Item>

        <Form.Item name="type" label="策略类型" rules={[{ required: true }]}>
          <Radio.Group buttonStyle="solid">
            <Radio.Button value="backup">备份</Radio.Button>
            <Radio.Button value="snapshot">快照</Radio.Button>
          </Radio.Group>
        </Form.Item>

        <Form.Item name="namespace" label="项目" rules={[{ required: true, message: '请选择项目' }]}>
          <Select
            placeholder="请选择项目"
            options={filteredNamespaces.map((n: any) => ({
              label: n.metadata?.name || n.name,
              value: n.metadata?.name || n.name,
            }))}
            onChange={() => form.setFieldValue('vmName', undefined)}
            showSearch
          />
        </Form.Item>
        <Form.Item
          name="vmName"
          label="源虚拟机"
          rules={[{ required: true }]}
          help={!selectedNamespace ? '请先选择项目' : undefined}
        >
          <Select
            placeholder="请选择虚拟机"
            options={filteredVms.map((v: any) => {
              const alias = v?.metadata?.annotations?.['tower.io/alias'] || v?.alias || v?.name;
              const name = v?.name || v?.metadata?.name;
              return { label: alias || name, value: name };
            })}
            disabled={!selectedNamespace}
            showSearch
          />
        </Form.Item>

        <Form.Item label="备份频率" required style={{ marginBottom: 10 }}>
          <Radio.Group
            value={cronMode}
            onChange={(e) => setCronMode(e.target.value)}
            buttonStyle="solid"
          >
            <Radio.Button value="daily">每天</Radio.Button>
            <Radio.Button value="weekly">每周</Radio.Button>
            <Radio.Button value="custom">自定义 (Cron)</Radio.Button>
          </Radio.Group>
        </Form.Item>

        {cronMode !== 'custom' && (
          <div style={{ background: '#f5f5f5', padding: '12px 16px', borderRadius: 4, marginBottom: 24 }}>
            <Row gutter={16}>
              {cronMode === 'weekly' && (
                <Col span={8}>
                  <div style={{ marginBottom: 4, fontSize: 12, color: '#666' }}>重复周期</div>
                  <Select
                    value={uiCron.weekDay}
                    onChange={(v) => setUiCron((prev) => ({ ...prev, weekDay: v }))}
                    options={SCHEDULE_CRON_WEEKDAY_OPTIONS}
                    style={{ width: '100%' }}
                  />
                </Col>
              )}
              <Col span={8}>
                <div style={{ marginBottom: 4, fontSize: 12, color: '#666' }}>小时</div>
                <Select
                  value={uiCron.hour}
                  onChange={(v) => setUiCron((prev) => ({ ...prev, hour: v }))}
                  options={SCHEDULE_CRON_HOUR_OPTIONS}
                  style={{ width: '100%' }}
                />
              </Col>
              <Col span={8}>
                <div style={{ marginBottom: 4, fontSize: 12, color: '#666' }}>分钟</div>
                <Select
                  value={uiCron.minute}
                  onChange={(v) => setUiCron((prev) => ({ ...prev, minute: v }))}
                  options={SCHEDULE_CRON_MINUTE_OPTIONS}
                  style={{ width: '100%' }}
                />
              </Col>
            </Row>
          </div>
        )}

        <Form.Item
          name="cron"
          label={cronMode === 'custom' ? 'Cron 表达式' : undefined}
          rules={[{ required: true }]}
          style={cronMode !== 'custom' ? { display: 'none' } : undefined}
        >
          <Input placeholder="例如: 0 2 * * *" />
        </Form.Item>

        {cronValue && (
          <Alert message={cronPreview} type="info" style={{ marginBottom: 24, marginTop: -12 }} />
        )}
        <div style={{ display: 'flex', gap: 16 }}>
          <Form.Item name="retain" label="保留数量" rules={[{ required: true }]} style={{ flex: 1 }}>
            <InputNumber min={1} max={100} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item
            name="maxFailure"
            label="最大失败次数"
            rules={[
              { required: true },
              ({ getFieldValue }) => ({
                validator(_, value) {
                  if (!value || value < getFieldValue('retain')) {
                    return Promise.resolve();
                  }
                  return Promise.reject(new Error('最大失败次数必须小于保留数量'));
                },
              }),
            ]}
            style={{ flex: 1 }}
          >
            <InputNumber min={1} max={100} style={{ width: '100%' }} />
          </Form.Item>
        </div>
        <Form.Item name="suspend" label="暂停状态" valuePropName="checked">
          <Switch />
        </Form.Item>
      </Form>
    </Modal>
  );
};

export default ScheduleVmBackupCreateModal;
