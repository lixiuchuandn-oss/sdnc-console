/**
 * ==============================================================================
 * 模块名称: 镜像凭证弹窗 (RegistryCredentialModal)
 * 文件路径: frontend/src/pages/cnmc/clouds/Harvester/containers/components/RegistryCredentialModal.tsx
 * ==============================================================================
 * 
 * [功能描述]
 * 镜像拉取凭证创建/编辑弹窗组件，包装 RegistryCredentialForm。
 * 支持创建模式和编辑模式。
 */

import React, { useState, useCallback, useEffect } from 'react';
import { Modal, Form, App } from 'antd';
import { KeyOutlined } from '@ant-design/icons';
import RegistryCredentialForm, { parseSecretData } from './RegistryCredentialForm';
import {
  createHarvesterImagePullSecret,
  updateHarvesterImagePullSecret,
} from '../../../../../../services/harvesterApi';

// ============================================================
// 类型定义
// ============================================================

export interface RegistryCredentialModalProps {
  visible: boolean;
  editData?: any; // 编辑模式：传入现有的 Secret 数据
  namespaces: string[];
  cloudId: string;
  onCancel: () => void;
  onSuccess: () => void;
  /** 创建模式优先选中的命名空间（须在 namespaces 内） */
  defaultNamespace?: string;
}

// ============================================================
// 主组件
// ============================================================

const RegistryCredentialModal: React.FC<RegistryCredentialModalProps> = ({
  visible,
  editData,
  namespaces,
  cloudId,
  onCancel,
  onSuccess,
  defaultNamespace,
}) => {
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  
  const isEditMode = !!editData;
  
  // 重置表单
  useEffect(() => {
    if (visible) {
      if (editData) {
        // 编辑模式：解析现有数据并填充
        const parsed = parseSecretData(editData);
        if (parsed) {
          form.setFieldsValue(parsed);
        }
      } else {
        // 创建模式：重置表单
        form.resetFields();
        const dn = String(defaultNamespace || '').trim();
        if (dn && namespaces.includes(dn)) {
          form.setFieldsValue({ namespace: dn });
        } else if (namespaces.includes('default')) {
          form.setFieldsValue({ namespace: 'default' });
        } else if (namespaces.length > 0) {
          form.setFieldsValue({ namespace: namespaces[0] });
        }
      }
    }
  }, [visible, editData, form, namespaces, defaultNamespace]);
  
  // 提交表单
  const handleSubmit = useCallback(async () => {
    try {
      const values = await form.validateFields();
      setLoading(true);
      
      if (isEditMode) {
        // 编辑模式：调用更新 API
        const namespace = editData?.metadata?.namespace;
        const name = editData?.metadata?.name;
        
        await updateHarvesterImagePullSecret(cloudId, namespace, name, {
          server: values.server,
          username: values.username,
          password: values.password,
          email: values.email,
        });
        message.success('凭证更新成功');
      } else {
        // 创建模式：调用创建 API
        
        await createHarvesterImagePullSecret(cloudId, {
          namespace: values.namespace,
          name: values.name,
          server: values.server,
          username: values.username,
          password: values.password,
          email: values.email,
        });
        message.success('凭证创建成功');
      }
      
      onSuccess();
      form.resetFields();
    } catch (error: any) {
      console.error(isEditMode ? '更新凭证失败:' : '创建凭证失败:', error);
      message.error(error?.message || (isEditMode ? '凭证更新失败' : '凭证创建失败'));
    } finally {
      setLoading(false);
    }
  }, [form, cloudId, editData, isEditMode, message, onSuccess]);
  
  // 关闭弹窗
  const handleCancel = useCallback(() => {
    form.resetFields();
    onCancel();
  }, [form, onCancel]);
  
  return (
    <Modal
      title={
        <span>
          <KeyOutlined style={{ marginRight: 8 }} />
          {isEditMode ? '编辑镜像凭证' : '创建镜像凭证'}
        </span>
      }
      open={visible}
      onOk={handleSubmit}
      onCancel={handleCancel}
      confirmLoading={loading}
      okText={isEditMode ? '更新' : '创建'}
      cancelText="取消"
      width={520}
      destroyOnClose
      maskClosable={false}
    >
      <RegistryCredentialForm
        form={form}
        editData={editData}
        namespaces={namespaces}
        isEditMode={isEditMode}
      />
    </Modal>
  );
};

export default RegistryCredentialModal;
