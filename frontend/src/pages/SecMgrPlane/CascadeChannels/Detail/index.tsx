import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Badge, Button, Card, Col, Descriptions, Form, Input, message, Modal, Row, Select, Space, Statistic, Table, Tag } from 'antd';
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
} from '@ant-design/icons';
import ReactFlow, { Controls, Handle, Position, getBezierPath, EdgeProps } from 'react-flow-renderer';
import PageDetailContainer from '../../../../components/PageDetailContainer';
import PageDetailSection from '../../../../components/PageDetailSection';
import { attachVpcToCen, deleteCen, detachVpcFromCen, fetchCenAttachments, fetchCens, fetchTenants, updateCen, apiPost, fetchCsmElementGroups } from '../../../../services/api';
import { listSecurityDomains, getSecurityDomain } from '../../../../services/securityDomainApi';
import { getDomainClass, netClassColor, netClassLabel } from '../../../../utils/netClass';

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
  type: 'vm' | 'container' | 'mixed';
  instanceCount: number;
  status: 'running' | 'stopped' | 'degraded';
  version?: string;
  owner?: string;
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
  const [serviceKeyword, setServiceKeyword] = useState('');
  const [appKeyword, setAppKeyword] = useState('');
  const [csmElementGroupCache, setCsmElementGroupCache] = useState<Record<string, Record<string, any>>>({});
  const [csmElementGroupLoading, setCsmElementGroupLoading] = useState<Record<string, boolean>>({});

  const [topologyEl, setTopologyEl] = useState<HTMLDivElement | null>(null);
  const [topologyHeight, setTopologyHeight] = useState(460);

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

  useEffect(() => {
    try {
      const rawApps = localStorage.getItem('security_apps') || '[]';
      const parsedApps = JSON.parse(rawApps);
      setApps(Array.isArray(parsedApps) ? parsedApps : []);
    } catch {
      setApps([]);
    }
  }, []);

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
        
        results.forEach(detail => {
          if (!detail) return;
          const domServices = Array.isArray(detail.securityServices) ? detail.securityServices : [];
          domServices.forEach((s: any) => {
            allServices.push({
              ...s,
              domainId: detail.id,
              domainName: detail.name
            });
          });
        });
        
        setServices(allServices);
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

  const tabs = useMemo(() => {
    if (!cen) return [];
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

    return [
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
                        {dom?.vrPublicEip && <div style={{ color: '#888' }}>EIP: {dom.vrPublicEip}</div>}
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
        children: (() => {
          const SvcEdge: React.FC<EdgeProps> = ({
            id,
            sourceX,
            sourceY,
            targetX,
            targetY,
            sourcePosition,
            targetPosition,
            style = {},
          }) => {
            const edgePath = getBezierPath({
              sourceX,
              sourceY,
              sourcePosition,
              targetX,
              targetY,
              targetPosition,
            });
            return (
              <>
                <defs>
                  <marker id={`svc-arrow-${id}`} markerWidth="10" markerHeight="10" viewBox="0 0 10 10" refX="8" refY="5" orient="auto-start-reverse">
                    <path d="M 0 0 L 10 5 L 0 10 z" fill="#fa8c16" />
                  </marker>
                </defs>
                <path
                  id={id}
                  className="react-flow__edge-path"
                  d={edgePath}
                  style={{ stroke: '#fa8c16', strokeWidth: 2, filter: 'drop-shadow(0 0 2px rgba(250,140,22,0.35))', ...(style as any) }}
                  markerEnd={`url(#svc-arrow-${id})`}
                />
                <circle r="3" fill="#fa8c16">
                  <animateMotion dur="1.8s" repeatCount="indefinite" path={edgePath} />
                </circle>
              </>
            );
          };

          // 1. Group domains by VR (Main Nodes)
          const vrGroups = new Map<string, { vr: any; domains: any[] }>();
          const domList = doms;
          
          domList.forEach((item: any) => {
            // Use VR UUID as key, fallback to domain ID if no VR info (1-to-1 case)
            const vrKey = item.dom?.vrUuid || `vr-${item.dom?.id}`;
            if (!vrGroups.has(vrKey)) {
              vrGroups.set(vrKey, { 
                vr: {
                   id: vrKey,
                   name: item.dom?.vrName || item.dom?.vrUuid || '未命名VR',
                   eip: item.dom?.vrPublicEip || item.dom?.vrPublicIp || '-',
                   privateIp: item.dom?.vrPrivateIp || '-'
                }, 
                domains: [] 
              });
            }
            vrGroups.get(vrKey)!.domains.push(item);
          });

          const vrList = Array.from(vrGroups.values());
          const totalVRs = vrList.length;
          const centerX = 520;
          const centerY = 300;
          const vrRadius = 250;

          const nodeTypes = {
            mainNode: (props: any) => (
              <div style={{ width: 100, height: 80, borderRadius: 12, background: '#fff', border: '1px solid #e5e5e5', boxShadow: '0 4px 12px rgba(0,0,0,0.06)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 0, position: 'relative' }}>
                <div style={{ width: 22, height: 22, borderRadius: '50%', border: '2px solid #1677ff', display: 'flex', alignItems: 'center', justifyContent: 'center', boxSizing: 'border-box' }}>
                  <FullscreenOutlined style={{ fontSize: 14, color: '#1677ff' }} />
                </div>
                <label style={{ fontSize: 12, color: '#1f1f1f', fontWeight: 600, width: '100%',  boxSizing: 'border-box', textAlign: 'center', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: 4 }}>
                  {props?.data?.title || '-'}
                </label>
                <div style={{ fontSize: 12, color: '#8c8c8c', width: '100%', boxSizing: 'border-box', textAlign: 'center', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{props?.data?.eip || '-'}</div>
                <Handle type="source" position={Position.Top} id="pub" style={{ opacity: 0, left: '50%', top: '50%', transform: 'translate(-50%, -50%)' }} />
                <Handle type="target" position={Position.Top} id="pub" style={{ opacity: 0, left: '50%', top: '50%', transform: 'translate(-50%, -50%)' }} />
              </div>
            ),
            domainCard: (props: any) => (
              <div style={{ width: 160, height: 80, borderRadius: 10, background: '#fff', border: '1px solid #e5e5e5', boxShadow: '0 3px 10px rgba(0,0,0,0.05)', display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 6, padding: '8px 12px', position: 'relative' }}>
                <div style={{ fontSize: 12, color: '#1f1f1f', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{props?.data?.title || '-'}</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap', overflow: 'hidden' }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 6px', borderRadius: 8, border: '1px solid #e6f0ff', background: '#f7f9ff', maxWidth: 120 }}>
                    <ClusterOutlined style={{ fontSize: 12, color: '#fa8c16' }} />
                    <span style={{ fontSize: 12, color: '#3a3a3a', overflow: 'hidden', textOverflow: 'ellipsis' }}>{props?.data?.vpcCidr || '-'}</span>
                  </span>
                </div>
                <Handle type="source" position={Position.Top} id="card" style={{ opacity: 0, left: '50%', top: '50%', transform: 'translate(-50%, -50%)' }} />
                <Handle type="target" position={Position.Top} id="card" style={{ opacity: 0, left: '50%', top: '50%', transform: 'translate(-50%, -50%)' }} />
              </div>
            ),
            appCard: (props: any) => (
              <div style={{ width: 160, height: 60, borderRadius: 10, background: '#fff', border: '1px solid #e5e5e5', boxShadow: '0 3px 10px rgba(0,0,0,0.05)', display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 4, padding: '8px 12px', position: 'relative' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <AppstoreOutlined style={{ color: '#1677ff' }} />
                  <div style={{ fontSize: 12, color: '#1f1f1f', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{props?.data?.title || '-'}</div>
                </div>
                <div style={{ fontSize: 12, color: '#888', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{props?.data?.subTitle || '-'}</div>
                <Handle type="source" position={Position.Top} id="app" style={{ opacity: 0, left: '50%', top: '50%', transform: 'translate(-50%, -50%)' }} />
                <Handle type="target" position={Position.Top} id="app" style={{ opacity: 0, left: '50%', top: '50%', transform: 'translate(-50%, -50%)' }} />
              </div>
            ),
            securityServiceCard: (props: any) => (
              <div style={{ width: 160, height: 'auto', minHeight: 70, borderRadius: 10, background: '#fff', border: '1px solid #e5e5e5', boxShadow: '0 3px 10px rgba(0,0,0,0.05)', display: 'flex', flexDirection: 'column', gap: 8, padding: '10px 12px', position: 'relative' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: '0 0 auto' }}>
                  <Badge count={Number(props?.data?.count || 0)} size="small" overflowCount={999} color="#1677ff">
                    <SafetyCertificateOutlined style={{ color: '#1677ff' }} />
                  </Badge>
                  <div style={{ fontSize: 12, color: '#1f1f1f', fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{props?.data?.title || '-'}</div>
                </div>
                <div style={{ flex: '1 1 auto', display: 'flex', flexWrap: 'wrap', gap: 4, alignContent: 'flex-start' }}>
                  {(Array.isArray(props?.data?.services) ? props.data.services : []).map((name: any, idx: number) => (
                    <Tag key={`${String(name)}-${idx}`} color="blue" style={{ margin: 0, maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', display: 'flex', alignItems: 'center', lineHeight: '20px' }}>
                      {String(name)}
                    </Tag>
                  ))}
                </div>
                <Handle type="source" position={Position.Top} id="svc" style={{ opacity: 0, left: '50%', top: '50%', transform: 'translate(-50%, -50%)' }} />
                <Handle type="target" position={Position.Top} id="svc" style={{ opacity: 0, left: '50%', top: '50%', transform: 'translate(-50%, -50%)' }} />
              </div>
            )
          };

          const nodes: any[] = [];
          const edges: any[] = [];

          // 2. Layout VR Nodes (Level 1)
          vrList.forEach((group, idx) => {
            const angle = totalVRs > 1 ? (idx * 2 * Math.PI) / totalVRs : -Math.PI / 2;
            const x = totalVRs > 1 ? centerX + Math.cos(angle) * vrRadius : centerX;
            const y = totalVRs > 1 ? centerY + Math.sin(angle) * vrRadius : centerY;
            
            const vrNodeId = `vr-${group.vr.id}`;
            nodes.push({
              id: vrNodeId,
              type: 'mainNode',
              position: { x: x - 50, y: y - 40 }, // Center node (100x80)
              data: { 
                title: group.vr.name,
                eip: group.vr.eip
              }
            });

            // 3. Layout Domain Nodes (Level 2)
            const domains = group.domains;
            if (domains.length > 0) {
               // Vector from Center to VR
               const dx = x - centerX;
               const dy = y - centerY;
               const len = Math.sqrt(dx * dx + dy * dy) || 1;
               // Outward direction
               const ux = dx / len;
               const uy = dy / len;
               const outwardAngle = Math.atan2(uy, ux);

               const domainRadius = 220;
               // Fan arc
               const arc = totalVRs > 1 ? Math.min(Math.PI * 1.5, domains.length * Math.PI / 4) : 2 * Math.PI;
               const startAngle = totalVRs > 1 ? (outwardAngle - arc / 2) : 0;
               const step = domains.length > 1 ? (totalVRs > 1 ? arc / (domains.length - 1) : 2 * Math.PI / domains.length) : 0;

               domains.forEach((dItem: any, dIdx: number) => {
                 const ang = domains.length > 1 ? (startAngle + dIdx * step) : outwardAngle;
                 
                 // Fixed radius for consistent line length
                 const dist = domainRadius;

                 const domX = x + Math.cos(ang) * dist;
                 const domY = y + Math.sin(ang) * dist;
                 
                 const domNodeId = `domain-${dItem.dom.id}`;
                 nodes.push({
                   id: domNodeId,
                   type: 'domainCard',
                   position: { x: domX - 80, y: domY - 40 }, // 160x80
                   data: {
                     title: dItem.dom.name || dItem.att.vpcName || '安全域',
                     vpcCidr: dItem.dom.cidr || dItem.att.vpcCidr || '-',
                     region: dItem.dom.region || dItem.att.region || '-'
                   }
                 });

                 edges.push({
                    id: `${vrNodeId}-${domNodeId}`,
                    source: vrNodeId,
                    target: domNodeId,
                    sourceHandle: 'pub',
                    targetHandle: 'card',
                    type: 'straight',
                    style: { stroke: '#bfbfbf', strokeWidth: 1.5 }
                 });

                 // 4. Layout App & Security Service Nodes (Level 3)
                 const domainId = String(dItem.dom.id);
                 const myApps = filteredApps.filter(a => String(a.domainId) === domainId);
                 const myServices = services.filter((s: any) => String(s.domainId) === domainId);
                 
                 const level3Nodes: any[] = [
                   ...myApps.map(a => ({ ...a, _kind: 'app' }))
                 ];

                 if (myServices.length > 0) {
                   const svcNames = myServices
                     .map((s: any) => s?.name || s?.title || s?.displayName || s?.id)
                     .filter((x: any) => x !== undefined && x !== null && String(x).trim());
                   
                   level3Nodes.push({
                     _kind: 'serviceGroup',
                     id: `svc-group-${domainId}`,
                     count: myServices.length,
                     services: svcNames,
                     title: '安全服务'
                   });
                 }

                 if (level3Nodes.length > 0) {
                    // Vector from VR to Domain
                    const vDx = domX - x;
                    const vDy = domY - y;
                    const vLen = Math.sqrt(vDx * vDx + vDy * vDy) || 1;
                    const vUx = vDx / vLen;
                    const vUy = vDy / vLen;
                    const domOutwardAngle = Math.atan2(vUy, vUx);
                    
                    const leafRadius = 220;
                    const leafArc = Math.min(Math.PI * 1.5, level3Nodes.length * Math.PI / 5);
                    const leafStartAngle = domOutwardAngle - leafArc / 2;
                    const leafStep = level3Nodes.length > 1 ? leafArc / (level3Nodes.length - 1) : 0;

                    level3Nodes.forEach((item, lIdx) => {
                      const lAng = level3Nodes.length > 1 ? (leafStartAngle + lIdx * leafStep) : domOutwardAngle;
                      
                      const lDist = leafRadius;
                      
                      const leafX = domX + Math.cos(lAng) * lDist;
                      const leafY = domY + Math.sin(lAng) * lDist;

                      if (item._kind === 'app') {
                        const appId = `app-${item.id}`;
                        nodes.push({
                          id: appId,
                          type: 'appCard',
                          position: { x: leafX - 80, y: leafY - 30 }, // 160x60
                          data: {
                            title: item.name,
                            subTitle: `${item.type === 'vm' ? '虚机' : item.type === 'container' ? '容器' : '混合'} · ${item.status}`
                          }
                        });

                        edges.push({
                          id: `${domNodeId}-${appId}`,
                          source: domNodeId,
                          target: appId,
                          sourceHandle: 'card',
                          targetHandle: 'app',
                          type: 'straight',
                          style: { stroke: '#bfbfbf', strokeWidth: 1.5 }
                        });
                      } else if (item._kind === 'serviceGroup') {
                        // Service Group Node
                        const svcId = item.id;
                        nodes.push({
                          id: svcId,
                          type: 'securityServiceCard',
                          position: { x: leafX - 80, y: leafY - 35 }, // 160x70+
                          data: {
                            title: item.title,
                            count: item.count,
                            services: item.services
                          }
                        });

                        edges.push({
                          id: `${domNodeId}-${svcId}`,
                          source: domNodeId,
                          target: svcId,
                          sourceHandle: 'card',
                          targetHandle: 'svc',
                          type: 'svcEdge'
                        });
                      }
                    });
                 }
               });
            }
          });

          // VR Interconnections (Mesh / Hub-Spoke)
          if (totalVRs >= 2) {
             if (topo === 'Mesh') {
               for (let i = 0; i < vrList.length; i++) {
                 for (let j = i + 1; j < vrList.length; j++) {
                   const a = `vr-${vrList[i].vr.id}`;
                   const b = `vr-${vrList[j].vr.id}`;
                   edges.push({ id: `${a}-${b}`, source: a, target: b, sourceHandle: 'pub', targetHandle: 'pub', type: 'straight', style: { stroke: '#1677ff', strokeWidth: 2 } });
                 }
               }
             } else {
               // Hub-Spoke
               // Use the first VR as Hub (or configured hubId)
               const hubIdStr = hubId ? String(hubId) : undefined;
               const hubIdx = hubIdStr ? vrList.findIndex(g => String(g.vr.id).includes(hubIdStr)) : 0;
               const safeHubIdx = hubIdx >= 0 ? hubIdx : 0;
               const hubNodeId = `vr-${vrList[safeHubIdx].vr.id}`;
               
               for (let i = 0; i < vrList.length; i++) {
                 if (i === safeHubIdx) continue;
                 const spokeNodeId = `vr-${vrList[i].vr.id}`;
                 edges.push({ id: `${hubNodeId}-${spokeNodeId}`, source: hubNodeId, target: spokeNodeId, sourceHandle: 'pub', targetHandle: 'pub', type: 'straight', style: { stroke: '#1677ff', strokeWidth: 2 } });
               }
             }
          }

          return (
            <PageDetailSection>
              <div ref={setTopologyEl} style={{ height: topologyHeight, minHeight: 460, border: '1px solid #e8e8e8', borderRadius: 12, background: '#fafafa', backgroundImage: 'radial-gradient(rgba(0,0,0,0.08) 1px, transparent 1px)', backgroundSize: '22px 22px', backgroundPosition: '0 0', overflow: 'hidden', position: 'relative' }}>
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
                        value={hubId || (domList.length > 0 ? String(domList[0].dom!.id) : undefined)}
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
                        options={domList.map((d: any) => ({ value: String(d.dom!.id), label: d.dom!.name }))}
                      />
                    </>
                  )}
                </div>
                <ReactFlow
                  nodes={nodes}
                  edges={edges}
                  nodeTypes={nodeTypes as any}
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
            </PageDetailSection>
          );
        })()
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
        key: 'metrics',
        label: '质量指标',
        icon: <DashboardOutlined />,
        children: (
          <PageDetailSection>
            <Row gutter={[16, 16]}>
              <Col xs={24} sm={8}>
                <Card size="small" variant="outlined" style={{ borderRadius: 8 }}>
                  <Statistic title="丢包率" value={record.loss ?? 0} precision={2} suffix="%" />
                </Card>
              </Col>
              <Col xs={24} sm={8}>
                <Card size="small" variant="outlined" style={{ borderRadius: 8 }}>
                  <Statistic title="延迟" value={record.latency ?? 0} suffix="ms" />
                </Card>
              </Col>
              <Col xs={24} sm={8}>
                <Card size="small" variant="outlined" style={{ borderRadius: 8 }}>
                  <Statistic title="SLA" value={record.sla ?? 0} precision={2} suffix="%" />
                </Card>
              </Col>
            </Row>
          </PageDetailSection>
        )
      }
    ];
  }, [cen, tenants, allDomains, attachments, domainKeyword, detailRefreshing, attachedForTopo, topologyHeight, filteredApps, appKeyword, filteredServices, serviceKeyword]);

  const tabFromUrl = String(searchParams.get('tab') || 'domains');
  const activeTabKey = ['domains', 'topology', 'apps', 'services', 'metrics'].includes(tabFromUrl) ? tabFromUrl : 'domains';

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
        defaultActiveTabKey="domains"
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
    </>
  );
};

export default CenDetailPage;
