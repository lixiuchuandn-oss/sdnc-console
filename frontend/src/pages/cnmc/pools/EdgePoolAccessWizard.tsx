/**
 * 边缘云接入 / 编辑（单模态框：表单 + 取消 / 连接测试 / 保存）
 */
import React, { useState, useEffect } from 'react';
import {
  Modal, Button, Form, Input, Switch, message, Space, Typography, Image,
} from 'antd';
import { CheckCircleOutlined, LoadingOutlined } from '@ant-design/icons';
import {
  getCloudmapEdgeProvider,
  type Cloud,
  type CloudProviderField,
} from './poolProviders';
import cloudmapKeyImage from '../../../assets/clouds/cloudmapkey.png';
import cloudmapApiImage from '../../../assets/clouds/cloudmapapi.png';
import { apiPost, apiPut, apiRequest } from '../../../services/api';
import { updateSystemSetting } from '../../../services/systemApi';
import { useAuth } from '../../../contexts/AuthContext';
import { hasPermissionForAction } from '../../../utils/accessMapping';
import { handleApiError } from '../../../utils/errorHandler';
import { CLOUD_RESOURCE_POOLS_CREATE_WRITE } from '../../../constants/cloudPermissions';

const { Text } = Typography;

const CLOUDMAP_EDGE = getCloudmapEdgeProvider();

interface CloudWizardProps {
  visible: boolean;
  onCancel: () => void;
  onSuccess: () => void;
  forceRequired?: boolean;
  editingCloud?: Cloud | null;
}

const CloudWizard: React.FC<CloudWizardProps> = ({
  visible,
  onCancel,
  onSuccess,
  forceRequired,
  editingCloud = null,
}) => {
  const { user } = useAuth();
  const permList = user && Array.isArray(user.permissions) ? user.permissions : [];
  const isEdit = !!editingCloud?.id;
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [formData, setFormData] = useState<any>(null);
  const [revealVisible, setRevealVisible] = useState(false);
  const [adminPassword, setAdminPassword] = useState('');
  const [revealLoading, setRevealLoading] = useState(false);
  const [skVisible, setSkVisible] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setRevealVisible(false);
    setAdminPassword('');
    setSkVisible(false);
    setTestResult(null);
    setFormData(null);
    if (isEdit && editingCloud) {
      const c = editingCloud;
      const apiTok = c.secretKey || (c as any)?.config?.apiToken || '';
      form.setFieldsValue({
        name: c.name,
        endpoint: c.endpoint,
        apiToken: apiTok,
        ignoreTls: c.config?.ignoreTls !== undefined ? !!c.config.ignoreTls : true,
      });
      setFormData(form.getFieldsValue());
      return;
    }
    form.resetFields();
    const t = setTimeout(() => {
      form.setFieldsValue({ ignoreTls: true });
    }, 0);
    return () => clearTimeout(t);
  }, [visible, form, isEdit, editingCloud]);

  useEffect(() => {
    if (!visible || isEdit) return;
    const timer = setTimeout(() => {
      const currentValues = form.getFieldsValue();
      if (currentValues.ignoreTls === undefined || currentValues.ignoreTls === null) {
        form.setFieldsValue({ ignoreTls: true });
        setFormData((prev: any) => ({ ...prev, ignoreTls: true }));
      }
    }, 200);
    return () => clearTimeout(timer);
  }, [visible, form, isEdit]);

  const buildTrimmedValues = (values: any) => {
    const trimmedValues: any = {};
    CLOUDMAP_EDGE.fields.forEach((field: any) => {
      if (values[field.key] !== undefined && values[field.key] !== null) {
        trimmedValues[field.key] = String(values[field.key]).trim();
      } else {
        trimmedValues[field.key] = values[field.key];
      }
    });
    trimmedValues.type = 'edge';
    trimmedValues.ignoreTls = values.ignoreTls !== undefined ? values.ignoreTls : true;
    return trimmedValues;
  };

  const handleFooterConnectionTest = () => {
    form.validateFields().then(() => {
      const trimmedValues = buildTrimmedValues(form.getFieldsValue());
      form.setFieldsValue(trimmedValues);
      setFormData(trimmedValues);
      setTestResult(null);
      handleTestConnection(trimmedValues);
    }).catch(() => {});
  };

  const handleTestConnection = async (valuesOverride?: any) => {
    if (!hasPermissionForAction(permList, CLOUD_RESOURCE_POOLS_CREATE_WRITE)) {
      message.error('权限不足：需要资源池「新增与编辑」权限（clouds.resource-pools.create:write）');
      return;
    }
    setLoading(true);
    try {
      const values = valuesOverride ?? formData ?? form.getFieldsValue();
      const tokenProbe = String(
        values.apiToken ||
          values.secretKey ||
          values.accessKeySecret ||
          values.secretAccessKey ||
          values.privateKey ||
          values.clientSecret ||
          values.password ||
          '',
      ).trim();

      if (isEdit && editingCloud?.id && (!tokenProbe || tokenProbe.startsWith('***'))) {
        const ep = String(values.endpoint || '').trim();
        const epSaved = String(editingCloud.endpoint || '').trim();
        const ignoreTlsVal = values.ignoreTls !== undefined ? !!values.ignoreTls : true;
        const ignoreSaved =
          editingCloud.config?.ignoreTls !== undefined ? !!editingCloud.config.ignoreTls : true;
        if (ep !== epSaved || ignoreTlsVal !== ignoreSaved) {
          message.warning('已修改端点或 TLS 校验设置时，请填写 API 令牌后再测试连接');
          return;
        }
        const json: any = await apiPost(`/api/clouds/${editingCloud.id}/test`, {});
        const ok = String(json?.status || '').toLowerCase() === 'online';
        const msg = json?.message || (ok ? '连接成功' : '连接失败');
        setTestResult({ success: ok, message: msg });
        if (ok) message.success(msg);
        else message.error(msg);
        return;
      }

      const endpoint = String(values.endpoint || '').trim();
      const cfgBase: any = { provider: CLOUDMAP_EDGE.id, ...values };
      cfgBase.harvesterVersion = '1.6';

      const payload = {
        provider: CLOUDMAP_EDGE.id,
        region: 'default',
        endpoint,
        accessKey: values.accessKey || values.accessKeyId || values.secretId || values.publicKey || values.username || '',
        secretKey:
          values.secretKey ||
          values.accessKeySecret ||
          values.secretAccessKey ||
          values.privateKey ||
          values.clientSecret ||
          values.password ||
          values.apiToken ||
          '',
        config: cfgBase,
      };

      const json = await apiPost('/api/clouds/test-connection', payload);
      let msg = json?.message || (json?.ok ? '连接成功' : '连接失败');
      if (!json?.ok && (msg.includes('self-signed certificate') || msg.includes('certificate') || msg.includes('SSL'))) {
        msg += ' （提示：如使用自签名证书，请开启「忽略TLS证书校验」）';
      }
      setTestResult({ success: !!json?.ok, message: msg });
      if (json?.ok) message.success(msg);
      else message.error(msg);
    } catch (error: any) {
      const apiError = handleApiError(error, {
        showMessage: false,
        defaultMessage: '连接测试失败',
      });
      const failMsg = apiError.message || '连接测试失败，请检查网络连接。';
      setTestResult({
        success: false,
        message: failMsg,
      });
      message.error(failMsg);
    } finally {
      setLoading(false);
    }
  };

  const handleFinish = async () => {
    try {
      await form.validateFields();
    } catch {
      return;
    }
    if (!hasPermissionForAction(permList, CLOUD_RESOURCE_POOLS_CREATE_WRITE)) {
      message.error('权限不足：需要资源池「新增与编辑」权限（clouds.resource-pools.create:write）');
      return;
    }
    setLoading(true);
    try {
      const values = buildTrimmedValues(form.getFieldsValue());
      form.setFieldsValue(values);
      setFormData(values);
      const cfg: any = {
        provider: CLOUDMAP_EDGE.id,
        ...values,
        harvesterVersion: '1.6',
      };

      const finalEndpoint = String(values.endpoint || '').trim();
      const finalAccessKey = (
        values.accessKey ||
        values.accessKeyId ||
        values.secretId ||
        values.publicKey ||
        values.username ||
        ''
      ).toString().trim();
      const finalSecretKey = (
        values.secretKey ||
        values.accessKeySecret ||
        values.secretAccessKey ||
        values.privateKey ||
        values.clientSecret ||
        values.password ||
        values.apiToken ||
        ''
      ).toString().trim();

      const cloudData = {
        name: (values.name && String(values.name).trim()) || '',
        description: `${CLOUDMAP_EDGE.name}资源池`,
        type: 'edge',
        region: 'default',
        endpoint: finalEndpoint,
        accessKey: finalAccessKey,
        secretKey: finalSecretKey,
        config: cfg,
      };

      if (!cloudData.name || !cloudData.endpoint) {
        message.error('请填写名称与端点');
        setLoading(false);
        return;
      }
      if (!finalSecretKey) {
        message.error('请填写 API 令牌');
        setLoading(false);
        return;
      }

      const created: any = await apiPost('/api/clouds', cloudData);
      const newId = created?.id ?? created?.data?.id;
      if (newId) {
        try {
          await updateSystemSetting('favorite.cloudId', String(newId));
        } catch {
          /* ignore */
        }
      }
      message.success('云资源创建成功！');
      onSuccess();
      handleCancel();
    } catch (error: any) {
      let errorMessage = '创建云资源失败';
      if (error?.response?.data?.message) errorMessage = error.response.data.message;
      else if (error?.message) errorMessage = error.message;
      else if (typeof error === 'string') errorMessage = error;
      if (errorMessage.includes('缺少必填字段')) {
        errorMessage = '请填写完整的配置信息：名称、端点、API令牌等必填字段不能为空';
      } else if (errorMessage.includes('已存在') || errorMessage.includes('名称已存在') || errorMessage.includes('云资源名称已存在')) {
        errorMessage = '资源池名称已存在，请使用其他名称';
      } else if (errorMessage.includes('权限') || errorMessage.includes('授权')) {
        errorMessage = '权限不足或授权限制，请联系管理员';
      } else if (errorMessage.includes('连接') || errorMessage.includes('网络')) {
        errorMessage = '无法连接到 Cloudmap 服务器，请检查端点和网络连接';
      }
      message.error(errorMessage);
      console.error('创建云资源失败:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleRevealConfirm = async () => {
    if (!editingCloud?.id) return;
    if (!adminPassword) {
      message.error('请输入管理员密码');
      return;
    }
    setRevealLoading(true);
    try {
      const res: any = await apiPost(`/api/clouds/${editingCloud.id}/reveal`, {
        password: adminPassword,
      });
      const plain = res?.secretKey ?? res?.accessKey ?? '';
      form.setFieldsValue({ apiToken: plain });
      setSkVisible(true);
      message.success('凭证已回显');
      setRevealVisible(false);
      setAdminPassword('');
    } catch (error: any) {
      message.error(error?.response?.data?.message || '验证失败');
    } finally {
      setRevealLoading(false);
    }
  };

  const handleSaveEdit = async () => {
    if (!editingCloud?.id) return;
    try {
      await form.validateFields();
    } catch {
      return;
    }
    if (!hasPermissionForAction(permList, CLOUD_RESOURCE_POOLS_CREATE_WRITE)) {
      message.error('权限不足：需要资源池「新增与编辑」权限（clouds.resource-pools.create:write）');
      return;
    }
    setLoading(true);
    try {
      const values = form.getFieldsValue();
      const prevCfg = (editingCloud as any)?.config || {};
      const submitData: any = {
        name: String(values.name || '').trim(),
        description: String(editingCloud.description || '').trim(),
        region: 'default',
        endpoint: String(values.endpoint || '').trim(),
        config: {
          ...prevCfg,
          provider: CLOUDMAP_EDGE.id,
          ignoreTls: values.ignoreTls !== undefined ? !!values.ignoreTls : true,
          harvesterVersion: '1.6',
        },
      };
      const tok = String(values.apiToken ?? '').trim();
      if (tok && tok !== editingCloud.secretKey) {
        submitData.secretKey = tok;
      }
      await apiPut(`/api/clouds/${editingCloud.id}`, submitData);
      try {
        await updateSystemSetting('favorite.cloudId', String(editingCloud.id));
      } catch {
        /* ignore */
      }
      message.success('资源池已更新');
      onSuccess();
      handleCancel();
    } catch (error: any) {
      const msg = error?.response?.data?.message || error?.message || '更新失败';
      message.error(msg);
    } finally {
      setLoading(false);
    }
  };

  const handleCancel = () => {
    setTestResult(null);
    setFormData(null);
    setRevealVisible(false);
    setAdminPassword('');
    setSkVisible(false);
    form.resetFields();
    onCancel();
  };

  const handleFooterSave = () => {
    if (isEdit) {
      void handleSaveEdit();
    } else {
      void handleFinish();
    }
  };

  const renderForm = () => (
    <div>
      <Form
        form={form}
        layout="vertical"
        onValuesChange={(_, all) => {
          try {
            setFormData(all);
          } catch {
            /* ignore */
          }
        }}
      >
        {CLOUDMAP_EDGE.fields.map((field: CloudProviderField) => {
          let inputElement: React.ReactNode = null;
          if (field.type === 'input') {
            inputElement = <Input placeholder={field.placeholder} />;
          } else if (field.type === 'password') {
            if (isEdit) {
              inputElement = (
                <Input.Password
                  placeholder="不修改请留空或点击眼睛验证后查看"
                  visibilityToggle={{
                    visible: skVisible,
                    onVisibleChange: (v) => {
                      if (v) {
                        const currentVal = form.getFieldValue('apiToken');
                        if (
                          currentVal &&
                          (currentVal === editingCloud?.secretKey ||
                            String(currentVal).startsWith('***'))
                        ) {
                          setRevealVisible(true);
                          return;
                        }
                      }
                      setSkVisible(v);
                    },
                  }}
                />
              );
            } else {
              inputElement = <Input.Password placeholder={field.placeholder} />;
            }
          } else if (field.type === 'select') {
            inputElement = null;
          } else if (field.type === 'textarea') {
            inputElement = <Input.TextArea rows={4} placeholder={field.placeholder} />;
          }

          const rules: any[] = [];
          if (field.key === 'apiToken' && isEdit) {
            /* 编辑：令牌可选 */
          } else if (field.required) {
            rules.push({ required: true, message: `请输入${field.label}` });
          }
          if (field.key === 'name') {
            rules.push({
              validator: async (_: any, value: any) => {
                if (!value || typeof value !== 'string') return Promise.resolve();
                const trimmedName = value.trim();
                if (!trimmedName) return Promise.resolve();
                try {
                  const response = await apiRequest('/api/clouds', { skipCache: true });
                  const clouds = Array.isArray(response) ? response : (response?.data || []);
                  const existingCloud = clouds.find(
                    (cloud: any) =>
                      cloud.name &&
                      cloud.name.trim().toLowerCase() === trimmedName.toLowerCase() &&
                      (!isEdit || String(cloud.id) !== String(editingCloud?.id)),
                  );
                  if (existingCloud) return Promise.reject(new Error('资源池名称已存在，请使用其他名称'));
                  return Promise.resolve();
                } catch {
                  return Promise.resolve();
                }
              },
            });
          }

          const isEndpointHelp = field.key === 'endpoint';
          const isTokenHelp = field.key === 'apiToken';

          const cloudmapHelpExtra = isEndpointHelp ? (
            <div
              style={{
                marginTop: 8,
                border: '1px solid #eaeaea',
                borderRadius: 8,
                overflow: 'hidden',
                background: '#fff',
              }}
            >
              <Image
                src={cloudmapApiImage}
                alt="如何获取 Cloudmap API 地址"
                preview={{ mask: '点击放大' }}
                style={{
                  maxWidth: '100%',
                  height: 'auto',
                  display: 'block',
                  cursor: 'pointer',
                }}
              />
              <div
                style={{
                  color: '#777777',
                  fontSize: 12,
                  lineHeight: 1.5,
                  padding: '10px 12px',
                  borderTop: '1px solid #f0f0f0',
                  background: '#fafafa',
                }}
              >
                在Cloudmap控制台中，进入账号和API密钥页面，复制端点地址
              </div>
            </div>
          ) : isTokenHelp ? (
            <div
              style={{
                marginTop: 8,
                border: '1px solid #eaeaea',
                borderRadius: 8,
                overflow: 'hidden',
                background: '#fff',
              }}
            >
              <Image
                src={cloudmapKeyImage}
                alt="如何获取 API 令牌"
                preview={{ mask: '点击放大' }}
                style={{
                  maxWidth: '100%',
                  height: 'auto',
                  display: 'block',
                  cursor: 'pointer',
                }}
              />
              <div
                style={{
                  color: '#777777',
                  fontSize: 12,
                  lineHeight: 1.5,
                  padding: '10px 12px',
                  borderTop: '1px solid #f0f0f0',
                  background: '#fafafa',
                }}
              >
                创建令牌时，是唯一查看令牌的机会。如果丢失则需要重新创建API密钥
              </div>
            </div>
          ) : undefined;

          return (
            <Form.Item key={field.key} name={field.key} label={field.label} rules={rules} extra={cloudmapHelpExtra}>
              {inputElement}
            </Form.Item>
          );
        })}

        <Form.Item name="ignoreTls" label="忽略TLS证书校验" valuePropName="checked" initialValue={true}>
          <Switch />
        </Form.Item>
      </Form>
    </div>
  );

  return (
    <>
      <Modal
        title={isEdit ? '编辑边缘云' : '接入边缘云'}
        open={visible}
        onCancel={handleCancel}
        closable
        maskClosable
        keyboard
        width={640}
        centered
        destroyOnHidden
        styles={{ body: { maxHeight: 'min(80vh, 720px)', overflowY: 'auto', paddingTop: 8 } }}
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
                  <Text type="secondary">正在测试连接…</Text>
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
                    title={testResult.message || (testResult.success ? '连接成功' : '连接失败')}
                  >
                    {testResult.message || (testResult.success ? '连接成功' : '连接失败')}
                  </span>
                </>
              )}
            </div>
            <Space style={{ flexShrink: 0 }}>
              <Button onClick={handleFooterConnectionTest} loading={loading}>
                连接测试
              </Button>
              <Button onClick={handleCancel}>
                {forceRequired && !isEdit ? '稍后接入' : '取消'}
              </Button>
              <Button type="primary" onClick={handleFooterSave} loading={loading}>
                保存
              </Button>
            </Space>
          </div>
        }
      >
        {renderForm()}
      </Modal>
      <Modal
        title="验证管理员密码"
        open={revealVisible}
        onOk={handleRevealConfirm}
        confirmLoading={revealLoading}
        onCancel={() => setRevealVisible(false)}
        width={400}
        destroyOnHidden
        centered
        okText="确定"
        cancelText="取消"
      >
        <Input.Password
          placeholder="请输入管理员密码"
          value={adminPassword}
          onChange={(e) => setAdminPassword(e.target.value)}
          onPressEnter={handleRevealConfirm}
          autoComplete="new-password"
        />
      </Modal>
    </>
  );
};

export default CloudWizard;
