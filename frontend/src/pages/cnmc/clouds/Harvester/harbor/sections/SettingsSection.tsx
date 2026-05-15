/**
 * Harbor 设置 Section
 * 
 * 管理 Harbor 实例的连接配置和凭证同步，包括：
 * - 基本信息编辑
 * - 连接配置（URL、用户名、密码）
 * - 凭证同步设置
 * - Docker 配置说明
 */

import React, { useState, useCallback } from 'react';
import { Card, Form, Input, Switch, Button, Space, Alert, Descriptions, Tag, Modal, Select, App, Divider, Tooltip, Badge, Collapse, Typography } from 'antd';
import { 
  SaveOutlined, 
  SyncOutlined,
  ApiOutlined,
  LockOutlined,
  GlobalOutlined,
  SafetyCertificateOutlined,
  CopyOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  InfoCircleOutlined,
  SettingOutlined,
  CloudServerOutlined,
  CodeOutlined,
} from '@ant-design/icons';
import type { HarborRegistry, HarborRegistryForm, HarborSyncSecretParams } from '../types';
import { updateHarborRegistry, syncHarborSecret, testHarborConnection } from '../shared/harborApi';

const { TextArea } = Input;
const { Panel } = Collapse;
const { Text, Paragraph } = Typography;

interface Props {
  harbor: HarborRegistry;
  onRefresh: () => void;
}

const SettingsSection: React.FC<Props> = ({ harbor, onRefresh }) => {
  const { message, modal } = App.useApp();
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [testing, setTesting] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');
  const [connectionMessage, setConnectionMessage] = useState('');

  /**
   * 保存配置
   */
  const handleSave = useCallback(async (values: Partial<HarborRegistryForm>) => {
    setSaving(true);
    try {
      // 如果密码为空，则不传递密码字段
      const dataToUpdate = { ...values };
      if (!dataToUpdate.password) {
        delete (dataToUpdate as any).password;
      }
      
      await updateHarborRegistry(harbor.id, dataToUpdate);
      message.success('配置已保存');
      onRefresh();
    } catch (e: any) {
      message.error(e?.message || '保存配置失败');
    } finally {
      setSaving(false);
    }
  }, [harbor.id, message, onRefresh]);

  /**
   * 测试连接
   */
  const handleTestConnection = useCallback(async () => {
    setTesting(true);
    setConnectionStatus('testing');
    const hide = message.loading('正在测试连接...', 0);
    try {
      const res = await testHarborConnection(harbor.id);
      hide();
      if (res?.success) {
        setConnectionStatus('success');
        setConnectionMessage(`Harbor 版本: ${res.version || '未知'}`);
        message.success(`连接成功！Harbor 版本: ${res.version || '未知'}`);
      } else {
        setConnectionStatus('error');
        setConnectionMessage(res?.message || '连接测试失败');
        message.warning('连接测试失败');
      }
    } catch (e: any) {
      hide();
      setConnectionStatus('error');
      setConnectionMessage(e?.message || '连接测试失败');
      message.error(e?.message || '连接测试失败');
    } finally {
      setTesting(false);
    }
  }, [harbor.id, message]);

  /**
   * 同步凭证到 K8s
   */
  const handleSyncSecret = useCallback(() => {
    let syncParams: HarborSyncSecretParams = {
      cloudId: '',
      namespace: 'default',
    };

    Modal.confirm({
      title: '同步凭证到 Kubernetes',
      icon: <SyncOutlined />,
      width: 500,
      content: (
        <div style={{ marginTop: 16 }}>
          <Form layout="vertical">
            <Form.Item 
              label="目标命名空间" 
              required
              help="将在此命名空间创建 docker-registry 类型的 Secret"
            >
              <Select
                defaultValue="default"
                onChange={(val) => { syncParams.namespace = val; }}
                options={[
                  { label: 'default', value: 'default' },
                  { label: 'kube-system', value: 'kube-system' },
                ]}
                style={{ width: '100%' }}
              />
            </Form.Item>
            <Form.Item label="Secret 名称（可选）">
              <Input 
                placeholder="默认自动生成: harbor-registry"
                onChange={(e) => { syncParams.secretName = e.target.value; }}
              />
            </Form.Item>
          </Form>
          <Alert
            type="info"
            showIcon
            message="凭证同步说明"
            description="将创建或更新 docker-registry 类型的 Secret，使工作负载可以拉取 Harbor 中的私有镜像。"
          />
        </div>
      ),
      onOk: async () => {
        // 注意：实际使用时需要传入正确的 cloudId
        if (!syncParams.cloudId) {
          message.warning('请从资源池详情页执行凭证同步，或手动指定 cloudId');
          return;
        }
        
        setSyncing(true);
        try {
          const result = await syncHarborSecret(harbor.id, syncParams);
          message.success(
            `凭证已同步！Secret: ${result.secretName} (${result.namespace})${result.created ? ' [新建]' : ' [更新]'}`
          );
        } catch (e: any) {
          message.error(e?.message || '同步凭证失败');
        } finally {
          setSyncing(false);
        }
      },
    });
  }, [harbor.id, message]);

  /**
   * 复制到剪贴板
   */
  const copyToClipboard = useCallback((text: string) => {
    navigator.clipboard.writeText(text);
    message.success('已复制到剪贴板');
  }, [message]);

  /**
   * 获取状态徽标
   */
  const getStatusBadge = () => {
    if (connectionStatus === 'success' || harbor.status === 'healthy') {
      return <Badge status="success" text="健康" />;
    }
    if (connectionStatus === 'error' || harbor.status === 'unhealthy') {
      return <Badge status="error" text="异常" />;
    }
    return <Badge status="default" text="未知" />;
  };

  return (
    <div>
      {/* 基本信息 */}
      <Card 
        title={
          <Space>
            <CloudServerOutlined />
            <span>基本信息</span>
          </Space>
        } 
        size="small" 
        style={{ marginBottom: 16 }}
      >
        <Descriptions column={2} bordered size="small">
          <Descriptions.Item label="实例 ID">
            <Tag>{harbor.id}</Tag>
          </Descriptions.Item>
          <Descriptions.Item label="实例名称">
            <Text strong>{harbor.name}</Text>
          </Descriptions.Item>
          <Descriptions.Item label="服务地址">
            <Space>
              <GlobalOutlined style={{ color: '#1890ff' }} />
              <code>{harbor.url}</code>
            </Space>
          </Descriptions.Item>
          <Descriptions.Item label="协议">
            <Tag color={harbor.insecure ? 'orange' : 'green'}>
              {harbor.insecure ? 'HTTP' : 'HTTPS'}
            </Tag>
          </Descriptions.Item>
          <Descriptions.Item label="类型">
            <Tag color={harbor.isBuiltIn ? 'purple' : 'blue'}>
              {harbor.isBuiltIn ? '平台内置' : '外部接入'}
            </Tag>
          </Descriptions.Item>
          <Descriptions.Item label="状态">
            {getStatusBadge()}
          </Descriptions.Item>
          {harbor.version && (
            <Descriptions.Item label="版本">
              <Tag color="blue">{harbor.version}</Tag>
            </Descriptions.Item>
          )}
          {harbor.projectCount !== undefined && (
            <Descriptions.Item label="项目数量">
              {harbor.projectCount}
            </Descriptions.Item>
          )}
          <Descriptions.Item label="创建时间" span={2}>
            {harbor.createdAt ? new Date(harbor.createdAt).toLocaleString('zh-CN') : '-'}
          </Descriptions.Item>
          <Descriptions.Item label="更新时间" span={2}>
            {harbor.updatedAt ? new Date(harbor.updatedAt).toLocaleString('zh-CN') : '-'}
          </Descriptions.Item>
        </Descriptions>
      </Card>

      {/* 连接配置 */}
      <Card 
        title={
          <Space>
            <SettingOutlined />
            <span>连接配置</span>
          </Space>
        } 
        size="small" 
        style={{ marginBottom: 16 }}
      >
        <Form
          form={form}
          layout="vertical"
          onFinish={handleSave}
          initialValues={{
            name: harbor.name,
            url: harbor.url,
            username: harbor.username,
            insecure: harbor.insecure,
          }}
        >
          <Form.Item
            name="name"
            label="显示名称"
            rules={[
              { required: true, message: '请输入显示名称' },
              { max: 64, message: '名称不能超过64个字符' },
            ]}
          >
            <Input placeholder="Harbor 实例名称" />
          </Form.Item>

          <Form.Item
            name="url"
            label="服务地址"
            rules={[
              { required: true, message: '请输入服务地址' },
              { 
                pattern: /^[\w.-]+(:\d+)?$/, 
                message: '请输入有效的域名或IP，如：harbor.example.com 或 192.168.1.100:8080' 
              },
            ]}
            extra="Harbor 服务的访问地址（不含协议前缀），例如：harbor.example.com"
          >
            <Input 
              placeholder="harbor.example.com" 
              prefix={<GlobalOutlined />} 
              addonAfter={
                <Tooltip title="测试连接">
                  <Button 
                    type="text" 
                    size="small" 
                    icon={
                      testing ? <SyncOutlined spin /> :
                      connectionStatus === 'success' ? <CheckCircleOutlined style={{ color: '#52c41a' }} /> :
                      connectionStatus === 'error' ? <CloseCircleOutlined style={{ color: '#ff4d4f' }} /> :
                      <ApiOutlined />
                    }
                    onClick={handleTestConnection}
                    disabled={testing}
                  />
                </Tooltip>
              }
            />
          </Form.Item>

          {connectionStatus !== 'idle' && connectionMessage && (
            <Alert
              type={connectionStatus === 'success' ? 'success' : connectionStatus === 'error' ? 'error' : 'info'}
              message={connectionMessage}
              style={{ marginBottom: 16 }}
              showIcon
            />
          )}

          <Form.Item
            name="username"
            label="管理员用户名"
            rules={[{ required: true, message: '请输入用户名' }]}
          >
            <Input placeholder="admin" prefix={<LockOutlined />} />
          </Form.Item>

          <Form.Item
            name="password"
            label="密码"
            extra="留空则不更新密码"
          >
            <Input.Password placeholder="留空则不更新" />
          </Form.Item>

          <Form.Item
            name="insecure"
            label="跳过 TLS 验证"
            valuePropName="checked"
            tooltip="如果 Harbor 使用自签名证书或 HTTP 协议，需要勾选此项"
          >
            <Switch checkedChildren="是" unCheckedChildren="否" />
          </Form.Item>

          <Form.Item>
            <Space>
              <Button type="primary" htmlType="submit" icon={<SaveOutlined />} loading={saving}>
                保存配置
              </Button>
              <Button icon={<ApiOutlined />} onClick={handleTestConnection} loading={testing}>
                测试连接
              </Button>
            </Space>
          </Form.Item>
        </Form>

        {!harbor.insecure && (
          <Alert
            type="info"
            showIcon
            icon={<SafetyCertificateOutlined />}
            message="HTTPS 安全连接"
            description="当前使用 HTTPS 安全连接。如果 Harbor 使用自签名证书，请确保系统信任该证书，或勾选「跳过 TLS 验证」。"
          />
        )}
      </Card>

      {/* 凭证同步 */}
      <Card 
        title={
          <Space>
            <SyncOutlined />
            <span>凭证同步</span>
          </Space>
        } 
        size="small" 
        style={{ marginBottom: 16 }}
      >
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          message="凭证同步说明"
          description={
            <div>
              <p>将 Harbor 凭证同步到 Kubernetes 集群，创建 docker-registry 类型的 Secret。</p>
              <p>同步后，工作负载可以通过在 imagePullSecrets 中引用该 Secret 来拉取私有镜像。</p>
            </div>
          }
        />
        <Space>
          <Button 
            type="primary"
            icon={<SyncOutlined />} 
            onClick={handleSyncSecret}
            loading={syncing}
          >
            同步凭证到 Kubernetes
          </Button>
        </Space>
      </Card>

      {/* Docker 配置 */}
      <Card 
        title={
          <Space>
            <CodeOutlined />
            <span>Docker 配置</span>
          </Space>
        } 
        size="small"
      >
        <Collapse defaultActiveKey={['login', 'daemon']} ghost>
          <Panel 
            header={
              <Space>
                <span>登录命令</span>
                <Button 
                  type="link" 
                  size="small" 
                  icon={<CopyOutlined />}
                  onClick={(e) => {
                    e.stopPropagation();
                    copyToClipboard(`docker login ${harbor.url}`);
                  }}
                >
                  复制
                </Button>
              </Space>
            } 
            key="login"
          >
            <Paragraph>
              <Text code>docker login {harbor.url}</Text>
            </Paragraph>
            <Alert
              type="warning"
              showIcon
              message="登录时会提示输入用户名和密码"
            />
          </Panel>

          <Panel 
            header={
              <Space>
                <span>推送镜像示例</span>
                <Button 
                  type="link" 
                  size="small" 
                  icon={<CopyOutlined />}
                  onClick={(e) => {
                    e.stopPropagation();
                    copyToClipboard(`# 1. 标记镜像
docker tag myimage:latest ${harbor.url}/myproject/myimage:latest

# 2. 推送镜像
docker push ${harbor.url}/myproject/myimage:latest`);
                  }}
                >
                  复制
                </Button>
              </Space>
            } 
            key="push"
          >
            <div style={{ padding: 12, background: '#f5f5f5', borderRadius: 4 }}>
              <pre style={{ fontSize: 12, margin: 0 }}>
{`# 1. 标记镜像
docker tag myimage:latest ${harbor.url}/myproject/myimage:latest

# 2. 推送镜像
docker push ${harbor.url}/myproject/myimage:latest`}
              </pre>
            </div>
          </Panel>

          <Panel 
            header={
              <Space>
                <span>Docker daemon 配置（可选）</span>
                <Tooltip title="修改后需要重启 Docker 服务">
                  <InfoCircleOutlined style={{ color: '#faad14' }} />
                </Tooltip>
              </Space>
            } 
            key="daemon"
          >
            <div style={{ padding: 12, background: '#f5f5f5', borderRadius: 4 }}>
              <pre style={{ fontSize: 12, margin: 0 }}>
{`{
  "insecure-registries": ["${harbor.url}"],
  "registry-mirrors": ["https://${harbor.url}"]
}`}
              </pre>
            </div>
            <Alert
              type="warning"
              showIcon
              style={{ marginTop: 8 }}
              message="修改 Docker daemon 配置后需要重启 Docker 服务"
            />
          </Panel>

          <Panel header="Kubernetes Secret 配置" key="k8s">
            <div style={{ padding: 12, background: '#f5f5f5', borderRadius: 4, marginBottom: 8 }}>
              <pre style={{ fontSize: 12, margin: 0 }}>
{`kubectl create secret docker-registry harbor-secret \\
  --docker-server=${harbor.url} \\
  --docker-username=${harbor.username} \\
  --docker-password=<password> \\
  --namespace=default`}
              </pre>
            </div>
            <Button 
              size="small" 
              icon={<CopyOutlined />}
              onClick={() => copyToClipboard(`kubectl create secret docker-registry harbor-secret \\
  --docker-server=${harbor.url} \\
  --docker-username=${harbor.username} \\
  --docker-password=<password> \\
  --namespace=default`)}
            >
              复制命令
            </Button>
            
            <Divider />
            
            <div style={{ padding: 12, background: '#f5f5f5', borderRadius: 4, marginBottom: 8 }}>
              <pre style={{ fontSize: 12, margin: 0 }}>
{`# 在 Pod 中使用
apiVersion: v1
kind: Pod
metadata:
  name: my-pod
spec:
  containers:
  - name: my-container
    image: ${harbor.url}/myproject/myimage:latest
  imagePullSecrets:
  - name: harbor-secret`}
              </pre>
            </div>
            <Button 
              size="small" 
              icon={<CopyOutlined />}
              onClick={() => copyToClipboard(`apiVersion: v1
kind: Pod
metadata:
  name: my-pod
spec:
  containers:
  - name: my-container
    image: ${harbor.url}/myproject/myimage:latest
  imagePullSecrets:
  - name: harbor-secret`)}
            >
              复制 YAML
            </Button>
          </Panel>
        </Collapse>
      </Card>
    </div>
  );
};

export default SettingsSection;
