/**
 * Harvester - 创建负载均衡弹窗
 */
import React, { useState, useEffect } from 'react';
import { Modal, Form, Input, Select, Button, Space, message, InputNumber, Radio, Tag, Row, Col, Collapse } from 'antd';
import { MinusCircleOutlined, PlusOutlined } from '@ant-design/icons';
import { apiPost, apiRequest } from '../../../../../../services/api';
import { fetchHarvesterNadDetail, fetchHarvesterNamespaces } from '../../../../../../services/harvesterApi';
import {
  buildIpPoolSelectOptions,
  buildLoadBalancerCreatePayload,
  buildNamespaceSelectOptions,
  parseLoadBalancerCreateError,
  pickDefaultNamespaceName,
  resolveKubeVipBridgeAnnotation,
  resolveNadInfoForIpPool,
  type LoadBalancerFormValues,
  type LoadBalancerNadInfo,
} from '../lib/createLoadBalancerModalUtils';

const { Panel } = Collapse;

interface Props {
  open: boolean;
  cloudId: string;
  namespaces: unknown[];
  onClose: () => void;
  onSuccess: () => void;
}

const CreateLoadBalancerModal: React.FC<Props> = ({
  open,
  cloudId,
  namespaces: propNamespaces,
  onClose,
  onSuccess,
}) => {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [ipPools, setIpPools] = useState<unknown[]>([]);
  const [nadInfo, setNadInfo] = useState<LoadBalancerNadInfo | null>(null);
  const [namespaces, setNamespaces] = useState<unknown[]>([]);

  useEffect(() => {
    if (open && (!propNamespaces || propNamespaces.length === 0)) {
      fetchHarvesterNamespaces(cloudId, false, true)
        .then((res: unknown) => {
          const items =
            (res as { data?: { items?: unknown[] }; items?: unknown[] })?.data?.items
            || (res as { items?: unknown[] })?.items
            || res
            || [];
          setNamespaces(Array.isArray(items) ? items : []);
        })
        .catch((err: unknown) => console.error('Failed to load namespaces', err));
    } else if (propNamespaces && propNamespaces.length > 0) {
      setNamespaces(propNamespaces);
    }
  }, [open, cloudId, propNamespaces]);

  useEffect(() => {
    if (open) {
      apiRequest(`/api/clouds/${cloudId}/resources/ippools`)
        .then((ippoolsRes: unknown) => {
          const allPools =
            (ippoolsRes as { data?: { items?: unknown[] } })?.data?.items || [];
          setIpPools(allPools);
        })
        .catch((err: unknown) => console.error('Failed to fetch IP pools', err));
    }
  }, [open, cloudId]);

  useEffect(() => {
    if (open) {
      form.resetFields();
      const defaultNs = pickDefaultNamespaceName(namespaces);
      if (defaultNs) {
        form.setFieldValue('namespace', defaultNs);
      }
    }
  }, [open, namespaces, form]);

  const onPoolChange = async (poolName: string) => {
    setNadInfo(null);
    try {
      const info = await resolveNadInfoForIpPool(poolName, ipPools, (nadNs, nadName) =>
        fetchHarvesterNadDetail(cloudId, nadNs, nadName),
      );
      setNadInfo(info);
    } catch (e) {
      console.error('Failed to fetch NAD detail for bridge info', e);
    }
  };

  const handleOk = async () => {
    try {
      const values = (await form.validateFields()) as LoadBalancerFormValues;
      setLoading(true);

      const kubeVipBridge = await resolveKubeVipBridgeAnnotation(values, ipPools, (nadNs, nadName) =>
        fetchHarvesterNadDetail(cloudId, nadNs, nadName).then((res) => (res as { data?: unknown })?.data || res),
      );

      const extraAnnotations = kubeVipBridge
        ? { 'kube-vip.io/serviceInterface': kubeVipBridge }
        : undefined;
      const payload = buildLoadBalancerCreatePayload(values, extraAnnotations);

      await apiPost(`/api/clouds/${cloudId}/resources/harvester-loadbalancers`, payload);

      message.success('负载均衡创建成功');
      onSuccess();
      onClose();
    } catch (e: unknown) {
      console.error(e);
      const err = e as { message?: string };
      message.error(`创建失败: ${parseLoadBalancerCreateError(err.message || '未知错误')}`);
    } finally {
      setLoading(false);
    }
  };

  const nsOptions = buildNamespaceSelectOptions(namespaces);
  const poolOptions = buildIpPoolSelectOptions(ipPools);

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
              label="项目"
              rules={[{ required: true, message: '请选择项目' }]}
            >
              <Select options={nsOptions} placeholder="请选择项目" showSearch />
            </Form.Item>
          </Col>
        </Row>

        <Form.Item label="IP 分配模式" name="ipam">
          <Radio.Group>
            <Radio value="pool">IP Pool (自动分配)</Radio>
            <Radio value="dhcp" disabled>
              DHCP (暂不支持)
            </Radio>
          </Radio.Group>
        </Form.Item>

        <Form.Item noStyle shouldUpdate={(prev, curr) => prev.ipam !== curr.ipam}>
          {({ getFieldValue }) =>
            getFieldValue('ipam') === 'pool' ? (
              <Form.Item
                name="ipPool"
                label="选择地址池"
                help={
                  nadInfo ? (
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
                  ) : null
                }
              >
                <Select
                  options={poolOptions}
                  placeholder="请选择 IP Pool"
                  allowClear
                  onChange={onPoolChange}
                  notFoundContent={
                    poolOptions.length === 0 ? '未找到 IP Pool，请先创建 IP Pool' : undefined
                  }
                />
              </Form.Item>
            ) : null
          }
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
                    <Button
                      type="dashed"
                      onClick={() => add()}
                      block
                      icon={<PlusOutlined />}
                      style={{ marginTop: 8, marginBottom: 24 }}
                    >
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
                    <Button
                      type="dashed"
                      onClick={() => add()}
                      block
                      icon={<PlusOutlined />}
                      style={{ marginTop: 8, marginBottom: 24 }}
                    >
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
