import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Cascader, Divider, Form, Input, message, Select, Typography } from 'antd';
import StdSideDrawer from '../../../../../components/StdSideDrawer';
import type { DefaultOptionType } from 'antd/es/cascader';
import { fetchVrCachePageList } from '../../../../../services/virtualRouterApi';
import {
  apiPost,
  fetchCloudById,
  fetchClouds,
  fetchCloudProviderVpcs,
  refreshInventoryInstances,
  fetchCsmSecurityDomains,
  fetchOrganizationResourcePools,
  fetchRancherClustersForPool,
  fetchTenants,
  fetchOrganizationsByTenant,
} from '../../../../../services/api';
import { isRancherPoolCloud } from '../../../../cnmc/pools/lib/poolProviders';
import { poolMatchesAssignDrawerTab } from '../../../../tenants/lib/orgManagePoolHelpers';
import {
  createSecurityDomain,
  listSecurityDomains,
  suggestVrForSecurityDomain,
  updateSecurityDomain,
  SecurityDomainPayload,
  type VrSuggestItem,
} from '../../../../../services/securityDomainApi';
import {
  getDomainKindFromCategory,
  isFlatCustomNetworkCategory,
  normalizeCategoryForForm,
  SECURITY_DOMAIN_CATEGORY_VALUE_OPTIONS,
} from '../../../../../utils/securityDomainKind';
import type { SecurityDomain } from '../securityDomainModel';

function mapOrgNodeToCascader(n: any): DefaultOptionType {
  const raw = Array.isArray(n.children) && n.children.length ? n.children : undefined;
  const children = raw ? raw.map(mapOrgNodeToCascader) : undefined;
  return {
    value: n.id,
    label: n.name != null && String(n.name) !== '' ? String(n.name) : String(n.id),
    isLeaf: !children?.length,
    children,
  };
}

function findPathToOrgIdInTree(list: any[], orgId: string, acc: string[] = []): string[] | null {
  for (const n of list) {
    if (String(n.id) === String(orgId)) return [...acc, n.id];
    if (Array.isArray(n.children) && n.children.length) {
      const p = findPathToOrgIdInTree(n.children, orgId, [...acc, n.id]);
      if (p) return p;
    }
  }
  return null;
}

/** 新建网际路由域名称默认值（每次打开抽屉重新生成） */
function generateDefaultInternetworkRoutingDomainName() {
  return `ird-${Math.random().toString(36).slice(2, 6)}-${Date.now().toString(36).slice(-4)}`;
}

export function splitTenantOrgPath(path: (string | number)[] | undefined) {
  const p = (path || []).map((x) => String(x));
  const tenantId = p[0] || undefined;
  const organizationId = p.length > 1 ? p[p.length - 1] : undefined;
  return { tenantId, organizationId };
}

interface SecurityDomainForm extends SecurityDomain {
  tenantOrgPath?: (string | number)[];
  rancherClusterId?: string;
  csmCloudId?: string;
  linkedCsmSecurityDomainId?: string;
}

interface VRRowOpt {
  uuid: string;
  name: string;
}

export type SecurityDomainFormDrawerProps = {
  open: boolean;
  /** 非 null 表示编辑 */
  editing: SecurityDomain | null;
  onClose: () => void;
  /** 创建/更新已持久化，用于刷新列表 */
  onSuccess: () => void;
};

const sectionTitle = (text: string) => (
  <Typography.Title level={5} style={{ margin: '0 0 16px', fontWeight: 500 }}>
    {text}
  </Typography.Title>
);

const isCsmPoolCloud = (c: any) =>
  String(c?.config?.provider || c?.provider || c?.type || '')
    .trim()
    .toLowerCase() === 'cloudmap.csm';

const cloudLabel = (c: any) => {
  const n = c?.name != null && String(c.name).trim() !== '' ? String(c.name) : '';
  if (n) return n;
  const id = c?.id || c?._id || c?.uuid || c?.cloudId;
  return id != null && String(id).trim() !== '' ? String(id) : '未命名资源池';
};

const SecurityDomainFormDrawer: React.FC<SecurityDomainFormDrawerProps> = ({ open, editing, onClose, onSuccess }) => {
  const [createForm] = Form.useForm<SecurityDomainForm>();
  const [vrOptions, setVrOptions] = useState<VRRowOpt[]>([]);
  const [vrCeOptions, setVrCeOptions] = useState<VRRowOpt[]>([]);
  const [vrListLoading, setVrListLoading] = useState(false);
  const [vrListEmptyHint, setVrListEmptyHint] = useState<string | undefined>();
  const [vrSuggestions, setVrSuggestions] = useState<VrSuggestItem[]>([]);
  const [vrSuggestLoading, setVrSuggestLoading] = useState(false);
  const [pendingAutoSuggestVrUuid, setPendingAutoSuggestVrUuid] = useState<string | undefined>();
  const [tenants, setTenants] = useState<any[]>([]);
  const [tenantLoading, setTenantLoading] = useState(false);
  const [tenantOrgCascaderOptions, setTenantOrgCascaderOptions] = useState<DefaultOptionType[]>([]);
  const [createModalClouds, setCreateModalClouds] = useState<any[]>([]);
  const [createModalCloudLoading, setCreateModalCloudLoading] = useState(false);
  const [createModalVpcs, setCreateModalVpcs] = useState<Array<{ id: string; name: string; label: string }>>([]);
  const [createModalVpcLoading, setCreateModalVpcLoading] = useState(false);
  const [createModalRancherLoading, setCreateModalRancherLoading] = useState(false);
  const [vrUuidsBoundElsewhere, setVrUuidsBoundElsewhere] = useState<Set<string>>(new Set());
  const [csmDomainOptions, setCsmDomainOptions] = useState<Array<{ value: string; label: string }>>([]);
  const [csmDomainLoading, setCsmDomainLoading] = useState(false);
  const [submitLoading, setSubmitLoading] = useState(false);

  const createCategoryWatch = Form.useWatch('category', createForm);
  const createCsmCloudIdWatch = Form.useWatch('csmCloudId', createForm);
  const createCloudIdWatch = Form.useWatch('cloudId', createForm);
  const createVpcIdWatch = Form.useWatch('vpcId', createForm);
  const createVrUuidWatch = Form.useWatch('vrUuid', createForm);
  const createTenantOrgPathWatch = Form.useWatch('tenantOrgPath', createForm);
  const hasTenantAndOrg = useMemo(
    () => Array.isArray(createTenantOrgPathWatch) && (createTenantOrgPathWatch as (string | number)[]).length >= 2,
    [createTenantOrgPathWatch],
  );
  const createModalDomainKind = useMemo(
    () => getDomainKindFromCategory(String(createCategoryWatch || '').trim()),
    [createCategoryWatch],
  );
  const createFlatIsCustom = useMemo(
    () => isFlatCustomNetworkCategory(String(createCategoryWatch || '').trim()),
    [createCategoryWatch],
  );

  const suggestByUuid = useMemo(
    () => new Map(vrSuggestions.map((s) => [String(s.vrUuid).trim(), s])),
    [vrSuggestions],
  );

  const vrSelectOptionGroups = useMemo(() => {
    const cur = String(createVrUuidWatch ?? editing?.vrUuid ?? '').trim();
    const available = vrCeOptions.filter((v) => {
      const u = String(v?.uuid || '').trim();
      if (!u) return false;
      if (cur && u === cur) return true;
      return !vrUuidsBoundElsewhere.has(u);
    });

    const recommended = available.filter((v) => {
      const sug = suggestByUuid.get(String(v.uuid).trim());
      return !!sug && sug.score >= 70;
    });
    const recommendedIds = new Set(recommended.map((v) => v.uuid));
    const others = available.filter((v) => !recommendedIds.has(v.uuid));

    const groups: Array<{ label: string; options: Array<{ value: string; label: string }> }> = [];
    if (recommended.length) {
      groups.push({
        label: '推荐绑定',
        options: recommended.map((v) => ({ value: v.uuid, label: v.name })),
      });
    }
    if (others.length) {
      groups.push({
        label: recommended.length ? '其他 VR' : '全部 VR',
        options: others.map((v) => ({ value: v.uuid, label: v.name })),
      });
    }
    return groups;
  }, [vrCeOptions, vrUuidsBoundElsewhere, createVrUuidWatch, editing?.vrUuid, suggestByUuid]);

  const vrSelectOptions = useMemo(() => {
    if (vrSelectOptionGroups.length) return vrSelectOptionGroups;
    return [];
  }, [vrSelectOptionGroups]);

  const vrSelectNotFoundContent = useMemo(
    () => (
      <span style={{ color: 'rgba(0,0,0,.45)', fontSize: 12 }}>
        {vrListLoading ? '加载中…' : vrListEmptyHint || '暂无数据'}
      </span>
    ),
    [vrListLoading, vrListEmptyHint],
  );

  useEffect(() => {
    if (!open) return;
    void (async () => {
      try {
        const list = await listSecurityDomains();
        const exId = editing?.id;
        const next = new Set<string>();
        for (const d of Array.isArray(list) ? list : []) {
          if (exId && d?.id != null && String(d.id) === String(exId)) continue;
          const vu = d?.vrUuid;
          if (vu != null && String(vu).trim() !== '') {
            next.add(String(vu).trim());
          }
        }
        setVrUuidsBoundElsewhere(next);
      } catch {
        setVrUuidsBoundElsewhere(new Set());
      }
    })();
  }, [open, editing?.id]);

  const loadVRList = useCallback(async (tenantId?: string) => {
    setVrListLoading(true);
    setVrListEmptyHint(undefined);
    let syncHint: string | undefined;
    try {
      try {
        const syncRes = await apiPost('/api/vr-instances/refresh', {});
        const diag = syncRes?.data?.vr1;
        if (diag && diag.ok === false && diag.error) {
          syncHint = String(diag.error).includes('CSMCTL')
            ? '未配置 CSMCTL 地址：请在系统设置中配置后，在「IBR 管理 → 网际路由器」同步 VR'
            : String(diag.error);
          setVrListEmptyHint(syncHint);
        }
      } catch {
        // 同步失败时仍尝试读本地缓存
      }

      const res = await fetchVrCachePageList(1000, 1, { skipCache: true });
      let list: any[] = [];
      const data = res?.data || res;
      if (data && Array.isArray(data.page)) {
        list = data.page;
      } else if (data && Array.isArray(data.list)) {
        list = data.list;
      } else if (Array.isArray(data)) {
        list = data;
      }
      list = list.filter((item: any) => !item.is_deleted);
      if (tenantId) {
        list = list.filter((item: any) => {
          const tid = item.tenant_id || item.tenantId;
          return !tid || String(tid) === String(tenantId);
        });
      }
      const opts: VRRowOpt[] = list
        .map((item: any) => ({
          uuid: item.uuid || item.id || '',
          name: `${item.name || item.display_name || item.uuid || '未命名VR'}${item.health_status ? ` (${item.health_status})` : ''}`,
        }))
        .filter((v) => v.uuid);
      setVrOptions(opts);
      setVrCeOptions(opts);
      if (!opts.length && !syncHint) {
        setVrListEmptyHint(
          '暂无可用 VR：请在「IBR 管理 → 网际路由器」注册或同步；VR 列表与所选云资源池/VPC 无联动',
        );
      }
    } catch (err: any) {
      console.warn('VR list fetch failed', err);
      const errMsg = typeof err === 'string' ? err : err?.message || JSON.stringify(err);
      message.error(`加载 VR 列表失败: ${errMsg}`);
      setVrOptions([]);
      setVrCeOptions([]);
      setVrListEmptyHint(errMsg);
    } finally {
      setVrListLoading(false);
    }
  }, []);

  const loadTenants = useCallback(async () => {
    setTenantLoading(true);
    try {
      const res = await fetchTenants();
      const list = (res?.data || res || []);
      const arr = Array.isArray(list) ? list : [];
      setTenants(arr);
      return arr;
    } catch (e: any) {
      console.warn('租户列表获取失败', e);
      setTenants([]);
      return [];
    } finally {
      setTenantLoading(false);
    }
  }, []);

  const loadCascaderOrgData = useCallback((selected: DefaultOptionType[]) => {
    const target = selected[selected.length - 1] as any;
    if (selected.length !== 1) return;
    if (target.loading) return;
    if (target.isLeaf) return;
    if (target.children != null) return;
    const tid = String(target.value);
    target.loading = true;
    setTenantOrgCascaderOptions((opts) => [...opts]);
    void fetchOrganizationsByTenant(tid)
      .then((raw) => {
        const list = Array.isArray(raw) ? raw : [];
        if (!list.length) {
          target.isLeaf = true;
          target.children = undefined;
        } else {
          target.children = list.map(mapOrgNodeToCascader);
        }
      })
      .catch(() => {
        target.isLeaf = true;
        target.children = undefined;
      })
      .finally(() => {
        target.loading = false;
        setTenantOrgCascaderOptions((prev) => [...prev]);
      });
  }, []);

  const loadCloudsForCreateModal = useCallback(async (organizationId?: string | null) => {
    setCreateModalCloudLoading(true);
    try {
      if (organizationId) {
        const res = await fetchOrganizationResourcePools(String(organizationId));
        const list = Array.isArray(res) ? res : (res?.data || res?.items || res?.list || []);
        const fromAssign = (Array.isArray(list) ? list : [])
          .map((a: any) => a.cloud || a.resourcePool || a)
          .filter((c: any) => c && (c.id || c._id || c.uuid || c.cloudId));
        const seen = new Set<string>();
        const dedup: any[] = [];
        for (const c of fromAssign) {
          const id = String(c.id || c._id || c.uuid || c.cloudId || '').trim();
          if (!id || seen.has(id)) continue;
          seen.add(id);
          dedup.push(c);
        }
        setCreateModalClouds(dedup);
      } else {
        const res = await fetchClouds();
        const list = (res?.data || res || []);
        setCreateModalClouds(Array.isArray(list) ? list : []);
      }
    } catch (e) {
      console.warn(e);
      message.warning('拉取云资源池失败');
      setCreateModalClouds([]);
    } finally {
      setCreateModalCloudLoading(false);
    }
  }, []);

  /**
   * 按当前租户/组织路径拉取资源池。必须用于：级联变化、切换「类型」后（路径仍有效时需重新拉取，否则资源池会被清空且无法选池）。
   */
  const syncResourcePoolsFromPath = useCallback(
    (path: (string | number)[] | null | undefined) => {
      const p = (path as (string | number)[] | null | undefined) || [];
      if (p.length < 2) {
        setCreateModalClouds([]);
        return;
      }
      const { organizationId: oid } = splitTenantOrgPath(p);
      if (oid) void loadCloudsForCreateModal(oid);
      else setCreateModalClouds([]);
    },
    [loadCloudsForCreateModal],
  );

  const loadCloudVpcsForCreateModal = useCallback(async (cloudId: string) => {
    if (!cloudId) {
      setCreateModalVpcs([]);
      return;
    }
    setCreateModalVpcLoading(true);
    try {
      const res = await fetchCloudProviderVpcs(cloudId);
      const data = (res?.data || res || {}) as any;
      let cloud: any;
      try {
        cloud = await fetchCloudById(cloudId);
      } catch {
        cloud = {};
      }
      const provider = (cloud?.config?.provider || cloud?.type || '').toLowerCase();
      let arr: any[] = [];
      if (provider === 'aliyun') {
        arr = data?.Vpcs?.Vpc || data?.VpcSets || [];
      } else if (provider === 'huaweicloud') {
        arr = data?.vpcs || data?.data?.vpcs || [];
      } else if (provider === 'tencentcloud') {
        arr = data?.VpcSet || [];
      } else if (provider === 'harvester' || provider.includes('cloudmap')) {
        arr = data?.items || data?.data?.items || [];
      } else {
        arr = Array.isArray(data) ? data : (data?.list || data?.items || []);
      }
      const list = Array.isArray(arr) ? arr : [];
      const normalized = list
        .map((v: any) => {
          const id = v.VpcId || v.id || v.uuid || v.vpc_id || v.vpcId || v.ID || v.Name || v.name || '';
          const name = v.VpcName || v.name || v.Vpc || v.DisplayName || id || 'VPC';
          const cidr = v.CidrBlock || v.cidr || v.cidrBlock || v.network || v.address || v.vpc_cidr || '';
          const label = `${name}（${id ? String(id).slice(0, 8) : '—'}）${cidr ? ` / ${cidr}` : ''}`;
          return { id: String(id), name: String(name), label };
        })
        .filter((x) => !!x.id);
      setCreateModalVpcs(normalized);
    } catch (e) {
      console.warn(e);
      message.warning('拉取 VPC 列表失败');
      setCreateModalVpcs([]);
    } finally {
      setCreateModalVpcLoading(false);
    }
  }, []);

  const applyDefaultRancherClusterForPool = useCallback(
    async (poolId: string) => {
      if (!poolId) {
        createForm.setFieldValue('rancherClusterId', undefined);
        return;
      }
      setCreateModalRancherLoading(true);
      try {
        const list = await fetchRancherClustersForPool(poolId, { skipCache: true });
        const items = Array.isArray(list) ? list : [];
        const first = items[0] as { id?: string } | undefined;
        const id = first ? String(first.id || '').trim() : '';
        if (id) {
          createForm.setFieldValue('rancherClusterId', id);
        } else {
          createForm.setFieldValue('rancherClusterId', undefined);
        }
      } catch (e) {
        console.warn(e);
        message.warning('拉取 Rancher 集群列表失败');
        createForm.setFieldValue('rancherClusterId', undefined);
      } finally {
        setCreateModalRancherLoading(false);
      }
    },
    [createForm],
  );

  useEffect(() => {
    if (!open) return;
    if (editing) return;
    setTenantOrgCascaderOptions(
      tenants.map((t: any) => ({
        value: t.id,
        label: t.name != null && String(t.name) !== '' ? String(t.name) : '未命名租户',
        isLeaf: false,
      })),
    );
  }, [open, editing, tenants]);

  const editingId = editing?.id;

  useEffect(() => {
    if (!open) return;
    if (!editing) {
      createForm.resetFields();
      createForm.setFieldsValue({ name: generateDefaultInternetworkRoutingDomainName() });
      setCreateModalVpcs([]);
      setCreateModalClouds([]);
      void loadVRList();
      void loadTenants();
      return;
    }
    const record = editing;
    void loadVRList();
    const dk = getDomainKindFromCategory(String(record.category || ''));
    const cidr4First = Array.isArray(record.cidr4) && record.cidr4.length ? record.cidr4[0] : '';
    const { cidr6: _c6, cidr4: _c4, tenantId: _t, organizationId: _o, category: _cat, ...restRecord } = record as any;
    createForm.setFieldsValue({
      ...restRecord,
      category: normalizeCategoryForForm(record.category),
      cidr4: record.cidr4 || [],
      rancherClusterId: dk === 'container' ? record.resourcePool : undefined,
      cidr: record.cidr || cidr4First || '',
      csmCloudId: (record as any).csmCloudId,
      linkedCsmSecurityDomainId: (record as any).linkedCsmSecurityDomainId,
    } as any);
    void (async () => {
      const tList = await loadTenants();
      setTenantOrgCascaderOptions(
        tList.map((t: any) => ({
          value: t.id,
          label: t.name != null && String(t.name) !== '' ? String(t.name) : '未命名租户',
          isLeaf: false,
        })),
      );
      if (record.tenantId) {
        const tid = String(record.tenantId);
        try {
          const orgTree = await fetchOrganizationsByTenant(tid);
          const list = Array.isArray(orgTree) ? orgTree : [];
          const children = list.length ? list.map(mapOrgNodeToCascader) : undefined;
          setTenantOrgCascaderOptions((prev) =>
            prev.map((n) => {
              if (String(n.value) === tid) {
                if (!list.length) return { ...n, isLeaf: true, children: undefined };
                return { ...n, isLeaf: false, children };
              }
              return n;
            }),
          );
          let path: (string | number)[] = [tid];
          if (record.organizationId) {
            const p = findPathToOrgIdInTree(list, String(record.organizationId));
            if (p && p.length) {
              path = [tid, ...p];
            } else {
              path = [tid, String(record.organizationId)];
            }
          }
          createForm.setFieldValue('tenantOrgPath', path);
        } catch {
          createForm.setFieldValue('tenantOrgPath', [tid]);
        }
      } else {
        createForm.setFieldValue('tenantOrgPath', undefined);
      }
    })();
    void (async () => {
      if (record.organizationId) {
        await loadCloudsForCreateModal(String(record.organizationId));
      } else {
        setCreateModalClouds([]);
      }
      if (dk === 'vpc' && record.cloudId) {
        await loadCloudVpcsForCreateModal(String(record.cloudId));
      } else {
        setCreateModalVpcs([]);
      }
    })();
  }, [
    open,
    editing,
    editingId,
    createForm,
    loadVRList,
    loadTenants,
    loadCloudsForCreateModal,
    loadCloudVpcsForCreateModal,
  ]);

  useEffect(() => {
    if (!open) {
      setCreateModalVpcs([]);
      return;
    }
    if (!hasTenantAndOrg) {
      setCreateModalVpcs([]);
      return;
    }
    if (createModalDomainKind === 'vpc' && createCloudIdWatch) {
      void loadCloudVpcsForCreateModal(String(createCloudIdWatch));
    } else {
      setCreateModalVpcs([]);
    }
  }, [open, hasTenantAndOrg, createModalDomainKind, createCloudIdWatch, loadCloudVpcsForCreateModal]);

  const loadVrSuggestions = useCallback(async () => {
    const cloudId = String(createCloudIdWatch || '').trim();
    const vpcId = String(createVpcIdWatch || '').trim();
    if (!cloudId || !vpcId || createModalDomainKind !== 'vpc') {
      setVrSuggestions([]);
      return;
    }
    const vpcRow = createModalVpcs.find((v) => v.id === vpcId);
    const cidrMatch = vpcRow?.label?.match(/\/\s*([\d.]+(?:\/\d+)?)\s*$/);
    const vpcCidr = cidrMatch?.[1];
    const { tenantId, organizationId } = splitTenantOrgPath(
      createForm.getFieldValue('tenantOrgPath') as (string | number)[] | undefined,
    );
    setVrSuggestLoading(true);
    try {
      try {
        await refreshInventoryInstances(cloudId);
      } catch {
        // 库存刷新失败时仍尝试 suggest（后端可实时拉云 API）
      }
      const data = await suggestVrForSecurityDomain({
        cloudId,
        vpcId,
        tenantId,
        organizationId,
        excludeDomainId: editing?.id,
        vpcCidr,
      });
      const list = Array.isArray(data?.suggestions) ? data.suggestions : [];
      setVrSuggestions(list);
      if (!editing && data.autoSuggestVrUuid) {
        setPendingAutoSuggestVrUuid(String(data.autoSuggestVrUuid).trim());
        if (!createForm.getFieldValue('vrUuid')) {
          createForm.setFieldValue('vrUuid', data.autoSuggestVrUuid);
        }
      } else {
        setPendingAutoSuggestVrUuid(undefined);
      }
    } catch (e: any) {
      console.warn('VR suggest failed', e);
      setVrSuggestions([]);
      setPendingAutoSuggestVrUuid(undefined);
    } finally {
      setVrSuggestLoading(false);
    }
  }, [
    createCloudIdWatch,
    createVpcIdWatch,
    createModalDomainKind,
    createModalVpcs,
    createForm,
    editing?.id,
  ]);

  useEffect(() => {
    if (!open || editing) return;
    const pending = String(pendingAutoSuggestVrUuid || '').trim();
    if (!pending || createForm.getFieldValue('vrUuid')) return;
    if (vrCeOptions.some((v) => String(v.uuid).trim() === pending)) {
      createForm.setFieldValue('vrUuid', pending);
    }
  }, [open, editing, pendingAutoSuggestVrUuid, vrCeOptions, createForm]);

  useEffect(() => {
    if (!open) {
      setVrSuggestions([]);
      setPendingAutoSuggestVrUuid(undefined);
      return;
    }
    if (createModalDomainKind !== 'vpc') {
      setVrSuggestions([]);
      return;
    }
    if (createCloudIdWatch && createVpcIdWatch) {
      void loadVrSuggestions();
    } else {
      setVrSuggestions([]);
    }
  }, [open, createModalDomainKind, createCloudIdWatch, createVpcIdWatch, loadVrSuggestions]);

  useEffect(() => {
    if (!open) {
      setCreateModalRancherLoading(false);
      return;
    }
    if (!hasTenantAndOrg) {
      setCreateModalRancherLoading(false);
      return;
    }
    if (createModalDomainKind !== 'container' || !createCloudIdWatch) {
      setCreateModalRancherLoading(false);
      return;
    }
    void applyDefaultRancherClusterForPool(String(createCloudIdWatch));
  }, [
    open,
    hasTenantAndOrg,
    createModalDomainKind,
    createCloudIdWatch,
    applyDefaultRancherClusterForPool,
  ]);

  /** 网际路由域「云资源池」：仅计算类池，排除 CSM 安全池与对象/文件存储池 */
  const computeModalClouds = useMemo(
    () => createModalClouds.filter((c) => poolMatchesAssignDrawerTab(c, 'compute')),
    [createModalClouds],
  );

  const csmPoolOptions = useMemo(
    () =>
      createModalClouds
        .filter(isCsmPoolCloud)
        .map((c) => ({
          value: String(c.id || c._id || c.uuid || c.cloudId || '').trim(),
          label: cloudLabel(c),
        }))
        .filter((o) => o.value),
    [createModalClouds],
  );

  useEffect(() => {
    if (!open) {
      setCsmDomainOptions([]);
      return;
    }
    const cloudId = String(createCsmCloudIdWatch || '').trim();
    if (!cloudId) {
      setCsmDomainOptions([]);
      return;
    }
    setCsmDomainLoading(true);
    void fetchCsmSecurityDomains(cloudId)
      .then((res: any) => {
        const items = Array.isArray(res?.data?.items)
          ? res.data.items
          : Array.isArray(res?.items)
            ? res.items
            : Array.isArray(res?.data)
              ? res.data
              : Array.isArray(res)
                ? res
                : [];
        setCsmDomainOptions(
          items
            .map((d: any) => {
              const id = String(d.id || d.domainId || '').trim();
              const name = String(d.name || d.domainName || id).trim();
              return { value: id, label: name ? `${name} (${id})` : id };
            })
            .filter((o: { value: string }) => o.value),
        );
      })
      .catch(() => {
        setCsmDomainOptions([]);
        message.warning('拉取 CSM 安全域列表失败');
      })
      .finally(() => setCsmDomainLoading(false));
  }, [open, createCsmCloudIdWatch]);

  const mergeCsmAssociation = <T extends Partial<SecurityDomainPayload>>(payload: T): T => {
    const csmCloudId = String(createForm.getFieldValue('csmCloudId') || '').trim() || undefined;
    const linked = String(createForm.getFieldValue('linkedCsmSecurityDomainId') || '').trim() || undefined;
    return {
      ...payload,
      csmCloudId,
      linkedCsmSecurityDomainId: linked,
      roleKind: 'internetwork_routing',
    };
  };

  const onSubmitCreate = async () => {
    const findVrName = (uuid?: string) =>
      uuid
        ? vrCeOptions.find((v) => v.uuid === uuid)?.name || vrOptions.find((v) => v.uuid === uuid)?.name
        : undefined;
    setSubmitLoading(true);
    try {
      const base = await createForm.validateFields(['name', 'category', 'tenantOrgPath']);
      const catRaw = String((base as any).category || '').trim();
      const dk = getDomainKindFromCategory(catRaw);
      if (dk === 'vpc') {
        await createForm.validateFields(['cloudId', 'vpcId']);
      } else if (dk === 'container') {
        await createForm.validateFields(['cloudId', 'rancherClusterId']);
      } else if (dk === 'flat') {
        if (isFlatCustomNetworkCategory(catRaw)) {
          await createForm.validateFields(['cidr']);
        } else {
          await createForm.validateFields(['cloudId', 'cidr']);
        }
      }
      const values = createForm.getFieldsValue(true) as any;
      const { tenantId, organizationId } = splitTenantOrgPath(values.tenantOrgPath as (string | number)[] | undefined);
      if (editing) {
        let payload: Partial<SecurityDomainPayload> = { name: values.name, category: catRaw, tenantId, organizationId };
        if (dk === 'vpc') {
          const vrid = String(values.vrUuid || '').trim();
          payload = {
            ...payload,
            cloudId: String(values.cloudId || ''),
            vpcMode: 'existing',
            vpcId: String(values.vpcId || ''),
            vrUuid: (vrid || null) as any,
            vrName: (vrid ? findVrName(vrid) : null) as any,
          };
        } else if (dk === 'container') {
          const poolId = String(values.cloudId || '').trim();
          const clusterId = String(values.rancherClusterId || '').trim();
          const vrId = String(values.vrUuid || '').trim();
          payload = {
            ...payload,
            category: catRaw || 'container:容器网络',
            cloudId: poolId,
            resourcePool: clusterId,
            tags: `rancher,clusterId=${clusterId}${vrId ? `,vrUuid=${vrId}` : ''}`,
            cidr: values.cidr ? String(values.cidr).trim() : undefined,
            vrUuid: (vrId || null) as any,
            vrName: (vrId ? findVrName(vrId) : null) as any,
          };
        } else {
          const isFlatCustom = isFlatCustomNetworkCategory(catRaw);
          const vrid = String(values.vrUuid || '').trim();
          const flatPayload: Partial<SecurityDomainPayload> = {
            cidr: String(values.cidr || '').trim(),
            vrUuid: (vrid || null) as any,
            vrName: (vrid ? findVrName(vrid) : null) as any,
          };
          (flatPayload as any).cloudId = isFlatCustom ? (null as any) : String(values.cloudId || '').trim();
          payload = { ...payload, ...flatPayload };
        }
        await updateSecurityDomain(editing.id, mergeCsmAssociation(payload as SecurityDomainPayload));
        message.success('网际路由域已更新');
        onSuccess();
        onClose();
        createForm.resetFields();
        return;
      }
      if (dk === 'container') {
        const poolId = String(values.cloudId || '').trim();
        const clusterId = String(values.rancherClusterId || '').trim();
        const vrId = String(values.vrUuid || '').trim();
        const payload: SecurityDomainPayload = {
          name: values.name,
          category: catRaw || 'container:容器网络',
          cloudId: poolId,
          resourcePool: clusterId,
          tags: `rancher,clusterId=${clusterId}${vrId ? `,vrUuid=${vrId}` : ''}`,
          cidr: values.cidr ? String(values.cidr).trim() : undefined,
          tenantId,
          organizationId,
          status: 'active',
          vrUuid: vrId || undefined,
          vrName: vrId ? findVrName(vrId) : undefined,
        };
        await createSecurityDomain(mergeCsmAssociation(payload));
      } else if (dk === 'vpc') {
        const vrid = String(values.vrUuid || '').trim();
        const payload: SecurityDomainPayload = {
          name: values.name,
          category: catRaw,
          cloudId: String(values.cloudId || ''),
          vpcMode: 'existing',
          vpcId: String(values.vpcId || ''),
          vrUuid: vrid || undefined,
          vrName: vrid ? findVrName(vrid) : undefined,
          tenantId,
          organizationId,
          status: 'active',
        };
        await createSecurityDomain(mergeCsmAssociation(payload));
      } else {
        const isFlatCustom = isFlatCustomNetworkCategory(catRaw);
        const vrid = String(values.vrUuid || '').trim();
        const payload: SecurityDomainPayload = {
          name: values.name,
          category: catRaw,
          cidr: String(values.cidr || '').trim(),
          vrUuid: vrid || undefined,
          vrName: vrid ? findVrName(vrid) : undefined,
          tenantId,
          organizationId,
          status: 'active',
          ...(!isFlatCustom ? { cloudId: String(values.cloudId || '').trim() } : {}),
        };
        await createSecurityDomain(mergeCsmAssociation(payload));
      }
      message.success('网际路由域已创建');
      onSuccess();
      onClose();
      createForm.resetFields();
    } catch (e: any) {
      if (e?.errorFields) return;
      const msg = typeof e?.message === 'string' ? e.message : String(e);
      message.error(`保存失败：${msg}`);
    } finally {
      setSubmitLoading(false);
    }
  };

  const onCancel = () => {
    onClose();
    createForm.resetFields();
  };

  return (
    <StdSideDrawer
      title={editing ? '编辑网际路由域' : '新建网际路由域'}
      open={open}
      onClose={onCancel}
      onOk={() => void onSubmitCreate()}
      okText={editing ? '保存' : '创建'}
      cancelText="取消"
      width={720}
      confirmLoading={submitLoading}
      maskClosable={!submitLoading}
    >
      <Form form={createForm} layout="vertical">
        {sectionTitle('基本信息')}
        <Form.Item name="name" label="名称" rules={[{ required: true, message: '请输入网际路由域名称' }]}>
          <Input placeholder="如：华东生产VPC / 总部办公网" />
        </Form.Item>
        <Form.Item
          name="tenantOrgPath"
          label="所属租户 / 组织"
          rules={[
            { required: true, message: '请选择所属租户与组织' },
            {
              validator: (_: any, v: (string | number)[] | undefined) => {
                if (!v || !Array.isArray(v) || v.length < 2) {
                  return Promise.reject(new Error('请展开级联并选择到具体组织'));
                }
                return Promise.resolve();
              },
            },
          ]}
        >
          <Cascader
            allowClear
            changeOnSelect
            showSearch
            loading={tenantLoading}
            options={tenantOrgCascaderOptions}
            loadData={loadCascaderOrgData}
            placeholder="先选租户，再选组织（需选到组织后才会加载云资源池）"
            style={{ width: '100%' }}
            onChange={(val) => {
              const p = (val as (string | number)[] | null) || [];
              createForm.setFieldsValue({
                cloudId: undefined,
                vpcId: undefined,
                rancherClusterId: undefined,
                vrUuid: undefined,
                cidr: undefined,
              });
              setCreateModalVpcs([]);
              syncResourcePoolsFromPath(p);
            }}
          />
        </Form.Item>
        <Form.Item name="category" label="类型" rules={[{ required: true, message: '请选择类型' }]}>
          <Select
            showSearch
            optionFilterProp="label"
            placeholder="选择 VPC / 扁平 / 容器 / 自定义网段"
            options={SECURITY_DOMAIN_CATEGORY_VALUE_OPTIONS}
            onChange={() => {
              createForm.setFieldsValue({
                cloudId: undefined,
                vpcId: undefined,
                rancherClusterId: undefined,
                vrUuid: undefined,
                cidr: undefined,
              });
              setCreateModalVpcs([]);
              syncResourcePoolsFromPath(
                createForm.getFieldValue('tenantOrgPath') as (string | number)[] | undefined,
              );
            }}
          />
        </Form.Item>
        {createCategoryWatch && !hasTenantAndOrg && (
          <div style={{ color: 'rgba(0,0,0,0.45)', fontSize: 12, marginBottom: 8 }}>
            请选择「所属租户 / 组织」并选到具体组织。
          </div>
        )}

        {hasTenantAndOrg && (
          <>
            <Divider style={{ margin: '8px 0 20px' }} />
            {sectionTitle('网络与 VR')}
          </>
        )}
        {createModalDomainKind === 'vpc' && hasTenantAndOrg && (
          <>
            <Form.Item name="cloudId" label="云资源池" rules={[{ required: true, message: '请选择资源池' }]}>
              <Select
                showSearch
                optionFilterProp="label"
                loading={createModalCloudLoading}
                placeholder="已接入的公有云/私有云/边缘"
                options={computeModalClouds.map((c) => ({
                  value: c.id || c._id || c.uuid || c.cloudId,
                  label: cloudLabel(c),
                }))}
                onChange={() => {
                  createForm.setFieldValue('vpcId', undefined);
                  createForm.setFieldValue('vrUuid', undefined);
                  setVrSuggestions([]);
                  setPendingAutoSuggestVrUuid(undefined);
                }}
              />
            </Form.Item>
            <Form.Item name="vpcId" label="VPC" rules={[{ required: true, message: '请选择 VPC' }]}>
              <Select
                showSearch
                optionFilterProp="label"
                loading={createModalVpcLoading}
                placeholder={createCloudIdWatch ? '从云端拉取' : '请先选择资源池'}
                disabled={!createCloudIdWatch}
                options={createModalVpcs.map((v) => ({ value: v.id, label: v.label }))}
                onChange={() => {
                  createForm.setFieldValue('vrUuid', undefined);
                  setPendingAutoSuggestVrUuid(undefined);
                }}
              />
            </Form.Item>
            <Form.Item name="vrUuid" label="VR 实例">
              <Select
                allowClear
                showSearch
                optionFilterProp="label"
                loading={vrListLoading || vrSuggestLoading}
                notFoundContent={vrSelectNotFoundContent}
                placeholder="不绑定可留空"
                options={vrSelectOptions}
              />
            </Form.Item>
          </>
        )}
        {createModalDomainKind === 'container' && hasTenantAndOrg && (
          <>
            <Form.Item
              name="cloudId"
              label="Rancher 资源池"
              rules={[{ required: true, message: '请选择 Rancher 资源池' }]}
            >
              <Select
                showSearch
                optionFilterProp="label"
                loading={createModalCloudLoading || createModalRancherLoading}
                options={createModalClouds
                  .filter((c) => isRancherPoolCloud(c))
                  .map((c) => ({
                    value: c.id || c._id || c.uuid || c.cloudId,
                    label: cloudLabel(c),
                  }))}
              />
            </Form.Item>
            <Form.Item name="cidr" label="网段备注（可选）">
              <Input placeholder="如 Pod/Service 网段，供 SDN 对照" />
            </Form.Item>
            <Form.Item name="vrUuid" label="VR 实例">
              <Select
                allowClear
                showSearch
                optionFilterProp="label"
                loading={vrListLoading}
                notFoundContent={vrSelectNotFoundContent}
                placeholder="不绑定可留空"
                options={vrSelectOptions}
              />
            </Form.Item>
            <Form.Item name="rancherClusterId" noStyle rules={[{ required: true, message: ' ' }]}>
              <input type="hidden" />
            </Form.Item>
          </>
        )}
        {createModalDomainKind === 'flat' && !createFlatIsCustom && hasTenantAndOrg && (
          <>
            <Form.Item
              name="cloudId"
              label="云资源池"
              rules={[{ required: true, message: '请选择资源池' }]}
            >
              <Select
                showSearch
                optionFilterProp="label"
                loading={createModalCloudLoading}
                placeholder="与所选租户/组织下可见的计算资源池一致"
                options={computeModalClouds.map((c) => ({
                  value: c.id || c._id || c.uuid || c.cloudId,
                  label: cloudLabel(c),
                }))}
              />
            </Form.Item>
            <Form.Item name="cidr" label="IPv4 CIDR" rules={[{ required: true, message: '请填写网段' }]}>
              <Input placeholder="如 10.0.0.0/16" />
            </Form.Item>
            <Form.Item name="vrUuid" label="VR 实例">
              <Select
                allowClear
                showSearch
                optionFilterProp="label"
                loading={vrListLoading}
                notFoundContent={vrSelectNotFoundContent}
                placeholder="不绑定可留空"
                options={vrSelectOptions}
              />
            </Form.Item>
          </>
        )}
        {createModalDomainKind === 'flat' && createFlatIsCustom && hasTenantAndOrg && (
          <>
            <Form.Item name="cidr" label="IPv4 CIDR" rules={[{ required: true, message: '请填写网段' }]}>
              <Input placeholder="如 10.0.0.0/16" />
            </Form.Item>
            <Form.Item name="vrUuid" label="VR 实例">
              <Select
                allowClear
                showSearch
                optionFilterProp="label"
                loading={vrListLoading}
                notFoundContent={vrSelectNotFoundContent}
                placeholder="不绑定可留空"
                options={vrSelectOptions}
              />
            </Form.Item>
          </>
        )}
        {hasTenantAndOrg && (
          <>
            <Divider style={{ margin: '8px 0 20px' }} />
            {sectionTitle('CSM 关联（可选）')}
            <Typography.Paragraph type="secondary" style={{ marginTop: -8, marginBottom: 16, fontSize: 13 }}>
              关联唯一的 CSM 安全域后，详情「CSM 安全域」Tab 可查看防护对象、安全服务与服务链。
            </Typography.Paragraph>
            <Form.Item name="csmCloudId" label="CSM 资源池">
              <Select
                allowClear
                showSearch
                optionFilterProp="label"
                loading={createModalCloudLoading}
                placeholder="关联 CSM 安全域时选择"
                options={csmPoolOptions}
                onChange={() => createForm.setFieldValue('linkedCsmSecurityDomainId', undefined)}
              />
            </Form.Item>
            <Form.Item name="linkedCsmSecurityDomainId" label="CSM 安全域（1:1，可选）">
              <Select
                allowClear
                showSearch
                optionFilterProp="label"
                loading={csmDomainLoading}
                disabled={!createCsmCloudIdWatch}
                placeholder={createCsmCloudIdWatch ? '选择要关联的 CSM 安全域' : '请先选择 CSM 资源池'}
                options={csmDomainOptions}
              />
            </Form.Item>
          </>
        )}
      </Form>
    </StdSideDrawer>
  );
};

export default SecurityDomainFormDrawer;
