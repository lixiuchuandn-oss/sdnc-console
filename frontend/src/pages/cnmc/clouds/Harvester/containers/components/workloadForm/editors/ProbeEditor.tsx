/**
 * 存活/就绪探针配置
 */
import React from 'react';
import { Form, Input, Select, InputNumber, Card, Row, Col, Switch } from 'antd';
import { PROBE_TYPE_OPTIONS } from '../constants';
import { validateHttpProbePath, validateExecCommand } from '../validators';

const ProbeEditor: React.FC<{
  name: 'livenessProbe' | 'readinessProbe';
  label: string;
}> = ({ name, label }) => {
  const form = Form.useFormInstance();
  const probeType = Form.useWatch([name, 'type'], form);
  
  return (
    <Card size="small" title={label} style={{ marginBottom: 16 }}>
      <Form.Item name={[name, 'enabled']} label="启用" valuePropName="checked">
        <Switch />
      </Form.Item>
      
      <Form.Item noStyle shouldUpdate>
        {({ getFieldValue }) => {
          const enabled = getFieldValue([name, 'enabled']);
          if (!enabled) return null;
          
          return (
            <>
              <Form.Item name={[name, 'type']} label="检查方式">
                <Select options={PROBE_TYPE_OPTIONS} style={{ width: 150 }} />
              </Form.Item>
              
              {probeType === 'httpGet' && (
                <Row gutter={8}>
                  <Col span={12}>
                    <Form.Item 
                      name={[name, 'httpGet', 'path']} 
                      label="HTTP 路径"
                      rules={[{ validator: validateHttpProbePath }]}
                    >
                      <Input placeholder="/health" />
                    </Form.Item>
                  </Col>
                  <Col span={12}>
                    <Form.Item name={[name, 'httpGet', 'port']} label="端口">
                      <InputNumber min={1} max={65535} style={{ width: '100%' }} />
                    </Form.Item>
                  </Col>
                </Row>
              )}
              
              {probeType === 'tcpSocket' && (
                <Form.Item name={[name, 'tcpSocket', 'port']} label="TCP 端口">
                  <InputNumber min={1} max={65535} style={{ width: 200 }} />
                </Form.Item>
              )}
              
              {probeType === 'exec' && (
                <Form.Item 
                  name={[name, 'exec', 'command']} 
                  label="执行命令"
                  rules={[{ validator: validateExecCommand }]}
                >
                  <Select
                    mode="tags"
                    placeholder="输入命令后按回车添加 (如: /bin/sh, -c, ls)"
                    style={{ width: '100%' }}
                    tokenSeparators={[' ']}
                  />
                </Form.Item>
              )}
              
              <Row gutter={8}>
                <Col span={12}>
                  <Form.Item 
                    name={[name, 'initialDelaySeconds']} 
                    label="初始延迟(秒)"
                    initialValue={30}
                  >
                    <InputNumber min={0} style={{ width: '100%' }} />
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item 
                    name={[name, 'periodSeconds']} 
                    label="检查间隔(秒)"
                    initialValue={10}
                  >
                    <InputNumber min={1} style={{ width: '100%' }} />
                  </Form.Item>
                </Col>
              </Row>
            </>
          );
        }}
      </Form.Item>
    </Card>
  );
};

export default ProbeEditor;
