import React, { useEffect, useState, useCallback } from 'react';
import { Alert, Modal, Descriptions, Row, Tag, Button } from 'antd';
import { DashboardOutlined, ReloadOutlined } from '@ant-design/icons';
import PageDetailContainer from '../../../../components/PageDetailContainer';
import PageDetailSection from '../../../../components/PageDetailSection';
import { OverviewCard, OverviewMetricCard, overviewTitleIcon } from '../../../../components/overview';
import { useSearchParams } from 'react-router-dom';
import { normalizeAliyunPoolTabParam, type AliyunPoolTabKey } from '../../../../layouts/admin/aliyun/aliyunPoolSidebar';
import EcsSectionAliyun, { Icon as EcsIcon, Label as EcsLabel } from './sections/EcsSectionAliyun';
import VpcSectionAliyun, { Icon as VpcIcon, Label as VpcLabel } from './sections/VpcSectionAliyun';
import VSwitchSectionAliyun, { Icon as VSwitchIcon, Label as VSwitchLabel } from './sections/VSwitchSectionAliyun';
import SecurityGroupSectionAliyun, { Icon as SgIcon, Label as SgLabel } from './sections/SecurityGroupSectionAliyun';
import EipSectionAliyun, { Icon as EipIcon, Label as EipLabel } from './sections/EipSectionAliyun';
import DiskSectionAliyun, { Icon as DiskIcon, Label as DiskLabel } from './sections/DiskSectionAliyun';
import LoadBalancerSectionAliyun, { Icon as SlbIcon, Label as SlbLabel } from './sections/LoadBalancerSectionAliyun';
import NatGatewaySectionAliyun, { Icon as NatIcon, Label as NatLabel } from './sections/NatGatewaySectionAliyun';
import RouteTableSectionAliyun, { Icon as RouteTableIcon, Label as RouteTableLabel } from './sections/RouteTableSectionAliyun';
import SnapshotSectionAliyun, { Icon as SnapshotIcon, Label as SnapshotLabel } from './sections/SnapshotSectionAliyun';
import NetworkAclSectionAliyun, { Icon as AclIcon, Label as AclLabel } from './sections/NetworkAclSectionAliyun';
import ImagesSectionAliyun, { Icon as ImageIcon, Label as ImageLabel } from './sections/ImagesSectionAliyun';
import KeyPairsSectionAliyun, { Icon as KeyPairIcon, Label as KeyPairLabel } from './sections/KeyPairsSectionAliyun';
import VpnGatewaySectionAliyun, { Icon as VpnIcon, Label as VpnLabel } from './sections/VpnGatewaySectionAliyun';
import RdsSectionAliyun, { Icon as RdsIcon, Label as RdsLabel } from './sections/RdsSectionAliyun';
import MonitorAlarmSectionAliyun, { Icon as MonitorIcon, Label as MonitorLabel } from './sections/MonitorAlarmSectionAliyun';
import { fetchClouds } from '../../../../services/api';
import { fetchCloudProviderVpcs, fetchCloudProviderEcs, fetchCloudProviderSecurityGroups, fetchCloudProviderEips, fetchCloudProviderDisks, fetchCloudProviderLoadBalancers, fetchCloudProviderNatGateways, fetchCloudProviderRouteTables, fetchCloudProviderSnapshots, fetchCloudProviderVSwitches, fetchCloudProviderNetworkAcls, fetchCloudProviderImages, fetchCloudProviderKeyPairs, fetchCloudProviderVpnGateways, fetchCloudProviderRds } from '../../../../services/aliyunApi';
import SecurityGroupDetailModalAliyun from './modals/SecurityGroupDetailModalAliyun';
import RouteTableCreateModalAliyun from './modals/RouteTableCreateModalAliyun';
import RouteTableAssociateModalAliyun from './modals/RouteTableAssociateModalAliyun';
import VpcCreateModalAliyun from './modals/VpcCreateModalAliyun';
import VSwitchCreateModalAliyun from './modals/VSwitchCreateModalAliyun';
import RouteEntryManageDrawerAliyun from './drawers/RouteEntryManageDrawerAliyun';
import RouteEntryCreateDrawerAliyun from './drawers/RouteEntryCreateDrawerAliyun';
import RouteEntryEditDrawerAliyun from './drawers/RouteEntryEditDrawerAliyun';

type CloudDetailAliyunProps = {
  cloudId: string;
};

const CloudDetailAliyun: React.FC<CloudDetailAliyunProps> = ({ cloudId }) => {
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = normalizeAliyunPoolTabParam(searchParams.get('tab'));
  const [error, setError] = useState<string>('');
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [cloud, setCloud] = useState<any>(null);
  const [ecs, setEcs] = useState<any[]>([]);
  const [vpcs, setVpcs] = useState<any[]>([]);
  const [vswitches, setVSwitches] = useState<any[]>([]);
  const [secGroups, setSecGroups] = useState<any[]>([]);
  const [eips, setEips] = useState<any[]>([]);
  const [disks, setDisks] = useState<any[]>([]);
  const [slbs, setSlbs] = useState<any[]>([]);
  const [natGateways, setNatGateways] = useState<any[]>([]);
  const [routeTables, setRouteTables] = useState<any[]>([]);
  const [snapshots, setSnapshots] = useState<any[]>([]);
  const [networkAcls, setNetworkAcls] = useState<any[]>([]);
  const [images, setImages] = useState<any[]>([]);
  const [keyPairs, setKeyPairs] = useState<any[]>([]);
  const [vpnGateways, setVpnGateways] = useState<any[]>([]);
  const [rds, setRds] = useState<any[]>([]);

  const [sgDetailOpen, setSgDetailOpen] = useState<boolean>(false);
  const [sgDetailData, setSgDetailData] = useState<any | null>(null);
  const [sgDetailTab, setSgDetailTab] = useState<string | undefined>(undefined);
  const [showLog] = useState<boolean>(false);
  const [rawEcs, setRawEcs] = useState<any | null>(null);
  const [rawVpcs, setRawVpcs] = useState<any | null>(null);
  const [rawVSwitches, setRawVSwitches] = useState<any | null>(null);
  const [rawSecGroups, setRawSecGroups] = useState<any | null>(null);
  const [rawEips, setRawEips] = useState<any | null>(null);
  const [vpcCreateOpen, setVpcCreateOpen] = useState<boolean>(false);
  const [vswCreateOpen, setVswCreateOpen] = useState<boolean>(false);
  const [rtCreateOpen, setRtCreateOpen] = useState<boolean>(false);
  const [rtAssocOpen, setRtAssocOpen] = useState<boolean>(false);
  const [rtAssocTarget, setRtAssocTarget] = useState<any | null>(null);
  const [reManageOpen, setReManageOpen] = useState<boolean>(false);
  const [reCreateOpen, setReCreateOpen] = useState<boolean>(false);
  const [reEditOpen, setReEditOpen] = useState<boolean>(false);
  const [reEditTarget, setReEditTarget] = useState<any | null>(null);
  const [curRtTarget, setCurRtTarget] = useState<any | null>(null);
  const [curRtEntries, setCurRtEntries] = useState<any[]>([]);

  const loadAll = useCallback(async () => {
    setError('');
    try {
      const cloudsRes = await fetchClouds();
      const cloudList: any[] = Array.isArray(cloudsRes) ? cloudsRes : (Array.isArray(cloudsRes?.data) ? cloudsRes.data : []);
      setCloud((cloudList || []).find((c: any) => String(c.id) === String(cloudId)) || null);

      const [vpcJson, ecsJson, vswJson, sgJson, eipJson, diskJson, slbJson, natJson, rtJson, snapJson, aclJson, imgJson, kpJson, vpnJson, rdsJson] = await Promise.all([
        fetchCloudProviderVpcs(cloudId),
        fetchCloudProviderEcs(cloudId),
        fetchCloudProviderVSwitches(cloudId),
        fetchCloudProviderSecurityGroups(cloudId).catch(() => null),
        fetchCloudProviderEips(cloudId).catch(() => null),
        fetchCloudProviderDisks(cloudId).catch(() => null),
        fetchCloudProviderLoadBalancers(cloudId).catch(() => null),
        fetchCloudProviderNatGateways(cloudId).catch(() => null),
        fetchCloudProviderRouteTables(cloudId).catch(() => null),
        fetchCloudProviderSnapshots(cloudId).catch(() => null),
        fetchCloudProviderNetworkAcls(cloudId).catch(() => null),
        fetchCloudProviderImages(cloudId, { owner: 'self', pageSize: 100 }).catch(() => null),
        fetchCloudProviderKeyPairs(cloudId).catch(() => null),
        fetchCloudProviderVpnGateways(cloudId).catch(() => null),
        fetchCloudProviderRds(cloudId).catch(() => null),
      ]);

      const vpcList: any[] = (vpcJson?.data?.Vpcs?.Vpc) || (vpcJson?.Vpcs?.Vpc) || [];
      const ecsList: any[] = (ecsJson?.data?.Instances?.Instance) || (ecsJson?.Instances?.Instance) || [];
      const vswList: any[] = (vswJson?.data?.VSwitches?.VSwitch) || (vswJson?.VSwitches?.VSwitch) || [];
      const sgList: any[] = (sgJson?.data?.SecurityGroups?.SecurityGroup) || (sgJson?.SecurityGroups?.SecurityGroup) || [];
      const eipList: any[] =
        (eipJson?.data?.EipAddresses?.EipAddress) ||
        (eipJson?.EipAddresses?.EipAddress) ||
        (eipJson?.data?.Eips?.Eip) ||
        (eipJson?.Eips?.Eip) ||
        [];
      const diskList: any[] = (diskJson?.data?.Disks?.Disk) || (diskJson?.disks) || [];
      const slbList: any[] = (slbJson?.LoadBalancers?.LoadBalancer) || (slbJson?.data?.loadbalancers) || (slbJson?.loadbalancers) || [];
      const natList: any[] = (natJson?.NatGateways?.NatGateway) || (natJson?.data?.nat_gateways) || (natJson?.nat_gateways) || [];
      const rtList: any[] =
        (rtJson?.RouteTables?.RouteTable) ||
        (rtJson?.data?.route_tables) ||
        (rtJson?.route_tables) ||
        (rtJson?.data?.routetables) ||
        (rtJson?.routetables) ||
        (Array.isArray(rtJson?.data) ? rtJson?.data : (Array.isArray(rtJson) ? rtJson : []));
      const snapList: any[] = (snapJson?.Snapshots?.Snapshot) || (snapJson?.data?.snapshots) || (snapJson?.snapshots) || [];
      const aclList: any[] = (aclJson?.data?.NetworkAcls?.NetworkAcl) || (aclJson?.NetworkAcls?.NetworkAcl) || [];
      const imgList: any[] = (imgJson?.data?.Images?.Image) || (imgJson?.Images?.Image) || [];
      const kpList: any[] = (kpJson?.data?.KeyPairs?.KeyPair) || (kpJson?.KeyPairs?.KeyPair) || [];
      const vpnList: any[] = (vpnJson?.data?.VpnGateways?.VpnGateway) || (vpnJson?.VpnGateways?.VpnGateway) || [];
      const rdsList: any[] = (rdsJson?.data?.Items?.DBInstance) || (rdsJson?.Items?.DBInstance) || [];

      setVpcs(Array.isArray(vpcList) ? vpcList : []);
      setEcs(Array.isArray(ecsList) ? ecsList : []);
      setVSwitches(Array.isArray(vswList) ? vswList : []);
      setSecGroups(Array.isArray(sgList) ? sgList : []);
      setEips(Array.isArray(eipList) ? eipList : []);
      setDisks(Array.isArray(diskList) ? diskList : []);
      setSlbs(Array.isArray(slbList) ? slbList : []);
      setNatGateways(Array.isArray(natList) ? natList : []);
      setRouteTables(Array.isArray(rtList) ? rtList : []);
      setSnapshots(Array.isArray(snapList) ? snapList : []);
      setNetworkAcls(Array.isArray(aclList) ? aclList : []);
      setImages(Array.isArray(imgList) ? imgList : []);
      setKeyPairs(Array.isArray(kpList) ? kpList : []);
      setVpnGateways(Array.isArray(vpnList) ? vpnList : []);
      setRds(Array.isArray(rdsList) ? rdsList : []);
      setRawVpcs(vpcJson || null);
      setRawEcs(ecsJson || null);
      setRawVSwitches(vswJson || null);
      setRawSecGroups(sgJson || null);
      setRawEips(eipJson || null);
    } catch (e: any) {
      setError(e?.message || '查询阿里云资源失败');
      setVpcs([]); setEcs([]); setVSwitches([]); setSecGroups([]); setEips([]);
      setRawVpcs(null); setRawEcs(null); setRawVSwitches(null); setRawSecGroups(null); setRawEips(null);
    }
  }, [cloudId]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const handleOverviewRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await loadAll();
    } finally {
      setRefreshing(false);
    }
  }, [loadAll]);

  useEffect(() => {
    if (!searchParams.get('tab')) {
      setSearchParams({ tab: 'overview' }, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  const openDetail = useCallback((type: string, title: string, data: any) => {
    Modal.info({
      title,
      content: (<div style={{ maxHeight: 360, overflow: 'auto' }}><pre>{JSON.stringify(data, null, 2)}</pre></div>)
    });
  }, []);

  const aliyunInfoCard = (
    <OverviewCard
      title="资源池信息"
      icon={overviewTitleIcon(<DashboardOutlined />)}
      style={{ marginTop: 16 }}
      bodyStyle={{ padding: '16px 20px' }}
    >
      <Descriptions column={{ xs: 1, sm: 2, lg: 3 }} size="middle">
        <Descriptions.Item label="资源名称">{cloud?.name || '-'}</Descriptions.Item>
        <Descriptions.Item label="资源供应商">阿里云</Descriptions.Item>
        <Descriptions.Item label="资源地域">{cloud?.region || '-'}</Descriptions.Item>
        <Descriptions.Item label="资源类型">{cloud?.type || '-'}</Descriptions.Item>
        <Descriptions.Item label="资源状态">
          {cloud?.status === 'online' ? <Tag color="green">在线</Tag> : cloud?.status === 'maintenance' ? <Tag color="orange">维护</Tag> : cloud?.status === 'offline' ? <Tag color="red">离线</Tag> : <Tag>未知</Tag>}
        </Descriptions.Item>
        <Descriptions.Item label="Endpoint">{cloud?.endpoint || '-'}</Descriptions.Item>
        <Descriptions.Item label="项目ID">{cloud?.config?.projectId || '-'}</Descriptions.Item>
        <Descriptions.Item label="资源ID">{cloud?.id || '-'}</Descriptions.Item>
        <Descriptions.Item label="创建时间">{cloud?.createdAt || '-'}</Descriptions.Item>
        <Descriptions.Item label="更新时间">{cloud?.updatedAt || '-'}</Descriptions.Item>
      </Descriptions>
    </OverviewCard>
  );

  const tabDefs: Array<{ key: AliyunPoolTabKey; label?: React.ReactNode; icon?: React.ReactNode; count?: number; children: React.ReactNode }> = [
        {
          key: 'overview',
          label: '资源总览',
          icon: <DashboardOutlined />,
          children: (
            <PageDetailSection
              asCard={false}
              showHeaderTitle
              icon={<DashboardOutlined />}
              title={cloud?.name || '资源总览'}
              extra={
                <div className="toolbar-actions">
                  <Button icon={<ReloadOutlined />} loading={refreshing} onClick={() => void handleOverviewRefresh()} />
                </div>
              }
            >
              <Row gutter={[16, 16]}>
                <OverviewMetricCard title="云主机数量" icon={overviewTitleIcon(EcsIcon)} value={ecs.length} col={{ xs: 24, sm: 12, lg: 6 }} />
                <OverviewMetricCard title="VPC 数量" icon={overviewTitleIcon(VpcIcon)} value={vpcs.length} col={{ xs: 24, sm: 12, lg: 6 }} />
                <OverviewMetricCard title="交换机数量" icon={overviewTitleIcon(VSwitchIcon)} value={vswitches.length} col={{ xs: 24, sm: 12, lg: 6 }} />
                <OverviewMetricCard title="安全组数量" icon={overviewTitleIcon(SgIcon)} value={secGroups.length} col={{ xs: 24, sm: 12, lg: 6 }} />
                <OverviewMetricCard title="EIP 数量" icon={overviewTitleIcon(EipIcon)} value={eips.length} col={{ xs: 24, sm: 12, lg: 6 }} />
              </Row>
              {aliyunInfoCard}
            </PageDetailSection>
          )
        },
        {
          key: 'ecs',
          label: EcsLabel,
          icon: EcsIcon,
          count: ecs.length,
          children: (
            <EcsSectionAliyun
              cloudId={cloudId}
              ecs={ecs}
              onRefreshAll={loadAll}
              securityGroups={secGroups}
              vswitches={vswitches}
              showLog={showLog}
              raw={rawEcs}
            />
          ),
        },
        {
          key: 'vpc',
          label: VpcLabel,
          icon: VpcIcon,
          count: vpcs.length,
          children: (
            <VpcSectionAliyun
              cloudId={cloudId}
              vpcs={vpcs}
              onSetVpcs={(list)=> setVpcs(list)}
              onOpenDetail={(type, title, data)=> openDetail(type, title, data)}
              onOpenCreate={() => setVpcCreateOpen(true)}
              showLog={showLog}
              raw={rawVpcs}
            />
          ),
        },
        {
          key: 'vswitch',
          label: VSwitchLabel,
          icon: VSwitchIcon,
          count: vswitches.length,
          children: (
            <VSwitchSectionAliyun
              cloudId={cloudId}
              vswitches={vswitches}
              vpcs={vpcs}
              onSetVSwitches={(list)=> setVSwitches(list)}
              onOpenDetail={(type, title, data)=> openDetail(type, title, data)}
              onOpenCreate={() => setVswCreateOpen(true)}
              showLog={showLog}
              raw={rawVSwitches}
            />
          ),
        },
        {
          key: 'secgroup',
          label: SgLabel,
          icon: SgIcon,
          count: secGroups.length,
          children: (
            <SecurityGroupSectionAliyun
              cloudId={cloudId}
              secGroups={secGroups}
              vpcs={vpcs}
              ecs={ecs}
              onSetSecGroups={(list)=> setSecGroups(list)}
              onOpenDetail={(type, title, data, tab) => {
                setSgDetailData(data);
                setSgDetailTab(tab);
                setSgDetailOpen(true);
              }}
              showLog={showLog}
              raw={rawSecGroups}
            />
          ),
        },
        {
          key: 'eip',
          label: EipLabel,
          icon: EipIcon,
          count: eips.length,
          children: (
            <EipSectionAliyun
              cloudId={cloudId}
              eips={eips}
              onSetEips={(list)=> setEips(list)}
              onRefreshAll={loadAll}
              showLog={showLog}
              raw={rawEips}
            />
          ),
        },
        {
          key: 'disks',
          label: DiskLabel,
          icon: DiskIcon,
          count: disks.length,
          children: (
            <DiskSectionAliyun
              cloudId={cloudId}
              instance={undefined}
              disks={disks}
              ecs={ecs}
              onSetDisks={(list) => setDisks(list)}
              onRefreshAll={loadAll}
            />
          ),
        },
        {
          key: 'snapshot',
          label: SnapshotLabel,
          icon: SnapshotIcon,
          count: snapshots.length,
          children: (
            <SnapshotSectionAliyun
              cloudId={cloudId}
              snapshots={snapshots}
              disks={disks}
              onSetSnapshots={(list) => setSnapshots(list)}
              onRefreshAll={loadAll}
            />
          ),
        },
        {
          key: 'images',
          label: ImageLabel,
          icon: ImageIcon,
          count: images.length,
          children: (
            <ImagesSectionAliyun
              cloudId={cloudId}
              images={images}
              ecs={ecs}
              snapshots={snapshots}
              onSetImages={(list) => setImages(list)}
              onRefreshAll={loadAll}
            />
          ),
        },
        {
          key: 'keypairs',
          label: KeyPairLabel,
          icon: KeyPairIcon,
          count: keyPairs.length,
          children: (
            <KeyPairsSectionAliyun
              cloudId={cloudId}
              keyPairs={keyPairs}
              onSetKeyPairs={(list) => setKeyPairs(list)}
              onRefreshAll={loadAll}
            />
          ),
        },
        {
          key: 'slb',
          label: SlbLabel,
          icon: SlbIcon,
          count: slbs.length,
          children: (
            <LoadBalancerSectionAliyun
              cloudId={cloudId}
              slbs={slbs}
              vpcs={vpcs}
              subnets={vswitches}
              ecs={ecs}
              onSetSlbs={(list) => setSlbs(list)}
              onOpenDetail={(type, title, data) => openDetail(type, title, data)}
            />
          ),
        },
        {
          key: 'nat',
          label: NatLabel,
          icon: NatIcon,
          count: natGateways.length,
          children: (
            <NatGatewaySectionAliyun
              cloudId={cloudId}
              natGateways={natGateways}
              eips={eips}
              vpcs={vpcs}
              subnets={vswitches}
              onSetNatGateways={(list) => setNatGateways(list)}
              onOpenDetail={(type, title, data) => openDetail(type, title, data)}
            />
          ),
        },
        {
          key: 'vpn',
          label: VpnLabel,
          icon: VpnIcon,
          count: vpnGateways.length,
          children: (
            <VpnGatewaySectionAliyun
              cloudId={cloudId}
              vpnGateways={vpnGateways}
              vpcs={vpcs}
              vswitches={vswitches}
              onSetVpnGateways={(list) => setVpnGateways(list)}
              onRefreshAll={loadAll}
            />
          ),
        },
        {
          key: 'routetable',
          label: RouteTableLabel,
          icon: RouteTableIcon,
          count: routeTables.length,
          children: (
            <RouteTableSectionAliyun
              cloudId={cloudId}
              routeTables={routeTables}
              vpcs={vpcs}
              subnets={vswitches}
              onSetRouteTables={(list) => setRouteTables(list)}
              onOpenDetail={(type, title, data) => openDetail(type, title, data)}
              onOpenCreate={() => setRtCreateOpen(true)}
              onOpenAssoc={(rt: any) => { setRtAssocTarget(rt); setRtAssocOpen(true); }}
              onManageRoutes={(rt: any) => { setCurRtTarget(rt); setReManageOpen(true); setCurRtEntries([]); }}
              onOpenSubnetsView={(rt: any) => {
                const ids: string[] = Array.isArray(rt?.VSwitchIds?.VSwitchId) ? rt.VSwitchIds.VSwitchId : [];
                const names = ids.map(id => (vswitches || []).find((s:any)=> String(s?.VSwitchId||s?.id||'')===String(id))?.VSwitchName || id);
                Modal.info({ title: '关联子网', content: (<div style={{ maxHeight: 360, overflow: 'auto' }}><ul>{names.map((n,i)=> (<li key={i}>{n}</li>))}</ul></div>) });
              }}
            />
          ),
        },
        {
          key: 'networkacl',
          label: AclLabel,
          icon: AclIcon,
          count: networkAcls.length,
          children: (
            <NetworkAclSectionAliyun
              cloudId={cloudId}
              networkAcls={networkAcls}
              vpcs={vpcs}
              vswitches={vswitches}
              onSetNetworkAcls={(list) => setNetworkAcls(list)}
              onRefreshAll={loadAll}
            />
          ),
        },
        {
          key: 'rds',
          label: RdsLabel,
          icon: RdsIcon,
          count: rds.length,
          children: (
            <RdsSectionAliyun
              cloudId={cloudId}
              rds={rds}
              vpcs={vpcs}
              vswitches={vswitches}
              onSetRds={(list) => setRds(list)}
              onRefreshAll={loadAll}
            />
          ),
        },
        {
          key: 'monitor',
          label: MonitorLabel,
          icon: MonitorIcon,
          children: (
            <MonitorAlarmSectionAliyun cloudId={cloudId} ecs={ecs} />
          ),
        },
  ];

  const activeTab = tabDefs.find((t) => t.key === tab) || tabDefs[0];

  return (
    <PageDetailContainer hideHeader asCard={false}>
      {error && (
        <Alert type="error" message="查询失败" description={error} style={{ marginBottom: 16 }} showIcon />
      )}
      {activeTab.children}
      
      <SecurityGroupDetailModalAliyun
        open={sgDetailOpen}
        onCancel={() => { setSgDetailOpen(false); setSgDetailTab(undefined); }}
        cloudId={cloudId}
        securityGroup={sgDetailData}
        ecs={ecs}
        defaultTab={sgDetailTab}
      />
      <VpcCreateModalAliyun
        open={vpcCreateOpen}
        cloudId={cloudId}
        onCancel={() => setVpcCreateOpen(false)}
        onOk={() => { setVpcCreateOpen(false); loadAll(); }}
      />
      <VSwitchCreateModalAliyun
        open={vswCreateOpen}
        cloudId={cloudId}
        vpcs={vpcs}
        vswitches={vswitches}
        onCancel={() => setVswCreateOpen(false)}
        onOk={() => { setVswCreateOpen(false); loadAll(); }}
      />
      <RouteTableCreateModalAliyun
        open={rtCreateOpen}
        cloudId={cloudId}
        vpcs={vpcs}
        onClose={() => setRtCreateOpen(false)}
        onSuccess={(list)=> setRouteTables(list)}
      />
      <RouteTableAssociateModalAliyun
        open={rtAssocOpen}
        cloudId={cloudId}
        target={rtAssocTarget}
        subnets={vswitches}
        onClose={() => { setRtAssocOpen(false); setRtAssocTarget(null); }}
        onSuccess={(list)=> setRouteTables(list)}
      />
      <RouteEntryManageDrawerAliyun
        open={reManageOpen}
        cloudId={cloudId}
        ecs={ecs}
        routeTableTarget={curRtTarget}
        entries={curRtEntries}
        onClose={()=> { setReManageOpen(false); setCurRtTarget(null); setCurRtEntries([]); }}
        onUpdated={(list)=> setCurRtEntries(list)}
        onOpenCreate={()=> setReCreateOpen(true)}
        onOpenEdit={(entry)=> { setReEditTarget(entry); setReEditOpen(true); }}
      />
      <RouteEntryCreateDrawerAliyun
        open={reCreateOpen}
        cloudId={cloudId}
        ecs={ecs}
        routeTableTarget={curRtTarget}
        onClose={()=> setReCreateOpen(false)}
        onUpdated={(list)=> setCurRtEntries(list)}
      />
      <RouteEntryEditDrawerAliyun
        open={reEditOpen}
        cloudId={cloudId}
        ecs={ecs}
        routeTableTarget={curRtTarget}
        editTarget={reEditTarget}
        onClose={()=> { setReEditOpen(false); setReEditTarget(null); }}
        onUpdated={(list)=> setCurRtEntries(list)}
      />

    </PageDetailContainer>
  );
};

export default CloudDetailAliyun;
