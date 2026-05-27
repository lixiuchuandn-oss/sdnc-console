/**
 * ==============================================================================
 * Harvester - 虚拟机创建向导 - 计算资源配置步骤 (StepCompute)
 * frontend/src/pages/cnmc/clouds/Harvester/modals/VmCreateWizard/StepCompute.tsx
 * ==============================================================================
 *
 * [功能描述]
 * 负责配置虚拟机的核心计算资源，包括 CPU、内存、以及 GPU 设备。
 * 提供预设选项（如 2核/4G）与自定义输入，支持高级 CPU 拓扑配置和 QoS 设置。
 * ------------------------------------------------------------------------------
 *
 * [核心逻辑]
 * 1. [资源预设]: 提供常用 CPU/内存 规格的快捷选择，支持切换到自定义模式。
 * 2. [热扩容规则]:
 *    - 启用热扩容时，强制锁定 CPU 拓扑为 `sockets=vCPU, cores=1, threads=1`。
 *    - ARM 架构下禁用热扩容选项。
 * 3. [GPU 选择]:
 *    - 支持多种 GPU 模式 (Passthrough/vGPU/SR-IOV)。
 *    - 根据选择的模式过滤可用 GPU 资源列表。
 *    - 提供表格视图展示 GPU 所在的节点和总线信息。
 * 4. [状态同步]: 监听表单变化，实时更新快照 (FormSnapshot) 以防数据丢失。
 * ------------------------------------------------------------------------------
 *
 * [API 接口]
 * - 提交时作为 VM Spec 的一部分:
 *   - cpu, memory (基础规格)
 *   - runStrategy (运行策略)
 *   - limits/requests (QoS)
 * ------------------------------------------------------------------------------
 *
 * [交互依赖]
 * - 依赖 Ant Design Form 实例进行数据回填与校验。
 * - 依赖外部传入的 gpuResources 列表进行渲染。
 */
import React from 'react';
import { Form, Input, Select, Radio, Space, Table, Checkbox, InputNumber, Collapse, Typography, Button, App } from 'antd';
import { ReloadOutlined, LoadingOutlined } from '@ant-design/icons';

/**
 * 组件 Props 定义
 */
interface StepComputeProps {
  /** Ant Design Form 实例 */
  form: any;
  /** 内存预设值 (如 '4', '8', 'custom') */
  memPreset: string;
  /** 设置内存预设值的回调 */
  setMemPreset: (val: string) => void;
  /** 当前内存数值 (GiB) */
  memGi: number;
  /** 设置内存数值的回调 */
  setMemGi: (val: number) => void;
  /** 可用 GPU 资源列表 */
  gpuResources: any[];
  /** 刷新 GPU 资源的回调 */
  reloadGpuResources: () => Promise<void>;
  /** 当前选中的 GPU Key (用于表格高亮) */
  selectedGpuKey: string | null;
  /** 设置选中 GPU Key 的回调 */
  setSelectedGpuKey: (key: string | null) => void;
  /** 更新表单快照的回调 (用于步骤切换时保存状态) */
  setFormSnapshot: React.Dispatch<React.SetStateAction<any>>;
  /** 是否为 ARM64 架构 (影响热扩容可用性) */
  isArm64?: boolean;
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
  isArm64,
}) => {
  const { message } = App.useApp();

  // [状态初始化] 根据表单现有值初始化 CPU 预设状态
  const [cpuPreset, setCpuPreset] = React.useState<string>(() => {
    const v = Number(form.getFieldValue('cpu') || 0);
    if (v === 2 || v === 4 || v === 8) return String(v);
    return 'custom';
  });

  const [cpuValue, setCpuValue] = React.useState<number>(() => {
    const v = Number(form.getFieldValue('cpu') || 0);
    return (typeof v === 'number' && v > 0) ? v : 2;
  });

  const [gpuKeyword, setGpuKeyword] = React.useState<string>('');
  const [gpuLoading, setGpuLoading] = React.useState<boolean>(false);

  // 监听表单字段变化
  const dedicatedCPUPlacement = Form.useWatch('dedicatedCPUPlacement', form);

  // 未启用 CPU 绑定时不能保留 CPU 隔离
  React.useEffect(() => {
    if (!dedicatedCPUPlacement && form.getFieldValue('isolateEmulatorThread')) {
      try {
        form.setFieldsValue({ isolateEmulatorThread: false });
      } catch {}
    }
  }, [dedicatedCPUPlacement, form]);

  // [初始化] 组件加载时同步 CPU 数据并设置默认值
  React.useEffect(() => {
    const raw = form.getFieldValue('cpu');
    const v = Number(raw);
    if (!(typeof v === 'number' && v > 0)) {
      // 只有在没有值的时候才设置默认值，避免重置
      try { form.setFieldsValue({ cpu: 2 }); } catch {}
      setCpuValue(2);
    } else {
      setCpuValue(v);
    }
    // 同步初始状态到快照
    try { setFormSnapshot((prev: any) => ({ ...prev, ...form.getFieldsValue() })); } catch {}
  }, [form, setFormSnapshot]);

  // [业务规则] ARM 架构强制禁用热扩容并清理拓扑配置
  React.useEffect(() => {
    if (isArm64) {
      const checked = form.getFieldValue('hotExpandEnabled');
      if (checked) {
        form.setFieldsValue({
          hotExpandEnabled: false,
          cpuSockets: undefined,
          cpuCores: undefined,
          cpuThreads: undefined
        });
      }
    }
  }, [isArm64, form]);

  return (
    <>
      <Typography.Paragraph type="secondary">设定新建云主机的CPU和内存资源</Typography.Paragraph>
      
      {/* === 计算资源配置 === */}
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
                // 联动更新热扩容拓扑
                if (form.getFieldValue('hotExpandEnabled')) {
                   form.setFieldsValue({ 
                     cpuSockets: n,
                     cpuCores: 1,
                     cpuThreads: 1
                   });
                }
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
            suffix="核"
            style={{ width: 100 }}
            onChange={(val) => {
              const n = Number(val || 1);
              setCpuValue(n);
              form.setFieldsValue({ cpu: n });
              // 联动更新热扩容拓扑
              if (form.getFieldValue('hotExpandEnabled')) {
                 form.setFieldsValue({ 
                   cpuSockets: n,
                   cpuCores: 1,
                   cpuThreads: 1
                 });
              }
              setCpuPreset('custom');
              try { setFormSnapshot((prev: any) => ({ ...prev, ...form.getFieldsValue() })); } catch {}
            }}
          />
        </Space>
      </Form.Item>

      {/* 隐藏字段：用于存储实际提交的数值 */}
      <Form.Item name="cpu" hidden rules={[{ required: true, message: '请选择或输入 vCPU' }, { type: 'number', min: 1, max: 512 }]}> 
        <InputNumber />
      </Form.Item>
      <Form.Item name="machineType" hidden preserve>
        <Input />
      </Form.Item>

      <Form.Item label="内存分配" required>
        <Space>
          <Radio.Group 
            value={memPreset} 
            buttonStyle="solid" 
            onChange={(e) => { 
              const v = String(e.target.value); 
              setMemPreset(v); 
              if (v !== 'custom') { 
                const gi = Number(v); 
                setMemGi(gi); 
                form.setFieldsValue({ memory: `${gi}Gi` }); 
              } 
            }}
          >
            <Radio.Button value="4">4 GB</Radio.Button>
            <Radio.Button value="8">8 GB</Radio.Button>
            <Radio.Button value="16">16 GB</Radio.Button>
            <Radio.Button value="custom">自定义</Radio.Button>
          </Radio.Group>
          <InputNumber 
            min={1} 
            max={1024} 
            value={memGi} 
            suffix="GB" 
            style={{ width: 100 }} 
            onChange={(val) => { 
              const gi = Number(val || 1); 
              setMemGi(gi); 
              form.setFieldsValue({ memory: `${gi}Gi` }); 
              setMemPreset('custom'); 
            }} 
          />
        </Space>
      </Form.Item>
      
      <Form.Item name="memory" hidden rules={[{ required: true, message: '请选择或输入内存' }, { pattern: /^[0-9]+(Gi|Mi)$/i, message: '格式如 4Gi 或 8192Mi' }]}>
        <Input />
      </Form.Item>

      <Form.Item label="热扩容">
        <Space>
          <Form.Item name="hotExpandEnabled" valuePropName="checked" noStyle>
            <Checkbox disabled={isArm64} onChange={(e) => {
              const checked = e.target.checked;
              form.setFieldsValue({ hotExpandEnabled: checked });
              if (checked) {
                // [业务规则] 热扩容开启：强制拓扑 sockets=vCPU, cores=1, threads=1
                const currentCpu = form.getFieldValue('cpu') || 1;
                form.setFieldsValue({
                  cpuSockets: currentCpu,
                  cpuCores: 1,
                  cpuThreads: 1
                });
              } else {
                // [业务规则] 热扩容关闭：清空拓扑，允许用户手动配置
                form.setFieldsValue({
                  cpuSockets: undefined,
                  cpuCores: undefined,
                  cpuThreads: undefined
                });
              }
            }}>启用</Checkbox>
          </Form.Item>
          {isArm64 ? (
            <Typography.Text type="secondary" style={{ marginLeft: 8 }}>ARM 架构不支持热扩容</Typography.Text>
          ) : (
            <Typography.Text type="secondary" style={{ marginLeft: 8 }}>支持 CPU/内存热扩容，上限为当前配额 4 倍，不支持缩容</Typography.Text>
          )}
        </Space>
      </Form.Item>

      {/* === 高级配置区域 === */}
      <Collapse ghost defaultActiveKey={[]} className="wizard-collapse-nopad" items={[{
        key: 'adv-cpu',
        label: 'CPU高级配置',
        children: (
          <>
            <Form.Item label="CPU 拓扑" shouldUpdate={(prev, curr) => prev.hotExpandEnabled !== curr.hotExpandEnabled || prev.cpu !== curr.cpu}>
              {({ getFieldValue }) => {
                const hotExpand = getFieldValue('hotExpandEnabled');
                return (
                  <Space>
                    <Typography.Text>插槽</Typography.Text>
                    <Form.Item noStyle name="cpuSockets">
                      <InputNumber min={1} max={64} style={{ width: 100 }} disabled={hotExpand} placeholder={hotExpand ? "" : "Socket"} />
                    </Form.Item>
                    <Typography.Text>每插槽</Typography.Text>
                    <Form.Item noStyle name="cpuCores">
                      <InputNumber min={1} max={64} style={{ width: 100 }} disabled={hotExpand} placeholder={hotExpand ? "" : "Core"} />
                    </Form.Item>
                    <Typography.Text>核</Typography.Text>
                    <Typography.Text>线程</Typography.Text>
                    <Form.Item noStyle name="cpuThreads">
                      <InputNumber min={1} max={8} style={{ width: 100 }} disabled={hotExpand} placeholder={hotExpand ? "" : "Thread"} />
                    </Form.Item>
                  </Space>
                );
              }}
            </Form.Item>
            
            <Form.Item label="CPU 模式" name="cpuModel">
              <Select options={[{ label: 'Host-Passthrough', value: 'host-passthrough' }, { label: 'Host-Model', value: 'host-model' }, { label: '自定义', value: 'custom' }]} style={{ width: 220 }} />
            </Form.Item>
            
            {(form.getFieldValue('cpuModel') || 'host-passthrough') === 'custom' && (
              <Form.Item label="自定义模型" name="cpuModelCustom" extra={<Typography.Text type="secondary">指定 CPU 型号名称，例如 Skylake-Client-IBRS</Typography.Text>}>
                <Input placeholder="如：Skylake-Client-IBRS" />
              </Form.Item>
            )}
            
            <Form.Item label="CPU 绑定">
              <Space>
                <Form.Item name="dedicatedCPUPlacement" valuePropName="checked" noStyle>
                  <Checkbox onChange={(e) => {
                    const checked = !!e.target.checked;
                    if (!checked) return;
                    message.warning('启用 CPU 绑定后，CPU QoS 将被清空且不再生效');
                    try {
                      form.setFieldsValue({
                        cpuRequest: undefined,
                        cpuLimit: undefined
                      });
                    } catch {}
                  }}>启用</Checkbox>
                </Form.Item>
                <Typography.Text type="secondary">保证用固定的物理 CPU 核心，减少切换损耗</Typography.Text>
              </Space>
            </Form.Item>
            
            <Form.Item label="CPU 隔离">
              <Space>
                <Form.Item name="isolateEmulatorThread" valuePropName="checked" noStyle>
                  <Checkbox disabled={!dedicatedCPUPlacement}>启用</Checkbox>
                </Form.Item>
                <Typography.Text type="secondary">启用后 QEMU 模拟器线程与来宾 vCPU 隔离，降低干扰（需先启用 CPU 绑定）</Typography.Text>
              </Space>
            </Form.Item>
            
            <Form.Item label="CPU QoS">
              <Space>
                <Typography.Text>平时至少需要</Typography.Text>
                <Form.Item noStyle name="cpuRequest">
                  <InputNumber min={0} max={512} precision={0} style={{ width: 100 }} />
                </Form.Item>
                <Typography.Text>核，最多使用</Typography.Text>
                <Form.Item noStyle name="cpuLimit">
                  <InputNumber min={0} max={512} precision={0} style={{ width: 100 }} />
                </Form.Item>
                <Typography.Text>核</Typography.Text>
              </Space>
            </Form.Item>
            
            <Form.Item label="CPU 峰值保护">
              <Space>
                <Form.Item name="cpuBurstUnlimited" valuePropName="checked" noStyle>
                  <Checkbox>启用</Checkbox>
                </Form.Item>
                <Typography.Text type="secondary">业务峰值时自动取消最多使用核数限制</Typography.Text>
              </Space>
            </Form.Item>
            
            {/* 拓扑一致性检查提示 */}
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
          </>
        )
      }]} />

      <Collapse ghost defaultActiveKey={[]} className="wizard-collapse-nopad" items={[{
        key: 'adv-mem',
        label: '内存高级配置',
        children: (
          <>
            <Form.Item label="内存 QoS">
              <Space>
                <Typography.Text>平时至少需要</Typography.Text>
                <Form.Item noStyle name="memoryRequestGi">
                  <InputNumber min={0} max={2048} precision={0} style={{ width: 100 }} />
                </Form.Item>
                <Typography.Text>GiB，最多使用</Typography.Text>
                <Form.Item noStyle name="memoryLimitGi">
                  <InputNumber min={0} max={4096} precision={0} style={{ width: 100 }} />
                </Form.Item>
                <Typography.Text>GiB</Typography.Text>
              </Space>
            </Form.Item>
            <Form.Item label="内存峰值保护">
              <Space>
                <Form.Item name="memoryBurstUnlimited" valuePropName="checked" noStyle>
                  <Checkbox>启用</Checkbox>
                </Form.Item>
                <Typography.Text type="secondary">业务峰值时自动取消最多使用内存限制</Typography.Text>
              </Space>
            </Form.Item>
          </>
        )
      }]} />

      {/* === 3. GPU 配置 === */}
      <Collapse ghost defaultActiveKey={[]} className="wizard-collapse-nopad" items={[{
        key: 'gpu',
        label: 'GPU分配',
        children: (
          <>
            <Form.Item label="GPU模式" name="gpuMode">
              <Radio.Group buttonStyle="solid" onChange={() => { setSelectedGpuKey(null); try { form.setFieldsValue({ gpuPickKey: undefined, gpuNodeName: undefined, gpuResourceName: undefined, gpuPcideviceName: undefined }); setFormSnapshot((prev: any) => ({ ...prev, ...form.getFieldsValue() })); } catch { } }}>
                <Radio.Button value="none">无</Radio.Button>
                <Radio.Button value="passthrough">直通GPU</Radio.Button>
                <Radio.Button value="vgpu">vGPU</Radio.Button>
                <Radio.Button value="sriov">SR-IOV GPU</Radio.Button>
              </Radio.Group>
            </Form.Item>
            
            {(form.getFieldValue('gpuMode') || 'none') === 'none' ? null : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10}}>
                <div className="wizard-section-title" style={{ margin: 0 }}>可用 GPU 资源</div>
                
                {/* [渲染逻辑] GPU 资源表格生成 */}
                {(function () {
                  const mode = form.getFieldValue('gpuMode') || 'none';
                  const list = Array.isArray(gpuResources) ? gpuResources : [];
                  // 过滤出符合当前模式的 GPU
                  const byMode = list.filter((x: any) => String(x?.type) === mode);
                  // 优先展示带有节点信息的记录
                  const onlyNode = byMode.filter((x: any) => !!(x?.node || x?.nodeName));
                  const src = (onlyNode.length ? onlyNode : byMode.length ? byMode : list);
                  
                  // 构造表格数据
                  let data = src.map((x: any) => ({
                    key: `${(x?.raw?.metadata?.name || x?.name || x?.resourceName) || '-'}|${x?.node || x?.nodeName}|${x?.pciAddress || x?.address || x?.pci}`,
                    node: x?.node || x?.nodeName || '-',
                    bus: x?.pciAddress || x?.address || x?.pci || '-',
                    name: x?.raw?.metadata?.name || x?.raw?.spec?.deviceName || x?.name || x?.description || x?.desc || x?.resourceName,
                    resourceName: x?.resourceName || x?.raw?.status?.resourceName || x?.raw?.spec?.resourceName,
                    type: x?.type,
                    claimed: x?.claimed, // [修复] 保留claimed字段，用于过滤被其他VM使用的GPU
                    raw: x
                  }));
                  
                  // [修复] 过滤被其他VM使用的GPU
                  data = data.filter((r: any) => {
                    const resourceName = String(r?.resourceName || '').trim();
                    // 如果resourceName为空，跳过claimed检查（可能是数据不完整）
                    if (resourceName && r?.claimed === true) {
                      // 被其他VM使用的GPU，过滤掉
                      return false;
                    }
                    return true;
                  });
                  
                  // 客户端搜索过滤
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
                      <Radio style={{ margin: 0 }} checked={selectedGpuKey === r?.key} onChange={(e) => { e.stopPropagation(); const k = String(r?.key); setSelectedGpuKey(k); const rn = r?.resourceName || r?.raw?.status?.resourceName || r?.raw?.spec?.resourceName; const dn = r?.name; const node = r?.node && r.node !== '-' ? r.node : undefined; form.setFieldsValue({ gpuPickKey: k, gpuNodeName: node, gpuPcideviceName: dn, gpuResourceName: rn, gpuMode: r?.type || form.getFieldValue('gpuMode') }); try { setFormSnapshot((prev: any) => ({ ...prev, ...form.getFieldsValue() })); } catch { } }} />
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
                      <Space style={{ width: '100%', margin: 0 }}>
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
                        style={{ margin: 0 }}
                        className="wizard-node-table"
                        columns={columns as any}
                        dataSource={data}
                        pagination={false}
                        loading={gpuLoading}
                        onRow={(record: any) => ({ onClick: () => { setSelectedGpuKey(String(record?.key)); const rn = record?.resourceName || record?.raw?.status?.resourceName || record?.raw?.spec?.resourceName; const dn = record?.name; const node = record?.node && record.node !== '-' ? record.node : undefined; form.setFieldsValue({ gpuPickKey: String(record?.key), gpuNodeName: node, gpuPcideviceName: dn, gpuResourceName: rn, gpuMode: record?.type || form.getFieldValue('gpuMode') }); try { setFormSnapshot((prev: any) => ({ ...prev, ...form.getFieldsValue() })); } catch { } } })}
                        rowClassName={(record: any) => (selectedGpuKey && record?.key === selectedGpuKey) ? 'wizard-table-row-active' : ''}
                      />
                    </>
                  );
                })()}
                
                <Form.Item name="gpuPickKey" hidden>
                  <Input />
                </Form.Item>
                <Form.Item name="gpuNodeName" hidden>
                  <Input />
                </Form.Item>
                <Form.Item name="gpuResourceName" hidden rules={[{ required: true, message: '请选择GPU' }]}>
                  <Input />
                </Form.Item>
                <Form.Item name="gpuPcideviceName" hidden>
                  <Input />
                </Form.Item>
              </div>
            )}
          </>
        )
      }]} />
    </>
  );
};

export default StepCompute;
