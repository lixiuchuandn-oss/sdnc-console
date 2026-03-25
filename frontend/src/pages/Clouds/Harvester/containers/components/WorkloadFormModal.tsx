/**
 * ==============================================================================
 * 模块名称: 工作负载创建弹窗 (WorkloadFormModal)
 * 文件路径: src/pages/Clouds/Harvester/containers/components/WorkloadFormModal.tsx
 * ==============================================================================
 * 
 * [功能描述]
 * 工作负载创建表单的弹窗包装组件，提供统一的弹窗入口。
 */

import React from 'react';
import { Modal } from 'antd';
import { AppstoreAddOutlined } from '@ant-design/icons';
import WorkloadForm, { WorkloadType } from './WorkloadForm';

export interface WorkloadFormModalProps {
  visible: boolean;
  cloudId: string;
  namespacesOptions: string[];
  imagePullSecrets: Array<{ metadata: { name: string; namespace: string } }>;
  secretsWithCredentials?: any[];  // 包含完整凭证信息的 Secret 列表（用于仓库浏览）
  onSuccess: () => void;
  onCancel: () => void;
  defaultNamespace?: string;
  defaultType?: WorkloadType;
  editData?: any; // 编辑模式：传入现有的 workload 数据
}

const WorkloadFormModal: React.FC<WorkloadFormModalProps> = ({
  visible,
  cloudId,
  namespacesOptions,
  imagePullSecrets,
  secretsWithCredentials,
  onSuccess,
  onCancel,
  defaultNamespace,
  defaultType,
  editData,
}) => {
  const isEditMode = !!editData;
  
  return (
    <Modal
      title={
        <span>
          <AppstoreAddOutlined style={{ marginRight: 8 }} />
          {isEditMode ? '编辑工作负载' : '创建工作负载'}
        </span>
      }
      open={visible}
      onCancel={onCancel}
      footer={null}
      width={720}
      destroyOnClose
      maskClosable={false}
    >
      <WorkloadForm
        key={isEditMode ? `edit-${editData?.metadata?.uid || 'new'}` : 'create'}
        cloudId={cloudId}
        namespacesOptions={namespacesOptions}
        imagePullSecrets={imagePullSecrets}
        secretsWithCredentials={secretsWithCredentials}
        onSuccess={() => {
          onSuccess();
          onCancel();
        }}
        onCancel={onCancel}
        defaultNamespace={defaultNamespace}
        defaultType={defaultType}
        editData={editData}
      />
    </Modal>
  );
};

export default WorkloadFormModal;
