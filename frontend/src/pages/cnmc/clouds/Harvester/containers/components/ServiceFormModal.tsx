/**
 * ==============================================================================
 * 模块名称: Service 创建/编辑弹窗 (ServiceFormModal)
 * 文件路径: frontend/src/pages/cnmc/clouds/Harvester/containers/components/ServiceFormModal.tsx
 * ==============================================================================
 * 
 * [功能描述]
 * Service 创建/编辑表单的弹窗包装组件，提供统一的弹窗入口。
 * 
 * [模式说明]
 * - 创建模式：所有字段可编辑
 * - 编辑模式：名称、命名空间禁用，其他字段可编辑
 */

import React from 'react';
import { Modal } from 'antd';
import { ApiOutlined, EditOutlined } from '@ant-design/icons';
import ServiceForm from './ServiceForm';

export interface ServiceFormModalProps {
  visible: boolean;
  cloudId: string;
  namespacesOptions: string[];
  onSuccess: () => void;
  onCancel: () => void;
  defaultNamespace?: string;
  editMode?: boolean;
  initialData?: any;
}

const ServiceFormModal: React.FC<ServiceFormModalProps> = ({
  visible,
  cloudId,
  namespacesOptions,
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
          {editMode ? <EditOutlined style={{ marginRight: 8 }} /> : <ApiOutlined style={{ marginRight: 8 }} />}
          {editMode ? '编辑 Service' : '创建 Service'}
        </span>
      }
      open={visible}
      onCancel={onCancel}
      footer={null}
      width={680}
      destroyOnClose
      maskClosable={false}
    >
      <ServiceForm
        cloudId={cloudId}
        namespacesOptions={namespacesOptions}
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

export default ServiceFormModal;