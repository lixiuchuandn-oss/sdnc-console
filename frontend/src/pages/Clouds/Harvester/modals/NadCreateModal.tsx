/**
 * Harvester - 创建网络 (NAD) 弹窗
 *
 * 负责创建 NetworkAttachmentDefinition，绑定到 Harvester ClusterNetwork：
 * - 通过 `network.harvesterhci.io/route-cluster-network` 注解关联 ClusterNetwork；
 * - 使用 bridge CNI，桥接到指定 bridge（默认 mgmt 对应 mgmt-br）；
 * - 可选配置 VLAN ID，用于为业务网络打 tag。
 */
import React, { useState, useEffect } from 'react';
import { Form, Input, Select, InputNumber, Alert, message, Switch, Collapse } from 'antd';
import StdFormModal from '../../../../components/StdFormModal';
import { createHarvesterNad, fetchHarvesterNamespaces, fetchHarvesterClusterNetworks } from '../../../../services/harvesterApi';
import { isSystemNamespace, generateHarvesterEntityId } from '../../../../utils/harvesterUtils';

const { Panel } = Collapse;

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
   * - 生成 ID：使用 generateHarvesterEntityId 生成 id-nad-{11位随机字符串} 格式的 ID
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
      const bridgeName = values.bridgeName || (cnName === 'mgmt' ? 'mgmt-br' : `${cnName}-br`);

      // 生成 ID：id-nad-{11位随机字符串}
      const nadId = generateHarvesterEntityId('nad');

      // 构建 IPAM 配置
      const ipam: any = {};
      if (values.ipamType) {
        ipam.type = values.ipamType;
        
        // host-local IPAM 配置
        if (values.ipamType === 'host-local') {
          if (values.ipamSubnet) {
            ipam.subnet = values.ipamSubnet;
          }
          if (values.ipamRangeStart) {
            ipam.rangeStart = values.ipamRangeStart;
          }
          if (values.ipamRangeEnd) {
            ipam.rangeEnd = values.ipamRangeEnd;
          }
          if (values.ipamGateway) {
            ipam.gateway = values.ipamGateway;
          }
          if (values.ipamRoutes && values.ipamRoutes.trim()) {
            try {
              ipam.routes = JSON.parse(values.ipamRoutes);
            } catch (e) {
              message.warning('路由配置 JSON 格式错误，将忽略');
            }
          }
          if (values.ipamDns && values.ipamDns.trim()) {
            const dnsList = values.ipamDns.split(/[,;\s]+/).filter((d: string) => d.trim());
            if (dnsList.length > 0) {
              ipam.dns = {
                nameservers: dnsList
              };
            }
          }
        }
        
        // static IPAM 配置
        if (values.ipamType === 'static') {
          if (values.ipamAddresses && values.ipamAddresses.trim()) {
            const addrList = values.ipamAddresses.split(/[,;\s]+/).filter((a: string) => a.trim());
            if (addrList.length > 0) {
              ipam.addresses = addrList;
            }
          }
          if (values.ipamRoutes && values.ipamRoutes.trim()) {
            try {
              ipam.routes = JSON.parse(values.ipamRoutes);
            } catch (e) {
              message.warning('路由配置 JSON 格式错误，将忽略');
            }
          }
          if (values.ipamDns && values.ipamDns.trim()) {
            const dnsList = values.ipamDns.split(/[,;\s]+/).filter((d: string) => d.trim());
            if (dnsList.length > 0) {
              ipam.dns = {
                nameservers: dnsList
              };
            }
          }
        }
        
        // dhcp IPAM 配置
        if (values.ipamType === 'dhcp') {
          // DHCP 通常不需要额外配置，但可以配置路由和 DNS
          if (values.ipamRoutes && values.ipamRoutes.trim()) {
            try {
              ipam.routes = JSON.parse(values.ipamRoutes);
            } catch (e) {
              message.warning('路由配置 JSON 格式错误，将忽略');
            }
          }
          if (values.ipamDns && values.ipamDns.trim()) {
            const dnsList = values.ipamDns.split(/[,;\s]+/).filter((d: string) => d.trim());
            if (dnsList.length > 0) {
              ipam.dns = {
                nameservers: dnsList
              };
            }
          }
        }
      }

      // Construct config object for CNI
      const config: any = {
        cniVersion: values.cniVersion || '0.3.1',
        name: nadId, // Use generated ID as CNI config name
        type: values.cniType || 'bridge',
        promiscMode: values.promiscMode !== false, // 默认 true
      };

      // Bridge CNI 特定配置
      if (config.type === 'bridge') {
        config.bridge = bridgeName;
      }

      // VLAN 配置
      if (values.vlanId) {
        config.vlan = Number(values.vlanId);
      }

      // IPAM 配置（如果配置了 IPAM）
      if (Object.keys(ipam).length > 0) {
        config.ipam = ipam;
      } else {
        // 如果没有配置 IPAM，使用空对象（L2 网络）
        config.ipam = {};
      }
      
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

      <Collapse
        className="std-collapse-minimal"
        bordered={false}
        expandIconPosition="start"
        defaultActiveKey={[]}
      >
        <Panel header="高级配置" key="advanced">
          <Form.Item
            name="cniType"
            label="CNI 类型"
            initialValue="bridge"
            tooltip="CNI 插件类型，bridge 用于桥接网络，macvlan 用于直通物理网络"
          >
            <Select>
              <Select.Option value="bridge">bridge</Select.Option>
              <Select.Option value="macvlan">macvlan</Select.Option>
            </Select>
          </Form.Item>

          <Form.Item
            name="bridgeName"
            label="网桥名称"
            tooltip="网桥名称，留空则根据集群网络自动生成（mgmt -> mgmt-br）"
          >
            <Input placeholder="留空则自动生成" />
          </Form.Item>

          <Form.Item
            name="promiscMode"
            label="混杂模式"
            valuePropName="checked"
            initialValue={true}
            tooltip="启用混杂模式允许网桥接收所有流量"
          >
            <Switch />
          </Form.Item>

          <Form.Item
            name="cniVersion"
            label="CNI 版本"
            initialValue="0.3.1"
          >
            <Select>
              <Select.Option value="0.3.1">0.3.1</Select.Option>
              <Select.Option value="0.4.0">0.4.0</Select.Option>
            </Select>
          </Form.Item>

          <Form.Item
            name="ipamType"
            label="IP分配方式"
            tooltip="IP 地址管理方式：DHCP 模式（动态获取）、静态模式（手动指定 IP）、主机模式（节点本地分配）"
          >
            <Select placeholder="选择 IPAM 类型（留空表示不配置 IPAM）" allowClear>
              <Select.Option value="dhcp">DHCP 模式</Select.Option>
              <Select.Option value="static">静态模式</Select.Option>
              <Select.Option value="host-local">主机模式</Select.Option>
            </Select>
          </Form.Item>

          <Form.Item
            noStyle
            shouldUpdate={(prevValues, currentValues) => prevValues.ipamType !== currentValues.ipamType}
          >
            {({ getFieldValue }) => {
              const ipamType = getFieldValue('ipamType');
              
              if (ipamType === 'host-local') {
                return (
                  <>
                    <Form.Item
                      name="ipamSubnet"
                      label="IPAM 子网 (CIDR)"
                      tooltip="例如: 10.244.0.0/16"
                    >
                      <Input placeholder="例如: 10.244.0.0/16" />
                    </Form.Item>

                    <Form.Item
                      name="ipamRangeStart"
                      label="IP 范围起始"
                      tooltip="IP 地址池起始地址"
                    >
                      <Input placeholder="例如: 10.244.1.0" />
                    </Form.Item>

                    <Form.Item
                      name="ipamRangeEnd"
                      label="IP 范围结束"
                      tooltip="IP 地址池结束地址"
                    >
                      <Input placeholder="例如: 10.244.254.0" />
                    </Form.Item>

                    <Form.Item
                      name="ipamGateway"
                      label="网关地址"
                    >
                      <Input placeholder="例如: 10.244.0.1" />
                    </Form.Item>
                  </>
                );
              }

              if (ipamType === 'static') {
                return (
                  <Form.Item
                    name="ipamAddresses"
                    label="静态 IP 地址"
                    tooltip="多个地址用逗号分隔，例如: 10.244.1.10/24, 10.244.1.11/24"
                  >
                    <Input placeholder="例如: 10.244.1.10/24" />
                  </Form.Item>
                );
              }

              return null;
            }}
          </Form.Item>

          <Form.Item
            noStyle
            shouldUpdate={(prevValues, currentValues) => prevValues.ipamType !== currentValues.ipamType}
          >
            {({ getFieldValue }) => {
              const ipamType = getFieldValue('ipamType');
              
              // DHCP 类型：只显示 DNS 配置（路由由 DHCP 服务器提供）
              if (ipamType === 'dhcp') {
                return (
                  <Form.Item
                    name="ipamDns"
                    label="DNS 服务器"
                    tooltip="DHCP 服务器可能不提供 DNS，建议配置外部 DNS 服务器。多个 DNS 服务器用逗号分隔，例如: 8.8.8.8, 8.8.4.4"
                  >
                    <Input placeholder="例如: 8.8.8.8, 8.8.4.4" />
                  </Form.Item>
                );
              }
              
              // static 和 host-local 类型：显示路由和 DNS 配置
              if (ipamType === 'static' || ipamType === 'host-local') {
                return (
                  <>
                    <Form.Item
                      name="ipamRoutes"
                      label="路由配置 (JSON)"
                      tooltip='路由配置 JSON 数组，例如: [{"dst": "0.0.0.0/0", "gw": "10.244.0.1"}]'
                    >
                      <Input.TextArea 
                        rows={3} 
                        placeholder='例如: [{"dst": "0.0.0.0/0", "gw": "10.244.0.1"}]'
                      />
                    </Form.Item>

                    <Form.Item
                      name="ipamDns"
                      label="DNS 服务器"
                      tooltip="多个 DNS 服务器用逗号分隔，例如: 8.8.8.8, 8.8.4.4"
                    >
                      <Input placeholder="例如: 8.8.8.8, 8.8.4.4" />
                    </Form.Item>
                  </>
                );
              }

              return null;
            }}
          </Form.Item>
        </Panel>
      </Collapse>
    </StdFormModal>
  );
};

export default NadCreateModal;
