import React from 'react';
import { Form, Popover, Typography, Button, Space, Tag, Modal, Input, Select } from 'antd';
import { SafetyCertificateOutlined, ReloadOutlined, PlusOutlined, GlobalOutlined, CloudServerOutlined, PartitionOutlined, EnvironmentOutlined, QuestionCircleOutlined } from '@ant-design/icons';

export default function StepProtectionObjects(props: any) {
  const {
    form,
    TableTransfer,
    directData,
    setDirectData,
    addDirectOpen,
    setAddDirectOpen,
    addDirectForm,
    fetchProtectionObjects,
    message,
    onReload,
    onAdd,
  } = props;

  return (
    <div>
      <Form form={form} layout="vertical">
        <div style={{ background: '#e6f7ff', padding: '12px 16px', borderRadius: 8, marginBottom: 16, border: '1px solid #91d5ff' }}>
          <Form.Item
            label={
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontWeight: 600 }}>选择引流方式</span>
                <Popover
                  content={
                    <div style={{ maxWidth: 620 }}>
                      <div style={{ marginBottom: 8, fontWeight: 600, color: '#1f1f1f' }}>关于防护对象配置</div>
                      <ul style={{ margin: 0, paddingLeft: 18, color: 'rgba(0, 0, 0, 0.88)', lineHeight: 1.8, fontSize: 13 }}>
                        <li>
                          <span style={{ fontWeight: 500 }}>关联方式：</span>
                          <span>直接新建或选择已有防护目标进行直连引流。</span>
                        </li>
                        <li>
                          <span style={{ fontWeight: 500 }}>资源支持：</span>
                          <span>支持云主机、子网、弹性公网IP等多种资源对象的混合编排。</span>
                        </li>
                        <li>
                          <span style={{ fontWeight: 500 }}>引流机制：</span>
                          <span>选中对象将作为流量入口，自动引流至当前配置的服务链。</span>
                        </li>
                      </ul>
                    </div>
                  }
                  title={null}
                  trigger="hover"
                  placement="topRight"
                >
                  <Typography.Link style={{ fontSize: 13, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    <QuestionCircleOutlined />
                    如何选择防护对象？
                  </Typography.Link>
                </Popover>
              </div>
            }
            style={{ marginBottom: 0 }}
          >
            <Tag color="blue">直连引流</Tag>
          </Form.Item>
        </div>

        <div>
          {
            <Form.Item style={{ marginBottom: 0 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: '#1f1f1f' }}>
                    <SafetyCertificateOutlined style={{ marginRight: 6, color: '#1677ff' }} />
                    配置防护对象列表
                  </div>
                  <Space>
                    <Button icon={<ReloadOutlined />} onClick={async () => {
                      try {
                        const objs = await fetchProtectionObjects({});
                        const mapped = objs.map((o: any) => ({
                          key: o.value || o.id,
                          title: o.name,
                          description: o.description || '',
                          type: (o.type === 'subnet' ? 'Network' : (o.type === 'ip' ? 'IP' : (o.type === 'line' ? 'IP' : 'VM'))),
                          ports: (o.ports || o.port || ((o.portStart && o.portEnd) ? `${o.portStart}-${o.portEnd}` : undefined)) || '全部',
                        }));
                        if (onReload) {
                          onReload(mapped);
                        } else if (setDirectData) {
                          setDirectData(mapped);
                        }
                        message.success('已加载现有防护对象');
                      } catch {
                        message.error('加载防护对象失败');
                      }
                    }}>加载已有</Button>
                    <Button type="primary" icon={<PlusOutlined />} onClick={() => setAddDirectOpen(true)}>新增条目</Button>
                  </Space>
                </div>

                <Form.Item
                  name="protectedObjects"
                  valuePropName="targetKeys"
                  initialValue={[]}
                  rules={[{ required: true, message: '请至少选择一个防护对象' }]}
                  style={{ marginBottom: 0 }}
                >
                  <TableTransfer
                    style={{ width: '100%' }}
                    listStyle={{
                      height: 450,
                      borderRadius: 8,
                      border: '1px solid #f0f0f0'
                    }}
                    dataSource={directData}
                    titles={[
                      <div style={{ color: '#595959', fontWeight: 500 }}>待选对象</div>,
                      <div style={{ color: '#1677ff', fontWeight: 500 }}>已选对象</div>
                    ]}
                    leftColumns={[
                      {
                        dataIndex: 'title',
                        title: '防护对象',
                        render: (text: any, record: any) => (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <div style={{
                              width: 32, height: 32,
                              background: '#f5f7fa',
                              borderRadius: 6,
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                              color: '#1677ff'
                            }}>
                              {record.type === 'VM' && <CloudServerOutlined />}
                              {record.type === 'Network' && <GlobalOutlined />}
                              {record.type === 'VSW' && <PartitionOutlined />}
                              {record.type === 'IP' && <EnvironmentOutlined />}
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column' }}>
                              <span style={{ fontWeight: 500 }}>{text}</span>
                            </div>
                          </div>
                        )
                      },
                      {
                        dataIndex: 'type',
                        title: '类型',
                        width: 100,
                        render: (text: any) => <Tag color="blue">{text}</Tag>,
                        filters: [
                          { text: 'IP', value: 'IP' },
                          { text: 'Network', value: 'Network' },
                          { text: 'VSW', value: 'VSW' },
                          { text: 'VM', value: 'VM' },
                        ],
                        onFilter: (value: any, item: any) => item.type === value,
                      },
                      {
                        dataIndex: 'title',
                        title: '防护范围',
                        render: (_: any, record: any) => (
                          <div>
                            <div style={{ display: 'flex', flexDirection: 'column' }}>
                              <span style={{ color: '#8c8c8c' }}>{record.key}</span>
                            </div>
                          </div>
                        )
                      },
                      {
                        dataIndex: 'ports',
                        title: '防护端口',
                        width: 120,
                        render: (t: any) => <Tag style={{ marginRight: 0 }}>{t || '全部'}</Tag>
                      },
                    ]}
                    rightColumns={[
                      {
                        dataIndex: 'title',
                        title: '防护对象',
                        render: (text: any, record: any) => (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <div style={{
                              width: 32, height: 32,
                              background: '#f5f7fa',
                              borderRadius: 6,
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                              color: '#1677ff'
                            }}>
                              {record.type === 'VM' && <CloudServerOutlined />}
                              {record.type === 'Network' && <GlobalOutlined />}
                              {record.type === 'VSW' && <PartitionOutlined />}
                              {record.type === 'IP' && <EnvironmentOutlined />}
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column' }}>
                              <span style={{ fontWeight: 500 }}>{text}</span>
                            </div>
                          </div>
                        )
                      },
                      {
                        dataIndex: 'type',
                        title: '类型',
                        width: 100,
                        render: (text: any) => <Tag color="blue">{text}</Tag>,
                        filters: [
                          { text: 'IP', value: 'IP' },
                          { text: 'Network', value: 'Network' },
                          { text: 'VSW', value: 'VSW' },
                          { text: 'VM', value: 'VM' },
                        ],
                        onFilter: (value: any, item: any) => item.type === value,
                      },
                      {
                        dataIndex: 'title',
                        title: '防护范围',
                        render: (_: any, record: any) => (
                          <div>
                            <div style={{ display: 'flex', flexDirection: 'column' }}>
                              <span style={{ color: '#8c8c8c' }}>{record.key}</span>
                            </div>
                          </div>
                        )
                      },
                      {
                        dataIndex: 'ports',
                        title: '防护端口',
                        width: 120,
                        render: (t: any) => <Tag style={{ marginRight: 0 }}>{t || '全部'}</Tag>
                      },
                    ]}
                    filterOption={(inputValue: string, item: any) =>
                      (item.title?.indexOf(inputValue) ?? -1) > -1
                      || (item.description?.indexOf(inputValue) ?? -1) > -1
                      || (item.ports?.indexOf(inputValue) ?? -1) > -1
                    }
                    showSearch
                  />
                </Form.Item>
                <Modal
                  title="新增直连引流条目"
                  open={addDirectOpen}
                  onCancel={() => setAddDirectOpen(false)}
                  onOk={() => {
                    addDirectForm
                      .validateFields()
                      .then((vals: any) => {
                        const newItem = {
                          key: vals.value,
                          title: vals.name || vals.value,
                          description: vals.value,
                          type: (vals.type === 'ip' ? 'IP' : 'Network'),
                          ports: vals.ports || '全部',
                        };
                        if (onAdd) {
                          onAdd(newItem);
                        } else if (setDirectData) {
                          setDirectData((prev: any) => [newItem, ...prev]);
                        }
                        setAddDirectOpen(false);
                        addDirectForm.resetFields();
                        message.success('已新增条目');
                      })
                      .catch(() => {});
                  }}
                >
                  <Form form={addDirectForm} layout="vertical">
                    <Form.Item name="type" label="类型" rules={[{ required: true }]}>
                      <Select placeholder="请选择类型">
                        <Select.Option value="ip">IP</Select.Option>
                        <Select.Option value="subnet">IP段</Select.Option>
                      </Select>
                    </Form.Item>
                    <Form.Item name="value" label="值" rules={[{ required: true }]}>
                      <Input placeholder="例如 192.168.1.10 或 192.168.1.0/24" />
                    </Form.Item>
                    <Form.Item name="ports" label="防护端口">
                      <Input placeholder="例如 80,443 或 1-65535；留空表示全部" />
                    </Form.Item>
                    <Form.Item name="name" label="名称">
                      <Input placeholder="可选：为条目取一个名称" />
                    </Form.Item>
                  </Form>
                </Modal>
              </div>
            </Form.Item>
          }
        </div>
      </Form>
    </div>
  );
}
