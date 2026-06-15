/**
 * 流量编排域 — 仅接入 CSM 安全资源池（单模态：表单 + 连接测试 + 提交）。
 * 与顶栏「接入边缘云」式精简交互一致，不依赖多云 CloudWizard。
 */
import React, { useEffect, useState } from 'react';
import { Button, Form, Input, Modal, Space, Switch, Typography, message } from 'antd';
import { CheckCircleOutlined, LoadingOutlined } from '@ant-design/icons';
import { apiPost } from '../../../../../services/api';
import { handleApiError } from '../../../../../utils/errorHandler';
import { cloudProviders } from '../../../../cnmc/pools/lib/poolProviders';
import {
  CSM_WEB_PASSWORD_HELP,
  mergeCsmWebAuthIntoConfig,
} from '../../../../cnmc/pools/lib/csmWebAuthConfig';

const { Text } = Typography;

const CSM_PROVIDER_ID = 'cloudmap.csm';

const csmProvider = cloudProviders.find((p) => p.id === CSM_PROVIDER_ID);
if (!csmProvider) {
  // 开发时配置缺失时尽早暴露
  console.error('[CsmPoolAccessModal] cloudmap.csm not found in poolProviders');
}

export interface CsmPoolAccessModalProps {
  visible: boolean;
  onCancel: () => void;
  onSuccess: () => void;
  /** 与列表页写权限一致；无权限时禁用测试/接入并提示 */
  canWrite: boolean;
  writeAction: string | null;
}

const CsmPoolAccessModal: React.FC<CsmPoolAccessModalProps> = ({
  visible,
  onCancel,
  onSuccess,
  canWrite,
  writeAction,
}) => {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);

  useEffect(() => {
    if (!visible) return;
    setTestResult(null);
    form.resetFields();
    const t = setTimeout(() => {
      form.setFieldsValue({
        ignoreTls: true,
        csmRepairUsername: 'admin',
      });
    }, 0);
    return () => clearTimeout(t);
  }, [visible, form]);

  const buildTrimmedValues = () => {
    const v = form.getFieldsValue();
    return {
      name: String(v.name ?? '').trim(),
      endpoint: String(v.endpoint ?? '').trim(),
      accessKey: String(v.accessKey ?? '').trim(),
      secretKey: String(v.secretKey ?? '').trim(),
      ignoreTls: v.ignoreTls !== undefined ? !!v.ignoreTls : true,
      csmRepairUsername: String(v.csmRepairUsername ?? 'admin').trim() || 'admin',
      csmRepairPassword: String(v.csmRepairPassword ?? '').trim(),
    };
  };

  const buildPoolConfig = (values: ReturnType<typeof buildTrimmedValues>) => {
    const cfgBase: Record<string, unknown> = {
      provider: CSM_PROVIDER_ID,
      name: values.name,
      endpoint: values.endpoint,
      accessKey: values.accessKey,
      secretKey: values.secretKey,
      ignoreTls: values.ignoreTls,
      type: 'security_pool',
    };
    return mergeCsmWebAuthIntoConfig(cfgBase, values);
  };

  const handleTest = async () => {
    if (!canWrite) {
      message.error(writeAction ? `无写入权限（需要 ${writeAction}）` : '无写入权限');
      return;
    }
    try {
      await form.validateFields(['name', 'endpoint', 'accessKey', 'secretKey']);
    } catch {
      return;
    }
    const values = buildTrimmedValues();
    form.setFieldsValue(values);
    setTestResult(null);
    setLoading(true);
    try {
      const payload = {
        provider: CSM_PROVIDER_ID,
        region: 'default',
        endpoint: values.endpoint,
        accessKey: values.accessKey,
        secretKey: values.secretKey,
        config: buildPoolConfig(values),
      };
      const json = await apiPost('/api/clouds/test-connection', payload);
      let msg = json?.message || (json?.ok ? '连接成功' : '连接失败');
      if (
        !json?.ok &&
        (msg.includes('self-signed certificate') || msg.includes('certificate') || msg.includes('SSL'))
      ) {
        msg += ' （提示：如使用自签名证书，请开启「忽略 TLS 证书校验」）';
      }
      setTestResult({ success: !!json?.ok, message: msg });
      if (json?.ok) message.success(msg);
      else message.error(msg);
    } catch (error: unknown) {
      const apiError = handleApiError(error, { showMessage: false, defaultMessage: '连接测试失败' });
      const failMsg = apiError.message || '连接测试失败';
      setTestResult({ success: false, message: failMsg });
      message.error(failMsg);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async () => {
    if (!canWrite) {
      message.error(writeAction ? `无写入权限（需要 ${writeAction}）` : '无写入权限');
      return;
    }
    if (!testResult?.success) {
      message.warning('请先完成连接测试并确保成功');
      return;
    }
    try {
      await form.validateFields();
    } catch {
      return;
    }
    const values = buildTrimmedValues();
    if (!values.name || !values.endpoint || !values.accessKey || !values.secretKey) {
      message.error('请填写名称、端点、AccessKey 与 SecretKey');
      return;
    }
    setLoading(true);
    try {
      const cfg = buildPoolConfig(values);
      const cloudData = {
        name: values.name,
        description: csmProvider?.name ? `${csmProvider.name} 安全资源池` : 'CSM 安全资源池',
        type: 'security_pool' as const,
        region: 'default',
        endpoint: values.endpoint,
        accessKey: values.accessKey,
        secretKey: values.secretKey,
        config: cfg,
      };
      await apiPost('/api/clouds', cloudData);
      message.success('已接入 CSM 安全资源池');
      onSuccess();
      onCancel();
      setTestResult(null);
      form.resetFields();
    } catch (error: unknown) {
      const apiError = handleApiError(error, { showMessage: false, defaultMessage: '接入失败' });
      let errorMessage = apiError.message || '接入失败';
      if (errorMessage.includes('已存在') || errorMessage.includes('名称')) {
        errorMessage = '资源池名称已存在，请使用其他名称';
      }
      message.error(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    setTestResult(null);
    form.resetFields();
    onCancel();
  };

  return (
    <Modal
      title={
        <Space size={8}>
          <span>接入 CSM 安全资源池</span>
        </Space>
      }
      open={visible}
      onCancel={handleClose}
      width={600}
      centered
      destroyOnHidden
      maskClosable
      styles={{ body: { maxHeight: 'min(78vh, 640px)', overflowY: 'auto' } }}
      footer={
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            width: '100%',
            flexWrap: 'nowrap',
          }}
        >
          <div
            style={{
              flex: 1,
              minWidth: 0,
              display: 'flex',
              alignItems: 'center',
            }}
          >
            {loading && (
              <>
                <LoadingOutlined style={{ marginRight: 8 }} spin />
                <Text type="secondary">请稍候…</Text>
              </>
            )}
            {!loading && testResult && (
              <>
                <CheckCircleOutlined
                  style={{
                    fontSize: 16,
                    color: testResult.success ? '#52c41a' : '#ff4d4f',
                    marginRight: 8,
                    flexShrink: 0,
                  }}
                />
                <span
                  style={{
                    fontSize: 14,
                    fontWeight: 500,
                    color: testResult.success ? '#52c41a' : '#ff4d4f',
                    lineHeight: 1.5,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                  title={testResult.message}
                >
                  {testResult.message}
                </span>
              </>
            )}
          </div>
          <Space style={{ flexShrink: 0 }}>
            <Button onClick={() => void handleTest()} loading={loading} disabled={!canWrite}>
              连接测试
            </Button>
            <Button onClick={handleClose}>取消</Button>
            <Button type="primary" loading={loading} onClick={() => void handleSubmit()} disabled={!canWrite}>
              接入
            </Button>
          </Space>
        </div>
      }
    >
      <Form
        form={form}
        layout="vertical"
        onValuesChange={() => setTestResult(null)}
        requiredMark
      >
        <Form.Item
          name="name"
          label="名称"
          rules={[{ required: true, message: '请输入资源池名称' }]}
        >
          <Input allowClear placeholder="如 prod-csm-pool" autoComplete="off" />
        </Form.Item>
        <Form.Item
          name="endpoint"
          label="端点"
          rules={[{ required: true, message: '请输入 HTTPS 端点' }]}
          extra="须包含控制台端口（OpenAPI 与控制台同址），例如 https://csm.example.com:8011"
        >
          <Input allowClear placeholder="https://csm-control.example.com:8011" autoComplete="off" />
        </Form.Item>
        <Form.Item
          name="accessKey"
          label="AccessKey"
          rules={[{ required: true, message: '请输入 AccessKey' }]}
        >
          <Input allowClear autoComplete="off" />
        </Form.Item>
        <Form.Item
          name="secretKey"
          label="SecretKey"
          rules={[{ required: true, message: '请输入 SecretKey' }]}
        >
          <Input.Password autoComplete="new-password" />
        </Form.Item>
        <Form.Item name="ignoreTls" label="忽略 TLS 证书校验" valuePropName="checked">
          <Switch />
        </Form.Item>

        <div className="modal-group-title">运营控制台（租户查询等）</div>
        <Text type="secondary" style={{ display: 'block', marginBottom: 12, fontSize: 12 }}>
          虚拟网元走 OpenAPI（AK/SK）；租户列表走控制台会话。端点 URL 须含控制台端口（如 https://host:8011）。
        </Text>
        <Form.Item name="csmRepairUsername" label="控制台用户名" initialValue="admin">
          <Input allowClear placeholder="admin" autoComplete="off" />
        </Form.Item>
        <Form.Item
          name="csmRepairPassword"
          label="控制台密码"
          extra={<span style={{ fontSize: 12 }}>{CSM_WEB_PASSWORD_HELP}</span>}
        >
          <Input.Password autoComplete="new-password" placeholder="与 CSM 控制台登录密码一致" />
        </Form.Item>
      </Form>
    </Modal>
  );
};

export default CsmPoolAccessModal;
