import React from 'react';
import { Col, Form, Input, InputNumber, Row, Select } from 'antd';

import { isSystemNamespace } from '../../../../../../../../utils/harvesterUtils';
import { WORKLOAD_TYPE_OPTIONS } from '../constants';
import { LabelEditor } from '../editors';
import type { WorkloadType } from '../types';

export interface WorkloadFormStepBasicProps {
  isEditMode: boolean;
  editResourceId?: string;
  defaultType: WorkloadType;
  defaultNamespace?: string;
  namespacesOptions: string[];
  workloadType: WorkloadType;
}

const WorkloadFormStepBasic: React.FC<WorkloadFormStepBasicProps> = ({
  isEditMode,
  editResourceId,
  defaultType,
  defaultNamespace,
  namespacesOptions,
  workloadType,
}) => (
  <div>
    <Form.Item
      name="workloadType"
      label="工作负载类型"
      rules={[{ required: true, message: '请选择工作负载类型' }]}
      initialValue={defaultType}
    >
      <Select
        disabled={isEditMode}
        options={WORKLOAD_TYPE_OPTIONS}
        optionRender={(option) => (
          <div>
            <div style={{ fontWeight: 500 }}>{option.label}</div>
            <div style={{ fontSize: 12, color: '#999' }}>
              {WORKLOAD_TYPE_OPTIONS.find((o) => o.value === option.value)?.desc}
            </div>
          </div>
        )}
      />
    </Form.Item>

    <Row gutter={16}>
      <Col span={12}>
        {isEditMode ? (
          <>
            <Form.Item label="资源 ID">
              <Input value={editResourceId || ''} disabled style={{ color: 'rgba(0,0,0,0.45)' }} />
            </Form.Item>
            <Form.Item
              name="name"
              label="显示名称"
              rules={[
                { required: true, message: '请输入显示名称' },
                { max: 63, message: '名称不能超过63个字符' },
              ]}
            >
              <Input placeholder="例如: my-app" />
            </Form.Item>
          </>
        ) : (
          <Form.Item
            name="name"
            label="名称"
            rules={[
              { required: true, message: '请输入名称' },
              {
                pattern: /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/,
                message: '只允许小写字母、数字和中划线',
              },
              { max: 63, message: '名称不能超过63个字符' },
            ]}
          >
            <Input placeholder="例如: my-app" />
          </Form.Item>
        )}
      </Col>
      <Col span={12}>
        <Form.Item
          name="namespace"
          label="项目"
          rules={[{ required: true, message: '请选择项目' }]}
          initialValue={defaultNamespace}
        >
          <Select
            showSearch
            disabled={isEditMode}
            optionFilterProp="label"
            placeholder="选择项目"
            options={namespacesOptions
              .filter((ns) => !isSystemNamespace(ns))
              .map((ns) => ({ label: ns, value: ns }))}
          />
        </Form.Item>
      </Col>
    </Row>

    <LabelEditor name="labels" label="标签" />

    {workloadType !== 'daemonset' && (
      <Form.Item
        name="replicas"
        label="副本数"
        initialValue={1}
        rules={[{ required: true, message: '请输入副本数' }]}
      >
        <InputNumber min={1} max={1000} style={{ width: '100%' }} />
      </Form.Item>
    )}
  </div>
);

export default WorkloadFormStepBasic;
