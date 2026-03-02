/**
 * ==============================================================================
 * 模块名称: Cloudmap 云控制台 (Cloudmap Cloud Console)
 * 文件路径: src/pages/Clouds/Console/CloudConsoleCloudmap.tsx
 * ==============================================================================
 *
 * [功能描述]
 * Cloudmap 云控制台主容器：作为 Cloudmap 专属的控制台视图，
 * 继承自 Harvester 控制台的基础功能，但增加了 Cloudmap 特有的运维增强逻辑。
 *
 * [核心增强]
 * 1. [VM 启动检查]:
 *    - 在启动 VM 前检查关联的 PVC 是否处于 Resizing 状态，防止后端 500 错误。
 * 2. [VM 强制停止]:
 *    - 支持 `id::force` 格式的停止指令，调用后端强制停止接口。
 *
 * [交互/依赖说明]
 * - 复用 Harvester 的各 Section 组件 (VmSection, VolumesSection 等)。
 * - 拦截 VmSection 的 onStart/onStop 事件，注入增强逻辑后再调用后端 API。
 * ==============================================================================
 */
import React, { useMemo } from 'react';
import { Tabs, Empty, Dropdown, Space, App } from 'antd';
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
import { startCloudProviderEcs, stopCloudProviderEcs } from '../../../services/api';

/**
 * CloudConsoleCloudmap Props 定义 (与 Harvester 保持一致)
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
  storageClasses?: any[];
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
  onStart: (iid: string) => void; // Parent passed handler (we might override)
  onStop: (iid: string) => void;  // Parent passed handler (we might override)
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

  bordered?: boolean;
  showYaml?: boolean;
  showSys?: boolean;
}

const CloudConsoleCloudmap: React.FC<Props> = ({
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
  storageClasses = [],
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
  onStart: parentOnStart, // Rename to avoid conflict
  onStop: parentOnStop,   // Rename to avoid conflict
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
  const { message } = App.useApp();

  // [数据适配] BackupsSection 需要 { metadata: { name } } 结构的 namespaces
  const namespaceObjects = useMemo(() => {
    return namespacesOptions.map(ns => ({ metadata: { name: ns } }));
  }, [namespacesOptions]);

  // [增强逻辑] 自定义 VM 启动处理
  const handleStart = async (iid: string) => {
    try {
      // Pre-flight check for resizing volumes to avoid 500 error
      const vm = vms.find((v: any) => {
        const vId = v?.metadata?.name && v?.metadata?.namespace ? `${v.metadata.namespace}/${v.metadata.name}` : (v?.InstanceId || v?.id);
        return vId === iid;
      });

      if (vm && volumes.length > 0) {
        const vmVolumes = vm?.spec?.template?.spec?.volumes || [];
        const pvcNames = vmVolumes.map((vol: any) => vol?.persistentVolumeClaim?.claimName).filter(Boolean);
        
        if (pvcNames.length > 0) {
          const vmNamespace = vm?.metadata?.namespace || vm?.namespace;
          const resizingPvc = volumes.find((pvc: any) => {
            const pvcName = pvc?.metadata?.name;
            const pvcNs = pvc?.metadata?.namespace;
            if (pvcNs !== vmNamespace || !pvcNames.includes(pvcName)) return false;
            
            const conditions = pvc?.status?.conditions || [];
            // Only block if 'Resizing' is true (Backend operation). 
            // 'FileSystemResizePending' is safe to start (User needs to resize FS manually).
            return conditions.some((c: any) => c.type === 'Resizing' && c.status === 'True');
          });
          
          if (resizingPvc) {
             message.error(`无法启动: 关联的磁盘 ${resizingPvc.metadata.name} 正在进行扩容操作 (Resizing)。请等待扩容完成。`);
             return;
          }
        }
      }

      await startCloudProviderEcs(cloudId, iid);
      message.success('已发送启动指令');
      onRefreshVms();
    } catch (e: any) {
      const errMsg = e?.message || String(e);
      if (errMsg.includes('resizing volume') || errMsg.includes('Resizing')) {
        message.warning('启动被拒绝: 关联磁盘正在进行扩容操作，请等待扩容完成后再试。');
      } else {
        message.error(errMsg || '启动失败');
      }
    }
  };

  // [增强逻辑] 自定义 VM 停止处理 (支持强制停止)
  const handleStop = async (iid: string) => {
    try {
      let force = false;
      let realId = iid;
      if (iid.endsWith('::force')) {
        force = true;
        realId = iid.replace(/::force$/, '');
      }
      await stopCloudProviderEcs(cloudId, realId, force);
      message.success(force ? '强制停止指令已下发' : '已发送停止指令');
      onRefreshVms();
    } catch (e: any) {
      message.error(`停止失败: ${e.message}`);
    }
  };

  // [结构配置] 类目与资源的二级导航配置
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
            namespaces={namespaces}
            nodesOptions={nodesOptions}
            cloudId={cloudId}
            nsValue={nsValue}
            nodeValue={nodeValue}
            onNsChange={onNsChange}
            onNodeChange={onNodeChange}
            onRefresh={onRefreshVms}
            onOpenReconfigure={onOpenReconfigure}
            onStart={handleStart} // Use enhanced handler
            onStop={handleStop}   // Use enhanced handler
            onReboot={onReboot}
            onSoftReboot={onSoftReboot}
            onPause={onPause}
            onUnpause={onUnpause}
            onDelete={onDelete}
            bordered={bordered}
            showYaml={showYaml}
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
            bordered={bordered}
            showYaml={showYaml}
          />
        );
      case 'cloudinit':
        return (
          <CloudInitsSection
            cloudId={cloudId}
            cloudInits={cloudInits}
            loading={loading}
            onRefresh={onRefreshCloudInits}
            bordered={bordered}
            showYaml={showYaml}
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
            bordered={bordered}
            showYaml={showYaml}
            showSys={showSys}
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
            bordered={bordered}
            showYaml={showYaml}
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
            vms={vms}
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
                 cloudId={cloudId}
                 vpcs={vpcs}
                 subnets={subnets}
                 namespaces={namespaces}
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
    // [二级导航] 非激活 Tab 仅显示标题；激活 Tab 渲染对应 Section 以降低无效渲染
    return tabConfig.map(cat => {
      const isActive = cat.key === activeCategory;
      // [展示规则] 未选中时展示默认资源标签；选中时展示当前 activeResource 标签
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
                style={{ cursor: 'pointer', padding: '4px 0px', display: 'inline-flex', alignItems: 'center' }}
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

export default CloudConsoleCloudmap;
