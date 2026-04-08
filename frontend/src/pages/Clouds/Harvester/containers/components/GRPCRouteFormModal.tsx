/**
 * ==============================================================================
 * 模块名称: GRPCRoute 创建弹窗 (GRPCRouteFormModal)
 * 文件路径: src/pages/Clouds/Harvester/containers/components/GRPCRouteFormModal.tsx
 * ==============================================================================
 */

import React from 'react';
import { Modal } from 'antd';
import { ApiOutlined } from '@ant-design/icons';
import GRPCRouteForm from './GRPCRouteForm';

export interface GRPCRouteFormModalProps {
  visible: boolean;
  cloudId: string;
  namespacesOptions: string[];
  gateways: any[];
  services?: any[];
  onSuccess: () => void;
  onCancel: () => void;
  defaultNamespace?: string;
}

const GRPCRouteFormModal: React.FC<GRPCRouteFormModalProps> = ({
  visible,
  cloudId,
  namespacesOptions,
  gateways,
  services,
  onSuccess,
  onCancel,
  defaultNamespace,
}) => {
  return (
    <Modal
      title={
        <span>
          <ApiOutlined style={{ marginRight: 8 }} />
          创建 GRPCRoute
        </span>
      }
      open={visible}
      onCancel={onCancel}
      footer={null}
      width={800}
      destroyOnClose
      maskClosable={false}
    >
      <GRPCRouteForm
        cloudId={cloudId}
        namespacesOptions={namespacesOptions}
        gateways={gateways}
        services={services}
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

export default GRPCRouteFormModal;
