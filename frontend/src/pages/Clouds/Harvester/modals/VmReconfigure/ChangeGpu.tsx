import React from 'react';
import { Form, Radio, Input, Space, Button, Table, Typography } from 'antd';
import { ReloadOutlined, LoadingOutlined } from '@ant-design/icons';

type Props = {
  form: any;
  gpuResources: any[];
  selectedGpuKey: string | null;
  setSelectedGpuKey: (key: string | null) => void;
  gpuKeyword: string;
  setGpuKeyword: (val: string) => void;
  gpuLoading: boolean;
  reloadGpuResources: () => void;
};

const ChangeGpu: React.FC<Props> = ({
  form,
  gpuResources,
  selectedGpuKey,
  setSelectedGpuKey,
  gpuKeyword,
  setGpuKeyword,
  gpuLoading,
  reloadGpuResources
}) => {
  return (
    <>
      <Form.Item label="GPU模式" name="gpuMode" initialValue="none">
        <Radio.Group buttonStyle="solid" onChange={() => { setSelectedGpuKey(null); form.setFieldsValue({ gpuResourceName: undefined }); }}>
          <Radio.Button value="none">无</Radio.Button>
          <Radio.Button value="passthrough">直通GPU</Radio.Button>
          <Radio.Button value="vgpu">vGPU</Radio.Button>
          <Radio.Button value="sriov">SR-IOV GPU</Radio.Button>
        </Radio.Group>
      </Form.Item>
      <Form.Item noStyle shouldUpdate={(prev, curr) => prev.gpuMode !== curr.gpuMode}>
        {({ getFieldValue }) => {
            const mode = getFieldValue('gpuMode') || 'none';
            if (mode === 'none') return null;
            
            const list = Array.isArray(gpuResources) ? gpuResources : [];
            const byMode = list.filter((x: any) => String(x?.type) === mode);
            const onlyNode = byMode.filter((x: any) => !!(x?.node || x?.nodeName));
            const src = (onlyNode.length ? onlyNode : byMode.length ? byMode : list);
            
            let data = src.map((x: any) => ({
              key: `${(x?.raw?.metadata?.name || x?.name || x?.resourceName) || '-'}|${x?.node || x?.nodeName}|${x?.pciAddress || x?.address || x?.pci}`,
              node: x?.node || x?.nodeName || '-',
              bus: x?.pciAddress || x?.address || x?.pci || '-',
              name: x?.raw?.metadata?.name || x?.raw?.spec?.deviceName || x?.name || x?.description || x?.desc || x?.resourceName,
              resourceName: x?.resourceName || x?.raw?.status?.resourceName || x?.raw?.spec?.resourceName,
              type: x?.type,
              raw: x
            }));
            
            const kw = String(gpuKeyword || '').trim().toLowerCase();
            if (kw) {
              data = data.filter((r: any) => (
                String(r.node || '').toLowerCase().includes(kw) ||
                String(r.bus || '').toLowerCase().includes(kw) ||
                String(r.name || '').toLowerCase().includes(kw) ||
                String(r.resourceName || '').toLowerCase().includes(kw)
              ));
            }
            
            const columns = [
              { title: '', key: 'select', width: 52, align: 'center', render: (_: any, r: any) => (
                <Radio style={{ margin: 0 }} checked={selectedGpuKey === r?.key} onChange={(e) => { e.stopPropagation(); const k = String(r?.key); setSelectedGpuKey(k); const rn = r?.resourceName; form.setFieldsValue({ gpuResourceName: rn }); }} />
              ) },
              { title: '节点', dataIndex: 'node', key: 'node' },
              { title: '总线', dataIndex: 'bus', key: 'bus' },
              { title: '设备', key: 'dev', render: (_: any, r: any) => (
                <div>
                  <div>{r?.name || '-'}</div>
                  <div style={{ color: '#999' }}>{r?.resourceName || '-'}</div>
                </div>
              ) },
            ];

            return (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Typography.Text>可用 GPU 资源</Typography.Text>
                </div>
                <Space style={{ width: '100%', margin: 0 }}>
                  <Input allowClear size="middle" placeholder="搜索GPU/节点/总线" value={gpuKeyword} onChange={(e) => setGpuKeyword(e.target.value)} style={{ flex: 1 }} />
                  {gpuLoading ? (
                    <LoadingOutlined style={{ fontSize: 16, color: '#1677ff' }} />
                  ) : (
                    <Button
                      size="middle"
                      icon={<ReloadOutlined style={{ fontSize: 14, color: '#8c8c8c' }} />}
                      type="default"
                      onClick={reloadGpuResources}
                    />
                  )}
                </Space>
                <Table
                  size="middle"
                  bordered
                  rowKey={(r: any) => r.key}
                  style={{ margin: 0 }}
                  columns={columns as any}
                  dataSource={data}
                  pagination={false}
                  loading={gpuLoading}
                  onRow={(record: any) => ({ onClick: () => { setSelectedGpuKey(String(record?.key)); const rn = record?.resourceName; form.setFieldsValue({ gpuResourceName: rn }); } })}
                  rowClassName={(record: any) => (selectedGpuKey && record?.key === selectedGpuKey) ? 'ant-table-row-selected' : ''}
                />
                <Form.Item name="gpuResourceName" hidden rules={[{ required: true, message: '请选择GPU' }]}><Input /></Form.Item>
              </div>
            );
        }}
      </Form.Item>
    </>
  );
};

export default ChangeGpu;
