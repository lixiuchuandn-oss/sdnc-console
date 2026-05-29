import React, { useEffect, useState, useCallback } from 'react';
import { Alert, Button, Modal, Descriptions, Row, Col, Card, Statistic } from 'antd';
import { CloudUploadOutlined, DashboardOutlined, HomeOutlined } from '@ant-design/icons';
import PageDetailContainer from '../../../../components/PageDetailContainer';
import { useNavigate } from 'react-router-dom';
import EcsSectionAliyun, { Icon as EcsIcon, Label as EcsLabel } from './sections/EcsSectionAliyun';
import VpcSectionAliyun, { Icon as VpcIcon, Label as VpcLabel } from './sections/VpcSectionAliyun';
import VSwitchSectionAliyun, { Icon as VSwitchIcon, Label as VSwitchLabel } from './sections/VSwitchSectionAliyun';
import SecurityGroupSectionAliyun, { Icon as SgIcon, Label as SgLabel } from './sections/SecurityGroupSectionAliyun';
import EipSectionAliyun, { Icon as EipIcon, Label as EipLabel } from './sections/EipSectionAliyun';
import DiskSectionAliyun, { Icon as DiskIcon, Label as DiskLabel } from './sections/DiskSectionAliyun';
import LoadBalancerSectionAliyun, { Icon as SlbIcon, Label as SlbLabel } from './sections/LoadBalancerSectionAliyun';
import NatGatewaySectionAliyun, { Icon as NatIcon, Label as NatLabel } from './sections/NatGatewaySectionAliyun';
import RouteTableSectionAliyun, { Icon as RouteTableIcon, Label as RouteTableLabel } from './sections/RouteTableSectionAliyun';
// import disk section
import { fetchClouds } from '../../../../services/api';
import { fetchCloudProviderVpcs, fetchCloudProviderEcs, fetchCloudProviderSecurityGroups, fetchCloudProviderEips, fetchCloudProviderDisks, fetchCloudProviderLoadBalancers, fetchCloudProviderNatGateways, fetchCloudProviderRouteTables, fetchCloudProviderSnapshots, fetchCloudProviderVSwitches } from '../../../../services/aliyunApi';
import EcsInsDetSection from './sections/EcsInsDetSection';
import SecurityGroupDetailModalAliyun from './modals/SecurityGroupDetailModalAliyun';
import RouteTableCreateModalAliyun from './modals/RouteTableCreateModalAliyun';
import RouteTableAssociateModalAliyun from './modals/RouteTableAssociateModalAliyun';
import RouteEntryManageDrawerAliyun from './drawers/RouteEntryManageDrawerAliyun';
import RouteEntryCreateDrawerAliyun from './drawers/RouteEntryCreateDrawerAliyun';
import RouteEntryEditDrawerAliyun from './drawers/RouteEntryEditDrawerAliyun';

type CloudDetailAliyunProps = {
  cloudId: string;
};

const CloudDetailAliyun: React.FC<CloudDetailAliyunProps> = ({ cloudId }) => {
  const navigate = useNavigate();
  const [error, setError] = useState<string>('');
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
  const [, setSnapshots] = useState<any[]>([]);

  const [vmDetailOpen, setVmDetailOpen] = useState<boolean>(false);
  const [vmDetail, setVmDetail] = useState<any | null>(null);
  const [sgDetailOpen, setSgDetailOpen] = useState<boolean>(false);
  const [sgDetailData, setSgDetailData] = useState<any | null>(null);
  const [sgDetailTab, setSgDetailTab] = useState<string | undefined>(undefined);
  const [showLog, setShowLog] = useState<boolean>(false);
  const [rawEcs, setRawEcs] = useState<any | null>(null);
  const [rawVpcs, setRawVpcs] = useState<any | null>(null);
  const [rawVSwitches, setRawVSwitches] = useState<any | null>(null);
  const [rawSecGroups, setRawSecGroups] = useState<any | null>(null);
  const [rawEips, setRawEips] = useState<any | null>(null);
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

      const [vpcJson, ecsJson, vswJson, sgJson, eipJson, diskJson, slbJson, natJson, rtJson, snapJson] = await Promise.all([
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

  const openDetail = useCallback((type: string, title: string, data: any) => {
    Modal.info({
      title,
      content: (<div style={{ maxHeight: 360, overflow: 'auto' }}><pre>{JSON.stringify(data, null, 2)}</pre></div>)
    });
  }, []);

  return (
    <PageDetailContainer
      breadcrumbs={[
        { title: <HomeOutlined />, href: '/' },
        { title: '资源池管理' },
        { title: '资源池管理', href: '/admin/clouds' },
        { title: `阿里云 ${cloud?.name || '-'}` }
      ]}
      icon={<CloudUploadOutlined />}
      title={`阿里云 ${cloud?.name || '-'}`}
      titleLevel={3}
      onBack={() => navigate('/admin/clouds')}
      backTooltip="返回列表"
      moreMenuItems={[{ key: 'refresh', label: '刷新' }, { key: 'toggleLog', label: (showLog ? '隐藏返回' : '显示返回') }]}
      onMoreMenuClick={({ key }) => { if (key === 'refresh') loadAll(); if (key === 'toggleLog') setShowLog(v => !v); }}
      asCard={false}
      subtitle="集中展示云资源池信息，提供多种资源类型的生命周期管理能力"
      overviewContent={(
        <Descriptions bordered size="small" column={4}>
          <Descriptions.Item label="资源名称">{cloud?.name || '-'}</Descriptions.Item>
          <Descriptions.Item label="资源供应商">阿里云</Descriptions.Item>
          <Descriptions.Item label="资源地域">{cloud?.region || '-'}</Descriptions.Item>
          <Descriptions.Item label="资源类型">{cloud?.type || '-'}</Descriptions.Item>
          <Descriptions.Item label="资源状态">
            {cloud?.status === 'online' ? '在线' : cloud?.status === 'maintenance' ? '维护' : cloud?.status === 'offline' ? '离线' : '未知'}
          </Descriptions.Item>
          <Descriptions.Item label="Endpoint">{cloud?.endpoint || '-'}</Descriptions.Item>
          <Descriptions.Item label="项目ID">{cloud?.config?.projectId || '-'}</Descriptions.Item>
          <Descriptions.Item label="资源ID">{cloud?.id || '-'}</Descriptions.Item>
          <Descriptions.Item label="创建时间">{cloud?.createdAt || '-'}</Descriptions.Item>
          <Descriptions.Item label="更新时间">{cloud?.updatedAt || '-'}</Descriptions.Item>
        </Descriptions>
      )}
      defaultActiveTabKey="overview"
      tabs={[
        {
          key: 'overview',
          label: '资源总览',
          icon: <DashboardOutlined />,
          children: (
            <>
              <Row gutter={[16, 16]}>
                <Col xs={24} sm={12} md={6}>
                  <Card size="small" style={{ borderRadius: 8, border: '1px solid #f0f0f0' }}>
                    <Statistic title="VPC 数量" value={vpcs.length} valueStyle={{ fontSize: 24, fontWeight: 700 }} />
                  </Card>
                </Col>
                <Col xs={24} sm={12} md={6}>
                  <Card size="small" style={{ borderRadius: 8, border: '1px solid #f0f0f0' }}>
                    <Statistic title="交换机数量" value={vswitches.length} valueStyle={{ fontSize: 24, fontWeight: 700 }} />
                  </Card>
                </Col>
                <Col xs={24} sm={12} md={6}>
                  <Card size="small" style={{ borderRadius: 8, border: '1px solid #f0f0f0' }}>
                    <Statistic title="安全组数量" value={secGroups.length} valueStyle={{ fontSize: 24, fontWeight: 700 }} />
                  </Card>
                </Col>
                <Col xs={24} sm={12} md={6}>
                  <Card size="small" style={{ borderRadius: 8, border: '1px solid #f0f0f0' }}>
                    <Statistic title="EIP 数量" value={eips.length} valueStyle={{ fontSize: 24, fontWeight: 700 }} />
                  </Card>
                </Col>
              </Row>
              <Row gutter={[16, 16]} style={{ marginTop: 12 }}>
                <Col xs={24} sm={12} md={6}>
                  <Card size="small" style={{ borderRadius: 8, border: '1px solid #f0f0f0' }}>
                    <Statistic title="云主机数量" value={ecs.length} valueStyle={{ fontSize: 24, fontWeight: 700 }} />
                  </Card>
                </Col>
              </Row>
            </>
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
              onOpenVmDetail={(vm: any) => { setVmDetail(vm); setVmDetailOpen(true); }}
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
              onSetDisks={(list) => setDisks(list)}
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
      ]}
    >
      {error && (
        <Alert type="error" message="查询失败" description={error} style={{ marginBottom: 16 }} showIcon />
      )}
      
      <Modal
        open={vmDetailOpen}
        width={900}
        title="实例详情"
        onCancel={() => { setVmDetailOpen(false); setVmDetail(null); }}
        footer={<Button onClick={() => { setVmDetailOpen(false); setVmDetail(null); }}>关闭</Button>}
      >
        {vmDetail && (<EcsInsDetSection cloudId={cloudId} instance={vmDetail} eips={eips} onRefreshAll={loadAll} />)}
      </Modal>

      <SecurityGroupDetailModalAliyun
        open={sgDetailOpen}
        onCancel={() => { setSgDetailOpen(false); setSgDetailTab(undefined); }}
        cloudId={cloudId}
        securityGroup={sgDetailData}
        ecs={ecs}
        defaultTab={sgDetailTab}
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
