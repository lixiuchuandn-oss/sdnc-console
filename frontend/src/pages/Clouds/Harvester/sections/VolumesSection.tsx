import React, { useMemo, useState, useEffect } from 'react';
import { Table, Tag, Input, Select, Button, Dropdown, Modal, Form, message, InputNumber, Switch } from 'antd';
import { EllipsisOutlined } from '@ant-design/icons';
import PageDetailSection from '../../../../components/PageDetailSection';
import { attachHarvesterVolumeToVm, attachHarvesterVolumeToVmByName, detachHarvesterVolumeFromVm, deleteHarvesterVolume, fetchHarvesterStorageClasses, createHarvesterVolume, exportHarvesterImageFromVolume, createHarvesterVolumeSnapshot, updateHarvesterVolume, cloneHarvesterVolume } from '../../../../services/api';

type Props = {
  cloudId: string;
  volumes: any[];
  loading: boolean;
  vms?: any[];
  onRefresh?: () => void;
};

const VolumesSection: React.FC<Props> = ({ cloudId, volumes, loading, vms, onRefresh }) => {
  const [keyword, setKeyword] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [nsFilter, setNsFilter] = useState<string>('');
  const [scFilter, setScFilter] = useState<string>('');
  const [attachOpen, setAttachOpen] = useState<boolean>(false);
  const [attachForm] = Form.useForm();
  const [recordForAttach, setRecordForAttach] = useState<any>(null);
  const [createOpen, setCreateOpen] = useState<boolean>(false);
  const [createForm] = Form.useForm();
  const [storageClasses, setStorageClasses] = useState<any[]>([]);
  const [creating, setCreating] = useState<boolean>(false);
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);
  const [exportOpen, setExportOpen] = useState<boolean>(false);
  const [snapshotOpen, setSnapshotOpen] = useState<boolean>(false);
  const [editOpen, setEditOpen] = useState<boolean>(false);
  const [cloneOpen, setCloneOpen] = useState<boolean>(false);
  const [exportForm] = Form.useForm();
  const [snapshotForm] = Form.useForm();
  const [editForm] = Form.useForm();
  const [cloneForm] = Form.useForm();
  const [recordAction, setRecordAction] = useState<any>(null);
  const [showSystemVolumes, setShowSystemVolumes] = useState<boolean>(false);
  
  const gbText = (bytes?: number | string): string => {
    const n = typeof bytes === 'number' ? bytes : (typeof bytes === 'string' ? Number(bytes) : NaN);
    if (!isFinite(n) || n <= 0) return '-';
    const gb = n / (1024 * 1024 * 1024);
    return `${gb.toFixed(2)}GB`;
  };
  const cnStatus = (s?: string): string => {
    const k = String(s || '').toLowerCase();
    const m: Record<string, string> = {
      healthy: '健康',
      degraded: '降级',
      faulted: '故障',
      unknown: '未知',
      detached: '已卸载',
      attaching: '使用中',
      attached: '使用中',
      detaching: '卸载中',
      maintenance: '维护',
      restoring: '恢复中',
      creating: '创建中',
      deleting: '删除中',
      error: '错误'
    };
    return m[k] || (s || '-');
  };
  const statusBadge = (s?: string) => {
    const k = String(s || '').toLowerCase();
    const text = cnStatus(s);
    const color = (function(){
      if (k === 'healthy') return 'green';
      if (k === 'degraded') return 'orange';
      if (k === 'faulted' || k === 'error') return 'red';
      if (k === 'maintenance') return 'gold';
      if (k === 'attached') return 'blue';
      if (k === 'attaching' || k === 'detaching' || k === 'restoring' || k === 'creating' || k === 'deleting') return 'blue';
      return undefined;
    })();
    return <Tag color={color}>{text}</Tag>;
  };
  
  const findVm = (vol: any): any | undefined => {
    const ns = String(vol?.namespace || '').trim();
    const pvc = String(vol?.pvcName || '').trim();
    const names: string[] = Array.isArray(vol?.attachedTo) ? vol.attachedTo : [];
    const list: any[] = Array.isArray(vms) ? vms : [];
    // 1) 优先用 namespace/name 匹配
    for (const nm of names) {
      const iid = ns && nm ? `${ns}/${nm}` : nm;
      const hit = list.find((vm:any)=> String(vm?.InstanceId||'') === iid || String(vm?.InstanceName||'') === nm);
      if (hit) return hit;
    }
    // 2) 用 PVC 名称匹配 VM Extra.VolumeClaims
    if (pvc) {
      const hit = list.find((vm:any)=> Array.isArray(vm?.Extra?.VolumeClaims) && vm.Extra.VolumeClaims.includes(pvc) && String(vm?.Extra?.Namespace||'') === ns);
      if (hit) return hit;
    }
    return undefined;
  };
  const normalizeStatusKey = (r: any): string => String(r?.state || r?.status?.phase || r?.status?.status || '').toLowerCase();
  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    const st = statusFilter.trim().toLowerCase();
    const systemNamespaces = new Set<string>(['kube-system','longhorn-system','harvester-system','cattle-system','cattle-monitoring-system','cattle-fleet-system','istio-system','monitoring','ingress-nginx']);
    return (Array.isArray(volumes) ? volumes : []).filter((r:any) => {
      const name = String(r?.name || r?.metadata?.name || '').toLowerCase();
      if (kw && !(name.includes(kw))) return false;
      const key = normalizeStatusKey(r);
      if (st && key !== st) return false;
      const ns = String(r?.namespace || r?.metadata?.namespace || '').trim();
      if (!showSystemVolumes && systemNamespaces.has(ns)) return false;
      if (nsFilter && ns !== nsFilter) return false;
      const scName = String(r?.storageClassName || r?.spec?.storageClassName || '').trim();
      if (scFilter && scName !== scFilter) return false;
      
      return true;
    });
  }, [volumes, keyword, statusFilter, nsFilter, scFilter, vms]);
  const statusOptions = [
    'healthy','degraded','faulted','detached','attaching','attached','detaching','maintenance','restoring','creating','deleting','error'
  ];
  
  const nsOptions = useMemo(() => {
    const set = new Set<string>();
    const vols = Array.isArray(volumes) ? volumes : [];
    const list = Array.isArray(vms) ? vms : [];
    for (const r of vols) { const ns = String(r?.namespace || '').trim(); if (ns) set.add(ns); }
    for (const x of list) { const ns = String(x?.Extra?.Namespace || '').trim(); if (ns) set.add(ns); }
    if (!set.has('default')) set.add('default');
    return Array.from(set).sort().map(s => ({ value: s, label: s }));
  }, [volumes, vms]);
  useEffect(() => { (async () => { try { const res = await fetchHarvesterStorageClasses(cloudId); const items = Array.isArray(res?.data?.items) ? res.data.items : []; setStorageClasses(items); } catch {} })(); }, [cloudId]);
  useEffect(() => {
    try {
      const cur = createForm.getFieldValue('storageClassName');
      const names = (Array.isArray(storageClasses) ? storageClasses : []).map((s:any)=> String(s?.name||'')).filter(Boolean);
      if (!cur) {
        const prefer = names.find(n=> n.toLowerCase()==='longhorn') || names.find(n=> n.toLowerCase().includes('longhorn')) || names[0];
        if (prefer) createForm.setFieldsValue({ storageClassName: prefer });
      }
    } catch {}
  }, [storageClasses, createForm]);
  return (
    <PageDetailSection
      asCard={false}
      toolbarLeft={(
        <>
          <Input allowClear placeholder="关键字" value={keyword} onChange={(e)=>setKeyword(e.target.value)} style={{ width: 240 }} />
          <Select
            allowClear
            showSearch
            placeholder="命名空间"
            value={nsFilter || undefined}
            onChange={(v)=> setNsFilter(v || '')}
            style={{ width: 180 }}
            options={[{ value: '', label: '全部' }, ...nsOptions]}
          />
          <Select
            allowClear
            placeholder="虚拟卷状态"
            value={statusFilter || undefined}
            onChange={(v)=> setStatusFilter(v || '')}
            style={{ width: 180 }}
            options={[{ value: '', label: '全部' }, ...statusOptions.map(k=> ({ value: k, label: cnStatus(k) }))]}
          />
          <Select
            allowClear
            showSearch
            placeholder="存储类"
            value={scFilter || undefined}
            onChange={(v)=> setScFilter(v || '')}
            style={{ width: 200 }}
            options={[{ value: '', label: '全部' }, ...((Array.isArray(storageClasses)?storageClasses:[]).map((s:any)=> ({ value: String(s?.name||''), label: String(s?.name||'') })).filter(x=> x.value))]}
          />
          
          <span style={{ marginLeft: 12 }}>
            <Switch checked={showSystemVolumes} onChange={(v)=> setShowSystemVolumes(v)} />
            <span style={{ marginLeft: 6 }}>显示系统卷</span>
          </span>
          
        </>
      )}
      toolbarRight={(
        <>
          <Button type="primary" onClick={() => { createForm.resetFields(); createForm.setFieldsValue({ namespace: 'default', accessModes: ['ReadWriteOnce'], volumeMode: 'Block' }); setCreateOpen(true); }}>创建卷</Button>
          <Dropdown
            trigger={["click"]}
            menu={{
              items: [
                { key: 'refresh', label: '刷新' },
                { key: 'batchDelete', label: '批量删除', disabled: selectedRowKeys.length === 0, danger: true },
              ],
              onClick: async ({ key }) => {
                try {
                  if (key === 'refresh') { onRefresh?.(); return; }
                  if (key === 'batchDelete') {
                    const targets = (Array.isArray(volumes) ? volumes : []).filter((r:any)=> selectedRowKeys.includes(r?.name || r?.metadata?.name));
                    if (targets.length === 0) { message.info('请先选择要删除的卷'); return; }
                    Modal.confirm({
                      title: '批量删除确认',
                      content: `即将删除 ${targets.length} 个卷：` + targets.map((t:any)=> String(t?.name || t?.metadata?.name || '')).join(', '),
                      okText: '删除', cancelText: '取消', okButtonProps: { danger: true },
                      onOk: async () => {
                        try {
                          const results = await Promise.allSettled(targets.map(async (r:any)=>{
                            const rawName = String(r?.name || '');
                            let delNs = String(r?.namespace || '') || 'longhorn-system';
                            let delName = rawName;
                            if (rawName.includes('/')) { const parts = rawName.split('/'); delNs = parts[0] || delNs; delName = parts.slice(1).join('/'); }
                            await deleteHarvesterVolume(cloudId, delNs, delName);
                          }));
                          const ok = results.filter(x=> x.status==='fulfilled').length;
                          const fail = results.length - ok;
                          if (ok>0) message.success(`成功删除 ${ok} 个卷`);
                          if (fail>0) message.error(`有 ${fail} 个卷删除失败`);
                          setSelectedRowKeys([]);
                          onRefresh?.();
                        } catch (e:any) {
                          message.error(e?.message || '批量删除失败');
                        }
                      }
                    });
                    return;
                  }
                } catch (e:any) { message.error(e?.message || '操作失败'); }
              }
            }}
          >
            <Button icon={<EllipsisOutlined />} />
          </Dropdown>
        </>
      )}
    >
      <Modal
        open={attachOpen}
        onCancel={() => setAttachOpen(false)}
        onOk={async () => {
          try {
            const v = await attachForm.validateFields();
            const vm = (Array.isArray(vms) ? vms : []).find((x:any)=> String(x?.InstanceId||'')===String(v.instanceId));
            if (!vm) { message.error('未找到云主机'); return; }
            const iid = String(vm?.InstanceId || '');
            const iidNameOnly = iid.includes('/') ? (iid.split('/').pop() || iid) : iid;
            const pvcNameRaw = String(recordForAttach?.pvcName || recordForAttach?.name || '');
            const pvcName = pvcNameRaw.includes('/') ? pvcNameRaw.split('/').pop() || pvcNameRaw : pvcNameRaw;
            const ns = String(recordForAttach?.namespace || 'default');
            const computedDiskName = (pvcName || '').replace(/[^a-z0-9-]/gi, '-').toLowerCase().slice(0, 63) || 'disk-1';
            if (!pvcName || pvcName === String(recordForAttach?.name || '')) { message.error('该卷缺少 PVC 名称，无法挂载'); return; }
            await attachHarvesterVolumeToVmByName(cloudId, ns, (iid.split('/')[1] || iidNameOnly), { diskName: computedDiskName, bus: v.bus || 'virtio', pvcNamespace: ns, pvcName });
            message.success('挂载成功');
            setAttachOpen(false);
            onRefresh?.();
          } catch (e: any) {
            message.error(e?.message || '挂载失败');
          }
        }}
        title="挂载到云主机"
      >
        <Form form={attachForm} layout="vertical">
          <Form.Item label="云主机" name="instanceId" rules={[{ required: true }]}> 
            <Select
              showSearch
              placeholder="选择云主机"
              options={(Array.isArray(vms) ? vms : [])
                .filter((x:any)=> String(x?.Extra?.Namespace||'') === String(recordForAttach?.namespace||''))
                .map((x:any)=> ({ value: String(x?.InstanceId||''), label: `${x?.InstanceName || x?.InstanceId}` }))}
            />
          </Form.Item>
          {/* 设备名不再由用户填写，默认使用 PVC 名称的安全化形式 */}
          <Form.Item label="总线" name="bus" initialValue="virtio">
            <Select options={[{ value: 'virtio', label: 'virtio' }, { value: 'sata', label: 'sata' }, { value: 'scsi', label: 'scsi' }]} />
          </Form.Item>
          <Form.Item label="PVC">
            <Input value={String(recordForAttach?.pvcName || recordForAttach?.name || '')} disabled />
          </Form.Item>
          <Form.Item label="命名空间">
            <Input value={String(recordForAttach?.namespace || '')} disabled />
          </Form.Item>
        </Form>
      </Modal>
      <Modal open={exportOpen} onCancel={()=> setExportOpen(false)} onOk={async ()=>{ try{ const v=await exportForm.validateFields(); const ns = String(recordAction?.namespace||'default'); const pvc = String(recordAction?.pvcName || recordAction?.name || ''); await exportHarvesterImageFromVolume(cloudId, ns, pvc, { displayName: String(v.displayName||pvc), targetStorageClassName: String(v.targetStorageClassName||'')||undefined }); message.success('创建镜像任务成功'); setExportOpen(false); }catch(e:any){ message.error(e?.message||'导出失败'); } }} title="导出为镜像"><Form form={exportForm} layout="vertical"><Form.Item label="镜像名称" name="displayName" rules={[{ required: true }]}><Input placeholder="例如: volume-image"/></Form.Item><Form.Item label="存储类" name="targetStorageClassName"><Select allowClear placeholder="默认 longhorn" options={(Array.isArray(storageClasses)?storageClasses:[]).map((s:any)=> ({ value: s?.name, label: s?.name }))} /></Form.Item></Form></Modal>
      <Modal open={snapshotOpen} onCancel={()=> setSnapshotOpen(false)} onOk={async ()=>{ try{ const v=await snapshotForm.validateFields(); const ns = String(recordAction?.namespace||'default'); const pvc = String(recordAction?.pvcName || recordAction?.name || ''); await createHarvesterVolumeSnapshot(cloudId, ns, pvc, { name: String(v.name||''), snapshotClassName: String(v.snapshotClassName||'')||undefined }); message.success('创建快照成功'); setSnapshotOpen(false); }catch(e:any){ message.error(e?.message||'创建快照失败'); } }} title="创建快照"><Form form={snapshotForm} layout="vertical"><Form.Item label="快照名称" name="name"><Input placeholder="留空自动生成"/></Form.Item><Form.Item label="快照类" name="snapshotClassName"><Input placeholder="例如: longhorn"/></Form.Item></Form></Modal>
      <Modal open={editOpen} onCancel={()=> setEditOpen(false)} onOk={async ()=>{ try{ const v=await editForm.validateFields(); const ns = String(recordAction?.namespace||'default'); const pvc = String(recordAction?.pvcName || recordAction?.name || ''); const sizeGi = Number(v.sizeGi||0); const accessModes = Array.isArray(v.accessModes)? v.accessModes: ['ReadWriteOnce']; const volumeMode = String(v.volumeMode||'Block'); const storageClassName = String(v.storageClassName||'')||undefined; await updateHarvesterVolume(cloudId, ns, pvc, { sizeGi, accessModes, volumeMode, storageClassName }); message.success('更新成功'); setEditOpen(false); onRefresh?.(); }catch(e:any){ message.error(e?.message||'更新失败'); } }} title="编辑配置"><Form form={editForm} layout="vertical"><Form.Item label="容量(GB)" name="sizeGi"><InputNumber min={1} precision={0} style={{ width: '100%' }} /></Form.Item><Form.Item label="访问模式" name="accessModes" initialValue={["ReadWriteOnce"]}><Select mode="multiple" options={[{ value: 'ReadWriteOnce', label: '读写单副本 (RWO)' }, { value: 'ReadWriteMany', label: '读写多副本 (RWX)' }, { value: 'ReadOnlyMany', label: '只读多副本 (ROX)' }]} /></Form.Item><Form.Item label="卷类型" name="volumeMode" initialValue="Block"><Select options={[{ value: 'Block', label: 'Block' }, { value: 'Filesystem', label: 'Filesystem' }]} /></Form.Item><Form.Item label="存储类" name="storageClassName"><Select allowClear placeholder="默认 longhorn" options={(Array.isArray(storageClasses)?storageClasses:[]).map((s:any)=> ({ value: s?.name, label: s?.name }))} /></Form.Item></Form></Modal>
      <Modal open={cloneOpen} onCancel={()=> setCloneOpen(false)} onOk={async ()=>{ try{ const v=await cloneForm.validateFields(); const ns = String(recordAction?.namespace||'default'); const pvc = String(recordAction?.pvcName || recordAction?.name || ''); const payload = { targetNamespace: String(v.targetNamespace||ns), newName: String(v.newName||`${pvc}-clone`), sizeGi: Number(v.sizeGi||0) || undefined, storageClassName: String(v.storageClassName||'')||undefined, fromSnapshotName: String(v.fromSnapshotName||'')||undefined, accessModes: Array.isArray(v.accessModes)? v.accessModes: ['ReadWriteOnce'], volumeMode: String(v.volumeMode||'Block') }; await cloneHarvesterVolume(cloudId, ns, pvc, payload as any); message.success('克隆创建成功'); setCloneOpen(false); onRefresh?.(); }catch(e:any){ message.error(e?.message||'克隆失败'); } }} title="克隆"><Form form={cloneForm} layout="vertical"><Form.Item label="目标命名空间" name="targetNamespace" initialValue={"default"}><Select showSearch placeholder="选择命名空间" options={nsOptions} /></Form.Item><Form.Item label="新卷名称" name="newName" rules={[{ required: true }]}><Input placeholder="例如: my-disk-clone"/></Form.Item><Form.Item label="容量(GB)" name="sizeGi"><InputNumber min={1} precision={0} style={{ width: '100%' }} /></Form.Item><Form.Item label="访问模式" name="accessModes" initialValue={["ReadWriteOnce"]}><Select mode="multiple" options={[{ value: 'ReadWriteOnce', label: '读写单副本 (RWO)' }, { value: 'ReadWriteMany', label: '读写多副本 (RWX)' }, { value: 'ReadOnlyMany', label: '只读多副本 (ROX)' }]} /></Form.Item><Form.Item label="卷类型" name="volumeMode" initialValue="Block"><Select options={[{ value: 'Block', label: 'Block' }, { value: 'Filesystem', label: 'Filesystem' }]} /></Form.Item><Form.Item label="存储类" name="storageClassName"><Select allowClear placeholder="默认 longhorn" options={(Array.isArray(storageClasses)?storageClasses:[]).map((s:any)=> ({ value: s?.name, label: s?.name }))} /></Form.Item><Form.Item label="来源快照" name="fromSnapshotName"><Input placeholder="可选，使用快照克隆"/></Form.Item></Form></Modal>
      <Modal
        open={createOpen}
        onCancel={() => setCreateOpen(false)}
        onOk={async () => {
          try {
            setCreating(true);
            const v = await createForm.validateFields();
            const sizeGi = Number(v.sizeGi || 0);
            const payload = { namespace: String(v.namespace || 'default'), name: String(v.name || ''), sizeGi, accessModes: Array.isArray(v.accessModes) ? v.accessModes : ['ReadWriteOnce'], volumeMode: String(v.volumeMode || 'Block'), storageClassName: String(v.storageClassName || '') || undefined };
            await createHarvesterVolume(cloudId, payload);
            message.success('创建成功');
            setCreateOpen(false);
            onRefresh?.();
          } catch (e: any) { message.error(e?.message || '创建失败'); }
          finally { setCreating(false); }
        }}
        title="创建卷"
        confirmLoading={creating}
      >
        <Form form={createForm} layout="vertical">
          <Form.Item label="卷名称" name="name" rules={[{ required: true }]}> 
            <Input placeholder="例如: my-data-disk" />
          </Form.Item>
          <Form.Item label="命名空间" name="namespace" initialValue="default" rules={[{ required: true }]} extra="建议选择工作负载所在命名空间"> 
            <Select showSearch placeholder="选择命名空间" options={nsOptions} filterOption={(input, option)=> String(option?.label||'').toLowerCase().includes(String(input||'').toLowerCase())} />
          </Form.Item>
          <Form.Item label="容量(GB)" name="sizeGi" rules={[{ required: true }]}> 
            <InputNumber min={1} precision={0} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item label="访问模式" name="accessModes" initialValue={["ReadWriteOnce"]} extra="RWO=读写单副本，RWX=读写多副本，ROX=只读多副本"> 
            <Select mode="multiple" options={[{ value: 'ReadWriteOnce', label: '读写单副本 (RWO)' }, { value: 'ReadWriteMany', label: '读写多副本 (RWX)' }, { value: 'ReadOnlyMany', label: '只读多副本 (ROX)' }]} />
          </Form.Item>
          <Form.Item label="卷类型" name="volumeMode" initialValue="Block"> 
            <Select options={[{ value: 'Block', label: 'Block' }, { value: 'Filesystem', label: 'Filesystem' }]} />
          </Form.Item>
          <Form.Item label="存储类" name="storageClassName" extra="默认 Longhorn，建议保持不变"> 
            <Select allowClear placeholder="默认使用 longhorn" options={(Array.isArray(storageClasses)?storageClasses:[]).map((s:any)=> ({ value: s?.name, label: s?.name }))} />
          </Form.Item>
        </Form>
      </Modal>
      <Table
        className="kv-section-table"
        bordered
        rowKey={(r:any)=> r?.name || r?.metadata?.name || Math.random().toString(36).slice(2)}
      rowSelection={{ selectedRowKeys, onChange: (keys)=> setSelectedRowKeys(keys as React.Key[]) }}
      columns={[
        { title: 'PVC/卷名', key: 'name', render: (_:any, r:any)=> { const vol = String(r?.name || r?.metadata?.name || '-'); const pvc = String(r?.pvcName || '-'); return (<div><div style={{ fontWeight: 500 }}>{pvc}</div><div style={{ color:'#999' }}>{vol}</div></div>); } },
        { title: '状态', key: 'status', render: (_:any, r:any)=> statusBadge(r?.state || r?.status?.phase || r?.status?.status) },
        { title: '命名空间/存储类', key: 'ns-sc', render: (_:any, r:any)=> { const ns = String(r?.namespace || r?.metadata?.namespace || '-') || '-'; const sc = String(r?.storageClassName || r?.spec?.storageClassName || '-') || '-'; return (<div><div>{ns}</div><div style={{ color:'#999' }}>{sc}</div></div>); } },
        { title: '访问模式/卷类型', key: 'am-vm', render: (_:any, r:any)=> { const am = Array.isArray(r?.accessModes)? r.accessModes: (Array.isArray(r?.spec?.accessModes)? r.spec.accessModes: []); const vm = String(r?.volumeMode || r?.spec?.volumeMode || '') || ''; return (<div><div>{(am||[]).length? (am||[]).map((x:string)=> <Tag key={x}>{x}</Tag>): '-'}</div><div style={{ color:'#999' }}>{vm || '-'}</div></div>); } },
        { title: '挂载云主机', key: 'attachedTo', render: (_:any, r:any)=> (Array.isArray(r?.attachedTo) && r.attachedTo.length>0 ? r.attachedTo.join(',') : '-') },
        
        { title: '大小（GB）', key: 'size', render: (_:any, r:any)=> gbText(r?.size) },
        { title: '操作', key: 'actions', render: (_:any, r:any) => { const vm=findVm(r); const pvc= String(r?.pvcName || r?.name || '').trim(); const diskName = vm?.Extra?.VolumeMap?.[pvc] || ''; const ns = String(r?.namespace || ''); const items = [ { key: 'attach', label: '挂载到云主机' }, ...(diskName && vm ? [{ key: 'detach', label: '从云主机卸载', danger: true }] : []), { key: 'export', label: '导出为镜像' }, { key: 'snapshot', label: '创建快照' }, { key: 'edit', label: '编辑配置' }, { key: 'clone', label: '克隆' }, { key: 'delete', label: '删除', danger: true } ]; return (<Dropdown trigger={["click"]} menu={{ items, onClick: async ({ key })=>{ try { if (key==='attach') { setRecordForAttach(r); attachForm.resetFields(); attachForm.setFieldsValue({ instanceId: vm ? vm.InstanceId : undefined, diskName: (r?.pvcName || r?.name || ''), bus: 'virtio' }); setAttachOpen(true); return; } if (key==='detach') { if (!vm || !diskName) { message.warning('未找到挂载信息'); return; } const iid = String(vm.InstanceId||''); const iidNameOnly = iid.includes('/') ? (iid.split('/').pop() || iid) : iid; try { await detachHarvesterVolumeFromVm(cloudId, iid, { name: String(diskName) }); } catch (e1:any) { const msg = String(e1?.message || ''); if (msg.includes('NotFound')) { await detachHarvesterVolumeFromVm(cloudId, iidNameOnly, { name: String(diskName) }); } else { throw e1; } } message.success('卸载成功'); onRefresh?.(); return; } if (key==='export') { setRecordAction(r); exportForm.resetFields(); exportForm.setFieldsValue({ displayName: r?.name || r?.pvcName || '' }); setExportOpen(true); return; } if (key==='snapshot') { setRecordAction(r); snapshotForm.resetFields(); snapshotForm.setFieldsValue({ name: `${(r?.name||'').replace(/\//g,'-')}-snap` }); setSnapshotOpen(true); return; } if (key==='edit') { setRecordAction(r); editForm.resetFields(); editForm.setFieldsValue({ sizeGi: 10, accessModes:['ReadWriteOnce'], volumeMode:'Block' }); setEditOpen(true); return; } if (key==='clone') { setRecordAction(r); cloneForm.resetFields(); cloneForm.setFieldsValue({ targetNamespace: ns||'default', newName: `${(r?.name||'').split('/').pop()}-clone`, accessModes:['ReadWriteOnce'], volumeMode:'Block' }); setCloneOpen(true); return; } if (key==='delete') { const rawName = String(r?.name || ''); let delNs = ns || 'longhorn-system'; let delName = rawName; if (rawName.includes('/')) { const parts = rawName.split('/'); delNs = parts[0] || delNs; delName = parts.slice(1).join('/'); } await deleteHarvesterVolume(cloudId, delNs, delName); message.success('删除成功'); onRefresh?.(); return; } } catch (e:any) { message.error(e?.message || '操作失败'); } } }}><Button type="link" icon={<EllipsisOutlined style={{ transform: 'rotate(90deg)' }} />}></Button></Dropdown>); } },
      ] as any}
      dataSource={filtered}
      loading={loading}
      pagination={{ showSizeChanger:true, showQuickJumper:true, pageSize:10, pageSizeOptions:[10,20,50,100] }}
    />
    </PageDetailSection>
  );
};

export default VolumesSection;
