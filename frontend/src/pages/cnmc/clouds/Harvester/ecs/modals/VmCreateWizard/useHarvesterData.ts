/**
 * ==============================================================================
 * 模块名称: Harvester 数据获取钩子 (useHarvesterData Hook)
 * 文件路径: frontend/src/pages/cnmc/clouds/Harvester/ecs/modals/VmCreateWizard/useHarvesterData.ts
 * ==============================================================================
 * 
 * [功能描述]
 * 为 Harvester 虚拟机创建向导提供统一的数据获取和状态管理逻辑。
 * 负责加载镜像、网络、存储卷、节点、GPU/USB 设备等资源，并将其格式化为
 * UI 组件可直接使用的选项列表。处理资源间的依赖关系（如 Namespace 过滤）。
 * 
 * [核心逻辑]
 * - [状态同步] 统一管理十余种资源数据的 loading/error/data 状态
 * - [业务规则] 基于 Cloud ID (cid) 进行数据隔离，支持 'all' 模式下的特定云切换
 * - [数据处理] 将 Harvester CRD 数据转换为标准 Select Option 格式 (label/value)
 * - [依赖管理] 监听 Cloud ID 变化自动重置数据，Namespace 变化触发相关资源刷新
 * 
 * === 下游 API 引用 ===
 * - GET /api/clouds                                              获取云资源池列表
 * - GET /api/clouds/{cloudId}/resources/harvester/images         获取镜像列表 [映射: imageOptions]
 * - GET /api/clouds/{cloudId}/resources/harvester/available-volumes 获取可用卷列表 [映射: volumeOptions, 依赖: namespace]
 * - GET /api/clouds/{cloudId}/resources/harvester/namespaces     获取命名空间 [映射: namespaceOptions]
 * - GET /api/clouds/{cloudId}/resources/nads                     获取网络附件定义 (NAD) [映射: nadOptions]
 * - GET /api/clouds/{cloudId}/resources/harvester/nodes          获取节点列表 [映射: nodes]
 * - GET /api/clouds/{cloudId}/resources/harvester/gpus           获取 GPU 资源
 * - GET /api/clouds/{cloudId}/resources/harvester/usb-devices    获取 USB 设备
 * - GET /api/clouds/{cloudId}/resources/harvester/storage-classes 获取存储类 [映射: defaultStorageClassName]
 * - GET /api/clouds/{cloudId}/resources/harvester/sshkeys        获取 SSH 密钥 [映射: sshKeyOptions]
 * - GET /api/clouds/{cloudId}/resources/subnets                  获取 Kube-OVN 子网 [映射: kubeSubnetOptions]
 * - GET /api/clouds/{cloudId}/resources/vpcs                     获取 Kube-OVN VPC [映射: kubeVpcOptions]
 */
import { useState, useCallback, useMemo } from 'react';
import { message } from 'antd';
import { fetchClouds } from '../../../../../../../services/api';
import {
  fetchHarvesterImages,
  fetchHarvesterNads,
  fetchHarvesterNamespaces,
  fetchHarvesterNodes,
  fetchHarvesterAvailableVolumes,
  fetchHarvesterGpuResources,
  fetchHarvesterUsbResources,
  fetchHarvesterStorageClasses,
  fetchHarvesterSshKeys,
  fetchKubeOvnSubnets,
  fetchKubeOvnVpcs,
  fetchHarvesterVolume
} from '../../../../../../../services/harvesterApi';

import { pickDefaultStorageClassName } from '../../../../../../../utils/harvesterUtils';
import { useHarvesterPublicNamespaces } from '../../../context/HarvesterPublicNamespacesContext';
import { parseSizeToGi } from './VmWizardUtils';
import { kubeVpcOptionsForVmWizard } from '../../../kube-ovn/lib/kubeOvnUiHelpers';
import { resolveKubeOvnSubnetNadNamespace } from './kubeOvnNadRefForVmWizard';

/**
 * useHarvesterData Hook
 * 
 * @param cloudId - 当前选中的云资源池 ID (或 'all')
 * @param currentCloudId - (可选) 覆盖用的云资源池 ID，优先级高于 cloudId
 * @param form - Ant Design Form 实例（保留用于后续扩展）
 * @param isTenant - 是否为租户模式 (用于过滤系统命名空间)
 * @param watchNamespace - 由父组件 Form.useWatch('namespace') 传入，用于卷列表过滤与刷新，避免在未挂载时读 form 触发警告
 * @returns 包含所有资源数据、加载状态、刷新方法和格式化后的选项列表
 */
export const useHarvesterData = (
  cloudId: string,
  currentCloudId: string | undefined,
  form: any,
  isTenant?: boolean,
  watchNamespace?: string | null,
) => {
  const { isPublicNamespace } = useHarvesterPublicNamespaces();
  // [状态定义] 资源数据
  const [images, setImages] = useState<any[]>([]);
  const [imageLoading, setImageLoading] = useState<boolean>(false);
  
  const [availableVolumes, setAvailableVolumes] = useState<any[]>([]);
  const [namespaces, setNamespaces] = useState<any[]>([]);
  const [nads, setNads] = useState<any[]>([]);
  
  const [nodes, setNodes] = useState<any[]>([]);
  const [nodesLoading, setNodesLoading] = useState<boolean>(false);
  const [nodesError, setNodesError] = useState<string | null>(null);
  
  const [clouds, setClouds] = useState<any[]>([]);
  const [currentProvider, setCurrentProvider] = useState<string | undefined>(undefined);
  
  const [kubeSubnets, setKubeSubnets] = useState<any[]>([]);
  const [kubeVpcs, setKubeVpcs] = useState<any[]>([]);
  
  const [gpuResources, setGpuResources] = useState<any[]>([]);
  const [usbResources, setUsbResources] = useState<any[]>([]);
  
  const [storageClasses, setStorageClasses] = useState<any[]>([]);
  const [storageClassLoading, setStorageClassLoading] = useState<boolean>(false);
  
  const [sshKeys, setSshKeys] = useState<any[]>([]);

  // [辅助逻辑] 获取有效的 Cloud ID
  // 优先使用 currentCloudId，如果 cloudId 为 'all' 则不返回有效 ID (除非有 currentCloudId)
  const getCid = useCallback(() => currentCloudId || (cloudId !== 'all' ? cloudId : undefined), [currentCloudId, cloudId]);

  // [数据获取] 刷新镜像列表
  const reloadImages = useCallback(async () => {
    const cid = getCid();
    if (!cid) return;
    try {
      setImageLoading(true);
      const imgs: any = await fetchHarvesterImages(cid);
      const items: any[] = imgs?.data?.items || [];
      setImages(items);
    } catch (e: any) {
      message.warning(e?.message || '镜像列表刷新失败');
    } finally {
      setImageLoading(false);
    }
  }, [getCid]);

  // [数据获取] 刷新可用卷列表
  // [业务规则] 依赖表单中的 namespace 字段进行过滤
  // [别名补齐] 为避免 available-volumes 返回数据不含 annotations，打开下拉时逐条查询卷详情补齐 alias
  const reloadVolumes = useCallback(async () => {
    const cid = getCid();
    if (!cid) return;
    try {
      const ns = (watchNamespace && String(watchNamespace).trim()) || 'default';
      const vols: any = await fetchHarvesterAvailableVolumes(cid, ns);
      const items: any[] = vols?.data?.items || vols?.items || ([] as any[]);
      const normalized = (items || []).map((x: any) => {
        const meta = x?.metadata || {};
        const ann = meta?.annotations || x?.annotations || {};
        const name = x?.pvcName || meta?.name || x?.name;
        const namespace = meta?.namespace || x?.namespace || x?.ns;
        const alias = ann?.['tower.io/alias'] || x?.Alias || x?.alias;
        return { ...x, pvcName: name, namespace, alias };
      });
      const enriched = await Promise.all(
        normalized.map(async (x: any) => {
          if (x.alias) return x;
          try {
            const detail: any = await fetchHarvesterVolume(cid, x.namespace, x.pvcName);
            const ann = detail?.metadata?.annotations || detail?.data?.metadata?.annotations || {};
            const alias = ann?.['tower.io/alias'];
            return alias ? { ...x, alias } : x;
          } catch {
            return x;
          }
        })
      );
      setAvailableVolumes(enriched);
    } catch (e: any) {
      message.warning(e?.message || '卷列表刷新失败');
    }
  }, [getCid, watchNamespace]);

  // [数据获取] 刷新命名空间
  // [业务规则] 创建 VM 时，任何用户都不应在系统命名空间创建，使用 excludeSystem=true
  const reloadNamespaces = useCallback(async () => {
    const cid = getCid();
    if (!cid) return;
    try {
      const res: any = await fetchHarvesterNamespaces(cid, false, true); // excludeSystem=true
      const items: any[] = res?.data?.items || res?.items || [];
      setNamespaces(items);
    } catch { }
  }, [getCid]);

  // [数据获取] 刷新网络附件定义 (NAD)
  const reloadNads = useCallback(async () => {
    const cid = getCid();
    if (!cid) return;
    try {
      const res: any = await fetchHarvesterNads(cid);
      const items: any[] = res?.data?.items || [];
      setNads(items);
    } catch { }
  }, [getCid]);

  // [数据获取] 刷新节点列表
  const reloadNodes = useCallback(async (cidArg?: string) => {
    const cid = cidArg || getCid();
    if (!cid) return;
    try {
      setNodesLoading(true);
      const nd: any = await fetchHarvesterNodes(cid);
      const items: any[] = nd?.data?.items || [];
      setNodes(items);
      setNodesError(null);
    } catch (e: any) {
      setNodes([]);
      setNodesError(e?.message || '主机列表刷新失败');
      message.warning(e?.message || '主机列表刷新失败');
    } finally {
      setNodesLoading(false);
    }
  }, [getCid]);

  // [数据获取] 刷新 GPU 资源
  const reloadGpuResources = useCallback(async () => {
    const cid = getCid();
    if (!cid) return;
    try {
      const json: any = await fetchHarvesterGpuResources(cid);
      const items: any[] = json?.data?.items || json?.items || [];
      setGpuResources(items);
    } catch (e: any) {
      message.warning(e?.message || 'GPU 资源列表刷新失败');
    }
  }, [getCid]);

  // [数据获取] 刷新 USB 资源
  const reloadUsbResources = useCallback(async () => {
    const cid = getCid();
    if (!cid) return;
    try {
      const json: any = await fetchHarvesterUsbResources(cid);
      const items: any[] = json?.data?.items || json?.items || [];
      setUsbResources(items);
    } catch (e: any) {
      message.warning(e?.message || 'USB 资源列表刷新失败');
    }
  }, [getCid]);

  // [数据获取] 刷新存储类
  const reloadStorageClasses = useCallback(async () => {
    const cid = getCid();
    if (!cid) return;
    try {
      setStorageClassLoading(true);
      const json: any = await fetchHarvesterStorageClasses(cid);
      const items: any[] = json?.data?.items || json?.items || [];
      setStorageClasses(items);
    } catch (e: any) {
      message.warning(e?.message || '存储类列表刷新失败');
    } finally {
      setStorageClassLoading(false);
    }
  }, [getCid]);

  // [数据获取] 刷新 SSH 密钥
  const reloadSshKeys = useCallback(async () => {
    const cid = getCid();
    if (!cid) return;
    try {
      const json: any = await fetchHarvesterSshKeys(cid);
      const items: any[] = json?.data?.items || json?.items || [];
      setSshKeys(items);
    } catch (e: any) {
      message.warning(e?.message || 'SSH Key 列表刷新失败');
    }
  }, [getCid]);

  // [数据获取] 刷新 Kube-OVN 子网
  // [数据处理] 标准化字段以适配前端组件
  const reloadKubeSubnets = useCallback(async () => {
    const cid = getCid();
    if (!cid) return;
    try {
      const json: any = await fetchKubeOvnSubnets(cid);
      const items: any[] = json?.data?.items || json?.items || [];
      const normalized = items.map((x: any) => ({
        ...x,
        name: x?.metadata?.name || x?.name,
        namespace: x?.metadata?.namespace || resolveKubeOvnSubnetNadNamespace(x) || undefined,
        vpc: x?.spec?.vpc || x?.vpc,
        cidr: x?.spec?.cidrBlock || x?.cidr
      }));
      setKubeSubnets(normalized);
    } catch (e: any) {
      message.warning(e?.message || 'Kube-OVN 子网列表刷新失败');
    }
  }, [getCid]);

  // [数据获取] 刷新 Kube-OVN VPC
  const reloadKubeVpcs = useCallback(async () => {
    const cid = getCid();
    if (!cid) return;
    try {
      const json: any = await fetchKubeOvnVpcs(cid);
      const items: any[] = json?.data?.items || json?.items || [];
      const normalized = items.map((x: any) => ({
        ...x,
        name: x?.metadata?.name || x?.name
      }));
      setKubeVpcs(normalized);
    } catch (e: any) {
      message.warning(e?.message || 'Kube-OVN VPC 列表刷新失败');
    }
  }, [getCid]);

  // [数据获取] 加载云资源池列表并确定当前 Provider 类型
  const loadClouds = useCallback(async () => {
    try {
      const list: any[] = await fetchClouds();
      setClouds(Array.isArray(list) ? list : []);
      const targetId = getCid();
      if (targetId) {
        const c = list.find((x: any) => x.id === targetId);
        if (c) setCurrentProvider(String(c?.config?.provider || c?.type || '').toLowerCase());
      }
    } catch { }
  }, [getCid]);

  // === Derived State (Options for UI) ===

  // [数据处理] 镜像选项列表
  // [业务规则] 显示名称优先级: Spec DisplayName > Labels > Annotations > Name
  const imageOptions = useMemo(() => (images || []).map((x: any) => {
    const name = x?.metadata?.name || x?.name;
    const ns = x?.metadata?.namespace || x?.namespace;
    const disp =
      x?.spec?.displayName ||
      x?.metadata?.labels?.['harvesterhci.io/imageDisplayName'] ||
      x?.metadata?.annotations?.['harvesterhci.io/image-name'] ||
      x?.metadata?.annotations?.['field.cattle.io/displayName'] ||
      x?.displayName ||
      name;
    return {
      label: disp || '-',
      value: ns && name ? `${ns}/${name}` : name
    };
  }), [images]);
  
  // [数据处理] 卷选项列表
  // [业务规则] 仅显示当前命名空间、未挂载、状态正常的卷；标签优先展示 PVC 别名
  const volumeOptions = useMemo(() => {
    const nsTarget = String(watchNamespace ?? '');
    return (availableVolumes || [])
      .filter((v: any) => {
        if (!v?.pvcName) return false;
        const ns = v?.namespace || v?.metadata?.namespace || v?.ns;
        if (nsTarget && ns && String(ns) !== nsTarget) return false;
        const attachedArr = Array.isArray(v?.attachedTo) ? v.attachedTo : [];
        const attachedFlag = Boolean(v?.attached || v?.inUse || v?.used || v?.mounted);
        if (attachedArr.length > 0 || attachedFlag) return false;
        const stRaw = v?.phase || v?.status?.phase || v?.status?.state || v?.state;
        const st = String(stRaw || '').toLowerCase();
        if (!st) return true;
        const ok = ['healthy','bound','available','detached'].includes(st);
        return ok;
      })
      .map((v: any) => {
        const n = parseSizeToGi(v?.size);
        const pvcName = v?.pvcName;
        const alias = (
          v?.metadata?.annotations?.['tower.io/alias']
          || v?.annotations?.['tower.io/alias']
          || v?.rawData?.metadata?.annotations?.['tower.io/alias']
          || v?.Alias
          || v?.alias
          || v?.Annotation?.['tower.io/alias']
          || v?.Annotations?.['tower.io/alias']
          || (typeof (v as any)?.['tower.io/alias'] !== 'undefined' ? (v as any)['tower.io/alias'] : undefined)
        );
        const base = alias || (pvcName || '-');
        const label = base + (n ? ` (${n} GiB)` : '');
        return { label, value: pvcName };
      });
  }, [availableVolumes, watchNamespace]);

  // [数据处理] 命名空间选项
  // [业务规则] 创建 VM 时，任何用户都不应在系统命名空间创建
  // 注意：后端已过滤系统命名空间，这里只需要处理租户模式的公共命名空间过滤
  const namespaceOptions = useMemo(() => {
    let list = namespaces || [];

    if (isTenant) {
      list = list.filter((n: any) => {
        const name = n?.metadata?.name || n?.name;
        const sc = String(n?.metadata?.labels?.['tower.io/scenario'] || '').toLowerCase();
        if (sc === 'public' || sc === 'admin') return false;
        return !isPublicNamespace(name);
      });
    }
    
    return list.map((x: any) => ({ label: x?.metadata?.name || x?.name || '-', value: x?.metadata?.name || x?.name }));
  }, [namespaces, isTenant, isPublicNamespace]);

  // [数据处理] 网络 (NAD) 选项
  // [业务规则] 格式化显示 VLAN ID 和网络类型
  const nadOptions = useMemo(() => (nads || []).map((x: any) => {
    const name = x?.metadata?.name || x?.name;
    const ns = x?.metadata?.namespace || x?.namespace;
    let type = '' as any;
    let vlan: any = undefined;
    try {
      const cfg = JSON.parse(x?.spec?.config || '{}');
      type = String(cfg?.type || '').toLowerCase();
      vlan = cfg?.vlan;
    } catch { }
    const tag = type || '-';
    const labelBase = `${name || '-'} (${ns || '-'})`;
    const label = vlan ? `${labelBase} · ${tag} · VLAN ${vlan}` : `${labelBase} · ${tag}`;
    return {
      label,
      value: ns && name ? `${ns}/${name}` : (name || '-'),
      _type: tag
    };
  }), [nads]);
  
  // [数据处理] Kube-OVN 子网选项
  const kubeSubnetOptions = useMemo(() => (kubeSubnets || []).map((x: any) => ({ label: `${x?.name || '-'} (${x?.vpc || '-'})`, value: x?.name })), [kubeSubnets]);
  
  // [数据处理] Kube-OVN VPC 选项（业务 VPC：别名展示，排除内置）
  const kubeVpcOptions = useMemo(() => kubeVpcOptionsForVmWizard(kubeVpcs), [kubeVpcs]);
  
  // [数据处理] 云资源池选项
  // [业务规则] 仅显示 Harvester 或 CloudMap 类型的资源池，并确保当前选中的 ID 始终可见
  const cloudOptions = useMemo(() => (clouds || [])
    .filter((c: any) => {
      const p = String(c?.config?.provider || c?.type || '').toLowerCase();
      // Ensure the current cloud ID is always included in the options, even if the provider type check fails
      const isCurrent = (cloudId !== 'all' && c.id === cloudId) || (currentCloudId && c.id === currentCloudId);
      return isCurrent || ['harvester', 'cloudmap'].includes(p);
     })
     .map((c: any) => {
        const name = c?.name || '-';
        const id = c?.id || '-';
        return { 
          ...c, 
          label: name === id ? name : `${name} (${id})`,
          value: c?.id 
        };
     }), [clouds, cloudId, currentCloudId]);

  // [数据处理] 默认存储类（与 harvesterUtils.pickDefaultStorageClassName 一致）
  const defaultStorageClassName = useMemo(
    () => pickDefaultStorageClassName(storageClasses),
    [storageClasses],
  );

  // [数据处理] SSH 密钥选项
  const sshKeyOptions = useMemo(() => (sshKeys || []).map((x: any) => {
    const name = x?.metadata?.name || x?.name;
    // 获取密钥别名（优先显示别名，没有则显示名称）
    const alias = x?.metadata?.annotations?.['tower.io/alias'] || x?.alias || '';
    const displayName = alias || name;
    
    // 获取公钥内容，尝试多个可能的字段路径
    const raw = x?.rawData || x;
    
    // Harvester KeyPair 的公钥可能存储在多个位置
    const publicKey = 
      raw?.spec?.publicKey || 
      raw?.status?.publicKey || 
      raw?.publicKey || 
      x?.spec?.publicKey ||
      x?.status?.publicKey ||
      x?.publicKey ||
      x?.data?.spec?.publicKey ||
      x?.data?.publicKey ||
      raw?.data?.items?.[0]?.spec?.publicKey ||
      raw?.data?.items?.[0]?.publicKey ||
      '';
    return {
      label: displayName, // 显示别名或名称
      value: name, // Harvester uses name reference
      publicKey,   // 存储公钥内容供生成 Cloud-Config 使用
    };
  }), [sshKeys]);

  return {
    images, imageLoading, reloadImages, imageOptions,
    availableVolumes, reloadVolumes, volumeOptions,
    namespaces, reloadNamespaces, namespaceOptions,
    nads, reloadNads, nadOptions,
    nodes, nodesLoading, nodesError, reloadNodes,
    clouds, loadClouds, cloudOptions, currentProvider,
    kubeSubnets, reloadKubeSubnets, kubeSubnetOptions,
    kubeVpcs, reloadKubeVpcs, kubeVpcOptions,
    gpuResources, reloadGpuResources,
    usbResources, reloadUsbResources,
    storageClasses, storageClassLoading, reloadStorageClasses, defaultStorageClassName,
    sshKeys, reloadSshKeys, sshKeyOptions
  };
};
