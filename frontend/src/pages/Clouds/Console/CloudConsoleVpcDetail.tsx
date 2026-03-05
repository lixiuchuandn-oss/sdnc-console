import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Tabs, Table, Tag, Button, Space, Dropdown } from 'antd';
import { ReloadOutlined, CaretDownFilled } from '@ant-design/icons';
import VmSection from '../Harvester/sections/VmSection';
import VolumesSection from '../Harvester/sections/VolumesSection';
import SnapshotsSection from '../Harvester/sections/SnapshotsSection';
import BackupsSection from '../Harvester/sections/BackupsSection';
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
  volumes?: any[];
  snapshots?: any[];
  backups?: any[];
  storageClasses?: any[];
  loading?: boolean;
  isHarvester?: boolean;
  onRefresh?: () => void;
  onRefreshVolumes?: () => void;
  onRefreshSnapshots?: () => void;
  onRefreshBackups?: () => void;
  // Action Handlers passed from parent
  onOpenReconfigure: (vm: any) => void;
  onStart: (iid: string) => void;
  onStop: (iid: string) => void;
  onReboot: (iid: string) => void;
  onDelete: (iid: string, deleteImage?: boolean) => void;
  bordered?: boolean; // New prop
}

const CloudConsoleVpcDetail: React.FC<Props> = ({
  cloudId,
  vpcName,
  vpcs,
  subnets,
  ecs,
  volumes = [],
  snapshots = [],
  backups = [],
  storageClasses = [],
  loading: parentLoading,
  isHarvester,
  onRefresh,
  onRefreshVolumes,
  onRefreshSnapshots,
  onRefreshBackups,
  onOpenReconfigure,
  onStart,
  onStop,
  onReboot,
  onDelete,
  bordered = true // Default to true
}) => {
  // 二级导航状态
  const [activeCategory, setActiveCategory] = useState<string>('compute');
  const [activeResource, setActiveResource] = useState<string>('vm');
  
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

  // Get VPC bound namespaces
  const vpcNamespaces = useMemo(() => {
    if (!currentVpc) return [];
    const namespaces = currentVpc.spec?.namespaces || currentVpc.namespaces || [];
    return Array.isArray(namespaces) ? namespaces : [];
  }, [currentVpc]);

  // Filter Subnets
  const mySubnets = useMemo(() => {
    return subnets.filter(s => {
        const vpc = s.spec?.vpc || s.vpc;
        return vpc === vpcName;
    });
  }, [subnets, vpcName]);

  // Filter ECS by VPC namespaces
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

        // 4. Check if ECS namespace is in VPC bound namespaces
        if (vpcNamespaces.length > 0 && ecsNs && vpcNamespaces.includes(ecsNs)) return true;

        return false;
    });
  }, [ecs, vpcName, mySubnets, vpcNamespaces]);

  // Filter Volumes by VPC namespaces
  const myVolumes = useMemo(() => {
    if (vpcNamespaces.length === 0) return [];
    return volumes.filter((v: any) => {
      const ns = v?.metadata?.namespace || v?.namespace || '';
      return ns && vpcNamespaces.includes(ns);
    });
  }, [volumes, vpcNamespaces]);

  // Filter Snapshots by VPC namespaces
  const mySnapshots = useMemo(() => {
    if (vpcNamespaces.length === 0) return [];
    return snapshots.filter((s: any) => {
      const ns = s?.metadata?.namespace || s?.namespace || '';
      return ns && vpcNamespaces.includes(ns);
    });
  }, [snapshots, vpcNamespaces]);

  // Filter Backups by VPC namespaces (backups are associated with VMs, so filter by VM namespace)
  const myBackups = useMemo(() => {
    if (vpcNamespaces.length === 0) return [];
    return backups.filter((b: any) => {
      const raw = b.rawData || b;
      const targetName = raw.spec?.source?.name || b.targetVm;
      // Find the VM and check its namespace
      const vm = myEcs.find((v: any) => v.metadata?.name === targetName);
      if (vm) {
        const vmNs = vm.metadata?.namespace || vm.namespace || '';
        return vmNs && vpcNamespaces.includes(vmNs);
      }
      return false;
    });
  }, [backups, vpcNamespaces, myEcs]);

  const namespacesOptions = useMemo(() => {
    return Array.from(new Set(myEcs.map(r => r?.metadata?.namespace || r?.namespace).filter(Boolean))) as string[];
  }, [myEcs]);

  const nodesOptions = useMemo(() => {
    return Array.from(new Set(myEcs.map(r => r?.vmi?.status?.nodeName || r?.status?.nodeName || r?.nodeName || r?.Extra?.NodeName).filter(Boolean))) as string[];
  }, [myEcs]);

  // Convert namespaces to objects format for BackupsSection
  const namespaceObjects = useMemo(() => {
    return namespacesOptions.map(ns => ({ metadata: { name: ns } }));
  }, [namespacesOptions]);

  // Load Network Rules
  const loadNetworkRules = useCallback(async () => {
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
        const myFips = (fipsRes?.data?.items || []).filter((r: any) => r.spec?.vpc === vpcName);
        const mySnats = (snatRes?.data?.items || []).filter((r: any) => r.spec?.vpc === vpcName);
        const myDnats = (dnatRes?.data?.items || []).filter((r: any) => r.spec?.vpc === vpcName);

        setFips(myFips);
        setSnatRules(mySnats);
        setDnatRules(myDnats);

        // Filter EIPs: Include if used by myFips, mySnats, myDnats
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
  }, [cloudId, vpcName]);

  useEffect(() => {
    if (activeCategory === 'vpc' && activeResource !== 'vpc-subnet') {
        loadNetworkRules();
    }
  }, [activeCategory, activeResource, loadNetworkRules]);

  // Tab 配置 - 与 CloudConsoleHarvester 保持一致的结构
  const tabConfig = useMemo(() => [
    {
      key: 'compute',
      label: '云主机',
      resources: [
        { key: 'vm', label: '实例' },
      ]
    },
    {
      key: 'storage',
      label: '云盘',
      resources: [
        { key: 'volume', label: '实例' },
        { key: 'volume-snapshot', label: '快照' },
      ]
    },
    {
      key: 'backup',
      label: '整机',
      resources: [
        { key: 'backup', label: '备份' },
      ]
    },
    {
      key: 'vpc',
      label: 'VPC',
      resources: [
         { key: 'vpc-subnet', label: '子网' },
         { key: 'eip', label: 'EIP' },
         { key: 'fip', label: 'FIP' },
         { key: 'snat', label: 'SNAT' },
         { key: 'dnat', label: 'DNAT' },
      ]
    }
  ], []);

  const getDefaultResource = (catKey: string) => {
    const cat = tabConfig.find(c => c.key === catKey);
    return cat ? cat.resources[0].key : '';
  };

  // 渲染内容 - 普通函数，在 tabItems 的 useMemo 中调用
  const renderContent = () => {
    switch (activeResource) {
      case 'vm':
        return (
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
            bordered={bordered}
            disableColumnSettings={true}
          />
        );
      case 'volume':
        return (
          <VolumesSection 
            volumes={myVolumes}
            loading={!!parentLoading}
            onRefresh={onRefreshVolumes || (() => {})}
            cloudId={cloudId}
            vms={myEcs}
            storageClasses={storageClasses}
            namespacesOptions={namespacesOptions}
            isTenant={true}
            bordered={bordered}
          />
        );
      case 'volume-snapshot':
        return (
          <SnapshotsSection
            snapshots={mySnapshots}
            loading={!!parentLoading}
            onRefresh={onRefreshSnapshots || (() => {})}
            cloudId={cloudId}
            isTenant={true}
            namespaces={namespaceObjects}
            bordered={bordered}
          />
        );
      case 'backup':
        return (
          <BackupsSection
            backups={myBackups}
            loading={!!parentLoading}
            onRefresh={onRefreshBackups || (() => {})}
            cloudId={cloudId}
            namespaces={namespaceObjects}
            vms={myEcs}
            isTenant={true}
            bordered={bordered}
          />
        );
      case 'vpc-subnet':
        const subnetColumns = [
          { title: '名称', key: 'name', render: (_: any, r: any) => <b>{r.metadata?.name}</b> },
          { title: 'CIDR', key: 'cidr', render: (_: any, r: any) => <Tag>{r.spec?.cidrBlock}</Tag> },
          { title: '网关', key: 'gateway', render: (_: any, r: any) => r.spec?.gateway },
          { title: 'Namespace', key: 'ns', render: (_: any, r: any) => r.metadata?.namespace },
          { title: '协议', key: 'protocol', render: (_: any, r: any) => r.spec?.protocol },
        ];
        return (
          <Table 
            dataSource={mySubnets} 
            columns={subnetColumns} 
            rowKey={r => r.metadata?.uid} 
            pagination={DEFAULT_PAGINATION_CONFIG}
            bordered={bordered}
          />
        );
      case 'eip':
        const eipColumns = [
          { title: '名称', key: 'name', render: (_: any, r: any) => <b>{r.metadata?.name}</b> },
          { title: 'IP', key: 'ip', render: (_: any, r: any) => r.spec?.v4Ip },
          { title: 'MAC', key: 'mac', render: (_: any, r: any) => r.spec?.macAddress },
          { title: '类型', key: 'type', render: (_: any, r: any) => r.spec?.type },
        ];
        return (
          <>
            <div style={{ textAlign: 'right', marginBottom: 8 }}>
              <Button icon={<ReloadOutlined />} onClick={loadNetworkRules} loading={loading}>刷新</Button>
            </div>
            <Table dataSource={eips} columns={eipColumns} loading={loading} rowKey={r => r.metadata?.uid} bordered={bordered} />
          </>
        );
      case 'fip':
        const fipColumns = [
          { title: '名称', key: 'name', render: (_: any, r: any) => <b>{r.metadata?.name}</b> },
          { title: 'EIP', key: 'eip', render: (_: any, r: any) => r.spec?.ovnEip },
          { title: '内部IP', key: 'intIp', render: (_: any, r: any) => r.spec?.ipName },
        ];
        return (
          <>
            <div style={{ textAlign: 'right', marginBottom: 8 }}>
              <Button icon={<ReloadOutlined />} onClick={loadNetworkRules} loading={loading}>刷新</Button>
            </div>
            <Table dataSource={fips} columns={fipColumns} loading={loading} rowKey={r => r.metadata?.uid} bordered={bordered} />
          </>
        );
      case 'snat':
        const snatColumns = [
          { title: '名称', key: 'name', render: (_: any, r: any) => <b>{r.metadata?.name}</b> },
          { title: 'EIP', key: 'eip', render: (_: any, r: any) => r.spec?.ovnEip },
          { title: 'CIDR', key: 'cidr', render: (_: any, r: any) => r.spec?.vpcSubnet },
        ];
        return (
          <>
            <div style={{ textAlign: 'right', marginBottom: 8 }}>
              <Button icon={<ReloadOutlined />} onClick={loadNetworkRules} loading={loading}>刷新</Button>
            </div>
            <Table dataSource={snatRules} columns={snatColumns} loading={loading} rowKey={r => r.metadata?.uid} bordered={bordered} />
          </>
        );
      case 'dnat':
        const dnatColumns = [
          { title: '名称', key: 'name', render: (_: any, r: any) => <b>{r.metadata?.name}</b> },
          { title: 'EIP', key: 'eip', render: (_: any, r: any) => r.spec?.ovnEip },
          { title: '端口', key: 'port', render: (_: any, r: any) => `${r.spec?.protocol} ${r.spec?.externalPort} -> ${r.spec?.internalPort}` },
          { title: '内部IP', key: 'intIp', render: (_: any, r: any) => r.spec?.internalIp },
        ];
        return (
          <>
            <div style={{ textAlign: 'right', marginBottom: 8 }}>
              <Button icon={<ReloadOutlined />} onClick={loadNetworkRules} loading={loading}>刷新</Button>
            </div>
            <Table dataSource={dnatRules} columns={dnatColumns} loading={loading} rowKey={r => r.metadata?.uid} bordered={bordered} />
          </>
        );
      default:
        return null;
    }
  };

  // 处理资源切换
  const handleResourceChange = useCallback((catKey: string, resKey: string) => {
    setActiveCategory(catKey);
    setActiveResource(resKey);
  }, []);

  const tabItems = useMemo(() => {
    return tabConfig.map(cat => {
      const isActive = cat.key === activeCategory;
      // [展示规则] 未选中时展示默认资源标签；选中时展示当前 activeResource 标签
      const currentResKey = isActive ? activeResource : cat.resources[0].key;
      const currentResLabel = cat.resources.find(r => r.key === currentResKey)?.label || cat.resources[0].label;

      return {
        key: cat.key,
        label: (
          <Space size={4} align="center">
            <span>{cat.label} {currentResLabel}</span>
            <Dropdown
              menu={{
                items: cat.resources.map(res => ({
                  key: res.key,
                  label: res.label,
                  onClick: (e: any) => {
                    e.domEvent.stopPropagation();
                    handleResourceChange(cat.key, res.key);
                  }
                })),
                selectedKeys: [isActive ? activeResource : '']
              }}
              trigger={['click']}
            >
              <span 
                onClick={(e) => e.stopPropagation()} 
                className="cloud-console-harvester-dropdown-trigger"
              >
                <CaretDownFilled style={{ fontSize: 12 }} />
              </span>
            </Dropdown>
          </Space>
        ),
        children: (
          <div>
            {isActive ? renderContent() : null}
          </div>
        )
      };
    });
    // 只依赖 activeCategory 和 activeResource，避免其他依赖导致无限循环
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabConfig, activeCategory, activeResource, handleResourceChange]);

  return (
    <div className="vpc-detail-container" style={{ height: '100%', background: '#fff'}}>
      <Tabs
        type="card"
        activeKey={activeCategory}
        onChange={(key) => {
          setActiveCategory(key);
          setActiveResource(getDefaultResource(key));
        }}
        items={tabItems}
      />
    </div>
  );
};

export default CloudConsoleVpcDetail;
