import React, { useEffect, useMemo } from 'react';
import { Alert, Button, Collapse, Form, Input, InputNumber, Modal, Select, Space } from 'antd';
import { MinusCircleOutlined, PlusOutlined } from '@ant-design/icons';
import type { DeploymentSetRow } from 'services/harvester/deploymentSets';
import {
  DEFAULT_DEPLOYMENT_SET_TOPOLOGY_KEY,
  DEPLOYMENT_SET_SCHEDULING_POLICY_OPTIONS,
  DEPLOYMENT_SET_SCHEDULING_STRENGTH_OPTIONS,
  DEPLOYMENT_SET_TOPOLOGY_KEY_OPTIONS,
  type DeploymentSetSchedulingPolicy,
} from 'services/harvester/deploymentSetScheduling';
import {
  DEPLOYMENT_SET_PLACEMENT_PRESET_OPTIONS,
  getDeploymentSetCapacityWarning,
  getDeploymentSetPlacementPresetHint,
  inferPlacementPresetFromScheduling,
  resolvePlacementPresetToScheduling,
  type DeploymentSetCapacityContext,
  type DeploymentSetPlacementPreset,
} from 'services/harvester/deploymentSetPlacement';
import {
  DEPLOYMENT_SET_NAME_MAX_LENGTH,
  labelsFormListToRecord,
  labelsRecordToFormList,
  validateDeploymentSetNameField,
} from '../lib/deploymentSetsSectionUtils';

export type DeploymentSetFormValues = {
  name: string;
  namespace?: string;
  description?: string;
  sortOrder?: number;
  placementPreset: DeploymentSetPlacementPreset;
  schedulingPolicy: DeploymentSetSchedulingPolicy;
  schedulingStrength: 'preferred' | 'required';
  topologyKey: string;
  labelPairs?: Array<{ key: string; value?: string }>;
};

type Props = {
  open: boolean;
  editing: DeploymentSetRow | null;
  namespaceOptions: { value: string; label: string }[];
  capacityContext?: DeploymentSetCapacityContext;
  /** 锁定项目（不可修改），如租户 VM 向导内快速创建 */
  lockedNamespace?: string;
  onClose: () => void;
  onSubmit: (values: DeploymentSetFormValues & { labels: Record<string, string> }) => Promise<void>;
  saving: boolean;
};

const DeploymentSetFormModal: React.FC<Props> = ({
  open,
  editing,
  namespaceOptions,
  capacityContext,
  lockedNamespace,
  onClose,
  onSubmit,
  saving,
}) => {
  const [form] = Form.useForm<DeploymentSetFormValues>();
  const placementPreset = Form.useWatch('placementPreset', form);
  const schedulingPolicy = Form.useWatch('schedulingPolicy', form);
  const schedulingStrength = Form.useWatch('schedulingStrength', form);
  const topologyKey = Form.useWatch('topologyKey', form);

  useEffect(() => {
    if (!open) return;
    if (editing) {
      const preset = inferPlacementPresetFromScheduling(editing);
      form.setFieldsValue({
        name: editing.name,
        namespace: editing.namespace || undefined,
        description: editing.description,
        sortOrder: editing.sortOrder,
        placementPreset: preset,
        schedulingPolicy: editing.schedulingPolicy || 'none',
        schedulingStrength: editing.schedulingStrength || 'preferred',
        topologyKey: editing.topologyKey || DEFAULT_DEPLOYMENT_SET_TOPOLOGY_KEY,
        labelPairs: labelsRecordToFormList(editing.labels),
      });
    } else {
      form.resetFields();
      form.setFieldsValue({
        labelPairs: [],
        placementPreset: 'none',
        schedulingPolicy: 'none',
        schedulingStrength: 'preferred',
        topologyKey: DEFAULT_DEPLOYMENT_SET_TOPOLOGY_KEY,
        namespace: lockedNamespace || undefined,
      });
    }
  }, [open, editing, form, lockedNamespace]);

  const presetHint = useMemo(
    () => getDeploymentSetPlacementPresetHint(placementPreset),
    [placementPreset],
  );

  const capacityWarning = useMemo(() => {
    if (!capacityContext) return null;
    const preset = placementPreset || 'none';
    const scheduling =
      preset === 'custom'
        ? {
            schedulingPolicy: schedulingPolicy || 'none',
            schedulingStrength: schedulingStrength || 'preferred',
            topologyKey: topologyKey || DEFAULT_DEPLOYMENT_SET_TOPOLOGY_KEY,
          }
        : resolvePlacementPresetToScheduling(preset);
    return getDeploymentSetCapacityWarning(editing?.vmCount ?? 0, scheduling, capacityContext);
  }, [
    capacityContext,
    placementPreset,
    schedulingPolicy,
    schedulingStrength,
    topologyKey,
    editing?.vmCount,
  ]);

  const placementOptions = useMemo(
    () => [
      ...DEPLOYMENT_SET_PLACEMENT_PRESET_OPTIONS.map((o) => ({
        value: o.value,
        label: o.label,
      })),
      { value: 'custom' as const, label: '自定义（高级）' },
    ],
    [],
  );

  return (
    <Modal
      title={editing ? '编辑部署集' : '创建部署集'}
      open={open}
      onCancel={onClose}
      confirmLoading={saving}
      destroyOnClose
      width={600}
      onOk={() => {
        void form
          .validateFields()
          .then((values) => {
            const labels = labelsFormListToRecord(values.labelPairs);
            const preset = values.placementPreset || 'none';
            const resolved = resolvePlacementPresetToScheduling(preset, {
              schedulingPolicy: values.schedulingPolicy,
              schedulingStrength: values.schedulingStrength,
              topologyKey: values.topologyKey,
            });
            return onSubmit({
              ...values,
              labels,
              schedulingPolicy: resolved.schedulingPolicy,
              schedulingStrength: resolved.schedulingStrength,
              topologyKey: resolved.topologyKey,
            });
          })
          .catch(() => undefined);
      }}
    >
      <Form form={form} layout="vertical">
        <Form.Item
          name="name"
          label="名称"
          rules={[{ required: true, message: '请输入部署集名称' }, { validator: validateDeploymentSetNameField }]}
        >
          <Input placeholder="如 web-tier、db-set-a" maxLength={DEPLOYMENT_SET_NAME_MAX_LENGTH} />
        </Form.Item>
        <Form.Item name="namespace" label="项目">
          {lockedNamespace ? (
            <Input disabled />
          ) : (
            <Select
              allowClear
              showSearch
              placeholder="不限定项目（可选）"
              options={namespaceOptions}
              optionFilterProp="label"
            />
          )}
        </Form.Item>
        <Form.Item
          name="placementPreset"
          label="置放策略"
          extra="控制同部署集虚拟机之间是尽量分散还是聚集，以及按物理机、故障域或可用区划分。"
        >
          <Select
            options={placementOptions}
            onChange={(value: DeploymentSetPlacementPreset) => {
              if (value === 'custom') return;
              const resolved = resolvePlacementPresetToScheduling(value);
              form.setFieldsValue({
                schedulingPolicy: resolved.schedulingPolicy,
                schedulingStrength: resolved.schedulingStrength,
                topologyKey: resolved.topologyKey,
              });
            }}
          />
        </Form.Item>
        {presetHint ? (
          <Alert type="info" showIcon message={presetHint} style={{ marginBottom: 16 }} />
        ) : null}
        {capacityWarning ? (
          <Alert type="warning" showIcon message={capacityWarning} style={{ marginBottom: 16 }} />
        ) : null}
        {placementPreset === 'custom' ? (
          <Collapse
            ghost
            defaultActiveKey={['advanced']}
            items={[
              {
                key: 'advanced',
                label: '高级调度参数',
                children: (
                  <>
                    <Form.Item name="schedulingPolicy" label="调度策略">
                      <Select options={DEPLOYMENT_SET_SCHEDULING_POLICY_OPTIONS} />
                    </Form.Item>
                    {schedulingPolicy && schedulingPolicy !== 'none' ? (
                      <>
                        <Form.Item name="schedulingStrength" label="约束强度">
                          <Select options={DEPLOYMENT_SET_SCHEDULING_STRENGTH_OPTIONS} />
                        </Form.Item>
                        <Form.Item
                          name="topologyKey"
                          label="分散/聚集范围"
                          extra="决定「同一组」按什么划分：物理机、故障域、可用区等。"
                        >
                          <Select options={DEPLOYMENT_SET_TOPOLOGY_KEY_OPTIONS} />
                        </Form.Item>
                      </>
                    ) : null}
                  </>
                ),
              },
            ]}
            style={{ marginBottom: 16 }}
          />
        ) : null}
        <Form.Item label="自定义标签">
          <Form.List name="labelPairs">
            {(fields, { add, remove }) => (
              <>
                {fields.map(({ key, name, ...restField }) => (
                  <Space key={key} style={{ display: 'flex', marginBottom: 8 }} align="baseline">
                    <Form.Item
                      {...restField}
                      name={[name, 'key']}
                      rules={[{ required: true, message: '请输入键' }]}
                      style={{ marginBottom: 0, width: 220 }}
                    >
                      <Input placeholder="标签键" />
                    </Form.Item>
                    <Form.Item {...restField} name={[name, 'value']} style={{ marginBottom: 0, width: 220 }}>
                      <Input placeholder="标签值（可选）" />
                    </Form.Item>
                    <MinusCircleOutlined onClick={() => remove(name)} />
                  </Space>
                ))}
                <Button type="dashed" onClick={() => add()} block icon={<PlusOutlined />}>
                  添加标签
                </Button>
              </>
            )}
          </Form.List>
        </Form.Item>
        <Form.Item name="description" label="描述">
          <Input.TextArea rows={2} maxLength={256} />
        </Form.Item>
        <Form.Item name="sortOrder" label="排序">
          <InputNumber min={0} style={{ width: '100%' }} />
        </Form.Item>
      </Form>
    </Modal>
  );
};

export default DeploymentSetFormModal;
