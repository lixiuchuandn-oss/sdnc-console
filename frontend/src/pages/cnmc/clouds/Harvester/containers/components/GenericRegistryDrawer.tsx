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

import React, { useState, useCallback, useMemo, useEffect } from 'react';
import { Drawer, Tabs, Card, Descriptions, Tag, Space, Statistic, Alert, Button, Typography, message } from 'antd';
import { 
  LockOutlined, 
  UnlockOutlined, 
  DockerOutlined,
  ApiOutlined,
  ReloadOutlined,
  UploadOutlined,
  UnorderedListOutlined,
} from '@ant-design/icons';
import RegistryBrowser from './RegistryBrowser';
import ImageUploadModal from './ImageUploadModal';
import LocalRegistryUploadTasksDrawer from './LocalRegistryUploadTasksDrawer';
import { testRegistryConnection } from '../../../../../../services/harvesterApi';
import {
  configureLocalRegistryPull,
  refreshLocalRegistryStatus,
  testLocalRegistryConnection,
} from '../../../../../../services/localRegistryApi';

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
  authEnabled?: boolean;
  status?: 'healthy' | 'unhealthy' | 'unknown' | 'deploying' | 'deleting';
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
  const [uploadTasksDrawerVisible, setUploadTasksDrawerVisible] = useState(false);
  const [registryBrowserKey, setRegistryBrowserKey] = useState(0);
  const syncClusterPullConfig = useCallback(async () => {
    if (!registry?.localRegistryId) return false;
    try {
      await configureLocalRegistryPull(cloudId, registry.localRegistryId);
      return true;
    } catch (e: any) {
      message.warning(e?.message || '同步集群拉取配置失败');
      return false;
    }
  }, [registry?.localRegistryId, cloudId, message]);

  // 从 registry.status 初始化 connectionStatus
  useEffect(() => {
    if (registry?.status) {
      // 将外部表格的状态映射到详情抽屉的连接状态
      const statusMap: Record<string, 'unknown' | 'healthy' | 'unhealthy'> = {
        healthy: 'healthy',
        unhealthy: 'unhealthy',
        unknown: 'unknown',
        deploying: 'unknown',
        deleting: 'unknown',
      };
      setConnectionStatus(statusMap[registry.status] || 'unknown');
    } else {
      setConnectionStatus('unknown');
    }
  }, [registry]);

  const protocol = registry?.insecure ? 'HTTP' : 'HTTPS';
  const hasAuth = !!(registry?.authEnabled || registry?.username);

  const handleTestConnection = useCallback(async () => {
    if (!registry) return;
    setTesting(true);
    setConnectionStatus('unknown');
    try {
      if (registry.localRegistryId) {
        await testLocalRegistryConnection(cloudId, registry.localRegistryId);
      } else {
        await testRegistryConnection(
          cloudId,
          registry.server,
          registry.username,
          registry.password,
          registry.insecure,
        );
      }
      setConnectionStatus('healthy');
      message.success('连接测试成功');

      if (registry.localRegistryId) {
        await syncClusterPullConfig();
        try {
          await refreshLocalRegistryStatus(cloudId, registry.localRegistryId);
        } catch (e) {
          console.warn('持久化本地仓库状态失败:', e);
        }
        message.info('已尝试同步集群 HTTP 拉取配置，请等待 1～2 分钟后重启 Pod');
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
  }, [registry, cloudId, onRefresh, syncClusterPullConfig, message]);

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
                value={hasAuth ? '已启用' : '无需认证'}
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
                  <Tag color="blue" icon={<LockOutlined />}>已启用</Tag>
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

          {registry.localRegistryId && (
            <Alert
              type="warning"
              showIcon
              style={{ marginTop: 16 }}
              message="集群拉取说明"
              description={
                <>
                  本地仓库使用 HTTP，节点拉取镜像前需将 <Text code>{registry.server}</Text> 加入
                  Harvester containerd-registry。部署/上传成功后会自动配置；若 Pod 仍报
                  「HTTP response to HTTPS client」，请点击右上角「测试连接」重新同步配置。
                </>
              }
            />
          )}

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
            key={registryBrowserKey}
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
            icon={<UnorderedListOutlined />}
            onClick={() => setUploadTasksDrawerVisible(true)}
          >
            推送任务
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
          onTaskCreated={() => {
            setUploadTasksDrawerVisible(true);
          }}
        />
      )}

      {registry && (
        <LocalRegistryUploadTasksDrawer
          visible={uploadTasksDrawerVisible}
          cloudId={cloudId}
          registryId={registry.localRegistryId}
          registryServer={registry.localRegistryId ? undefined : registry.server}
          onClose={() => setUploadTasksDrawerVisible(false)}
          onTasksChanged={() => {
            setRegistryBrowserKey((k) => k + 1);
            onRefresh?.();
          }}
        />
      )}
    </Drawer>
  );
};

export default GenericRegistryDrawer;
