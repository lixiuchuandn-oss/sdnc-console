/**
 * Harvester - 创建网络 (NAD) 弹窗
 *
 * 负责创建 NetworkAttachmentDefinition，绑定到 Harvester ClusterNetwork：
 * - 通过 `network.harvesterhci.io/route-cluster-network` 注解关联 ClusterNetwork；
 * - 使用 bridge CNI，桥接到指定 bridge（默认 mgmt 对应 mgmt-br）；
 * - 可选配置 VLAN ID，用于为业务网络打 tag。
 */
import React, { useState, useEffect } from 'react';
import { Form, Input, Select, InputNumber, Alert, message } from 'antd';
import StdFormModal from '../../../../components/StdFormModal';
import { createHarvesterNad, fetchHarvesterNamespaces, fetchHarvesterClusterNetworks } from '../../../../services/harvesterApi';
import { isSystemNamespace } from '../../../../utils/harvesterUtils';

/**
 * 组件入参
 * - open: 弹窗是否打开
 * - onCancel: 关闭回调
 * - onSuccess: 创建成功回调
 * - cloudId: 当前云 ID，用于调用 Harvester API
 */
interface Props {
  open: boolean;
  onCancel: () => void;
  onSuccess: () => void;
  cloudId: string;
}

const NadCreateModal: React.FC<Props> = ({ open, onCancel, onSuccess, cloudId }) => {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [namespaces, setNamespaces] = useState<any[]>([]);
  const [clusterNetworks, setClusterNetworks] = useState<any[]>([]);
  const [nsLoading, setNsLoading] = useState(false);
  const [cnLoading, setCnLoading] = useState(false);

  useEffect(() => {
    if (open) {
      loadNamespaces();
      loadClusterNetworks();
      form.resetFields();
      // Ensure default value is set explicitly
      form.setFieldsValue({ clusterNetwork: 'mgmt' });
    }
  }, [open, cloudId]);

  // 加载命名空间列表，并在前端过滤系统命名空间
  const loadNamespaces = async () => {
    setNsLoading(true);
    try {
      const res = await fetchHarvesterNamespaces(cloudId);
      // Backend typically returns { data: [...] } or { data: { items: [...] } }
      const items = Array.isArray(res?.data) ? res.data : (res?.data?.items || []);
      setNamespaces(items);
    } catch (e) {
      console.error(e);
      message.error('加载命名空间失败');
    } finally {
      setNsLoading(false);
    }
  };

  // 加载 ClusterNetwork 列表，用于绑定路由网络
  const loadClusterNetworks = async () => {
    setCnLoading(true);
    try {
      const res = await fetchHarvesterClusterNetworks(cloudId);
      const items = res?.items || [];
      setClusterNetworks(items);

      // Auto-select valid network if default 'mgmt' is missing
      const current = form.getFieldValue('clusterNetwork');
      if (items.length > 0 && !items.find((i: any) => i.metadata.name === current)) {
          form.setFieldsValue({ clusterNetwork: items[0].metadata.name });
      }
    } catch (e) {
      console.error(e);
      // Don't block UI, just log error. User can still type if we allow it or default to mgmt
      message.warning('加载集群网络列表失败');
    } finally {
      setCnLoading(false);
    }
  };

  /**
   * 提交创建 NAD：
   * - 组装 bridge CNI config（含可选 VLAN ID）；
   * - 以 k8s.cni.cncf.io.networkattachmentdefinition 类型提交给 Harvester；
   * - 使用 annotation 将 NAD 与 ClusterNetwork 关联。
   */
  const handleFinish = async (values: any) => {
    setLoading(true);
    try {
      const cnName = values.clusterNetwork || 'mgmt';
      // For 'mgmt' network, the bridge is typically 'mgmt-br'. For others, assume name matches or user knows.
      const bridgeName = cnName === 'mgmt' ? 'mgmt-br' : cnName;

      // Construct config object for bridge CNI
      const config: any = {
        cniVersion: '0.3.1',
        name: values.name, // Usually matches NAD name
        type: 'bridge',
        bridge: bridgeName,
        promiscMode: true,
        vlan: values.vlanId ? Number(values.vlanId) : undefined, // Ensure number type
        ipam: {} // Empty object
      };

      // Filter out undefined keys (like vlan if not set)
      if (!config.vlan) delete config.vlan;
      
      // Construct NAD payload (Rancher/Steve API Style)
      // This style uses 'type' instead of 'apiVersion/kind' and is robust for Harvester API
      const payload = {
        type: 'k8s.cni.cncf.io.networkattachmentdefinition',
        metadata: {
          name: values.name,
          namespace: values.namespace,
          annotations: {
             // Standard Harvester annotation to link with ClusterNetwork
             'network.harvesterhci.io/route-cluster-network': cnName
             // Removed 'network.harvesterhci.io/route' annotation as we are not configuring L3 routes
             // and sending empty strings causes validation errors (CIDR invalid)
          }
        },
        spec: {
          config: JSON.stringify(config)
        }
      };
      
      await createHarvesterNad(cloudId, payload);
      message.success('创建网络成功');
      onSuccess();
    } catch (e: any) {
      message.error(e.message || '创建失败');
    } finally {
      setLoading(false);
    }
  };

  const filteredNamespaces = namespaces.filter(ns => {
      const name = ns?.metadata?.name || ns?.name;
      return !isSystemNamespace(name);
  });

  return (
    <StdFormModal
      open={open}
      title="创建网络"
      onCancel={onCancel}
      onFinish={handleFinish}
      confirmLoading={loading}
      form={form}
      width={600}
      okText="创建"
    >
      <Form.Item
        name="name"
        label="名称"
        rules={[
          { required: true, message: '请输入名称' },
          { pattern: /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/, message: '仅允许小写字母、数字与连字符' }
        ]}
      >
        <Input placeholder="例如: vlan-100" />
      </Form.Item>

      <Form.Item
        name="namespace"
        label="命名空间"
        rules={[{ required: true, message: '请选择命名空间' }]}
      >
        <Select 
          placeholder="请选择命名空间" 
          showSearch 
          loading={nsLoading}
          optionFilterProp="children"
        >
          {filteredNamespaces.map(ns => {
            const name = ns?.metadata?.name || ns?.name;
            return (
                <Select.Option key={name} value={name}>
                {name}
                </Select.Option>
            );
          })}
        </Select>
      </Form.Item>

      <Form.Item
        name="vlanId"
        label="VLAN ID"
        extra="请输入 1-4094 之间的 VLAN ID，留空表示不使用 VLAN (Untagged)"
      >
        <InputNumber min={1} max={4094} style={{ width: '100%' }} placeholder="留空则不使用 VLAN" />
      </Form.Item>

      <Form.Item
        name="clusterNetwork"
        label="集群网络 (Cluster Network)"
        initialValue="mgmt"
        tooltip="Harvester 集群网络名称，默认为 mgmt"
        rules={[{ required: true, message: '请选择集群网络' }]}
      >
        <Select 
          placeholder="请选择集群网络" 
          loading={cnLoading}
        >
           {clusterNetworks.length > 0 ? (
             clusterNetworks.map(cn => (
               <Select.Option key={cn.metadata.name} value={cn.metadata.name}>
                 {cn.metadata.name}
               </Select.Option>
             ))
           ) : (
             <Select.Option value="mgmt">mgmt (默认)</Select.Option>
           )}
        </Select>
      </Form.Item>
    </StdFormModal>
  );
};

export default NadCreateModal;
