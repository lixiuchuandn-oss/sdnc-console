import React from 'react';
import { Form, InputNumber, Space, Typography, Select, Checkbox, Input } from 'antd';

type Props = {
  form: any;
};

const CpuAdvanced: React.FC<Props> = ({ form }) => {
  return (
    <div>
      <Form.Item label="CPU 拓扑">
        <Space>
          <Typography.Text>插槽</Typography.Text>
          <Form.Item noStyle name="cpuSockets">
            <InputNumber min={1} max={8} style={{ width: 100 }} />
          </Form.Item>
          <Typography.Text>每插槽</Typography.Text>
          <Form.Item noStyle name="cpuCores">
            <InputNumber min={1} max={64} style={{ width: 100 }} />
          </Form.Item>
          <Typography.Text>核</Typography.Text>
          <Typography.Text>线程</Typography.Text>
          <Form.Item noStyle name="cpuThreads">
            <InputNumber min={1} max={8} style={{ width: 100 }} />
          </Form.Item>
        </Space>
      </Form.Item>
      <Form.Item label="CPU 模式" name="cpuModel" initialValue="host-passthrough">
        <Select options={[{ label: 'Host-Passthrough', value: 'host-passthrough' }, { label: 'Host-Model', value: 'host-model' }, { label: '自定义', value: 'custom' }]} style={{ width: 220 }} />
      </Form.Item>
      <Form.Item noStyle shouldUpdate={(prev, curr) => prev.cpuModel !== curr.cpuModel}>
        {({ getFieldValue }) => (getFieldValue('cpuModel') === 'custom' ? (
          <Form.Item label="自定义模型" name="cpuModelCustom" extra={<Typography.Text type="secondary">指定 CPU 型号名称，例如 Skylake-Client-IBRS</Typography.Text>}>
            <Input placeholder="如：Skylake-Client-IBRS" />
          </Form.Item>
        ) : null)}
      </Form.Item>
      <Form.Item label="CPU 绑定" name="dedicatedCPUPlacement" valuePropName="checked">
        <Space>
          <Checkbox>启用</Checkbox>
          <Typography.Text type="secondary">保证用固定的物理 CPU 核心，减少切换损耗</Typography.Text>
        </Space>
      </Form.Item>
      <Form.Item label="CPU 隔离" name="isolateEmulatorThread" valuePropName="checked">
        <Space>
          <Checkbox>启用</Checkbox>
          <Typography.Text type="secondary">启用后 QEMU 模拟器线程与来宾 vCPU 隔离，降低干扰</Typography.Text>
        </Space>
      </Form.Item>
      <Form.Item label="CPU QoS">
        <Space>
          <Typography.Text>平时至少需要</Typography.Text>
          <Form.Item noStyle name="cpuRequest">
            <InputNumber min={0} max={512} precision={0} style={{ width: 100 }} />
          </Form.Item>
          <Typography.Text>核，最多使用</Typography.Text>
          <Form.Item noStyle name="cpuLimit">
            <InputNumber min={0} max={512} precision={0} style={{ width: 100 }} />
          </Form.Item>
          <Typography.Text>核</Typography.Text>
        </Space>
      </Form.Item>
      <Form.Item label="CPU 峰值保护" name="cpuBurstUnlimited" valuePropName="checked">
        <Space>
          <Checkbox>启用</Checkbox>
          <Typography.Text type="secondary">业务峰值时自动取消最多使用核数限制</Typography.Text>
        </Space>
      </Form.Item>
    </div>
  );
};

export default CpuAdvanced;
