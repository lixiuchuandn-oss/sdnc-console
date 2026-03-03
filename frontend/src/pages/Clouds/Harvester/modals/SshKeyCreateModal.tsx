import React, { useEffect, useState } from 'react';
import { Modal, Form, Input, Select, message } from 'antd';
import { createHarvesterSshKey, fetchHarvesterNamespaces } from '../../../../services/harvesterApi';
import { isSystemNamespace, isPublicNamespace } from '../../../../utils/harvesterUtils';

interface Props {
  visible: boolean;
  cloudId: string;
  onCancel: () => void;
  onSuccess: () => void;
  isTenant?: boolean;
}

const SshKeyCreateModal: React.FC<Props> = ({ visible, cloudId, onCancel, onSuccess, isTenant }) => {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [namespaces, setNamespaces] = useState<any[]>([]);
  const [nsLoading, setNsLoading] = useState(false);

  useEffect(() => {
    if (visible && cloudId) {
      loadNamespaces();
      form.resetFields();
    }
  }, [visible, cloudId]);

  const loadNamespaces = async () => {
    setNsLoading(true);
    try {
      const res: any = await fetchHarvesterNamespaces(cloudId);
      let list = res?.data?.items || res?.items || [];
      
      // Filter logic:
      // 1. Remove system namespaces for everyone (usually) or at least for tenants
      // 2. For tenants: Remove public namespaces from CREATION list (read-only)
      
      if (isTenant) {
        // Tenant can only create resources in their own namespaces, NOT in system OR public namespaces
        list = list.filter((n: any) => {
          const name = n.metadata.name;
          return !isSystemNamespace(name) && !isPublicNamespace(name);
        });
      }
      
      setNamespaces(list);
      
      // Default selection logic
      if (list.length > 0) {
        form.setFieldsValue({ namespace: list[0].metadata.name });
      }
    } catch (e) {
      console.error(e);
    } finally {
      setNsLoading(false);
    }
  };

  const handleOk = async () => {
    try {
      const values = await form.validateFields();
      setLoading(true);
      await createHarvesterSshKey(cloudId, values.namespace, values.name, values.publicKey);
      message.success('创建 SSH Key 成功');
      onSuccess();
    } catch (e: any) {
      message.error(`创建失败: ${e.message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      title="创建 SSH 密钥 (Create SSH Key)"
      open={visible}
      onOk={handleOk}
      onCancel={onCancel}
      confirmLoading={loading}
      destroyOnClose
    >
      <Form form={form} layout="vertical">
        <Form.Item
          name="namespace"
          label="命名空间 (Namespace)"
          rules={[{ required: true, message: '请选择命名空间' }]}
        >
          <Select 
            loading={nsLoading} 
            showSearch
            optionFilterProp="label"
            options={namespaces.map(n => ({ label: n.metadata.name, value: n.metadata.name }))}
          />
        </Form.Item>
        <Form.Item
          name="name"
          label="名称 (Name)"
          rules={[
            { required: true, message: '请输入名称' },
            { pattern: /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/, message: '名称必须符合 K8s 命名规范 (小写字母数字及中划线)' }
          ]}
        >
          <Input placeholder="例如: my-ssh-key" />
        </Form.Item>
        <Form.Item
          name="publicKey"
          label="公钥 (SSH Public Key)"
          rules={[{ required: true, message: '请输入 SSH 公钥' }]}
        >
          <Input.TextArea 
            rows={6} 
            placeholder="ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABAQC..." 
          />
        </Form.Item>
      </Form>
    </Modal>
  );
};

export default SshKeyCreateModal;
