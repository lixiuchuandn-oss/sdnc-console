/**
 * ==============================================================================
 * 模块名称: Ingress 创建/编辑弹窗 (IngressFormModal)
 * 文件路径: src/pages/Clouds/Harvester/containers/components/IngressFormModal.tsx
 * ==============================================================================
 * 
 * [功能描述]
 * Ingress 创建/编辑表单的弹窗包装组件，提供统一的弹窗入口。
 * 
 * [模式说明]
 * - 创建模式：所有字段可编辑
 * - 编辑模式：名称、命名空间禁用，其他字段可编辑
 */

import React from 'react';
import { Modal } from 'antd';
import { GlobalOutlined, EditOutlined } from '@ant-design/icons';
import IngressForm from './IngressForm';

export interface IngressFormModalProps {
  visible: boolean;
  cloudId: string;
  namespacesOptions: string[];
  secrets?: any[];
  onSuccess: () => void;
  onCancel: () => void;
  defaultNamespace?: string;
  editMode?: boolean;
  initialData?: any;
}

const IngressFormModal: React.FC<IngressFormModalProps> = ({
  visible,
  cloudId,
  namespacesOptions,
  secrets,
  onSuccess,
  onCancel,
  defaultNamespace,
  editMode,
  initialData,
}) => {
  return (
    <Modal
      title={
        <span>
          {editMode ? <EditOutlined style={{ marginRight: 8 }} /> : <GlobalOutlined style={{ marginRight: 8 }} />}
          {editMode ? '编辑 Ingress' : '创建 Ingress'}
        </span>
      }
      open={visible}
      onCancel={onCancel}
      footer={null}
      width={720}
      destroyOnClose
      maskClosable={false}
    >
      <IngressForm
        cloudId={cloudId}
        namespacesOptions={namespacesOptions}
        secrets={secrets}
        onSuccess={() => {
          onSuccess();
          onCancel();
        }}
        onCancel={onCancel}
        defaultNamespace={defaultNamespace}
        editMode={editMode}
        initialData={initialData}
      />
    </Modal>
  );
};

export default IngressFormModal;