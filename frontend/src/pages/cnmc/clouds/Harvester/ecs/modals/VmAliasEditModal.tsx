/**
 * 修改虚拟机展示别名（tower.io/alias），提交逻辑由父组件注入
 */
import React, { useEffect } from 'react';
import { Form, Input, Modal } from 'antd';

export type VmAliasEditModalProps = {
  open: boolean;
  onCancel: () => void;
  /** 打开弹窗时用于回填表单 */
  initialAlias: string;
  confirmLoading: boolean;
  /** 返回 true 表示父组件已处理成功（通常父级会关弹窗并刷新） */
  onSubmit: (alias: string) => Promise<boolean>;
};

const VmAliasEditModal: React.FC<VmAliasEditModalProps> = ({
  open,
  onCancel,
  initialAlias,
  confirmLoading,
  onSubmit,
}) => {
  const [form] = Form.useForm<{ alias?: string }>();

  useEffect(() => {
    if (!open) return;
    form.setFieldsValue({ alias: String(initialAlias || '') });
  }, [open, initialAlias, form]);

  const runSubmit = async () => {
    try {
      const values = await form.validateFields();
      await onSubmit(String(values?.alias ?? ''));
    } catch {
      /* validateFields 或 onSubmit 失败时保持弹窗 */
    }
  };

  return (
    <Modal
      title="名称修改"
      open={open}
      centered
      okText="保存"
      cancelText="取消"
      confirmLoading={confirmLoading}
      onOk={runSubmit}
      onCancel={() => {
        if (confirmLoading) return;
        form.resetFields();
        onCancel();
      }}
    >
      <Form form={form} layout="vertical">
        <Form.Item
          name="alias"
          label="名称"
          rules={[
            { max: 64, message: '别名最长 64 个字符' },
            {
              validator: async (_rule, value) => {
                const v = String(value || '').trim();
                if (v.includes('\n') || v.includes('\r')) throw new Error('别名不允许换行');
              },
            },
          ]}
        >
          <Input
            autoFocus
            placeholder="请输入别名（留空则清空别名）"
            maxLength={64}
            onPressEnter={() => {
              if (confirmLoading) return;
              void runSubmit();
            }}
          />
        </Form.Item>
      </Form>
    </Modal>
  );
};

export default VmAliasEditModal;
