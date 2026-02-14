import { useState, useCallback, useMemo } from 'react';
import { message } from 'antd';
import {
  fetchClouds
} from '../../../../../services/api';
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

export const useHarvesterData = (cloudId: string, currentCloudId: string | undefined, form: any) => {
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

  const getCid = useCallback(() => currentCloudId || (cloudId !== 'all' ? cloudId : undefined), [currentCloudId, cloudId]);

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

  const reloadNamespaces = useCallback(async () => {
    const cid = getCid();
    if (!cid) return;
    try {
      const res: any = await fetchHarvesterNamespaces(cid);
      const items: any[] = res?.data?.items || res?.items || [];
      setNamespaces(items);
    } catch { }
  }, [getCid]);

  const reloadNads = useCallback(async () => {
    const cid = getCid();
    if (!cid) return;
    try {
      const res: any = await fetchHarvesterNads(cid);
      const items: any[] = res?.data?.items || [];
      setNads(items);
    } catch { }
  }, [getCid]);

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

  const reloadKubeSubnets = useCallback(async () => {
    const cid = getCid();
    if (!cid) return;
    try {
      const json: any = await fetchKubeOvnSubnets(cid);
      const items: any[] = json?.data?.items || json?.items || [];
      const normalized = items.map((x: any) => ({
        ...x,
        name: x?.metadata?.name || x?.name,
        vpc: x?.spec?.vpc || x?.vpc,
        cidr: x?.spec?.cidrBlock || x?.cidr
      }));
      setKubeSubnets(normalized);
    } catch (e: any) {
      message.warning(e?.message || 'Kube-OVN 子网列表刷新失败');
    }
  }, [getCid]);

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

  // Derived state
  const imageOptions = useMemo(() => (images || []).map((x: any) => {
    const name = x?.metadata?.name || x?.name;
    const ns = x?.metadata?.namespace || x?.namespace;
    const disp = x?.spec?.displayName || x?.displayName || name;
    return {
      label: disp || '-',
      value: ns && name ? `${ns}/${name}` : name
    };
  }), [images]);
  
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

  const namespaceOptions = useMemo(() => (namespaces || []).map((x: any) => ({ label: x?.metadata?.name || x?.name || '-', value: x?.metadata?.name || x?.name })), [namespaces]);

  const nadOptions = useMemo(() => (nads || []).map((x: any) => {
    const name = x?.metadata?.name || x?.name;
    const ns = x?.metadata?.namespace || x?.namespace;
    let type = '' as any; let vlan: any = undefined;
    try { const cfg = JSON.parse(x?.spec?.config || '{}'); type = String(cfg?.type || '').toLowerCase(); vlan = cfg?.vlan; } catch {}
    const tag = type || '-';
    const labelBase = `${name || '-'} (${ns || '-'})`;
    const label = vlan ? `${labelBase} · ${tag} · VLAN ${vlan}` : `${labelBase} · ${tag}`;
    return {
      label,
      value: ns && name ? `${ns}/${name}` : (name || '-'),
      _type: tag
    };
  }), [nads]);
  
  const kubeSubnetOptions = useMemo(() => (kubeSubnets || []).map((x: any) => ({ label: `${x?.name || '-'} (${x?.vpc || '-'})`, value: x?.name })), [kubeSubnets]);
  
  const kubeVpcOptions = useMemo(() => (kubeVpcs || []).map((x: any) => ({ label: x?.name || '-', value: x?.name })), [kubeVpcs]);
  
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
