/**
 * ==============================================================================
 * 模块名称: 镜像仓库浏览器抽屉组件 (RegistryBrowserDrawer)
 * 文件路径: frontend/src/pages/cnmc/clouds/Harvester/containers/components/RegistryBrowserDrawer.tsx
 * ==============================================================================
 * 
 * [功能描述]
 * 以抽屉形式展示镜像仓库浏览器，支持多种数据源：
 * 1. 手动输入 - 直接输入镜像地址
 * 2. 已有凭证 - 从已配置的仓库浏览选择
 * 3. 本地仓库 - 浏览本地仓库
 * 4. Harbor 镜像仓库 - 从 Harbor 级联选择
 */

import React, { useCallback, useState, useMemo } from 'react';
import { Drawer, Typography, Space, Tag, Button, message, Divider, Alert, Select, Input, Segmented, Form } from 'antd';
import { 
  CheckCircleOutlined, 
  CopyOutlined, 
  DatabaseOutlined, 
  InfoCircleOutlined,
  EditOutlined,
  FolderOutlined,
  CloudServerOutlined,
  DockerOutlined,
} from '@ant-design/icons';
import RegistryBrowser, { RegistryCredential } from './RegistryBrowser';
import HarborImageSelector from './HarborImageSelector';

const { Text } = Typography;

/**
 * 数据源类型
 */
type DataSourceType = 'manual' | 'secrets' | 'local' | 'harbor';

/**
 * 数据源选项
 */
const DATA_SOURCE_OPTIONS = [
  { value: 'manual', label: '手动输入' },
  { value: 'secrets', label: '已有凭证' },
  { value: 'local', label: '本地仓库' },
  { value: 'harbor', label: 'Harbor 镜像仓库' },
];

/**
 * 组件属性接口
 */
export interface RegistryBrowserDrawerProps {
  visible: boolean;
  cloudId: string;
  credential: RegistryCredential | null;
  onClose: () => void;
  /** 选择镜像回调（可选，传入时为选择模式） */
  onSelectImage?: (image: string, secret?: string) => void;
  /** 可选的仓库列表（用于仓库切换） */
  registries?: Array<{
    id: string;
    name: string;
    server: string;
    username?: string;
    password?: string;
    insecure: boolean;
    source?: string;
  }>;
  /** 仓库变更回调 */
  onRegistryChange?: (credential: RegistryCredential) => void;
  /** 当前选中的镜像地址（用于高亮显示） */
  currentImage?: string;
  /** 目标命名空间（用于 Harbor 凭证同步） */
  namespace?: string;
}

/**
 * RegistryBrowserDrawer 组件
 */
const RegistryBrowserDrawer: React.FC<RegistryBrowserDrawerProps> = ({
  visible,
  cloudId,
  credential,
  onClose,
  onSelectImage,
  registries = [],
  onRegistryChange,
  currentImage,
  namespace = 'default',
}) => {
  // 当前选中的镜像
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  // 当前选中的凭证
  const [selectedSecret, setSelectedSecret] = useState<string | undefined>();
  // 数据源类型
  const [dataSource, setDataSource] = useState<DataSourceType>('secrets');
  // 手动输入的镜像地址
  const [manualImage, setManualImage] = useState<string>('');

  // 是否为选择模式
  const isSelectMode = !!onSelectImage;

  // 是否显示仓库选择器
  const showRegistrySelector = registries.length > 1;

  // 重置状态
  const resetState = useCallback(() => {
    setSelectedImage(null);
    setSelectedSecret(undefined);
    setManualImage('');
  }, []);

  // 处理数据源切换
  const handleDataSourceChange = useCallback((value: DataSourceType) => {
    setDataSource(value);
    resetState();
  }, [resetState]);

  // 处理镜像选择（从已有凭证浏览）
  const handleSelectImage = useCallback((image: string) => {
    setSelectedImage(image);
    // 选择模式下，自动触发回调
    if (isSelectMode) {
      onSelectImage!(image);
      setSelectedImage(null);
      onClose();
    }
  }, [isSelectMode, onSelectImage, onClose]);

  // 处理镜像选择（从 Harbor）
  const handleHarborSelect = useCallback((imageRef: string, secret?: string) => {
    setSelectedImage(imageRef);
    setSelectedSecret(secret);
    if (isSelectMode) {
      onSelectImage!(imageRef, secret);
      setSelectedImage(null);
      onClose();
    }
  }, [isSelectMode, onSelectImage, onClose]);

  // 处理手动输入确认
  const handleManualConfirm = useCallback(() => {
    if (!manualImage.trim()) {
      message.warning('请输入镜像地址');
      return;
    }
    if (isSelectMode) {
      onSelectImage!(manualImage.trim());
      setManualImage('');
      onClose();
    }
  }, [manualImage, isSelectMode, onSelectImage, onClose]);

  // 复制镜像地址
  const handleCopyImage = useCallback(() => {
    if (selectedImage) {
      navigator.clipboard.writeText(selectedImage);
      message.success('已复制到剪贴板');
    }
  }, [selectedImage]);

  // 关闭时重置状态
  const handleClose = useCallback(() => {
    resetState();
    onClose();
  }, [resetState, onClose]);

  // 确认选择
  const handleConfirm = useCallback(() => {
    if (selectedImage && onSelectImage) {
      onSelectImage(selectedImage, selectedSecret);
      handleClose();
    }
  }, [selectedImage, selectedSecret, onSelectImage, handleClose]);

  // 处理仓库切换
  const handleRegistryChange = useCallback((registryId: string) => {
    const registry = registries.find(r => r.id === registryId);
    if (registry && onRegistryChange) {
      onRegistryChange({
        name: registry.name,
        namespace: 'default',
        server: registry.server,
        username: registry.username,
        password: registry.password,
        insecure: registry.insecure,
      });
    }
  }, [registries, onRegistryChange]);

  // 获取数据源图标
  const getDataSourceIcon = useMemo(() => {
    const icons: Record<DataSourceType, React.ReactNode> = {
      manual: <EditOutlined />,
      secrets: <FolderOutlined />,
      local: <DockerOutlined />,
      harbor: <CloudServerOutlined />,
    };
    return icons[dataSource];
  }, [dataSource]);

  // 渲染数据源内容
  const renderDataSourceContent = useMemo(() => {
    switch (dataSource) {
      case 'manual':
        return (
          <div style={{ padding: '24px 0' }}>
            <Alert
              type="info"
              showIcon
              message="直接输入镜像地址"
              description="输入完整的镜像地址，例如: nginx:latest 或 harbor.example.com/library/nginx:v1.0"
              style={{ marginBottom: 16 }}
            />
            <Input
              placeholder="输入镜像地址，例如: nginx:latest"
              value={manualImage}
              onChange={(e) => setManualImage(e.target.value)}
              onPressEnter={handleManualConfirm}
              size="large"
              suffix={
                <Button 
                  type="primary" 
                  size="small" 
                  onClick={handleManualConfirm}
                  disabled={!manualImage.trim()}
                >
                  确认
                </Button>
              }
            />
          </div>
        );

      case 'harbor':
        return (
          <div style={{ padding: '24px 0' }}>
            <HarborImageSelector
              cloudId={cloudId}
              namespace={namespace}
              onSelect={handleHarborSelect}
            />
          </div>
        );

      case 'secrets':
      case 'local':
        // 已有凭证 和 本地仓库 使用现有的 RegistryBrowser
        if (!credential) {
          return (
            <div style={{ textAlign: 'center', padding: 60, color: '#999' }}>
              <DatabaseOutlined style={{ fontSize: 48, marginBottom: 16, opacity: 0.3 }} />
              <p>请选择要浏览的仓库</p>
            </div>
          );
        }

        return (
          <>
            {/* 仓库选择器（当有多个仓库时显示） */}
            {showRegistrySelector && (
              <div style={{ marginBottom: 16 }}>
                <Space style={{ width: '100%' }} direction="vertical" size={8}>
                  <Text strong>切换仓库：</Text>
                  <Select
                    value={registries.find(r => r.server === credential.server)?.id}
                    onChange={handleRegistryChange}
                    placeholder="选择要浏览的仓库"
                    style={{ width: '100%' }}
                    options={registries.map((registry) => {
                      const sourceLabel = registry.source === 'localStorage' ? '本地' : 'K8s';
                      return {
                        label: `${registry.name} (${registry.server}) [${sourceLabel}]`,
                        value: registry.id,
                      };
                    })}
                  />
                </Space>
                <Divider style={{ margin: '12px 0' }} />
              </div>
            )}

            <RegistryBrowser
              cloudId={cloudId}
              credential={{
                ...credential,
                insecure: credential?.insecure ?? true,
              }}
              onSelectImage={handleSelectImage}
              currentImage={currentImage}
            />
          </>
        );

      default:
        return null;
    }
  }, [
    dataSource, 
    credential, 
    showRegistrySelector, 
    registries, 
    handleRegistryChange, 
    cloudId, 
    handleSelectImage, 
    currentImage,
    manualImage,
    handleManualConfirm,
    namespace,
    handleHarborSelect,
  ]);

  return (
    <Drawer
      title={
        <Space>
          <DatabaseOutlined style={{ color: '#1890ff' }} />
          <span>选择镜像</span>
          {dataSource !== 'manual' && credential && (
            <Tag color="blue">{credential.server}</Tag>
          )}
        </Space>
      }
      placement="right"
      width={720}
      open={visible}
      onClose={handleClose}
      destroyOnClose
      footer={
        isSelectMode ? (
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Space>
              {selectedImage && (
                <>
                  <CheckCircleOutlined style={{ color: '#52c41a' }} />
                  <Text>已选择：</Text>
                  <Text code style={{ maxWidth: 320, display: 'inline-block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {selectedImage}
                  </Text>
                  <Button
                    type="text"
                    size="small"
                    icon={<CopyOutlined />}
                    onClick={handleCopyImage}
                  />
                </>
              )}
            </Space>
            <Space>
              <Button onClick={handleClose}>取消</Button>
              <Button type="primary" onClick={handleConfirm} disabled={!selectedImage}>
                确认选择
              </Button>
            </Space>
          </div>
        ) : (
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Alert
              type="info"
              showIcon
              icon={<InfoCircleOutlined />}
              message="点击镜像名称可复制完整镜像地址"
              style={{ padding: '4px 12px' }}
            />
            <Button onClick={handleClose}>关闭</Button>
          </div>
        )
      }
    >
      {/* 数据源选择器 */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ marginBottom: 8 }}>
          <Text strong>数据源：</Text>
        </div>
        <Segmented
          value={dataSource}
          onChange={(v) => handleDataSourceChange(v as DataSourceType)}
          options={DATA_SOURCE_OPTIONS.map(opt => ({
            ...opt,
            icon: opt.value === 'manual' ? <EditOutlined /> :
                  opt.value === 'secrets' ? <FolderOutlined /> :
                  opt.value === 'local' ? <DockerOutlined /> :
                  <CloudServerOutlined />,
          }))}
          block
        />
      </div>

      <Divider style={{ margin: '16px 0' }} />

      {/* 数据源内容 */}
      {renderDataSourceContent}
    </Drawer>
  );
};

export default RegistryBrowserDrawer;
