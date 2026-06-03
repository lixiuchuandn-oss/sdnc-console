/**
 * ==============================================================================
 * 模块名称: GRPCRoute 创建弹窗 (GRPCRouteFormModal)
 * 文件路径: frontend/src/pages/cnmc/clouds/Harvester/containers/components/GRPCRouteFormModal.tsx
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
  defaultGateway?: { name: string; namespace: string };
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
  defaultGateway,
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
        defaultGateway={defaultGateway}
      />
    </Modal>
  );
};

export default GRPCRouteFormModal;
