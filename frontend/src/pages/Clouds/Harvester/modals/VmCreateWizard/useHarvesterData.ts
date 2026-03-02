/**
 * ==============================================================================
 * 模块名称: Harvester 数据获取钩子 (useHarvesterData Hook)
 * 文件路径: src/pages/Clouds/Harvester/modals/VmCreateWizard/useHarvesterData.ts
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
import { fetchClouds } from '../../../../../services/api';
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
  fetchKubeOvnVpcs
} from '../../../../../services/harvesterApi';

import { parseSizeToGi } from './VmWizardUtils';

/**
 * useHarvesterData Hook
 * 
 * @param cloudId - 当前选中的云资源池 ID (或 'all')
 * @param currentCloudId - (可选) 覆盖用的云资源池 ID，优先级高于 cloudId
 * @param form - Ant Design Form 实例，用于获取表单当前值 (如 namespace) 以进行级联查询
 * @returns 包含所有资源数据、加载状态、刷新方法和格式化后的选项列表
 */
export const useHarvesterData = (cloudId: string, currentCloudId: string | undefined, form: any) => {
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
  const reloadVolumes = useCallback(async () => {
    const cid = getCid();
    if (!cid) return;
    try {
      const ns = form.getFieldValue('namespace') || 'default';
      const vols: any = await fetchHarvesterAvailableVolumes(cid, ns);
      const items: any[] = vols?.data?.items || vols?.items || ([] as any[]);
      setAvailableVolumes(items);
    } catch (e: any) {
      message.warning(e?.message || '卷列表刷新失败');
    }
  }, [getCid, form]);

  // [数据获取] 刷新命名空间
  const reloadNamespaces = useCallback(async () => {
    const cid = getCid();
    if (!cid) return;
    try {
      const res: any = await fetchHarvesterNamespaces(cid);
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
        namespace: x?.metadata?.namespace || 'default', // [修复] 提取 Subnet 所属 Namespace，若缺失则默认为 default
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
  // [业务规则] 过滤掉已挂载 (attached/inUse/mounted) 的卷，防止重复挂载
  const volumeOptions = useMemo(() => (availableVolumes || [])
    .filter((v: any) => {
      if (!v?.pvcName) return false;
      const attachedArr = Array.isArray(v?.attachedTo) ? v.attachedTo : [];
      const attachedFlag = Boolean(v?.attached || v?.inUse || v?.used || v?.mounted);
      return attachedArr.length === 0 && !attachedFlag;
    })
    .map((v: any) => {
      const n = parseSizeToGi(v?.size);
      const pvcName = v?.pvcName;
      return {
        label: `${pvcName || '-'}` + (n ? ` (${n} GiB)` : ''),
        value: pvcName
      };
    }), [availableVolumes]);

  // [数据处理] 命名空间选项
  const namespaceOptions = useMemo(() => (namespaces || []).map((x: any) => ({ label: x?.metadata?.name || x?.name || '-', value: x?.metadata?.name || x?.name })), [namespaces]);

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
  
  // [数据处理] Kube-OVN VPC 选项
  const kubeVpcOptions = useMemo(() => (kubeVpcs || []).map((x: any) => ({ label: x?.name || '-', value: x?.name })), [kubeVpcs]);
  
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

  // [数据处理] 默认存储类
  // [业务规则] 查找标记为 is-default-class 的存储类，如果没有则使用列表第一个
  const defaultStorageClassName = useMemo(() => {
    const list: any[] = Array.isArray(storageClasses) ? storageClasses : [];
    const hit = list.find((x: any) => {
      const flag = x?.annotations?.['storageclass.kubernetes.io/is-default-class']
        || x?.metadata?.annotations?.['storageclass.kubernetes.io/is-default-class']
        || x?.isDefault;
      return String(flag || '').toLowerCase() === 'true';
    });
    return (hit?.name || list[0]?.name || undefined);
  }, [storageClasses]);

  // [数据处理] SSH 密钥选项
  const sshKeyOptions = useMemo(() => (sshKeys || []).map((x: any) => {
    const name = x?.metadata?.name || x?.name;
    const ns = x?.metadata?.namespace || x?.namespace;
    return {
      label: name,
      value: name // Harvester uses name reference
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
