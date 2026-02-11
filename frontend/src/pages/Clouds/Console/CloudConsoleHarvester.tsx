import React, { useState, useEffect, useMemo } from 'react';
import { Tabs, Empty, Dropdown, Space } from 'antd';
import { DownOutlined } from '@ant-design/icons';
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
import NadsSection from '../Harvester/sections/NadsSection';
import LoadBalancersSection from '../Harvester/sections/LoadBalancersSection';
import VpcsSection from '../Harvester/kube-ovn/VpcsSection';



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
  namespaces?: any[];
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
  namespaces,
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

  const tabConfig = useMemo(() => [
    {
      key: 'compute',
      label: '云主机',
      resources: [
        { key: 'vm', label: '实例' },
        { key: 'image', label: '镜像' },
        { key: 'ssh', label: 'SSH密钥' },
        { key: 'cloudinit', label: 'Cloud init' },
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
        { key: 'snapshot', label: '快照' },
        { key: 'backup', label: '备份' },
        { key: 'schedule', label: '定时策略' },
      ]
    },
    {
      key: 'flatnet',
      label: 'VLAN',
      resources: [
        { key: 'nad', label: '网络' },
        { key: 'lb', label: 'SLB' },
        { key: 'ippool', label: '地址池' },
      ]
    },
    {
      key: 'vpc',
      label: 'VPC',
      resources: [
         { key: 'vpc-subnet', label: '网络' },
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

  const renderContent = () => {
    switch (activeResource) {
      // Compute
      case 'vm':
        return (
          <VmSection
            vms={vms}
            images={images}
            loading={loading}
            namespacesOptions={namespacesOptions}
            namespaces={namespaces}
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
          <BackupsSection
            backups={backups}
            loading={loading}
            onRefresh={onRefreshBackups}
            cloudId={cloudId}
            namespaces={namespaceObjects}
            vms={vms}
            type="snapshot"
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
          <NadsSection 
            nads={nads}
            loading={loading}
            onRefresh={onRefreshNads}
            cloudId={cloudId}
          />
        );
      case 'lb':
        return (
          <LoadBalancersSection 
            loadBalancers={lbs}
            loading={loading}
            onRefresh={onRefreshLbs}
            cloudId={cloudId}
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
             <VpcsSection
                 vpcs={vpcs}
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

  const tabItems = useMemo(() => {
    return tabConfig.map(cat => {
      const isActive = cat.key === activeCategory;
      // Inactive tabs show default resource label. Active tab shows current resource label.
      const currentResKey = isActive ? activeResource : cat.resources[0].key;
      const currentResLabel = cat.resources.find(r => r.key === currentResKey)?.label || cat.resources[0].label;

      return {
        key: cat.key,
        label: (
          <Space size={4}>
            <span>{cat.label} {currentResLabel}</span>
            <Dropdown
              menu={{
                items: cat.resources.map(res => ({
                  key: res.key,
                  label: res.label,
                  onClick: (e: any) => {
                    e.domEvent.stopPropagation();
                    setActiveCategory(cat.key);
                    setActiveResource(res.key);
                  }
                })),
                selectedKeys: [isActive ? activeResource : '']
              }}
              trigger={['click']}
            >
              <span 
                onClick={(e) => e.stopPropagation()} 
                style={{ cursor: 'pointer', padding: '4px 8px', display: 'inline-flex', alignItems: 'center' }}
              >
                <DownOutlined style={{ fontSize: 12 }} />
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
  }, [tabConfig, activeCategory, activeResource, vms, templates, sshKeys, volumes, images, snapshots, backups, schedules, cloudInits, gpus, ippools, nads, lbs, vpcs, subnets, eips, fips, snatRules, dnatRules, loading, namespacesOptions, namespaces, nodesOptions, nsValue, nodeValue]);

  return (
    <div style={{ height: '100%', background: '#fff'}}>
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

export default CloudConsoleHarvester;
