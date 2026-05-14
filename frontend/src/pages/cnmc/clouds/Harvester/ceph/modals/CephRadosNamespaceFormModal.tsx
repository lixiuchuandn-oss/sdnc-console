/**
 * Rook `CephBlockPoolRadosNamespace`：创建（Tower `POST /ceph/rook/blockpool-rados-namespaces`）。
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Form, Input, message, Modal } from 'antd';
import { createCephRadosNamespaceRook } from '../../../../../../services/cephApi';

const NAME_PATTERN = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/;

export type CephRadosNamespaceFormModalProps = {
  open: boolean;
  cloudId: string;
  onClose: () => void;
  onSuccess: () => void;
};

type FormShape = {
  namespace: string;
  name: string;
  blockPoolName: string;
};

const CephRadosNamespaceFormModal: React.FC<CephRadosNamespaceFormModalProps> = ({
  open,
  cloudId,
  onClose,
  onSuccess,
}) => {
  const [form] = Form.useForm<FormShape>();
  const [submitting, setSubmitting] = useState(false);

  const reset = useCallback(() => {
    form.setFieldsValue({
      namespace: 'rook-ceph',
      name: '',
      blockPoolName: '',
    });
  }, [form]);

  useEffect(() => {
    if (open) reset();
  }, [open, reset]);

  const handleOk = useCallback(async () => {
    try {
      const v = await form.validateFields();
      const ns = v.namespace.trim();
      const nm = v.name.trim();
      const pool = v.blockPoolName.trim();
      if (!ns || !nm || !pool) {
        message.warning('请填写命名空间、名称与块存储池');
        return;
      }
      setSubmitting(true);
      const body = {
        apiVersion: 'ceph.rook.io/v1',
        kind: 'CephBlockPoolRadosNamespace',
        metadata: { name: nm, namespace: ns },
        spec: { blockPoolName: pool },
      };
      const res = await createCephRadosNamespaceRook(cloudId, body);
      if (!res.ok) {
        message.error(res.error || '创建失败');
        return;
      }
      message.success('已创建 RADOS 命名空间');
      onSuccess();
      onClose();
    } catch {
      /* validate */
    } finally {
      setSubmitting(false);
    }
  }, [cloudId, form, onClose, onSuccess]);

  return (
    <Modal
      title="新建 RADOS 命名空间"
      open={open}
      onCancel={onClose}
      onOk={() => void handleOk()}
      confirmLoading={submitting}
      destroyOnClose
      width={520}
    >
      <Form form={form} layout="vertical" style={{ marginTop: 8 }}>
        <Form.Item
          name="namespace"
          label="Kubernetes 命名空间"
          rules={[{ required: true, message: '必填' }]}
        >
          <Input placeholder="如 rook-ceph" />
        </Form.Item>
        <Form.Item
          name="name"
          label="资源名称"
          rules={[
            { required: true, message: '必填' },
            {
              pattern: NAME_PATTERN,
              message: '小写字母、数字、连字符（RFC 1123 子域）',
            },
          ]}
        >
          <Input placeholder="rados 命名空间标识" />
        </Form.Item>
        <Form.Item
          name="blockPoolName"
          label="块存储池名称"
          extra="对应已存在的 CephBlockPool.metadata.name"
          rules={[{ required: true, message: '必填' }]}
        >
          <Input placeholder="例如 replicapool" />
        </Form.Item>
      </Form>
    </Modal>
  );
};

export default CephRadosNamespaceFormModal;
