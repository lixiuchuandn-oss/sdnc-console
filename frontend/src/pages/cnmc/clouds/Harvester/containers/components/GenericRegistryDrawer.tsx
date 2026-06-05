/**
 * ==============================================================================
 * 模块名称: 通用 Docker 仓库管理抽屉 (GenericRegistryDrawer)
 * 文件路径: frontend/src/pages/cnmc/clouds/Harvester/containers/components/GenericRegistryDrawer.tsx
 * ==============================================================================
 * 
 * [功能描述]
 * 通用 Docker 仓库的管理界面，包括：
 * - 概览：仓库地址、协议、认证状态、推送命令
 * - 镜像：镜像列表和 Tag
 */

import React, { useState, useCallback, useMemo } from 'react';
import { Drawer, Tabs, Card, Descriptions, Tag, Space, Statistic, Alert, Button, Typography, message } from 'antd';
import { 
  LockOutlined, 
  UnlockOutlined, 
  DockerOutlined,
  ApiOutlined,
  ReloadOutlined,
  UploadOutlined,
} from '@ant-design/icons';
import RegistryBrowser from './RegistryBrowser';
import ImageUploadModal from './ImageUploadModal';
import { getRegistryCatalog } from '../../../../../../services/harvesterApi';
import { refreshLocalRegistryStatus } from '../../../../../../services/localRegistryApi';

const { Text, Paragraph } = Typography;

interface RegistryConfig {
  id: string;
  name: string;
  server: string;
  username?: string;
  password?: string;
  insecure: boolean;
  createdAt: string;
  type?: 'generic' | 'harbor' | 'local';
  localRegistryId?: string;
  namespace?: string;
  nodePort?: number;
}

interface Props {
  visible: boolean;
  registry: RegistryConfig | null;
  cloudId: string;
  onClose: () => void;
  onRefresh?: () => void;
}

const GenericRegistryDrawer: React.FC<Props> = ({
  visible,
  registry,
  cloudId,
  onClose,
  onRefresh,
}) => {
  const [activeTab, setActiveTab] = useState('overview');
  const [testing, setTesting] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<'unknown' | 'healthy' | 'unhealthy'>('unknown');
  const [uploadModalVisible, setUploadModalVisible] = useState(false);

  const protocol = registry?.insecure ? 'HTTP' : 'HTTPS';
  const hasAuth = !!registry?.username;

  const handleTestConnection = useCallback(async () => {
    if (!registry) return;
    setTesting(true);
    setConnectionStatus('unknown');
    try {
      await getRegistryCatalog(
        cloudId,
        registry.server,
        registry.username,
        registry.password,
        registry.insecure,
        1,
      );
      setConnectionStatus('healthy');
      message.success('连接测试成功');
      
      // 如果是本地仓库，调用后端 API 持久化状态
      if (registry.localRegistryId) {
        try {
          await refreshLocalRegistryStatus(cloudId, registry.localRegistryId);
        } catch (e) {
          console.warn('持久化本地仓库状态失败:', e);
        }
      }
      
      // 通知外层表格刷新
      if (onRefresh) {
        onRefresh();
      }
    } catch (e: any) {
      setConnectionStatus('unhealthy');
      message.error(e?.message || '连接测试失败');
      
      // 如果是本地仓库，调用后端 API 持久化状态
      if (registry.localRegistryId) {
        try {
          await refreshLocalRegistryStatus(cloudId, registry.localRegistryId);
        } catch (err) {
          console.warn('持久化本地仓库状态失败:', err);
        }
      }
      
      // 通知外层表格刷新
      if (onRefresh) {
        onRefresh();
      }
    } finally {
      setTesting(false);
    }
  }, [registry, cloudId, onRefresh]);

  const registryCredential = useMemo(() => {
    if (!registry) return null;
    return {
      name: registry.name,
      server: registry.server,
      username: registry.username,
      password: registry.password,
      insecure: registry.insecure,
    };
  }, [registry]);

  const formatTime = (time: string) => {
    if (!time) return '-';
    try {
      return new Date(time).toLocaleString('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return time;
    }
  };

  const tabItems = [
    {
      key: 'overview',
      label: '概览',
      children: registry && (
        <div style={{ padding: '16px 0' }}>
          <Card size="small" style={{ marginBottom: 16 }}>
            <Space split={<div style={{ width: 1, height: 40, background: '#f0f0f0' }} />} wrap>
              <Statistic 
                title="协议" 
                value={protocol}
                prefix={registry.insecure ? <UnlockOutlined /> : <LockOutlined />}
                valueStyle={{ 
                  fontSize: 16,
                  color: registry.insecure ? '#fa8c16' : '#52c41a'
                }}
              />
              <Statistic 
                title="认证" 
                value={hasAuth ? '已配置' : '无需认证'}
                prefix={hasAuth ? <LockOutlined /> : <UnlockOutlined />}
                valueStyle={{ 
                  fontSize: 16,
                  color: hasAuth ? '#1890ff' : '#8c8c8c'
                }}
              />
              <Statistic 
                title="连接状态" 
                value={
                  connectionStatus === 'unknown' ? '未测试' :
                  connectionStatus === 'healthy' ? '正常' : '异常'
                }
                prefix={<ApiOutlined />}
                valueStyle={{ 
                  fontSize: 16,
                  color: connectionStatus === 'healthy' ? '#52c41a' : 
                         connectionStatus === 'unhealthy' ? '#ff4d4f' : '#8c8c8c'
                }}
              />
            </Space>
          </Card>

          <Descriptions column={1} bordered size="small">
            <Descriptions.Item label="仓库名称">
              <Text strong>{registry.name}</Text>
            </Descriptions.Item>
            <Descriptions.Item label="仓库地址">
              <Space>
                <Text code copyable={{ text: registry.server }}>{registry.server}</Text>
              </Space>
            </Descriptions.Item>
            <Descriptions.Item label="协议类型">
              <Tag color={registry.insecure ? 'orange' : 'green'}>
                {registry.insecure ? 'HTTP' : 'HTTPS'}
              </Tag>
              {registry.insecure && (
                <Text type="secondary" style={{ marginLeft: 8 }}>
                  (非安全连接)
                </Text>
              )}
            </Descriptions.Item>
            <Descriptions.Item label="认证信息">
              {hasAuth ? (
                <Space>
                  <Tag color="blue" icon={<LockOutlined />}>已配置</Tag>
                  <Text type="secondary">用户名: {registry.username}</Text>
                </Space>
              ) : (
                <Tag icon={<UnlockOutlined />}>公开仓库，无需认证</Tag>
              )}
            </Descriptions.Item>
            <Descriptions.Item label="添加时间">
              {formatTime(registry.createdAt)}
            </Descriptions.Item>
          </Descriptions>

          <Alert
            type="info"
            showIcon
            style={{ marginTop: 16 }}
            message="推送镜像命令"
            description={
              <div>
                <Paragraph style={{ marginBottom: 8 }}>
                  <Text code copyable>
                    docker login {registry.server}
                  </Text>
                </Paragraph>
                <Paragraph style={{ marginBottom: 8 }}>
                  <Text code copyable>
                    {`docker tag <image> ${registry.server}/<repository>:<tag>`}
                  </Text>
                </Paragraph>
                <Paragraph style={{ marginBottom: 0 }}>
                  <Text code copyable>
                    {`docker push ${registry.server}/<repository>:<tag>`}
                  </Text>
                </Paragraph>
              </div>
            }
          />
        </div>
      ),
    },
    {
      key: 'images',
      label: '镜像',
      children: registryCredential && (
        <div style={{ padding: '16px 0' }}>
          <Alert
            type="info"
            showIcon
            message="点击镜像名称展开，点击 Tag 可复制完整镜像地址"
            style={{ marginBottom: 16 }}
          />
          <RegistryBrowser
            cloudId={cloudId}
            credential={registryCredential}
          />
        </div>
      ),
    },
  ];

  if (!registry) return null;

  return (
    <Drawer
      title={
        <Space>
          <DockerOutlined style={{ color: '#2496ED', fontSize: '1.4em' }} />
          <span>{registry.name}</span>
        </Space>
      }
      placement="right"
      width={720}
      open={visible}
      onClose={onClose}
      destroyOnClose
      extra={
        <Space>
          <Button 
            type="primary"
            icon={<UploadOutlined />} 
            onClick={() => setUploadModalVisible(true)}
          >
            上传镜像
          </Button>
          <Button 
            icon={<ApiOutlined />} 
            loading={testing}
            onClick={handleTestConnection}
          >
            测试连接
          </Button>
          {onRefresh && (
            <Button icon={<ReloadOutlined />} onClick={onRefresh}>
              刷新
            </Button>
          )}
        </Space>
      }
    >
      <Tabs
        activeKey={activeTab}
        onChange={setActiveTab}
        items={tabItems}
      />
      
      {/* 上传镜像弹窗 */}
      {registry && (
        <ImageUploadModal
          visible={uploadModalVisible}
          cloudId={cloudId}
          registryId={registry.localRegistryId}
          registryServer={registry.server}
          insecure={registry.insecure}
          username={registry.username}
          password={registry.password}
          onCancel={() => setUploadModalVisible(false)}
          onSuccess={() => {
            setUploadModalVisible(false);
            onRefresh?.();
          }}
        />
      )}
    </Drawer>
  );
};

export default GenericRegistryDrawer;
