/**
 * ==============================================================================
 * 模块名称: NetworkPolicy 创建/编辑弹窗
 * 文件路径: src/pages/Clouds/Harvester/containers/components/NetworkPolicyFormModal.tsx
 * ==============================================================================
 */

import React from 'react';
import { Modal } from 'antd';
import NetworkPolicyForm from './NetworkPolicyForm';

interface Props {
  visible: boolean;
  cloudId: string;
  namespacesOptions: string[];
  defaultNamespace?: string;
  onSuccess: () => void;
  onCancel: () => void;
  mode?: 'create' | 'edit';
  initialData?: any;
}

const NetworkPolicyFormModal: React.FC<Props> = ({
  visible,
  cloudId,
  namespacesOptions,
  defaultNamespace,
  onSuccess,
  onCancel,
  mode = 'create',
  initialData,
}) => {
  const isEdit = mode === 'edit';

  return (
    <Modal
      title={isEdit ? '编辑网络策略' : '创建网络策略'}
      open={visible}
      onCancel={onCancel}
      footer={null}
      width={800}
      destroyOnClose
    >
      <NetworkPolicyForm
        cloudId={cloudId}
        namespacesOptions={namespacesOptions}
        defaultNamespace={defaultNamespace}
        mode={mode}
        initialData={initialData}
        onSuccess={() => {
          onSuccess();
          onCancel();
        }}
        onCancel={onCancel}
      />
    </Modal>
  );
};

export default NetworkPolicyFormModal;
