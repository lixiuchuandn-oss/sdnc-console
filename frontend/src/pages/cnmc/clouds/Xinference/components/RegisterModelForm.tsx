import React, { useEffect, useState } from 'react';
import { Alert, Button, Form, Input, Switch, message } from 'antd';
import CodeEditor from '../../../../../components/CodeEditor';
import { registerModelTemplateJson } from '../lib/registerModelTemplates';
import { modelTypeLabel, type XinferenceGalleryModelType } from '../lib/xinferenceModelRegistry';
import { registerXinferenceModel } from '../../../../../services/xinferenceApi';

type FormValues = {
  worker_ip?: string;
  persist: boolean;
};

type Props = {
  poolId: string;
  modelType: XinferenceGalleryModelType;
};

const RegisterModelForm: React.FC<Props> = ({ poolId, modelType }) => {
  const [form] = Form.useForm<FormValues>();
  const [modelJson, setModelJson] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    setModelJson(registerModelTemplateJson(modelType));
    form.setFieldsValue({ persist: true, worker_ip: undefined });
  }, [modelType, form]);

  const handleSubmit = async () => {
    const values = await form.validateFields();
    let parsed: unknown;
    try {
      parsed = JSON.parse(modelJson);
    } catch {
      message.error('模型定义须为合法 JSON');
      return;
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      message.error('模型定义须为 JSON 对象');
      return;
    }
    const modelDef = parsed as Record<string, unknown>;
    const modelName = String(modelDef.model_name ?? '').trim();
    if (!modelName) {
      message.error('模型定义中须包含 model_name');
      return;
    }

    setSubmitting(true);
    try {
      await registerXinferenceModel(poolId, modelType, {
        model: modelDef,
        persist: values.persist,
        worker_ip: values.worker_ip?.trim() || undefined,
      });
      message.success(`已注册模型「${modelName}」`);
    } catch (e: unknown) {
      message.error(e instanceof Error ? e.message : '注册模型失败');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="模型定义格式与 Xinference 自定义模型一致；model_uri 须指向集群可访问的路径。注册成功后可在「模型广场」启动。"
      />
      <Form form={form} layout="vertical" className="std-form">
        <Form.Item label="模型定义（JSON）" required style={{ marginBottom: 12 }}>
          <CodeEditor language="json" value={modelJson} onChange={setModelJson} height={360} />
        </Form.Item>
        <Form.Item name="persist" label="持久化注册" valuePropName="checked" tooltip="重启后仍保留注册信息">
          <Switch />
        </Form.Item>
        <Form.Item name="worker_ip" label="Worker IP（可选）" tooltip="模型文件位于指定 Worker 时填写">
          <Input placeholder="如 192.168.1.10" allowClear style={{ maxWidth: 320 }} />
        </Form.Item>
        <Form.Item style={{ marginBottom: 0 }}>
          <Button type="primary" loading={submitting} onClick={() => void handleSubmit()}>
            提交注册{modelTypeLabel(modelType)}
          </Button>
        </Form.Item>
      </Form>
    </>
  );
};

export default RegisterModelForm;
