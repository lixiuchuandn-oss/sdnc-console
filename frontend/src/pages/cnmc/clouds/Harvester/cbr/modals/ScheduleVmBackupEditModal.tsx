/**
 * Harvester - 编辑定时备份/快照策略弹窗
 */
import React, { useState, useEffect, useMemo } from 'react';
import { Modal, Form, Input, InputNumber, Switch, Select, message, Alert, Radio, Row, Col } from 'antd';
import { updateHarvesterScheduleVmBackup } from 'services/harvester/cbr';
import { formatCron } from '../../../../../../utils/cronFormatter';
import {
  buildScheduleEditFormValues,
  buildScheduleEditInitialUiState,
  buildScheduleEditUpdatePayload,
  resolveScheduleEditTargetIds,
  syncScheduleEditCronField,
} from '../lib/scheduleVmBackupEditModalUtils';
import {
  SCHEDULE_CRON_HOUR_OPTIONS,
  SCHEDULE_CRON_MINUTE_OPTIONS,
  SCHEDULE_CRON_WEEKDAY_OPTIONS,
  type ScheduleCronMode,
  type ScheduleUiCron,
} from '../lib/scheduleVmBackupCreateModalUtils';

interface Props {
  open: boolean;
  onCancel: () => void;
  onSuccess: () => void;
  cloudId: string;
  record: any;
  vms?: any[];
}

const ScheduleVmBackupEditModal: React.FC<Props> = ({
  open,
  onCancel,
  onSuccess,
  cloudId,
  record,
  vms,
}) => {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [cronMode, setCronMode] = useState<ScheduleCronMode>('daily');
  const [uiCron, setUiCron] = useState<ScheduleUiCron>({ hour: 2, minute: 0, weekDay: 0 });

  const cronValue = Form.useWatch('cron', form);

  useEffect(() => {
    if (open && record) {
      const { cronMode: initialMode, uiCron: initialUi } = buildScheduleEditInitialUiState(record);
      setCronMode(initialMode);
      setUiCron(initialUi);
      form.setFieldsValue(buildScheduleEditFormValues(record, vms));
    }
  }, [open, record, form, vms]);

  useEffect(() => {
    if (!open) return;
    const nextCron = syncScheduleEditCronField(cronMode, uiCron, cronValue);
    if (nextCron != null) {
      form.setFieldValue('cron', nextCron);
    }
  }, [cronMode, uiCron, open, cronValue, form]);

  const handleOk = async () => {
    try {
      const values = await form.validateFields();
      setLoading(true);
      const { namespace, id } = resolveScheduleEditTargetIds(record);
      await updateHarvesterScheduleVmBackup(
        cloudId,
        namespace,
        id,
        buildScheduleEditUpdatePayload(values),
      );
      message.success('更新策略成功');
      onSuccess();
    } catch (e: any) {
      message.error(`更新失败: ${e.message}`);
    } finally {
      setLoading(false);
    }
  };

  const cronPreview = useMemo(() => (cronValue ? formatCron(cronValue) : null), [cronValue]);

  return (
    <Modal
      title="修改定时备份策略"
      open={open}
      onOk={handleOk}
      onCancel={onCancel}
      confirmLoading={loading}
      width={600}
    >
      <Form form={form} layout="vertical">
        <Row gutter={16}>
          <Col span={12}>
            <Form.Item name="namespace" label="项目">
              <Input disabled />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item name="vmName" label="源虚拟机">
              <Input disabled />
            </Form.Item>
          </Col>
        </Row>

        <Form.Item name="alias" label="策略名称 (别名)" extra="修改别名不会影响资源 ID">
          <Input placeholder="请输入名称" />
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

export default ScheduleVmBackupEditModal;
