/**
 * Harvester - 创建 IP 池弹窗
 *
 * 负责创建 Harvester IPPool 资源，支持两种模式：
 * - CIDR 模式：为指定网络配置一个 CIDR 网段，由 IPAM 自动切分地址；
 * - IP 范围模式：在指定子网下配置起止 IP 范围与网关。
 * 创建时默认不提交关联网络（selector.network），仅提交命名空间与 scope。
 */
import React, { useState, useEffect } from 'react';
import { Modal, Form, Input, Select, Radio, message, Space } from 'antd';
import { createHarvesterIPPool, fetchHarvesterNamespaces } from '../../../../services/harvesterApi';

/**
 * 组件入参
 * - open: 弹窗开关
 * - onClose: 关闭回调
 * - onSuccess: 创建成功回调
 * - cloudId: 当前云 ID，用于调用 Harvester API
 */
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

  useEffect(() => {
    if (open) {
      loadNamespaces();
      form.resetFields();
      form.setFieldsValue({ type: 'cidr', namespace: 'default' });
    }
  }, [open]);

  // 加载业务命名空间（后端已过滤系统命名空间）
  const loadNamespaces = async () => {
    try {
      const res = await fetchHarvesterNamespaces(cloudId, false, true); // excludeSystem=true
      const items = res?.data?.items || res || [];
      const nsList = items
        .map((i: any) => i.metadata?.name || i.name)
        .filter((n: string) => n); // 后端已过滤系统命名空间，这里只需要过滤空值
      setNamespaces(nsList);
    } catch (e) {
      console.error('Failed to load namespaces', e);
    }
  };

  /**
   * 提交创建 IPPool：
   * - 基础结构使用 type + metadata + spec；
   * - selector.network 为 namespace/name 字符串；
   * - 根据类型选择填充 cidrs 或 ranges 字段。
   */
  const handleOk = async () => {
    try {
      const values = await form.validateFields();
      setLoading(true);

      const payload: any = {
        type: 'loadbalancer.harvesterhci.io.ippool',
        metadata: {
          name: values.name,
        },
        spec: {
          selector: {
            scope: [
              { namespace: values.namespace }
            ]
          },
        },
      };

      if (values.type === 'cidr') {
        payload.spec.cidrs = [values.cidr];
      } else {
        payload.spec.ranges = [{ 
          start: values.start, 
          end: values.end,
          subnet: values.rangeSubnet,
          gateway: values.rangeGateway 
        }];
      }

      await createHarvesterIPPool(cloudId, payload);
      message.success('IP池创建成功');
      onSuccess();
      onClose();
    } catch (e: any) {
      message.error(e.message || '创建失败');
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
              message: '名称必须由小写字母、数字、"-"或"."组成，且以字母或数字开头和结尾'
            }
          ]}
        >
          <Input placeholder="e.g. pool-1" />
        </Form.Item>

        <Form.Item
          name="namespace"
          label="命名空间"
          rules={[{ required: true, message: '请选择命名空间' }]}
        >
          <Select showSearch>
            {namespaces.map(ns => (
              <Select.Option key={ns} value={ns}>{ns}</Select.Option>
            ))}
          </Select>
        </Form.Item>

        <Form.Item label="类型" name="type">
          <Radio.Group onChange={e => setType(e.target.value)}>
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
              { pattern: /^([0-9]{1,3}\.){3}[0-9]{1,3}\/[0-9]+$/, message: '格式错误 (e.g. 192.168.1.0/24)' }
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
                { pattern: /^([0-9]{1,3}\.){3}[0-9]{1,3}\/[0-9]+$/, message: '格式错误 (e.g. 192.168.1.0/24)' }
              ]}
            >
              <Input placeholder="192.168.1.0/24" />
            </Form.Item>
            <Form.Item
              name="rangeGateway"
              label="网关 IP"
              rules={[
                { required: true, message: '请输入网关 IP' },
                { pattern: /^([0-9]{1,3}\.){3}[0-9]{1,3}$/, message: 'IP 格式错误' }
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
                  { pattern: /^([0-9]{1,3}\.){3}[0-9]{1,3}$/, message: 'IP 格式错误' }
                ]}
              >
                <Input placeholder="192.168.1.100" />
              </Form.Item>
              <Form.Item
                name="end"
                label="结束 IP"
                rules={[
                  { required: true, message: '请输入结束 IP' },
                  { pattern: /^([0-9]{1,3}\.){3}[0-9]{1,3}$/, message: 'IP 格式错误' }
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
