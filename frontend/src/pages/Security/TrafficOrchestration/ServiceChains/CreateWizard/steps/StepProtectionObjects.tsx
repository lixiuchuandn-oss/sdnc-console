import React, { useState, useEffect } from 'react';
import { Form, Button, Space, Tag, Modal, Input, Select, message, Pagination, Radio, Table } from 'antd';
import VRDomainTableSelector from '../components/VRDomainTableSelector';
import { createCsmAsset, fetchCsmAssets, fetchCsmVRouters, fetchCsmPoolId } from '../../../../../../services/api';

export default function StepProtectionObjects(props: any) {
  const {
    form,
    vrDomains,
    selectedClusterId,
    csmAssets,
    setCsmAssets,
  } = props;

  const [vrBatchOpen, setVrBatchOpen] = useState(false);
  const [vrBatchForm] = Form.useForm();
  const [vrRowOpen, setVrRowOpen] = useState(false);
  const [vrRowForm] = Form.useForm();
  const [vrRowRecord, setVrRowRecord] = useState<any | null>(null);
  const [vrKeyword, setVrKeyword] = useState('');
  const [vrPage, setVrPage] = useState(1);
  const [vrPageSize, setVrPageSize] = useState(8);
  const [vrExistingCidrs, setVrExistingCidrs] = useState<string[]>(() => {
    const init = form?.getFieldValue('vrExistingCidrs');
    return Array.isArray(init) ? init : [];
  });
  const [poolId, setPoolId] = useState<string | undefined>(undefined);
  const [poolDetecting, setPoolDetecting] = useState<boolean>(false);

  // Direct Mode States
  const [steeringMode, setSteeringMode] = useState(() => form.getFieldValue('steeringMode') || 'vr');
  // csmAssets lifted to parent
  const [assetsLoading, setAssetsLoading] = useState(false);
  const [assetKeyword, setAssetKeyword] = useState('');
  const [assetPage, setAssetPage] = useState(1);
  const [assetPageSize, setAssetPageSize] = useState(10);
  const [selectedAssetKeys, setSelectedAssetKeys] = useState<any[]>(() => {
    const v = form.getFieldValue('selectedAssets');
    return Array.isArray(v) ? v : [];
  });

  const handleModeChange = (e: any) => {
    const val = e.target.value;
    setSteeringMode(val);
    // Clear other mode's selection to avoid confusion? 
    // Maybe better to keep them separate in form state but validated on next().
  };

  const filteredAssets = csmAssets.filter((a: any) => {
    if (!assetKeyword) return true;
    const kw = assetKeyword.toLowerCase();
    return (
      (a.name || '').toLowerCase().includes(kw) ||
      (a.value || '').toLowerCase().includes(kw) ||
      (a.type || '').toLowerCase().includes(kw) ||
      (a.description || '').toLowerCase().includes(kw)
    );
  });


  const loadAssets = async () => {
    try {
      const cloudId = String(selectedClusterId || form.getFieldValue('cluster') || '').trim();
      if (!cloudId) return;
      
      let currentPoolId = poolId;
      // Try to detect pool_id once
      if (!currentPoolId && !poolDetecting) {
        try {
          setPoolDetecting(true);
          const pres = await fetchCsmPoolId(cloudId);
          const pid = pres?.data?.pool_id;
          if (pid) {
            currentPoolId = pid;
            setPoolId(pid);
            try { form?.setFieldsValue({ pool_id: pid }); } catch {}
          }
        } catch {} finally { setPoolDetecting(false); }
      }
      
      setAssetsLoading(true);
      const params: any = { page_size: 1000, page_num: 1 };
      if (currentPoolId) params.pool_id = currentPoolId;

      const json = await fetchCsmAssets(cloudId, params);
      const items: any[] = Array.isArray((json as any)?.data?.items)
        ? (json as any).data.items
        : Array.isArray((json as any)?.items)
          ? (json as any).items
          : Array.isArray((json as any)?.list)
            ? (json as any).list
          : Array.isArray((json as any)?.rows)
            ? (json as any).rows
            : Array.isArray(json) ? (json as any) : [];
      
      setCsmAssets(items); // Store full list for direct mode

      // Refresh selectedAssetObjects in form to ensure latest data (e.g. fixed names)
      const v = form.getFieldValue('selectedAssets');
      const keys = Array.isArray(v) ? v : [];
      if (keys.length > 0) {
           const allSelected = items.filter((a: any) => keys.includes(a.network_id || a.id || a.uuid));
           form.setFieldsValue({ selectedAssetObjects: allSelected });
      }
      
      const cidrs = items
        .filter((a: any) => String(a?.type || '').toLowerCase() === 'subnet')
        .map((a: any) => String(a?.value || '').trim())
        .filter(Boolean);
      setVrExistingCidrs(cidrs);
      form?.setFieldsValue({ vrExistingCidrs: cidrs });
    } catch {} finally {
      setAssetsLoading(false);
    }
  };

  useEffect(() => {
    loadAssets();
  }, [selectedClusterId]); // Only auto-load on cluster change, manual refresh for pool_id changes

  return (
    <div>
      <Form form={form} layout="vertical">
         <Form.Item name="steeringMode" label="引流模式" initialValue="vr">
           <Radio.Group onChange={handleModeChange} value={steeringMode}>
             <Radio.Button value="vr">VR引流 (安全域)</Radio.Button>
             <Radio.Button value="direct">直连引流 (资源池资产)</Radio.Button>
           </Radio.Group>
         </Form.Item>

         {steeringMode === 'vr' ? (
          <div style={{ marginTop: 16, minHeight: 560 }}>
             <div style={{ fontSize: 14, color: '#1f1f1f', marginBottom: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
               <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                 <label style={{ fontSize: 14, color: '#1f1f1f' }}>关键字搜索</label>
                 <Input
                   placeholder="搜索名称、CIDR、VR或云厂商"
                   allowClear
                   value={vrKeyword}
                   onChange={e => setVrKeyword(e.target.value)}
                   style={{ width: 320 }}
                 />
                 <div style={{ color: '#999', fontSize: 12 }}>
                   共 {(vrDomains || []).length} 项，已选 {(form.getFieldValue('vrDomains') || []).length} 项
                 </div>
               </div>
               <Space>
                 <Button
                   type="primary"
                   onClick={() => setVrBatchOpen(true)}
                   disabled={!selectedClusterId && !form.getFieldValue('cluster')}
                 >
                   批量同步
                 </Button>
               </Space>
             </div>
             <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center'}}>
               <div style={{ width: 160 }} />
             </div>
            <Form.Item
              name="vrDomains"
              rules={[{ required: true, message: '请至少选择一个VR' }]}
              style={{ marginBottom: 0 }}
            >
                <VRDomainTableSelector
                  csmAssets={csmAssets}
                  dataSource={((vrDomains || []).filter((item: any) => {
                    const kw = String(vrKeyword || '').trim().toLowerCase();
                    if (!kw) return true;
                    return (
                      String(item.name || '').toLowerCase().includes(kw) ||
                      String(item.subType || '').toLowerCase().includes(kw) ||
                      String(item.provider || '').toLowerCase().includes(kw) ||
                      String(item.region || '').toLowerCase().includes(kw) ||
                      String(item.cidr || '').toLowerCase().includes(kw) ||
                      String(item.vrName || '').toLowerCase().includes(kw)
                    );
                  })).slice((vrPage-1)*vrPageSize, (vrPage-1)*vrPageSize + vrPageSize)}
                  showActions
                 onAddAsset={(record: any) => {
                   const cloudId = String(selectedClusterId || form.getFieldValue('cluster') || '').trim();
                   const raw = String(record?.cidr || '').trim();
                   const segs = raw.split(/[\\s,;]+/).map(s => s.trim()).filter(Boolean);
                   if (!cloudId || segs.length === 0) return;
                   (async () => {
                     let currentPoolId = poolId;
                     if (!currentPoolId) {
                         try {
                             const pres = await fetchCsmPoolId(cloudId);
                             const pid = pres?.data?.pool_id;
                             if (pid) {
                                 currentPoolId = pid;
                                 setPoolId(pid);
                                 try { form?.setFieldsValue({ pool_id: pid }); } catch {}
                             }
                         } catch {}
                     }
                     if (!currentPoolId) {
                        message.error('未检测到安全资源池 ID (pool_id)，无法添加资产');
                        return;
                     }

                     let ok = 0; let fail = 0;
                     for (const cidr of segs) {
                       const payload: any = { type: 'subnet', ip_type: 'ipv4', value: cidr };
                       try {
                         await createCsmAsset(cloudId, payload, { pool_id: currentPoolId });
                         try {
                            const verifyJson = await fetchCsmAssets(cloudId, { pool_id: currentPoolId, page_size: 1000 });
                            const items: any[] = Array.isArray((verifyJson as any)?.data?.items)
                              ? (verifyJson as any).data.items
                              : Array.isArray((verifyJson as any)?.items)
                                ? (verifyJson as any).items
                                : Array.isArray((verifyJson as any)?.list)
                                  ? (verifyJson as any).list
                                  : Array.isArray((verifyJson as any)?.rows)
                                    ? (verifyJson as any).rows
                                   : Array.isArray(verifyJson) ? (verifyJson as any) : [];
                           const found = items.some((a: any) => String(a?.type || '').toLowerCase() === 'subnet' && String(a?.value || '').trim() === cidr);
                           if (found) {
                             ok++;
                             setCsmAssets(items);
                             setVrExistingCidrs((prev) => {
                               const next = Array.from(new Set([cidr, ...prev]));
                               form?.setFieldsValue({ vrExistingCidrs: next });
                               return next;
                             });
                           } else {
                             fail++;
                           }
                         } catch {
                           fail++;
                         }
                       } catch (e:any) {
                         fail++;
                       }
                     }
                     if (ok && !fail) message.success(`已添加到资产：${ok} 个`);
                     else if (ok && fail) message.warning(`部分添加成功：成功 ${ok} 个，失败 ${fail} 个`);
                     else message.error('添加到资产失败');
                   })();
                 }}
                 tableProps={{ pagination: false, size: 'middle' }}
                 existingCidrs={vrExistingCidrs}
                 hideHeader
                />
              </Form.Item>
             <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop:16 }}>
               <div style={{ color: '#999', fontSize: 12 }}>
                 总计：{((vrDomains || []).filter((item: any) => {
                   const kw = String(vrKeyword || '').trim().toLowerCase();
                   if (!kw) return true;
                   return (
                     String(item.name || '').toLowerCase().includes(kw) ||
                     String(item.subType || '').toLowerCase().includes(kw) ||
                     String(item.provider || '').toLowerCase().includes(kw) ||
                     String(item.region || '').toLowerCase().includes(kw) ||
                     String(item.cidr || '').toLowerCase().includes(kw) ||
                     String(item.vrName || '').toLowerCase().includes(kw)
                   );
                 })).length} 条
               </div>
               <Pagination

                 current={vrPage}
                 pageSize={vrPageSize}
                 total={((vrDomains || []).filter((item: any) => {
                   const kw = String(vrKeyword || '').trim().toLowerCase();
                   if (!kw) return true;
                   return (
                     String(item.name || '').toLowerCase().includes(kw) ||
                     String(item.subType || '').toLowerCase().includes(kw) ||
                     String(item.provider || '').toLowerCase().includes(kw) ||
                     String(item.region || '').toLowerCase().includes(kw) ||
                     String(item.cidr || '').toLowerCase().includes(kw) ||
                     String(item.vrName || '').toLowerCase().includes(kw)
                   );
                 })).length}
                 showSizeChanger
                 onChange={(p, ps) => { setVrPage(p); setVrPageSize(ps); }}
               />
             </div>
             <Modal
               title="批量添加到资产（VR安全域）"
               open={vrBatchOpen}
               onCancel={() => setVrBatchOpen(false)}
               onOk={async () => {
                try {
                  const values = vrBatchForm.getFieldsValue(true);
                  const keys: string[] = form.getFieldValue('vrDomains') || [];
                  const currentCloudId = String(selectedClusterId || form.getFieldValue('cluster') || '').trim();
                  if (!currentCloudId) throw new Error('请先在基础信息中选择安全资源池');
                  if (!Array.isArray(keys) || keys.length === 0) throw new Error('请先选择至少一个安全域');
                  
                  let currentPoolId = poolId;
                  if (!currentPoolId) {
                      try {
                          const pres = await fetchCsmPoolId(currentCloudId);
                          const pid = pres?.data?.pool_id;
                          if (pid) {
                              currentPoolId = pid;
                              setPoolId(pid);
                              try { form?.setFieldsValue({ pool_id: pid }); } catch {}
                          }
                      } catch {}
                  }
                  if (!currentPoolId) throw new Error('未检测到安全资源池 ID (pool_id)');

                  const selected = (vrDomains || []).filter((d: any) => keys.includes(String(d.id)));
                  for (const d of selected) {
                    const cidr = String(d?.cidr || '').trim();
                    if (!cidr) continue;
                    const payload: any = { type: 'subnet', ip_type: values.ip_type || 'ipv4', value: cidr };
                    if (values.port && String(values.port).trim()) payload.port = String(values.port).trim();
                    await createCsmAsset(currentCloudId, payload, { pool_id: currentPoolId });
                    try {
                      const verifyJson = await fetchCsmAssets(currentCloudId, { pool_id: currentPoolId, page_size: 1000 });
                      const items: any[] = Array.isArray((verifyJson as any)?.data?.items)
                        ? (verifyJson as any).data.items
                        : Array.isArray((verifyJson as any)?.items)
                          ? (verifyJson as any).items
                          : Array.isArray((verifyJson as any)?.list)
                            ? (verifyJson as any).list
                            : Array.isArray((verifyJson as any)?.rows)
                              ? (verifyJson as any).rows
                              : Array.isArray(verifyJson) ? (verifyJson as any) : [];
                      const found = items.some((a: any) => String(a?.type || '').toLowerCase() === 'subnet' && String(a?.value || '').trim() === cidr);
                      if (found) {
                        setCsmAssets(items);
                        setVrExistingCidrs((prev) => {
                          const next = Array.from(new Set([cidr, ...prev]));
                          form?.setFieldsValue({ vrExistingCidrs: next });
                          return next;
                        });
                      } else {
                        message.warning(`资产未验证到：${cidr}`);
                      }
                    } catch {}
                  }
                  message.success('已批量添加到资产');
                  setVrBatchOpen(false);
                  vrBatchForm.resetFields();
                 } catch (e: any) {
                   message.error(e.message || '批量添加失败');
                 }
               }}
             >
               <Form form={vrBatchForm} layout="vertical">
                 <Form.Item name="ip_type" label="IP类型" initialValue="ipv4" rules={[{ required: true }]}>
                   <Select>
                     <Select.Option value="ipv4">IPv4</Select.Option>
                     <Select.Option value="ipv6" disabled>IPv6</Select.Option>
                   </Select>
                 </Form.Item>
                 <Form.Item name="port" label="端口">
                   <Input placeholder="例如 80,443 或 1-65535；留空表示全部" />
                 </Form.Item>
               </Form>
             </Modal>
             <Modal
               title="添加到资产（单个安全域）"
               open={vrRowOpen}
               onCancel={() => setVrRowOpen(false)}
               onOk={async () => {
                 try {
                   const values = vrRowForm.getFieldsValue(true);
                   const currentCloudId = String(selectedClusterId || form.getFieldValue('cluster') || '').trim();
                   if (!currentCloudId) throw new Error('请先在基础信息中选择安全资源池');
                   const cidr = String(vrRowRecord?.cidr || '').trim();
                   if (!cidr) throw new Error('安全域未提供CIDR');
                   const payload: any = { type: 'subnet', ip_type: values.ip_type || 'ipv4', value: cidr };
                   if (values.port && String(values.port).trim()) payload.port = String(values.port).trim();
                   await createCsmAsset(currentCloudId, payload, poolId ? { pool_id: poolId } : undefined);
                   try {
                     const verifyJson = await fetchCsmAssets(currentCloudId, { ...(poolId ? { pool_id: poolId } : {}), page_size: 1000 });
                     const items: any[] = Array.isArray((verifyJson as any)?.data?.items)
                       ? (verifyJson as any).data.items
                       : Array.isArray((verifyJson as any)?.items)
                         ? (verifyJson as any).items
                         : Array.isArray((verifyJson as any)?.list)
                           ? (verifyJson as any).list
                           : Array.isArray((verifyJson as any)?.rows)
                             ? (verifyJson as any).rows
                             : Array.isArray(verifyJson) ? (verifyJson as any) : [];
                     const found = items.some((a: any) => String(a?.type || '').toLowerCase() === 'subnet' && String(a?.value || '').trim() === cidr);
                     if (found) {
                       setCsmAssets(items);
                       setVrExistingCidrs((prev) => {
                         const next = Array.from(new Set([cidr, ...prev]));
                         form?.setFieldsValue({ vrExistingCidrs: next });
                         return next;
                       });
                       message.success('已添加到资产');
                     } else {
                       message.error('后端未返回新增资产，可能创建失败');
                     }
                   } catch {
                     message.warning('创建后验证失败，请稍后刷新资产列表');
                   }
                   setVrRowOpen(false);
                   vrRowForm.resetFields();
                 } catch (e:any) {
                   message.error(e.message || '添加失败');
                 }
               }}
             >
               <Form form={vrRowForm} layout="vertical">
                 <Form.Item name="value" label="IP段 (CIDR)">
                   <Input disabled />
                 </Form.Item>
                 <Form.Item name="ip_type" label="IP类型" initialValue="ipv4" rules={[{ required: true }]}>
                   <Select>
                     <Select.Option value="ipv4">IPv4</Select.Option>
                     <Select.Option value="ipv6" disabled>IPv6</Select.Option>
                   </Select>
                 </Form.Item>
                 <Form.Item name="port" label="端口">
                   <Input placeholder="例如 80,443 或 1-65535；留空表示全部" />
                 </Form.Item>
               </Form>
             </Modal>
           </div>
        ) : (
          <div style={{ marginTop: 16, minHeight: 560 }}>
             <div style={{ marginBottom: 12, padding: '8px 12px', background: '#f5f5f5', borderRadius: 4, display: 'flex', alignItems: 'center', gap: 16 }}>
                <span style={{ fontSize: 12 }}>资源池ID (Pool ID):</span>
                <Input 
                    style={{ width: 280 }} 
                    value={poolId || ''} 
                    onChange={e => {
                        const val = e.target.value;
                        setPoolId(val);
                        form.setFieldsValue({ pool_id: val });
                    }}
                    placeholder="自动检测中..."
                    size="small"
                />
                <Button size="small" onClick={() => loadAssets()} loading={assetsLoading}>刷新列表</Button>
                {poolDetecting && <span style={{ color: '#999', fontSize: 12 }}>检测中...</span>}
             </div>
             <div style={{ fontSize: 14, color: '#1f1f1f', marginBottom: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
               <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                 <label style={{ fontSize: 14, color: '#1f1f1f' }}>资产搜索</label>
                 <Input
                   placeholder="搜索名称、IP、类型或描述"
                   allowClear
                   value={assetKeyword}
                   onChange={e => setAssetKeyword(e.target.value)}
                   style={{ width: 320 }}
                 />
                 <div style={{ color: '#999', fontSize: 12 }}>
                   共 {csmAssets.length} 项，已选 {(form.getFieldValue('selectedAssets') || []).length} 项
                 </div>
               </div>
             </div>
             
             <Form.Item
                name="selectedAssets"
                rules={[{ required: true, message: '请至少选择一个防护对象' }]}
             >
                <Table
                  dataSource={filteredAssets}
                  loading={assetsLoading}
                  rowKey={(r: any) => r.network_id || r.id || r.uuid}
                  size="small"
                  rowSelection={{
                    type: 'checkbox',
                    selectedRowKeys: selectedAssetKeys,
                    preserveSelectedRowKeys: true,
                    onChange: (selectedRowKeys) => {
                      setSelectedAssetKeys(selectedRowKeys);
                      const allSelected = csmAssets.filter((a: any) => selectedRowKeys.includes(a.network_id || a.id || a.uuid));
                      form.setFieldsValue({ selectedAssets: selectedRowKeys, selectedAssetObjects: allSelected });
                    }
                  }}
                  columns={[
                    { title: '资产ID (network_id)', dataIndex: 'network_id', key: 'network_id', render: (t: any, r: any) => t || r.id || r.uuid },
                    { title: '名称', dataIndex: 'name', key: 'name' },
                    { title: '类型', dataIndex: 'type', key: 'type', render: (t: any) => <Tag>{t}</Tag> },
                    { title: '值 (IP/CIDR)', dataIndex: 'value', key: 'value', render: (t: any, r: any) => r.displayValue || t },
                    { title: '已绑定服务链', dataIndex: 'serviceChainId', key: 'serviceChainId', render: (t: any) => t ? <Tag color="blue">{t}</Tag> : '-' },
                    { title: '描述', dataIndex: 'description', key: 'description' },
                  ]}
                  pagination={{
                    current: assetPage,
                    pageSize: assetPageSize,
                    total: filteredAssets.length,
                    onChange: (p, ps) => { setAssetPage(p); setAssetPageSize(ps); },
                    showSizeChanger: true
                  }}
                />
             </Form.Item>
          </div>
        )}

      </Form>
    </div>
  );
}
