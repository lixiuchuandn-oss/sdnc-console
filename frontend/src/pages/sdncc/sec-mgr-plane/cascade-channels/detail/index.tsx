import React, { useEffect, useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { Form, message, Modal, Select } from 'antd';
import { BranchesOutlined } from '@ant-design/icons';
import PageDetailContainer from '../../../../../components/PageDetailContainer';
import { attachVpcToCen, fetchCenAttachments, fetchCens, fetchTenants, fetchCsmElementGroups, fetchServices, fetchCloudProviderEcs } from '../../../../../services/api';
import { fetchAiThreatEvents, type AiThreatEvent } from '../../../../../services/aiSocApi';
import { listSecurityDomains, getSecurityDomain } from '../../../../../services/securityDomainApi';
import type { Cen, SecurityDomainOption, AppItem, SecurityServiceItem } from './types';
import { pick, getServiceInstances } from './lib/field-utils';
import { buildTopologyData } from './topology/build-data';
import CenDetailTopologyPanel from './topology/panel';
import { useCenDetailTabs } from './hooks/use-detail-tabs';
const CenDetailPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const [searchParams, setSearchParams] = useSearchParams();

  const [, setLoading] = useState(false);
  const [cen, setCen] = useState<Cen | undefined>();
  const [, setTenants] = useState<any[]>([]);
  const [allDomains, setAllDomains] = useState<SecurityDomainOption[]>([]);
  const [attachments, setAttachments] = useState<any[]>([]);

  const [domainKeyword, setDomainKeyword] = useState('');
  const [domainStatusFilter, setDomainStatusFilter] = useState('');
  const [detailRefreshing, setDetailRefreshing] = useState(false);

  const [attachModal, setAttachModal] = useState<{ open: boolean; cenId?: string }>({ open: false });
  const [domains, setDomains] = useState<SecurityDomainOption[]>([]);
  const [attachDomainIds, setAttachDomainIds] = useState<string[]>([]);
  const [attachPlaneIndex, setAttachPlaneIndex] = useState<number | undefined>();

  const [apps, setApps] = useState<AppItem[]>([]);
  const [services, setServices] = useState<SecurityServiceItem[]>([]);
  const [domainServiceChainMap, setDomainServiceChainMap] = useState<Record<string, boolean>>({});
  const [serviceKeyword, setServiceKeyword] = useState('');
  const [serviceStatusFilter, setServiceStatusFilter] = useState('');
  const [appKeyword, setAppKeyword] = useState('');
  const [appTypeFilter, setAppTypeFilter] = useState('');
  const [csmElementGroupCache, setCsmElementGroupCache] = useState<Record<string, Record<string, any>>>({});
  const [csmElementGroupLoading, setCsmElementGroupLoading] = useState<Record<string, boolean>>({});
  const [ecsIpMap, setEcsIpMap] = useState<Record<string, string>>({});

  const [threatEvents, setThreatEvents] = useState<AiThreatEvent[]>([]);
  const [threatLoading, setThreatLoading] = useState(false);
  const [reportModalOpen, setReportModalOpen] = useState(false);
  const [currentReport, setCurrentReport] = useState<string>('');
  const [threatKeyword, setThreatKeyword] = useState('');

  const [topologyEl, setTopologyEl] = useState<HTMLDivElement | null>(null);
  const [topologyHeight, setTopologyHeight] = useState(460);
  const [isFullScreen, setIsFullScreen] = useState(false);

  const loadThreats = () => {
    if (cen?.tenantId) {
      setThreatLoading(true);
      fetchAiThreatEvents(cen.tenantId)
        .then(data => setThreatEvents(data))
        .catch(() => message.error('获取威胁事件失败'))
        .finally(() => setThreatLoading(false));
    }
  };

  useEffect(() => {
    loadThreats();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cen?.tenantId]);

  useEffect(() => {
    if (!topologyEl) return;
    const calc = () => {
      const rect = topologyEl.getBoundingClientRect();
      const viewportH = window.visualViewport?.height || window.innerHeight;
      const h = Math.max(460, Math.floor(viewportH - rect.top - 24));
      setTopologyHeight(h);
    };
    calc();
    const ro = new ResizeObserver(() => calc());
    ro.observe(topologyEl);
    window.addEventListener('resize', calc);
    window.addEventListener('scroll', calc, true);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', calc);
      window.removeEventListener('scroll', calc, true);
    };
  }, [topologyEl]);

  // Load all domains for mapping cloudIds
  useEffect(() => {
    listSecurityDomains().then((res: any) => {
      const list = Array.isArray(res) ? res : [];
      setAllDomains(list);
    }).catch(() => {
      setAllDomains([]);
    });
  }, []);

  useEffect(() => {
    try {
      const rawApps = localStorage.getItem('security_apps') || '[]';
      const parsedApps = JSON.parse(rawApps);
      setApps(Array.isArray(parsedApps) ? parsedApps : []);
    } catch {
      setApps([]);
    }

    // Fetch latest apps from backend
    fetchServices().then((raws: any) => {
        const normalized = (Array.isArray(raws) ? raws : []).map((s: any) => {
          const parsedInstances: any[] = (() => { try { return s.instances ? JSON.parse(s.instances) : []; } catch { return []; } })();
          const rawType = String(s.type || '').toLowerCase();
          let type: AppItem['type'] = 'vm';
          if (rawType === 'container') type = 'container';
          else if (rawType === 'mixed') type = 'mixed';
          else if (rawType === 'service_address') type = 'service_address';
          
          const isServiceAddress = type === 'service_address';
          const instances = isServiceAddress ? [] : parsedInstances;
          // Robustly extract serviceAddresses: prioritize explicit field, fallback to instances if it contains objects
          let serviceAddresses: any[] = [];
          if (isServiceAddress) {
             if (s.serviceAddresses && Array.isArray(s.serviceAddresses)) {
                 serviceAddresses = s.serviceAddresses;
             } else if (typeof s.serviceAddresses === 'string') {
                 try { serviceAddresses = JSON.parse(s.serviceAddresses); } catch {}
             } 
             
             if (serviceAddresses.length === 0 && parsedInstances.length > 0) {
                 serviceAddresses = parsedInstances;
             }
          }

          return {
            id: s.id,
            name: s.name,
            domainId: s.domainId,
            domainName: s.domainName,
            type,
            instanceCount: isServiceAddress ? serviceAddresses.length : (instances.length || Number(s.instanceCount || 0)),
            status: s.status || 'running',
            strategies: typeof s.strategies === 'string' ? s.strategies.split(',').map((x: string) => x.trim()).filter(Boolean) : (s.strategies || []),
            instances,
            serviceAddresses,
            servicePorts: (() => { try { return s.servicePorts ? (Array.isArray(s.servicePorts) ? s.servicePorts : JSON.parse(s.servicePorts)) : []; } catch { return []; } })(),
            description: s.description,
            owner: s.owner,
            version: s.version,
            policyIds: typeof s.policyIds === 'string' ? s.policyIds.split(',').map((x: string) => x.trim()).filter(Boolean) : (s.policyIds || []),
          };
        });
        setApps(normalized);
    }).catch(e => {
        console.error('Failed to fetch services', e);
    });
  }, []);

  // Fetch ECS IPs for VM apps
  useEffect(() => {
    if (allDomains.length === 0 || apps.length === 0) return;
    const cloudIds = new Set<string>();
    apps.forEach(app => {
      if (app.type === 'vm') {
         const dom = allDomains.find(d => String(d.id) === String(app.domainId));
         if (dom && dom.cloudId) cloudIds.add(dom.cloudId);
      }
    });
    
    if (cloudIds.size === 0) return;

    Promise.all(Array.from(cloudIds).map(cid => fetchCloudProviderEcs(cid).catch(() => null)))
      .then(results => {
         const map: Record<string, string> = {};
         results.forEach(res => {
           if (!res) return;
           // Normalize ECS list
           const list = res.data?.Instances?.Instance || res.data?.servers || res.data?.InstanceSet || res.data || [];
           if (Array.isArray(list)) {
             list.forEach((inst: any) => {
               // Extract IP
               let ip = '';
               // Try Public IP
               const pubArr = inst?.PublicIpAddress?.IpAddress;
               const pub = Array.isArray(pubArr) && pubArr.length > 0 ? pubArr[0] : (inst?.EipAddress?.IpAddress || inst?.publicIpAddress || (Array.isArray(inst?.publicIps)?inst.publicIps[0]:null));
               // Try Private IP
               const priArr = inst?.VpcAttributes?.PrivateIpAddress?.IpAddress;
               const pri = Array.isArray(priArr) && priArr.length > 0 ? priArr[0] : (inst?.privateIpAddress || (Array.isArray(inst?.privateIps)?inst.privateIps[0]:null));
               
               if (pub) ip = pub;
               else if (pri) ip = pri;
               
               const iid = inst?.InstanceId || inst?.id || inst?.uuid;
               if (iid && ip) {
                 map[String(iid)] = ip;
               }
             });
           }
         });
         setEcsIpMap(prev => ({ ...prev, ...map }));
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apps.length, allDomains.length]);

  const domainOfAttachment = (att: any): SecurityDomainOption | undefined => {
    if (!att) return undefined;
    const domId = att?.securityDomain?.id || att?.securityDomainId;
    if (!domId) return undefined;
    return allDomains.find((d) => String(d.id) === String(domId));
  };

  const refreshDetailAttachments = async (cenId?: string) => {
    const cid = String(cenId || cen?.id || '');
    if (!cid) return;
    setDetailRefreshing(true);
    try {
      const list = await fetchCenAttachments(cid);
      const normalized = Array.isArray(list) ? list : [];
      setAttachments(normalized);
      setCen((prev) => (prev ? { ...prev, attachCount: normalized.length } : prev));
      message.success('刷新成功');
    } catch {
      message.error('刷新失败');
    } finally {
      setDetailRefreshing(false);
    }
  };

  const openAttachModal = async (cenId: string) => {
    setAttachDomainIds([]);
    setAttachPlaneIndex(undefined);
    try {
      const list = await listSecurityDomains();
      const opts: SecurityDomainOption[] = (Array.isArray(list) ? list : []).map((d: any) => ({
        id: d.id,
        name: d.name,
        type: d.type,
        category: d.category,
        vpcId: d.vpcId,
        provider: d.provider,
        region: d.region,
        cloudId: d.cloudId,
        cidr: d.cidr,
        cidr6: d.cidr6,
        vrName: d.vrName,
        vrUuid: d.vrUuid,
        vrInstanceIds: d.vrInstanceIds,
        vrPublicEniIds: d.vrPublicEniIds,
        vrPrivateEniIds: d.vrPrivateEniIds,
        vrPublicIp: d.vrPublicIp,
        vrPublicEip: d.vrPublicEip,
        vrPrivateIp: d.vrPrivateIp,
        vrPublicSubnetCidr: d.vrPublicSubnetCidr,
        vrPrivateSubnetCidr: d.vrPrivateSubnetCidr,
      }));
      setDomains(opts);
    } catch {
      setDomains([]);
    }
    setAttachModal({ open: true, cenId });
  };

  const handleAttach = async () => {
    const cenId = attachModal.cenId;
    if (!cenId) {
      message.warning('请选择级联通道');
      return;
    }
    if (!attachPlaneIndex && attachPlaneIndex !== 0) {
      message.warning('请选择目标级联通道');
      return;
    }
    if (!attachDomainIds.length) {
      message.warning('请选择至少一个安全域');
      return;
    }
    let ok = 0;
    let fail = 0;
    for (const did of attachDomainIds) {
      const domain = domains.find((d) => d.id === did);
      if (!domain) {
        fail++;
        continue;
      }
      try {
        await attachVpcToCen(cenId, undefined, String(domain.id));
        ok++;
      } catch {
        fail++;
      }
    }
    setAttachModal({ open: false });
    message.success(`附加提交完成：成功 ${ok}，失败 ${fail}`);
    await refreshDetailAttachments(cenId);
  };

  useEffect(() => {
    (async () => {
      const cid = String(id || '');
      if (!cid) return;
      setLoading(true);
      try {
        const [cenList, tenantList, domainList, attachList] = await Promise.all([
          fetchCens(),
          fetchTenants().catch(() => []),
          listSecurityDomains().catch(() => []),
          fetchCenAttachments(cid).catch(() => []),
        ]);

        const found = (Array.isArray(cenList) ? cenList : []).find((c: any) => String(c.id) === cid);
        const withMetrics: Cen | undefined = found
          ? {
              ...(found as any),
              loss: found.loss ?? parseFloat((Math.random() * 2).toFixed(2)),
              latency: found.latency ?? Math.floor(30 + Math.random() * 70),
              sla: found.sla ?? parseFloat((98 + Math.random() * 2).toFixed(2)),
              attachCount: typeof found.attachCount === 'number' ? found.attachCount : (Array.isArray(attachList) ? attachList.length : 0),
            }
          : undefined;

        setCen(withMetrics);
        setTenants(Array.isArray(tenantList) ? tenantList : []);
        const opts: SecurityDomainOption[] = (Array.isArray(domainList) ? domainList : []).map((d: any) => ({
          id: d.id,
          name: d.name,
          type: d.type,
          category: d.category,
          vpcId: d.vpcId,
          provider: d.provider,
          region: d.region,
          cloudId: d.cloudId,
          cidr: d.cidr,
          cidr6: d.cidr6,
          vrName: d.vrName,
          vrUuid: d.vrUuid,
          vrInstanceIds: d.vrInstanceIds,
        vrPublicEniIds: d.vrPublicEniIds,
        vrPrivateEniIds: d.vrPrivateEniIds,
        vrPublicIp: d.vrPublicIp,
        vrPublicEip: d.vrPublicEip,
        vrPrivateIp: d.vrPrivateIp,
        vrPublicSubnetCidr: d.vrPublicSubnetCidr,
        vrPrivateSubnetCidr: d.vrPrivateSubnetCidr,
        }));
        setAllDomains(opts);
        const normalizedAttachments = Array.isArray(attachList) ? attachList : [];
        setAttachments(normalizedAttachments);
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);

  const filteredAttachments = useMemo(() => {
    let list = attachments || [];
    if (domainKeyword) {
      const kw = domainKeyword.toLowerCase();
      list = list.filter((att: any) => {
        const dom = domainOfAttachment(att);
        const title = dom?.name || att.vpcName || att.vpcId || '';
        const did = dom?.id || att.id || '';
        return String(title).toLowerCase().includes(kw) || String(did).toLowerCase().includes(kw);
      });
    }
    if (domainStatusFilter) {
      list = list.filter((att: any) => String(att?.status) === domainStatusFilter);
    }
    return list;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attachments, domainKeyword, domainStatusFilter, allDomains]);

  const attachedForTopo = useMemo(() => {
    return (attachments || []).filter((l: any) => l.status === 'attached' || l.status === 'attaching');
  }, [attachments]);

  useEffect(() => {
    const doms = attachedForTopo.map((att: any) => domainOfAttachment(att)).filter(Boolean) as SecurityDomainOption[];
    const cloudIds = Array.from(new Set(doms.map((d) => String(d.cloudId || '').trim()).filter(Boolean)));
    cloudIds.forEach((cloudId) => {
      if (csmElementGroupCache[cloudId] || csmElementGroupLoading[cloudId]) return;
      setCsmElementGroupLoading((prev) => ({ ...prev, [cloudId]: true }));
      fetchCsmElementGroups(cloudId)
        .then((raw: any) => {
          const list = (raw as any)?.data?.items || (raw as any)?.items || (raw as any)?.data || [];
          const items = Array.isArray(list) ? list : [];
          const map: Record<string, any> = {};
          items.forEach((g: any) => {
            const gid = g?.id ?? g?.vm_group_id ?? g?.vmGroupId ?? g?.group_id ?? g?.groupId ?? g?.vm_group_uuid ?? g?.vmGroupUuid;
            if (gid !== undefined && gid !== null && String(gid).trim() !== '') {
              map[String(gid)] = g;
            }
          });
          setCsmElementGroupCache((prev) => ({ ...prev, [cloudId]: map }));
        })
        .catch(() => setCsmElementGroupCache((prev) => ({ ...prev, [cloudId]: {} })))
        .finally(() => setCsmElementGroupLoading((prev) => ({ ...prev, [cloudId]: false })));
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attachedForTopo, allDomains, csmElementGroupCache, csmElementGroupLoading]);

  useEffect(() => {
    const fetchServices = async () => {
      const attachedIds = attachedForTopo
        .map((att: any) => domainOfAttachment(att)?.id)
        .filter(Boolean) as string[];
      
      if (attachedIds.length === 0) {
        setServices([]);
        return;
      }

      const uniqueIds = Array.from(new Set(attachedIds));
      
      try {
        const results = await Promise.all(uniqueIds.map(id => getSecurityDomain(id).catch(() => null)));
        
        const allServices: SecurityServiceItem[] = [];
        const chainMap: Record<string, boolean> = {};
        
        results.forEach(detail => {
          if (!detail) return;
          const domServices = Array.isArray(detail.securityServices) ? detail.securityServices : [];
          const domChains = Array.isArray(detail.serviceChains) ? detail.serviceChains : [];
          chainMap[String(detail.id)] = domChains.length > 0;
          domServices.forEach((s: any) => {
            allServices.push({
              ...s,
              domainId: detail.id,
              domainName: detail.name
            });
          });
        });
        
        setServices(allServices);
        setDomainServiceChainMap(chainMap);
      } catch (e) {
        console.error('Failed to fetch security services for attached domains', e);
      }
    };

    fetchServices();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attachedForTopo, allDomains]);

  const filteredApps = useMemo(() => {
    const attachedDomainIds = attachedForTopo.map((att: any) => {
       const d = domainOfAttachment(att);
       return d ? String(d.id) : '';
    }).filter(Boolean);

    let list = apps.filter(a => attachedDomainIds.includes(String(a.domainId)));
    if (appKeyword) {
      const kw = appKeyword.toLowerCase();
      list = list.filter(a => a.name.toLowerCase().includes(kw) || a.id.toLowerCase().includes(kw));
    }
    if (appTypeFilter) {
      list = list.filter((a) => String(a.type) === appTypeFilter);
    }
    return list;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apps, attachedForTopo, appKeyword, appTypeFilter, allDomains]);

  const filteredServices = useMemo(() => {
    const attachedDomainIds = attachedForTopo.map((att: any) => {
       const d = domainOfAttachment(att);
       return d ? String(d.id) : '';
    }).filter(Boolean);

    let list = services.filter((s: any) => attachedDomainIds.includes(String(s.domainId)));
    if (serviceKeyword) {
      const kw = serviceKeyword.toLowerCase();
      list = list.filter((s: any) => s.name.toLowerCase().includes(kw) || String(s.id).toLowerCase().includes(kw));
    }
    if (serviceStatusFilter) {
      const f = serviceStatusFilter.toLowerCase();
      list = list.filter((s: any) => String(s?.status || '').toLowerCase() === f);
    }
    return list;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [services, attachedForTopo, serviceKeyword, serviceStatusFilter, allDomains]);

  /** 安全服务表：每实例一行，避免「实例」列多标签聚合 */
  const serviceTableRows = useMemo(
    () =>
      filteredServices.flatMap((r: any) => {
        const inst = getServiceInstances(r, allDomains, csmElementGroupCache);
        const sid = String(r.id ?? pick(r, ['id']) ?? '');
        if (inst.length === 0) {
          return [{ key: `${sid || 's'}-0`, service: r, instance: null as any }];
        }
        return inst.map((it: any, idx: number) => ({
          key: `${sid}-${idx}`,
          service: r,
          instance: it,
        }));
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [filteredServices, allDomains, csmElementGroupCache, csmElementGroupLoading]
  );

  const topologyData = useMemo(() => {
    if (!cen) return null;
    return buildTopologyData({
      cen,
      attachedForTopo,
      domainOfAttachment,
      filteredApps,
      filteredServices,
      domainServiceChainMap,
      ecsIpMap,
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cen, attachedForTopo, filteredApps, filteredServices, domainServiceChainMap, ecsIpMap]);

  const filteredThreats = useMemo(() => {
    const events = Array.isArray(threatEvents) ? threatEvents : [];
    if (!threatKeyword) return events;
    const k = threatKeyword.toLowerCase();
    return events.filter(e => 
      (e.attack_type && e.attack_type.toLowerCase().includes(k)) ||
      (e.start_time && e.start_time.includes(k))
    );
  }, [threatEvents, threatKeyword]);

  const tabs = useCenDetailTabs({
    cen,
    topologyData,
    attachments,
    domainKeyword,
    setDomainKeyword,
    domainStatusFilter,
    setDomainStatusFilter,
    detailRefreshing,
    refreshDetailAttachments,
    openAttachModal,
    filteredAttachments,
    domainOfAttachment,
    topologyHeight,
    setTopologyEl,
    setCen,
    setIsFullScreen,
    filteredApps,
    appKeyword,
    setAppKeyword,
    appTypeFilter,
    setAppTypeFilter,
    allDomains,
    serviceTableRows,
    filteredServices,
    serviceKeyword,
    setServiceKeyword,
    serviceStatusFilter,
    setServiceStatusFilter,
    csmElementGroupCache,
    csmElementGroupLoading,
    threatEvents,
    loadThreats,
    threatLoading,
    threatKeyword,
    setThreatKeyword,
    filteredThreats,
    setCurrentReport,
    setReportModalOpen,
  });

  const validTabs = ['domains', 'topology', 'apps', 'services', 'threats'] as const;
  const rawTab = String(searchParams.get('tab') || 'domains');
  const normalizedTab = rawTab === 'metrics' || rawTab === 'ipsec' ? 'domains' : rawTab;
  const activeTabKey = validTabs.includes(normalizedTab as (typeof validTabs)[number]) ? normalizedTab : 'domains';

  return (
    <>
      <PageDetailContainer
        title={cen?.name || '级联通道详情'}
        icon={<BranchesOutlined />}
        tabs={tabs}
        activeTabKey={activeTabKey}
        defaultActiveTabKey="domains"
        onTabChange={(k) => setSearchParams({ tab: String(k) })}
        pagePadding="24px 36px"
      />

      <Modal title="挂载安全域" open={attachModal.open} onOk={handleAttach} onCancel={() => setAttachModal({ open: false })} destroyOnHidden>
        <Form layout="vertical">
          <Form.Item label="安全域">
            <Select mode="multiple" value={attachDomainIds} onChange={setAttachDomainIds} options={domains.map((d) => ({ value: d.id, label: d.name }))} />
          </Form.Item>
          <Form.Item label="目标通道编号" tooltip="用于将选中的安全域挂载到该级联通道的指定编号，用于通道分组与后续隧道编排。">
            <Select value={attachPlaneIndex} onChange={setAttachPlaneIndex} options={[{ value: 0, label: '通道 0' }, { value: 1, label: '通道 1' }, { value: 2, label: '通道 2' }]} />
          </Form.Item>
        </Form>
      </Modal>
      <Modal
        open={isFullScreen}
        onCancel={() => setIsFullScreen(false)}
        footer={null}
        closable
        title={null}
        centered={false}
        width="100%"
        wrapClassName="cen-cascade-topology-fullscreen-modal"
        style={{ top: 0, paddingBottom: 0, margin: 0, maxWidth: '100vw' }}
        styles={{
          wrapper: { padding: 0 },
          content: {
            margin: 0,
            maxWidth: '100vw',
            width: '100vw',
            height: '100vh',
            padding: 0,
            borderRadius: 0,
            display: 'flex',
            flexDirection: 'column',
          },
          header: { margin: 0, padding: 0, borderBottom: 'none', flexShrink: 0 },
          body: { flex: 1, minHeight: 0, padding: 0, overflow: 'hidden' },
        }}
        destroyOnHidden
      >
        {topologyData && (
          <CenDetailTopologyPanel
            topologyData={topologyData}
            isFull
            topologyHeight={topologyHeight}
            onTopologyMount={setTopologyEl}
            setCen={setCen}
            onRequestFullScreen={() => setIsFullScreen(false)}
          />
        )}
      </Modal>
      <Modal
        open={reportModalOpen}
        onCancel={() => setReportModalOpen(false)}
        title="AI 威胁分析报告"
        width={800}
        footer={null}
        destroyOnHidden
      >
        <div style={{ maxHeight: '60vh', overflowY: 'auto', whiteSpace: 'pre-wrap' }}>
          {currentReport}
        </div>
      </Modal>
    </>
  );
};

export default CenDetailPage;
