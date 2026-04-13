/**
 * ==============================================================================
 * 模块名称: 镜像仓库浏览器抽屉组件 (RegistryBrowserDrawer)
 * 文件路径: frontend/src/pages/cnmc/clouds/Harvester/containers/components/RegistryBrowserDrawer.tsx
 * ==============================================================================
 * 
 * [功能描述]
 * 以抽屉形式展示镜像仓库浏览器，用于浏览仓库中的镜像和标签。
 * 支持两种使用场景：
 * 1. 仓库管理页面 - 仅浏览（无选择功能）
 * 2. 工作负载创建 - 选择镜像后回调
 */

import React, { useCallback, useState } from 'react';
import { Drawer, Typography, Space, Tag, Button, message, Divider, Alert, Select } from 'antd';
import { CheckCircleOutlined, CopyOutlined, DatabaseOutlined, InfoCircleOutlined } from '@ant-design/icons';
import RegistryBrowser, { RegistryCredential } from './RegistryBrowser';

const { Text } = Typography;

/**
 * 组件属性接口
 */
export interface RegistryBrowserDrawerProps {
  visible: boolean;
  cloudId: string;
  credential: RegistryCredential | null;
  onClose: () => void;
  /** 选择镜像回调（可选，传入时为选择模式） */
  onSelectImage?: (image: string) => void;
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
}) => {
  const [selectedImage, setSelectedImage] = useState<string | null>(null);

  // 是否为选择模式
  const isSelectMode = !!onSelectImage;

  // 是否显示仓库选择器
  const showRegistrySelector = registries.length > 1;

  // 处理镜像选择
  const handleSelectImage = useCallback((image: string) => {
    setSelectedImage(image);
    // 选择模式下，自动触发回调
    if (isSelectMode) {
      onSelectImage!(image);
      setSelectedImage(null);
      onClose();
    }
  }, [isSelectMode, onSelectImage, onClose]);

  // 复制镜像地址
  const handleCopyImage = useCallback(() => {
    if (selectedImage) {
      navigator.clipboard.writeText(selectedImage);
      message.success('已复制到剪贴板');
    }
  }, [selectedImage]);

  // 关闭时重置状态
  const handleClose = useCallback(() => {
    setSelectedImage(null);
    onClose();
  }, [onClose]);

  // 确认选择
  const handleConfirm = useCallback(() => {
    if (selectedImage && onSelectImage) {
      onSelectImage(selectedImage);
      handleClose();
    }
  }, [selectedImage, onSelectImage, handleClose]);

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

  // 凭证为空时不渲染内容
  if (!credential) {
    return (
      <Drawer
        title={
          <Space>
            <DatabaseOutlined style={{ color: '#1890ff' }} />
            <span>浏览镜像仓库</span>
          </Space>
        }
        placement="right"
        width={720}
        open={visible}
        onClose={handleClose}
      >
        <div style={{ textAlign: 'center', padding: 60, color: '#999' }}>
          <DatabaseOutlined style={{ fontSize: 48, marginBottom: 16, opacity: 0.3 }} />
          <p>请选择要浏览的仓库</p>
        </div>
      </Drawer>
    );
  }

  return (
    <Drawer
      title={
        <Space>
          <DatabaseOutlined style={{ color: '#1890ff' }} />
          <span>浏览镜像仓库</span>
          <Tag color="blue">{credential.server}</Tag>
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
        credential={credential}
        onSelectImage={handleSelectImage}
        currentImage={currentImage}
      />
    </Drawer>
  );
};

export default RegistryBrowserDrawer;
