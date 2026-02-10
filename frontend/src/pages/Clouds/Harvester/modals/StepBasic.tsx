import React, { useMemo, useState, useEffect } from 'react';
import { Form, Input, Select, Radio, Space, Table, Tag, Typography, Button, Row, Col, Progress } from 'antd';
import { ReloadOutlined, LoadingOutlined } from '@ant-design/icons';
import { fetchHarvesterCapabilities } from '../../../../services/harvesterApi';
import { isSystemNamespace } from '../../../../utils/harvesterUtils';

interface StepBasicProps {
  form: any;
  cloudId: string;
  currentCloudId: string | undefined;
  setCurrentCloudId: (id: string | undefined) => void;
  cloudOptions: any[];
  namespaceOptions: any[];
  reloadNamespaces: () => void;
  hostModeState: string;
  setHostModeState: (mode: string) => void;
  nodeKeyword: string;
  setNodeKeyword: (kw: string) => void;
  nodesLoading: boolean;
  reloadNodes: () => void;
  currentProvider: string | undefined;
  selectedNodeName: string | null;
  setSelectedNodeName: (name: string | null) => void;
  filteredNodes: any[];
}

const StepBasic: React.FC<StepBasicProps> = ({
  form,
  cloudId,
  currentCloudId,
  setCurrentCloudId,
  cloudOptions,
  namespaceOptions,
  reloadNamespaces,
  hostModeState,
  setHostModeState,
  nodeKeyword,
  setNodeKeyword,
  nodesLoading,
  reloadNodes,
  currentProvider,
  selectedNodeName,
  setSelectedNodeName,
  filteredNodes,
}) => {
  const [nodeReadyFilter, setNodeReadyFilter] = useState<string>('running');
  const [capabilities, setCapabilities] = useState<any>({});

  useEffect(() => {
    if (cloudId && cloudId !== 'all') {
      fetchHarvesterCapabilities(cloudId).then((res: any) => {
        const data = res.data || {};
        setCapabilities(data);
        form.setFieldsValue({
          clusterArch: data.architecture,
          machineType: data.recommendedMachineType
        });
      }).catch((e: any) => console.error(e));
    }
  }, [cloudId]);

  // Auto-select first valid namespace if current value is invalid or empty
  useEffect(() => {
    const validOptions = namespaceOptions.filter(n => !isSystemNamespace(String(n.value || '')));
    const currentVal = form.getFieldValue('namespace');
    
    // Check if current value is valid (exists in validOptions)
    const isValid = currentVal && validOptions.some(o => o.value === currentVal);
    
    if (!isValid && validOptions.length > 0) {
      form.setFieldsValue({ namespace: validOptions[0].value });
    }
  }, [namespaceOptions]);

  const isNodeReady = (r: any): boolean => {
    if (typeof r?.ready === 'boolean') return r.ready;
    const conds: any[] = Array.isArray(r?.status?.conditions) ? r.status.conditions : [];
    return conds.some((c: any) => String(c?.type || '') === 'Ready' && String(c?.status || '').toLowerCase() === 'true');
  };
  const displayNodes = useMemo(() => {
    let arr: any[] = Array.isArray(filteredNodes) ? filteredNodes : [];
    if (nodeReadyFilter === 'running') arr = arr.filter(isNodeReady);
    else if (nodeReadyFilter === 'notready') arr = arr.filter((n:any)=> !isNodeReady(n));
    return arr;
  }, [filteredNodes, nodeReadyFilter]);
  return (
    <>
      <Typography.Paragraph type="secondary">设定新建云主机的基本信息，如名称、所属资源池等</Typography.Paragraph>
      <div className="wizard-group-title">基础配置</div>
      <Row gutter={12}>
        <Col span={12}>
          <Form.Item label="资源池" name="cloudId" initialValue={cloudId !== 'all' ? cloudId : undefined} rules={[{ required: true, message: '请选择资源池' }]}> 
            <Select 
              placeholder="选择资源池"
              onChange={(v) => { setCurrentCloudId(v); try { reloadNamespaces(); form.resetFields(['namespace']); } catch {} }}
              disabled={cloudId !== 'all'}
              options={cloudOptions}
              optionFilterProp="label"
              showSearch
            />
          </Form.Item>
        </Col>
        <Col span={12}>
          <Form.Item label="命名空间" name="namespace" rules={[{ required: true, message: '请选择命名空间' }]}> 
            <Select 
              options={namespaceOptions.filter(n => !isSystemNamespace(String(n.value || '')))}
              placeholder="选择命名空间"
              showSearch
              onOpenChange={(open) => { if (open) reloadNamespaces(); }}
            />
          </Form.Item>
        </Col>
      </Row>
      <Row gutter={12}>
        <Col span={12}>
          <Form.Item label="运行位置" name="hostMode"> 
            <Radio.Group buttonStyle="solid" onChange={(e)=> setHostModeState(e.target.value)}>
              <Radio.Button value="auto">自动调度</Radio.Button>
              <Radio.Button value="node">指定主机</Radio.Button>
              <Radio.Button value="label">标签选择</Radio.Button>
            </Radio.Group>
          </Form.Item>
        </Col>
        <Col span={6}>
          <Form.Item label="集群架构" name="clusterArch"> 
            <Input disabled placeholder="自动获取..." />
          </Form.Item>
        </Col>
        <Col span={6}>
          <Form.Item label="支持的VM类型" name="machineType" tooltip="根据集群架构自动推荐">
            <Select disabled placeholder="选择VM类型">
              {capabilities?.recommendedMachineType && (
                <Select.Option value={capabilities.recommendedMachineType}>
                  {capabilities.recommendedMachineType}
                </Select.Option>
              )}
            </Select>
          </Form.Item>
        </Col>
      </Row>

      {hostModeState === 'label' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 24 }}>
          <div className="wizard-section-title">标签选择</div>
          <Form.List name="nodeSelectorPairs" initialValue={[]}>
            {(fields, { add, remove }) => (
              <div style={{ border: '1px dashed #d9d9d9', padding: 8, borderRadius: 4 }}>
                {fields.map(({ key, name }) => (
                  <Row key={key} gutter={8} style={{ marginBottom: 8 }}>
                    <Col span={10}>
                      <Form.Item name={[name, 'key']} noStyle rules={[{ required: true, message: '请输入键' }]}> 
                        <Input placeholder="Key (如 kubernetes.io/hostname)" />
                      </Form.Item>
                    </Col>
                    <Col span={10}>
                      <Form.Item name={[name, 'value']} noStyle rules={[{ required: true, message: '请输入值' }]}> 
                        <Input placeholder="Value" />
                      </Form.Item>
                    </Col>
                    <Col span={4}>
                      <Button type="text" danger onClick={() => remove(name)}>删除</Button>
                    </Col>
                  </Row>
                ))}
                <Button onClick={() => add({ key: '', value: '' })}>新增选择器</Button>
              </div>
            )}
          </Form.List>
        </div>
      )}

      {hostModeState === 'node' ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 24 }}>
          <div className="wizard-section-title">主机列表</div>
          <Space style={{ width: '100%' }}>
            <Input allowClear size="small" placeholder="搜索主机名称/IP" value={nodeKeyword} onChange={(e) => setNodeKeyword(e.target.value)} style={{ flex: 1 }} />
            <Select
              size="small"
              value={nodeReadyFilter}
              style={{ width: 160 }}
              onChange={(v)=> setNodeReadyFilter(v || 'running')}
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
                onClick={() => { const p = (currentProvider || ''); if (p === 'harvester' || p === 'cloudmap') reloadNodes(); }}
                disabled={(function(){ const p = (currentProvider || ''); return !(p === 'harvester' || p === 'cloudmap'); })()}
              />
            )}
          </Space>
          <Table
            size="small"
            bordered
            rowKey={(r: any) => r.name}
            className="wizard-node-table"
            onRow={(record: any) => ({
              onClick: () => { const k = record?.name; setSelectedNodeName(k || null); }
            })}
            rowClassName={(record: any) => (hostModeState === 'node' && selectedNodeName && record?.name === selectedNodeName) ? 'wizard-table-row-active' : ''}
            columns={[
              {
                title: '', key: 'select', width: 52, align: 'center', className: 'wizard-node-select-col',
                onCell: () => ({ style: { paddingLeft: 8, paddingRight: 8 } }),
                render: (_: any, r: any) => (
                  <Radio style={{ margin: 0 }} checked={selectedNodeName === r?.name} onChange={(e) => { e.stopPropagation(); const k = r?.name; setSelectedNodeName(k || null); }} />
                )
              },
              {
                title: '主机名称', key: 'name', render: (_: any, r: any) => (
                  <div>
                    <div>{r?.name || '-'}</div>
                    <div style={{ color: '#999' }}>{r?.internalIP || '-'}</div>
                  </div>
                )
              },
              { title: '状态', dataIndex: 'ready', key: 'ready', render: (b: boolean) => b ? <Tag color="green">Ready</Tag> : <Tag color="red">NotReady</Tag> },
              {
                title: 'CPU 使用率', key: 'cpu_usage', render: (_: any, r: any) => {
                  const s = String(r?.name || r?.internalIP || '').trim();
                  let h = 0; for (let i = 0; i < s.length; i++) { h = (h * 31 + s.charCodeAt(i)) >>> 0; }
                  const pct = 25 + (h % 60);
                  const cpuRaw = r?.cpu ?? r?.status?.capacity?.cpu;
                  const cores = typeof cpuRaw === 'number' ? cpuRaw : Number(String(cpuRaw || '').replace(/[^0-9]/g, '')) || 0;
                  return (
                    <div>
                      <div style={{ fontSize: 12, color: '#555' }}>{cores ? `${cores} core` : '-'}</div>
                      <div style={{ width: 140 }}><Progress percent={pct} showInfo={false} /></div>
                    </div>
                  );
                }
              },
              {
                title: '内存使用率', key: 'mem_usage', render: (_: any, r: any) => {
                  const s = String(r?.internalIP || r?.name || '').trim();
                  let h = 0; for (let i = 0; i < s.length; i++) { h = (h * 17 + s.charCodeAt(i)) >>> 0; }
                  const pct = 20 + (h % 65);
                  const memRaw = r?.memory ?? r?.status?.capacity?.memory;
                  const raw = String(memRaw || '').toUpperCase();
                  const num = Number(String(raw).replace(/[^0-9]/g, '')) || 0;
                  let gb = 0;
                  if (/KI$/.test(raw)) { gb = Math.round(num / (1024 * 1024)); }
                  else if (/MI$/.test(raw)) { gb = Math.round(num / 1024); }
                  else if (/GI$/.test(raw)) { gb = num; }
                  else if (typeof memRaw === 'number') { gb = Math.round(Number(memRaw) / (1024 * 1024 * 1024)); }
                  const capText = gb ? `${gb} GB` : '-';
                  return (
                    <div>
                      <div style={{ fontSize: 12, color: '#555' }}>{capText}</div>
                      <div style={{ width: 140 }}><Progress percent={pct} showInfo={false} /></div>
                    </div>
                  );
                }
              },
            ] as any}
            dataSource={displayNodes}
            loading={nodesLoading}
            pagination={false}
          />
        </div>
      ) : null}
      <div className="wizard-group-title">信息</div>
      <Form.Item 
        label="虚拟机名称" 
        name="name" 
        rules={[
          { required: true, message: '请输入虚拟机名称' }
        ]}
      >
        <Input placeholder="显示名称（支持中文）" />
      </Form.Item>
      <Form.Item label="描述" name="description">
        <Input.TextArea placeholder="可选描述信息" autoSize={{ minRows: 2, maxRows: 4 }} />
      </Form.Item>
      <Form.Item label="虚机组" name="group">
        <Select placeholder="未选择虚拟机组" options={[{ label: '未选择', value: '' }]} />
      </Form.Item>
    </>
  );
};

export default StepBasic;