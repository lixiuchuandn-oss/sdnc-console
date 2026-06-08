import React, { useEffect } from 'react';
import {
  Button,
  Divider,
  Drawer,
  Flex,
  Form,
  Input,
  InputNumber,
  Switch,
  Tooltip,
  Typography,
  message,
} from 'antd';
import type { MetricRuleTableRow } from '../lib/drsMetricRuleUtils';
import {
  DEFAULT_METRIC_RULE_CREATE_VALUES,
  METRIC_CPU_SCORE_DEFAULT,
  METRIC_DISABLED_SAFE_THRESHOLD,
  METRIC_DISABLED_SCORE,
  METRIC_MEMORY_SCORE_DEFAULT,
  METRIC_SAFE_THRESHOLD_DEFAULT,
  METRIC_SAFE_THRESHOLD_MIN,
  METRIC_SCORE_SUM,
  metricRuleCrToFormValues,
  metricRuleFormValuesToSpec,
  normalizeMetricRuleFormValues,
  syncMetricRuleScores,
  validateMetricRuleFormValues,
  type MetricRuleFormValues,
} from '../lib/drsMetricRuleForm';

export type MetricRuleConfigDrawerProps = {
  open: boolean;
  editing?: MetricRuleTableRow | null;
  saving?: boolean;
  onClose: () => void;
  onSubmit: (payload: { name: string; spec: Record<string, unknown> }) => Promise<void>;
};

function isStoredDisabledThreshold(value: unknown): boolean {
  const n = Number(value);
  return n === METRIC_DISABLED_SAFE_THRESHOLD || n === 100;
}

const INLINE_LABEL_WIDTH = 176;
const INLINE_INPUT_WIDTH = 120;
const INLINE_SWITCH_SLOT_WIDTH = 44;

type InlineLabelProps = {
  children: React.ReactNode;
  tooltip?: string;
};

const InlineLabel: React.FC<InlineLabelProps> = ({ children, tooltip }) => {
  const text = (
    <Typography.Text
      style={{
        display: 'block',
        width: INLINE_LABEL_WIDTH,
        flexShrink: 0,
        textAlign: 'left',
        cursor: tooltip ? 'help' : undefined,
      }}
    >
      {children}
    </Typography.Text>
  );
  return tooltip ? <Tooltip title={tooltip}>{text}</Tooltip> : text;
};

type InlineFieldRowProps = {
  label: React.ReactNode;
  tooltip?: string;
  withSwitch?: boolean;
  switchNode?: React.ReactNode;
  /** 无开关时预留开关列，使输入框与安全阈值行纵向对齐 */
  reserveSwitchSlot?: boolean;
  children: React.ReactNode;
  style?: React.CSSProperties;
};

const InlineFieldRow: React.FC<InlineFieldRowProps> = ({
  label,
  tooltip,
  withSwitch,
  switchNode,
  reserveSwitchSlot,
  children,
  style,
}) => (
  <Flex align="center" gap={12} style={{ marginBottom: 12, ...style }}>
    <InlineLabel tooltip={tooltip}>{label}</InlineLabel>
    {withSwitch ? (
      <div style={{ width: INLINE_SWITCH_SLOT_WIDTH, flexShrink: 0 }}>{switchNode}</div>
    ) : reserveSwitchSlot ? (
      <div style={{ width: INLINE_SWITCH_SLOT_WIDTH, flexShrink: 0 }} />
    ) : null}
    <div style={{ width: INLINE_INPUT_WIDTH, flexShrink: 0 }}>{children}</div>
  </Flex>
);

const MetricRuleConfigDrawer: React.FC<MetricRuleConfigDrawerProps> = ({
  open,
  editing,
  saving,
  onClose,
  onSubmit,
}) => {
  const [form] = Form.useForm<MetricRuleFormValues>();
  const isEdit = !!editing && !!metricRuleCrToFormValues(editing).name;
  const cpuEnabled = Form.useWatch('cpuEnabled', form);
  const memoryEnabled = Form.useWatch('memoryEnabled', form);
  const bothMetricsEnabled = !!cpuEnabled && !!memoryEnabled;

  const applyEnableState = (nextCpu: boolean, nextMemory: boolean) => {
    const patch: Partial<MetricRuleFormValues> = {
      cpuEnabled: nextCpu,
      memoryEnabled: nextMemory,
    };

    if (!nextCpu) {
      patch.cpuSafeThreshold = METRIC_DISABLED_SAFE_THRESHOLD;
      patch.cpuScore = METRIC_DISABLED_SCORE;
    } else if (
      form.getFieldValue('cpuSafeThreshold') == null ||
      isStoredDisabledThreshold(form.getFieldValue('cpuSafeThreshold'))
    ) {
      patch.cpuSafeThreshold = METRIC_SAFE_THRESHOLD_DEFAULT;
    }

    if (!nextMemory) {
      patch.memorySafeThreshold = METRIC_DISABLED_SAFE_THRESHOLD;
      patch.memoryScore = METRIC_DISABLED_SCORE;
    } else if (
      form.getFieldValue('memorySafeThreshold') == null ||
      isStoredDisabledThreshold(form.getFieldValue('memorySafeThreshold'))
    ) {
      patch.memorySafeThreshold = METRIC_SAFE_THRESHOLD_DEFAULT;
    }

    const scores = syncMetricRuleScores(nextCpu, nextMemory, {
      cpuScore: nextCpu
        ? nextMemory
          ? form.getFieldValue('cpuScore') ?? METRIC_CPU_SCORE_DEFAULT
          : METRIC_SCORE_SUM
        : METRIC_DISABLED_SCORE,
      memoryScore: nextMemory
        ? nextCpu
          ? form.getFieldValue('memoryScore') ?? METRIC_MEMORY_SCORE_DEFAULT
          : METRIC_SCORE_SUM
        : METRIC_DISABLED_SCORE,
    });
    form.setFieldsValue({ ...patch, ...scores });
  };

  useEffect(() => {
    if (!open) return;
    if (editing) {
      form.setFieldsValue(metricRuleCrToFormValues(editing));
    } else {
      form.resetFields();
      form.setFieldsValue(DEFAULT_METRIC_RULE_CREATE_VALUES);
    }
  }, [editing, form, open]);

  const handleFinish = async (values: MetricRuleFormValues) => {
    const normalized = normalizeMetricRuleFormValues(values);
    const err = validateMetricRuleFormValues(normalized);
    if (err) {
      message.error(err);
      return;
    }
    const name = String(normalized.name || '').trim();
    try {
      await onSubmit({
        name,
        spec: metricRuleFormValuesToSpec(normalized) as unknown as Record<string, unknown>,
      });
    } catch (e) {
      message.error(e instanceof Error ? e.message : '保存失败');
    }
  };

  return (
    <Drawer
      title={isEdit ? '编辑调度规则' : '创建调度规则'}
      width={560}
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
      <Form form={form} layout="vertical" disabled={saving} onFinish={(v) => void handleFinish(v)}>
        <Form.Item
          name="name"
          label="规则名称"
          rules={[
            { required: true, message: '请输入规则名称' },
            {
              pattern: /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/,
              message: '须为小写字母、数字、连字符',
            },
          ]}
        >
          <Input disabled={isEdit} placeholder="例如 drs-test" />
        </Form.Item>

        <Divider orientation="left" plain>
          安全阈值
        </Divider>
        <InlineFieldRow
          label="CPU 安全阈值"
          tooltip={`节点 CPU 指标低于该百分比时允许调度；超出后将触发虚拟机迁移；不低于 ${METRIC_SAFE_THRESHOLD_MIN}%`}
          withSwitch
          switchNode={
            <Form.Item name="cpuEnabled" valuePropName="checked" noStyle>
              <Switch
                onChange={(checked) => {
                  if (!checked && !memoryEnabled) {
                    message.warning('请至少启用 CPU 或内存其中一种调度条件');
                    form.setFieldValue('cpuEnabled', true);
                    return;
                  }
                  applyEnableState(checked, !!memoryEnabled);
                }}
              />
            </Form.Item>
          }
        >
          {cpuEnabled ? (
            <Form.Item
              name="cpuSafeThreshold"
              noStyle
              rules={[{ required: true, message: '请输入 CPU 安全阈值' }]}
            >
              <InputNumber
                min={METRIC_SAFE_THRESHOLD_MIN}
                max={100}
                precision={0}
                style={{ width: '100%' }}
                addonAfter="%"
              />
            </Form.Item>
          ) : null}
        </InlineFieldRow>

        <InlineFieldRow
          label="内存 安全阈值"
          tooltip={`节点内存指标低于该百分比时允许调度；超出后将触发虚拟机迁移；不低于 ${METRIC_SAFE_THRESHOLD_MIN}%`}
          withSwitch
          switchNode={
            <Form.Item name="memoryEnabled" valuePropName="checked" noStyle>
              <Switch
                onChange={(checked) => {
                  if (!checked && !cpuEnabled) {
                    message.warning('请至少启用 CPU 或内存其中一种调度条件');
                    form.setFieldValue('memoryEnabled', true);
                    return;
                  }
                  applyEnableState(!!cpuEnabled, checked);
                }}
              />
            </Form.Item>
          }
          style={{ marginBottom: 16 }}
        >
          {memoryEnabled ? (
            <Form.Item
              name="memorySafeThreshold"
              noStyle
              rules={[{ required: true, message: '请输入内存 安全阈值' }]}
            >
              <InputNumber
                min={METRIC_SAFE_THRESHOLD_MIN}
                max={100}
                precision={0}
                style={{ width: '100%' }}
                addonAfter="%"
              />
            </Form.Item>
          ) : null}
        </InlineFieldRow>

        <Divider orientation="left" plain>
          目的节点健康状态计算比例
        </Divider>
        <Typography.Paragraph type="secondary" style={{ marginTop: -8, marginBottom: 12, fontSize: 12 }}>
          两项同开时 CPU 与内存比例之和须为 {METRIC_SCORE_SUM}；仅开一项时该项为 {METRIC_SCORE_SUM}，另一项为{' '}
          {METRIC_DISABLED_SCORE}。
        </Typography.Paragraph>
        <InlineFieldRow label="CPU 占用比例" reserveSwitchSlot>
          <Form.Item
            name="cpuScore"
            noStyle
            rules={[{ required: true, message: '请输入 CPU 占用比例' }]}
          >
            <InputNumber
              min={METRIC_DISABLED_SCORE}
              max={bothMetricsEnabled ? METRIC_SCORE_SUM - 1 : METRIC_SCORE_SUM}
              precision={0}
              style={{ width: '100%' }}
              disabled={!cpuEnabled || !bothMetricsEnabled}
              onChange={(value) => {
                if (!bothMetricsEnabled) return;
                const cpuScore = Number(value);
                if (!Number.isFinite(cpuScore)) return;
                form.setFieldValue('memoryScore', METRIC_SCORE_SUM - cpuScore);
              }}
            />
          </Form.Item>
        </InlineFieldRow>
        <InlineFieldRow label="内存 占用比例" reserveSwitchSlot style={{ marginBottom: 16 }}>
          <Form.Item
            name="memoryScore"
            noStyle
            rules={[{ required: true, message: '请输入内存 占用比例' }]}
          >
            <InputNumber
              min={METRIC_DISABLED_SCORE}
              max={bothMetricsEnabled ? METRIC_SCORE_SUM - 1 : METRIC_SCORE_SUM}
              precision={0}
              style={{ width: '100%' }}
              disabled={!memoryEnabled || !bothMetricsEnabled}
              onChange={(value) => {
                if (!bothMetricsEnabled) return;
                const memoryScore = Number(value);
                if (!Number.isFinite(memoryScore)) return;
                form.setFieldValue('cpuScore', METRIC_SCORE_SUM - memoryScore);
              }}
            />
          </Form.Item>
        </InlineFieldRow>

        <Divider orientation="left" plain style={{ marginTop: 24 }}>
          迁移控制
        </Divider>
        <InlineFieldRow
          label="统计时间范围（小时）"
          tooltip="统计该时间范围内的迁移次数"
          reserveSwitchSlot
        >
          <Form.Item
            name="maxMigratePeriod"
            noStyle
            rules={[{ required: true, message: '请输入统计时间范围' }]}
          >
            <InputNumber min={1} precision={0} style={{ width: '100%' }} addonAfter="小时" />
          </Form.Item>
        </InlineFieldRow>
        <InlineFieldRow label="最大迁移 VM 数" reserveSwitchSlot>
          <Form.Item
            name="migrateMaxCount"
            noStyle
            rules={[{ required: true, message: '请输入最大迁移数' }]}
          >
            <InputNumber min={1} precision={0} style={{ width: '100%' }} />
          </Form.Item>
        </InlineFieldRow>
        <InlineFieldRow label="并发迁移数" reserveSwitchSlot>
          <Form.Item
            name="migrateConcurrentNum"
            noStyle
            rules={[{ required: true, message: '请输入并发迁移数' }]}
          >
            <InputNumber min={1} precision={0} style={{ width: '100%' }} />
          </Form.Item>
        </InlineFieldRow>
        <InlineFieldRow
          label="目标 TopN 随机"
          tooltip="从负载最低的前 N 个节点中随机选择目标，避免热点"
          reserveSwitchSlot
          style={{ marginBottom: 16 }}
        >
          <Form.Item
            name="randTopN"
            noStyle
            rules={[{ required: true, message: '请输入 TopN' }]}
          >
            <InputNumber min={1} precision={0} style={{ width: '100%' }} />
          </Form.Item>
        </InlineFieldRow>

        <Typography.Paragraph type="secondary" style={{ marginBottom: 0, fontSize: 12 }}>
          CPU 与内存条件为或关系：任一指标超出安全阈值且满足占用比例时，均可触发 DRS 迁移。
        </Typography.Paragraph>
      </Form>
    </Drawer>
  );
};

export default MetricRuleConfigDrawer;
