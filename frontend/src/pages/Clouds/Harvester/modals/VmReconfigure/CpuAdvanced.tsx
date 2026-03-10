import React from 'react';
import { Form, InputNumber, Space, Typography, Select, Checkbox, Input } from 'antd';

type Props = {
  form: any;
  /** 当前 VM 的 CPU / 资源原始对象，用于初始化和调试展示 */
  vmCpuState?: {
    cpu?: any;
    resources?: any;
  };
  /** 调试展示用：当前 VM 的 CPU / 资源信息字符串 */
  vmCpuDebugText?: string;
};

const CpuAdvanced: React.FC<Props> = ({ form, vmCpuState, vmCpuDebugText }) => {
  // 使用本地受控状态 + 监听 vmCpuState，保证“CPU 绑定”回显一定跟 VM 保持一致
  const [dedicatedChecked, setDedicatedChecked] = React.useState<boolean>(!!vmCpuState?.cpu?.dedicatedCpuPlacement);
  const [isolateChecked, setIsolateChecked] = React.useState<boolean>(!!vmCpuState?.cpu?.isolateEmulatorThread);

  React.useEffect(() => {
    const nextDedicated = !!vmCpuState?.cpu?.dedicatedCpuPlacement;
    const nextIsolate = !!vmCpuState?.cpu?.isolateEmulatorThread;
    setDedicatedChecked(nextDedicated);
    setIsolateChecked(nextIsolate);
    // 同步到表单字段，避免提交时拿不到最新值
    form?.setFieldsValue?.({ dedicatedCPUPlacement: nextDedicated, isolateEmulatorThread: nextIsolate });
  }, [vmCpuState, form]);
  return (
    <div>
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
          <Checkbox
            checked={dedicatedChecked}
            onChange={(e) => {
              const v = e.target.checked;
              setDedicatedChecked(v);
              form?.setFieldsValue?.({ dedicatedCPUPlacement: v });
            }}
          >
            启用
          </Checkbox>
          <Typography.Text type="secondary">保证用固定的物理 CPU 核心，减少切换损耗</Typography.Text>
        </Space>
      </Form.Item>
      <Form.Item label="CPU 隔离" name="isolateEmulatorThread" valuePropName="checked">
        <Space>
          <Checkbox
            checked={isolateChecked}
            onChange={(e) => {
              const v = e.target.checked;
              setIsolateChecked(v);
              form?.setFieldsValue?.({ isolateEmulatorThread: v });
            }}
          >
            启用
          </Checkbox>
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
      {/* 调试专用：展示当前从 VM 读取到的 CPU / 资源信息，便于核对回显是否正确 */}
      <Form.Item label="VM CPU 调试信息">
        <Input.TextArea
          value={vmCpuDebugText || '（未读取到任何 CPU 信息）'}
          autoSize={{ minRows: 3, maxRows: 10 }}
          readOnly
        />
      </Form.Item>
    </div>
  );
};

export default CpuAdvanced;
