import React from 'react';
import { Form, InputNumber, Space, Typography, Checkbox } from 'antd';

type Props = {
  form: any;
};

const MemAdvanced: React.FC<Props> = ({ form }) => {
  return (
    <>
      <Form.Item label="内存 QoS">
        <Space>
          <Typography.Text>平时至少需要</Typography.Text>
          <Form.Item noStyle name="memoryRequestGi">
            <InputNumber min={0} max={2048} precision={0} style={{ width: 100 }} />
          </Form.Item>
          <Typography.Text>GiB，最多使用</Typography.Text>
          <Form.Item noStyle name="memoryLimitGi">
            <InputNumber min={0} max={4096} precision={0} style={{ width: 100 }} />
          </Form.Item>
          <Typography.Text>GiB</Typography.Text>
        </Space>
      </Form.Item>
      <Form.Item label="内存峰值保护" name="memoryBurstUnlimited" valuePropName="checked">
        <Space>
          <Checkbox>启用</Checkbox>
          <Typography.Text type="secondary">业务峰值时自动取消最多使用内存限制</Typography.Text>
        </Space>
      </Form.Item>
    </>
  );
};

export default MemAdvanced;
