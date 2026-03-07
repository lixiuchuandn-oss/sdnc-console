import React, { useEffect, useState } from 'react';
import { Modal, Form, Input, Select, message, Button, Alert, Space, Typography, Card } from 'antd';
import { KeyOutlined, DownloadOutlined, SafetyCertificateOutlined } from '@ant-design/icons';
import { createHarvesterSshKey, fetchHarvesterNamespaces } from '../../../../services/harvesterApi';
import { isSystemNamespace, isPublicNamespace } from '../../../../utils/harvesterUtils';
import { API_BASE_URL, getAuthHeaders } from '../../../../services/api';
// @ts-ignore
import { generateKeyPair } from 'web-ssh-keygen';

const { Text, Paragraph } = Typography;

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
  const [generatedKey, setGeneratedKey] = useState<{ publicKey: string; privateKey: string } | null>(null);

  useEffect(() => {
    if (visible && cloudId) {
      loadNamespaces();
      form.resetFields();
      setGeneratedKey(null);
    }
  }, [visible, cloudId]);

  const loadNamespaces = async () => {
    setNsLoading(true);
    try {
      const res: any = await fetchHarvesterNamespaces(cloudId, false, true); // excludeSystem=true
      let list = res?.data?.items || res?.items || [];
      
      // Filter logic:
      // 后端已过滤系统命名空间，这里只需要处理租户模式的公共命名空间过滤
      if (isTenant) {
        list = list.filter((n: any) => {
          const name = n.metadata?.name || n.name;
          return !isPublicNamespace(name);
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

  const handleGenerateKey = async () => {
    try {
      setLoading(true);
      const res = await fetch(`${API_BASE_URL}/api/tools/ssh-keygen`, {
        headers: getAuthHeaders(),
      });
      if (!res.ok) throw new Error('生成失败');
      const data = await res.json();
      setGeneratedKey(data);
      form.setFieldsValue({ publicKey: data.publicKey });
      message.success('密钥对生成成功，请务必保存私钥！');
    } catch (e: any) {
      message.error(e.message);
    } finally {
      setLoading(false);
    }
  };

  const handleDownloadPrivateKey = () => {
    if (!generatedKey?.privateKey) return;
    const blob = new Blob([generatedKey.privateKey], { type: 'text/plain' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${form.getFieldValue('alias') || 'id_rsa'}.pem`;
    a.click();
    window.URL.revokeObjectURL(url);
  };

  const handleOk = async () => {
    try {
      const values = await form.validateFields();
      setLoading(true);
      
      // Auto-generate ID: id-{abbr}-{11 chars}
      // ssh key abbreviation: ssh
      const randomStr = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
      const id = `id-ssh-${randomStr.substring(0, 11)}`;
      
      const annotations: Record<string, string> = {};
      if (values.alias) {
        annotations['tower.io/alias'] = values.alias;
      }

      await createHarvesterSshKey(cloudId, values.namespace, id, values.publicKey, annotations);
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
      title={(
        <Space>
          <span>创建 SSH 密钥</span>
        </Space>
      )}
      open={visible}
      onOk={handleOk}
      onCancel={onCancel}
      confirmLoading={loading}
      destroyOnHidden
      width={640}
      okText="创建"
      cancelText="取消"
    >
      <Form form={form} layout="vertical" style={{ marginTop: 24 }}>
        <Alert
          type="info"
          message="什么是 SSH 公钥？"
          description={
            <div style={{ fontSize: 13, marginTop: 4 }}>
              SSH 公钥用于免密登录云主机。格式通常以 <code>ssh-rsa</code> 或 <code>ssh-ed25519</code> 开头。
              <br />
              如果您没有现成的密钥，可以使用下方的<b>“自动生成”</b>功能。
            </div>
          }
          style={{ marginBottom: 24 }}
        />
        
        <Form.Item
          name="namespace"
          label="命名空间 (Namespace)"
          rules={[{ required: true, message: '请选择命名空间' }]}
          tooltip="密钥将归属于该命名空间"
        >
          <Select 
            loading={nsLoading} 
            showSearch
            placeholder="请选择命名空间"
            optionFilterProp="label"
            options={namespaces.map(n => ({ label: n.metadata.name, value: n.metadata.name }))}
          />
        </Form.Item>
        
        <Form.Item
          name="alias"
          label="密钥名称"
          rules={[{ required: true, message: '请输入名称' }]}
        >
          <Input placeholder="输入密钥名称" />
        </Form.Item>

        <Form.Item label="公钥内容 (Public Key)" required style={{ marginBottom: 0 }}>
          <Space style={{ marginBottom: 8, width: '100%', justifyContent: 'flex-start' }}>
             <Button 
               onClick={handleGenerateKey} 
               loading={loading && !generatedKey}
             >
               自动生成密钥对
             </Button>
             
             {generatedKey && (
               <Button 
                 type="primary" 
                 ghost 
                 onClick={handleDownloadPrivateKey}
                 icon={<DownloadOutlined />}
                 className="animate__animated animate__pulse"
               >
                 下载私钥 (.pem)
               </Button>
             )}
          </Space>
          
          <Form.Item
            name="publicKey"
            rules={[{ required: true, message: '请输入 SSH 公钥' }]}
            style={{ marginBottom: 8 }}
          >
            <Input.TextArea 
              rows={5} 
              placeholder="ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABAQC..." 
              style={{ fontFamily: 'monospace', fontSize: 12, resize: 'none' }}
            />
          </Form.Item>
          
          {generatedKey && (
            <Alert
              type="warning"
              showIcon
              message="平台不会存储您的密钥。请务必立即下载并妥善保管。"
              style={{ marginTop: 8 }}
            />
          )}
        </Form.Item>
      </Form>
    </Modal>
  );
};

export default SshKeyCreateModal;
