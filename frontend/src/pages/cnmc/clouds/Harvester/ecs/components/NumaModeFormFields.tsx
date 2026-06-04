import React from 'react';
import { Alert, Form, InputNumber, Select, Space, Tooltip, Typography } from 'antd';
import { QuestionCircleOutlined } from '@ant-design/icons';
import type { FormInstance } from 'antd/es/form';
import {
  NUMA_MODE_OPTIONS,
  describeManualNumaPreview,
  validateVmPerformanceAdvancedForm,
  applyNumaModeSideEffects,
  type NumaMode,
} from '../lib/numaHugepagesSpec';

const NUMA_MODE_HINT =
  '自动映射按宿主机 NUMA 拓扑分配；手动拓扑均分 vCPU 与内存到各节点（须 CPU 绑定，建议配合大页内存）';

type NumaModeFormFieldsProps = {
  form: FormInstance;
  hotExpandEnabled?: boolean;
  onWarn?: (msg: string) => void;
};

/** 创建向导 / 性能抽屉共用的 NUMA 模式表单项 */
const NumaModeFormFields: React.FC<NumaModeFormFieldsProps> = ({
  form,
  hotExpandEnabled,
  onWarn,
}) => {
  const numaMode = Form.useWatch('numaMode', form) as NumaMode | undefined;

  const applyModeChange = (nextMode: NumaMode) => {
    if (nextMode !== 'off' && hotExpandEnabled) {
      onWarn?.('NUMA 亲和暂不支持与 CPU/内存热扩容同时启用');
      form.setFieldsValue({ numaMode: 'off' });
      return;
    }
    const merged = {
      ...form.getFieldsValue(true),
      numaMode: nextMode,
      ...applyNumaModeSideEffects({ ...form.getFieldsValue(true), numaMode: nextMode }),
    };
    if (nextMode !== 'off') {
      onWarn?.('启用 NUMA 亲和将自动开启 CPU 绑定，并清空 CPU QoS');
    }
    form.setFieldsValue(merged);
    const err = validateVmPerformanceAdvancedForm(merged);
    if (err) {
      onWarn?.(err);
      form.setFieldsValue({ numaMode: 'off', numaGuestMappingPassthrough: false });
    }
  };

  return (
    <Space direction="vertical" size={4} style={{ width: '100%' }}>
      <Space wrap>
        <Form.Item name="numaMode" initialValue="off" noStyle>
          <Select
            options={NUMA_MODE_OPTIONS}
            style={{ width: 200 }}
            disabled={!!hotExpandEnabled}
            onChange={(v) => applyModeChange(v as NumaMode)}
          />
        </Form.Item>
        <Tooltip title={NUMA_MODE_HINT}>
          <QuestionCircleOutlined
            style={{ color: 'rgba(0,0,0,.45)', fontSize: 12, cursor: 'help' }}
          />
        </Tooltip>
        {numaMode === 'manual' ? (
          <>
            <Typography.Text>节点数</Typography.Text>
            <Form.Item name="numaManualNodeCount" initialValue={2} noStyle>
              <InputNumber min={2} max={8} precision={0} style={{ width: 72 }} />
            </Form.Item>
          </>
        ) : null}
      </Space>
      {hotExpandEnabled ? (
        <Alert type="info" showIcon message="已启用热扩容时不可配置 NUMA 亲和" />
      ) : null}
      {numaMode === 'manual' ? (
        <Form.Item noStyle shouldUpdate>
          {() => {
            const preview = describeManualNumaPreview(form.getFieldsValue(true));
            return preview ? (
              <Typography.Text type="secondary">预览：{preview}</Typography.Text>
            ) : null;
          }}
        </Form.Item>
      ) : null}
    </Space>
  );
};

export default NumaModeFormFields;
