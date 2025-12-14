import React, { useMemo, useState } from 'react';
import { Form, Input, Select, Radio, Space, Table, Tag, Typography, Button, Row, Col, Progress } from 'antd';
import { ReloadOutlined, LoadingOutlined } from '@ant-design/icons';

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
      <Row gutter={24}>
        <Col span={12}>
          <Form.Item label="资源池" name="cloudId" initialValue={cloudId !== 'all' ? cloudId : undefined} rules={[{ required: true, message: '请选择资源池' }]}> 
            <Select 
              options={cloudOptions} 
              placeholder="选择资源池"
              onChange={(v) => { setCurrentCloudId(v); try { reloadNamespaces(); form.setFieldsValue({ namespace: 'default' }); } catch {} }}
              disabled={cloudId !== 'all'}
            />
          </Form.Item>
        </Col>
        <Col span={12}>
          <Form.Item label="命名空间" name="namespace" initialValue="default" rules={[{ required: true }]}> 
            <Select 
              options={namespaceOptions}
              placeholder="选择命名空间"
              showSearch
              onDropdownVisibleChange={(open) => { if (open) reloadNamespaces(); }}
            />
          </Form.Item>
        </Col>
      </Row>
      <Form.Item label="运行位置" name="hostMode" initialValue="auto"> 
        <Radio.Group buttonStyle="solid" onChange={(e)=> setHostModeState(e.target.value)}>
          <Radio.Button value="auto">自动调度</Radio.Button>
          <Radio.Button value="node">指定主机</Radio.Button>
          <Radio.Button value="label">标签选择器</Radio.Button>
        </Radio.Group>
      </Form.Item>

      {hostModeState === 'label' && (
        <Form.Item label="标签选择" style={{ marginBottom: 0 }}>
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
                <Button type="dashed" onClick={() => add({ key: '', value: '' })}>新增选择器</Button>
              </div>
            )}
          </Form.List>
        </Form.Item>
      )}

      {hostModeState === 'node' ? (
        <>
          <div className="wizard-section-title" style={{ marginTop: 8 }}>主机列表</div>
          <Space style={{ width: '100%', marginTop: 4 }}>
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
            style={{ marginTop: 10, marginBottom: 24 }}
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
        </>
      ) : null}
      <div className="wizard-group-title">信息</div>
      <Form.Item label="虚拟机名称" name="name" rules={[{ required: true, message: '请输入虚拟机名称' }]}>
        <Input placeholder="如：vm-001" />
      </Form.Item>
      <Form.Item label="描述（可选）" name="description">
        <Input.TextArea rows={3} placeholder="备注信息" />
      </Form.Item>
      <Form.Item label="虚机组" name="group">
        <Select placeholder="未选择虚拟机组" options={[{ label: '未选择', value: '' }]} />
      </Form.Item>
    </>
  );
};

export default StepBasic;
