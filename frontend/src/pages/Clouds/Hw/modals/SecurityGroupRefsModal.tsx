import React, { useMemo, useState } from 'react';
import { App, Button, Modal, Select, Space, Table } from 'antd';
import { collectIpv4FromAddresses } from '../components/Common';
import { fetchHuaweiPorts, addHuaweiPortSecurityGroup, fetchCloudProviderEips } from '../../../../services/api';
import { normalizeErr } from '../utils/net';

type Props = {
  open: boolean;
  cloudId: string;
  target: any | null;
  ecs: any[];
  onClose: () => void;
  onSetEips: (list: any[]) => void;
  onRefreshAll: () => void;
  onOpenVmDetail: (vm: any) => void;
};

const SecurityGroupRefsModal: React.FC<Props> = ({ open, cloudId, target, ecs, onClose, onSetEips, onRefreshAll, onOpenVmDetail }) => {
  const { message } = App.useApp();
  const [busy, setBusy] = useState<boolean>(false);
  const [selId, setSelId] = useState<string>('');

  const gid = String(target?.id || target?.SecurityGroupId || '');

  const currentIds = useMemo(() => {
    const ids = new Set<string>();
    for (const s of (ecs||[])) {
      const names = Array.isArray(s?.security_groups) ? (s.security_groups as any[]).map(x=> String(x?.name||x?.Name||'').trim().toLowerCase()) : [];
      const matchByName = String(target?.name||'').trim().toLowerCase();
      const matchById = String(gid||'').trim().toLowerCase();
      const ok = (matchByName && names.includes(matchByName)) || (!matchByName && matchById && names.includes(matchById));
      if (ok) ids.add(String(s?.id || s?.InstanceId || ''));
    }
    return ids;
  }, [ecs, target, gid]);

  const candidates = useMemo(() => {
    return (ecs||[]).filter((s:any)=>{ const sid=String(s?.id||s?.InstanceId||''); return sid && !currentIds.has(sid); }).map((s:any)=> ({ label: s?.name || s?.InstanceName || s?.id || s?.InstanceId, value: String(s?.id || s?.InstanceId || '') }));
  }, [ecs, currentIds]);

  const dataSource = useMemo(() => {
    const sgName=String(target?.name||'').trim().toLowerCase();
    const sgId=String(target?.id||target?.SecurityGroupId||'').trim().toLowerCase();
    const out:any[]=[]; const seen=new Set<string>();
    for (const s of (ecs||[])) {
      const sid=String(s?.id||s?.InstanceId||'');
      const names=Array.isArray(s?.security_groups)? (s.security_groups as any[]).map(x=> String(x?.name||x?.Name||'').trim().toLowerCase()) : [];
      const match = (sgName && names.includes(sgName)) || (!sgName && sgId && names.includes(sgId));
      if (match && sid && !seen.has(sid)) { seen.add(sid); out.push(s); }
    }
    return out;
  }, [ecs, target]);

  return (
    <Modal
      open={open}
      onCancel={onClose}
      width="70vw"
      destroyOnHidden
      footer={null}
      centered
      title={`管理实例 · ${target?.name || target?.SecurityGroupName || target?.id || target?.SecurityGroupId || '-'}`}
    >
      <div style={{ marginBottom: 12 }}>
        <Space>
          <Select
            value={selId || undefined}
            onChange={(v)=> setSelId(String(v||''))}
            options={candidates}
            style={{ width: 320 }}
            placeholder={candidates.length ? '选择实例加入该安全组' : '暂无可加入的实例'}
          />
          <Button type="primary" disabled={!selId || busy} loading={busy} onClick={async ()=>{
            setBusy(true);
            try {
              const iid = String(selId||''); if (!iid) { message.warning('请选择实例'); setBusy(false); return; }
              const jsonPorts: any = await fetchHuaweiPorts(cloudId, { deviceId: iid });
              const listPorts: any[] = jsonPorts?.data?.ports || jsonPorts?.ports || [];
              for (const p of (Array.isArray(listPorts)? listPorts : [])) { const pid = String(p?.id||''); if (!pid) continue; await addHuaweiPortSecurityGroup(cloudId, pid, gid); }
              const jsonEips = await fetchCloudProviderEips(cloudId).catch(()=>null);
              const eipList: any[] = (jsonEips?.data?.publicips) || (jsonEips?.publicips) || (jsonEips?.data?.publicIps) || (jsonEips?.publicIps) || [];
              onSetEips(Array.isArray(eipList) ? eipList : []);
              await onRefreshAll();
              message.success('已加入安全组');
              setSelId('');
            } catch(e:any){ message.error(normalizeErr(e, '加入失败')); }
            finally { setBusy(false); }
          }}>加入到该安全组</Button>
        </Space>
      </div>
      <Table
        size="small"
        rowKey={(r:any)=> r?.id || r?.InstanceId}
        columns={[
          { title: '实例ID', key: 'id', render: (_:any, r:any)=> (r?.id || r?.InstanceId || '-') },
          { title: '实例名', key: 'name', render: (_:any, r:any)=> (r?.name || r?.InstanceName || '-') },
          { title: '状态', key: 'status', render: (_:any, r:any)=> (r?.status || r?.Status || '-') },
          { title: '私网IP', key: 'pri', render: (_:any, r:any)=> { const { fixed } = collectIpv4FromAddresses(r?.addresses); return fixed.length ? fixed.join(', ') : '-'; } },
          { title: '操作', key: 'op', render: (_:any, r:any)=> (<Button type="link" onClick={()=> onOpenVmDetail(r)}>详情</Button>) }
        ] as any}
        dataSource={dataSource}
        pagination={false}
      />
    </Modal>
  );
};

export default SecurityGroupRefsModal;