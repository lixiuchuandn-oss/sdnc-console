/**
 * Harvester - 创建负载均衡弹窗
 *
 * 基于 IP 池 (IPPool) 与后端标签选择器创建 Harvester LoadBalancer。
 * 功能：
 * - 打开时加载 IP 池列表，并根据选择的 IP 池反查 NAD，展示 bridge 与地址段信息；
 * - 配置监听端口列表 (listeners)：协议、前端端口、后端端口；
 * - 配置后端选择器 (selectors)：转换为 Harvester 期望的 map[string][]string；
 * - 若指定 IP Pool，会自动写入 `loadbalancer.harvesterhci.io/ip-pool` 注解，
 *   并尝试自动注入 `kube-vip.io/serviceInterface`（根据 NAD bridge 推导）。
 */
import React, { useState, useEffect } from 'react';
import { Modal, Form, Input, Select, Button, Space, message, InputNumber, Radio, Tag, Row, Col, Collapse } from 'antd';
import { MinusCircleOutlined, PlusOutlined } from '@ant-design/icons';
import { apiPost, apiRequest } from '../../../../../../services/api';
import { fetchHarvesterNadDetail, fetchHarvesterNads, fetchHarvesterNamespaces } from '../../../../../../services/harvesterApi';
import { isSystemNamespace } from '../../../../../../utils/harvesterUtils';

const { Panel } = Collapse;

/**
 * 组件入参说明
 * - open: 弹窗是否打开
 * - cloudId: 当前云 ID，用于拼接后端 API 路径
 * - namespaces: 可用命名空间列表，用于默认命名空间及下拉选择
 * - onClose: 关闭弹窗回调
 * - onSuccess: 创建成功后的回调（通常用于刷新列表）
 */
interface Props {
  open: boolean;
  cloudId: string;
  namespaces: any[];
  onClose: () => void;
  onSuccess: () => void;
}

const CreateLoadBalancerModal: React.FC<Props> = ({ open, cloudId, namespaces: propNamespaces, onClose, onSuccess }) => {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [ipPools, setIpPools] = useState<any[]>([]);
  const [nadInfo, setNadInfo] = useState<{name: string, bridge: string, range?: string} | null>(null);
  const [namespaces, setNamespaces] = useState<any[]>([]);

  // 加载命名空间列表（如果外部没有传入，后端已过滤系统命名空间）
  useEffect(() => {
    if (open && (!propNamespaces || propNamespaces.length === 0)) {
      fetchHarvesterNamespaces(cloudId, false, true) // excludeSystem=true
        .then((res: any) => {
          const items = res?.data?.items || res?.items || res || [];
          setNamespaces(items);
        })
        .catch((err: any) => console.error('Failed to load namespaces', err));
    } else if (propNamespaces && propNamespaces.length > 0) {
      setNamespaces(propNamespaces);
    }
  }, [open, cloudId, propNamespaces]);

  // 打开弹窗时加载 IP 池列表
  useEffect(() => {
    if (open) {
      apiRequest(`/api/clouds/${cloudId}/resources/ippools`)
        .then((ippoolsRes: any) => {
            const allPools = ippoolsRes.data?.items || [];
            setIpPools(allPools);
        })
        .catch((err: any) => console.error('Failed to fetch IP pools', err));
    }
  }, [open, cloudId]);

  // 打开弹窗时重置表单，并自动选择一个命名空间（优先 default）
  useEffect(() => {
    if (open) {
      form.resetFields();
      // Set default namespace if available
      if (namespaces && namespaces.length > 0) {
        // Prefer 'default' if exists, otherwise first one
        const def = namespaces.find(n => (n.metadata?.name || n.name) === 'default');
        form.setFieldValue('namespace', def ? (def.metadata?.name || def.name) : (namespaces[0].metadata?.name || namespaces[0].name));
      }
    }
  }, [open, namespaces, form]);

  /**
   * 当选择 IP Pool 时：
   * - 解析该 IP Pool 所引用的 NAD（networkRef）
   * - 请求 NAD 详情，从 config 中解析 bridge
   * - 将 NAD 名称 / bridge / 地址段 等信息展示在帮助区域
   */
  const onPoolChange = async (poolName: string) => {
      setNadInfo(null);
      if (!poolName) return;

      const selectedPool = ipPools.find(p => (p.metadata?.name || p.name) === poolName);
      if (!selectedPool) return;

      const poolSpec = selectedPool?.spec || selectedPool?.rawData?.spec;
      const networkRef = poolSpec?.selector?.network || poolSpec?.network;

      if (networkRef) {
          let nadNs, nadName;
          if (networkRef.includes('/')) {
            [nadNs, nadName] = networkRef.split('/');
          } else {
            nadName = networkRef;
            nadNs = selectedPool?.metadata?.namespace || selectedPool?.namespace || 'default';
          }
          
          // Extract ranges
          let rangeStr = '';
          if (poolSpec?.ranges && Array.isArray(poolSpec.ranges)) {
              rangeStr = poolSpec.ranges.map((r: any) => {
                  if (r.rangeStart && r.rangeEnd) return `${r.rangeStart}-${r.rangeEnd}`;
                  if (r.subnet) return r.subnet;
                  return '';
              }).filter(Boolean).join(', ');
          }

          if (nadNs && nadName) {
            try {
                const res = await fetchHarvesterNadDetail(cloudId, nadNs, nadName);
                // Backend returns { message: '...', data: { ... } }
                const nad = res?.data || res;
                if (nad?.spec?.config) {
                      const config = JSON.parse(nad.spec.config);
                      if (config.bridge) {
                          setNadInfo({
                              name: `${nadNs}/${nadName}`,
                              bridge: config.bridge,
                              range: rangeStr
                          });
                      }
                }
            } catch(e) {
                console.error('Failed to fetch NAD detail for bridge info', e);
            }
          }
      }
  };

  /**
   * 提交创建负载均衡：
   * - 组装 listeners 和 backendServerSelector；
   * - 若 IPAM=pool，则写入 IP Pool 注解，并尝试自动注入 kube-vip bridge；
   * - 调用后端 /harvester-loadbalancers API 创建资源。
   */
  const handleOk = async () => {
    try {
      const values = await form.validateFields();
      setLoading(true);

      // Construct payload
      // Transform listeners array
      const listeners = (values.listeners || []).map((l: any) => ({
        name: l.name,
        port: l.port,
        protocol: l.protocol,
        backendPort: l.backendPort,
      }));

      // Transform selector to map of string arrays { "key": ["value"] }
      // Harvester LoadBalancer v1beta1 expects backendServerSelector to be map[string][]string
      const backendServerSelector: Record<string, string[]> = {};
      (values.selectors || []).forEach((s: any) => {
        if (s.key && s.value) {
          if (backendServerSelector[s.key]) {
             backendServerSelector[s.key].push(s.value);
          } else {
             backendServerSelector[s.key] = [s.value];
          }
        }
      });

      const payload: any = {
        name: values.name,
        namespace: values.namespace,
        ipam: values.ipam || 'pool',
        listeners,
        workloadType: 'vm', // Currently fixed to VM as per typical Harvester usage
        backendServerSelector,
      };
      
      // If specific pool selected, add annotation
      if (values.ipam === 'pool' && values.ipPool) {
          if (!payload.annotations) payload.annotations = {};
          payload.annotations['loadbalancer.harvesterhci.io/ip-pool'] = values.ipPool;

          // Auto-inject kube-vip.io/serviceInterface from NAD bridge
          try {
            const selectedPool = ipPools.find(p => (p.metadata?.name || p.name) === values.ipPool);
            const poolSpec = selectedPool?.spec || selectedPool?.rawData?.spec;
            const networkRef = poolSpec?.selector?.network || poolSpec?.network;

            if (networkRef) {
              let nadNs, nadName;
              if (networkRef.includes('/')) {
                [nadNs, nadName] = networkRef.split('/');
              } else {
                nadName = networkRef;
                nadNs = selectedPool?.metadata?.namespace || selectedPool?.namespace || 'default';
              }

              if (nadNs && nadName) {
                const res = await fetchHarvesterNadDetail(cloudId, nadNs, nadName);
                const nad = res?.data || res;
                if (nad?.spec?.config) {
                  const config = JSON.parse(nad.spec.config);
                  if (config.bridge) {
                    payload.annotations['kube-vip.io/serviceInterface'] = config.bridge;
                  }
                }
              }
            }
          } catch (error) {
            console.warn('Failed to inject kube-vip bridge annotation:', error);
          }
      }

      await apiPost(`/api/clouds/${cloudId}/resources/harvester-loadbalancers`, payload);
      
      message.success('负载均衡创建成功');
      onSuccess();
      onClose();
    } catch (e: any) {
      console.error(e);
      let errorMsg = e.message || '未知错误';
      
      // Handle 409 Conflict / AlreadyExists
      if (typeof errorMsg === 'string') {
          if (errorMsg.includes('already exists') || errorMsg.includes('AlreadyExists')) {
              errorMsg = '该负载均衡名称已存在，请使用其他名称';
          } else if (errorMsg.includes('{')) {
              try {
                  // Try to parse JSON from error message if present
                  const jsonStart = errorMsg.indexOf('{');
                  const jsonPart = errorMsg.substring(jsonStart);
                  const errObj = JSON.parse(jsonPart);
                  if (errObj.reason === 'AlreadyExists' || errObj.code === 409) {
                      errorMsg = '该负载均衡名称已存在，请使用其他名称';
                  } else if (errObj.message) {
                      errorMsg = errObj.message;
                  }
              } catch {
                  // Ignore JSON parse error, use original message
              }
          }
      }
      
      message.error(`创建失败: ${errorMsg}`);
    } finally {
      setLoading(false);
    }
  };

  // 命名空间下拉选项（后端已过滤系统命名空间）
  const nsOptions = (namespaces || [])
    .map((n: any) => ({
      label: n.metadata?.name || n.name,
      value: n.metadata?.name || n.name,
    }));
  
  // IP Pool 下拉选项
  const poolOptions = ipPools.map((p: any) => ({
      label: p.metadata?.name || p.name,
      value: p.metadata?.name || p.name,
  }));

  return (
    <Modal
      title="创建负载均衡"
      open={open}
      onOk={handleOk}
      onCancel={onClose}
      confirmLoading={loading}
      width={700}
      okText="创建"
      cancelText="取消"
      destroyOnHidden
    >
      <Form
        form={form}
        layout="vertical"
        initialValues={{
          ipam: 'pool',
          listeners: [{ protocol: 'TCP' }],
        }}
      >
        <Row gutter={16}>
          <Col span={12}>
            <Form.Item
              name="name"
              label="名称"
              rules={[{ required: true, message: '请输入名称' }]}
            >
              <Input placeholder="请输入负载均衡名称" />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item
              name="namespace"
              label="命名空间"
              rules={[{ required: true, message: '请选择命名空间' }]}
            >
              <Select options={nsOptions} placeholder="请选择命名空间" showSearch />
            </Form.Item>
          </Col>
        </Row>

        <Form.Item label="IP 分配模式" name="ipam">
          <Radio.Group>
            <Radio value="pool">IP Pool (自动分配)</Radio>
            <Radio value="dhcp" disabled>DHCP (暂不支持)</Radio>
          </Radio.Group>
        </Form.Item>

        <Form.Item 
            noStyle 
            shouldUpdate={(prev, curr) => prev.ipam !== curr.ipam}
        >
            {({ getFieldValue }) => {
                return getFieldValue('ipam') === 'pool' ? (
                    <Form.Item 
                        name="ipPool" 
                        label="选择地址池"
                        help={nadInfo ? (
                            <Space size={16} style={{ marginTop: 4, flexWrap: 'wrap' }}>
                                <Space size={4}>
                                    <span style={{ color: '#888' }}>NAD:</span>
                                    <Tag>{nadInfo.name}</Tag>
                                </Space>
                                <Space size={4}>
                                    <span style={{ color: '#888' }}>Bridge:</span>
                                    <Tag color="blue">{nadInfo.bridge}</Tag>
                                </Space>
                                {nadInfo.range && (
                                    <Space size={4}>
                                        <span style={{ color: '#888' }}>Range:</span>
                                        <Tag color="cyan">{nadInfo.range}</Tag>
                                    </Space>
                                )}
                            </Space>
                        ) : null}
                    >
                        <Select 
                            options={poolOptions} 
                            placeholder="请选择 IP Pool"
                            allowClear
                            onChange={onPoolChange}
                            notFoundContent={poolOptions.length === 0 ? '未找到 IP Pool，请先创建 IP Pool' : undefined}
                        />
                    </Form.Item>
                ) : null;
            }}
        </Form.Item>

        <Collapse
          className="std-collapse-minimal"
          bordered={false}
          expandIconPosition="start"
          defaultActiveKey={['listeners']}
        >
          <Panel header="监听端口配置" key="listeners">
            <Form.Item required style={{ marginBottom: 0 }}>
              <Form.List name="listeners">
                {(fields, { add, remove }) => (
                  <>
                    {fields.map(({ key, name, ...restField }) => (
                      <Space key={key} style={{ display: 'flex', marginBottom: 12 }} align="baseline">
                        <Form.Item
                          {...restField}
                          name={[name, 'name']}
                          rules={[{ required: true, message: '请输入名称' }]}
                          style={{ marginBottom: 0 }}
                        >
                          <Input placeholder="名称 (e.g. http)" style={{ width: 120 }} />
                        </Form.Item>
                        <Form.Item
                          {...restField}
                          name={[name, 'protocol']}
                          initialValue="TCP"
                          style={{ marginBottom: 0 }}
                        >
                          <Select style={{ width: 80 }}>
                            <Select.Option value="TCP">TCP</Select.Option>
                            <Select.Option value="UDP">UDP</Select.Option>
                          </Select>
                        </Form.Item>
                        <Form.Item
                          {...restField}
                          name={[name, 'port']}
                          rules={[{ required: true, message: '前端端口' }]}
                          style={{ marginBottom: 0 }}
                        >
                          <InputNumber placeholder="前端端口" min={1} max={65535} style={{ width: 110 }} />
                        </Form.Item>
                        <span style={{ margin: '0 8px', color: '#999' }}>→</span>
                        <Form.Item
                          {...restField}
                          name={[name, 'backendPort']}
                          rules={[{ required: true, message: '后端端口' }]}
                          style={{ marginBottom: 0 }}
                        >
                          <InputNumber placeholder="后端端口" min={1} max={65535} style={{ width: 110 }} />
                        </Form.Item>
                        <Button 
                          type="text" 
                          icon={<MinusCircleOutlined />} 
                          onClick={() => remove(name)}
                          danger
                          style={{ padding: 0 }}
                        />
                      </Space>
                    ))}
                    <Button type="dashed" onClick={() => add()} block icon={<PlusOutlined />} style={{ marginTop: 8, marginBottom: 24 }}>
                      添加监听端口
                    </Button>
                  </>
                )}
              </Form.List>
            </Form.Item>
          </Panel>

          <Panel header="后端关联标签" key="selectors">
            <div style={{ marginBottom: 12, color: '#666', fontSize: 13 }}>
              负载均衡将流量转发到具有这些标签的 VM
            </div>
            <Form.Item style={{ marginBottom: 0 }}>
              <Form.List name="selectors">
                {(fields, { add, remove }) => (
                  <>
                    {fields.map(({ key, name, ...restField }) => (
                      <Space key={key} style={{ display: 'flex', marginBottom: 12 }} align="baseline">
                        <Form.Item
                          {...restField}
                          name={[name, 'key']}
                          rules={[{ required: true, message: '请输入 Key' }]}
                          style={{ marginBottom: 0 }}
                        >
                          <Input placeholder="标签 Key" style={{ width: 180 }} />
                        </Form.Item>
                        <span style={{ margin: '0 8px', color: '#999' }}>=</span>
                        <Form.Item
                          {...restField}
                          name={[name, 'value']}
                          rules={[{ required: true, message: '请输入 Value' }]}
                          style={{ marginBottom: 0 }}
                        >
                          <Input placeholder="标签 Value" style={{ width: 180 }} />
                        </Form.Item>
                        <Button 
                          type="text" 
                          icon={<MinusCircleOutlined />} 
                          onClick={() => remove(name)}
                          danger
                          style={{ padding: 0 }}
                        />
                      </Space>
                    ))}
                    <Button type="dashed" onClick={() => add()} block icon={<PlusOutlined />} style={{ marginTop: 8, marginBottom: 24 }}>
                      添加关联标签
                    </Button>
                  </>
                )}
              </Form.List>
            </Form.Item>
          </Panel>
        </Collapse>
      </Form>
    </Modal>
  );
};

export default CreateLoadBalancerModal;
