import React, { useState } from 'react';
import { Card, Form, Input, Select, Slider, Switch, Radio, Collapse, Button, message, Tooltip } from 'antd';
import { InfoCircleOutlined } from '@ant-design/icons';

const { Option } = Select;
const { Panel } = Collapse;

const regions = ['华东-1', '华北-2', '华南-1', '美国西部', '欧洲-中部'];

const NegotiationRulesForm: React.FC = () => {
  const [form] = Form.useForm();
  const [mode, setMode] = useState<'weighted' | 'pareto' | 'custom'>('weighted');

  const handleSubmit = () => {
    message.success('规则已保存');
  };

  return (
    <Form form={form} layout="vertical" style={{ maxWidth: 900, margin: '0 auto' }} onFinish={handleSubmit} initialValues={{ cpuWeight: 5, memoryWeight: 5, storageWeight: 5, latencyWeight: 5, bandwidthWeight: 5, costWeight: 5 }}>
      <Collapse defaultActiveKey={['hard', 'soft']} accordion>
        <Panel header="硬约束 (Hard Constraints)" key="hard">
          <Form.Item label="地域 (Region)" name="regions">
            <Select mode="multiple" placeholder="请选择可接受地域">
              {regions.map(r => <Option key={r} value={r}>{r}</Option>)}
            </Select>
          </Form.Item>
          <Form.Item label="GPU 必须" name="requireGpu" valuePropName="checked">
            <Switch />
          </Form.Item>
          <Form.Item label="安全级别" name="securityLevel">
            <Select placeholder="请选择安全级别">
              <Option value="level1">Level 1</Option>
              <Option value="level2">Level 2</Option>
              <Option value="level3">Level 3</Option>
            </Select>
          </Form.Item>
        </Panel>
        <Panel header="软约束权重 (Soft Constraint Weights)" key="soft">
          <Form.Item label="CPU 权重" name="cpuWeight">
            <Slider min={0} max={10} />
          </Form.Item>
          <Form.Item label="内存 权重" name="memoryWeight">
            <Slider min={0} max={10} />
          </Form.Item>
          <Form.Item label="存储 权重" name="storageWeight">
            <Slider min={0} max={10} />
          </Form.Item>
          <Form.Item label="延迟 权重" name="latencyWeight">
            <Slider min={0} max={10} />
          </Form.Item>
          <Form.Item label="带宽 权重" name="bandwidthWeight">
            <Slider min={0} max={10} />
          </Form.Item>
          <Form.Item label={<span>成本 权重&nbsp;<Tooltip title="每小时费用"><InfoCircleOutlined /></Tooltip></span>} name="costWeight">
            <Slider min={0} max={10} />
          </Form.Item>
        </Panel>
        <Panel header="阈值设置 (Thresholds)" key="thresholds">
          <Form.Item label="CPU 利用率上限 (%)" name="cpuThreshold">
            <Input placeholder="如 80" suffix="%" />
          </Form.Item>
          <Form.Item label="延迟上限 (ms)" name="latencyThreshold">
            <Input placeholder="如 50" suffix="ms" />
          </Form.Item>
          <Form.Item label="预算上限 (元/小时)" name="budget">
            <Input placeholder="如 10" prefix="¥" />
          </Form.Item>
        </Panel>
        <Panel header="目标函数 (Objective)" key="objective">
          <Form.Item label="模式" name="mode" initialValue="weighted">
            <Radio.Group onChange={e => setMode(e.target.value)}>
              <Radio.Button value="weighted">加权综合</Radio.Button>
              <Radio.Button value="pareto">多目标 Pareto</Radio.Button>
              <Radio.Button value="custom">自定义公式</Radio.Button>
            </Radio.Group>
          </Form.Item>
          {mode === 'custom' && (
            <Form.Item label="自定义公式" name="customFormula">
              <Input.TextArea rows={4} placeholder="例如: 0.5*(1-cpuUtil)+0.5*(1-latencyNorm)-0.2*costNorm" />
            </Form.Item>
          )}
        </Panel>
      </Collapse>
      <Form.Item style={{ marginTop: 24 }}>
        <Button type="primary" htmlType="submit">保存</Button>
        <Button style={{ marginLeft: 12 }} onClick={() => form.resetFields()}>重置</Button>
      </Form.Item>
    </Form>
  );
};

export default NegotiationRulesForm; 