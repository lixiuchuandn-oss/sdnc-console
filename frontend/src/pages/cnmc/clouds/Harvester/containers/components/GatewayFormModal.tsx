/**
 * ==============================================================================
 * 模块名称: Gateway 创建弹窗 (GatewayFormModal)
 * 文件路径: frontend/src/pages/cnmc/clouds/Harvester/containers/components/GatewayFormModal.tsx
 * ==============================================================================
 * 
 * [功能描述]
 * Gateway 创建表单的弹窗包装组件，提供统一的弹窗入口。
 */

import React from 'react';
import { Modal } from 'antd';
import { GatewayOutlined } from '@ant-design/icons';
import GatewayForm from './GatewayForm';

export interface GatewayFormModalProps {
  visible: boolean;
  cloudId: string;
  namespacesOptions: string[];
  gatewayClasses: any[];
  onSuccess: () => void;
  onCancel: () => void;
  defaultNamespace?: string;
}

const GatewayFormModal: React.FC<GatewayFormModalProps> = ({
  visible,
  cloudId,
  namespacesOptions,
  gatewayClasses,
  onSuccess,
  onCancel,
  defaultNamespace,
}) => {
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
        onSuccess={() => {
          onSuccess();
          onCancel();
        }}
        onCancel={onCancel}
        defaultNamespace={defaultNamespace}
      />
    </Modal>
  );
};

export default GatewayFormModal;
