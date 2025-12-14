import React from 'react';
import { Form, Input, Select, Radio, Space, Table, Checkbox, InputNumber, Collapse, Typography, Button, message } from 'antd';
import { ReloadOutlined, LoadingOutlined } from '@ant-design/icons';

interface StepComputeProps {
  form: any;
  memPreset: string;
  setMemPreset: (val: string) => void;
  memGi: number;
  setMemGi: (val: number) => void;
  gpuResources: any[];
  reloadGpuResources: () => Promise<void>;
  selectedGpuKey: string | null;
  setSelectedGpuKey: (key: string | null) => void;
  setFormSnapshot: React.Dispatch<React.SetStateAction<any>>;
}

const StepCompute: React.FC<StepComputeProps> = ({
  form,
  memPreset,
  setMemPreset,
  memGi,
  setMemGi,
  gpuResources,
  reloadGpuResources,
  selectedGpuKey,
  setSelectedGpuKey,
  setFormSnapshot,
}) => {
  const [cpuPreset, setCpuPreset] = React.useState<string>(() => {
    const v = Number(form.getFieldValue('cpu') || 0);
    if (v === 2 || v === 4 || v === 8) return String(v);
    return 'custom';
  });
  const [cpuValue, setCpuValue] = React.useState<number>(() => {
    const v = Number(form.getFieldValue('cpu') || 0);
    return (typeof v === 'number' && v > 0) ? v : 2;
  });
  React.useEffect(() => {
    const raw = form.getFieldValue('cpu');
    const v = Number(raw);
    if (!(typeof v === 'number' && v > 0)) {
      try { form.setFieldsValue({ cpu: 2 }); } catch {}
      setCpuValue(2);
    } else {
      setCpuValue(v);
    }
    try { setFormSnapshot((prev: any) => ({ ...prev, ...form.getFieldsValue() })); } catch {}
  }, []);
  const [gpuKeyword, setGpuKeyword] = React.useState<string>('');
  const [gpuLoading, setGpuLoading] = React.useState<boolean>(false);
  return (
    <>
      <Typography.Paragraph type="secondary">设定新建云主机的CPU和内存资源</Typography.Paragraph>
      <div className="wizard-group-title">计算资源</div>
      <Form.Item label="vCPU 分配" required>
        <Space>
          <Radio.Group
            buttonStyle="solid"
            value={cpuPreset}
            onChange={(e) => {
              const v = String(e.target.value);
              setCpuPreset(v);
              if (v !== 'custom') {
                const n = Number(v);
                setCpuValue(n);
                form.setFieldsValue({ cpu: n });
              }
              try { setFormSnapshot((prev: any) => ({ ...prev, ...form.getFieldsValue() })); } catch {}
            }}
          >
            <Radio.Button value="2">2 核</Radio.Button>
            <Radio.Button value="4">4 核</Radio.Button>
            <Radio.Button value="8">8 核</Radio.Button>
            <Radio.Button value="custom">自定义</Radio.Button>
          </Radio.Group>
          <InputNumber
            min={1}
            max={512}
            value={cpuValue}
            addonAfter="核"
            style={{ width: 160 }}
            onChange={(val) => {
              const n = Number(val || 1);
              setCpuValue(n);
              form.setFieldsValue({ cpu: n });
              setCpuPreset('custom');
              try { setFormSnapshot((prev: any) => ({ ...prev, ...form.getFieldsValue() })); } catch {}
            }}
          />
        </Space>
      </Form.Item>
      <Form.Item name="cpu" hidden rules={[{ required: true, message: '请选择或输入 vCPU' }, { type: 'number', min: 1, max: 512 }]}> 
        <InputNumber />
      </Form.Item>
      <Form.Item label="内存分配" required>
        <Space>
          <Radio.Group value={memPreset} buttonStyle="solid" onChange={(e) => { const v = String(e.target.value); setMemPreset(v); if (v !== 'custom') { const gi = Number(v); setMemGi(gi); form.setFieldsValue({ memory: `${gi}Gi` }); } }}>
            <Radio.Button value="4">4 GB</Radio.Button>
            <Radio.Button value="8">8 GB</Radio.Button>
            <Radio.Button value="16">16 GB</Radio.Button>
            <Radio.Button value="custom">自定义</Radio.Button>
          </Radio.Group>
          <InputNumber min={1} max={1024} value={memGi} addonAfter="GB" style={{ width: 160 }} onChange={(val) => { const gi = Number(val || 1); setMemGi(gi); form.setFieldsValue({ memory: `${gi}Gi` }); setMemPreset('custom'); }} />
        </Space>
      </Form.Item>
      <Form.Item name="memory" hidden rules={[{ required: true, message: '请选择或输入内存' }, { pattern: /^[0-9]+(Gi|Mi)$/i, message: '格式如 4Gi 或 8192Mi' }]}>
        <Input />
      </Form.Item>
      <Form.Item label="热扩容" name="hotExpandEnabled" valuePropName="checked">
        <Space>
          <Checkbox>启用</Checkbox>
          <Typography.Text type="secondary">支持 CPU/内存热扩容，上限为当前配额 4 倍，不支持缩容</Typography.Text>
        </Space>
      </Form.Item>
      <Collapse ghost defaultActiveKey={[]} className="wizard-collapse-nopad">
        <Collapse.Panel header="CPU高级配置" key="adv-cpu">
          <Form.Item label="CPU 拓扑">
            <Space>
              <Typography.Text>插槽</Typography.Text>
              <Form.Item noStyle name="cpuSockets">
                <InputNumber min={1} max={8} style={{ width: 100 }} />
              </Form.Item>
              <Typography.Text>每插槽</Typography.Text>
              <Form.Item noStyle name="cpuCores">
                <InputNumber min={1} max={64} style={{ width: 100 }} />
              </Form.Item>
              <Typography.Text>核</Typography.Text>
            </Space>
          </Form.Item>
          <Form.Item label="CPU 模式" name="cpuModel" initialValue="host-passthrough">
            <Select options={[{ label: 'Host-Passthrough', value: 'host-passthrough' }, { label: 'Host-Model', value: 'host-model' }, { label: '自定义', value: 'custom' }]} style={{ width: 220 }} />
          </Form.Item>
          {(form.getFieldValue('cpuModel') || 'host-passthrough') === 'custom' && (
            <Form.Item label="自定义模型" name="cpuModelCustom" extra={<Typography.Text type="secondary">指定 CPU 型号名称，例如 Skylake-Client-IBRS</Typography.Text>}>
              <Input placeholder="如：Skylake-Client-IBRS" />
            </Form.Item>
          )}
          <Form.Item label="CPU 绑定" name="dedicatedCPUPlacement" valuePropName="checked">
            <Space>
              <Checkbox>启用</Checkbox>
              <Typography.Text type="secondary">保证用固定的物理 CPU 核心，减少切换损耗</Typography.Text>
            </Space>
          </Form.Item>
          <Form.Item label="CPU 隔离" name="isolateEmulatorThread" valuePropName="checked">
            <Space>
              <Checkbox>启用</Checkbox>
              <Typography.Text type="secondary">启用后 QEMU 模拟器线程与来宾 vCPU 隔离，降低干扰</Typography.Text>
            </Space>
          </Form.Item>
          <Form.Item label="CPU QoS">
            <Space>
              <Typography.Text>平时至少需要</Typography.Text>
              <Form.Item noStyle name="cpuRequest">
                <InputNumber min={0} max={512} style={{ width: 100 }} />
              </Form.Item>
              <Typography.Text>核，最多使用</Typography.Text>
              <Form.Item noStyle name="cpuLimit">
                <InputNumber min={0} max={512} style={{ width: 100 }} />
              </Form.Item>
              <Typography.Text>核</Typography.Text>
            </Space>
          </Form.Item>
          <Form.Item label="CPU 峰值保护" name="cpuBurstUnlimited" valuePropName="checked">
            <Space>
              <Checkbox>启用</Checkbox>
              <Typography.Text type="secondary">业务峰值时自动取消最多使用核数限制</Typography.Text>
            </Space>
          </Form.Item>
          <div style={{ marginTop: 8 }}>
            {(() => {
              const s = Number(form.getFieldValue('cpuSockets') || 1);
              const c = Number(form.getFieldValue('cpuCores') || 0);
              const t = 1;
              const total = (s > 0 && c > 0 && t > 0) ? (s * c * t) : undefined;
              const vcpu = Number(form.getFieldValue('cpu') || 0);
              return ((typeof total === 'number' && total > 0 && total !== vcpu) ? (
                <Space>
                  <Typography.Text type="secondary">当前总 vCPU = {total}（插槽×核心×线程）</Typography.Text>
                  <Button size="small" onClick={() => { try { form.setFieldsValue({ cpu: total }); } catch { } }}>同步到 vCPU</Button>
                </Space>
              ) : null);
            })()}
          </div>
        </Collapse.Panel>
      </Collapse>
      <Collapse ghost defaultActiveKey={[]} className="wizard-collapse-nopad">
        <Collapse.Panel header="内存高级配置" key="adv-mem">
          <Form.Item label="内存 QoS">
            <Space>
              <Typography.Text>平时至少需要</Typography.Text>
              <Form.Item noStyle name="memoryRequestGi">
                <InputNumber min={0} max={2048} style={{ width: 100 }} />
              </Form.Item>
              <Typography.Text>GiB，最多使用</Typography.Text>
              <Form.Item noStyle name="memoryLimitGi">
                <InputNumber min={0} max={4096} style={{ width: 100 }} />
              </Form.Item>
              <Typography.Text>GiB</Typography.Text>
            </Space>
          </Form.Item>
          <Form.Item label="内存峰值保护" name="memoryBurstUnlimited" valuePropName="checked">
            <Space>
              <Checkbox>启用</Checkbox>
              <Typography.Text type="secondary">业务峰值时自动取消最多使用内存限制</Typography.Text>
            </Space>
          </Form.Item>
        </Collapse.Panel>
      </Collapse>
      <Collapse ghost defaultActiveKey={[]} className="wizard-collapse-nopad">
        <Collapse.Panel header="GPU分配" key="gpu">
          <Form.Item label="GPU模式" name="gpuMode" initialValue="none">
            <Radio.Group buttonStyle="solid" onChange={() => { setSelectedGpuKey(null); try { form.setFieldsValue({ gpuResourceName: undefined, gpuPcideviceName: undefined }); setFormSnapshot((prev: any) => ({ ...prev, ...form.getFieldsValue() })); } catch { } }}>
              <Radio.Button value="none">无</Radio.Button>
              <Radio.Button value="passthrough">直通GPU</Radio.Button>
              <Radio.Button value="vgpu">vGPU</Radio.Button>
              <Radio.Button value="sriov">SR-IOV GPU</Radio.Button>
            </Radio.Group>
          </Form.Item>
          {(form.getFieldValue('gpuMode') || 'none') === 'none' ? null : (
            <Form.Item label="选择GPU">
              {(function () {
                const mode = form.getFieldValue('gpuMode') || 'none';
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
                  { title: '', key: 'select', width: 52, align: 'center', className: 'wizard-node-select-col', onCell: () => ({ style: { paddingLeft: 8, paddingRight: 8 } }), render: (_: any, r: any) => (
                    <Radio style={{ margin: 0 }} checked={selectedGpuKey === r?.key} onChange={(e) => { e.stopPropagation(); const k = String(r?.key); setSelectedGpuKey(k); const rn = r?.resourceName || r?.raw?.status?.resourceName || r?.raw?.spec?.resourceName; const dn = r?.name; form.setFieldsValue({ gpuPcideviceName: dn, gpuResourceName: rn, gpuMode: r?.type || form.getFieldValue('gpuMode') }); try { setFormSnapshot((prev: any) => ({ ...prev, ...form.getFieldsValue() })); } catch { } }} />
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
                  <>
                    <Space style={{ width: '100%', marginTop: 4 }}>
                      <Input allowClear size="small" placeholder="搜索GPU/节点/总线" value={gpuKeyword} onChange={(e) => setGpuKeyword(e.target.value)} style={{ flex: 1 }} />
                      {gpuLoading ? (
                        <LoadingOutlined style={{ fontSize: 16, color: '#1677ff' }} />
                      ) : (
                        <Button
                          size="small"
                          icon={<ReloadOutlined style={{ fontSize: 14, color: '#8c8c8c' }} />}
                          type="default"
                          onClick={async () => { try { setGpuLoading(true); await reloadGpuResources(); } catch (e: any) { message.error(e?.message || '刷新失败'); } finally { setGpuLoading(false); } }}
                        />
                      )}
                    </Space>
                    <Table
                      size="small"
                      bordered
                      rowKey={(r: any) => r.key}
                      style={{ marginTop: 10, marginBottom: 24 }}
                      className="wizard-node-table"
                      columns={columns as any}
                      dataSource={data}
                      pagination={false}
                      loading={gpuLoading}
                      onRow={(record: any) => ({ onClick: () => { setSelectedGpuKey(String(record?.key)); const rn = record?.resourceName || record?.raw?.status?.resourceName || record?.raw?.spec?.resourceName; const dn = record?.name; form.setFieldsValue({ gpuPcideviceName: dn, gpuResourceName: rn, gpuMode: record?.type || form.getFieldValue('gpuMode') }); try { setFormSnapshot((prev: any) => ({ ...prev, ...form.getFieldsValue() })); } catch { } } })}
                      rowClassName={(record: any) => (selectedGpuKey && record?.key === selectedGpuKey) ? 'wizard-table-row-active' : ''}
                    />
                  </>
                );
              })()}
              <Form.Item name="gpuResourceName" hidden rules={[{ required: true, message: '请选择GPU' }]}> 
                <Input />
              </Form.Item>
              <Form.Item name="gpuPcideviceName" hidden>
                <Input />
              </Form.Item>
            </Form.Item>
          )}
          {/* 移除数量，单卡选择 */}
        </Collapse.Panel>
      </Collapse>
    </>
  );
};

export default StepCompute;
