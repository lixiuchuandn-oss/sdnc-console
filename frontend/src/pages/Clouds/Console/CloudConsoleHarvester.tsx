import React, { useState, useEffect, useMemo } from 'react';
import { Tabs, Layout, Menu, Empty } from 'antd';
import { 
  DesktopOutlined, DatabaseOutlined, HistoryOutlined, 
  GlobalOutlined, ClusterOutlined, CloudOutlined, FileImageOutlined
} from '@ant-design/icons';
import VmSection from '../Harvester/sections/VmSection';
import TemplatesSection from '../Harvester/sections/TemplatesSection';
import SshKeysSection from '../Harvester/sections/SshKeysSection';
import VolumesSection from '../Harvester/sections/VolumesSection';
import ImagesSection from '../Harvester/sections/ImagesSection';
import BackupsSection from '../Harvester/sections/BackupsSection';
import ScheduleVmBackupsSection from '../Harvester/sections/ScheduleVmBackupsSection';
import SnapshotsSection from '../Harvester/sections/SnapshotsSection';
import CloudInitsSection from '../Harvester/sections/CloudInitsSection';
import GpuSection from '../Harvester/sections/GpusSection';
import IPPoolsSection from '../Harvester/sections/IPPoolsSection';
import EipSection from '../Harvester/kube-ovn/EipSection';
import FipSection from '../Harvester/kube-ovn/FipSection';
import SnatSection from '../Harvester/kube-ovn/SnatSection';
import DnatSection from '../Harvester/kube-ovn/DnatSection';
import CloudConsoleNadTable from './CloudConsoleNadTable';
import CloudConsoleLbTable from './CloudConsoleLbTable';
import { CloudConsoleVpcTable } from './CloudConsoleVpcTable';

const { Sider, Content } = Layout;

interface Props {
  cloudId: string;
  vms: any[];
  templates: any[];
  sshKeys: any[];
  volumes?: any[];
  images?: any[];
  snapshots?: any[];
  backups?: any[];
  schedules?: any[];
  cloudInits?: any[];
  gpus?: any[];
  ippools?: any[];
  nads?: any[];
  lbs?: any[];
  vpcs?: any[];
  subnets?: any[];
  eips?: any[];
  fips?: any[];
  snatRules?: any[];
  dnatRules?: any[];
  loading: boolean;
  
  // VmSection specific props
  namespacesOptions: string[];
  nodesOptions: string[];
  nsValue?: string;
  nodeValue?: string;
  onNsChange: (v?: string) => void;
  onNodeChange: (v?: string) => void;
  onRefreshVms: () => void;
  onOpenReconfigure: (vm: any) => void;
  onStart: (iid: string) => void;
  onStop: (iid: string) => void;
  onReboot: (iid: string) => void;
  onSoftReboot?: (iid: string) => void;
  onPause?: (iid: string) => void;
  onUnpause?: (iid: string) => void;
  onDelete: (iid: string, deleteImage?: boolean) => void;

  // Other Refresh Handlers
  onRefreshTemplates: () => void;
  onRefreshSshKeys: () => void;
  onRefreshVolumes?: () => void;
  onRefreshImages?: () => void;
  onRefreshSnapshots?: () => void;
  onRefreshBackups?: () => void;
  onRefreshSchedules?: () => void;
  onRefreshCloudInits?: () => void;
  onRefreshGpus?: () => void;
  onRefreshIPPools?: () => void;
  onRefreshNads?: () => void;
  onRefreshLbs?: () => void;
  onRefreshVpcs?: () => void;
  onRefreshEips?: () => void;
  onRefreshFips?: () => void;
  onRefreshSnatRules?: () => void;
  onRefreshDnatRules?: () => void;
}

const CloudConsoleHarvester: React.FC<Props> = ({
  cloudId,
  vms,
  templates,
  sshKeys,
  volumes = [],
  images = [],
  snapshots = [],
  backups = [],
  schedules = [],
  cloudInits = [],
  gpus = [],
  ippools = [],
  nads = [],
  lbs = [],
  vpcs = [],
  subnets = [],
  eips = [],
  fips = [],
  snatRules = [],
  dnatRules = [],
  loading,
  namespacesOptions,
  nodesOptions,
  nsValue,
  nodeValue,
  onNsChange,
  onNodeChange,
  onRefreshVms,
  onOpenReconfigure,
  onStart,
  onStop,
  onReboot,
  onSoftReboot,
  onPause,
  onUnpause,
  onDelete,
  onRefreshTemplates,
  onRefreshSshKeys,
  onRefreshVolumes,
  onRefreshImages,
  onRefreshSnapshots,
  onRefreshBackups,
  onRefreshSchedules,
  onRefreshCloudInits,
  onRefreshGpus,
  onRefreshIPPools,
  onRefreshNads,
  onRefreshLbs,
  onRefreshVpcs,
  onRefreshEips,
  onRefreshFips,
  onRefreshSnatRules,
  onRefreshDnatRules
}) => {
  const [activeCategory, setActiveCategory] = useState('compute');
  const [activeResource, setActiveResource] = useState('vm');

  // Convert namespacesOptions (string[]) to object array for BackupsSection
  const namespaceObjects = useMemo(() => {
    return namespacesOptions.map(ns => ({ metadata: { name: ns } }));
  }, [namespacesOptions]);

  // Define Category Menu
  const categories = [
    { key: 'compute', icon: <DesktopOutlined />, label: '云主机' },
    { key: 'image', icon: <FileImageOutlined />, label: '镜像' },
    { key: 'storage', icon: <DatabaseOutlined />, label: '存储' },
    { key: 'backup', icon: <HistoryOutlined />, label: '快照/备份' },
    { key: 'flatnet', icon: <GlobalOutlined />, label: '扁平网络' },
    { key: 'vpc', icon: <ClusterOutlined />, label: 'VPC网络' },
  ];

  // Define Resources for each Category
  const getResources = (category: string) => {
    switch (category) {
      case 'compute':
        return [
          { key: 'vm', label: '云主机实例' },
          { key: 'ssh', label: 'SSH密钥' },
          { key: 'cloudinit', label: 'Cloud init' },
          { key: 'gpu', label: 'GPU' },
        ];

      case 'image':
        return [
          { key: 'image', label: '公共镜像' },
          { key: 'template', label: '云主机模板' },
        ];

      case 'storage':
        return [
          { key: 'volume', label: '虚拟磁盘' },
          { key: 'volume-snapshot', label: '虚拟磁盘快照' },
        ];
      case 'backup':
        return [
          { key: 'snapshot', label: '云主机快照' },
          { key: 'backup', label: '云主机备份' },
          { key: 'schedule', label: '定时策略' },
        ];
      case 'flatnet':
        return [
          { key: 'nad', label: '扁平网络' },
          { key: 'lb', label: '负载均衡' },
          { key: 'ippool', label: '地址池' },
        ];
      case 'vpc':
        return [
          { key: 'vpc-subnet', label: 'VPC / 子网' },
          { key: 'eip', label: 'EIP (公网IP)' },
          { key: 'fip', label: 'FIP (浮动IP)' },
          { key: 'snat', label: 'SNAT 规则' },
          { key: 'dnat', label: 'DNAT 规则' },
        ];
      default:
        return [];
    }
  };

  // Reset active resource when category changes
  useEffect(() => {
    const resources = getResources(activeCategory);
    if (resources.length > 0) {
      setActiveResource(resources[0].key);
    }
  }, [activeCategory]);

  const renderContent = () => {
    switch (activeResource) {
      // Compute
      case 'vm':
        return (
          <VmSection
            vms={vms}
            loading={loading}
            namespacesOptions={namespacesOptions}
            nodesOptions={nodesOptions}
            cloudId={cloudId}
            nsValue={nsValue}
            nodeValue={nodeValue}
            onNsChange={onNsChange}
            onNodeChange={onNodeChange}
            onRefresh={onRefreshVms}
            onOpenReconfigure={onOpenReconfigure}
            onStart={onStart}
            onStop={onStop}
            onReboot={onReboot}
            onSoftReboot={onSoftReboot}
            onPause={onPause}
            onUnpause={onUnpause}
            onDelete={onDelete}
          />
        );
      case 'template':
        return (
          <TemplatesSection
            cloudId={cloudId}
            templates={templates}
            loading={loading}
            onRefresh={onRefreshTemplates}
          />
        );
      case 'ssh':
        return (
          <SshKeysSection
            cloudId={cloudId}
            sshKeys={sshKeys}
            loading={loading}
            onRefresh={onRefreshSshKeys}
          />
        );
      case 'cloudinit':
        return (
          <CloudInitsSection
            cloudId={cloudId}
            cloudInits={cloudInits}
            loading={loading}
            onRefresh={onRefreshCloudInits}
          />
        );
      case 'gpu':
        return (
          <GpuSection
            cloudId={cloudId}
            resources={gpus}
            loading={loading}
            onRefresh={onRefreshGpus || (() => Promise.resolve())}
          />
        );
      
      // Storage
      case 'volume':
        return (
          <VolumesSection 
            volumes={volumes}
            loading={loading}
            onRefresh={onRefreshVolumes}
            cloudId={cloudId}
            vms={vms}
          />
        );
      case 'volume-snapshot':
        return (
          <SnapshotsSection
            snapshots={snapshots}
            loading={loading}
            onRefresh={onRefreshSnapshots}
            cloudId={cloudId}
          />
        );
      case 'image':
        return (
          <ImagesSection 
            images={images}
            loading={loading}
            onRefresh={onRefreshImages}
            cloudId={cloudId}
          />
        );

      // Backup
      case 'snapshot':
        return (
          <SnapshotsSection
            snapshots={snapshots}
            loading={loading}
            onRefresh={onRefreshSnapshots}
            cloudId={cloudId}
          />
        );
      case 'backup':
        return (
          <BackupsSection
            backups={backups}
            loading={loading}
            onRefresh={onRefreshBackups}
            cloudId={cloudId}
            namespaces={namespaceObjects}
            vms={vms}
          />
        );
      case 'schedule':
        return (
          <ScheduleVmBackupsSection
            data={schedules}
            loading={loading}
            onRefresh={onRefreshSchedules}
            cloudId={cloudId}
          />
        );

      // Flat Network
      case 'nad':
        return (
          <CloudConsoleNadTable 
            dataSource={nads}
            loading={loading}
            onRefresh={onRefreshNads}
          />
        );
      case 'lb':
        return (
          <CloudConsoleLbTable 
            dataSource={lbs}
            loading={loading}
            onRefresh={onRefreshLbs}
          />
        );
      case 'ippool':
        return (
          <IPPoolsSection
            cloudId={cloudId}
            ippools={ippools}
            loading={loading}
            onRefresh={onRefreshIPPools}
          />
        );

      // VPC Network
      case 'vpc-subnet':
         return (
             <CloudConsoleVpcTable
                 dataSource={vpcs}
                 subnets={subnets}
                 loading={loading}
                 onRefresh={onRefreshVpcs}
             />
         );

      case 'eip':
        return (
          <EipSection
            cloudId={cloudId}
            eips={eips}
            subnets={subnets}
            loading={loading}
            onRefresh={onRefreshEips || (() => {})}
          />
        );
      case 'fip':
        return (
          <FipSection
            cloudId={cloudId}
            fips={fips}
            eips={eips}
            vpcs={vpcs}
            loading={loading}
            onRefresh={onRefreshFips || (() => {})}
          />
        );
      case 'snat':
        return (
          <SnatSection
            cloudId={cloudId}
            snatRules={snatRules}
            eips={eips}
            vpcs={vpcs}
            subnets={subnets}
            loading={loading}
            onRefresh={onRefreshSnatRules || (() => {})}
          />
        );
      case 'dnat':
        return (
          <DnatSection
            cloudId={cloudId}
            dnatRules={dnatRules}
            eips={eips}
            vpcs={vpcs}
            loading={loading}
            onRefresh={onRefreshDnatRules || (() => {})}
          />
        );
      default:
        return <Empty description="该功能暂未实现" />;
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'row-reverse', height: '100%', background: '#fff' }}>
      {/* Level 1: Category Menu (Right Sidebar) */}
      <div className="harvester-menu-sidebar" style={{ width: 120, borderLeft: '1px solid #f0f0f0',marginLeft:12}}>
        <Menu
          mode="inline"
          inlineIndent={10}
          selectedKeys={[activeCategory]}
          onClick={({ key }) => setActiveCategory(key)}
          items={categories.map(c => ({ key: c.key, icon: c.icon, label: c.label }))}
          style={{ height: '100%', borderRight: 0,  padding: 0 }}
        />
      </div>

      {/* Level 2: Resource Tabs (Top of Content) */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
        <div >
           <Tabs
             type='card'
             activeKey={activeResource}
             onChange={setActiveResource}
             items={getResources(activeCategory).map(r => ({
               key: r.key,
               label: r.label
             }))}
           />
        </div>
        
        {/* Level 3: Content Area */}
        <div style={{ flex: 1,  overflow: 'auto' }}>
           {renderContent()}
        </div>
      </div>
    </div>
  );
};

export default CloudConsoleHarvester;
