/**
 * Harvester - 创建 IP 池弹窗
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Modal, Form, Input, Select, Radio, message, Space } from 'antd';
import { createHarvesterIPPool, fetchHarvesterNamespaces } from '../../../../../../services/harvesterApi';
import {
  buildIpPoolCreatePayload,
  extractIpPoolNamespaceNames,
  type IPPoolCreateFormValues,
} from '../lib/ippoolCreateModalUtils';

interface Props {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
  cloudId: string;
}

const IPPoolCreateModal: React.FC<Props> = ({ open, onClose, onSuccess, cloudId }) => {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [namespaces, setNamespaces] = useState<string[]>([]);
  const [type, setType] = useState<'range' | 'cidr'>('cidr');

  const loadNamespaces = useCallback(async () => {
    try {
      const res = await fetchHarvesterNamespaces(cloudId, false, true);
      setNamespaces(extractIpPoolNamespaceNames(res));
    } catch (e) {
      console.error('Failed to load namespaces', e);
    }
  }, [cloudId]);

  useEffect(() => {
    if (open) {
      void loadNamespaces();
      form.resetFields();
      form.setFieldsValue({ type: 'cidr', namespace: 'default' });
    }
  }, [open, form, loadNamespaces]);

  const handleOk = async () => {
    try {
      const values = (await form.validateFields()) as IPPoolCreateFormValues;
      setLoading(true);
      const payload = buildIpPoolCreatePayload(values);
      await createHarvesterIPPool(cloudId, payload);
      message.success('IP池创建成功');
      onSuccess();
      onClose();
    } catch (e: unknown) {
      const err = e as { message?: string };
      message.error(err.message || '创建失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      title="创建 IP 池"
      open={open}
      onCancel={onClose}
      onOk={handleOk}
      confirmLoading={loading}
      width={600}
      okText="创建"
      cancelText="取消"
      destroyOnHidden
    >
      <Form form={form} layout="vertical">
        <Form.Item
          name="name"
          label="名称"
          rules={[
            { required: true, message: '请输入名称' },
            {
              pattern: /^[a-z0-9]([-a-z0-9]*[a-z0-9])?(\.[a-z0-9]([-a-z0-9]*[a-z0-9])?)*$/,
              message: '名称必须由小写字母、数字、"-"或"."组成，且以字母或数字开头和结尾',
            },
          ]}
        >
          <Input placeholder="e.g. pool-1" />
        </Form.Item>

        <Form.Item
          name="namespace"
          label="项目"
          rules={[{ required: true, message: '请选择项目' }]}
        >
          <Select showSearch>
            {namespaces.map((ns) => (
              <Select.Option key={ns} value={ns}>
                {ns}
              </Select.Option>
            ))}
          </Select>
        </Form.Item>

        <Form.Item label="类型" name="type">
          <Radio.Group onChange={(e) => setType(e.target.value)}>
            <Radio value="cidr">CIDR</Radio>
            <Radio value="range">IP 范围</Radio>
          </Radio.Group>
        </Form.Item>

        {type === 'cidr' ? (
          <Form.Item
            name="cidr"
            label="CIDR"
            rules={[
              { required: true, message: '请输入 CIDR' },
              {
                pattern: /^([0-9]{1,3}\.){3}[0-9]{1,3}\/[0-9]+$/,
                message: '格式错误 (e.g. 192.168.1.0/24)',
              },
            ]}
          >
            <Input placeholder="192.168.1.0/24" />
          </Form.Item>
        ) : (
          <>
            <Form.Item
              name="rangeSubnet"
              label="所属子网 CIDR"
              rules={[
                { required: true, message: '请输入所属子网 CIDR' },
                {
                  pattern: /^([0-9]{1,3}\.){3}[0-9]{1,3}\/[0-9]+$/,
                  message: '格式错误 (e.g. 192.168.1.0/24)',
                },
              ]}
            >
              <Input placeholder="192.168.1.0/24" />
            </Form.Item>
            <Form.Item
              name="rangeGateway"
              label="网关 IP"
              rules={[
                { required: true, message: '请输入网关 IP' },
                { pattern: /^([0-9]{1,3}\.){3}[0-9]{1,3}$/, message: 'IP 格式错误' },
              ]}
            >
              <Input placeholder="192.168.1.1" />
            </Form.Item>
            <Space style={{ display: 'flex', marginBottom: 8 }} align="baseline">
              <Form.Item
                name="start"
                label="起始 IP"
                rules={[
                  { required: true, message: '请输入起始 IP' },
                  { pattern: /^([0-9]{1,3}\.){3}[0-9]{1,3}$/, message: 'IP 格式错误' },
                ]}
              >
                <Input placeholder="192.168.1.100" />
              </Form.Item>
              <Form.Item
                name="end"
                label="结束 IP"
                rules={[
                  { required: true, message: '请输入结束 IP' },
                  { pattern: /^([0-9]{1,3}\.){3}[0-9]{1,3}$/, message: 'IP 格式错误' },
                ]}
              >
                <Input placeholder="192.168.1.200" />
              </Form.Item>
            </Space>
          </>
        )}
      </Form>
    </Modal>
  );
};

export default IPPoolCreateModal;
