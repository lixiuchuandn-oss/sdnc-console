import React from 'react';
import { App, Button, Descriptions, Divider, Modal, Row, Col, Space, Table, Tabs, Tag, Card, Alert, DatePicker, InputNumber, Select, Input } from 'antd';
import ReactECharts from 'echarts-for-react';
import { DesktopOutlined, LineChartOutlined, NodeIndexOutlined, PlayCircleOutlined, PoweroffOutlined, ReloadOutlined, DeleteOutlined, WindowsOutlined, CodeOutlined, SafetyCertificateOutlined, GlobalOutlined, CloudServerOutlined, HddOutlined, CopyOutlined, EyeOutlined, AuditOutlined } from '@ant-design/icons';
import SecurityGroupRuleManageDrawer from './drawers/SecurityGroupRuleManageDrawer';
import { statusTag, EllipsisText, collectIpv4FromAddresses } from './components/Common';
import { startCloudProviderEcs, stopCloudProviderEcs, rebootCloudProviderEcs, deleteCloudProviderEcs, fetchCloudProviderEcsVncUrl, fetchCloudProviderEips, fetchCloudProviderEcs } from '../../../services/api';
import { fetchHuaweiPorts, updateHuaweiPortSourceDestCheck, unbindHuaweiEip, fetchHuaweiEcsAuditTraces, addHuaweiPortSecurityGroup, removeHuaweiPortSecurityGroup, setHuaweiPortSecurityGroups, showCloudProviderSecurityGroup } from '../../../services/huaweiApi';

type EcsDetailHwProps = {
  cloudId: string;
  vmDetail: any;
  vpcs: any[];
  subnets: any[];
  secGroups: any[];
  eips: any[];
  vmEnis: any[];
  vmPorts: any[];
  disks: any[];
  snapshots: any[];
  tabKey: string;
  onChangeTab: (k: string) => void;
  onRefreshAll: () => Promise<void> | void;
  onCloseModal: () => void;
  onOpenEipManage: (portId: string) => void;
  onSetVmPorts: (list: any[]) => void;
  onSetEips: (list: any[]) => void;
  onSetVmDetail: (vm: any) => void;
  onRefreshMonitor: () => Promise<void> | void;
  vmCes: any;
  vmCesAvailable: string[];
  vmMonitorError: string;
  vmCesError: string;
  vmCesRange: number;
  vmCesPeriod: number;
  vmCesFilter: string;
  vmCesMetrics: string[];
  setVmCesRange: (v: number) => void;
  setVmCesPeriod: (v: number) => void;
  setVmCesFilter: (v: string) => void;
  setVmCesMetrics: (v: string[]) => void;
  onOpenDetail: (type: string, title: string, data: any) => void;
  visibleTabs?: string[];
  overviewNode?: React.ReactNode;
};

const EcsDetailHw: React.FC<EcsDetailHwProps> = ({ cloudId, vmDetail, vpcs, subnets, secGroups, eips, vmEnis, vmPorts, disks, snapshots, tabKey, onChangeTab, onRefreshAll, onCloseModal, onOpenEipManage, onSetVmPorts, onSetEips, onSetVmDetail, onRefreshMonitor, vmCes, vmCesAvailable, vmMonitorError, vmCesError, vmCesRange, vmCesPeriod, vmCesFilter, vmCesMetrics, setVmCesRange, setVmCesPeriod, setVmCesFilter, setVmCesMetrics, onOpenDetail, visibleTabs, overviewNode }) => {
  const { message } = App.useApp();
  const vmCesAvail: string[] = Array.isArray(vmCesAvailable) ? vmCesAvailable : [];
  const vmCesMetricsSafe: string[] = Array.isArray(vmCesMetrics) ? vmCesMetrics : [];
  const [vmAuditTraces, setVmAuditTraces] = React.useState<any[]>([]);
  const [vmAuditStart, setVmAuditStart] = React.useState<number | null>(null);
  const [vmAuditEnd, setVmAuditEnd] = React.useState<number | null>(null);
  const [vmAuditTraceName, setVmAuditTraceName] = React.useState<string>('');
  const [vmAuditLimit, setVmAuditLimit] = React.useState<number>(50);
  const [secAddSel, setSecAddSel] = React.useState<Record<string, string>>({});
  const [secSetOpen, setSecSetOpen] = React.useState<boolean>(false);
  const [secSetSel, setSecSetSel] = React.useState<string[]>([]);
  const [secSetPortId, setSecSetPortId] = React.useState<string>('');
  const [sgStats, setSgStats] = React.useState<Record<string, { ingress: number; egress: number }>>({});
  const [ruleOpen, setRuleOpen] = React.useState<boolean>(false);
  const [ruleTarget, setRuleTarget] = React.useState<any | null>(null);

  const secPorts: any[] = Array.isArray(vmPorts) ? vmPorts : [];
  const secPortChoices = React.useMemo(() => secPorts.map((p: any) => ({ label: p?.name || p?.id, value: p?.id })).filter((x: any) => !!x.value), [JSON.stringify(secPorts)]);
  React.useEffect(() => {
    (async () => {
      const set = new Set<string>();
      for (const p of (secPorts || [])) {
        const arr: string[] = Array.isArray(p?.security_groups) ? p.security_groups : [];
        for (const gid of arr) set.add(String(gid));
      }
      const map: Record<string, { ingress: number; egress: number }> = {};
      for (const gid of Array.from(set)) {
        try {
          const resp: any = await showCloudProviderSecurityGroup(cloudId, String(gid));
          const data0: any = resp?.data || resp;
          const g: any = data0?.security_group || data0?.securityGroup || data0?.securitygroup || data0;
          const rules: any[] = Array.isArray(g?.security_group_rules) ? g.security_group_rules : [];
          const ingress = rules.filter((r: any) => String(r?.direction || '').toLowerCase() === 'ingress').length;
          const egress = rules.filter((r: any) => String(r?.direction || '').toLowerCase() === 'egress').length;
          map[String(gid)] = { ingress, egress };
        } catch {}
      }
      setSgStats(map);
      if (!secSetPortId && secPorts.length) { setSecSetPortId(String(secPorts[0]?.id || '')); }
    })();
  }, [cloudId, JSON.stringify(secPorts.map((p: any) => p?.security_groups)), secSetPortId]);

  const st = String(vmDetail?.status || vmDetail?.Status || '').trim().toUpperCase();
  const isRunning = st === 'RUNNING' || st === 'ACTIVE' || st === 'ONLINE';
  const isStopped = st === 'SHUTOFF' || st === 'STOPPED' || st === 'OFFLINE' || st === 'DOWN';
  const isBusy = st === 'PENDING_CREATE' || st === 'CREATING' || st === 'BUILDING' || st === 'PROVISIONING' || st === 'PENDING_DELETE' || st === 'DELETING' || st === 'REBOOTING';

  const backupColumns = [
    { title: '快照名称', dataIndex: 'name', key: 'name' },
    { title: '快照ID', dataIndex: 'id', key: 'id' },
    { title: '源磁盘', dataIndex: 'volume_id', key: 'volume_id' },
    { title: '状态', dataIndex: 'status', key: 'status', render: (s: string) => statusTag(s) },
  ] as any;

  return (
    <>
      <div style={{ marginBottom: 12 }}>
        {overviewNode || (
          <Descriptions bordered column={2} size="small" style={{ width: '100%' }}>
            <Descriptions.Item label="实例ID">{vmDetail?.id || vmDetail?.InstanceId || '-'}</Descriptions.Item>
            <Descriptions.Item label="实例名">{vmDetail?.name || vmDetail?.InstanceName || '-'}</Descriptions.Item>
            <Descriptions.Item label="状态">
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                {statusTag(vmDetail?.status || vmDetail?.Status)}
                <Space size={4}>
                  <Button shape="round" size="small" style={{ fontSize: 12, height: 24, paddingInline: 8 }} disabled={isRunning || isBusy} icon={<PlayCircleOutlined style={{ fontSize: 12, color: '#1890ff' }} />} onClick={async () => { const iid = vmDetail?.id || vmDetail?.InstanceId; if (!iid) return; try { await startCloudProviderEcs(cloudId, iid); message.success('启动指令已下发'); await onRefreshAll(); } catch (e: any) { message.error(e?.message || '启动失败'); } }}>启动</Button>
                  <Button shape="round" size="small" style={{ fontSize: 12, height: 24, paddingInline: 8 }} disabled={isStopped || isBusy} icon={<PoweroffOutlined style={{ fontSize: 12, color: '#f5222d' }} />} onClick={async () => { const iid = vmDetail?.id || vmDetail?.InstanceId; if (!iid) return; try { await stopCloudProviderEcs(cloudId, iid, false); message.success('停止指令已下发'); await onRefreshAll(); } catch (e: any) { message.error(e?.message || '停止失败'); } }}>停止</Button>
                  <Button shape="round" size="small" style={{ fontSize: 12, height: 24, paddingInline: 8 }} disabled={!isRunning || isBusy} icon={<ReloadOutlined style={{ fontSize: 12, color: '#1890ff' }} />} onClick={async () => { const iid = vmDetail?.id || vmDetail?.InstanceId; if (!iid) return; try { await rebootCloudProviderEcs(cloudId, iid, false); message.success('重启指令已下发'); await onRefreshAll(); } catch (e: any) { message.error(e?.message || '重启失败'); } }}>重启</Button>
                  <Button shape="round" size="small" style={{ fontSize: 12, height: 24, paddingInline: 8 }} icon={<DesktopOutlined style={{ fontSize: 12, color: '#1890ff' }} />} onClick={async () => { const iid = vmDetail?.id || vmDetail?.InstanceId; if (!iid) return; try { const json = await fetchCloudProviderEcsVncUrl(cloudId, iid); const url = json?.data?.VncUrl || json?.data?.vncUrl; if (url) { const w = Math.max(1280, (window.screen?.availWidth || 1600) - 40); const h = Math.max(800, (window.screen?.availHeight || 900) - 80); const features = `width=${w},height=${h},top=0,left=0,menubar=no,toolbar=no,location=no,status=no,scrollbars=yes,resizable=yes`; window.open(url, 'webvnc', features); } else { message.warning('未获取到VNC地址'); } } catch (e: any) { message.error(e?.message || '获取VNC地址失败'); } }}>VNC</Button>
                  <Button shape="round" size="small" style={{ fontSize: 12, height: 24, paddingInline: 8 }} danger disabled={isBusy} icon={<DeleteOutlined style={{ fontSize: 12, color: '#f5222d' }} />} onClick={() => { const iid = vmDetail?.id || vmDetail?.InstanceId; if (!iid) return; Modal.confirm({ title: '确认删除该实例？', onOk: async () => { try { await deleteCloudProviderEcs(cloudId, iid); message.success('删除成功'); onCloseModal(); await onRefreshAll(); } catch (e: any) { message.error(e?.message || '删除失败'); } } }); }}>删除</Button>
                </Space>
              </div>
            </Descriptions.Item>
            <Descriptions.Item label="规格">{(() => { const f = vmDetail?.flavor || {}; const id = f?.id || vmDetail?.InstanceType || '-'; const v = (parseInt(String(f?.vcpus ?? vmDetail?.vcpus ?? 0)) || 0); const r = (parseInt(String(f?.ram ?? vmDetail?.ram ?? 0)) || 0); const mem = r ? `${Math.round(r / 1024)}GB` : ''; return [id, v ? `${v}vCPU` : '', mem].filter(Boolean).join(' / '); })()}</Descriptions.Item>
            <Descriptions.Item label="可用区">{vmDetail?.['OS-EXT-AZ:availability_zone'] || vmDetail?.availability_zone || vmDetail?.zoneId || vmDetail?.ZoneId || '-'}</Descriptions.Item>
            <Descriptions.Item label="VPC">{(() => { const nic = Array.isArray(vmEnis) && vmEnis.length ? vmEnis[0] : null; const vid = nic?.VpcId || vmDetail?.metadata?.vpc_id || vmDetail?.vpc_id || vmDetail?.VpcId || ''; const vn = (vpcs || []).find((v: any) => String(v?.id || v?.VpcId || '') === String(vid || '')); return vn?.name || vid || '-'; })()}</Descriptions.Item>
            <Descriptions.Item label="子网">{(() => { const sids: string[] = Array.isArray(vmDetail?.network_interfaces) ? vmDetail!.network_interfaces.map((ni: any) => ni?.subnet_id).filter(Boolean) : []; const names = sids.map(sid => { const sn = (subnets || []).find((s: any) => String(s?.id || s?.SubnetId || '') === String(sid || '')); return sn?.name || sid; }); return names.length ? names.join('；') : '-'; })()}</Descriptions.Item>
            <Descriptions.Item label="私网IP">{(() => { const { fixed } = collectIpv4FromAddresses(vmDetail?.addresses); return fixed.length ? fixed.join(', ') : '-'; })()}</Descriptions.Item>
            <Descriptions.Item label="公网IP">{(() => { const { floating } = collectIpv4FromAddresses(vmDetail?.addresses); const assoc = Array.isArray(vmDetail?.network_interfaces) ? vmDetail!.network_interfaces.map((ni: any) => ni?.association?.public_ip_address).filter(Boolean) : []; const ips = [...floating, ...assoc]; return ips.length ? ips.join(', ') : '-'; })()}</Descriptions.Item>
            <Descriptions.Item label="镜像">{(() => { const nm = vmDetail?.metadata?.image_name || vmDetail?.image?.id || '-'; const osRaw = String(vmDetail?.metadata?.os_type || vmDetail?.OSName || vmDetail?.OSType || '').toLowerCase(); const isWin = osRaw.includes('win'); const icon = isWin ? <WindowsOutlined style={{ color: '#1677ff', marginRight: 6 }} /> : <CodeOutlined style={{ color: '#1677ff', marginRight: 6 }} />; return (<span>{icon}{nm}</span>); })()}</Descriptions.Item>
            <Descriptions.Item label="安全组">{(() => { const sgs: any[] = Array.isArray(vmDetail?.security_groups) ? vmDetail!.security_groups : []; const names = sgs.map((g: any) => g?.name || g?.id).filter(Boolean); return names.length ? names.join('；') : '-'; })()}</Descriptions.Item>
            <Descriptions.Item label="标签" span={2}>{(() => { const tags: any[] = Array.isArray(vmDetail?.tags) ? vmDetail!.tags : []; const values = tags.map((t: any) => (typeof t === 'string' ? t : (t?.value ?? t?.Value ?? t?.key ?? t?.Key))).filter(Boolean); return values.length ? values.join('；') : '-'; })()}</Descriptions.Item>
            <Descriptions.Item label="创建时间">{vmDetail?.created || vmDetail?.create_time || vmDetail?.CreationTime || '-'}</Descriptions.Item>
            <Descriptions.Item label="更新时间">{vmDetail?.updated || vmDetail?.update_time || vmDetail?.Updated || '-'}</Descriptions.Item>
          </Descriptions>
        )}
      </div>

      <Tabs
        activeKey={tabKey}
        onChange={(k) => { onChangeTab(String(k)); }}
        tabBarExtraContent={tabKey === 'network' ? (
          <Button icon={<ReloadOutlined />} onClick={async () => {
            try {
              const iid = String(vmDetail?.id || vmDetail?.InstanceId || '');
              const [jsonPorts, eipJson, ecsJson] = await Promise.all([
                fetchHuaweiPorts(cloudId, { deviceId: iid }),
                fetchCloudProviderEips(cloudId).catch(() => null),
                fetchCloudProviderEcs(cloudId).catch(() => null),
              ]);
              const listPorts: any[] = jsonPorts?.data?.ports || jsonPorts?.ports || [];
              onSetVmPorts(Array.isArray(listPorts) ? listPorts : []);
              const eipList: any[] = (eipJson?.data?.publicips) || (eipJson?.publicips) || (eipJson?.data?.publicIps) || (eipJson?.publicIps) || [];
              onSetEips(Array.isArray(eipList) ? eipList : []);
              const ecsList: any[] = (ecsJson?.data?.servers) || (ecsJson?.servers) || [];
              if (iid && Array.isArray(ecsList)) {
                const latest = ecsList.find((r: any) => String(r?.id || r?.InstanceId || '') === iid);
                if (latest) onSetVmDetail(latest);
              }
              message.success('实例详情与网卡/EIP已刷新');
            } catch (e: any) {
              message.error(e?.message || '刷新失败');
            }
          }} />
        ) : null}
        items={(function(){
          const arr = [
          {
            key: 'network',
            label: (<span><NodeIndexOutlined style={{ marginRight: 6 }} />弹性网卡</span>),
            children: (
              <div>
                {(() => {
                  const list: any[] = (Array.isArray(vmEnis) && vmEnis.length) ? vmEnis : (Array.isArray(vmDetail?.network_interfaces) ? vmDetail!.network_interfaces : []);
                  const addrsRaw = vmDetail?.addresses;
                  const addrItems: any[] = Array.isArray(addrsRaw) ? addrsRaw : Object.values(addrsRaw || {}).reduce((acc: any[], v: any) => acc.concat(Array.isArray(v) ? v : [v]), []);
                  const findMacForPort = (pid: string) => { const it = addrItems.find((a: any) => String(a?.['OS-EXT-IPS:port_id'] || '') === String(pid || '')); return it?.['OS-EXT-IPS-MAC:mac_addr'] || it?.mac || '-'; };
                  const rows = list.map((ni: any) => {
                    const portId = ni?.PortId || ni?.port_id || ni?.NetworkInterfaceId || ni?.id || '';
                    const pri = (() => { const arr1 = Array.isArray(ni?.PrivateIpAddress?.IpAddress) ? ni.PrivateIpAddress.IpAddress : (Array.isArray(ni?.fixed_ips) ? ni.fixed_ips.map((x: any) => x?.ip_address).filter(Boolean) : (Array.isArray(ni?.ip_addresses) ? ni.ip_addresses : [])); if (arr1 && arr1.length) return arr1; const p = (vmPorts || []).find((x: any) => String(x?.id || '') === String(portId || '')); const ips = Array.isArray(p?.fixed_ips) ? p.fixed_ips.map((x: any) => x?.ip_address).filter(Boolean) : []; return ips; })();
                    const pub = (() => { const pid = portId; const list2: any[] = Array.isArray(eips) ? eips : []; return list2.filter((e: any) => String(e?.port_id || '') === String(pid || '')).map((e: any) => e?.public_ip_address || e?.publicip_address || e?.ip_address).filter(Boolean); })();
                    const nicName = (() => { const p = (vmPorts || []).find((x: any) => String(x?.id || '') === String(portId || '')); const nm = p?.name || ni?.NetworkInterfaceName || ni?.name; if (nm) return nm; const sid0 = ni?.VSwitchId || ni?.SubnetId || ni?.subnet_id || ''; const sn = (subnets || []).find((s: any) => String(s?.id || s?.SubnetId || '') === String(sid0 || '')); return sn?.name || ((ni?.primary === true) ? '主网卡' : '辅助网卡'); })();
                    const subnetId = (() => { const s0 = ni?.VSwitchId || ni?.SubnetId || ni?.subnet_id || ''; if (s0) return s0; const p = (vmPorts || []).find((x: any) => String(x?.id || '') === String(portId || '')); const sid = Array.isArray(p?.fixed_ips) ? (p.fixed_ips[0]?.subnet_id || '') : ''; return sid; })();
                    const vpcId = ni?.VpcId || (() => { const sn = (subnets || []).find((s: any) => String(s?.id || s?.SubnetId || '') === String(subnetId || '')); return sn?.vpc_id || sn?.VpcId || ''; })();
                    const sgs = (() => { const p = (vmPorts || []).find((x: any) => String(x?.id || '') === String(portId || '')); const ids: string[] = Array.isArray(p?.security_groups) ? p.security_groups : []; return ids.map((gid: string) => { const g = (secGroups || []).find((x: any) => String(x?.id || x?.SecurityGroupId || '') === String(gid || '')); return g?.name || gid; }).filter(Boolean); })();
                    const statusText = ni?.Status || ni?.status || '-';
                    const mac = findMacForPort(portId);
                    const portSecOn = (() => { const p = (vmPorts || []).find((x: any) => String(x?.id || '') === String(portId || '')); return !!p?.port_security_enabled; })();
                    const subnetName = (() => { if (!subnetId) return '-'; const sn = (subnets || []).find((s: any) => String(s?.id || s?.SubnetId || '') === String(subnetId || '')); const nm = sn?.name || subnetId; const cidr = sn?.cidr || sn?.CidrBlock || ''; return cidr ? `${nm} (${cidr})` : nm; })();
                    const vpcName = (() => { const v = (vpcs || []).find((x: any) => String(x?.id || x?.VpcId || '') === String(vpcId || '')); return v?.name || vpcId || '-'; })();
                    return { portId, nicName, pri, pub, mac, vpcName, subnetName, sgs, statusText, portSecOn };
                  });
                  return (
                    <Table
                      size="small"
                      rowKey={(r: any) => r.portId || r.nicName}
                      pagination={false}
                      dataSource={rows}
                      columns={[
                        { title: '网卡名称', dataIndex: 'nicName', key: 'name' },
                        { title: '网卡ID', dataIndex: 'portId', key: 'id', render: (id: string) => (id ? (<Button type="link" size="small" onClick={async ()=>{ try { await navigator.clipboard.writeText(String(id||'')); message.success('已复制网卡ID'); } catch(e:any){ message.error(e?.message || '复制失败'); } }}>{id}</Button>) : '-') },
                        { title: '私有IP地址', dataIndex: 'pri', key: 'pri', render: (arr: string[]) => (arr && arr.length ? arr.join(', ') : '-') },
                        { title: '弹性公网IP', dataIndex: 'pub', key: 'pub', render: (arr: string[]) => (arr && arr.length ? arr.join(', ') : '-') },
                        { title: 'MAC地址', dataIndex: 'mac', key: 'mac' },
                        { title: 'VPC网络', dataIndex: 'vpcName', key: 'vpc', render: (v: string) => (<EllipsisText value={v} />) },
                        { title: '子网信息', dataIndex: 'subnetName', key: 'subnet' },
                        { title: '安全组', dataIndex: 'sgs', key: 'sgs', render: (arr: string[]) => (arr && arr.length ? arr.join('；') : '-') },
                        { title: '源/目的检查', dataIndex: 'portSecOn', key: 'sec', render: (on: boolean) => (on ? '启用' : '禁用') },
                        { title: '状态', dataIndex: 'statusText', key: 'status', render: (s: string) => statusTag(s) },
                        { title: '操作', key: 'actions', render: (_: any, r: any) => (
                          <Space size={4}>
                            <Button type="link" size="small" icon={<SafetyCertificateOutlined />} onClick={async () => { try { await updateHuaweiPortSourceDestCheck(cloudId, String(r.portId || ''), { enabled: !r.portSecOn }); const jsonPorts: any = await fetchHuaweiPorts(cloudId, { deviceId: String(vmDetail?.id || vmDetail?.InstanceId || '') }); const listPorts: any[] = jsonPorts?.data?.ports || jsonPorts?.ports || []; onSetVmPorts(Array.isArray(listPorts) ? listPorts : []); message.success(`安全检查已${r.portSecOn ? '禁用' : '启用'}`); } catch (e: any) { message.error(e?.message || '变更失败'); } }}>变更安全检查</Button>
                            <Button type="link" size="small" icon={<GlobalOutlined />} onClick={() => { onOpenEipManage(String(r.portId || '')); }}>变更EIP</Button>
                          </Space>
                        ) },
                      ] as any}
                    />
                  );
                })()}
              </div>
            )
          },
          {
            key: 'disks',
            label: (<span><HddOutlined style={{ marginRight: 6 }} />云硬盘</span>),
            children: (
              <div>
                {(() => {
                  const vid = vmDetail?.id || vmDetail?.InstanceId || '';
                  const list:any[] = Array.isArray(disks) ? disks : [];
                  const myDisks = list.filter((d:any)=> { const atts:any[] = Array.isArray(d?.attachments) ? d.attachments : []; return atts.some((a:any)=> String(a?.server_id||a?.instance_id||'')===String(vid||'')); });
                  return (
                    <Table
                      size="small"
                      rowKey={(d:any)=> d?.id || d?.Name || ''}
                      pagination={false}
                      dataSource={myDisks}
                      columns={[
                        { title: '名称', dataIndex: 'name', key: 'name', render: (t:any, r:any)=> (r?.name || r?.Name || '-') },
                        { title: 'ID', dataIndex: 'id', key: 'id', render: (id:any)=> (<Button type="link" size="small" onClick={async ()=>{ try { await navigator.clipboard.writeText(String(id||'')); message.success('已复制云盘ID'); } catch(e:any){ message.error(e?.message || '复制失败'); } }}><EllipsisText value={id} /></Button>) },
                        { title: '容量', key: 'size', render: (_:any, r:any)=> (r?.size!=null ? `${r.size}GB` : (r?.Size!=null ? `${r.Size}GB` : '-')) },
                        { title: '类型', key: 'type', render: (_:any, r:any)=> (r?.volume_type || r?.VolumeType || '-') },
                        { title: '挂载点', key: 'device', render: (_:any, r:any)=> { const atts:any[] = Array.isArray(r?.attachments) ? r.attachments : []; const att = atts.find((a:any)=> String(a?.server_id||a?.instance_id||'')===String(vid||'')); return att?.device || att?.Device || '-'; } },
                        { title: '状态', dataIndex: 'status', key: 'status', render: (s:string)=> statusTag(s || (s as any)) },
                        { title: '可启动', key: 'bootable', render: (_:any, r:any)=> ((r?.bootable===true || String(r?.bootable||'').toLowerCase()==='true') ? '是' : '否') },
                        { title: '创建时间', key: 'created_at', render: (_:any, r:any)=> (r?.created_at || r?.CreationTime || '-') },
                      ] as any}
                    />
                  );
                })()}
              </div>
            )
          },
          {
            key: 'secgroups',
            label: (<span><SafetyCertificateOutlined style={{ marginRight: 6 }} />安全组</span>),
            children: (
              <div>
                {(() => {
                  const rows = secPorts.flatMap((p: any) => {
                    const pid = p?.id || '';
                    const arr: string[] = Array.isArray(p?.security_groups) ? p.security_groups : [];
                    return arr.map((gid: string) => {
                      const g = (secGroups || []).find((x: any) => String(x?.id || x?.SecurityGroupId || '') === String(gid || ''));
                      const nm = g?.name || g?.SecurityGroupName || gid;
                      const st = sgStats[String(gid)] || { ingress: 0, egress: 0 };
                      return { id: gid, name: nm, ingress: st.ingress, egress: st.egress, portId: pid };
                    });
                  });
                  return (
                    <div>
                      <Table
                        size="small"
                        rowKey={(r: any) => `${r.portId}-${r.id}`}
                        columns={[
                          { title: '安全组名称', dataIndex: 'name', key: 'name' },
                          { title: '安全组规则数量', key: 'count', render: (_: any, r: any) => (r.ingress + r.egress) },
                          { title: '规则统计', key: 'stat', render: (_: any, r: any) => (<Button type="link" onClick={async () => { try { const resp: any = await showCloudProviderSecurityGroup(cloudId, String(r.id)); const data0: any = resp?.data || resp; const g: any = data0?.security_group || data0?.securityGroup || data0?.securitygroup || data0; setRuleTarget(g); setRuleOpen(true); } catch (e: any) { message.error(e?.message || '加载失败'); } }}>入站: {r.ingress} 条；出站: {r.egress} 条</Button>) },
                          { title: '作用网卡', key: 'port', render: (_: any, r: any) => { const p = secPorts.find((x: any) => String(x?.id || '') === String(r.portId || '')); return p?.name || r.portId || '-'; } },
                          { title: '操作', key: 'op', render: (_: any, r: any) => (<Button type="link" danger onClick={async () => { try { await removeHuaweiPortSecurityGroup(cloudId, String(r.portId || ''), String(r.id || '')); const jsonPorts: any = await fetchHuaweiPorts(cloudId, { deviceId: String(vmDetail?.id || vmDetail?.InstanceId || '') }); const listPorts: any[] = jsonPorts?.data?.ports || jsonPorts?.ports || []; onSetVmPorts(Array.isArray(listPorts) ? listPorts : []); message.success('已移除'); } catch (e: any) { message.error(e?.message || '移除失败'); } }}>移除</Button>) },
                        ] as any}
                        dataSource={rows}
                        pagination={false}
                      />
                      <div style={{ marginTop: 12, display: 'flex', justifyContent: 'flex-start' }}>
                        <Space>
                          <Select placeholder="选择网卡" value={secSetPortId || undefined} onChange={(v) => setSecSetPortId(String(v || ''))} options={secPortChoices} showSearch style={{ width: 220 }} />
                          <Select
                            mode="multiple"
                            allowClear
                            showSearch
                            placeholder="选择安全组"
                            value={secSetSel}
                            onChange={(v) => setSecSetSel((Array.isArray(v) ? v.map(String) : []))}
                            style={{ width: 220 }}
                            options={(secGroups || []).map((g: any) => ({ label: g?.name || g?.SecurityGroupName || g?.id || g?.SecurityGroupId, value: g?.id || g?.SecurityGroupId }))}
                          />
                          <Button type="primary" onClick={async () => { try { if (!secSetPortId) { message.warning('请选择网卡'); return; } await setHuaweiPortSecurityGroups(cloudId, String(secSetPortId || ''), secSetSel.map(String)); const jsonPorts: any = await fetchHuaweiPorts(cloudId, { deviceId: String(vmDetail?.id || vmDetail?.InstanceId || '') }); const listPorts: any[] = jsonPorts?.data?.ports || jsonPorts?.ports || []; onSetVmPorts(Array.isArray(listPorts) ? listPorts : []); message.success('已更新安全组'); } catch (e: any) { message.error(e?.message || '更新失败'); } }}>变更</Button>
                        </Space>
                      </div>
                      <SecurityGroupRuleManageDrawer open={ruleOpen} cloudId={cloudId} secGroups={secGroups} target={ruleTarget} onClose={() => { setRuleOpen(false); setRuleTarget(null); }} onUpdated={(group: any) => { setRuleTarget(group); setSgStats((prev) => { const ing = Array.isArray(group?.security_group_rules) ? group.security_group_rules.filter((r: any) => String(r?.direction || '').toLowerCase() === 'ingress').length : 0; const eg = Array.isArray(group?.security_group_rules) ? group.security_group_rules.filter((r: any) => String(r?.direction || '').toLowerCase() === 'egress').length : 0; const id = String(group?.id || group?.SecurityGroupId || ''); const next = { ...prev }; if (id) next[id] = { ingress: ing, egress: eg }; return next; }); }} />
                    </div>
                  );
                })()}
              </div>
            )
          },
          {
            key: 'eips',
            label: (<span><GlobalOutlined style={{ marginRight: 6 }} />弹性公网IP</span>),
            children: (
              <div>
                {(() => {
                  const iid = vmDetail?.id || vmDetail?.InstanceId || '';
                  const ports:string[] = Array.isArray(vmDetail?.network_interfaces)? vmDetail!.network_interfaces.map((ni:any)=> ni?.port_id).filter(Boolean) : [];
                  const list:any[] = Array.isArray(eips)? eips : [];
                  const myEips = list.filter((r:any)=> { const ai=r?.associate_instance||{}; const rid=ai?.id||ai?.instance_id||''; const ridMatch = rid && (rid===iid || ports.includes(rid)); const portMatch = ports.includes(r?.port_id); return ridMatch || portMatch; });
                  const rows = myEips.map((r:any)=> {
                    const ip = r?.public_ip_address || r?.publicip_address || r?.ip_address || '-';
                    const id = r?.id || r?.publicip_id || '-';
                    const bw = r?.bandwidth; const name = (typeof bw==='object' ? bw?.name : r?.bandwidth_name) || '-'; const size = (typeof bw==='object' ? bw?.size : r?.bandwidth_size); const share = (typeof bw==='object' ? bw?.share_type : r?.share_type); const st = String(share||'').toUpperCase()==='PER' ? '独享' : (share ? '共享' : ''); const sizeTxt = (size!=null && size!=='') ? `${size}Mbps` : '-'; const bwText = `${name}（${sizeTxt}${st?` / ${st}`:''}）`;
                    const ai=r?.associate_instance; let assocText = '-'; if (ai && typeof ai==='object') { const tp=String(ai?.type||'').toLowerCase(); const map:any={ port:'网卡', eni:'网卡', elb:'负载均衡', nat:'NAT网关' }; const label = map[tp] || (ai?.type || '资源'); assocText = ai?.id ? `${label} ${ai?.id}` : label; } else if (r?.port_id) { assocText = `网卡 ${r?.port_id}`; }
                    const statusText = r?.status || '-';
                    return { ip, id, bwText, assocText, statusText, raw: r };
                  });
                  return (
                    <Table
                      size="small"
                      rowKey={(r:any)=> r.id || r.ip}
                      pagination={false}
                      dataSource={rows}
                      columns={[
                        { title: '公网IP', dataIndex: 'ip', key: 'ip' },
                        { title: 'ID', dataIndex: 'id', key: 'id', render: (id:string)=> (<Button type="link" size="small" onClick={async ()=>{ try { await navigator.clipboard.writeText(String(id||'')); message.success('已复制EIP ID'); } catch(e:any){ message.error(e?.message || '复制失败'); } }}>{id}</Button>) },
                        { title: '带宽', dataIndex: 'bwText', key: 'bw' },
                        { title: '绑定资源', dataIndex: 'assocText', key: 'assoc' },
                        { title: '状态', dataIndex: 'statusText', key: 'status', render: (s:string)=> statusTag(s) },
                        { title: '操作', key: 'actions', render: (_:any, r:any)=> (<Button type="link" size="small" danger onClick={async ()=>{ try { const eid = String(r?.id || ''); if (!eid) return; await unbindHuaweiEip(cloudId, eid); const eipJson = await fetchCloudProviderEips(cloudId); const eipList: any[] = (eipJson?.data?.publicips) || (eipJson?.publicips) || (eipJson?.data?.publicIps) || (eipJson?.publicIps) || []; onSetEips(Array.isArray(eipList) ? eipList : []); const jsonPorts: any = await fetchHuaweiPorts(cloudId, { deviceId: String(vmDetail?.id || vmDetail?.InstanceId || '') }); const listPorts: any[] = jsonPorts?.data?.ports || jsonPorts?.ports || []; onSetVmPorts(Array.isArray(listPorts) ? listPorts : []); message.success('解绑成功'); } catch(e:any){ message.error(e?.message || '解绑失败'); } }}>解绑</Button>) },
                      ] as any}
                    />
                  );
                })()}
              </div>
            )
          },
          {
            key: 'monitor',
            label: (<span><LineChartOutlined style={{ marginRight: 6 }} />监控</span>),
            children: (
              <div>
                <Space style={{ marginBottom: 8 }}>
                  <Select size="small" value={vmCesRange} style={{ width: 140 }} options={[{ label:'近1小时', value: 60*60*1000 }, { label:'近6小时', value: 6*60*60*1000 }, { label:'近24小时', value: 24*60*60*1000 }]} onChange={(v)=> setVmCesRange(Number(v))} />
                  <Select size="small" value={vmCesPeriod} style={{ width: 140 }} options={[{ label:'1分钟', value: 1 }, { label:'5分钟', value: 300 }]} onChange={(v)=> setVmCesPeriod(Number(v))} />
                  <Select size="small" value={vmCesFilter} style={{ width: 120 }} options={[{ label:'平均值', value:'average' }, { label:'最大值', value:'max' }, { label:'最小值', value:'min' }]} onChange={(v)=> setVmCesFilter(String(v))} />
                  <Select size="small" mode="multiple" maxTagCount={3} value={vmCesMetrics} style={{ width: 360 }} options={[
                    { label:'CPU利用率', value:'cpu_util', disabled: false },
                    { label:'CPU空闲', value:'cpu_usage_idle', disabled: !vmCesAvail.includes('cpu_usage_idle') },
                    { label:'CPU iowait', value:'cpu_usage_iowait', disabled: !vmCesAvail.includes('cpu_usage_iowait') },
                    { label:'CPU用户态', value:'cpu_usage_user', disabled: !vmCesAvail.includes('cpu_usage_user') },
                    { label:'CPU内核态', value:'cpu_usage_system', disabled: !vmCesAvail.includes('cpu_usage_system') },
                    { label:'CPU其他', value:'cpu_usage_other', disabled: !vmCesAvail.includes('cpu_usage_other') },
                    { label:'内存可用(GB)', value:'mem_available', disabled: !vmCesAvail.includes('mem_available') },
                    { label:'内存使用率(Agent)', value:'mem_usedPercent', disabled: !vmCesAvail.includes('mem_usedPercent') },
                    { label:'内存使用率(基础)', value:'mem_util', disabled: !vmCesAvail.includes('mem_util') }
                  ]} onChange={(v)=> setVmCesMetrics(v as any)} />
                  <Button size="small" icon={<ReloadOutlined />} onClick={async ()=>{ await onRefreshMonitor(); }}>刷新</Button>
                </Space>
                <div style={{ marginTop: 12 }}>
                  {(vmMonitorError || vmCesError) ? (
                    <Alert type="error" showIcon style={{ marginBottom: 8 }} message={(vmMonitorError || vmCesError)} action={<Button size="small" onClick={async ()=>{ await onRefreshMonitor(); }}>重试</Button>} />
                  ) : null}
                  <Row gutter={[12,12]}>
                    {(() => {
                      const raw = vmCes;
                      const arr: any[] = (raw?.metrics || raw?.data?.metrics || raw?.data || raw) as any[];
                      const itemsSrc = Array.isArray(arr)
                        ? arr
                        : ((raw?.datapoints || raw?.data?.datapoints)
                            ? [{ metric_name: (raw?.metric_name || raw?.data?.metric_name || '-'), datapoints: (raw?.datapoints || raw?.data?.datapoints) }]
                            : []);
                      const byName = new Map<string, any>();
                      for (const it of (itemsSrc || [])) {
                        const name = it?.metric_name || it?.metric?.metricName || '';
                        if (name) byName.set(String(name), it);
                      }
                      const want = Array.from(new Set(['cpu_util', ...vmCesMetricsSafe]));
                      const items = want.map((n)=> byName.get(n) || { metric_name: n, datapoints: [] });
                      const charts = items.map((item: any, idx: number) => {
                        const name = item?.metric_name || item?.metric?.metricName || '-';
                        const points:any[] = item?.values || item?.datapoints || item?.dataPoints || [];
                        const x = points.map((p:any)=> p?.timestamp || p?.sample_time || p?.time || p?.timeStamp || 0);
                        const y = points.map((p:any)=> { const v = p?.value ?? p?.average ?? p?.max ?? p?.min; return typeof v === 'number' ? v : Number(v || 0); });
                        if (!points.length) {
                          return (
                            <Col span={12} key={`${name}-${idx}`}>
                              <Card size="small" styles={{ body: { padding: 8, display:'flex', alignItems:'center', justifyContent:'center', height: 220 } }}>
                                <span style={{ color:'#999' }}>无数据</span>
                              </Card>
                            </Col>
                          );
                        }
                        const option:any = { grid: { left: 40, right: 20, top: 30, bottom: 30 }, tooltip: { trigger: 'axis' }, xAxis: { type: 'category', data: x.map((t:any)=> { const d = Number(t || 0); return d ? new Date(d).toLocaleTimeString() : ''; }) }, yAxis: { type: 'value', min: 0 }, series: [{ name, type: 'line', data: y, smooth: true }], title: { text: name, left: 'center', textStyle: { fontSize: 12 } } };
                        return (<Col span={12} key={`${name}-${idx}`}><Card size="small" styles={{ body: { padding: 8 } }}><ReactECharts option={option} notMerge style={{ height: 220 }} /></Card></Col>);
                      });
                      return charts.length ? charts : [<Col span={24} key="empty"><Alert type="info" message="无CES指标数据" /></Col>];
                    })()}
                  </Row>
                </div>
              </div>
            )
          },
          {
            key: 'audit',
            label: (<span><AuditOutlined style={{ marginRight: 6 }} />审计日志</span>),
            children: (
              <div>
                <Space style={{ marginBottom: 8 }}>
                  <DatePicker.RangePicker size="small" showTime onChange={(vals)=>{ try { const s = vals?.[0]?.valueOf(); const e = vals?.[1]?.valueOf(); setVmAuditStart(s ?? null); setVmAuditEnd(e ?? null); } catch {} }} />
                  <Input size="small" placeholder="事件名关键词" value={vmAuditTraceName} onChange={(e)=> setVmAuditTraceName(e.target.value)} style={{ width: 160 }} />
                  <InputNumber size="small" min={1} max={500} value={vmAuditLimit} onChange={(v)=> setVmAuditLimit(v==null ? 50 : Number(v))} />
                  <Button size="small" icon={<ReloadOutlined />} onClick={async ()=>{ const iid = vmDetail?.id || vmDetail?.InstanceId; if (!iid) return; try { const now = Date.now(); const end = vmAuditEnd ?? now; const start = vmAuditStart ?? (end - 24*60*60*1000); const t = await fetchHuaweiEcsAuditTraces(cloudId, String(iid), { start, end, limit: vmAuditLimit, traceName: vmAuditTraceName }); const traces: any[] = (t?.data?.traces) || (t?.traces) || []; setVmAuditTraces(Array.isArray(traces) ? traces : []); message.success('审计已刷新'); } catch(e:any){ const msg = e?.message || '刷新审计失败'; if (/APIGW\.0101/i.test(String(msg))) { message.error('审计接口未在当前区域发布或未启用，请在华为云控制台启用CTS并选择正确区域/项目'); } else { message.error(msg); } } }}>刷新</Button>
                </Space>
                <div style={{ marginTop: 12 }}>
                  <Table
                    size="small"
                    rowKey={(r:any)=> r?.trace_id || r?.id || `${r?.time || ''}-${r?.operation_id || r?.trace_name || ''}`}
                    pagination={{ pageSize: 10 }}
                    dataSource={vmAuditTraces}
                    columns={[
                      { title: '时间', dataIndex: 'time', key: 'time', render:(v:any)=> v || '-' },
                      { title: '事件', dataIndex: 'trace_name', key: 'trace_name' },
                      { title: '操作', dataIndex: 'operation_id', key: 'operation_id' },
                      { title: '资源类型', dataIndex: 'resource_type', key: 'resource_type' },
                      { title: '资源名', dataIndex: 'resource_name', key: 'resource_name' },
                      { title: '响应码', dataIndex: 'code', key: 'code' },
                      { title: 'IP', dataIndex: 'source_ip', key: 'source_ip' },
                      { title: '跟踪侧', dataIndex: 'trace_type', key: 'trace_type' },
                      { title: '评级', dataIndex: 'trace_rating', key: 'trace_rating' },
                    ] as any}
                  />
                </div>
              </div>
            )
          },
          {
            key: 'backup',
            label: (<span><CloudServerOutlined style={{ marginRight: 6 }} />云备份</span>),
            children: (
              <Table
                size="small"
                rowKey={(r: any) => r.id}
                columns={backupColumns}
                dataSource={(() => { const vid = vmDetail?.id || vmDetail?.InstanceId || ''; const ds: any[] = Array.isArray(disks) ? disks : []; const attached: any[] = ds.filter((d: any) => { const atts: any[] = Array.isArray(d?.attachments) ? d.attachments : []; return atts.some((a: any) => String(a?.server_id || a?.instance_id || '') === String(vid || '')); }); const diskIds = new Set<string>(attached.map((d:any)=> String(d?.id||''))); const snaps: any[] = Array.isArray(snapshots) ? snapshots : []; return snaps.filter((s: any) => diskIds.has(String(s?.volume_id || ''))); })()}
                pagination={false}
              />
            )
          }
        ] as any[];
          const hasNetwork = (vmEnis !== undefined) || (vmPorts !== undefined) || (eips !== undefined) || Array.isArray(vmDetail?.network_interfaces);
          const hasDisks = (disks !== undefined);
          const hasEips = (eips !== undefined);
          const hasSecurity = (secGroups !== undefined) || (vmPorts !== undefined);
          const hasMonitor = (vmCes !== undefined) || (vmCesAvailable !== undefined);
          const hasAudit = true;
          const hasBackup = (snapshots !== undefined);
          const def = new Set<string>();
          if (hasNetwork) def.add('network');
          if (hasDisks) def.add('disks');
          if (hasSecurity) def.add('secgroups');
          if (hasEips) def.add('eips');
          if (hasMonitor) def.add('monitor');
          if (hasAudit) def.add('audit');
          if (hasBackup) def.add('backup');
          const show = Array.isArray(visibleTabs) && visibleTabs.length ? new Set(visibleTabs.map(String)) : def;
          return arr.filter(it => show.has(String((it as any).key)));
        })()}
      />
    </>
  );
};

export default EcsDetailHw;
