import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { App, Table } from 'antd';
import { SafetyOutlined } from '@ant-design/icons';
import { fetchClouds, fetchCloudProviderEcs, fetchInventoryInstancesByCloud, fetchCloudProviderEips, fetchCloudProviderDisks, fetchCloudProviderSnapshots } from '../../../../../services/api';
import { fetchCloudProviderEnis, fetchAliyunEcsMetrics, fetchAliyunEcsHistoryEvents } from '../../../../../services/aliyunApi';
import { fetchCloudProviderSecurityGroups } from '../../../../../services/securityGroups';
import ResourceDetailContainer from '../../../../../components/ResourceDetailContainer';
import EcsInsDetSection from '../sections/EcsInsDetSection';
import NetworkInterfaceSectionAliyun from '../sections/NetworkInterfaceSectionAliyun';
import DiskSectionAliyun from '../sections/DiskSectionAliyun';
import AuditLogSectionAliyun from '../sections/AuditLogSectionAliyun';
import MonitorSectionAliyun from '../sections/MonitorSectionAliyun';
import EipAddressSectionAliyun from '../sections/EipAddressSectionAliyun';
import { useNavigate } from 'react-router-dom';

type EcsDetailModalProps = {
  open: boolean;
  onClose: () => void;
  cloudId: string;
  instanceId: string;
};

const EcsDetailModal: React.FC<EcsDetailModalProps> = ({ open, onClose, cloudId, instanceId }) => {
  const { message } = App.useApp();
  const navigate = useNavigate();
  const [clouds, setClouds] = useState<any[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [instance, setInstance] = useState<any | null>(null);
  const [enis, setEnis] = useState<any[]>([]);
  const [provider, setProvider] = useState<string>('');
  const [eips, setEips] = useState<any[]>([]);
  const [secGroups, setSecGroups] = useState<any[]>([]);
  const [disks, setDisks] = useState<any[]>([]);
  const [snapshots, setSnapshots] = useState<any[]>([]);
  const [metrics, setMetrics] = useState<any[]>([]);
  const [events, setEvents] = useState<any[]>([]);
  const [tabKey, setTabKey] = useState<string>('network');
  const [enisFiltered, setEnisFiltered] = useState<boolean>(false);

  useEffect(() => {
    const initClouds = async () => {
      try {
        const list = await fetchClouds();
        setClouds(Array.isArray(list) ? list : []);
        const c = (Array.isArray(list) ? list : []).find((x:any)=> x.id === cloudId);
        const p = String(c?.config?.provider || c?.type || '').toLowerCase();
        setProvider(p);
      } catch {}
    };
    initClouds();
  }, [cloudId]);

  const loadInstance = async () => {
    if (!cloudId || !instanceId) return;
    setLoading(true);
    setError(null);
    try {
      let invHit: any | null = null;
      try {
        const inv: any = await fetchInventoryInstancesByCloud(cloudId);
        const list: any[] = Array.isArray(inv?.data) ? inv.data : [];
        invHit = list.find((it:any)=> String(it?.id || it?.InstanceId || '').trim() === String(instanceId).trim()) || null;
      } catch {}
      const json: any = await fetchCloudProviderEcs(cloudId);
      const p = String(provider || (clouds.find((c:any)=>c.id===cloudId)?.config?.provider || '')).toLowerCase();
      let cloudList: any[] = [];
      if (p === 'tencentcloud') {
        cloudList = json?.data?.Instances?.Instance || json?.data?.InstanceSet || json?.Instances?.Instance || json?.InstanceSet || [];
      } else if (p === 'huaweicloud') {
        cloudList = json?.data?.servers || json?.servers || [];
      } else if (p === 'harvester') {
        cloudList = json?.data?.Instances?.Instance || json?.Instances?.Instance || [];
      } else {
        cloudList = json?.data?.Instances?.Instance || json?.Instances?.Instance || json?.items || [];
      }
      const cloudHit = cloudList.find((it:any)=> String(it?.InstanceId || it?.id || it?.name || '').trim() === String(instanceId).trim()) || null;
      const merged = cloudHit ? ({ ...(invHit || {}), ...(cloudHit || {}) }) : (invHit || null);
      setInstance(merged);
    } catch (e:any) {
      setError(e?.message || '查询失败');
    } finally {
      setLoading(false);
    }
  };

  const loadEnis = async () => {
    if (!cloudId || !instanceId) return;
    try {
      // 先按实例过滤查询，若返回为空则回退到全量查询
      let list: any[] = [];
      let isFiltered = false;
      try {
        const filtered: any = await fetchCloudProviderEnis(cloudId, { instanceId, _t: Date.now() });
        list = filtered?.data?.NetworkInterfaces?.NetworkInterface || filtered?.data?.enis || [];
        if (Array.isArray(list) && list.length > 0) {
           isFiltered = true;
        }
      } catch {}
      
      if (!isFiltered && (!Array.isArray(list) || list.length === 0)) {
        const all: any = await fetchCloudProviderEnis(cloudId, { _t: Date.now() });
        list = all?.data?.NetworkInterfaces?.NetworkInterface || all?.data?.enis || [];
        isFiltered = false;
      }
      setEnis(Array.isArray(list) ? list : []);
      setEnisFiltered(isFiltered);
    } catch {}
  };
  const loadEips = async () => {
    if (!cloudId) return;
    try {
      const json: any = await fetchCloudProviderEips(cloudId);
      const list: any[] =
        json?.data?.EipAddresses?.EipAddress ||
        json?.EipAddresses?.EipAddress ||
        json?.data?.Eips?.Eip ||
        json?.Eips ||
        json?.data?.publicips ||
        json?.publicips ||
        [];
      setEips(Array.isArray(list) ? list : []);
    } catch {}
  };
  const loadSecGroups = async () => {
    if (!cloudId) return;
    try {
      const json: any = await fetchCloudProviderSecurityGroups(cloudId);
      const list: any[] = json?.data?.SecurityGroups?.SecurityGroup || json?.SecurityGroups?.SecurityGroup || json?.data?.security_groups || json?.security_groups || [];
      setSecGroups(Array.isArray(list) ? list : []);
    } catch {}
  };
  const loadDisks = async () => {
    if (!cloudId) return;
    try {
      const json: any = await fetchCloudProviderDisks(cloudId);
      const list: any[] = json?.data?.Disks?.Disk || json?.disks || json?.data?.volumes || json?.volumes || [];
      setDisks(Array.isArray(list) ? list : []);
    } catch {}
  };
  const loadSnapshots = async () => {
    if (!cloudId) return;
    try {
      const json: any = await fetchCloudProviderSnapshots(cloudId);
      const list: any[] = json?.data?.Snapshots?.Snapshot || json?.snapshots || [];
      setSnapshots(Array.isArray(list) ? list : []);
    } catch {}
  };
  const loadMetrics = useCallback(async () => {
    if (!cloudId || !instanceId) return;
    try {
      const json: any = await fetchAliyunEcsMetrics(cloudId, instanceId, { metric: 'CPUUtilization', period: 60 });
      const dpRaw = json?.data?.Datapoints || json?.Datapoints || '';
      let arr: any[] = [];
      try { arr = typeof dpRaw === 'string' ? JSON.parse(dpRaw || '[]') : (Array.isArray(dpRaw) ? dpRaw : []); } catch {}
      setMetrics(arr);
    } catch {}
  }, [cloudId, instanceId]);
  const loadAuditEvents = async () => {
    if (!cloudId || !instanceId) return;
    try {
      const json: any = await fetchAliyunEcsHistoryEvents(cloudId, instanceId);
      const list: any[] = json?.data?.InstanceSystemEventSet?.InstanceSystemEvent || json?.data?.EventSet || json?.InstanceSystemEventSet?.InstanceSystemEvent || json?.EventSet || [];
      setEvents(Array.isArray(list) ? list : []);
    } catch {}
  };

  useEffect(() => {
    if (!open) {
      setLoading(true);
      setInstance(null);
    }
  }, [open]);

  useEffect(() => { if (open) loadInstance(); }, [cloudId, instanceId, provider, open]);
  useEffect(() => { if (open) { loadEnis(); loadEips(); loadSecGroups(); loadDisks(); loadSnapshots(); loadMetrics(); loadAuditEvents(); } }, [cloudId, instanceId, open, loadMetrics]);

  const prefixText = useMemo(() => {
    const cloud = clouds.find((c:any)=> c.id === cloudId);
    const prov = String(cloud?.config?.provider || cloud?.type || '').toLowerCase();
    const provName = (prov === 'aliyun' && '阿里云') || (prov === 'huaweicloud' && '华为云') || (prov === 'tencentcloud' && '腾讯云') || (prov === 'harvester' && 'Harvester') || prov || '未知厂商';
    return `${provName} · ${cloud?.name || cloudId}`;
  }, [clouds, cloudId]);

  const visibleTabs = useMemo<string[]>(() => ['network', 'eips', 'disks', 'backup', 'secgroups', 'monitor', 'audit'], []);

  return (
    <ResourceDetailContainer
      open={open}
      loading={loading}
      cloudId={cloudId}
      vmDetail={instance}
      vpcs={[]}
      subnets={[]}
      secGroups={secGroups}
      eips={eips}
      vmEnis={enis}
      vmPorts={[]}
      disks={disks}
      snapshots={snapshots}
      tabKey={tabKey}
      onChangeTab={(k)=> setTabKey(String(k))}
      onRefreshAll={async ()=> { await Promise.all([loadInstance(), loadEnis(), loadEips(), loadSecGroups(), loadDisks(), loadSnapshots(), loadMetrics(), loadAuditEvents()]); message.success('实例与资源已刷新'); }}
      onCloseModal={onClose}
      visibleTabs={visibleTabs}
      titlePrefix={prefixText}
      overviewNode={instance ? (
        // EcsInsDetSection updated to accept secGroups
        <EcsInsDetSection 
          cloudId={cloudId} 
          instance={instance} 
          eips={eips} 
          secGroups={secGroups} 
          onRefreshAll={async ()=> { await Promise.all([loadInstance(), loadEnis(), loadEips(), loadSecGroups(), loadDisks(), loadSnapshots()]); }} 
        />
      ) : null}
      tabsItems={(() => {
        const iid = String(instance?.InstanceId || instance?.id || '');
        const eniList:any[] = (() => {
          const fromApi:any[] = Array.isArray(enis) ? enis : [];
          if (enisFiltered && fromApi.length > 0) return fromApi;

          const attached = fromApi.filter((ni:any) => {
            const att:any = ni?.Attachment || ni?.attachment || {};
            const aid = att?.InstanceId || att?.instance_id || ni?.AttachedInstanceId || '';
            return String(aid || '') === iid;
          });
          if (attached && attached.length) return attached;
          const fromInst1:any[] = Array.isArray((instance as any)?.NetworkInterfaces?.NetworkInterface) ? (instance as any)!.NetworkInterfaces!.NetworkInterface : [];
          const fromInst2:any[] = Array.isArray((instance as any)?.network_interfaces) ? (instance as any)!.network_interfaces : [];
          return fromInst1.length ? fromInst1 : fromInst2;
        })();
        const diskList:any[] = Array.isArray(disks) ? disks : [];
        const snapList:any[] = Array.isArray(snapshots) ? snapshots : [];
        const sgIds:string[] = Array.isArray((instance as any)?.SecurityGroupIds?.SecurityGroupId) ? (instance as any)!.SecurityGroupIds.SecurityGroupId : [];
        const sgRows = sgIds.map((gid:string)=> {
          const g = (secGroups || []).find((x:any)=> String(x?.SecurityGroupId || x?.id || '')===String(gid||''));
          return { id: gid, name: g?.SecurityGroupName || g?.name || gid };
        });
        const myDisks = diskList.filter((d:any)=> {
          const atts1:any[] = Array.isArray(d?.Attachments?.Attachment) ? d.Attachments.Attachment : [];
          const atts2:any[] = Array.isArray(d?.attachments) ? d.attachments : [];
          const rid = d?.InstanceId || d?.instance_id || '';
          const matchAtt = [...atts1, ...atts2].some((a:any)=> String(a?.InstanceId || a?.server_id || a?.instance_id || '')===iid);
          return matchAtt || (String(rid||'')===iid);
        });
        const diskIds = new Set<string>(myDisks.map((d:any)=> String(d?.id||'')));
        const mySnaps = snapList.filter((s:any)=> diskIds.has(String(s?.volume_id||'')));
        const nicFallback = (() => {
          const vsw = (instance as any)?.VpcAttributes?.VSwitchId || (instance as any)?.VSwitchId;
          const arr:any[] = Array.isArray((instance as any)?.VpcAttributes?.PrivateIpAddress?.IpAddress) ? (instance as any)!.VpcAttributes!.PrivateIpAddress!.IpAddress : [];
          const st = (instance as any)?.Status || (instance as any)?.status;
          if (vsw || (arr && arr.length)) {
            return [{ id: '-', VSwitchId: vsw, PrivateIpAddress: { IpAddress: arr }, Status: st }];
          }
          return [];
        })();
        const eniData = (eniList && eniList.length) ? eniList : nicFallback;
        const snapCount = Array.isArray(mySnaps) ? mySnaps.length : 0;
        const sgCount = Array.isArray(sgRows) ? sgRows.length : 0;
        const niMeta: any = (NetworkInterfaceSectionAliyun as any).tabMeta;
        const eipMeta: any = (EipAddressSectionAliyun as any).tabMeta;
        const diskMeta: any = (DiskSectionAliyun as any).tabMeta;
        const monMeta: any = (MonitorSectionAliyun as any).tabMeta;
        const audMeta: any = (AuditLogSectionAliyun as any).tabMeta;
        const backupMeta = { key: 'backup', title: '云备份', icon: <SafetyOutlined /> };
        const secMeta = { key: 'secgroups', title: '安全组', icon: <SafetyOutlined /> };
        const countNetwork = niMeta?.countOf?.({ cloudId, instance, enis: eniData, eips });
        const countEips = eipMeta?.countOf?.({ cloudId, instance, eips, enis: eniData });
        const countDisks = diskMeta?.countOf?.({ cloudId, instance, disks });
        const countMonitor = monMeta?.countOf?.({ cloudId, instance, metrics });
        const countAudit = audMeta?.countOf?.({ cloudId, instance, events });
        return [
          {
            key: 'network',
            labelMeta: niMeta,
            count: countNetwork,
            children: (<NetworkInterfaceSectionAliyun cloudId={cloudId} instance={instance} enis={eniData} eips={eips} onRefreshAll={async ()=> { await Promise.all([loadInstance(), loadEnis(), loadEips()]); }} />)
          },
          {
            key: 'eips',
            labelMeta: eipMeta,
            count: countEips,
            children: (<EipAddressSectionAliyun cloudId={cloudId} instance={instance} eips={eips} enis={eniData} onRefreshAll={async ()=> { await loadEips(); }} />)
          },
          {
            key: 'disks',
            labelMeta: diskMeta,
            count: countDisks,
            children: (<DiskSectionAliyun cloudId={cloudId} instance={instance} disks={disks} onSetDisks={setDisks} onRefreshAll={async ()=> { await Promise.all([loadDisks(), loadSnapshots()]); }} />)
          },
          {
            key: 'backup',
            labelMeta: backupMeta,
            count: snapCount,
            children: (
              <Table
                size="small"
                bordered={false}
                tableLayout="auto"
                rowKey={(r:any)=> r?.id}
                columns={[
                  { title: '快照名称', dataIndex: 'name', key: 'name' },
                  { title: '快照ID', dataIndex: 'id', key: 'id' },
                  { title: '源磁盘', dataIndex: 'volume_id', key: 'volume_id' },
                  { title: '状态', dataIndex: 'status', key: 'status' },
                ] as any}
                dataSource={mySnaps}
                pagination={false}
              />
            )
          },
          {
            key: 'secgroups',
            labelMeta: secMeta,
            count: sgCount,
            children: (
              <Table
                size="small"
                bordered={false}
                tableLayout="auto"
                rowKey={(r:any)=> `${r.id}`}
                columns={[
                  { title: '安全组ID', dataIndex: 'id', key: 'id' },
                  { title: '安全组名称', dataIndex: 'name', key: 'name' },
                ] as any}
                dataSource={sgRows}
                pagination={false}
              />
            )
          },
          {
            key: 'monitor',
            labelMeta: monMeta,
            count: countMonitor,
            children: (<MonitorSectionAliyun cloudId={cloudId} instance={instance} metrics={metrics} onRefresh={loadMetrics} />)
          },
          {
            key: 'audit',
            labelMeta: audMeta,
            count: countAudit,
            children: (<AuditLogSectionAliyun cloudId={cloudId} instance={instance} events={events} />)
          },
        ] as any[];
      })()}
    />
  );
};

export default EcsDetailModal;
