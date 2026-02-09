import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, Table, Tag, Space, Button, Statistic, Row, Col, Alert, Tabs, Descriptions, Modal, Select, Popconfirm, message, Dropdown, Typography } from 'antd';
import NodesSection from './sections/NodesSection';
import ImagesSection from './sections/ImagesSection';
import VolumesSection from './sections/VolumesSection';
import NadsSection from './sections/NadsSection';
import KubeOvnVpcsSection from './kube-ovn/VpcsSection';
import KubeOvnSubnetsSection from './kube-ovn/SubnetsSection';
import KubeOvnPublicNetworksSection from './kube-ovn/PubnetSection';
import GpusSection from './sections/GpusSection';
import StorageClassesSection from './sections/StorageClassesSection';
import SnapshotsSection from './sections/SnapshotsSection';
import BackupsSection from './sections/BackupsSection';
import SshKeysSection from './sections/SshKeysSection';
import CloudInitsSection from './sections/CloudInitsSection';
import IngressesSection from './sections/IngressesSection';
import ServicesSection from './sections/ServicesSection';
import LoadBalancersSection from './sections/LoadBalancersSection';
import IPPoolsSection from './sections/IPPoolsSection';
// Re-trigger compilation
import NamespacesTab from './sections/NamespacesTab';
import { CloudUploadOutlined, CloudServerOutlined, GlobalOutlined, HddOutlined, NodeIndexOutlined, CameraOutlined, ClusterOutlined, ReloadOutlined, ArrowLeftOutlined, UnorderedListOutlined, HomeOutlined, AppstoreOutlined, LoginOutlined } from '@ant-design/icons';
import PageDetailContainer from '../../../components/PageDetailContainer';
import { API_BASE_URL, fetchClouds, fetchCloudProviderEcs, startCloudProviderEcs, stopCloudProviderEcs, rebootCloudProviderEcs, softRebootCloudProviderEcs, pauseCloudProviderEcs, unpauseCloudProviderEcs, deleteCloudProviderEcs } from '../../../services/api';
import { useAuth } from '../../../contexts/AuthContext';
import { hasPermissionForAction } from '../../../utils/accessMapping';
import { fetchHarvesterSnapshots, fetchHarvesterBackups, fetchHarvesterScheduleVmBackups, fetchHarvesterSshKeys, fetchHarvesterCloudInits, fetchHarvesterIngresses, fetchHarvesterServices, fetchHarvesterIPPools, fetchHarvesterNads, fetchHarvesterImages, fetchHarvesterVolumes, fetchHarvesterNodes, fetchHarvesterVmDetail, fetchKubeOvnVpcs, fetchKubeOvnSubnets, fetchHarvesterGpuResources, fetchHarvesterNamespaces, fetchHarvesterStorageClasses, fetchHarvesterCapabilities, fetchHarvesterTemplates, fetchCloudProviderOvnEips, fetchCloudProviderOvnFips, fetchCloudProviderOvnSnatRules, fetchCloudProviderOvnDnatRules } from '../../../services/harvesterApi';
import VmReconfigureModal from './modals/VmReconfigureModal';
import VmSection from './sections/VmSection';
import TemplatesSection from './sections/TemplatesSection';
import ScheduleVmBackupsSection from './sections/ScheduleVmBackupsSection';
import EipSection from './kube-ovn/EipSection';
import FipSection from './kube-ovn/FipSection';
import SnatSection from './kube-ovn/SnatSection';
import DnatSection from './kube-ovn/DnatSection';

interface CloudItem { id: string; name: string; region: string; type: string; config?: any; status?: string; endpoint?: string; description?: string; createdAt?: string; updatedAt?: string; }

const statusTag = (s?: string) => {
  const color = s === 'Available' ? 'green' : s === 'Pending' ? 'orange' : 'blue';
  return <Tag color={color}>{s || '-'}</Tag>;
};

const CloudDetailHarvester: React.FC<{ cloudId: string; defaultProvider?: string }> = ({ cloudId, defaultProvider }) => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const permissions = user?.permissions;
  const checkPerm = (act: string) => hasPermissionForAction(permissions || [], act);
  const [cloud, setCloud] = useState<CloudItem | null>(null);
  const [loading, setLoading] = useState(false);
  const [resourceLoading, setResourceLoading] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const [ecs, setEcs] = useState<any[]>([]);
  const [harvesterNads, setHarvesterNads] = useState<any[]>([]);
  const [harvesterImages, setHarvesterImages] = useState<any[]>([]);
  const [harvesterVolumes, setHarvesterVolumes] = useState<any[]>([]);
  const [harvesterNodes, setHarvesterNodes] = useState<any[]>([]);
  const [kubeOvnVpcs, setKubeOvnVpcs] = useState<any[]>([]);
  const [kubeOvnSubnets, setKubeOvnSubnets] = useState<any[]>([]);
  const [kubeOvnEips, setKubeOvnEips] = useState<any[]>([]);
  const [kubeOvnFips, setKubeOvnFips] = useState<any[]>([]);
  const [kubeOvnSnatRules, setKubeOvnSnatRules] = useState<any[]>([]);
  const [kubeOvnDnatRules, setKubeOvnDnatRules] = useState<any[]>([]);
  const [vmReconfOpen, setVmReconfOpen] = useState(false);
  const [vmReconfTarget, setVmReconfTarget] = useState<any | null>(null);
  const [nsFilter, setNsFilter] = useState<string>('');
  const [nodeFilter, setNodeFilter] = useState<string>('');
  const [showLog, setShowLog] = useState<boolean>(false);
  const [rawEcs, setRawEcs] = useState<any | null>(null);
  const [rawNads, setRawNads] = useState<any | null>(null);
  const [rawImages, setRawImages] = useState<any | null>(null);
  const [rawVolumes, setRawVolumes] = useState<any | null>(null);
  const [rawNodes, setRawNodes] = useState<any | null>(null);
  const [rawVpcs, setRawVpcs] = useState<any | null>(null);
  const [rawSubnets, setRawSubnets] = useState<any | null>(null);
  const [rawEips, setRawEips] = useState<any | null>(null);
  const [rawFips, setRawFips] = useState<any | null>(null);
  const [rawSnatRules, setRawSnatRules] = useState<any | null>(null);
  const [rawDnatRules, setRawDnatRules] = useState<any | null>(null);
  const [harvesterGpuResources, setHarvesterGpuResources] = useState<any[]>([]);
  const [rawGpu, setRawGpu] = useState<any | null>(null);
  const [harvesterNamespaces, setHarvesterNamespaces] = useState<any[]>([]);
  const [rawNamespaces, setRawNamespaces] = useState<any | null>(null);
  const [harvesterStorageClasses, setHarvesterStorageClasses] = useState<any[]>([]);
  const [capabilities, setCapabilities] = useState<any>(null);
  
  // New Resources State
  const [harvesterSnapshots, setHarvesterSnapshots] = useState<any[]>([]);
  const [harvesterBackups, setHarvesterBackups] = useState<any[]>([]);
  const [harvesterSshKeys, setHarvesterSshKeys] = useState<any[]>([]);
  const [harvesterCloudInits, setHarvesterCloudInits] = useState<any[]>([]);
  const [harvesterIngresses, setHarvesterIngresses] = useState<any[]>([]);
  const [harvesterServices, setHarvesterServices] = useState<any[]>([]);
  const [harvesterIPPools, setHarvesterIPPools] = useState<any[]>([]);
  const [harvesterTemplates, setHarvesterTemplates] = useState<any[]>([]);
  const [harvesterScheduleVmBackups, setHarvesterScheduleVmBackups] = useState<any[]>([]);
  
  // Buffer for VM Status Updates to prevent frequent re-renders
  const vmStatusBuffer = React.useRef<Map<string, any>>(new Map());

  const [rawSnapshots, setRawSnapshots] = useState<any | null>(null);
  const [rawBackups, setRawBackups] = useState<any | null>(null);
  const [rawSshKeys, setRawSshKeys] = useState<any | null>(null);
  const [rawCloudInits, setRawCloudInits] = useState<any | null>(null);
  const [rawIngresses, setRawIngresses] = useState<any | null>(null);
  const [rawServices, setRawServices] = useState<any | null>(null);
  const [rawTemplates, setRawTemplates] = useState<any | null>(null);
  const [rawScheduleVmBackups, setRawScheduleVmBackups] = useState<any | null>(null);
  const [rawIPPools, setRawIPPools] = useState<any | null>(null);

  // Single Resource Refresh: Nodes
  const [nodesLoading, setNodesLoading] = useState(false);
  const refreshNodes = async () => {
      if (nodesLoading) return;
      setNodesLoading(true);
      try {
        const nodesJson = await fetchHarvesterNodes(cloudId);
        const nodesList: any[] = (nodesJson as any)?.data?.items || [];
        setHarvesterNodes(Array.isArray(nodesList) ? nodesList : []);
        setRawNodes(nodesJson || null);
        message.success('节点刷新成功');
      } catch (e: any) {
        message.error(`刷新节点失败: ${e?.message || '未知错误'}`);
      } finally {
        setNodesLoading(false);
      }
  };

  // Single Resource Refresh: NADs
  const [nadsLoading, setNadsLoading] = useState(false);
  const refreshNads = async () => {
      if (nadsLoading) return;
      setNadsLoading(true);
      try {
        const nadsJson = await fetchHarvesterNads(cloudId);
        const nadsList: any[] = (nadsJson as any)?.data?.items || [];
        setHarvesterNads(Array.isArray(nadsList) ? nadsList : []);
        setRawNads(nadsJson || null);
        message.success('NAD网络刷新成功');
      } catch (e: any) {
        message.error(`刷新NAD网络失败: ${e?.message || '未知错误'}`);
      } finally {
        setNadsLoading(false);
      }
  };

  const loadAll = async (force: boolean | any = false) => {
    // If force is strictly true, or if it's an event object (meaning triggered by UI interaction like click), treat as force sync.
    const isForce = force === true || (typeof force === 'object' && force !== null);

    // Helper for independent loading
    const load = async (key: string, fn: () => Promise<any>, cb: (json: any) => void) => {
        setResourceLoading(prev => ({ ...prev, [key]: true }));
        try {
            const json = await fn();
            cb(json);
        } catch (e) {
            console.warn(`Failed to load ${key}`, e);
        } finally {
            setResourceLoading(prev => ({ ...prev, [key]: false }));
        }
    };

    // 1. Cloud Info (Fast)
    load('cloud', fetchClouds, (cloudsRes) => {
       const cloudList: any[] = Array.isArray(cloudsRes) ? cloudsRes : (Array.isArray((cloudsRes as any)?.data) ? (cloudsRes as any).data : []);
       setCloud((cloudList || []).find((c:any)=> String(c.id) === String(cloudId)) || null);
    });

    // 2. Fire independent requests
    if (checkPerm('clouds.instances:read')) {
      load('ecs', () => fetchCloudProviderEcs(cloudId, isForce), (json) => {
        const list: any[] = Array.isArray((json as any)?.data) ? (json as any).data : (((json as any)?.data?.Instances?.Instance) || ((json as any)?.data?.items) || ((json as any)?.data?.data) || []);
        setEcs(Array.isArray(list) ? list : []);
        setRawEcs(json || null);
      });
    }

    if (checkPerm('clouds.networks:read')) {
      load('nads', () => fetchHarvesterNads(cloudId, isForce), (json) => {
        const list: any[] = (json as any)?.data?.items || [];
        setHarvesterNads(Array.isArray(list) ? list : []);
        setRawNads(json || null);
      });
    }

    if (checkPerm('clouds.images:read')) {
      load('images', () => fetchHarvesterImages(cloudId), (json) => {
        const list: any[] = (json as any)?.data?.items || [];
        setHarvesterImages(Array.isArray(list) ? list : []);
        setRawImages(json || null);
      });
    }

    if (checkPerm('clouds.volumes:read')) {
      load('volumes', () => fetchHarvesterVolumes(cloudId), (json) => {
        const list: any[] = (json as any)?.data?.items || [];
        setHarvesterVolumes(Array.isArray(list) ? list : []);
        setRawVolumes(json || null);
      });
    }

    if (checkPerm('clouds.nodes:read')) {
      load('nodes', () => fetchHarvesterNodes(cloudId), (json) => {
        const list: any[] = (json as any)?.data?.items || [];
        setHarvesterNodes(Array.isArray(list) ? list : []);
        setRawNodes(json || null);
      });
    }

    // Pods loaded in PodsSection

    if (checkPerm('clouds.networks:read')) {
      load('vpcs', () => fetchKubeOvnVpcs(cloudId), (json) => {
        const list: any[] = (json as any)?.data?.items || [];
        setKubeOvnVpcs(Array.isArray(list) ? list : []);
        setRawVpcs(json || null);
      });

      load('subnets', () => fetchKubeOvnSubnets(cloudId), (json) => {
        const list: any[] = (json as any)?.data?.items || [];
        setKubeOvnSubnets(Array.isArray(list) ? list : []);
        setRawSubnets(json || null);
      });

      load('eips', () => fetchCloudProviderOvnEips(cloudId), (json) => {
        const list: any[] = (json as any)?.data?.items || [];
        setKubeOvnEips(Array.isArray(list) ? list : []);
        setRawEips(json || null);
      });

      load('fips', () => fetchCloudProviderOvnFips(cloudId), (json) => {
        const list: any[] = (json as any)?.data?.items || [];
        setKubeOvnFips(Array.isArray(list) ? list : []);
        setRawFips(json || null);
      });

      load('snatRules', () => fetchCloudProviderOvnSnatRules(cloudId), (json) => {
        const list: any[] = (json as any)?.data?.items || [];
        setKubeOvnSnatRules(Array.isArray(list) ? list : []);
        setRawSnatRules(json || null);
      });

      load('dnatRules', () => fetchCloudProviderOvnDnatRules(cloudId), (json) => {
        const list: any[] = (json as any)?.data?.items || [];
        setKubeOvnDnatRules(Array.isArray(list) ? list : []);
        setRawDnatRules(json || null);
      });
    }

    if (checkPerm('clouds.instances:read')) {
      load('gpu', () => fetchHarvesterGpuResources(cloudId), (json) => {
        const list: any[] = Array.isArray((json as any)?.data?.items) ? (json as any).data.items : (Array.isArray((json as any)?.items) ? (json as any).items : []);
        setHarvesterGpuResources(Array.isArray(list) ? list : []);
        setRawGpu(json || null);
      });
    }

    load('namespaces', () => fetchHarvesterNamespaces(cloudId), (json) => {
        const list: any[] = Array.isArray((json as any)?.data?.items) ? (json as any).data.items : (Array.isArray((json as any)?.items) ? (json as any).items : []);
        setHarvesterNamespaces(Array.isArray(list) ? list : []);
        setRawNamespaces(json || null);
    });

    if (checkPerm('clouds.volumes:read')) {
      load('storageClasses', () => fetchHarvesterStorageClasses(cloudId), (json) => {
        const list: any[] = Array.isArray((json as any)?.data?.items) ? (json as any).data.items : (Array.isArray((json as any)?.items) ? (json as any).items : []);
        setHarvesterStorageClasses(Array.isArray(list) ? list : []);
      });
    }

    load('capabilities', () => fetchHarvesterCapabilities(cloudId), (json) => {
        setCapabilities(json?.data || null);
    });

    if (checkPerm('clouds.snapshots:read')) {
      load('snapshots', () => fetchHarvesterSnapshots(cloudId, isForce), (json) => {
        const list: any[] = Array.isArray((json as any)?.data?.items) ? (json as any).data.items : [];
        setHarvesterSnapshots(Array.isArray(list) ? list : []);
        setRawSnapshots(json || null);
      });
    }

    if (checkPerm('clouds.backups:read')) {
      load('backups', () => fetchHarvesterBackups(cloudId, isForce), (json) => {
        const list: any[] = Array.isArray((json as any)?.data?.items) ? (json as any).data.items : [];
        setHarvesterBackups(Array.isArray(list) ? list : []);
        setRawBackups(json || null);
      });
      load('scheduleVmBackups', () => fetchHarvesterScheduleVmBackups(cloudId, isForce), (json) => {
        const list: any[] = Array.isArray((json as any)?.data?.items) ? (json as any).data.items : [];
        setHarvesterScheduleVmBackups(Array.isArray(list) ? list : []);
        setRawScheduleVmBackups(json || null);
      });
    }

    if (checkPerm('clouds.sshkeys:read')) {
      load('sshKeys', () => fetchHarvesterSshKeys(cloudId), (json) => {
        const list: any[] = Array.isArray((json as any)?.data?.items) ? (json as any).data.items : [];
        setHarvesterSshKeys(Array.isArray(list) ? list : []);
        setRawSshKeys(json || null);
      });
    }

    if (checkPerm('clouds.cloudinits:read')) {
      load('cloudInits', () => fetchHarvesterCloudInits(cloudId), (json) => {
        const list: any[] = Array.isArray((json as any)?.data?.items) ? (json as any).data.items : [];
        setHarvesterCloudInits(Array.isArray(list) ? list : []);
        setRawCloudInits(json || null);
      });
    }

    if (checkPerm('clouds.templates:read')) {
      load('templates', () => fetchHarvesterTemplates(cloudId), (json) => {
        const list: any[] = Array.isArray((json as any)?.data?.items) ? (json as any).data.items : [];
        setHarvesterTemplates(Array.isArray(list) ? list : []);
        setRawTemplates(json || null);
      });
    }

    if (checkPerm('clouds.ingresses:read')) {
      load('ingresses', () => fetchHarvesterIngresses(cloudId), (json) => {
        const list: any[] = Array.isArray((json as any)?.data?.items) ? (json as any).data.items : [];
        setHarvesterIngresses(Array.isArray(list) ? list : []);
        setRawIngresses(json || null);
      });
    }

    if (checkPerm('clouds.services:read')) {
      load('services', () => fetchHarvesterServices(cloudId), (json) => {
        const list: any[] = Array.isArray((json as any)?.data?.items) ? (json as any).data.items : [];
        setHarvesterServices(Array.isArray(list) ? list : []);
        setRawServices(json || null);
      });
    }

    if (checkPerm('clouds.ippools:read')) {
      load('ippools', () => fetchHarvesterIPPools(cloudId), (json) => {
        const list: any[] = Array.isArray((json as any)?.data?.items) ? (json as any).data.items : [];
        setHarvesterIPPools(Array.isArray(list) ? list : []);
        setRawIPPools(json || null);
      });
    }
  };

  const refreshVms = async () => {
    if (!checkPerm('clouds.instances:read')) return;
    setResourceLoading(prev => ({ ...prev, ecs: true }));
    try {
      const json = await fetchCloudProviderEcs(cloudId);
      const list: any[] = Array.isArray((json as any)?.data) ? (json as any).data : (((json as any)?.data?.Instances?.Instance) || ((json as any)?.data?.items) || ((json as any)?.data?.data) || []);
      setEcs(Array.isArray(list) ? list : []);
      setRawEcs(json || null);
    } catch (e) {
      console.warn(`Failed to load ecs`, e);
    } finally {
      setResourceLoading(prev => ({ ...prev, ecs: false }));
    }
  };

  useEffect(() => { loadAll(); }, [cloudId]);
  useEffect(() => {
    try {
      const token = localStorage.getItem('token') || '';
      const url = `${API_BASE_URL}/api/clouds/${cloudId}/resources/ecs/stream${token ? `?token=${encodeURIComponent(token)}` : ''}`;
      const es = new EventSource(url);
      es.addEventListener('vms', (ev: MessageEvent) => {
        try {
          const json = JSON.parse(String(ev.data || '{}'));
          const items: any[] = Array.isArray(json?.items) ? json.items : [];
          setEcs(items);
        } catch {}
      });
      es.addEventListener('vm_created', (ev: MessageEvent) => {
        try {
          const json = JSON.parse(String(ev.data || '{}'));
          const r = json?.item;
          if (!r) return;
          setEcs(prev => {
            const iid = String(r?.InstanceId || r?.id || '');
            if (!iid) return prev;
            if ((prev || []).some((x:any)=> String(x?.InstanceId||x?.id||'')===iid)) return prev;
            return [r, ...(prev || [])];
          });
        } catch {}
      });
      es.addEventListener('vm_deleted', (ev: MessageEvent) => {
        try {
          const json = JSON.parse(String(ev.data || '{}'));
          const iid = String(json?.iid || '');
          if (!iid) return;
          setEcs(prev => (prev || []).filter((x:any)=> String(x?.InstanceId||x?.id||'')!==iid));
        } catch {}
      });
      es.addEventListener('vm_status', (ev: MessageEvent) => {
        try {
          const json = JSON.parse(String(ev.data || '{}'));
          const iid = String(json?.iid || '');
          if (!iid) return;
          // Buffer the update instead of setting state immediately
          vmStatusBuffer.current.set(iid, json);
        } catch {}
      });
      es.addEventListener('error', (ev: MessageEvent) => {
        try {
          const json = JSON.parse(String(ev.data || '{}'));
          console.warn('[SSE] Backend Error:', json?.message);
        } catch (e) {
          console.warn('[SSE] Backend Error (Raw):', ev);
        }
      });
      es.onerror = (err) => {
        console.error('[SSE] Connection Error:', err);
        // Native EventSource auto-retries, so we don't need to close/reopen unless we want custom backoff
      };
      return () => { try { es.close(); } catch {} };
    } catch {}
  }, [cloudId]);

  // Flush VM Status Buffer periodically
  useEffect(() => {
    const timer = setInterval(() => {
      if (vmStatusBuffer.current.size === 0) return;
      
      const updates = new Map(vmStatusBuffer.current);
      vmStatusBuffer.current.clear();
      
      setEcs(prev => {
        let hasChanges = false;
        const next = (prev || []).map((x:any)=> {
           const xiid = String(x?.InstanceId||x?.id||'');
           if (updates.has(xiid)) {
              const json = updates.get(xiid);
              const statusStr = String(json?.status || '');
              const nodeName = String(json?.nodeName || '');
              const ips = Array.isArray(json?.ips) ? json.ips : [];
              
              // Compare status
              const currentStatus = String(x?.status?.printableStatus || x?.status?.phase || x?.Status || '');
              const currentNode = String(x?.vmi?.status?.nodeName || x?.status?.nodeName || x?.Extra?.NodeName || '');
              
              // Simple check to avoid unnecessary updates
              // Note: We don't deep compare IPs for perf, just assume if status/node changes or we have IPs update, we update.
              // Or better, check if IPs changed count or content
              const currentIps = x?.ips || [];
              const ipsChanged = ips.length !== currentIps.length || ips.some((ip:string) => !currentIps.includes(ip));

              if (currentStatus === statusStr && currentNode === nodeName && !ipsChanged) {
                  return x;
              }

              hasChanges = true;
              const newItem = { ...x };
              
              // Update Status (preserve object structure if possible)
              newItem.Status = statusStr; // Flat field for some readers
              if (typeof newItem.status === 'object' && newItem.status !== null) {
                  newItem.status = { ...newItem.status, printableStatus: statusStr, phase: statusStr };
              } else {
                  // If it was missing or string, make it object to support SafeRead structure preference
                  newItem.status = { printableStatus: statusStr, phase: statusStr };
              }
              
              // Update NodeName
              if (!newItem.Extra) newItem.Extra = {};
              newItem.Extra.NodeName = nodeName;
              
              if (!newItem.vmi) newItem.vmi = { status: {} };
              if (!newItem.vmi.status) newItem.vmi.status = {};
              newItem.vmi.status.nodeName = nodeName;

              // Update IPs
              if (ips.length > 0) {
                  newItem.ips = ips;
              }
              
              return newItem;
           }
           return x;
        });
        return hasChanges ? next : prev;
      });
    }, 1000); // Flush every 1 second
    return () => clearInterval(timer);
  }, []);

  const nodesOptions = useMemo(() => {
    const s = new Set<string>();
    ecs.forEach((r:any)=>{ 
        const n = r?.nodeName || r?.vmi?.status?.nodeName || r?.status?.nodeName || r?.Extra?.NodeName || '';
        if (n) s.add(n); 
    });
    return Array.from(s).sort();
  }, [ecs]);
  const namespacesOptions = useMemo(() => {
    const s = new Set<string>();
    ecs.forEach((r:any)=>{ 
        const ns = r?.metadata?.namespace || (String(r?.InstanceId || '').includes('/') ? String(r?.InstanceId || '').split('/')[0] : '');
        if (ns) s.add(ns); 
    });
    return Array.from(s).sort();
  }, [ecs]);
  const ecsFiltered = useMemo(() => {
    return ecs.filter((r:any)=>{
      const iid = String(r?.InstanceId || '');
      const ns = iid.includes('/') ? iid.split('/')[0] : '';
      const node = r?.Extra?.NodeName || '';
      if (nsFilter && ns !== nsFilter) return false;
      if (nodeFilter && node !== nodeFilter) return false;
      return true;
    });
  }, [ecs, nsFilter, nodeFilter]);
  const providerRaw = useMemo(() => String(cloud?.config?.provider || defaultProvider || ''), [cloud, defaultProvider]);
  const provider = useMemo(() => providerRaw.toLowerCase(), [providerRaw]);
  const isCloudmap = useMemo(() => provider === 'cloudmap' || provider === 'cloudmap.private' || provider === 'cloudmap.edge', [provider]);
  const providerName = useMemo(() => (isCloudmap ? 'Cloudmap' : 'Harvester'), [isCloudmap]);
  const versionText = useMemo(() => {
    const fromConfig = cloud?.config?.harvesterVersion;
    const fromNodes = (harvesterNodes.find((n:any)=> n?.version)?.version) || undefined;
    return fromConfig || fromNodes || '-';
  }, [cloud, harvesterNodes]);
  const hasKubeOvn = useMemo(() => (kubeOvnVpcs.length > 0 || kubeOvnSubnets.length > 0), [kubeOvnVpcs, kubeOvnSubnets]);
  const tlsIgnored = !!(cloud?.config?.ignoreTls);
  const refreshGpu = async () => {
    try {
      const r = await fetchHarvesterGpuResources(cloudId);
      const items = Array.isArray((r as any)?.data?.items) ? (r as any).data.items : (Array.isArray((r as any)?.items) ? (r as any).items : []);
      setHarvesterGpuResources(items);
      setRawGpu(r);
    } catch (e: any) {
      message.error(e?.message || '刷新失败');
    }
  };

  return (
    <PageDetailContainer
      breadcrumbs={[
        { title: <HomeOutlined />, href: '/' },
        { title: '资源控制台' },
        { title: '资源池管理', href: '/admin/clouds' },
        { title: `${providerName} ${cloud?.name || '-'}` }
      ]}
      icon={<CloudUploadOutlined />}
      title={`${providerName} ${cloud?.name || '-'}`}
      titleLevel={3}
      
      
      extra={
        <Space>
          <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/admin/clouds')}></Button>
          <Dropdown
          menu={{
            items: [
              { key: 'refresh', label: '资源刷新' },
              { key: 'toggleLog', label: (showLog ? '隐藏日志' : '显示日志') },
            ],
            onClick: ({ key }) => {
              if (key === 'refresh') { loadAll(true); return; }
              if (key === 'toggleLog') { setShowLog(v => !v); return; }
            },
          }}
        >
          <Button icon={<UnorderedListOutlined />} />
        </Dropdown>
      </Space>
      }
      asCard={false}
      subtitle="集中展示云资源池信息，提供多种资源类型的生命周期管理能力"
      overviewContent={(
        <Descriptions bordered size="small" column={4}>
          <Descriptions.Item label="资源名称">{cloud?.name || '-'}</Descriptions.Item>
          <Descriptions.Item label="资源供应商">{providerName}</Descriptions.Item>
          <Descriptions.Item label="资源地域">{cloud?.region || '-'}</Descriptions.Item>
          <Descriptions.Item label="资源类型">{cloud?.type || '-'}</Descriptions.Item>
          <Descriptions.Item label="资源状态">{cloud?.status === 'online' ? <Tag color="green">在线</Tag> : cloud?.status === 'maintenance' ? <Tag color="orange">维护</Tag> : cloud?.status === 'offline' ? <Tag color="red">离线</Tag> : <Tag>未知</Tag>}</Descriptions.Item>
          <Descriptions.Item label="Endpoint">
            <Space>
              {cloud?.endpoint || '-'}
              {cloud?.endpoint && (
                <Button 
                  type="link" 
                  size="small" 
                  icon={<LoginOutlined />} 
                  style={{ padding: 0 }}
                  onClick={() => {
                    let url = cloud.endpoint || '';
                    if (url.endsWith('/v3')) {
                      url = url.substring(0, url.length - 3);
                    } else if (url.endsWith('/v3/')) {
                      url = url.substring(0, url.length - 4);
                    }
                    window.open(url, '_blank');
                  }}
                >
                  登录OPS
                </Button>
              )}
            </Space>
          </Descriptions.Item>
          <Descriptions.Item label="版本">{versionText}</Descriptions.Item>
          <Descriptions.Item label="CPU 架构">
            {capabilities?.architecture ? (
              (capabilities.architecture === 'arm64' || capabilities.architecture === 'aarch64') 
                ? <Tag color="blue">ARM64</Tag> 
                : <Tag color="blue">x86_64</Tag>
            ) : '-'}
          </Descriptions.Item>
          <Descriptions.Item label="TLS 忽略">{tlsIgnored ? <Tag color="orange">是</Tag> : <Tag>否</Tag>}</Descriptions.Item>
          <Descriptions.Item label="网络插件">{hasKubeOvn ? <Tag color="blue">Kube-OVN</Tag> : <Tag>未知/未启用</Tag>}</Descriptions.Item>
          <Descriptions.Item label="资源ID">{cloud?.id || '-'}</Descriptions.Item>
          <Descriptions.Item label="更新时间">{cloud?.updatedAt || '-'}</Descriptions.Item>
        </Descriptions>
      )}
    >
      {error && (
        <Alert type="error" message="查询失败" description={error} style={{ marginBottom: 16 }} showIcon />
      )}
      <Tabs
          type="card"
          destroyInactiveTabPane
          defaultActiveKey="overview"
          items={[
            {
              key: 'overview',
              label: '资源总览',
              children: (
                <>
                  <Row gutter={[16, 16]}>
                    <Col xs={24} sm={12} md={6}><Card size="small" variant="outlined" style={{ borderRadius: 8 }}><Statistic title={<span style={{ display:'flex', alignItems:'center' }}><CloudServerOutlined style={{ color:'#1677ff', marginRight:8 }} />云主机（VM）</span>} value={ecs.length} valueStyle={{ fontSize: 24, fontWeight: 700 }} /></Card></Col>
                    <Col xs={24} sm={12} md={6}><Card size="small" variant="outlined" style={{ borderRadius: 8 }}><Statistic title={<span style={{ display:'flex', alignItems:'center' }}><AppstoreOutlined style={{ color:'#1677ff', marginRight:8 }} />命名空间</span>} value={harvesterNamespaces.length} valueStyle={{ fontSize: 24, fontWeight: 700 }} /></Card></Col>
                    <Col xs={24} sm={12} md={6}><Card size="small" variant="outlined" style={{ borderRadius: 8 }}><Statistic title={<span style={{ display:'flex', alignItems:'center' }}><CameraOutlined style={{ color:'#1677ff', marginRight:8 }} />镜像</span>} value={harvesterImages.length} valueStyle={{ fontSize: 24, fontWeight: 700 }} /></Card></Col>
                    <Col xs={24} sm={12} md={6}><Card size="small" variant="outlined" style={{ borderRadius: 8 }}><Statistic title={<span style={{ display:'flex', alignItems:'center' }}><HddOutlined style={{ color:'#1677ff', marginRight:8 }} />虚拟卷</span>} value={harvesterVolumes.length} valueStyle={{ fontSize: 24, fontWeight: 700 }} /></Card></Col>
                  </Row>
                  <Row gutter={[16, 16]} style={{ marginTop: 12 }}>
                    <Col xs={24} sm={12} md={6}><Card size="small" variant="outlined" style={{ borderRadius: 8 }}><Statistic title={<span style={{ display:'flex', alignItems:'center' }}><NodeIndexOutlined style={{ color:'#1677ff', marginRight:8 }} />节点</span>} value={harvesterNodes.length} valueStyle={{ fontSize: 24, fontWeight: 700 }} /></Card></Col>
                    <Col xs={24} sm={12} md={6}><Card size="small" variant="outlined" style={{ borderRadius: 8 }}><Statistic title={<span style={{ display:'flex', alignItems:'center' }}><GlobalOutlined style={{ color:'#1677ff', marginRight:8 }} />NAD 网络</span>} value={harvesterNads.length} valueStyle={{ fontSize: 24, fontWeight: 700 }} /></Card></Col>
                    <Col xs={24} sm={12} md={6}><Card size="small" variant="outlined" style={{ borderRadius: 8 }}><Statistic title={<span style={{ display:'flex', alignItems:'center' }}><ClusterOutlined style={{ color:'#1677ff', marginRight:8 }} />Kube-OVN VPC</span>} value={kubeOvnVpcs.length} valueStyle={{ fontSize: 24, fontWeight: 700 }} /></Card></Col>
                    <Col xs={24} sm={12} md={6}><Card size="small" variant="outlined" style={{ borderRadius: 8 }}><Statistic title={<span style={{ display:'flex', alignItems:'center' }}><NodeIndexOutlined style={{ color:'#1677ff', marginRight:8 }} />Kube-OVN 子网</span>} value={kubeOvnSubnets.length} valueStyle={{ fontSize: 24, fontWeight: 700 }} /></Card></Col>
                  </Row>
                </>
              )
            },

            {
              key: 'cluster',
              label: '集群',
              children: (
                <Tabs
                  type="line"
                  destroyInactiveTabPane
                  defaultActiveKey="cluster_nodes"
                  items={[
                    {
                      key: 'cluster_nodes',
                      label: 'Node 节点',
                      children: (
                        <>
                          <NodesSection nodes={harvesterNodes} loading={resourceLoading.nodes || nodesLoading} onRefresh={refreshNodes} cloudId={cloudId} />
                          {showLog && (
                            <div style={{ marginTop: 12 }}>
                              <pre style={{ background:'#f7f7f7', padding:12, borderRadius:8, maxHeight:300, overflow:'auto' }}>{JSON.stringify(rawNodes, null, 2)}</pre>
                            </div>
                          )}
                        </>
                      )
                    },
                    {
                      key: 'cluster_services',
                      label: 'K8s 服务 ',
                      children: (
                        <>
                          <ServicesSection cloudId={cloudId} services={harvesterServices} loading={resourceLoading.services} onRefresh={loadAll} />
                          {showLog && (
                            <div style={{ marginTop: 12 }}>
                              <pre style={{ background:'#f7f7f7', padding:12, borderRadius:8, maxHeight:300, overflow:'auto' }}>{JSON.stringify(rawServices, null, 2)}</pre>
                            </div>
                          )}
                        </>
                      )
                    },
                    {
                      key: 'namespaces',
                      label: '命名空间',
                      children: <NamespacesTab cloudId={cloudId} namespaces={harvesterNamespaces} loading={resourceLoading.namespaces} onRefresh={loadAll} showLog={showLog} raw={rawNamespaces} />
                    },
                    {
                      key: 'storage_classes',
                      label: '存储类',
                      children: (
                        <>
                          <StorageClassesSection cloudId={cloudId} storageClasses={harvesterStorageClasses} loading={resourceLoading.storageClasses} onRefresh={loadAll} />
                          {showLog && (
                            <div style={{ marginTop: 12 }}>
                              <pre style={{ background:'#f7f7f7', padding:12, borderRadius:8, maxHeight:300, overflow:'auto' }}>{JSON.stringify(harvesterStorageClasses, null, 2)}</pre>
                            </div>
                          )}
                        </>
                      )
                    }
                  ].filter((i:any) => {
                      if (i.key === 'cluster_nodes') return checkPerm('clouds.nodes:read');
                      if (i.key === 'cluster_services') return checkPerm('clouds.services:read');
                      if (i.key === 'namespaces') return checkPerm('clouds.namespaces:read') || checkPerm('clouds:read');
                      if (i.key === 'storage_classes') return checkPerm('clouds.volumes:read');
                      return true;
                   })}
                />
              )
            },
            {
              key: 'compute_group',
              label: 'ECS',
              children: (
                <Tabs
                  type="line"
                  destroyInactiveTabPane
                  defaultActiveKey="ecs"
                  items={[
                    {
                      key: 'ecs',
                      label: 'VM 云主机',
                      children: (
                        <>
                          <VmSection
                            vms={ecs}
                            loading={resourceLoading.ecs}
                            namespacesOptions={namespacesOptions}
                            nodesOptions={nodesOptions}
                            cloudId={cloudId}
                            nsValue={nsFilter || undefined}
                            nodeValue={nodeFilter || undefined}
                            onNsChange={(v)=> setNsFilter(v || '')}
                            onNodeChange={(v)=> setNodeFilter(v || '')}
                            onRefresh={loadAll}
                            onOpenReconfigure={(r:any)=> { setVmReconfTarget(r); setVmReconfOpen(true); }}
                            onStart={async (iid:string)=>{ try { await startCloudProviderEcs(cloudId, iid); message.success('启动成功'); } catch(e:any){ message.error(e?.message||'启动失败'); } }}
                            onStop={async (iid:string)=>{ try { await stopCloudProviderEcs(cloudId, iid, false); message.success('停止成功'); } catch(e:any){ message.error(e?.message||'停止失败'); } }}
                            onReboot={async (iid:string)=>{ try { await rebootCloudProviderEcs(cloudId, iid, false); message.success('重启成功'); } catch(e:any){ message.error(e?.message||'重启失败'); } }}
                            onSoftReboot={async (iid:string)=>{ try { await softRebootCloudProviderEcs(cloudId, iid); message.success('软重启成功'); } catch(e:any){ message.error(e?.message||'软重启失败'); } }}
                            onPause={async (iid:string)=>{ try { await pauseCloudProviderEcs(cloudId, iid); message.success('暂停成功'); } catch(e:any){ message.error(e?.message||'暂停失败'); } }}
                            onUnpause={async (iid:string)=>{ try { await unpauseCloudProviderEcs(cloudId, iid); message.success('恢复成功'); } catch(e:any){ message.error(e?.message||'恢复失败'); } }}
                            onDelete={async (iid:string, deleteImage?: boolean)=>{ try { await deleteCloudProviderEcs(cloudId, iid, deleteImage); message.success('删除成功'); } catch(e:any){ message.error(e?.message||'删除失败'); } }}
                          />
                          <VmReconfigureModal open={vmReconfOpen} cloudId={cloudId} record={vmReconfTarget} onClose={()=>{ setVmReconfOpen(false); setVmReconfTarget(null); }} onOk={loadAll} storageClasses={harvesterStorageClasses} images={harvesterImages} gpuResources={harvesterGpuResources} />
                          {showLog && (
                            <div style={{ marginTop: 12 }}>
                              <pre style={{ background:'#f7f7f7', padding:12, borderRadius:8, maxHeight:300, overflow:'auto' }}>{JSON.stringify(rawEcs, null, 2)}</pre>
                            </div>
                          )}
                        </>
                      )
                    },


                    {
                      key: 'templates',
                      label: 'VM 模板',
                      children: (
                        <>
                          <TemplatesSection cloudId={cloudId} templates={harvesterTemplates} loading={resourceLoading.templates} onRefresh={loadAll} />
                          {showLog && (
                            <div style={{ marginTop: 12 }}>
                              <pre style={{ background:'#f7f7f7', padding:12, borderRadius:8, maxHeight:300, overflow:'auto' }}>{JSON.stringify(rawTemplates, null, 2)}</pre>
                            </div>
                          )}
                        </>
                      )
                    },
                    {
                      key: 'ssh_keys',
                      label: 'SSH 密钥',
                      children: (
                        <>
                          <SshKeysSection cloudId={cloudId} sshKeys={harvesterSshKeys} loading={resourceLoading.sshKeys} onRefresh={loadAll} />
                          {showLog && (
                            <div style={{ marginTop: 12 }}>
                              <pre style={{ background:'#f7f7f7', padding:12, borderRadius:8, maxHeight:300, overflow:'auto' }}>{JSON.stringify(rawSshKeys, null, 2)}</pre>
                            </div>
                          )}
                        </>
                      )
                    },
                    {
                      key: 'cloud_inits',
                      label: 'Cloud Init',
                      children: (
                        <>
                          <CloudInitsSection cloudId={cloudId} cloudInits={harvesterCloudInits} loading={resourceLoading.cloudInits} onRefresh={loadAll} />
                          {showLog && (
                            <div style={{ marginTop: 12 }}>
                              <pre style={{ background:'#f7f7f7', padding:12, borderRadius:8, maxHeight:300, overflow:'auto' }}>{JSON.stringify(rawCloudInits, null, 2)}</pre>
                            </div>
                          )}
                        </>
                      )
                    },
                    {
                      key: 'gpu',
                      label: 'GPU',
                      children: (<GpusSection cloudId={cloudId} resources={harvesterGpuResources} onRefresh={refreshGpu} raw={rawGpu} showLog={showLog} />)
                    }
                  ].filter((i:any) => {
                      if (i.key === 'ecs') return checkPerm('clouds.instances:read');
                      if (i.key === 'templates') return checkPerm('clouds.templates:read');
                      if (i.key === 'ssh_keys') return checkPerm('clouds.sshkeys:read');
                      if (i.key === 'cloud_inits') return checkPerm('clouds.cloudinits:read');
                      if (i.key === 'gpu') return checkPerm('clouds.instances:read');
                      return true;
                  })}
                />
              )
            },
            {
              key: 'storage_group',
              label: '块存储',
              children: (
                <Tabs
                  type="line"
                  destroyInactiveTabPane
                  defaultActiveKey="volumes"
                  items={[
                    {
                      key: 'volumes',
                      label: 'PVC虚拟卷',
                      children: (
                        <>
                          <VolumesSection cloudId={cloudId} volumes={harvesterVolumes} loading={resourceLoading.volumes} vms={ecs} storageClasses={harvesterStorageClasses} onRefresh={loadAll} />
                          {showLog && (
                            <div style={{ marginTop: 12 }}>
                              <pre style={{ background:'#f7f7f7', padding:12, borderRadius:8, maxHeight:300, overflow:'auto' }}>{JSON.stringify(rawVolumes, null, 2)}</pre>
                            </div>
                          )}
                        </>
                      )
                    },
                    {
                      key: 'images',
                      label: '镜像',
                      children: (
                        <>
                          <ImagesSection cloudId={cloudId} images={harvesterImages} loading={resourceLoading.images} onRefresh={loadAll} />
                          {showLog && (
                            <div style={{ marginTop: 12 }}>
                              <pre style={{ background:'#f7f7f7', padding:12, borderRadius:8, maxHeight:300, overflow:'auto' }}>{JSON.stringify(rawImages, null, 2)}</pre>
                            </div>
                          )}
                        </>
                      )
                    },
                    {
                      key: 'snapshots',
                      label: '卷快照',
                      children: (
                        <>
                          <SnapshotsSection cloudId={cloudId} snapshots={harvesterSnapshots} loading={resourceLoading.snapshots} onRefresh={loadAll} />
                          {showLog && (
                            <div style={{ marginTop: 12 }}>
                              <pre style={{ background:'#f7f7f7', padding:12, borderRadius:8, maxHeight:300, overflow:'auto' }}>{JSON.stringify(rawSnapshots, null, 2)}</pre>
                            </div>
                          )}
                        </>
                      )
                    }
                  ].filter((i:any) => {
                     if (i.key === 'volumes') return checkPerm('clouds.volumes:read');
                     if (i.key === 'images') return checkPerm('clouds.images:read');
                     if (i.key === 'snapshots') return checkPerm('clouds.snapshots:read');
                     return true;
                  })}
                />
              )
            },
            {
              key: 'backups_group',
              label: '快照/备份',
              children: (
                <Tabs
                  type="line"
                  destroyInactiveTabPane
                  defaultActiveKey="backups"
                  items={[
                    {
                      key: 'backups',
                      label: 'VM 备份',
                      children: (
                        <>
                          <BackupsSection cloudId={cloudId} backups={harvesterBackups} loading={resourceLoading.backups} onRefresh={loadAll} namespaces={harvesterNamespaces} vms={ecs} type="backup" />
                          {showLog && (
                            <div style={{ marginTop: 12 }}>
                              <pre style={{ background:'#f7f7f7', padding:12, borderRadius:8, maxHeight:300, overflow:'auto' }}>{JSON.stringify(rawBackups, null, 2)}</pre>
                            </div>
                          )}
                        </>
                      )
                    },
                    {
                      key: 'vm_snapshots',
                      label: 'VM 快照',
                      children: (
                        <>
                          <BackupsSection cloudId={cloudId} backups={harvesterBackups} loading={resourceLoading.backups} onRefresh={loadAll} namespaces={harvesterNamespaces} vms={ecs} type="snapshot" />
                          {showLog && (
                            <div style={{ marginTop: 12 }}>
                              <pre style={{ background:'#f7f7f7', padding:12, borderRadius:8, maxHeight:300, overflow:'auto' }}>{JSON.stringify(rawBackups, null, 2)}</pre>
                            </div>
                          )}
                        </>
                      )
                    },
                    {
                      key: 'schedule_vm_backups',
                      label: '定时策略',
                      children: (
                        <>
                          <ScheduleVmBackupsSection cloudId={cloudId} data={harvesterScheduleVmBackups} loading={resourceLoading.scheduleVmBackups} onRefresh={loadAll} />
                          {showLog && (
                            <div style={{ marginTop: 12 }}>
                              <pre style={{ background:'#f7f7f7', padding:12, borderRadius:8, maxHeight:300, overflow:'auto' }}>{JSON.stringify(rawScheduleVmBackups, null, 2)}</pre>
                            </div>
                          )}
                        </>
                      )
                    }
                  ]}
                />
              )
            },

            {
              key: 'native_network',
              label: '原生网络',
              children: (
                <Tabs
                  type="line"
                  destroyInactiveTabPane
                  defaultActiveKey="nad"
                  items={[
                    {
                      key: 'nad',
                      label: 'NAD 网络',
                      children: (
                        <>
                          <NadsSection nads={harvesterNads} loading={resourceLoading.nads || nadsLoading} onRefresh={loadAll} cloudId={cloudId} />
                          {showLog && (
                            <div style={{ marginTop: 12 }}>
                              <pre style={{ background:'#f7f7f7', padding:12, borderRadius:8, maxHeight:300, overflow:'auto' }}>{JSON.stringify(rawNads, null, 2)}</pre>
                            </div>
                          )}
                        </>
                      )
                    },
                    {
                      key: 'load_balancers',
                      label: '负载均衡',
                      children: (
                        <>
                          <LoadBalancersSection cloudId={cloudId} services={harvesterServices} loading={resourceLoading.services} onRefresh={loadAll} />
                          {showLog && (
                            <div style={{ marginTop: 12 }}>
                              <pre style={{ background:'#f7f7f7', padding:12, borderRadius:8, maxHeight:300, overflow:'auto' }}>{JSON.stringify(rawServices, null, 2)}</pre>
                            </div>
                          )}
                        </>
                      )
                    },
                    {
                      key: 'ippools',
                      label: '地址池',
                      children: (
                        <>
                          <IPPoolsSection cloudId={cloudId} ippools={harvesterIPPools} loading={resourceLoading.ippools} onRefresh={loadAll} />
                          {showLog && (
                            <div style={{ marginTop: 12 }}>
                              <pre style={{ background:'#f7f7f7', padding:12, borderRadius:8, maxHeight:300, overflow:'auto' }}>{JSON.stringify(rawIPPools, null, 2)}</pre>
                            </div>
                          )}
                        </>
                      )
                    }
                  ].filter((i:any) => {
                     if (i.key === 'nad') return checkPerm('clouds.networks:read');
                     if (i.key === 'load_balancers') return checkPerm('clouds.loadbalancers:read');
                     if (i.key === 'ippools') return checkPerm('clouds.ippools:read');
                     return true;
                  })}
                />
              )
            },
            {
              key: 'kube_ovn',
              label: 'Kube-OVN',
              children: (
                <Tabs
                  type="line"
                  destroyInactiveTabPane
                  defaultActiveKey="kubeovn_vpcs"
                  items={[
                    {
                      key: 'kubeovn_vpcs',
                      label: 'VPC 私有网络',
                      children: (
                        <>
                          <KubeOvnVpcsSection vpcs={kubeOvnVpcs} subnets={kubeOvnSubnets} loading={resourceLoading.vpcs || resourceLoading.subnets} onRefresh={loadAll} />
                          {showLog && (
                            <div style={{ marginTop: 12 }}>
                              <pre style={{ background:'#f7f7f7', padding:12, borderRadius:8, maxHeight:300, overflow:'auto' }}>{JSON.stringify(rawVpcs, null, 2)}</pre>
                            </div>
                          )}
                        </>
                      )
                    },
                    {
                      key: 'kubeovn_subnets',
                      label: 'Subnet 子网',
                      children: (
                        <>
                          <KubeOvnSubnetsSection subnets={kubeOvnSubnets} vpcList={kubeOvnVpcs} loading={resourceLoading.subnets} onRefresh={loadAll} />
                          {showLog && (
                            <div style={{ marginTop: 12 }}>
                              <pre style={{ background:'#f7f7f7', padding:12, borderRadius:8, maxHeight:300, overflow:'auto' }}>{JSON.stringify(rawSubnets, null, 2)}</pre>
                            </div>
                          )}
                        </>
                      )
                    },
                    {
                      key: 'kubeovn_public_networks',
                      label: '公共网络',
                      children: (
                        <>
                          <KubeOvnPublicNetworksSection subnets={kubeOvnSubnets} loading={resourceLoading.subnets} onRefresh={loadAll} />
                          {showLog && (
                            <div style={{ marginTop: 12 }}>
                              <pre style={{ background:'#f7f7f7', padding:12, borderRadius:8, maxHeight:300, overflow:'auto' }}>{JSON.stringify(rawSubnets, null, 2)}</pre>
                            </div>
                          )}
                        </>
                      )
                    },
                    {
                      key: 'kubeovn_eips',
                      label: 'EIP 外部IP',
                      children: (
                        <>
                          <EipSection cloudId={cloudId} eips={kubeOvnEips} subnets={kubeOvnSubnets} loading={resourceLoading.eips} onRefresh={loadAll} />
                          {showLog && (
                            <div style={{ marginTop: 12 }}>
                              <pre style={{ background:'#f7f7f7', padding:12, borderRadius:8, maxHeight:300, overflow:'auto' }}>{JSON.stringify(rawEips, null, 2)}</pre>
                            </div>
                          )}
                        </>
                      )
                    },
                    {
                      key: 'kubeovn_fips',
                      label: 'FIP 浮动IP',
                      children: (
                        <>
                          <FipSection cloudId={cloudId} fips={kubeOvnFips} eips={kubeOvnEips} vpcs={kubeOvnVpcs} loading={resourceLoading.fips} onRefresh={loadAll} />
                          {showLog && (
                            <div style={{ marginTop: 12 }}>
                              <pre style={{ background:'#f7f7f7', padding:12, borderRadius:8, maxHeight:300, overflow:'auto' }}>{JSON.stringify(rawFips, null, 2)}</pre>
                            </div>
                          )}
                        </>
                      )
                    },
                    {
                      key: 'kubeovn_snat',
                      label: 'SNAT 规则',
                      children: (
                        <>
                          <SnatSection cloudId={cloudId} snatRules={kubeOvnSnatRules} eips={kubeOvnEips} vpcs={kubeOvnVpcs} subnets={kubeOvnSubnets} loading={resourceLoading.snatRules} onRefresh={loadAll} />
                          {showLog && (
                            <div style={{ marginTop: 12 }}>
                              <pre style={{ background:'#f7f7f7', padding:12, borderRadius:8, maxHeight:300, overflow:'auto' }}>{JSON.stringify(rawSnatRules, null, 2)}</pre>
                            </div>
                          )}
                        </>
                      )
                    },
                    {
                      key: 'kubeovn_dnat',
                      label: 'DNAT 规则',
                      children: (
                        <>
                          <DnatSection cloudId={cloudId} dnatRules={kubeOvnDnatRules} eips={kubeOvnEips} vpcs={kubeOvnVpcs} loading={resourceLoading.dnatRules} onRefresh={loadAll} />
                          {showLog && (
                            <div style={{ marginTop: 12 }}>
                              <pre style={{ background:'#f7f7f7', padding:12, borderRadius:8, maxHeight:300, overflow:'auto' }}>{JSON.stringify(rawDnatRules, null, 2)}</pre>
                            </div>
                          )}
                        </>
                      )
                    },
                    {
                      key: 'ingresses',
                      label: 'Ingress 路由',
                      children: (
                        <>
                          <IngressesSection cloudId={cloudId} ingresses={harvesterIngresses} loading={resourceLoading.ingresses} onRefresh={loadAll} />
                          {showLog && (
                            <div style={{ marginTop: 12 }}>
                              <pre style={{ background:'#f7f7f7', padding:12, borderRadius:8, maxHeight:300, overflow:'auto' }}>{JSON.stringify(rawIngresses, null, 2)}</pre>
                            </div>
                          )}
                        </>
                      )
                    }
                  ].filter((i:any) => {
                      if (i.key === 'kubeovn_vpcs') return checkPerm('clouds.networks:read');
                      if (i.key === 'kubeovn_subnets') return checkPerm('clouds.networks:read');
                      if (i.key === 'kubeovn_public_networks') return checkPerm('clouds.networks:read');
                      if (i.key === 'kubeovn_eips') return checkPerm('clouds.networks:read');
                      if (i.key === 'kubeovn_fips') return checkPerm('clouds.networks:read');
                      if (i.key === 'kubeovn_snat') return checkPerm('clouds.networks:read');
                      if (i.key === 'kubeovn_dnat') return checkPerm('clouds.networks:read');
                      if (i.key === 'ingresses') return checkPerm('clouds.ingresses:read');
                      return true;
                  })}
                />
              )
            },

          ].filter((item: any) => {
              if (item.key === 'overview') return true;
              if (item.key === 'cluster') return checkPerm('clouds.nodes:read') || checkPerm('clouds.services:read') || checkPerm('clouds:read');
              if (item.key === 'compute_group') return checkPerm('clouds.instances:read') || checkPerm('clouds.sshkeys:read') || checkPerm('clouds.cloudinits:read') || checkPerm('clouds.templates:read');
              if (item.key === 'storage_group') return checkPerm('clouds.volumes:read') || checkPerm('clouds.images:read') || checkPerm('clouds.snapshots:read');
              if (item.key === 'backups_group') return checkPerm('clouds.backups:read');
              if (item.key === 'native_network') return checkPerm('clouds.networks:read') || checkPerm('clouds.loadbalancers:read') || checkPerm('clouds.services:read') || checkPerm('clouds.ippools:read');
              if (item.key === 'kube_ovn') return checkPerm('clouds.networks:read');
              return true;
          })}
        />
    </PageDetailContainer>
  );
};

export default CloudDetailHarvester;