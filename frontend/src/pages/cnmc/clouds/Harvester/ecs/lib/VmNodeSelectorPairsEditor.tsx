import React from 'react';
import { Button, Card, Col, Form, Input, Row } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { VmAdvancedSchedulingCompactEmpty } from './VmAdvancedSchedulingCompactEmpty';

const toolbarStyle: React.CSSProperties = {
  marginBottom: 12,
  display: 'flex',
  justifyContent: 'flex-end',
  alignItems: 'center',
  gap: 8,
};

/** 故障域模式下 · 附加 nodeSelector 键值对编辑（结构对齐 PodAffinityEditor） */
const VmNodeSelectorPairsEditor: React.FC = () => (
  <Form.List name="nodeSelectorPairs">
    {(fields, { add, remove }) =>
      fields.length === 0 ? (
        <VmAdvancedSchedulingCompactEmpty
          description="暂未配置节点标签"
          actions={
            <Button
              size="small"
              type="primary"
              ghost
              icon={<PlusOutlined />}
              onClick={() => add({ key: '', value: '' })}
            >
              新增标签
            </Button>
          }
        />
      ) : (
        <>
          <div style={toolbarStyle}>
            <Button
              size="small"
              type="dashed"
              icon={<PlusOutlined />}
              onClick={() => add({ key: '', value: '' })}
            >
              新增标签
            </Button>
          </div>
          {fields.map(({ key, name }, idx) => (
            <Card
              key={key}
              size="small"
              style={{ marginBottom: 12 }}
              title={`标签 #${idx + 1}`}
              extra={
                <Button type="text" danger size="small" onClick={() => remove(name)}>
                  删除
                </Button>
              }
            >
              <Row gutter={8}>
                <Col xs={24} sm={12}>
                  <Form.Item
                    name={[name, 'key']}
                    label="键"
                    rules={[{ required: true, message: '请输入键' }]}
                    style={{ marginBottom: 0 }}
                  >
                    <Input placeholder="Key" />
                  </Form.Item>
                </Col>
                <Col xs={24} sm={12}>
                  <Form.Item
                    name={[name, 'value']}
                    label="值"
                    rules={[{ required: true, message: '请输入值' }]}
                    style={{ marginBottom: 0 }}
                  >
                    <Input placeholder="Value" />
                  </Form.Item>
                </Col>
              </Row>
            </Card>
          ))}
        </>
      )
    }
  </Form.List>
);

export default VmNodeSelectorPairsEditor;
