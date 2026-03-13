/**
 * ==============================================================================
 * 模块名称: Harvester 云控制台 (Harvester Cloud Console)
 * 文件路径: src/pages/Clouds/Console/CloudConsoleHarvester.tsx
 * ==============================================================================
 *
 * [功能描述]
 * 租户侧 Harvester 云控制台主容器：通过“类目 + 资源”二级导航组织各资源页面，
 * 统一承载列表展示与刷新入口，并将必要的上下文数据（如 namespaces）透传到子模块。
 *
 * [核心逻辑]
 * 1. [二级导航]:
 *    - activeCategory / activeResource 驱动 Tabs 与资源下拉选择。
 * 2. [数据适配]:
 *    - 将 namespacesOptions 转换为对象数组，以复用 BackupsSection 的入参结构。
 * 3. [内容渲染]:
 *    - renderContent 根据 activeResource 渲染对应 Section，并透传 refresh handler。
 *
 * ------------------------------------------------------------------------------
 * [交互/依赖说明 (Dependencies & Interactions)]
 * ------------------------------------------------------------------------------
 * 1. 数据流向:
 *    上游容器(拉取 Harvester 资源) -> CloudConsoleHarvester -> 各 Section(渲染/操作)
 *
 * 2. 关键依赖/接口:
 *    - 各 Section 内部通过 services/harvesterApi 发起资源操作/刷新
 * ==============================================================================
 */
import React, { useState, useEffect, useMemo } from 'react';
import { Tabs, Empty, Dropdown, Space } from 'antd';
import { CaretDownFilled } from '@ant-design/icons';
import { useAuth } from '../../../contexts/AuthContext';
import { useLicense } from '../../../contexts/LicenseContext';
import { isSystemNamespace } from '../../../utils/harvesterUtils';
import VmSection from '../Harvester/sections/VmSection';
import RecycleBinSection from '../Harvester/sections/RecycleBinSection';
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



/**
 * CloudConsoleHarvester Props 定义
 * @property cloudId - 云平台 ID
 * @property loading - 是否处于加载状态
 * @property namespacesOptions - 命名空间名称列表（字符串）
 * @property namespaces - 命名空间对象列表（供子模块复用）
 * @property onRefreshVms - 刷新实例列表
 * @property onRefreshVpcs - 刷新 VPC/子网列表
 */
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
  storageClasses?: any[]; // 添加存储类属性
  loading: boolean;
  
  // Controlled Navigation State
  activeCategory: string;
  setActiveCategory: (category: string) => void;
  activeResource: string;
  setActiveResource: (resource: string) => void;

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
  onRefreshTemplates: (force?: boolean) => void;
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

  bordered?: boolean;
  showYaml?: boolean;
  showSys?: boolean;
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
  storageClasses = [], // 添加存储类解构
  loading,
  
  // Controlled Navigation Props
  activeCategory,
  setActiveCategory,
  activeResource,
  setActiveResource,

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
  onRefreshDnatRules,
  bordered = true,
  showYaml = true,
  showSys = true
}) => {
  const { user } = useAuth();
  const { hasFeature } = useLicense();
  const ovnVpcEnabled = hasFeature('network.ovn.vpc');
  
  // [租户判断] 根据用户角色动态判断是否为租户
  const isTenantUser = useMemo(() => {
    // 租户用户：role === 'tenant' 或者有 tenantId
    return user?.role === 'tenant' || !!user?.tenantId;
  }, [user]);

  // [二级导航] 当前类目与资源：由 Props 驱动 (Controlled Component)
  // const [activeCategory, setActiveCategory] = useState('compute');
  // const [activeResource, setActiveResource] = useState('vm');

  // [数据适配] BackupsSection 需要 { metadata: { name } } 结构的 namespaces
  const namespaceObjects = useMemo(() => {
    return namespacesOptions.map(ns => ({ metadata: { name: ns } }));
  }, [namespacesOptions]);

  // [安全过滤] 过滤掉系统命名空间，仅透传业务命名空间给子组件 (VmSection/VpcsSection)
  // 防止子组件意外展示或允许操作 kube-system 等敏感命名空间
  const filteredNamespaces = useMemo(() => {
    return (namespaces || []).filter((n: any) => {
      const name = n?.metadata?.name || n?.name || '';
      return name && !isSystemNamespace(name);
    });
  }, [namespaces]);

  // [结构配置] 类目与资源的二级导航配置
  const tabConfig = useMemo(() => {
    const base: any[] = [
      {
        key: 'compute',
        label: '云主机',
        resources: [
          { key: 'vm', label: '实例' },
          { key: 'recycle-bin', label: '回收站' },
          { key: 'template', label: '模板' },
          { key: 'image', label: '镜像' },
          { key: 'ssh', label: 'SSH密钥' },
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
    ];
    if (ovnVpcEnabled) {
      base.push({
        key: 'vpc',
        label: 'VPC',
        resources: [
          { key: 'vpc-subnet', label: '网络' },
          { key: 'eip', label: 'EIP' },
          { key: 'fip', label: 'FIP' },
          { key: 'snat', label: 'SNAT' },
          { key: 'dnat', label: 'DNAT' },
        ]
      });
    }
    return base;
  }, [ovnVpcEnabled]);

  useEffect(() => {
    if (!ovnVpcEnabled && activeCategory === 'vpc') {
      setActiveCategory('compute');
      setActiveResource('vm');
    }
  }, [activeCategory, ovnVpcEnabled, setActiveCategory, setActiveResource]);

  const getDefaultResource = (catKey: string) => {
    const cat = tabConfig.find(c => c.key === catKey);
    return cat ? cat.resources[0].key : '';
  };

  const renderContent = () => {
    if (!ovnVpcEnabled && ['vpc-subnet', 'eip', 'fip', 'snat', 'dnat'].includes(activeResource)) {
      return <Empty description="未授权" />;
    }
    // [内容渲染] 根据 activeResource 映射到具体 Section，并透传资源数据与刷新函数
    switch (activeResource) {
      // Compute
      case 'vm':
        return (
          <VmSection
            vms={vms}
            images={images}
            volumes={volumes}
            loading={loading}
            namespacesOptions={namespacesOptions}
            namespaces={filteredNamespaces}
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
            isTenant={isTenantUser}
            bordered={bordered}
          />
        );
      case 'recycle-bin':
        return (
          <RecycleBinSection
            vms={vms}
            loading={loading}
            cloudId={cloudId}
            onRefresh={onRefreshVms}
            namespaces={filteredNamespaces}
            volumes={volumes}
            images={images}
            isTenant={isTenantUser}
          />
        );
      case 'template':
        return (
          <TemplatesSection
            cloudId={cloudId}
            templates={templates}
            loading={loading}
            onRefresh={onRefreshTemplates}
            isTenant={isTenantUser}
            bordered={bordered}
          />
        );
      case 'ssh':
        return (
          <SshKeysSection
            cloudId={cloudId}
            sshKeys={sshKeys}
            loading={loading}
            onRefresh={onRefreshSshKeys}
            isTenant={isTenantUser}
            bordered={bordered}
          />
        );
      case 'cloudinit':
        return (
          <CloudInitsSection
            cloudId={cloudId}
            cloudInits={cloudInits}
            loading={loading}
            onRefresh={onRefreshCloudInits}
            isTenant={isTenantUser}
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
            storageClasses={storageClasses}
            namespacesOptions={namespacesOptions}
            isTenant={isTenantUser}
            bordered={bordered}
          />
        );
      case 'volume-snapshot':
        return (
          <SnapshotsSection
            snapshots={snapshots}
            loading={loading}
            onRefresh={onRefreshSnapshots}
            cloudId={cloudId}
            isTenant={isTenantUser}
            namespaces={namespaceObjects}
            bordered={bordered}
          />
        );
      case 'image':
        return (
          <ImagesSection 
            images={images}
            loading={loading}
            onRefresh={onRefreshImages}
            cloudId={cloudId}
            isTenant={isTenantUser}
            bordered={bordered}
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
            isTenant={isTenantUser}
            bordered={bordered}
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
            isTenant={isTenantUser}
            bordered={bordered}
          />
        );
      case 'schedule':
        return (
          <ScheduleVmBackupsSection
            data={schedules}
            loading={loading}
            onRefresh={onRefreshSchedules}
            cloudId={cloudId}
            vms={vms}
            isTenant={isTenantUser}
            bordered={bordered}
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
            isTenant={isTenantUser}
            bordered={bordered}
          />
        );
      case 'lb':
        return (
          <LoadBalancersSection 
            loadBalancers={lbs}
            loading={loading}
            onRefresh={onRefreshLbs}
            cloudId={cloudId}
            namespaces={namespaceObjects}
            isTenant={isTenantUser}
            bordered={bordered}
          />
        );
      case 'ippool':
        return (
          <IPPoolsSection
            cloudId={cloudId}
            ippools={ippools}
            loading={loading}
            onRefresh={onRefreshIPPools}
            isTenant={isTenantUser}
            bordered={bordered}
          />
        );

      // VPC Network
      case 'vpc-subnet':
         return (
             <VpcsSection
                 cloudId={cloudId}
                 vpcs={vpcs}
                 subnets={subnets}
                 namespaces={filteredNamespaces}
                 loading={loading}
                 onRefresh={onRefreshVpcs}
                 bordered={bordered}
                 showYaml={showYaml}
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
            bordered={bordered}
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
            bordered={bordered}
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
            bordered={bordered}
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
            bordered={bordered}
          />
        );
      default:
        return <Empty description="该功能暂未实现" />;
    }
  };

  const tabItems = useMemo(() => {
    // [二级导航] 非激活 Tab 仅显示标题；激活 Tab 渲染对应 Section 以降低无效渲染
    return tabConfig.map(cat => {
      const isActive = cat.key === activeCategory;
      // [展示规则] 未选中时展示默认资源标签；选中时展示当前 activeResource 标签
      const currentResKey = isActive ? activeResource : cat.resources[0].key;
      const currentResLabel = cat.resources.find((r: any) => r.key === currentResKey)?.label || cat.resources[0].label;

      return {
        key: cat.key,
        label: (
          <Space size={4} align="center">
            <span>{cat.label} {currentResLabel}</span>
            <Dropdown
              menu={{
                items: cat.resources.map((res: any) => ({
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
  }, [tabConfig, activeCategory, activeResource, setActiveCategory, setActiveResource, vms, templates, sshKeys, volumes, images, snapshots, backups, schedules, cloudInits, gpus, ippools, nads, lbs, vpcs, subnets, eips, fips, snatRules, dnatRules, loading, namespacesOptions, namespaces, nodesOptions, nsValue, nodeValue]);

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
