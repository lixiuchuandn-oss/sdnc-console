import React, { useState, useEffect, useMemo } from 'react';
import { Tabs, Table, Tag, Button, Space, Card, Descriptions, Alert, App } from 'antd';
import { ReloadOutlined, EyeOutlined } from '@ant-design/icons';
import VmSection from '../Harvester/sections/VmSection';
import { DEFAULT_PAGINATION_CONFIG } from '../../../constants/pagination';
import { 
  fetchCloudProviderOvnEips, 
  fetchCloudProviderOvnFips, 
  fetchCloudProviderOvnSnatRules, 
  fetchCloudProviderOvnDnatRules
} from '../../../services/harvesterApi';

interface Props {
  cloudId: string;
  vpcName: string; // The name/ID of the selected VPC
  vpcs: any[];
  subnets: any[];
  ecs: any[];
  loading?: boolean;
  isHarvester?: boolean;
  onRefresh?: () => void;
  // Action Handlers passed from parent
  onOpenReconfigure: (vm: any) => void;
  onStart: (iid: string) => void;
  onStop: (iid: string) => void;
  onReboot: (iid: string) => void;
  onDelete: (iid: string, deleteImage?: boolean) => void;
}

const CloudConsoleVpcDetail: React.FC<Props> = ({
  cloudId,
  vpcName,
  vpcs,
  subnets,
  ecs,
  loading: parentLoading,
  isHarvester,
  onRefresh,
  onOpenReconfigure,
  onStart,
  onStop,
  onReboot,
  onDelete
}) => {
  const [activeTab, setActiveTab] = useState('ecs');
  const [loading, setLoading] = useState(false);
  const [eips, setEips] = useState<any[]>([]);
  const [fips, setFips] = useState<any[]>([]);
  const [snatRules, setSnatRules] = useState<any[]>([]);
  const [dnatRules, setDnatRules] = useState<any[]>([]);

  // VmSection dummy state for VPC view
  const [nsValue, setNsValue] = useState<string | undefined>(undefined);
  const [nodeValue, setNodeValue] = useState<string | undefined>(undefined);

  // Find current VPC object
  const currentVpc = useMemo(() => {
    return vpcs.find(v => v.metadata?.name === vpcName || v.name === vpcName);
  }, [vpcs, vpcName]);

  // Filter Subnets
  const mySubnets = useMemo(() => {
    return subnets.filter(s => {
        const vpc = s.spec?.vpc || s.vpc;
        return vpc === vpcName;
    });
  }, [subnets, vpcName]);

  // Filter ECS
  const myEcs = useMemo(() => {
    return ecs.filter(e => {
        // 1. Check strict annotation
        if (e.metadata?.annotations?.['ovn.kubernetes.io/vpc'] === vpcName) return true;
        
        // 2. Check namespace (common in multi-tenant)
        if (e.metadata?.namespace === vpcName) return true;

        // 3. Check if ECS namespace matches any of our subnets' namespace
        // (If subnets are namespaced and belong to this VPC)
        const ecsNs = e.metadata?.namespace;
        if (mySubnets.some(s => s.metadata?.namespace === ecsNs)) return true;

        return false;
    });
  }, [ecs, vpcName, mySubnets]);

  const namespacesOptions = useMemo(() => {
    return Array.from(new Set(myEcs.map(r => r?.metadata?.namespace || r?.namespace).filter(Boolean))) as string[];
  }, [myEcs]);

  const nodesOptions = useMemo(() => {
    return Array.from(new Set(myEcs.map(r => r?.vmi?.status?.nodeName || r?.status?.nodeName || r?.nodeName || r?.Extra?.NodeName).filter(Boolean))) as string[];
  }, [myEcs]);

  // Load Network Rules
  const loadNetworkRules = async () => {
    if (!cloudId) return;
    setLoading(true);
    try {
        const [eipsRes, fipsRes, snatRes, dnatRes] = await Promise.all([
            fetchCloudProviderOvnEips(cloudId),
            fetchCloudProviderOvnFips(cloudId),
            fetchCloudProviderOvnSnatRules(cloudId),
            fetchCloudProviderOvnDnatRules(cloudId)
        ]);

        // Filter by VPC
        setEips((eipsRes?.data?.items || [])); // EIPs usually don't have VPC field directly unless bound? 
        // Actually EIP is global, but FIP/SNAT binds EIP to VPC. 
        // We might just show ALL EIPs that are used by FIP/SNAT of this VPC? 
        // Or just list EIPs that explicitly mention this VPC (if any).
        // Let's filter EIPs if they have vpc field, otherwise we might show empty or all?
        // Usually EIP is in external network. Let's keep all or filter if possible.
        // Re-reading CloudConsoleNetwork: EIP table has 'externalSubnet', no VPC column.
        // But FIP/SNAT have VPC column.
        // Let's filter EIPs by checking if they are used by any FIP/SNAT of this VPC.
        
        const myFips = (fipsRes?.data?.items || []).filter((r: any) => r.spec?.vpc === vpcName);
        const mySnats = (snatRes?.data?.items || []).filter((r: any) => r.spec?.vpc === vpcName);
        const myDnats = (dnatRes?.data?.items || []).filter((r: any) => r.spec?.vpc === vpcName);

        setFips(myFips);
        setSnatRules(mySnats);
        setDnatRules(myDnats);

        // Filter EIPs: Include if used by myFips, mySnats, myDnats OR if spec.vpc matches (if supported)
        const usedEipNames = new Set([
            ...myFips.map((f: any) => f.spec?.ovnEip),
            ...mySnats.map((s: any) => s.spec?.ovnEip),
            ...myDnats.map((d: any) => d.spec?.ovnEip)
        ]);
        
        const allEips = eipsRes?.data?.items || [];
        const myEips = allEips.filter((e: any) => usedEipNames.has(e.metadata?.name));
        setEips(myEips);

    } catch (e) {
        console.error('Failed to load VPC network rules', e);
    } finally {
        setLoading(false);
    }
  };

  useEffect(() => {
    if (activeTab !== 'ecs' && activeTab !== 'subnets') {
        loadNetworkRules();
    }
  }, [cloudId, vpcName, activeTab]);

  // Subnet Columns
  const subnetColumns = [
    { title: '名称', key: 'name', render: (_: any, r: any) => <b>{r.metadata?.name}</b> },
    { title: 'CIDR', key: 'cidr', render: (_: any, r: any) => <Tag>{r.spec?.cidrBlock}</Tag> },
    { title: '网关', key: 'gateway', render: (_: any, r: any) => r.spec?.gateway },
    { title: 'Namespace', key: 'ns', render: (_: any, r: any) => r.metadata?.namespace },
    { title: '协议', key: 'protocol', render: (_: any, r: any) => r.spec?.protocol },
  ];

  // Network Rule Columns (Simplified)
  const eipColumns = [
    { title: '名称', key: 'name', render: (_: any, r: any) => <b>{r.metadata?.name}</b> },
    { title: 'IP', key: 'ip', render: (_: any, r: any) => r.spec?.v4Ip },
    { title: 'MAC', key: 'mac', render: (_: any, r: any) => r.spec?.macAddress },
    { title: '类型', key: 'type', render: (_: any, r: any) => r.spec?.type },
  ];
  
  const fipColumns = [
    { title: '名称', key: 'name', render: (_: any, r: any) => <b>{r.metadata?.name}</b> },
    { title: 'EIP', key: 'eip', render: (_: any, r: any) => r.spec?.ovnEip },
    { title: '内部IP', key: 'intIp', render: (_: any, r: any) => r.spec?.ipName },
  ];

  const snatColumns = [
    { title: '名称', key: 'name', render: (_: any, r: any) => <b>{r.metadata?.name}</b> },
    { title: 'EIP', key: 'eip', render: (_: any, r: any) => r.spec?.ovnEip },
    { title: 'CIDR', key: 'cidr', render: (_: any, r: any) => r.spec?.eip }, // spec.eip in SNAT might be the internal CIDR or external IP? In CloudConsoleNetwork it was displaying spec.eip as CIDR?
  ];
  
  const dnatColumns = [
    { title: '名称', key: 'name', render: (_: any, r: any) => <b>{r.metadata?.name}</b> },
    { title: 'EIP', key: 'eip', render: (_: any, r: any) => r.spec?.ovnEip },
    { title: '端口', key: 'port', render: (_: any, r: any) => `${r.spec?.protocol} ${r.spec?.eipPort} -> ${r.spec?.internalPort}` },
    { title: '内部IP', key: 'intIp', render: (_: any, r: any) => r.spec?.internalIp },
  ];

  return (
    <div className="vpc-detail-container">


      <Tabs 
        type="card"
        activeKey={activeTab}
        onChange={setActiveTab}
        items={[
            {
                label: `云主机 (${myEcs.length})`,
                key: 'ecs',
                children: (
                    <VmSection 
                        vms={myEcs}
                        loading={!!parentLoading}
                        namespacesOptions={namespacesOptions}
                        nodesOptions={nodesOptions}
                        cloudId={cloudId}
                        nsValue={nsValue}
                        nodeValue={nodeValue}
                        onNsChange={setNsValue}
                        onNodeChange={setNodeValue}
                        onRefresh={onRefresh || (() => {})}
                        onOpenReconfigure={onOpenReconfigure}
                        onStart={onStart}
                        onStop={onStop}
                        onReboot={onReboot}
                        onDelete={onDelete}
                        isTenant={true}
                    />
                )
            },
            {
                label: `子网 (${mySubnets.length})`,
                key: 'subnets',
                children: (
                    <Table 
                        dataSource={mySubnets} 
                        columns={subnetColumns} 
                        rowKey={r => r.metadata?.uid} 
                        pagination={DEFAULT_PAGINATION_CONFIG}
                    />
                )
            },
            {
                label: 'EIP',
                key: 'eip',
                children: (
                    <>
                        <div style={{ textAlign: 'right', marginBottom: 8 }}>
                            <Button icon={<ReloadOutlined />} onClick={loadNetworkRules} loading={loading}>刷新</Button>
                        </div>
                        <Table dataSource={eips} columns={eipColumns} loading={loading} rowKey={r => r.metadata?.uid} />
                    </>
                )
            },
            {
                label: 'FIP',
                key: 'fip',
                children: (
                    <>
                         <div style={{ textAlign: 'right', marginBottom: 8 }}>
                            <Button icon={<ReloadOutlined />} onClick={loadNetworkRules} loading={loading}>刷新</Button>
                        </div>
                        <Table dataSource={fips} columns={fipColumns} loading={loading} rowKey={r => r.metadata?.uid} />
                    </>
                )
            },
            {
                label: 'SNAT',
                key: 'snat',
                children: (
                    <>
                         <div style={{ textAlign: 'right', marginBottom: 8 }}>
                            <Button icon={<ReloadOutlined />} onClick={loadNetworkRules} loading={loading}>刷新</Button>
                        </div>
                        <Table dataSource={snatRules} columns={snatColumns} loading={loading} rowKey={r => r.metadata?.uid} />
                    </>
                )
            },
            {
                label: 'DNAT',
                key: 'dnat',
                children: (
                    <>
                         <div style={{ textAlign: 'right', marginBottom: 8 }}>
                            <Button icon={<ReloadOutlined />} onClick={loadNetworkRules} loading={loading}>刷新</Button>
                        </div>
                        <Table dataSource={dnatRules} columns={dnatColumns} loading={loading} rowKey={r => r.metadata?.uid} />
                    </>
                )
            }
        ]}
      />
    </div>
  );
};

export default CloudConsoleVpcDetail;
