/**
 * ChangeNodeScheduling.tsx
 * 
 * 节点调度修改组件
 * 参考创建虚拟机时的节点选择设计
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Form, Segmented, Radio, Table, Tag, Space, Input, Select, Button, Row, Col, Typography, Card } from 'antd';
import { ReloadOutlined, LoadingOutlined, PlusOutlined, MinusCircleOutlined } from '@ant-design/icons';
// CSS 样式在 VmReconfigureModal 中统一导入

type Props = {
  form: any;
  cloudId: string;
  record: any;
  nodes?: any[];
  reloadNodes?: () => Promise<any>;
  nodesLoading?: boolean;
};

const ChangeNodeScheduling: React.FC<Props> = ({ 
  form, 
  cloudId, 
  record, 
  nodes = [],
  reloadNodes,
  nodesLoading = false
}) => {
  const [nodeKeyword, setNodeKeyword] = useState('');
  const [nodeReadyFilter, setNodeReadyFilter] = useState<'all' | 'running' | 'notready'>('all');
  
  // 从 VM 配置中提取当前的节点调度信息
  useEffect(() => {
    if (!record) return;
    
    const spec = record?.spec?.template?.spec;
    const nodeSelector = spec?.nodeSelector;
    
    // 提取节点选择器中的 hostname
    // 优先从 nodeSelector 中获取，如果没有则从 status 中获取当前运行节点
    let currentNode: string | null = null;
    
    // 检查 nodeSelector 是否存在且有内容
    if (nodeSelector && typeof nodeSelector === 'object' && Object.keys(nodeSelector).length > 0) {
      currentNode = nodeSelector['kubernetes.io/hostname'] || null;
    }
    
    // 如果 nodeSelector 中没有 hostname，尝试从 status 中获取当前运行节点
    // 但只有在确实是指定主机模式时才使用（即 nodeSelector 中有其他字段或明确设置了 hostname）
    if (!currentNode) {
      const currentRunningNode = record?.status?.nodeName || record?.status?.hostNodeName || record?.nodeName || null;
      // 如果 nodeSelector 存在且不为空，说明是指定主机模式，使用运行节点
      if (currentRunningNode && nodeSelector && typeof nodeSelector === 'object' && Object.keys(nodeSelector).length > 0) {
        currentNode = currentRunningNode;
      }
    }
    
    // 提取其他标签（除了 hostname）
    const labelPairs: Array<{ key: string; value: string }> = [];
    if (nodeSelector && typeof nodeSelector === 'object') {
      Object.entries(nodeSelector).forEach(([key, value]) => {
        if (key !== 'kubernetes.io/hostname' && value) {
          labelPairs.push({ key, value: String(value) });
        }
      });
    }
    
    // 判断调度模式
    let mode: 'auto' | 'fixed' | 'label' = 'auto';
    if (currentNode) {
      mode = 'fixed';
    } else if (labelPairs.length > 0) {
      mode = 'label';
    }
    
    // 设置表单值
    form.setFieldsValue({
      nodeSchedulingMode: mode,
      fixedNode: currentNode || undefined,
      nodeSelectorPairs: labelPairs.length > 0 ? labelPairs : undefined,
    });
  }, [record, form]);
  
  // 当调度模式改变时，清空其他模式的字段
  const nodeSchedulingMode = Form.useWatch('nodeSchedulingMode', form);
  useEffect(() => {
    if (nodeSchedulingMode === 'auto') {
      form.setFieldsValue({ 
        fixedNode: undefined,
        nodeSelectorPairs: undefined,
      });
    } else if (nodeSchedulingMode === 'fixed') {
      form.setFieldsValue({ 
        nodeSelectorPairs: undefined,
      });
    } else if (nodeSchedulingMode === 'label') {
      form.setFieldsValue({ 
        fixedNode: undefined,
      });
    }
  }, [nodeSchedulingMode, form]);

  // 判断节点是否就绪
  const isNodeReady = (r: any): boolean => {
    if (typeof r?.ready === 'boolean') return r.ready;
    const conds: any[] = Array.isArray(r?.status?.conditions) ? r.status.conditions : [];
    return conds.some((c: any) => String(c?.type || '') === 'Ready' && String(c?.status || '').toLowerCase() === 'true');
  };

  // 过滤和搜索节点
  const displayNodes = useMemo(() => {
    let arr: any[] = Array.isArray(nodes) ? nodes : [];
    
    // 按状态过滤
    if (nodeReadyFilter === 'running') {
      arr = arr.filter(isNodeReady);
    } else if (nodeReadyFilter === 'notready') {
      arr = arr.filter((n: any) => !isNodeReady(n));
    }
    
    // 按关键字搜索
    if (nodeKeyword) {
      const kw = String(nodeKeyword).toLowerCase().trim();
      arr = arr.filter((n: any) => {
        const name = String(n?.name || '').toLowerCase();
        const ip = String(n?.internalIP || '').toLowerCase();
        return name.includes(kw) || ip.includes(kw);
      });
    }
    
    return arr;
  }, [nodes, nodeReadyFilter, nodeKeyword]);

  const selectedNodeName = Form.useWatch('fixedNode', form);

  return (
    <div>
      <Form.Item 
        name="nodeSchedulingMode" 
        rules={[{ required: true, message: '请选择调度模式' }]}
      >
        <Segmented
          options={[
            { value: 'auto', label: '自动调度' },
            { value: 'fixed', label: '指定主机' },
            { value: 'label', label: '标签选择' },
          ]}
        />
      </Form.Item>

      {/* 隐藏的 Form.Item 用于绑定 fixedNode 字段 */}
      <Form.Item name="fixedNode" hidden>
        <Input />
      </Form.Item>

      {nodeSchedulingMode === 'fixed' && (
        <div>
            <Space style={{ width: '100%', marginBottom: 12 }}>
              <Input 
                allowClear 
                size="small" 
                placeholder="搜索主机名称/IP" 
                value={nodeKeyword} 
                onChange={(e) => setNodeKeyword(e.target.value)} 
                style={{ flex: 1 }} 
              />
              <Select
                size="small"
                value={nodeReadyFilter}
                style={{ width: 160 }}
                onChange={(v) => setNodeReadyFilter(v || 'all')}
                options={[
                  { value: 'all', label: '全部主机' },
                  { value: 'running', label: '健康主机' },
                  { value: 'notready', label: '未就绪主机' },
                ]}
              />
              {nodesLoading ? (
                <LoadingOutlined style={{ fontSize: 16, color: '#1677ff' }} />
              ) : (
                <Button
                  size="small"
                  icon={<ReloadOutlined style={{ fontSize: 14, color: '#8c8c8c' }} />}
                  type="default"
                  onClick={() => reloadNodes?.()}
                />
              )}
            </Space>
            <Table
              size="small"
              bordered
              rowKey={(r: any) => r?.name || r?.metadata?.name || ''}
              className="wizard-node-table"
              onRow={(record: any) => ({
                onClick: () => {
                  const nodeName = record?.name || record?.metadata?.name;
                  if (nodeName) {
                    form.setFieldsValue({ fixedNode: nodeName });
                  }
                }
              })}
              rowClassName={(record: any) => {
                const nodeName = record?.name || record?.metadata?.name;
                return (selectedNodeName && nodeName === selectedNodeName) ? 'wizard-table-row-active' : '';
              }}
              columns={[
                {
                  title: '', 
                  key: 'select', 
                  width: 52, 
                  align: 'center', 
                  className: 'wizard-node-select-col',
                  onCell: () => ({ style: { paddingLeft: 8, paddingRight: 8 } }),
                  render: (_: any, r: any) => {
                    const nodeName = r?.name || r?.metadata?.name;
                    const isSelected = selectedNodeName === nodeName;
                    return (
                      <Radio 
                        style={{ margin: 0 }} 
                        checked={isSelected} 
                        onChange={(e) => {
                          e.stopPropagation();
                          if (nodeName) {
                            form.setFieldsValue({ fixedNode: nodeName });
                          }
                        }} 
                      />
                    );
                  }
                },
                {
                  title: '主机名称', 
                  key: 'name', 
                  render: (_: any, r: any) => {
                    const name = r?.name || r?.metadata?.name || '-';
                    const ip = r?.internalIP || r?.status?.addresses?.find((a: any) => a.type === 'InternalIP')?.address || '-';
                    return (
                      <div>
                        <div>{name}</div>
                        <div style={{ color: '#999', fontSize: 12 }}>{ip}</div>
                      </div>
                    );
                  }
                },
                { 
                  title: '状态', 
                  key: 'ready', 
                  render: (_: any, r: any) => {
                    const ready = isNodeReady(r);
                    return ready ? <Tag color="green">Ready</Tag> : <Tag color="red">NotReady</Tag>;
                  }
                },
                {
                  title: 'CPU', 
                  key: 'cpu', 
                  render: (_: any, r: any) => {
                    const cpuRaw = r?.cpu ?? r?.status?.capacity?.cpu;
                    const cores = typeof cpuRaw === 'number' ? cpuRaw : Number(String(cpuRaw || '').replace(/[^0-9]/g, '')) || 0;
                    return <div style={{ fontSize: 12, color: '#555' }}>{cores ? `${cores} core` : '-'}</div>;
                  }
                },
                {
                  title: '内存', 
                  key: 'memory', 
                  render: (_: any, r: any) => {
                    const memRaw = r?.memory ?? r?.status?.capacity?.memory;
                    const raw = String(memRaw || '').toUpperCase();
                    const num = Number(String(raw).replace(/[^0-9]/g, '')) || 0;
                    let gb = 0;
                    if (/KI$/.test(raw)) { gb = Math.round(num / (1024 * 1024)); }
                    else if (/MI$/.test(raw)) { gb = Math.round(num / 1024); }
                    else if (/GI$/.test(raw)) { gb = num; }
                    else if (typeof memRaw === 'number') { gb = Math.round(Number(memRaw) / (1024 * 1024 * 1024)); }
                    return <div style={{ fontSize: 12, color: '#555' }}>{gb ? `${gb} GB` : '-'}</div>;
                  }
                },
              ]}
              dataSource={displayNodes}
              loading={nodesLoading}
              pagination={false}
            />
          <div style={{ marginTop: 6 }}>
            <Typography.Text type="secondary">
              固定节点通常用于 GPU 等硬件资源绑定
            </Typography.Text>
          </div>
        </div>
      )}

      {nodeSchedulingMode === 'label' && (
        <div>
            <Form.List name="nodeSelectorPairs">
              {(fields, { add, remove }) => (
                <div>
                  {fields.map(({ key, name }, idx) => (
                    <Card
                      key={key}
                      size="small"
                      title={`标签选择器 #${idx + 1}`}
                      extra={
                        <Button 
                          type="text" 
                          icon={<MinusCircleOutlined />} 
                          onClick={() => remove(name)} 
                          danger 
                          size="small"
                        />
                      }
                      style={{ marginBottom: 12, border: '1px solid #d9d9d9' }}
                    >
                      <Row gutter={8}>
                        <Col span={12}>
                          <Form.Item 
                            name={[name, 'key']} 
                            noStyle 
                            rules={[{ required: true, message: '请输入键' }]}
                          >
                            <Input placeholder="Key (如 kubernetes.io/hostname)" />
                          </Form.Item>
                        </Col>
                        <Col span={12}>
                          <Form.Item 
                            name={[name, 'value']} 
                            noStyle 
                            rules={[{ required: true, message: '请输入值' }]}
                          >
                            <Input placeholder="Value" />
                          </Form.Item>
                        </Col>
                      </Row>
                    </Card>
                  ))}
                  <Button 
                    type="dashed"
                    onClick={() => add({ key: '', value: '' })}
                    icon={<PlusOutlined />}
                    style={{ width: '100%' }}
                  >
                    新增选择器
                  </Button>
                </div>
              )}
            </Form.List>
          <div style={{ marginTop: 6 }}>
            <Typography.Text type="secondary">
              通过节点标签匹配节点，支持多个标签条件（AND 关系）
            </Typography.Text>
          </div>
        </div>
      )}
    </div>
  );
};

export default ChangeNodeScheduling;
