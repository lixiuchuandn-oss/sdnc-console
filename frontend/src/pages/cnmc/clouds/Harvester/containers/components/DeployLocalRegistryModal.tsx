/**
 * 部署本地 Docker Registry 弹窗组件
 */
import React, { useState, useCallback, useEffect } from 'react';
import { Modal, Form, Input, InputNumber, Switch, Select, Alert, Space, Spin, App } from 'antd';
import { DatabaseOutlined, InfoCircleOutlined } from '@ant-design/icons';
import {
  checkLocalRegistryPort,
  createLocalRegistry,
  suggestLocalRegistryPort,
} from '../../../../../../services/localRegistryApi';
import {
  LOCAL_REGISTRY_NAME_MAX_LENGTH,
  validateLocalRegistryNameField,
} from '../lib/localRegistryName';

interface Props {
  visible: boolean;
  cloudId: string;
  namespaces: string[];
  onCancel: () => void;
  onSuccess: () => void;
}

const DeployLocalRegistryModal: React.FC<Props> = ({
  visible,
  cloudId,
  namespaces,
  onCancel,
  onSuccess,
}) => {
  const [form] = Form.useForm();
  const { message } = App.useApp();
  const [loading, setLoading] = useState(false);
  const [_checkingPort, setCheckingPort] = useState(false);
  const [portStatus, setPortStatus] = useState<'checking' | 'available' | 'conflict' | null>(null);

  useEffect(() => {
    if (!visible || !cloudId) return;
    let cancelled = false;
    form.resetFields();
    form.setFieldsValue({
      namespace: 'default',
      sizeGi: 10,
      authEnabled: false,
    });
    setPortStatus('checking');
    void (async () => {
      try {
        const res = await suggestLocalRegistryPort(cloudId);
        if (cancelled) return;
        const port = Number(res?.data?.port);
        form.setFieldsValue({ nodePort: Number.isFinite(port) ? port : 30500 });
        setPortStatus('available');
      } catch {
        if (cancelled) return;
        form.setFieldsValue({ nodePort: 30500 });
        setPortStatus(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [visible, cloudId, form]);

  const checkPort = useCallback(async (port: number) => {
    if (!port || port < 30000 || port > 32767) {
      setPortStatus(null);
      return;
    }
    setCheckingPort(true);
    setPortStatus('checking');
    try {
      const res = await checkLocalRegistryPort(cloudId, port);
      const available = res?.data?.available;
      setPortStatus(available ? 'available' : 'conflict');
    } catch {
      setPortStatus('conflict');
    } finally {
      setCheckingPort(false);
    }
  }, [cloudId]);

  const handleOk = async () => {
    try {
      const values = await form.validateFields();
      const { sizeGi, ...rest } = values;
      setLoading(true);
      await createLocalRegistry(cloudId, {
        ...rest,
        storageSize: `${Number(sizeGi)}Gi`,
      });
      message.success('本地仓库部署任务已创建');
      onSuccess();
      form.resetFields();
    } catch (e: any) {
      message.error(e?.message || '部署失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      title={
        <Space>
          <DatabaseOutlined style={{ color: '#1890ff' }} />
          <span>部署本地仓库</span>
        </Space>
      }
      open={visible}
      onOk={handleOk}
      onCancel={() => {
        form.resetFields();
        setPortStatus(null);
        onCancel();
      }}
      confirmLoading={loading}
      destroyOnClose
      width={520}
    >
      <Alert
        type="info"
        showIcon
        icon={<InfoCircleOutlined />}
        style={{ marginBottom: 16 }}
        message="将在集群中部署 Docker Registry，并自动添加到仓库列表"
      />

      <Form form={form} layout="vertical">
        <Form.Item
          name="name"
          label="仓库名称"
          rules={[
            { required: true, message: '请输入仓库名称' },
            { validator: validateLocalRegistryNameField },
          ]}
          extra="仅支持英文字母、数字和连字符（-），须以字母或数字开头和结尾；将用于生成集群资源名，如 docker-registry-my-registry"
        >
          <Input placeholder="如：my-registry" maxLength={LOCAL_REGISTRY_NAME_MAX_LENGTH} />
        </Form.Item>

        <Form.Item
          name="namespace"
          label="命名空间"
          rules={[{ required: true, message: '请选择命名空间' }]}
        >
          <Select showSearch optionFilterProp="label">
            {namespaces.map((ns) => (
              <Select.Option key={ns} value={ns} label={ns}>
                {ns}
              </Select.Option>
            ))}
          </Select>
        </Form.Item>

        <Form.Item
          name="nodePort"
          label="NodePort 端口"
          rules={[
            { required: true, message: '请输入端口' },
            { type: 'number', min: 30000, max: 32767, message: '端口范围 30000-32767' },
          ]}
          extra={
            portStatus === 'checking' ? (
              <Space><Spin size="small" /> 检测中...</Space>
            ) : portStatus === 'available' ? (
              <span style={{ color: '#52c41a' }}>✓ 端口可用</span>
            ) : portStatus === 'conflict' ? (
              <span style={{ color: '#ff4d4f' }}>✗ 端口已被占用</span>
            ) : (
              '端口范围 30000-32767'
            )
          }
        >
          <InputNumber
            min={30000}
            max={32767}
            style={{ width: '100%' }}
            onBlur={(e) => {
              const port = parseInt(e.target.value, 10);
              if (!isNaN(port)) checkPort(port);
            }}
          />
        </Form.Item>

        <Form.Item label="容量(Gi)" name="sizeGi" rules={[{ required: true, message: '请输入容量' }]}>
          <InputNumber min={1} style={{ width: '100%' }} />
        </Form.Item>

        <Form.Item
          name="authEnabled"
          label="启用认证"
          valuePropName="checked"
          tooltip="启用后需要用户名密码才能推送镜像"
        >
          <Switch />
        </Form.Item>

        <Form.Item noStyle shouldUpdate>
          {({ getFieldValue }) =>
            getFieldValue('authEnabled') ? (
              <>
                <Form.Item
                  name="username"
                  label="用户名"
                  rules={[{ required: true, message: '请输入用户名' }]}
                >
                  <Input placeholder="认证用户名" />
                </Form.Item>
                <Form.Item
                  name="password"
                  label="密码"
                  rules={[{ required: true, message: '请输入密码' }]}
                >
                  <Input.Password placeholder="认证密码" />
                </Form.Item>
              </>
            ) : null
          }
        </Form.Item>
      </Form>
    </Modal>
  );
};

export default DeployLocalRegistryModal;
