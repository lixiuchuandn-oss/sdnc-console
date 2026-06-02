import React, { useEffect } from 'react';
import { Alert, Button, Drawer, Flex, Form, Input, InputNumber, Select } from 'antd';
import type { MetricRuleTableRow } from '../lib/drsMetricRuleUtils';
import {
  METRIC_RULE_TYPE_OPTIONS,
  metricRuleCrToFormValues,
  metricRuleFormValuesToSpec,
  type MetricRuleFormValues,
} from '../lib/drsMetricRuleForm';

export type MetricRuleConfigDrawerProps = {
  open: boolean;
  editing?: MetricRuleTableRow | null;
  saving?: boolean;
  onClose: () => void;
  onSubmit: (payload: { name: string; spec: Record<string, unknown> }) => Promise<void>;
};

const MetricRuleConfigDrawer: React.FC<MetricRuleConfigDrawerProps> = ({
  open,
  editing,
  saving,
  onClose,
  onSubmit,
}) => {
  const [form] = Form.useForm<MetricRuleFormValues>();
  const isEdit = !!editing && !!metricRuleCrToFormValues(editing).name;

  useEffect(() => {
    if (!open) return;
    if (editing) {
      form.setFieldsValue(metricRuleCrToFormValues(editing));
    } else {
      form.resetFields();
      form.setFieldsValue({
        metricType: 'cpu',
        metricSafeThreshold: 80,
        migrateConcurrentNum: 1,
        migrateMaxCount: 2,
        randTopN: 3,
      });
    }
  }, [editing, form, open]);

  const handleFinish = async (values: MetricRuleFormValues) => {
    const name = String(values.name || '').trim();
    await onSubmit({
      name,
      spec: metricRuleFormValuesToSpec(values) as unknown as Record<string, unknown>,
    });
  };

  return (
    <Drawer
      title={isEdit ? '编辑调度规则' : '创建调度规则'}
      width={520}
      open={open}
      onClose={onClose}
      destroyOnClose
      footer={
        <Flex justify="flex-end" gap="small">
          <Button onClick={onClose}>取消</Button>
          <Button type="primary" loading={saving} onClick={() => form.submit()}>
            {isEdit ? '保存' : '创建'}
          </Button>
        </Flex>
      }
    >
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="集群级 MetricRule（hms.rivercloud.com/v1）"
        description="指标低于安全阈值时允许调度；超出后将触发 DRS 迁移（由集群 HMS 消费）。"
      />
      <Form form={form} layout="vertical" disabled={saving} onFinish={(v) => void handleFinish(v)}>
        <Form.Item
          name="name"
          label="规则名称"
          rules={[
            { required: true, message: '请输入规则名称' },
            {
              pattern: /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/,
              message: '须为小写字母、数字、连字符（DNS 子域名格式）',
            },
          ]}
        >
          <Input disabled={isEdit} placeholder="例如 drs-cpu-80" />
        </Form.Item>
        <Form.Item
          name="metricType"
          label="指标类型"
          rules={[{ required: true, message: '请选择指标类型' }]}
        >
          <Select options={METRIC_RULE_TYPE_OPTIONS} />
        </Form.Item>
        <Form.Item
          name="metricSafeThreshold"
          label="安全阈值（%）"
          tooltip="节点指标低于该百分比时允许调度"
          rules={[{ required: true, message: '请输入安全阈值' }]}
        >
          <InputNumber min={0} max={100} precision={0} style={{ width: '100%' }} addonAfter="%" />
        </Form.Item>
        <Form.Item
          name="migrateMaxCount"
          label="最大迁移 VM 数"
          rules={[{ required: true, message: '请输入最大迁移数' }]}
        >
          <InputNumber min={1} precision={0} style={{ width: '100%' }} />
        </Form.Item>
        <Form.Item
          name="migrateConcurrentNum"
          label="并发迁移数"
          rules={[{ required: true, message: '请输入并发迁移数' }]}
        >
          <InputNumber min={1} precision={0} style={{ width: '100%' }} />
        </Form.Item>
        <Form.Item
          name="randTopN"
          label="目标 TopN 随机"
          tooltip="从负载最低的前 N 个节点中随机选择目标，避免热点"
          rules={[{ required: true, message: '请输入 TopN' }]}
        >
          <InputNumber min={1} precision={0} style={{ width: '100%' }} />
        </Form.Item>
      </Form>
    </Drawer>
  );
};

export default MetricRuleConfigDrawer;
