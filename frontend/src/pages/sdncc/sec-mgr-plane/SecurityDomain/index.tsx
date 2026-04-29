import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { Cascader, Form, Input, message, Modal, Select, Tag, Tooltip } from 'antd';
import type { MenuProps } from 'antd';
import { SearchOutlined } from '@ant-design/icons';
import PageContainer from '../../../../components/PageContainer';
import ResourceActionsDropdown from '../../../../components/ResourceActionsDropdown';
import { fetchCloudProviderVpcs, fetchTenants } from '../../../../services/api';
import { listSecurityDomains, deleteSecurityDomain } from '../../../../services/securityDomainApi';
import {
  formatCategoryLabel,
  getDomainKindFromCategory,
  normalizeCategoryForForm,
  SECURITY_DOMAIN_CATEGORY_VALUE_OPTIONS,
} from '../../../../utils/securityDomainKind';
import SecurityDomainFormModal from './modals/SecurityDomainFormModal';
import type { SecurityDomain, SecurityDomainStatus } from './securityDomainModel';

export type { SecurityDomain, SecurityDomainStatus, SecurityDomainType } from './securityDomainModel';

/** 级联子级：无 organizationId 的安全域；与表单项值一致 */
const TENANT_ORG_UNASSIGNED = '__unassigned__';

const SecurityDomainPage: React.FC = () => {
  const [form] = Form.useForm();
  const [keyword, setKeyword] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<SecurityDomainStatus | undefined>();
  /** 与新建/编辑表单的 `category` 单字段同一套四档（`normalizeCategoryForForm` 可比） */
  const [categoryFilter, setCategoryFilter] = useState<string | undefined>();
  const [providerFilter, setProviderFilter] = useState<string | undefined>();
  const [regionFilter, setRegionFilter] = useState<string | undefined>();
  const [tenantIdFilter, setTenantIdFilter] = useState<string | undefined>();
  const [organizationIdFilter, setOrganizationIdFilter] = useState<string | undefined>();

  const [domains, setDomains] = useState<SecurityDomain[]>([]);
  const [loading, setLoading] = useState<boolean>(false);

  const [tenants, setTenants] = useState<any[]>([]);

  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<SecurityDomain | null>(null);

  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);

  const initializedRef = useRef(false);

  const loadTenants = useCallback(async () => {
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
    }
  }, []);

  useEffect(() => {
    if (!initializedRef.current) {
      initializedRef.current = true;
      reloadDomains();
      loadTenants();
    }
  }, []);

  const reloadDomains = useCallback(async () => {
    try {
      setLoading(true);
      const list = await listSecurityDomains();
      const needVpcCidrs = (Array.isArray(list) ? list : []).filter(
        (it: any) => getDomainKindFromCategory(it?.category) === 'vpc' && it?.vpcMode === 'existing' && it?.cloudId && it?.vpcId,
      );
      const cloudIds = Array.from(new Set(needVpcCidrs.map((it: any) => String(it.cloudId)))).filter(Boolean);
      const vpcCache: Record<string, any[]> = {};
      for (const cid of cloudIds) {
        try {
          const res = await fetchCloudProviderVpcs(cid);
          const raw = (res?.data || res || []);
          const items =
            Array.isArray(raw?.Vpcs?.Vpc) ? raw.Vpcs.Vpc
            : Array.isArray(res?.Vpcs?.Vpc) ? res.Vpcs.Vpc
            : Array.isArray(raw?.vpcs?.vpcs) ? raw.vpcs.vpcs
            : Array.isArray(raw?.vpcs) ? raw.vpcs
            : Array.isArray(res?.vpcs) ? res.vpcs
            : Array.isArray(raw?.items) ? raw.items
            : Array.isArray(res?.items) ? res.items
            : Array.isArray(raw?.list) ? raw.list
            : Array.isArray(res?.list) ? res.list
            : (Array.isArray(raw) ? raw : []);
          vpcCache[cid] = items;
        } catch (e) {
          vpcCache[cid] = [];
        }
      }
      const normalized: SecurityDomain[] = (Array.isArray(list) ? list : []).map((item: any) => {
        let ipv4Cidrs: string[] = [];
        let ipv6Cidrs: string[] = [];
        if (item.newVpcCidr) {
          ipv4Cidrs = [item.newVpcCidr];
        } else if (getDomainKindFromCategory(item?.category) === 'vpc' && item.vpcMode === 'existing' && item.cloudId && item.vpcId) {
          const vpcs = vpcCache[String(item.cloudId)] || [];
          const v = vpcs.find((x: any) => String(x?.VpcId || x?.id || x?.uuid || x?.vpcId || x?.vpc_id || x?.Name || x?.name) === String(item.vpcId));
          let cidr = v?.CidrBlock || v?.Ipv4CidrBlock || v?.cidr || v?.Cidr || v?.VpcCidr || v?.CidrIpv4 || undefined;
          
          // Fallback to stored CIDR if realtime lookup fails or returns nothing
          if (!cidr && item.cidr) {
            cidr = item.cidr;
          }

          if (cidr) {
            const s = String(cidr);
            ipv4Cidrs = s.includes(',') ? s.split(',').map(x => x.trim()).filter(Boolean) : [s];
          }
          const cidr6 = v?.Ipv6CidrBlock || v?.CidrIpv6 || v?.Ipv6Cidr || undefined;
          if (cidr6) ipv6Cidrs = [String(cidr6)];
        } else if (item.cidr) {
          ipv4Cidrs = [String(item.cidr)];
        }
        return ({
          id: item.id,
          name: item.name,
          type: item.type,
          category: (item as any).category,
          cloudId: item.cloudId,
          vpcId: item.vpcId,
          vpcMode: item.vpcMode,
          provider: item.provider,
          region: item.region,
          cidr4: ipv4Cidrs,
          cidr6: (() => {
            if (ipv6Cidrs.length) return ipv6Cidrs;
            if (typeof (item as any).cidr6 === 'string') {
              return (item as any).cidr6.split(',').map((s: string) => s.trim()).filter(Boolean);
            }
            return ((item as any).cidr6 || []);
          })(),
          cidr: item.cidr,
          newVpcCidr: item.newVpcCidr,
          vrUuid: item.vrUuid,
          vrName: item.vrName,
          tags: typeof item.tags === 'string' ? item.tags.split(',').map((s: string) => s.trim()).filter(Boolean) : (item.tags || []),
          status: item.status || 'active',
          createdAt: item.createdAt ? String(item.createdAt).slice(0,19).replace('T',' ') : undefined,
          updatedAt: item.updatedAt ? String(item.updatedAt).slice(0,19).replace('T',' ') : undefined,
          vrInstanceIds: item.vrInstanceIds,
          vrPublicEniIds: item.vrPublicEniIds,
          vrPublicEip: item.vrPublicEip,
          vrPublicIp: item.vrPublicIp,
          vrPrivateIp: item.vrPrivateIp,
          vrPublicSubnetCidr: item.vrPublicSubnetCidr,
          vrPrivateSubnetCidr: item.vrPrivateSubnetCidr,
          resourcePool: item.resourcePool,
          tenantId: item.tenantId,
          tenantName: item.tenantName,
          organizationId: item.organizationId,
          organizationName: item.organizationName,
          });
      });
      setDomains(normalized);
    } catch (e: any) {
      message.error('获取安全域列表失败');
    } finally {
      setLoading(false);
    }
  }, []);

  const toolbarProviderOptions = useMemo(() => {
    const s = new Set<string>();
    for (const d of domains) {
      const p = d.provider != null ? String(d.provider).trim() : '';
      if (p) s.add(p);
    }
    return Array.from(s).sort((a, b) => a.localeCompare(b, 'zh-Hans'));
  }, [domains]);

  const toolbarRegionOptions = useMemo(() => {
    const s = new Set<string>();
    for (const d of domains) {
      if (providerFilter && String(d.provider || '').trim() !== providerFilter) continue;
      const r = d.region != null ? String(d.region).trim() : '';
      if (r) s.add(r);
    }
    return Array.from(s).sort((a, b) => a.localeCompare(b, 'zh-Hans'));
  }, [domains, providerFilter]);

  const toolbarTenantOrgCascaderOptions = useMemo(() => {
    type ByT = { label: string; hasNoOrg: boolean; orgs: Map<string, string> };
    const byTenant = new Map<string, ByT>();
    for (const d of domains) {
      const tid = d.tenantId != null ? String(d.tenantId).trim() : '';
      if (!tid) continue;
      const fromRowT = d.tenantName && String(d.tenantName).trim() ? String(d.tenantName).trim() : '';
      const t = tenants.find((x: any) => String(x.id) === tid);
      const tlabel = fromRowT || (t ? String(t.name || t.id) : tid);
      if (!byTenant.has(tid)) {
        byTenant.set(tid, { label: tlabel, hasNoOrg: false, orgs: new Map() });
      } else if (fromRowT) {
        byTenant.get(tid)!.label = fromRowT;
      }
      const rec = byTenant.get(tid)!;
      const oid = d.organizationId != null ? String(d.organizationId).trim() : '';
      if (oid) {
        const olabel = d.organizationName && String(d.organizationName).trim() ? String(d.organizationName).trim() : oid;
        if (!rec.orgs.has(oid)) {
          rec.orgs.set(oid, olabel);
        } else if (d.organizationName && String(d.organizationName).trim()) {
          rec.orgs.set(oid, olabel);
        }
      } else {
        rec.hasNoOrg = true;
      }
    }
    const out: { value: string; label: string; children: { value: string; label: string }[] }[] = [];
    for (const [tid, { label, hasNoOrg, orgs }] of byTenant) {
      const children: { value: string; label: string }[] = Array.from(orgs.entries())
        .map(([value, olabel]) => ({ value, label: olabel }))
        .sort((a, b) => a.label.localeCompare(b.label, 'zh-Hans'));
      if (hasNoOrg) {
        children.unshift({ value: TENANT_ORG_UNASSIGNED, label: '（未指定组织）' });
      }
      out.push({ value: tid, label, children });
    }
    return out.sort((a, b) => a.label.localeCompare(b.label, 'zh-Hans'));
  }, [domains, tenants]);

  const filteredDomains = useMemo(() => {
    return domains.filter(item => {
      const matchKeyword = keyword
        ? [item.name, item.provider, item.region, item.category, item.tenantName, item.organizationName]
            .filter(Boolean)
            .some(v => String(v).toLowerCase().includes(keyword.toLowerCase()))
        : true;
      const matchStatus = statusFilter ? item.status === statusFilter : true;
      const matchCategory = categoryFilter
        ? normalizeCategoryForForm(item.category) === categoryFilter
        : true;
      const matchProvider = providerFilter ? String(item.provider || '').trim() === providerFilter : true;
      const matchRegion = regionFilter ? String(item.region || '').trim() === regionFilter : true;
      const matchTenant = tenantIdFilter ? String(item.tenantId || '') === String(tenantIdFilter) : true;
      const matchOrg = (() => {
        if (!organizationIdFilter) return true;
        if (organizationIdFilter === TENANT_ORG_UNASSIGNED) {
          return !String(item.organizationId || '').trim();
        }
        return String(item.organizationId || '') === String(organizationIdFilter);
      })();
      return matchKeyword && matchStatus && matchCategory && matchProvider && matchRegion && matchTenant && matchOrg;
    });
  }, [domains, keyword, statusFilter, categoryFilter, providerFilter, regionFilter, tenantIdFilter, organizationIdFilter]);

  const forceRefresh = () => {
    void reloadDomains();
    message.success('已刷新');
  };

  const removeSelectedDomains = () => {
    if (!selectedRowKeys.length) return;
    const targets = domains.filter(d => selectedRowKeys.includes(d.id));
    Modal.confirm({
      title: '确认批量删除选中的安全域？',
      content: `共 ${targets.length} 项：${targets.map(t => t.name).join('、')}`,
      okText: '删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => {
        const results = await Promise.allSettled(targets.map(t => deleteSecurityDomain(t.id)));
        const success = results.filter(r => r.status === 'fulfilled').length;
        const failed = results.length - success;
        if (success) message.success(`已删除 ${success} 项${failed ? `，失败 ${failed} 项` : ''}`);
        else message.error('删除失败');
        setSelectedRowKeys([]);
        reloadDomains();
      },
    });
  };

  const openCreateModal = useCallback(() => {
    setEditing(null);
    setCreateOpen(true);
  }, []);

  const openEdit = useCallback((record: SecurityDomain) => {
    setEditing(record);
    setCreateOpen(true);
  }, []);

  const closeFormModal = useCallback(() => {
    setCreateOpen(false);
    setEditing(null);
  }, []);

  const removeDomain = useCallback((record: SecurityDomain) => {
    Modal.confirm({
      title: '确认删除该安全域？',
      content: `安全域名称：${record.name}`,
      okText: '删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: () => {
        deleteSecurityDomain(record.id)
          .then(() => { message.success('删除成功'); reloadDomains(); })
          .catch((e) => { message.error(`删除失败: ${e?.message || e}`); });
      },
    });
  }, [reloadDomains]);

  const columns = useMemo(() => {
    return [
      {
        title: '名称',
        dataIndex: 'name',
        key: 'name',
        render: (text: string, record: SecurityDomain) => (
          <Link to={`/admin/sec-mgr-plane/security-domain/${record.id}`} className="cell-link">{text}</Link>
        ),
      },
      {
        title: '类型',
        key: 'category',
        ellipsis: true,
        render: (_: any, r: SecurityDomain) => {
          const t = formatCategoryLabel(r.category);
          return t ? t : '—';
        },
      },
      {
        title: '云厂商',
        dataIndex: 'provider',
        key: 'provider',
        ellipsis: true,
        render: (v: any) => (v != null && String(v).trim() !== '' ? String(v) : '—'),
      },
      {
        title: '地域',
        dataIndex: 'region',
        key: 'region',
        ellipsis: true,
        render: (v: any) => (v != null && String(v).trim() !== '' ? String(v) : '—'),
      },
      {
        title: '租户',
        key: 'tenant',
        render: (_: any, r: SecurityDomain) => {
          if (r.tenantName) return r.tenantName;
          const id = String(r.tenantId || '').trim();
          if (!id) return '—';
          const t = tenants.find((x: any) => String(x.id) === id);
          return t ? (t.name || id) : id;
        },
      },
      {
        title: '组织',
        key: 'organization',
        render: (_: any, r: SecurityDomain) => {
          if (r.organizationName) return r.organizationName;
          const id = String(r.organizationId || '').trim();
          if (!id) return '—';
          return id;
        },
      },
      {
        title: 'IPv4 CIDR',
        dataIndex: 'cidr4',
        key: 'cidr4',
        ellipsis: true,
        render: (list: string[] = []) => (Array.isArray(list) && list.length ? list.join('，') : '—'),
      },
      {
        title: 'IPv6 CIDR',
        dataIndex: 'cidr6',
        key: 'cidr6',
        ellipsis: true,
        render: (list: string[] = []) => (Array.isArray(list) && list.length ? list.join('，') : '—'),
      },
      {
        title: 'VR 名称',
        dataIndex: 'vrName',
        key: 'vrName',
        ellipsis: true,
        render: (v: any) => (v != null && String(v).trim() !== '' ? String(v) : '未绑定'),
      },
      {
        title: 'VR UUID',
        dataIndex: 'vrUuid',
        key: 'vrUuid',
        ellipsis: { showTitle: false },
        width: 220,
        render: (v: any) => (v != null && String(v).trim() !== '' ? <Tooltip title={String(v)}><span className="table-mono-uuid">{String(v)}</span></Tooltip> : '—'),
      },
      {
        title: '创建时间',
        dataIndex: 'createdAt',
        key: 'createdAt',
      },
      {
        title: '操作',
        key: 'actions',
        fixed: 'right',
        render: (_: any, record: SecurityDomain) => {
          const items: MenuProps['items'] = [
            { key: 'edit', label: '编辑' },
            { type: 'divider' },
            { key: 'delete', label: '删除', danger: true },
          ];
          const onMenuClick: MenuProps['onClick'] = ({ key }) => {
            if (key === 'edit') return openEdit(record);
            if (key === 'delete') return removeDomain(record);
          };
          return (
            <ResourceActionsDropdown
              items={items}
              onClick={onMenuClick as any}
              buttonProps={{ className: 'row-actions-trigger' }}
            />
          );
        },
      },
    ];
  }, [openEdit, removeDomain, tenants]);

  return (
    <PageContainer
      titleLevel={3}
      asCard={false}
      defaultHiddenColumns={['cidr6', 'vrUuid', 'createdAt']}
      primaryAction={{
        text: '新建安全域',
        onClick: openCreateModal,
      }}
      moreMenuItems={[
        {
          key: 'bulkDel',
          label: '批量删除',
          danger: true,
          disabled: selectedRowKeys.length === 0,
          onClick: removeSelectedDomains,
        },
      ]}
      onRefresh={forceRefresh}
      tableProps={{
        loading,
        rowKey: 'id',
        dataSource: filteredDomains,
        columns: columns as any,
        className: 'vr-table std-table',
        scroll: { x: 'max-content' },
        tableLayout: 'auto',
        rowSelection: {
          selectedRowKeys,
          onChange: (keys) => setSelectedRowKeys(keys),
        },
        pagination: {
          size: 'small',
          showTotal: (total) => `共 ${total} 条`,
        },
      }}
      toolbarLeft={
        <Form
          className="toolbar-container"
          layout="inline"
          form={form}
          initialValues={{}}
          style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}
          onValuesChange={(changed, all) => {
            setKeyword((all.keyword || '').trim());
            setStatusFilter(all.status || undefined);
            setCategoryFilter(
              all.categoryFilter != null && String(all.categoryFilter).trim() !== ''
                ? String(all.categoryFilter).trim()
                : undefined,
            );
            const p = (all.provider || '').trim() || undefined;
            setProviderFilter(p);
            let r = (all.region || '').trim() || undefined;
            if (Object.prototype.hasOwnProperty.call(changed, 'provider')) {
              const nextRegions = new Set(
                domains
                  .filter((d) => !p || String(d.provider || '').trim() === p)
                  .map((d) => String(d.region || '').trim())
                  .filter(Boolean),
              );
              if (r && !nextRegions.has(r)) {
                r = undefined;
                form.setFieldsValue({ region: undefined });
              }
            }
            setRegionFilter(r);
            const to = all.tenantOrg as (string | undefined)[] | undefined;
            if (Array.isArray(to) && to.length >= 1) {
              setTenantIdFilter(String(to[0]));
              setOrganizationIdFilter(
                to.length >= 2 && to[1] != null && to[1] !== '' ? String(to[1]) : undefined
              );
            } else {
              setTenantIdFilter(undefined);
              setOrganizationIdFilter(undefined);
            }
          }}
        >
          <Form.Item name="keyword" style={{ marginBottom: 0 }}>
            <Input
              allowClear
              placeholder="名称 / 云厂商 / 地域 / 类型"
              className="toolbar-search"
              suffix={<SearchOutlined />}
            />
          </Form.Item>
          <Form.Item name="categoryFilter" style={{ marginBottom: 0 }}>
            <Select
              allowClear
              placeholder="类型"
              className="toolbar-filter-sm"
              options={SECURITY_DOMAIN_CATEGORY_VALUE_OPTIONS}
            />
          </Form.Item>
          <Form.Item name="provider" style={{ marginBottom: 0 }}>
            <Select
              allowClear
              showSearch
              optionFilterProp="value"
              placeholder="云厂商"
              className="toolbar-filter-sm"
              options={toolbarProviderOptions.map((v) => ({ value: v, label: v }))}
            />
          </Form.Item>
          <Form.Item name="region" style={{ marginBottom: 0 }}>
            <Select
              allowClear
              showSearch
              optionFilterProp="value"
              placeholder="地域"
              className="toolbar-filter-sm"
              options={toolbarRegionOptions.map((v) => ({ value: v, label: v }))}
            />
          </Form.Item>
          <Form.Item name="tenantOrg" style={{ marginBottom: 0 }}>
            <Cascader
              allowClear
              changeOnSelect
              className="toolbar-filter-sm"
              style={{ minWidth: 200 }}
              placeholder="租户 / 组织"
              options={toolbarTenantOrgCascaderOptions}
              showSearch={{
                filter: (input, path) =>
                  path.some((n) => String(n.label).toLowerCase().includes(String(input).toLowerCase())),
              }}
            />
          </Form.Item>
          <button
            type="button"
            className="toolbar-reset-btn"
            onClick={() => {
              form.resetFields();
              setKeyword('');
              setStatusFilter(undefined);
              setCategoryFilter(undefined);
              setProviderFilter(undefined);
              setRegionFilter(undefined);
              setTenantIdFilter(undefined);
              setOrganizationIdFilter(undefined);
            }}
          >
            重置
          </button>
        </Form>
      }
    >

      <SecurityDomainFormModal
        open={createOpen}
        editing={editing}
        onClose={closeFormModal}
        onSuccess={reloadDomains}
      />
    </PageContainer>
  );
};

export default SecurityDomainPage;
