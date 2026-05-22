import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Cascader, Form, Input, message, Modal, Select } from 'antd';
import type { DefaultOptionType } from 'antd/es/cascader';
import { fetchVrCachePageList } from '../../../../../services/virtualRouterApi';
import {
  fetchCloudById,
  fetchClouds,
  fetchCloudProviderVpcs,
  fetchOrganizationResourcePools,
  fetchRancherClustersForPool,
  fetchTenants,
  fetchOrganizationsByTenant,
} from '../../../../../services/api';
import { isRancherPoolCloud } from '../../../../cnmc/pools/lib/poolProviders';
import {
  createSecurityDomain,
  listSecurityDomains,
  updateSecurityDomain,
  SecurityDomainPayload,
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

export function splitTenantOrgPath(path: (string | number)[] | undefined) {
  const p = (path || []).map((x) => String(x));
  const tenantId = p[0] || undefined;
  const organizationId = p.length > 1 ? p[p.length - 1] : undefined;
  return { tenantId, organizationId };
}

interface SecurityDomainForm extends SecurityDomain {
  tenantOrgPath?: (string | number)[];
  rancherClusterId?: string;
}

interface VRRowOpt {
  uuid: string;
  name: string;
}

export type SecurityDomainFormModalProps = {
  open: boolean;
  /** 非 null 表示编辑 */
  editing: SecurityDomain | null;
  onClose: () => void;
  /** 创建/更新已持久化，用于刷新列表 */
  onSuccess: () => void;
};

const cloudLabel = (c: any) => {
  const n = c?.name != null && String(c.name).trim() !== '' ? String(c.name) : '';
  if (n) return n;
  const id = c?.id || c?._id || c?.uuid || c?.cloudId;
  return id != null && String(id).trim() !== '' ? String(id) : '未命名资源池';
};

const SecurityDomainFormModal: React.FC<SecurityDomainFormModalProps> = ({ open, editing, onClose, onSuccess }) => {
  const [createForm] = Form.useForm<SecurityDomainForm>();
  const [vrOptions, setVrOptions] = useState<VRRowOpt[]>([]);
  const [vrCeOptions, setVrCeOptions] = useState<VRRowOpt[]>([]);
  const [tenants, setTenants] = useState<any[]>([]);
  const [tenantLoading, setTenantLoading] = useState(false);
  const [tenantOrgCascaderOptions, setTenantOrgCascaderOptions] = useState<DefaultOptionType[]>([]);
  const [createModalClouds, setCreateModalClouds] = useState<any[]>([]);
  const [createModalCloudLoading, setCreateModalCloudLoading] = useState(false);
  const [createModalVpcs, setCreateModalVpcs] = useState<Array<{ id: string; name: string; label: string }>>([]);
  const [createModalVpcLoading, setCreateModalVpcLoading] = useState(false);
  const [createModalRancherLoading, setCreateModalRancherLoading] = useState(false);
  const [vrUuidsBoundElsewhere, setVrUuidsBoundElsewhere] = useState<Set<string>>(new Set());

  const createCategoryWatch = Form.useWatch('category', createForm);
  const createCloudIdWatch = Form.useWatch('cloudId', createForm);
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

  const vrSelectOptions = useMemo(() => {
    const cur = String(createVrUuidWatch ?? editing?.vrUuid ?? '').trim();
    return vrCeOptions
      .filter((v) => {
        const u = String(v?.uuid || '').trim();
        if (!u) return false;
        if (cur && u === cur) return true;
        return !vrUuidsBoundElsewhere.has(u);
      })
      .map((v) => ({ value: v.uuid, label: v.name }));
  }, [vrCeOptions, vrUuidsBoundElsewhere, createVrUuidWatch, editing?.vrUuid]);

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
    try {
      const res = await fetchVrCachePageList(1000, 1);
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
    } catch (err: any) {
      console.warn('VR list fetch failed', err);
      const errMsg = typeof err === 'string' ? err : err?.message || JSON.stringify(err);
      message.error(`加载 VR 列表失败: ${errMsg}`);
      setVrOptions([]);
      setVrCeOptions([]);
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

  const onSubmitCreate = async () => {
    const findVrName = (uuid?: string) =>
      uuid
        ? vrCeOptions.find((v) => v.uuid === uuid)?.name || vrOptions.find((v) => v.uuid === uuid)?.name
        : undefined;
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
        await updateSecurityDomain(editing.id, payload);
        message.success('安全域已更新');
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
        await createSecurityDomain(payload);
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
        await createSecurityDomain(payload);
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
        await createSecurityDomain(payload);
      }
      message.success('安全域已创建');
      onSuccess();
      onClose();
      createForm.resetFields();
    } catch (e: any) {
      if (e?.errorFields) return;
      const msg = typeof e?.message === 'string' ? e.message : String(e);
      message.error(`保存失败：${msg}`);
    }
  };

  const onCancel = () => {
    onClose();
    createForm.resetFields();
  };

  return (
    <Modal
      title={editing ? '编辑安全域' : '新建安全域'}
      open={open}
      onCancel={onCancel}
      onOk={onSubmitCreate}
      okText={editing ? '保存' : '创建'}
      cancelText="取消"
      destroyOnClose
      width={600}
      styles={{ body: { maxHeight: 'min(70vh, 600px)', overflowY: 'auto' } }}
    >
      <Form form={createForm} layout="vertical">
        <Form.Item name="name" label="名称" rules={[{ required: true, message: '请输入安全域名称' }]}>
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
              } as any);
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
              } as Partial<SecurityDomainForm>);
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
        {createModalDomainKind === 'vpc' && hasTenantAndOrg && (
          <>
            <Form.Item name="cloudId" label="云资源池" rules={[{ required: true, message: '请选择资源池' }]}>
              <Select
                showSearch
                optionFilterProp="label"
                loading={createModalCloudLoading}
                placeholder="已接入的公有云/私有云/边缘"
                options={createModalClouds.map((c) => ({
                  value: c.id || c._id || c.uuid || c.cloudId,
                  label: cloudLabel(c),
                }))}
                onChange={() => {
                  createForm.setFieldValue('vpcId', undefined);
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
              />
            </Form.Item>
            <Form.Item name="vrUuid" label="VR 实例">
              <Select
                allowClear
                showSearch
                optionFilterProp="label"
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
                placeholder="与所选租户/组织下可见的资源池一致"
                options={createModalClouds.map((c) => ({
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
                placeholder="不绑定可留空"
                options={vrSelectOptions}
              />
            </Form.Item>
          </>
        )}
      </Form>
    </Modal>
  );
};

export default SecurityDomainFormModal;
