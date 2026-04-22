/**
 * ==============================================================================
 * 模块名称: 工作负载创建弹窗 (WorkloadFormModal)
 * 文件路径: frontend/src/pages/cnmc/clouds/Harvester/containers/components/WorkloadFormModal.tsx
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
  onRefreshImagePullSecrets?: () => void;  // 刷新镜像拉取凭证列表
  onSuccess: () => void;
  onCancel: () => void;
  defaultNamespace?: string;
  defaultType?: WorkloadType;
  editData?: any; // 编辑模式：传入现有的 workload 数据
  // ConfigMap 和 Secret 列表（用于环境变量引入和存储卷挂载）
  configMaps?: Array<{ metadata: { name: string; namespace: string }; data?: Record<string, string> }>;
  secrets?: Array<{ metadata: { name: string; namespace: string }; data?: Record<string, string> }>;
  // PVC 列表（用于存储卷挂载）
  persistentVolumeClaims?: Array<{
    metadata: { name: string; namespace: string; annotations?: Record<string, string> };
    raw?: { metadata?: { annotations?: Record<string, string> } };
    annotations?: Record<string, string>;
    alias?: string;
    name?: string;
    pvcName?: string;
  }>;
  // 网络配置相关 props
  hideFlatSubnet?: boolean;  // 是否隐藏扁平子网选项（Harvester 资源池不显示）
}

const WorkloadFormModal: React.FC<WorkloadFormModalProps> = ({
  visible,
  cloudId,
  namespacesOptions,
  imagePullSecrets,
  secretsWithCredentials,
  onRefreshImagePullSecrets,
  onSuccess,
  onCancel,
  defaultNamespace,
  defaultType,
  editData,
  configMaps,
  secrets,
  persistentVolumeClaims,
  hideFlatSubnet = false,
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
      width={1500}
      destroyOnClose
      maskClosable={false}
    >
      <WorkloadForm
        key={isEditMode ? `edit-${editData?.metadata?.uid || 'new'}` : 'create'}
        cloudId={cloudId}
        namespacesOptions={namespacesOptions}
        imagePullSecrets={imagePullSecrets}
        secretsWithCredentials={secretsWithCredentials}
        onRefreshImagePullSecrets={onRefreshImagePullSecrets}
        onSuccess={() => {
          onSuccess();
          onCancel();
        }}
        onCancel={onCancel}
        defaultNamespace={defaultNamespace}
        defaultType={defaultType}
        editData={editData}
        configMaps={configMaps}
        secrets={secrets}
        persistentVolumeClaims={persistentVolumeClaims}
        hideFlatSubnet={hideFlatSubnet}
      />
    </Modal>
  );
};

export default WorkloadFormModal;
