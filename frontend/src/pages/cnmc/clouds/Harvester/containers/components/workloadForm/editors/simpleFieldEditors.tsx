/**
 * 标签与端口列表编辑
 */
import React from 'react';
import { Form, Input, Select, InputNumber, Button, Space, Row, Col } from 'antd';
import { PlusOutlined, MinusCircleOutlined } from '@ant-design/icons';

import { PROTOCOL_OPTIONS } from '../constants';
import { validateNodeLabelKey, validateK8sLabelValue, validateK8sPortName } from '../validators';

const LabelEditor: React.FC<{
  name: string;
  label: string;
}> = ({ name, label }) => (
  <Form.List name={name}>
    {(fields, { add, remove }) => (
      <div>
        <div style={{ marginBottom: 8 }}>
          <Space>
            <span style={{ fontWeight: 500 }}>{label}</span>
            <Button type="dashed" size="small" onClick={() => add()} icon={<PlusOutlined />}>
              添加
            </Button>
          </Space>
        </div>
        {fields.map(({ key, name: index, ...restField }) => (
          <Space key={key} style={{ display: 'flex', marginBottom: 8 }} align="baseline">
            <Form.Item
              {...restField}
              name={[index, 'key']}
              rules={[
                { required: true, message: '请输入键' },
                { validator: validateNodeLabelKey },
              ]}>
              <Input placeholder="键 (如: app 或 example.com/key)" style={{ width: 180 }} />
            </Form.Item>
            <Form.Item
              {...restField}
              name={[index, 'value']}
              rules={[
                { required: true, message: '请输入值' },
                { validator: validateK8sLabelValue },
              ]}
            >
              <Input placeholder="值" style={{ width: 150 }} />
            </Form.Item>
            <MinusCircleOutlined onClick={() => remove(index)} />
          </Space>
        ))}
      </div>
    )}
  </Form.List>
);

// ============================================================
// 子组件: 端口配置
// ============================================================

const PortsEditor: React.FC = () => (
  <Form.List name="ports">
    {(fields, { add, remove }) => (
      <div>
        <div style={{ marginBottom: 8 }}>
          <Space>
            <span style={{ fontWeight: 500 }}>端口配置</span>
            <Button type="dashed" size="small" onClick={() => add({ protocol: 'TCP' })} icon={<PlusOutlined />}>
              添加端口
            </Button>
          </Space>
        </div>
        {fields.map(({ key, name: index, ...restField }) => (
          <Row key={key} gutter={8} style={{ marginBottom: 8 }}>
            <Col span={6}>
              <Form.Item
                {...restField}
                name={[index, 'name']}
                rules={[{ validator: validateK8sPortName }]}
              >
                <Input placeholder="端口名称 (可选)" />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item
                {...restField}
                name={[index, 'containerPort']}
                rules={[{ required: true, message: '端口必填' }]}
              >
                <InputNumber placeholder="容器端口" min={1} max={65535} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item
                {...restField}
                name={[index, 'protocol']}
                initialValue="TCP"
              >
                <Select options={PROTOCOL_OPTIONS} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={6}>
              <MinusCircleOutlined onClick={() => remove(index)} style={{ marginTop: 8 }} />
            </Col>
          </Row>
        ))}
      </div>
    )}
  </Form.List>
);


export { LabelEditor, PortsEditor };
