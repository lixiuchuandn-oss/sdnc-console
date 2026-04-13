/**
 * ==============================================================================
 * 模块名称: HTTPRoute 创建弹窗 (HTTPRouteFormModal)
 * 文件路径: frontend/src/pages/cnmc/clouds/Harvester/containers/components/HTTPRouteFormModal.tsx
 * ==============================================================================
 */

import React from 'react';
import { Modal } from 'antd';
import { ApiOutlined } from '@ant-design/icons';
import HTTPRouteForm from './HTTPRouteForm';

export interface HTTPRouteFormModalProps {
  visible: boolean;
  cloudId: string;
  namespacesOptions: string[];
  gateways: any[];
  services?: any[];
  onSuccess: () => void;
  onCancel: () => void;
  defaultNamespace?: string;
}

const HTTPRouteFormModal: React.FC<HTTPRouteFormModalProps> = ({
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
          创建 HTTPRoute
        </span>
      }
      open={visible}
      onCancel={onCancel}
      footer={null}
      width={800}
      destroyOnClose
      maskClosable={false}
    >
      <HTTPRouteForm
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

export default HTTPRouteFormModal;
