/**
 * Harvester - 创建网络 (NAD) 弹窗
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Form, Input, Modal, Select, InputNumber, message } from 'antd';
import {
  createHarvesterNad,
  fetchHarvesterClusterNetworks,
  fetchHarvesterNamespaces,
} from '../../../../../../services/harvesterApi';
import { generateHarvesterCrMetadataName } from '../../../../../../utils/harvesterUtils';
import {
  buildNadCreatePayload,
  clusterNetworkDisplayName,
  extractHarvesterClusterNetworkItems,
  extractHarvesterNamespaceItems,
  pickClusterNetworkDefault,
  type NadCreateFormValues,
} from '../lib/nadCreateModalUtils';

interface Props {
  open: boolean;
  onCancel: () => void;
  onSuccess: () => void;
  cloudId: string;
}

const NadCreateModal: React.FC<Props> = ({ open, onCancel, onSuccess, cloudId }) => {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [namespaces, setNamespaces] = useState<unknown[]>([]);
  const [clusterNetworks, setClusterNetworks] = useState<unknown[]>([]);
  const [nsLoading, setNsLoading] = useState(false);
  const [cnLoading, setCnLoading] = useState(false);

  const loadNamespaces = useCallback(async () => {
    setNsLoading(true);
    try {
      const res = await fetchHarvesterNamespaces(cloudId, false, true);
      setNamespaces(extractHarvesterNamespaceItems(res));
    } catch (e) {
      console.error(e);
      message.error('加载命名空间失败');
    } finally {
      setNsLoading(false);
    }
  }, [cloudId]);

  const loadClusterNetworks = useCallback(async () => {
    setCnLoading(true);
    try {
      const res = await fetchHarvesterClusterNetworks(cloudId);
      const items = extractHarvesterClusterNetworkItems(res);
      setClusterNetworks(items);
      const current = form.getFieldValue('clusterNetwork') as string | undefined;
      form.setFieldsValue({ clusterNetwork: pickClusterNetworkDefault(items, current) });
    } catch (e) {
      console.error(e);
      message.warning('加载集群网络列表失败');
    } finally {
      setCnLoading(false);
    }
  }, [cloudId, form]);

  useEffect(() => {
    if (open) {
      void loadNamespaces();
      void loadClusterNetworks();
      form.resetFields();
      form.setFieldsValue({ clusterNetwork: 'mgmt' });
    }
  }, [open, form, loadClusterNetworks, loadNamespaces]);

  const handleFinish = async (values: NadCreateFormValues) => {
    setLoading(true);
    try {
      const nadId = generateHarvesterCrMetadataName('nad');
      const payload = buildNadCreatePayload(values, nadId);
      await createHarvesterNad(cloudId, payload);
      message.success('创建网络成功');
      onSuccess();
    } catch (e: unknown) {
      const err = e as { message?: string };
      message.error(err.message || '创建失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      open={open}
      title="创建网络"
      onCancel={onCancel}
      onOk={() => form.submit()}
      confirmLoading={loading}
      width={600}
      okText="创建"
    >
      <Form form={form} layout="vertical" onFinish={handleFinish}>
        <Form.Item
          name="name"
          label="别名"
          tooltip="网络的可读别名，将写入 tower.io/alias 注解。实际 ID 会自动生成（id-nad-{随机字符串}）"
          rules={[{ required: true, message: '请输入别名' }]}
        >
          <Input placeholder="例如: vlan-100" />
        </Form.Item>

        <Form.Item
          name="namespace"
          label="项目"
          rules={[{ required: true, message: '请选择项目' }]}
        >
          <Select placeholder="请选择项目" showSearch loading={nsLoading} optionFilterProp="children">
            {namespaces.map((ns) => {
              const name = (ns as { metadata?: { name?: string }; name?: string }).metadata?.name
                || (ns as { name?: string }).name;
              return (
                <Select.Option key={name} value={name}>
                  {name}
                </Select.Option>
              );
            })}
          </Select>
        </Form.Item>

        <Form.Item name="vlanId" label="VLAN ID">
          <InputNumber
            min={1}
            max={4094}
            style={{ width: '100%' }}
            placeholder="请输入 1-4094 之间的 VLAN ID，留空表示不使用 VLAN"
          />
        </Form.Item>

        <Form.Item
          name="clusterNetwork"
          label="集群网络 (Cluster Network)"
          initialValue="mgmt"
          tooltip="Harvester 集群网络名称，默认为 mgmt"
          rules={[{ required: true, message: '请选择集群网络' }]}
        >
          <Select placeholder="请选择集群网络" loading={cnLoading}>
            {clusterNetworks.length > 0 ? (
              clusterNetworks.map((cn) => {
                const cnName = (cn as { metadata: { name: string } }).metadata.name;
                return (
                  <Select.Option key={cnName} value={cnName}>
                    {clusterNetworkDisplayName(cnName)}
                  </Select.Option>
                );
              })
            ) : (
              <Select.Option value="mgmt">管理网 (默认)</Select.Option>
            )}
          </Select>
        </Form.Item>
      </Form>
    </Modal>
  );
};

export default NadCreateModal;
