import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Badge, Button, Card, Col, Descriptions, Form, Input, message, Modal, Row, Select, Space, Statistic, Table, Tag, TabsProps, Progress } from 'antd';
import {
  AppstoreOutlined,
  BranchesOutlined,
  DashboardOutlined,
  DeploymentUnitOutlined,
  EnvironmentOutlined,
  GatewayOutlined,
  PartitionOutlined,
  FullscreenOutlined,
  ClusterOutlined,
  SafetyCertificateOutlined,
  RobotOutlined,
} from '@ant-design/icons';
import ReactFlow, { Controls, Handle, Position, EdgeProps } from 'react-flow-renderer';
import PageDetailContainer from '../../../../components/PageDetailContainer';
import PageDetailSection from '../../../../components/PageDetailSection';
import SharedToolbar from '../../../../components/SharedToolbar';
import { attachVpcToCen, deleteCen, detachVpcFromCen, fetchCenAttachments, fetchCens, fetchTenants, updateCen, apiPost, fetchCsmElementGroups, fetchServices, fetchCloudProviderEcs } from '../../../../services/api';
import { fetchAiThreatEvents, AiThreatEvent } from '../../../../services/aiSocApi';
import { listSecurityDomains, getSecurityDomain } from '../../../../services/securityDomainApi';
import { getDomainClass, netClassColor, netClassLabel } from '../../../../utils/netClass';
import { calculateTopology, SvcEdge, NodeTypes } from './topology';

interface Cen {
  id: string;
  name: string;
  description?: string;
  strategy?: string;
  topology?: string;
  hubId?: string;
  status: 'creating' | 'available';
  createdAt: string;
  tenantId: string;
  attachCount: number;
  loss?: number;
  latency?: number;
  sla?: number;
  accessIp?: string;
  publicIp?: string;
  privateIp?: string;
}

interface SecurityDomainOption {
  id: string;
  name: string;
  type?: string;
  category?: string;
  subType?: string;
  vpcId?: string;
  provider?: string;
  region?: string;
  cloudId?: string;
  cidr?: string;
  cidr6?: string;
  vrName?: string;
  vrUuid?: string;
  vrInstanceIds?: string;
  vrPublicEniIds?: string;
  vrPrivateEniIds?: string;
  vrPublicIp?: string;
  vrPublicEip?: string;
  vrPrivateIp?: string;
  vrPublicSubnetCidr?: string;
  vrPrivateSubnetCidr?: string;
}

interface AppItem {
  id: string;
  name: string;
  domainId: string;
  domainName?: string;
  type: 'vm' | 'container' | 'service_address' | 'mixed';
  instanceCount: number;
  status: 'running' | 'stopped' | 'degraded';
  version?: string;
  owner?: string;
  serviceAddresses?: Array<{ protocol: string; ip: string; port: string }>;
  servicePorts?: Array<{ protocol: string; port: string }>;
  instances?: any[];
}

interface SecurityServiceItem {
  id: string;
  name: string;
  type?: string;
  vendor?: string;
  defenseType?: string;
  neCount?: number;
  source?: string;
  status?: string;
  domainId?: string;
  domainName?: string;
  [key: string]: any;
}

const CenDetailPage: React.FC = () => {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const [searchParams, setSearchParams] = useSearchParams();

  const [loading, setLoading] = useState(false);
  const [cen, setCen] = useState<Cen | undefined>();
  const [tenants, setTenants] = useState<any[]>([]);
  const [allDomains, setAllDomains] = useState<SecurityDomainOption[]>([]);
  const [attachments, setAttachments] = useState<any[]>([]);

  const [domainKeyword, setDomainKeyword] = useState('');
  const [detailRefreshing, setDetailRefreshing] = useState(false);

  const [attachModal, setAttachModal] = useState<{ open: boolean; cenId?: string }>({ open: false });
  const [domains, setDomains] = useState<SecurityDomainOption[]>([]);
  const [attachDomainIds, setAttachDomainIds] = useState<string[]>([]);
  const [attachPlaneIndex, setAttachPlaneIndex] = useState<number | undefined>();

  const [apps, setApps] = useState<AppItem[]>([]);
  const [services, setServices] = useState<SecurityServiceItem[]>([]);
  const [domainServiceChainMap, setDomainServiceChainMap] = useState<Record<string, boolean>>({});
  const [serviceKeyword, setServiceKeyword] = useState('');
  const [appKeyword, setAppKeyword] = useState('');
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
  }, [apps.length, allDomains.length]);

  const statusBadge = (s: Cen['status']) => {
    const color = s === 'available' ? 'green' : s === 'creating' ? 'blue' : 'default';
    const text = s === 'available' ? '可用' : '创建中';
    return <Badge color={color} text={<span style={{ fontSize: 13 }}>{text}</span>} />;
  };

  const tenantNameById = (tid: string) => tenants.find((t) => t.id === tid)?.name || '-';

  const planeStatsByAttachCount = (cnt: number) => {
    const total = Math.floor((cnt || 0) / 2);
    const active = total;
    return { total, active };
  };

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
        subType: d.subType,
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

  const handleDelete = (cenId: string) => {
    Modal.confirm({
      title: '确认删除该级联通道？',
      onOk: async () => {
        try {
          await deleteCen(cenId);
          message.success('删除成功');
          navigate('/admin/sec-mgr-plane/cascade-channels');
        } catch {
          message.error('删除失败');
        }
      },
    });
  };

  const handleForceDelete = (cenId: string) => {
    Modal.confirm({
      title: '确认强制删除该级联通道？',
      content: '将释放所有已挂载安全域（不删除安全域本身），并删除级联通道。',
      okText: '强制删除',
      onOk: async () => {
        try {
          const { forceDeleteCen } = await import('../../../../services/api');
          await forceDeleteCen(cenId);
          message.success('已强制删除并释放挂载');
          navigate('/admin/sec-mgr-plane/cascade-channels');
        } catch {
          message.error('强制删除失败');
        }
      },
    });
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
          subType: d.subType,
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

  const pick = (obj: any, keys: string[]) => {
    const sources = [obj, obj?.group, obj?.service, obj?.securityService, obj?.elementGroup, obj?.vmGroup];
    for (const src of sources) {
      for (const k of keys) {
        const v = src?.[k];
        if (v !== undefined && v !== null && String(v).trim() !== '') return v;
      }
    }
    return undefined;
  };

  const normalizeInstanceList = (val: any) => {
    if (!val) return [];
    if (Array.isArray(val)) return val;
    if (typeof val === 'string') return val.split(/[;,]/).map((s) => s.trim()).filter(Boolean);
    const items = val?.items || val?.list || val?.data;
    if (Array.isArray(items)) return items;
    return [];
  };

  const getInstances = (r: any) => {
    const direct = normalizeInstanceList(
      pick(r, [
        'elements',
        'elementList',
        'vmList',
        'vm_list',
        'vms',
        'vm_id_list',
        'vmIds',
        'vmIdList',
        'neList',
        'ne_id_list',
        'neIds',
        'neIdList',
        'instances',
        'instanceList',
        'members',
      ])
    );
    if (direct.length > 0) return direct;

    const dom = allDomains.find((d) => String(d.id) === String(r.domainId));
    const cloudId = dom?.cloudId ? String(dom.cloudId).trim() : '';
    if (!cloudId) return [];

    const gidRaw = pick(r, ['id', 'vm_group_id', 'vmGroupId', 'group_id', 'groupId', 'vm_group_uuid', 'vmGroupUuid']);
    const gid = gidRaw !== undefined && gidRaw !== null ? String(gidRaw).trim() : '';
    const g = gid ? csmElementGroupCache[cloudId]?.[gid] : undefined;
    if (!g) return [];

    return normalizeInstanceList(
      pick(g, [
        'elements',
        'elementList',
        'vmList',
        'vm_list',
        'vms',
        'vm_id_list',
        'vmIds',
        'vmIdList',
        'neList',
        'ne_id_list',
        'neIds',
        'neIdList',
        'instances',
        'instanceList',
        'members',
        'items',
      ])
    );
  };

  const calcNeCount = (r: any) => {
    const v = pick(r, ['neCount', 'count', 'Count', 'elementCount', 'elementsCount', 'elements_count', 'vm_count', 'vmCount', 'ne_count']);
    if (v === 0 || v) return Number(v);
    const list = getInstances(r);
    if (list.length > 0) return list.length;
    return '-';
  };

  const handleSSO = async (r: any) => {
    const instances = getInstances(r);
    if (instances.length === 0) {
      message.warning('该服务无实例，无法访问');
      return;
    }

    const first = instances[0];
    const instanceId = typeof first === 'object' ? (first.id || first.uuid || first.vm_id || first.vrouter_id) : first;
    if (!instanceId) {
      message.warning('实例ID未找到');
      return;
    }

    const dom = allDomains.find((d) => String(d.id) === String(r.domainId));
    const cloudId = dom?.cloudId;
    if (!cloudId) {
      message.error('未找到关联的云资源ID');
      return;
    }

    try {
      message.loading({ content: '正在发起SSO访问...', key: 'sso' });
      const res: any = await apiPost(`/api/clouds/${cloudId}/csm/security/domain/attach/callOnSSO`, {
        id: instanceId,
        currentLoginWebPort: '8020',
      });
      message.success({ content: 'SSO请求成功，正在跳转...', key: 'sso' });

      const url = res?.data?.url || res?.url;
      if (url) {
        window.open(url, '_blank');
      } else {
        message.warning('未返回跳转URL');
      }
    } catch (e: any) {
      message.error({ content: `SSO访问失败: ${e.message}`, key: 'sso' });
    }
  };

  const renderCommonToolbar = (
    placeholder: string, 
    value: string, 
    onChange: (val: string) => void,
    columnsConfig?: {
      value: string[];
      options: { label: string; value: string }[];
      onChange: (vals: string[]) => void;
    }
  ) => ({
    toolbarLeft: (
      <Space>
        <Input 
          placeholder={placeholder} 
          style={{ width: 240 }} 
          allowClear 
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
        <Select 
          placeholder="状态" 
          style={{ width: 120 }} 
          allowClear
          options={[
            { label: 'Active', value: 'active' },
            { label: 'Inactive', value: 'inactive' }
          ]}
        />
      </Space>
    ),
    onRefresh: () => refreshDetailAttachments(cen?.id),
    refreshLoading: detailRefreshing,
    columnsConfig: columnsConfig || {
        value: ['id', 'name', 'status'],
        options: [
            { label: 'ID', value: 'id' },
            { label: '名称', value: 'name' },
            { label: '状态', value: 'status' },
            { label: '类型', value: 'type' },
            { label: '描述', value: 'description' },
            { label: '创建时间', value: 'createdAt' },
            { label: '更新时间', value: 'updatedAt' },
            { label: '标签', value: 'tags' },
            { label: '区域', value: 'region' },
            { label: '云提供商', value: 'provider' },
        ],
        onChange: (vals: string[]) => console.log('Columns changed:', vals)
    }
  });

  const overviewContent = useMemo(() => {
    if (!cen) return null;
    const { total, active } = planeStatsByAttachCount(cen.attachCount || 0);
    return (
      <Descriptions bordered size="small" column={4}>
        <Descriptions.Item label="名称">{cen.name}</Descriptions.Item>
        <Descriptions.Item label="租户">{tenantNameById(cen.tenantId)}</Descriptions.Item>
        <Descriptions.Item label="策略">
          <Tag color={cen.strategy === 'IPsec' ? 'cyan' : 'geekblue'}>{cen.strategy || 'SRv6'}</Tag>
        </Descriptions.Item>
        <Descriptions.Item label="状态">{statusBadge(cen.status)}</Descriptions.Item>
        <Descriptions.Item label="级联通道">
          <Tag color={active > 0 ? 'green' : 'default'}>{`${active}/${total}`}</Tag>
        </Descriptions.Item>
        <Descriptions.Item label="丢包率">
          {cen.loss !== undefined ? <Tag color={cen.loss < 1 ? 'green' : cen.loss < 3 ? 'orange' : 'red'}>{cen.loss.toFixed(2)}%</Tag> : '--'}
        </Descriptions.Item>
        <Descriptions.Item label="延迟">
          {cen.latency ? <Tag color={cen.latency < 50 ? 'green' : cen.latency < 100 ? 'orange' : 'red'}>{cen.latency}ms</Tag> : '--'}
        </Descriptions.Item>
        <Descriptions.Item label="SLA">
          {cen.sla ? <Tag color={cen.sla > 99 ? 'green' : cen.sla > 95 ? 'orange' : 'red'}>{cen.sla}%</Tag> : '--'}
        </Descriptions.Item>
        <Descriptions.Item label="创建时间">{cen.createdAt || '-'}</Descriptions.Item>
      </Descriptions>
    );
  }, [cen, tenants]);

  const subtitleText = useMemo(() => {
    if (loading) return '加载中...';
    if (!cen) return '级联通道资源详情';
    return [
      '管理跨地域/跨云的级联通道，支持挂载安全域与分组，可在 Mesh / Hub‑Spoke 拓扑间切换并指定中心节点',
    ].join(' ');
  }, [cen, loading]);

  const filteredAttachments = useMemo(() => {
    if (!domainKeyword) return attachments;
    const kw = domainKeyword.toLowerCase();
    return (attachments || []).filter((att: any) => {
      const dom = domainOfAttachment(att);
      const title = dom?.name || att.vpcName || att.vpcId || '';
      const did = dom?.id || att.id || '';
      return String(title).toLowerCase().includes(kw) || String(did).toLowerCase().includes(kw);
    });
  }, [attachments, domainKeyword, allDomains]);

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
    return list;
  }, [apps, attachedForTopo, appKeyword, allDomains]);

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
    return list;
  }, [services, attachedForTopo, serviceKeyword, allDomains]);

  const topologyData = useMemo(() => {
    if (!cen) return null;
    const record = cen;
    const topo = record.topology || 'Mesh';
    const hubId = record.hubId;
    const domsRaw = attachedForTopo.map((att: any) => ({ att, dom: domainOfAttachment(att) })).filter((x: any) => !!x.dom);

    const doms = (() => {
      const d = domsRaw.slice();
      if (topo === 'Hub-Spoke') {
        const idx = hubId ? d.findIndex((it: any) => String(it.dom!.id) === String(hubId)) : 0;
        if (idx > -1 && idx < d.length) {
          const [hub] = d.splice(idx, 1);
          d.unshift(hub);
        }
      }
      return d;
    })();

    const vrCount = (() => {
      const keys = new Set<string>();
      doms.forEach((it: any) => {
        const key = it?.dom?.vrUuid || `vr-${it?.dom?.id}`;
        if (key) keys.add(String(key));
      });
      return keys.size;
    })();

    const { nodes, edges } = calculateTopology({
      doms,
      apps: filteredApps,
      services: filteredServices,
      domainServiceChainMap,
      ecsIpMap,
      topologyType: topo,
      hubId
    });

    return { nodes, edges, topo, hubId, doms, vrCount, record };
  }, [cen, attachedForTopo, filteredApps, filteredServices, domainServiceChainMap, ecsIpMap, allDomains]);

  const renderTopologyContent = (isFull: boolean) => {
    if (!topologyData) return null;
    const { nodes, edges, topo, hubId, doms, record } = topologyData;

    return (
      <div 
        ref={!isFull ? setTopologyEl : undefined} 
        style={{ 
          height: isFull ? '100%' : topologyHeight, 
          minHeight: isFull ? 0 : 460, 
          border: isFull ? 'none' : '1px solid #e8e8e8', 
          borderRadius: isFull ? 0 : 12, 
          background: '#fafafa', 
          backgroundImage: 'radial-gradient(rgba(0,0,0,0.08) 1px, transparent 1px)', 
          backgroundSize: '22px 22px', 
          backgroundPosition: '0 0', 
          overflow: 'hidden', 
          position: 'relative' 
        }}
      >
        <div style={{ position: 'absolute', top: 12, left: 12, zIndex: 10, display: 'flex', gap: 8, alignItems: 'center' }}>
          <span style={{ color: '#666', fontSize: 12 }}>拓扑模式</span>
          <Select
            size="small"
            value={topo}
            style={{ width: 110 }}
            onChange={async (v) => {
              try {
                await updateCen(record.id, { topology: v });
                setCen((prev) => (prev ? { ...prev, topology: v } : prev));
                message.success('拓扑模式已更新');
              } catch {
                message.error('更新失败');
              }
            }}
            options={[{ value: 'Mesh', label: 'Mesh' }, { value: 'Hub-Spoke', label: 'Hub-Spoke' }]}
          />
          {topo === 'Hub-Spoke' && (
            <>
              <span style={{ color: '#666', fontSize: 12, marginLeft: 8 }}>中心节点</span>
              <Select
                size="small"
                value={hubId || (doms.length > 0 ? String(doms[0].dom!.id) : undefined)}
                placeholder="选择Hub"
                style={{ width: 140 }}
                onChange={async (v) => {
                  try {
                    await updateCen(record.id, { hubId: v });
                    setCen((prev) => (prev ? { ...prev, hubId: v } : prev));
                    message.success('中心节点已更新');
                  } catch {
                    message.error('更新失败');
                  }
                }}
                options={doms.map((d: any) => ({ value: String(d.dom!.id), label: d.dom!.name }))}
              />
            </>
          )}
          {!isFull && (
            <Button 
                icon={<FullscreenOutlined />} 
                size="small" 
                onClick={() => setIsFullScreen(true)} 
                title="全屏查看"
            />
          )}
        </div>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={NodeTypes}
          edgeTypes={{ svcEdge: SvcEdge }}
          fitView
          fitViewOptions={{ padding: 0.2, maxZoom: 1.0 }}
          minZoom={0.4}
          maxZoom={1.6}
          style={{ background: 'transparent', width: '100%', height: '100%' }}
        >
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>
    );
  };

  const filteredThreats = useMemo(() => {
    const events = Array.isArray(threatEvents) ? threatEvents : [];
    if (!threatKeyword) return events;
    const k = threatKeyword.toLowerCase();
    return events.filter(e => 
      (e.attack_type && e.attack_type.toLowerCase().includes(k)) ||
      (e.start_time && e.start_time.includes(k))
    );
  }, [threatEvents, threatKeyword]);

  const tabs = useMemo(() => {
    if (!cen || !topologyData) return [];
    const record = cen;
    const { vrCount } = topologyData;

    return [
      {
        key: 'metrics',
        label: '总览',
        icon: <DashboardOutlined />,
        children: (
          <PageDetailSection>
            <div style={{ marginBottom: 24 }}>
              <div style={{ fontSize: 16, fontWeight: 500, marginBottom: 16 }}>资源统计</div>
              <Row gutter={[16, 16]}>
                <Col span={6}>
                  <Card size="small" style={{ borderRadius: 8, border: '1px solid #f0f0f0' }}>
                    <Statistic title="安全域" value={attachments.length} valueStyle={{ fontSize: 24, fontWeight: 700 }} />
                  </Card>
                </Col>
                <Col span={6}>
                  <Card size="small" style={{ borderRadius: 8, border: '1px solid #f0f0f0' }}>
                    <Statistic title="应用" value={filteredApps.length} valueStyle={{ fontSize: 24, fontWeight: 700 }} />
                  </Card>
                </Col>
                <Col span={6}>
                  <Card size="small" style={{ borderRadius: 8, border: '1px solid #f0f0f0' }}>
                    <Statistic title="安全服务" value={filteredServices.length} valueStyle={{ fontSize: 24, fontWeight: 700 }} />
                  </Card>
                </Col>
                <Col span={6}>
                  <Card size="small" style={{ borderRadius: 8, border: '1px solid #f0f0f0' }}>
                    <Statistic title="AI 威胁事件" value={threatEvents.length} valueStyle={{ fontSize: 24, fontWeight: 700 }} />
                  </Card>
                </Col>
              </Row>
            </div>

            <div>
              <div style={{ fontSize: 16, fontWeight: 500, marginBottom: 16 }}>质量指标</div>
              <Row gutter={[16, 16]}>
                <Col xs={24} sm={6}>
                  <Card size="small" style={{ borderRadius: 8, border: '1px solid #f0f0f0' }}>
                    <Statistic title="丢包率" value={cen?.loss ?? 0} precision={2} suffix="%" valueStyle={{ fontSize: 24, fontWeight: 700 }} />
                  </Card>
                </Col>
                <Col xs={24} sm={6}>
                  <Card size="small" style={{ borderRadius: 8, border: '1px solid #f0f0f0' }}>
                    <Statistic title="延迟" value={cen?.latency ?? 0} suffix="ms" valueStyle={{ fontSize: 24, fontWeight: 700 }} />
                  </Card>
                </Col>
                <Col xs={24} sm={6}>
                  <Card size="small" style={{ borderRadius: 8, border: '1px solid #f0f0f0' }}>
                    <Statistic title="SLA" value={cen?.sla ?? 0} precision={2} suffix="%" valueStyle={{ fontSize: 24, fontWeight: 700 }} />
                  </Card>
                </Col>
              </Row>
            </div>
          </PageDetailSection>
        )
      },
      {
        key: 'domains',
        label: '安全域',
        icon: <EnvironmentOutlined />,
        count: attachments.length || 0,
        children: (
          <PageDetailSection
            toolbarLeft={<Input placeholder="搜索安全域名称/ID" value={domainKeyword} onChange={(e) => setDomainKeyword(e.target.value)} allowClear />}
            onRefresh={() => refreshDetailAttachments(record.id)}
            refreshLoading={detailRefreshing}
            primaryAction={{ label: '挂载安全域', onClick: () => openAttachModal(record.id) }}
          >
            <Table
              size="middle"
              bordered
              rowKey="id"
              dataSource={filteredAttachments}
              pagination={{ pageSize: 10, size: 'default' }}
              locale={{ emptyText: '暂无已挂载安全域' }}
              columns={[
                {
                  title: '安全域',
                  key: 'info',
                  render: (_: any, r: any) => {
                    const dom = domainOfAttachment(r);
                    const title = dom?.name || r.vpcName || r.vpcId;
                    const cls = getDomainClass({ category: dom?.category, subType: dom?.subType });
                    return (
                      <div style={{ display: 'flex', flexDirection: 'column' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span style={{ fontWeight: 500 }}>{title}</span>
                          {dom && <Tag color={netClassColor(cls)} style={{ margin: 0, fontSize: 10, lineHeight: '18px' }}>{netClassLabel(cls)}</Tag>}
                        </div>
                        <div style={{ fontSize: 12, color: '#888' }}>{dom?.id || '-'}</div>
                      </div>
                    );
                  }
                },
                {
                  title: 'VPC / CIDR',
                  key: 'vpc',
                  render: (_: any, r: any) => {
                    const dom = domainOfAttachment(r);
                    return (
                      <div style={{ fontSize: 12 }}>
                        <div>{dom?.vpcId || r.vpcId || '-'}</div>
                        <div style={{ color: '#888' }}>{dom?.cidr || r.vpcCidr || '-'}</div>
                        {dom?.cidr6 && <div style={{ color: '#888' }}>{dom.cidr6}</div>}
                      </div>
                    );
                  }
                },
                {
                  title: '云商 / 地域',
                  key: 'region',
                  render: (_: any, r: any) => {
                    const dom = domainOfAttachment(r);
                    return (
                      <div style={{ fontSize: 12 }}>
                        <div>{dom?.provider || '-'}</div>
                        <div style={{ color: '#888' }}>{dom?.region || '-'}</div>
                      </div>
                    );
                  }
                },
                {
                  title: '关联 VR',
                  key: 'vr',
                  render: (_: any, r: any) => {
                    const dom = domainOfAttachment(r);
                    return (
                      <div style={{ fontSize: 12 }}>
                        <div>{dom?.vrName || dom?.vrUuid || '-'}</div>
                        {dom?.vrPublicIp && <div style={{ color: '#888' }}>WAN: {dom.vrPublicIp}</div>}
                        {dom?.vrPrivateIp && <div style={{ color: '#888' }}>Pri: {dom.vrPrivateIp}</div>}
                      </div>
                    );
                  }
                },
                {
                  title: '状态',
                  dataIndex: 'status',
                  key: 'status',
                  width: 100,
                  render: (s: string) => <Badge status={s === 'attached' ? 'success' : 'processing'} text={s === 'attached' ? '已挂载' : s} />
                },
                {
                  title: '操作',
                  key: 'op',
                  width: 80,
                  render: (_: any, r: any) => (
                    r.status === 'attached' ? (
                      <Button
                        type="link"
                        danger
                        size="small"
                        style={{ padding: 0 }}
                        onClick={async () => {
                          try {
                            await detachVpcFromCen(record.id, r.id);
                            message.success('已解除挂载');
                            await refreshDetailAttachments(record.id);
                          } catch {
                            message.error('解除失败');
                          }
                        }}
                      >
                        解除
                      </Button>
                    ) : null
                  )
                }
              ]}
            />
          </PageDetailSection>
        )
      },
      {
        key: 'topology',
        label: '级联通道拓扑',
        icon: <BranchesOutlined />,
        count: vrCount || 0,
        children: (
            <PageDetailSection>
                {renderTopologyContent(false)}
            </PageDetailSection>
        )
      },
      {
        key: 'apps',
        label: '应用',
        icon: <AppstoreOutlined />,
        count: filteredApps.length || 0,
        children: (
          <PageDetailSection
            {...renderCommonToolbar(
              "搜索应用...", 
              appKeyword, 
              setAppKeyword,
              {
                value: ['name', 'id', 'domain', 'type', 'instanceCount', 'version', 'owner', 'status'],
                options: [
                  { label: '名称', value: 'name' },
                  { label: '应用ID', value: 'id' },
                  { label: '所属安全域', value: 'domain' },
                  { label: '类型', value: 'type' },
                  { label: '实例数', value: 'instanceCount' },
                  { label: '版本', value: 'version' },
                  { label: '负责人', value: 'owner' },
                  { label: '状态', value: 'status' },
                ],
                onChange: (vals: string[]) => console.log('Columns changed:', vals)
              }
            )}
          >
            <Table
              size="middle"
              bordered
              rowKey="id"
              dataSource={filteredApps}
              pagination={{ pageSize: 10, size: 'default' }}
              locale={{ emptyText: '暂无关联应用' }}
              columns={[
                { title: '名称', dataIndex: 'name', key: 'name' },
                { title: '应用ID', dataIndex: 'id', key: 'id' },
                { title: '所属安全域', key: 'domain', render: (_: any, r: AppItem) => {
                  const dom = allDomains.find(d => String(d.id) === String(r.domainId));
                  return dom?.name || r.domainName || r.domainId;
                }},
                { title: '类型', dataIndex: 'type', key: 'type', render: (t: string) => <Tag color="blue">{t?.toUpperCase()}</Tag> },
                { title: '实例数', dataIndex: 'instanceCount', key: 'instanceCount' },
                { title: '版本', dataIndex: 'version', key: 'version' },
                { title: '负责人', dataIndex: 'owner', key: 'owner' },
                { title: '状态', dataIndex: 'status', key: 'status' },
              ]}
            />
          </PageDetailSection>
        )
      },
      {
        key: 'services',
        label: '安全服务',
        icon: <SafetyCertificateOutlined />,
        count: filteredServices.length || 0,
        children: (
          <PageDetailSection
            {...renderCommonToolbar(
              "搜索服务...", 
              serviceKeyword, 
              setServiceKeyword,
              {
                value: ['name', 'id', 'domain', 'type', 'vendor', 'defenseType', 'neCount'],
                options: [
                  { label: '名称', value: 'name' },
                  { label: 'ID', value: 'id' },
                  { label: '所属安全域', value: 'domain' },
                  { label: '类型', value: 'type' },
                  { label: '厂商', value: 'vendor' },
                  { label: '防御类型', value: 'defenseType' },
                  { label: '网元数量', value: 'neCount' },
                ],
                onChange: (vals: string[]) => console.log('Columns changed:', vals)
              }
            )}
          >
            <Table
              size="middle"
              bordered
              rowKey="id"
              dataSource={filteredServices}
              pagination={{ pageSize: 10, size: 'default' }}
              locale={{ emptyText: '暂无关联安全服务' }}
              columns={[
                { title: '名称', key: 'name', ellipsis: true, render: (_: any, r: any) => String(pick(r, ['name', 'vm_group_name', 'vmGroupName', 'groupName', 'securityServiceName', 'serviceName', 'title', 'displayName']) ?? '-') },
                { title: 'ID', dataIndex: 'id', key: 'id', ellipsis: true },
                { title: '所属安全域', key: 'domain', render: (_: any, r: any) => {
                  const dom = allDomains.find(d => String(d.id) === String(r.domainId));
                  return dom?.name || r.domainName || r.domainId;
                }},
                { title: '类型', key: 'type', ellipsis: true, render: (_: any, r: any) => String(pick(r, ['type', 'groupType', 'vm_group_type', 'vmGroupType', 'productType', 'product_type', 'kind', 'category']) ?? '-') },
                { title: '厂商', key: 'vendor', ellipsis: true, render: (_: any, r: any) => String(pick(r, ['vendor', 'manufacturer', 'vendor_name', 'vendorName', 'factory', 'brand', 'company', 'maker', 'provider']) ?? '-') },
                { title: '防御类型', key: 'defenseType', ellipsis: true, render: (_: any, r: any) => String(pick(r, ['defenseType', 'defense_type', 'protectType', 'protect_type', 'protectionType', 'protection_type', 'securityType', 'security_type']) ?? '-') },
                { title: '网元数量', key: 'neCount', width: 100, render: (_: any, r: any) => calcNeCount(r) },
                 { 
                   title: '实例列表', 
                   key: 'instances',
                   width: 200,
                   render: (_: any, r: any) => {
                      const list = getInstances(r);
                      if (!list || list.length === 0) {
                        const dom = allDomains.find((d) => String(d.id) === String(r.domainId));
                        const cloudId = dom?.cloudId ? String(dom.cloudId).trim() : '';
                        const cnt = calcNeCount(r);
                        if (cloudId && csmElementGroupLoading[cloudId] && cnt !== '-' && Number(cnt) > 0) return '加载中';
                        return '-';
                      }
                      const show = list.slice(0, 3);
                      return (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                          {show.map((item: any, idx: number) => {
                              const label = typeof item === 'object' ? (item.name || item.id) : item;
                              return <Tag key={idx} style={{ margin: 0, fontSize: 10 }}>{label}</Tag>;
                          })}
                          {list.length > 3 && <Tag style={{ margin: 0, fontSize: 10 }}>+{list.length - 3}</Tag>}
                        </div>
                      );
                   }
                 },
                {
                    title: '操作',
                    key: 'op',
                    width: 100,
                    render: (_: any, r: any) => (
                        <Button type="link" size="small" onClick={() => handleSSO(r)}>SSO访问</Button>
                    )
                }
              ]}
            />
          </PageDetailSection>
        )
      },

      {
        key: 'threats',
        label: 'AI 威胁事件',
        icon: <RobotOutlined />,
        count: threatEvents.length || 0,
        children: (
          <PageDetailSection>
            <SharedToolbar 
              left={<Input placeholder="搜索威胁名称、类型、时间" value={threatKeyword} onChange={e => setThreatKeyword(e.target.value)} allowClear style={{ width: 260 }} />}
              onRefresh={loadThreats}
              refreshLoading={threatLoading}
            />
            <Table
              bordered
              rowKey="created_at"
              dataSource={filteredThreats}
              loading={threatLoading}
              pagination={{ pageSize: 10 }}
              locale={{ emptyText: '暂无威胁事件' }}
              columns={[
                { title: '威胁名称', dataIndex: 'tname', key: 'tname', render: (t: string) => t || '生成中' },
                { title: '风险等级', dataIndex: 'risk_level', key: 'risk_level', render: (t: string) => t || '生成中' },
                { title: '攻击类型', dataIndex: 'attack_type', key: 'attack_type', render: (t: string) => <Tag color="red">{t}</Tag> },
                { title: '开始时间', dataIndex: 'start_time', key: 'start_time', render: (t: string) => t?.replace('T', ' ').split('.')[0] },
                { title: '结束时间', dataIndex: 'end_time', key: 'end_time', render: (t: string) => t?.replace('T', ' ').split('.')[0] },
                { 
                  title: '分析进度', 
                  dataIndex: 'progress', 
                  key: 'progress', 
                  render: (val: number) => <Progress percent={val} size="small" status={val === 100 ? 'success' : 'active'} style={{ width: 140 }} />
                },
                { title: '报告生成时间', dataIndex: 'created_at', key: 'created_at', render: (t: string) => t?.replace('T', ' ').split('.')[0] },
                { 
                  title: '操作', 
                  key: 'op', 
                  render: (_: any, r: AiThreatEvent) => (
                    <Space>
                      {r.md_report && (
                        <Button 
                          type="link" 
                          size="small" 
                          onClick={() => {
                            setCurrentReport(r.md_report);
                            setReportModalOpen(true);
                          }}
                        >
                          查看报告
                        </Button>
                      )}
                      {r.report_url && r.report_url.length > 0 && (
                        <Button 
                          type="link" 
                          size="small" 
                          href={r.report_url[0]} 
                          target="_blank"
                        >
                          下载文档
                        </Button>
                      )}
                    </Space>
                  ) 
                }
              ]}
            />
          </PageDetailSection>
        )
      }
    ];
  }, [cen, tenants, allDomains, attachments, domainKeyword, detailRefreshing, attachedForTopo, topologyHeight, filteredApps, appKeyword, filteredServices, serviceKeyword, topologyData, threatEvents, threatLoading, filteredThreats, threatKeyword]);

  const tabFromUrl = String(searchParams.get('tab') || 'metrics');
  const activeTabKey = ['metrics', 'domains', 'topology', 'apps', 'services', 'threats'].includes(tabFromUrl) ? tabFromUrl : 'metrics';

  return (
    <>
      <PageDetailContainer
        title={cen?.name || '级联通道详情'}
        icon={<BranchesOutlined />}
        onBack={() => navigate('/admin/sec-mgr-plane/cascade-channels')}
        overviewContent={overviewContent}
        subtitle={subtitleText}
        tabs={tabs}
        activeTabKey={activeTabKey}
        defaultActiveTabKey="metrics"
        onTabChange={(k) => setSearchParams({ tab: String(k) })}
        pagePadding="24px 36px"
        moreMenuItems={[
          { key: 'refresh', label: '资源刷新' },
          { key: 'attach', label: '挂载安全域' },
          { key: 'delete', label: '删除级联通道' },
          { key: 'forceDelete', label: '强制删除（释放挂载）' },
        ]}
        onMoreMenuClick={({ key }) => {
          const cenId = String(cen?.id || '');
          if (!cenId) return;
          if (key === 'refresh') return refreshDetailAttachments(cenId);
          if (key === 'attach') return openAttachModal(cenId);
          if (key === 'delete') return handleDelete(cenId);
          if (key === 'forceDelete') return handleForceDelete(cenId);
        }}
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
        width="95%"
        style={{ top: '5vh' }}
        bodyStyle={{ height: '85vh', padding: 0, overflow: 'hidden' }}
        title={null}
        destroyOnClose
      >
        {renderTopologyContent(true)}
      </Modal>
      <Modal
        open={reportModalOpen}
        onCancel={() => setReportModalOpen(false)}
        title="AI 威胁分析报告"
        width={800}
        footer={null}
        destroyOnClose
      >
        <div style={{ maxHeight: '60vh', overflowY: 'auto', whiteSpace: 'pre-wrap' }}>
          {currentReport}
        </div>
      </Modal>
    </>
  );
};

export default CenDetailPage;
