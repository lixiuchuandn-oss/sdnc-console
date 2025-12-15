import React, { useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Table, Select, Button, Tag, Dropdown, Modal, Input, Badge, message, Checkbox } from 'antd';
import { EllipsisOutlined,MoreOutlined } from '@ant-design/icons';
import PageDetailSection from '../../../../components/PageDetailSection';
import { fetchCloudProviderEcsVncUrl, fetchHarvesterVmVncUrl } from '../../../../services/api';

type Props = {
  vms: any[];
  loading: boolean;
  namespacesOptions: string[];
  nodesOptions: string[];
  cloudId: string;
  nsValue?: string;
  nodeValue?: string;
  onNsChange: (v?: string) => void;
  onNodeChange: (v?: string) => void;
  onRefresh: () => void;
  onOpenDetail: (vm: any) => void;
  onOpenReconfigure: (vm: any) => void;
  onStart: (iid: string) => void;
  onStop: (iid: string) => void;
  onReboot: (iid: string) => void;
  onDelete: (iid: string, deleteImage?: boolean) => void;
};

const VmSection: React.FC<Props> = ({ vms, loading, namespacesOptions, nodesOptions, cloudId, nsValue, nodeValue, onNsChange, onNodeChange, onRefresh, onOpenDetail, onOpenReconfigure, onStart, onStop, onReboot, onDelete }) => {
  const cnVmStatus = (v?: string): string => {
    const k = String(v || '').toLowerCase();
    const m: Record<string, string> = {
      running: '运行中',
      starting: '启动中',
      stopping: '停止中',
      stopped: '已停止',
      terminated: '已删除',
      error: '错误',
      unknown: '未知'
    };
    return m[k] || (v || '-');
  };
  const navigate = useNavigate();
  const location = useLocation();
  const [keyword, setKeyword] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [selectedKeys, setSelectedKeys] = useState<React.Key[]>([]);
  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    const st = statusFilter.trim().toLowerCase();
    return (vms || []).filter((r: any) => {
      const iid = String(r?.InstanceId || r?.id || '');
      const name = String(r?.InstanceName || r?.name || '').toLowerCase();
      const ns = iid.includes('/') ? iid.split('/')[0] : '';
      const node = r?.Extra?.NodeName || '';
      const sKey = String(r?.Status || r?.status || '').toLowerCase();
      if (nsValue && ns !== nsValue) return false;
      if (nodeValue && node !== nodeValue) return false;
      if (kw && !(iid.toLowerCase().includes(kw) || name.includes(kw))) return false;
      if (st && sKey !== st) return false;
      return true;
    });
  }, [vms, nsValue, nodeValue, keyword, statusFilter]);

  

  
  const getIid = (r: any): string => String(r?.InstanceId || r?.id || '');
  const batchStop = async () => {
    if (selectedKeys.length === 0) return;
    try {
      const targets = (vms || []).filter((r:any)=> selectedKeys.includes(getIid(r))).map(getIid);
      const results = await Promise.all(targets.map(async (iid)=> { try { await onStop(iid); return { ok:true, iid }; } catch(e:any){ return { ok:false, iid, err:e?.message||String(e) }; } }));
      const ok = results.filter(x=>x.ok).length; const fail = results.filter(x=>!x.ok);
      if (ok>0) message.success(`停止成功 ${ok} 台`);
      if (fail.length>0) message.error(`停止失败 ${fail.length} 台：${fail.map(f=>f.iid).join(', ')}`);
      setSelectedKeys([]);
    } catch(e:any){ message.error(e?.message||'批量停止失败'); }
  };
  const batchReboot = async () => {
    if (selectedKeys.length === 0) return;
    try {
      const targets = (vms || []).filter((r:any)=> selectedKeys.includes(getIid(r))).map(getIid);
      const results = await Promise.all(targets.map(async (iid)=> { try { await onReboot(iid); return { ok:true, iid }; } catch(e:any){ return { ok:false, iid, err:e?.message||String(e) }; } }));
      const ok = results.filter(x=>x.ok).length; const fail = results.filter(x=>!x.ok);
      if (ok>0) message.success(`重启成功 ${ok} 台`);
      if (fail.length>0) message.error(`重启失败 ${fail.length} 台：${fail.map(f=>f.iid).join(', ')}`);
      setSelectedKeys([]);
    } catch(e:any){ message.error(e?.message||'批量重启失败'); }
  };
  const batchDelete = async () => {
    if (selectedKeys.length === 0) return;
    Modal.confirm({ title:'确认批量删除所选实例？', onOk: async ()=>{
      try {
        const targets = (vms || []).filter((r:any)=> selectedKeys.includes(getIid(r))).map(getIid);
        const results = await Promise.all(targets.map(async (iid)=> { try { await onDelete(iid); return { ok:true, iid }; } catch(e:any){ return { ok:false, iid, err:e?.message||String(e) }; } }));
        const ok = results.filter(x=>x.ok).length; const fail = results.filter(x=>!x.ok);
        if (ok>0) message.success(`删除成功 ${ok} 台`);
        if (fail.length>0) message.error(`删除失败 ${fail.length} 台：${fail.map(f=>f.iid).join(', ')}`);
        setSelectedKeys([]);
        
      } catch(e:any){ message.error(e?.message||'批量删除失败'); }
    } });
  };
  return (
    <PageDetailSection
      asCard={false}
      toolbarLeft={(
        <>
          <Input allowClear placeholder="关键字" style={{ width: 240 }} value={keyword} onChange={(e)=> setKeyword(e.target.value)} />
          <Select
            style={{ width: 200 }}
            placeholder="命名空间"
            value={nsValue || undefined}
            onChange={(v)=> onNsChange(v || undefined)}
            allowClear
            options={namespacesOptions.map(ns=> ({ value: ns, label: ns }))}
          />
          <Select
            style={{ width: 200 }}
            placeholder="节点"
            value={nodeValue || undefined}
            onChange={(v)=> onNodeChange(v || undefined)}
            allowClear
            options={nodesOptions.map(n=> ({ value: n, label: n }))}
          />
          <Select
            style={{ width: 200 }}
            placeholder="云主机状态"
            value={statusFilter || undefined}
            onChange={(v)=> setStatusFilter(v || '')}
            allowClear
            options={[{ value: '', label: '全部' }, ...['Running','Starting','Stopping','Stopped','Terminated','Error','Unknown'].map(k=> ({ value: k.toLowerCase(), label: (function(){ const m:any={ running:'运行中', starting:'启动中', stopping:'停止中', stopped:'已停止', terminated:'已删除', error:'错误', unknown:'未知' }; return m[k.toLowerCase()] || k; })() }))]}
          />
        </>
      )}
      toolbarRight={(
        <>
          <Button type="primary" onClick={() => navigate(`/clouds/${cloudId}/instances/create`, { state: { backgroundLocation: location } })}>创建实例</Button>
          <Dropdown
            menu={{
              items: [
                { key:'refresh', label:'刷新' },
                { key:'batchStop', label:'批量停止', disabled: selectedKeys.length===0 },
                { key:'batchReboot', label:'批量重启', disabled: selectedKeys.length===0 },
                { key:'batchDelete', label:<span style={{ color:'#ff4d4f' }}>批量删除</span>, disabled: selectedKeys.length===0 },
              ],
              onClick: ({ key }) => { if (key==='refresh') onRefresh(); if (key==='batchStop') batchStop(); if (key==='batchReboot') batchReboot(); if (key==='batchDelete') batchDelete(); },
            }}
          >
            <Button icon={<EllipsisOutlined />}></Button>
          </Dropdown>
        </>
      )}
    >
      <Table
        className="kv-section-table"
        bordered
        rowKey={(r:any)=> r.InstanceId || r.id}
        rowSelection={{ selectedRowKeys: selectedKeys, onChange: (keys)=> setSelectedKeys(keys) }}
        columns={[
          { title: '实例名称 / ID', key: 'inst', render: (_: any, r: any) => (
            <span>
              {(function(){
                const text = r?.InstanceName || r?.name || '-';
                return <Button type="link" size="small" style={{ padding: 0 }} onClick={() => onOpenDetail(r)}>{text}</Button>;
              })()}
              <br />
              <span style={{ color: '#999' }}>{r?.InstanceId || r?.id || '-'}</span>
            </span>
          ) },
          { title: '状态', key: 'status', render: (_: any, r: any) => {
            const s = String(r?.Status || r?.status || '-');
            const k = s.toLowerCase();
            const status = (function(){
              if (k==='running') return 'success';
              if (k==='starting') return 'processing';
              if (k==='stopping') return 'warning';
              if (k==='error') return 'error';
              if (k==='stopped' || k==='terminated' || k==='unknown') return 'default';
              return 'default';
            })();
            return <Badge status={status as any} text={cnVmStatus(s)} />;
          } },
          { title: '镜像', key: 'image', render: (_: any, r: any) => {
            const raw = String(r?.Extra?.Image || '').trim();
            const img = raw && !raw.toUpperCase().startsWith('PVC:') ? raw : '';
            return img ? img : '-';
          } },
          { title: 'vCPU/使用率', key: 'cpu_mix', render: (_: any, r: any) => {
            const allocNum = r?.Extra?.CPU;
            const allocText = (typeof allocNum === 'number') ? `${allocNum} vCPU` : (allocNum ? `${allocNum} vCPU` : '-');
            const usedText = (typeof r?.Extra?.CpuUsagePct === 'number') ? `${r.Extra.CpuUsagePct}%` : '-';
            return `${allocText} / ${usedText}`;
          } },
          { title: '内存/使用率', key: 'mem_mix', render: (_: any, r: any) => {
            const allocRaw = String(r?.Extra?.Memory || '').trim();
            const usedRaw = String(r?.Extra?.MemUsage || '').trim();
            const left = allocRaw || '-';
            const right = usedRaw || '-';
            if (left === '-' && right === '-') return '-';
            return `${left} / ${right}`;
          } },
          { title: 'NAD网络', key: 'nad', render: (_: any, r: any) => {
            const nads = Array.isArray(r?.Extra?.Networks) ? r?.Extra?.Networks : [];
            const nadNames = nads.map((n: any) => { const s = String(n || ''); return s.includes('/') ? s.split('/').pop() : s; }).filter((s: string) => !!s);
            return nadNames.length ? nadNames.join('，') : '无';
          } },
          { title: 'VPC网络', key: 'vpcnet', render: (_: any, r: any) => {
            const vpc = r?.VpcId || '';
            const subnet = r?.Extra?.SubnetName || '';
            return vpc ? (subnet ? `${vpc}/${subnet}` : vpc) : '无';
          } },
          { title: '运行节点', key: 'node', render: (_: any, r: any) => {
            const node = String(r?.Extra?.NodeName || '').trim();
            if (!node) return <Badge status={'default' as any} text={'未运行'} />;
            return <Badge status={'success' as any} text={node} />;
          } },
          { title: '操作', key: 'actions', render: (_: any, r: any) => {
            const iid = String(r?.InstanceId || r?.id || '');
            const items = [
              { key: 'detail', label: '详情' },
              { key: 'reconf', label: '资源变配' },
              { key: 'webvnc', label: 'WebVNC（浏览器）' },
              { type: 'divider' as any },
              { key: 'start', label: '启动' },
              { key: 'stop', label: '停止' },
              { key: 'reboot', label: '重启' },
              { type: 'divider' as any },
              { key: 'delete', label: '删除', danger: true },
            ];
            return (
              <Dropdown
                trigger={['click']}
                menu={{ items, onClick: async ({ key }) => {
                  if (key === 'detail') { onOpenDetail(r); return; }
                  if (key === 'reconf') { onOpenReconfigure(r); return; }
                  if (key === 'webvnc') {
                    try {
                      if (iid.includes('/')) {
                        const ns = iid.split('/')[0];
                        const name = iid.split('/')[1];
                        navigate(`/clouds/${cloudId}/webvnc?kvCloudId=${encodeURIComponent(cloudId)}&namespace=${encodeURIComponent(ns)}&name=${encodeURIComponent(name)}`);
                        return;
                      }
                      const j = await fetchCloudProviderEcsVncUrl(cloudId, iid);
                      const url = j?.data?.VncUrl || j?.data?.vncUrl || j?.data?.url;
                      if (url) {
                        const w = Math.max(1280, (window.screen?.availWidth || 1600) - 40);
                        const h = Math.max(800, (window.screen?.availHeight || 900) - 80);
                        const features = `width=${w},height=${h},top=0,left=0,menubar=no,toolbar=no,location=no,status=no,scrollbars=yes,resizable=yes`;
                        window.open(url, 'webvnc', features);
                        return;
                      }
                      const pubArr = r?.PublicIpAddress?.IpAddress;
                      const pub = Array.isArray(pubArr) && pubArr.length > 0 ? pubArr[0] : (r?.EipAddress?.IpAddress || r?.publicIpAddress || (Array.isArray(r?.PublicIpAddress?.IpAddress) ? r?.PublicIpAddress?.IpAddress[0] : null));
                      const priArr = r?.VpcAttributes?.PrivateIpAddress?.IpAddress;
                      const pri = Array.isArray(priArr) && priArr.length > 0 ? priArr[0] : r?.privateIpAddress;
                      const host = pub || pri || '';
                      if (!host) { message.warning('未获取到VNC地址'); return; }
                      navigate(`/clouds/${cloudId}/webvnc?host=${encodeURIComponent(host)}&port=5900`);
                      return;
                    } catch (e:any) {
                      message.error(e?.message || '获取VNC地址失败');
                      return;
                    }
                  }
                  if (key === 'start') { await onStart(iid); return; }
                  if (key === 'stop') { await onStop(iid); return; }
                  if (key === 'reboot') { await onReboot(iid); return; }
                  if (key === 'delete') {
                    let deleteImage = false;
                    Modal.confirm({
                      title: '确认删除该实例？',
                      content: (
                        <div>
                          <p>删除后不可恢复。</p>
                          <Checkbox onChange={(e) => { deleteImage = e.target.checked; }}>同步删除关联镜像</Checkbox>
                        </div>
                      ),
                      onOk: () => onDelete(iid, deleteImage)
                    });
                    return;
                  }
                } }}
              >
                <Button type="text" icon={<MoreOutlined />} />
              </Dropdown>
            );
          } },
        ] as any}
        dataSource={filtered}
        loading={loading}
        pagination={{ showSizeChanger:true, showQuickJumper:true, pageSize:10, pageSizeOptions:[10,20,50,100] }}
      />
    </PageDetailSection>
  );
};

export default VmSection;
