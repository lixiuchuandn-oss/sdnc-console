/**
 * ==============================================================================
 * 模块名称: Gateway 创建弹窗 (GatewayFormModal)
 * 文件路径: frontend/src/pages/cnmc/clouds/Harvester/containers/components/GatewayFormModal.tsx
 * ==============================================================================
 * 
 * [功能描述]
 * Gateway 创建表单的弹窗包装组件，提供统一的弹窗入口。
 * 创建成功后会询问用户是否立即创建路由。
 */

import React from 'react';
import { Modal, Button, Space } from 'antd';
import { GatewayOutlined } from '@ant-design/icons';
import GatewayForm from './GatewayForm';

export interface GatewayFormModalProps {
  visible: boolean;
  cloudId: string;
  namespacesOptions: string[];
  gatewayClasses: any[];
  onSuccess: (gatewayInfo?: { name: string; namespace: string }) => void;
  onCancel: () => void;
  defaultNamespace?: string;
  onCreateRoute?: (type: 'http' | 'grpc', gatewayInfo: { name: string; namespace: string }) => void;
}

const GatewayFormModal: React.FC<GatewayFormModalProps> = ({
  visible,
  cloudId,
  namespacesOptions,
  gatewayClasses,
  onSuccess,
  onCancel,
  defaultNamespace,
  onCreateRoute,
}) => {
  const handleGatewaySuccess = (gatewayInfo?: { name: string; namespace: string }) => {
    // 先关闭Gateway弹窗
    onCancel();
    
    if (gatewayInfo && onCreateRoute) {
      // 延迟弹出确认框，确保Gateway弹窗已完全关闭
      setTimeout(() => {
        const modal = Modal.confirm({
          title: 'Gateway 创建成功',
          content: '是否立即创建路由？',
          width: 520,
          footer: (
            <Space>
              <Button onClick={() => {
                modal.destroy();
                onSuccess(gatewayInfo);
              }}>
                暂不创建
              </Button>
              <Button type="default" onClick={() => {
                modal.destroy();
                onCreateRoute('grpc', gatewayInfo);
                onSuccess(gatewayInfo);
              }}>
                创建 gRPC 路由
              </Button>
              <Button type="primary" onClick={() => {
                modal.destroy();
                onCreateRoute('http', gatewayInfo);
                onSuccess(gatewayInfo);
              }}>
                创建 HTTP 路由
              </Button>
            </Space>
          ),
        });
      }, 100);
    } else {
      onSuccess(gatewayInfo);
    }
  };

  return (
    <Modal
      title={
        <span>
          <GatewayOutlined style={{ marginRight: 8 }} />
          创建 Gateway
        </span>
      }
      open={visible}
      onCancel={onCancel}
      footer={null}
      width={720}
      destroyOnClose
      maskClosable={false}
    >
      <GatewayForm
        cloudId={cloudId}
        namespacesOptions={namespacesOptions}
        gatewayClasses={gatewayClasses}
        onSuccess={handleGatewaySuccess}
        onCancel={onCancel}
        defaultNamespace={defaultNamespace}
      />
    </Modal>
  );
};

export default GatewayFormModal;
