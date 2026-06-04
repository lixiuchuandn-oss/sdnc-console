import React, { useEffect } from 'react';
import { Button, Form, Input, InputNumber, Modal, Select, Space } from 'antd';
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
  schedulingPolicy: DeploymentSetSchedulingPolicy;
  schedulingStrength: 'preferred' | 'required';
  topologyKey: string;
  labelPairs?: Array<{ key: string; value?: string }>;
};

type Props = {
  open: boolean;
  editing: DeploymentSetRow | null;
  namespaceOptions: { value: string; label: string }[];
  onClose: () => void;
  onSubmit: (values: DeploymentSetFormValues & { labels: Record<string, string> }) => Promise<void>;
  saving: boolean;
};

const DeploymentSetFormModal: React.FC<Props> = ({
  open,
  editing,
  namespaceOptions,
  onClose,
  onSubmit,
  saving,
}) => {
  const [form] = Form.useForm<DeploymentSetFormValues>();
  const schedulingPolicy = Form.useWatch('schedulingPolicy', form);

  useEffect(() => {
    if (!open) return;
    if (editing) {
      form.setFieldsValue({
        name: editing.name,
        namespace: editing.namespace || undefined,
        description: editing.description,
        sortOrder: editing.sortOrder,
        schedulingPolicy: editing.schedulingPolicy || 'none',
        schedulingStrength: editing.schedulingStrength || 'preferred',
        topologyKey: editing.topologyKey || DEFAULT_DEPLOYMENT_SET_TOPOLOGY_KEY,
        labelPairs: labelsRecordToFormList(editing.labels),
      });
    } else {
      form.resetFields();
      form.setFieldsValue({
        labelPairs: [],
        schedulingPolicy: 'none',
        schedulingStrength: 'preferred',
        topologyKey: DEFAULT_DEPLOYMENT_SET_TOPOLOGY_KEY,
      });
    }
  }, [open, editing, form]);

  return (
    <Modal
      title={editing ? '编辑部署集' : '创建部署集'}
      open={open}
      onCancel={onClose}
      confirmLoading={saving}
      destroyOnClose
      width={560}
      onOk={() => {
        void form
          .validateFields()
          .then((values) => {
            const labels = labelsFormListToRecord(values.labelPairs);
            const schedulingPolicy = values.schedulingPolicy || 'none';
            return onSubmit({
              ...values,
              labels,
              schedulingPolicy,
              schedulingStrength:
                schedulingPolicy === 'none' ? 'preferred' : values.schedulingStrength || 'preferred',
              topologyKey:
                schedulingPolicy === 'none'
                  ? DEFAULT_DEPLOYMENT_SET_TOPOLOGY_KEY
                  : values.topologyKey || DEFAULT_DEPLOYMENT_SET_TOPOLOGY_KEY,
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
          <Select
            allowClear
            showSearch
            placeholder="不限定项目（可选）"
            options={namespaceOptions}
            optionFilterProp="label"
          />
        </Form.Item>
        <Form.Item name="schedulingPolicy" label="调度策略">
          <Select options={DEPLOYMENT_SET_SCHEDULING_POLICY_OPTIONS} />
        </Form.Item>
        {schedulingPolicy && schedulingPolicy !== 'none' ? (
          <>
            <Form.Item name="schedulingStrength" label="约束强度">
              <Select options={DEPLOYMENT_SET_SCHEDULING_STRENGTH_OPTIONS} />
            </Form.Item>
            <Form.Item name="topologyKey" label="拓扑域">
              <Select options={DEPLOYMENT_SET_TOPOLOGY_KEY_OPTIONS} />
            </Form.Item>
          </>
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
