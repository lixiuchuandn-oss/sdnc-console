/**
 * Harvester - 创建网络 (NAD) 弹窗
 *
 * 负责创建 NetworkAttachmentDefinition，绑定到 Harvester ClusterNetwork：
 * - 通过 `network.harvesterhci.io/route-cluster-network` 注解关联 ClusterNetwork；
 * - 使用 bridge CNI，桥接到指定 bridge（默认 mgmt 对应 mgmt-br）；
 * - 可选配置 VLAN ID，用于为业务网络打 tag。
 */
import React, { useState, useEffect } from 'react';
import { Form, Input, Modal, Select, InputNumber, message } from 'antd';
import { createHarvesterNad, fetchHarvesterNamespaces, fetchHarvesterClusterNetworks } from '../../../../../../services/harvesterApi';
import { generateHarvesterCrMetadataName } from '../../../../../../utils/harvesterUtils';

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

  // 加载命名空间列表（后端已过滤系统命名空间）
  const loadNamespaces = async () => {
    setNsLoading(true);
    try {
      const res = await fetchHarvesterNamespaces(cloudId, false, true); // excludeSystem=true
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
   * - 生成 ID：使用 generateHarvesterCrMetadataName('nad')（id-nad-{11 位随机}）
   * - 别名处理：用户输入的 name 作为别名写入 tower.io/alias 注解
   * - 组装 CNI config（支持 bridge/macvlan 等类型，含 IPAM 配置）；
   * - 以 k8s.cni.cncf.io.networkattachmentdefinition 类型提交给 Harvester；
   * - 使用 annotation 将 NAD 与 ClusterNetwork 关联。
   */
  const handleFinish = async (values: any) => {
    setLoading(true);
    try {
      const cnName = values.clusterNetwork || 'mgmt';
      // For 'mgmt' network, the bridge is typically 'mgmt-br'. For others, use {cnName}-br convention
      const bridgeName = cnName === 'mgmt' ? 'mgmt-br' : `${cnName}-br`;

      // 生成 ID：id-nad-{11位随机字符串}
      const nadId = generateHarvesterCrMetadataName('nad');

      // Construct config object for CNI (使用默认值)
      const config: any = {
        cniVersion: '0.3.1',
        name: nadId, // Use generated ID as CNI config name
        type: 'bridge',
        promiscMode: true,
        bridge: bridgeName,
      };

      // VLAN 配置
      if (values.vlanId) {
        config.vlan = Number(values.vlanId);
      }

      // IPAM 配置（使用空对象，L2 网络）
      config.ipam = {};
      
      // 构建 annotations
      const annotations: Record<string, string> = {
        // Standard Harvester annotation to link with ClusterNetwork
        'network.harvesterhci.io/route-cluster-network': cnName
        // Removed 'network.harvesterhci.io/route' annotation as we are not configuring L3 routes
        // and sending empty strings causes validation errors (CIDR invalid)
      };
      
      // 如果用户输入了别名，写入 tower.io/alias 注解
      if (values.name && values.name.trim()) {
        annotations['tower.io/alias'] = values.name.trim();
      }
      
      // Construct NAD payload (Rancher/Steve API Style)
      // This style uses 'type' instead of 'apiVersion/kind' and is robust for Harvester API
      const payload = {
        type: 'k8s.cni.cncf.io.networkattachmentdefinition',
        metadata: {
          name: nadId, // Use generated ID as NAD name
          namespace: values.namespace,
          labels: {
            // Also add label for easier filtering
            'network.harvesterhci.io/cluster-network': cnName
          },
          annotations
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
        rules={[
          { required: true, message: '请输入别名' }
        ]}
      >
        <Input placeholder="例如: vlan-100" />
      </Form.Item>

      <Form.Item
        name="namespace"
        label="项目"
        rules={[{ required: true, message: '请选择项目' }]}
      >
        <Select 
          placeholder="请选择项目" 
          showSearch 
          loading={nsLoading}
          optionFilterProp="children"
        >
          {namespaces.map(ns => {
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
      >
        <InputNumber min={1} max={4094} style={{ width: '100%' }} placeholder="请输入 1-4094 之间的 VLAN ID，留空表示不使用 VLAN" />
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
             clusterNetworks.map(cn => {
               const cnName = cn.metadata.name;
               const displayName = cnName === 'mgmt' ? '管理网' : cnName;
               return (
                 <Select.Option key={cnName} value={cnName}>
                   {displayName}
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
