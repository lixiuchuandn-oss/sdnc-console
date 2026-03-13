/**
 * HotplugNic.tsx
 * 
 * 网卡热插拔组件
 * 
 * 功能：
 * 1. 添加网卡（热插拔）
 * 2. 移除网卡（热插拔）
 * 3. 显示当前可热插拔的网卡列表
 */
import React, { useState, useMemo } from 'react';
import { Form, Input, Select, Button, Card, List, Popconfirm, message, Space, Tag, Alert } from 'antd';
import { PlusOutlined, DeleteOutlined, ThunderboltOutlined } from '@ant-design/icons';
import { harvesterVmAction } from '../../../../../services/harvesterApi';

const { Option } = Select;

type Props = {
  form: any;
  cloudId: string;
  nads: any[];
  vpcs: any[];
  subnets: any[];
  reloadNads: () => void;
  reloadVpcs: () => void;
  reloadSubnets: () => void;
  hotUnpluggableNics: string[];
  reloadHotUnpluggableNics: () => void;
  record: any;
  onSuccess?: () => void;
};

const HotplugNic: React.FC<Props> = ({
  form,
  cloudId,
  nads,
  vpcs,
  subnets,
  reloadNads,
  reloadVpcs,
  reloadSubnets,
  hotUnpluggableNics,
  reloadHotUnpluggableNics,
  record,
  onSuccess,
}) => {
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);

  const namespace = record?.metadata?.namespace;
  const vmName = record?.metadata?.name;

  // 检查网卡热插拔的支持条件
  const canHotplugNic = useMemo(() => {
    if (!record) return false;
    
    // VM必须是可迁移的
    const conditions = record?.status?.conditions || [];
    const isLiveMigratable = conditions.some(
      (c: any) => c.type === 'LiveMigratable' && c.status === 'True'
    );
    
    // VM必须处于运行状态
    const isRunning = record?.status?.printableStatus === 'Running';
    
    // 所有接口必须有MAC地址
    const interfaces = record?.spec?.template?.spec?.domain?.devices?.interfaces || [];
    const allHaveMac = interfaces.every((i: any) => i.macAddress);
    
    return isLiveMigratable && isRunning && allHaveMac;
  }, [record]);

  // 获取当前所有网卡信息
  const currentInterfaces = useMemo(() => {
    const interfaces = record?.spec?.template?.spec?.domain?.devices?.interfaces || [];
    const networks = record?.spec?.template?.spec?.networks || [];
    
    return interfaces.map((iface: any) => {
      const net = networks.find((n: any) => n.name === iface.name);
      return {
        name: iface.name,
        mac: iface.macAddress || '-',
        networkName: net?.multus?.networkName || '-',
        isHotUnpluggable: hotUnpluggableNics.includes(iface.name),
      };
    });
  }, [record, hotUnpluggableNics]);

  // 过滤支持热插拔的NAD（bridge类型）
  const hotpluggableNads = useMemo(() => {
    return nads.filter((nad) => {
      try {
        const config = typeof nad.spec?.config === 'string' 
          ? JSON.parse(nad.spec.config) 
          : nad.spec?.config || {};
        const plugins = config.plugins || [config];
        return plugins.some((p: any) => p.type === 'bridge');
      } catch {
        return false;
      }
    });
  }, [nads]);

  // 生成MAC地址
  const generateMacAddress = () => {
    const chars = '0123456789abcdef';
    let mac = '02:'; // 本地管理地址
    for (let i = 0; i < 5; i++) {
      mac += chars[Math.floor(Math.random() * chars.length)];
      mac += chars[Math.floor(Math.random() * chars.length)];
      if (i < 4) mac += ':';
    }
    return mac;
  };

  // 添加网卡（热插拔）
  const handleAddNic = async () => {
    try {
      const values = await form.validateFields(['addNic']);
      const { interfaceName, networkName, macAddress } = values.addNic || {};

      if (!interfaceName || !networkName) {
        message.error('请填写网卡名称和选择网络');
        return;
      }

      setAdding(true);

      await harvesterVmAction(cloudId, namespace, vmName, 'addNic', {
        interfaceName,
        networkName,
        macAddress: macAddress || generateMacAddress(),
      });

      message.success('网卡添加成功（热插拔，无需重启）');
      form.resetFields(['addNic']);
      reloadHotUnpluggableNics();
      
      // 关闭模态框并刷新数据
      if (onSuccess) {
        onSuccess();
      }
    } catch (e: any) {
      const errorMsg = e?.message || e?.response?.data?.message || '添加网卡失败';
      message.error(errorMsg);
    } finally {
      setAdding(false);
    }
  };

  // 移除网卡（热插拔）
  const handleRemoveNic = async (interfaceName: string) => {
    if (!interfaceName) return;

    try {
      setRemoving(interfaceName);

      await harvesterVmAction(cloudId, namespace, vmName, 'removeNic', {
        interfaceName,
      });

      message.success('网卡移除成功（热插拔，无需重启）');
      reloadHotUnpluggableNics();
      
      // 关闭模态框并刷新数据
      if (onSuccess) {
        onSuccess();
      }
    } catch (e: any) {
      const errorMsg = e?.message || e?.response?.data?.message || '移除网卡失败';
      message.error(errorMsg);
    } finally {
      setRemoving(null);
    }
  };

  return (
    <div>
      {canHotplugNic ? (
        <Alert
          type="success"
          message="当前虚拟机支持网卡热插拔"
          description="无需重启，通过迁移实现。仅支持 virtio + bridge 类型。"
          style={{ marginBottom: 16 }}
          showIcon
        />
      ) : (
        <Alert
          type="warning"
          message="当前虚拟机不支持网卡热插拔"
          description={
            <span>
              需要满足：运行状态、可迁移（LiveMigratable）、所有网卡配置MAC地址
            </span>
          }
          style={{ marginBottom: 16 }}
          showIcon
        />
      )}

      {/* 添加网卡区域 */}
      <Card 
        title={
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <PlusOutlined />
            <span>添加网卡（热插拔）</span>
          </div>
        }
        style={{ marginBottom: 16 }}
      >
        <Form form={form} layout="vertical">
          <Form.Item name={['addNic', 'interfaceName']} label="网卡名称" rules={[{ required: true, message: '请输入网卡名称' }]}>
            <Input placeholder="例如：nic-1" disabled={!canHotplugNic} />
          </Form.Item>
          
          <Form.Item name={['addNic', 'networkName']} label="网络" rules={[{ required: true, message: '请选择网络' }]}>
            <Select
              placeholder="选择支持热插拔的网络"
              showSearch
              filterOption={(input, option) =>
                String(option?.label ?? '').toLowerCase().includes(input.toLowerCase())
              }
              onFocus={reloadNads}
              disabled={!canHotplugNic}
            >
              {hotpluggableNads.map((nad) => {
                const nadName = nad.metadata?.namespace 
                  ? `${nad.metadata.namespace}/${nad.metadata.name}`
                  : nad.metadata?.name || '';
                return (
                  <Option key={nadName} value={nadName} label={nadName}>
                    {nadName}
                  </Option>
                );
              })}
            </Select>
          </Form.Item>

          <Form.Item name={['addNic', 'macAddress']} label="MAC地址（可选）">
            <Input 
              placeholder="留空则自动生成" 
              addonAfter={
                <Button 
                  size="small" 
                  onClick={() => {
                    form.setFieldsValue({ addNic: { macAddress: generateMacAddress() } });
                  }}
                >
                  生成
                </Button>
              }
            />
          </Form.Item>

          <Form.Item>
            <Button 
              type="primary" 
              icon={<PlusOutlined />}
              onClick={handleAddNic}
              loading={adding}
              disabled={!canHotplugNic}
            >
              添加网卡（热插拔）
            </Button>
          </Form.Item>
        </Form>
      </Card>

      {/* 当前网卡列表 */}
      <Card 
        title={
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <ThunderboltOutlined />
            <span>当前网卡列表</span>
          </div>
        }
      >
        <List
          dataSource={currentInterfaces}
          renderItem={(item: any) => (
            <List.Item
              actions={[
                item.isHotUnpluggable ? (
                  <Popconfirm
                    title="确认移除网卡？"
                    description="此操作将通过热插拔移除网卡，无需重启虚拟机。"
                    onConfirm={() => handleRemoveNic(item.name)}
                    okText="确认"
                    cancelText="取消"
                  >
                    <Button
                      danger
                      size="small"
                      icon={<DeleteOutlined />}
                      loading={removing === item.name}
                      disabled={!!removing}
                    >
                      移除（热插拔）
                    </Button>
                  </Popconfirm>
                ) : (
                  <Tag color="default">不支持热插拔</Tag>
                ),
              ]}
            >
              <List.Item.Meta
                title={
                  <Space>
                    <span>{item.name}</span>
                    {item.isHotUnpluggable && (
                      <Tag color="blue" icon={<ThunderboltOutlined />}>
                        可热插拔
                      </Tag>
                    )}
                  </Space>
                }
                description={
                  <div>
                    <div>MAC: {item.mac}</div>
                    <div>网络: {item.networkName}</div>
                  </div>
                }
              />
            </List.Item>
          )}
        />
      </Card>
    </div>
  );
};

export default HotplugNic;
