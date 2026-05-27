import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Form, message, Modal, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useNavigate } from 'react-router-dom';
import type { Tenant, CreateTenantRequest } from '../../../types/tenant';
import ResourceActionsDropdown from '../../../components/ResourceActionsDropdown';
import { apiRequest, apiPost, apiPatch, apiDelete } from '../../../services/api';
import { parseTenantDeleteError } from '../lib/tenantDeleteErrors';
import { countOrganizationsInTree } from '../lib/tenantOrgTree';
import {
  showTenantDeleteBlockedByOrgUsersModal,
  showTenantDelete409Modal,
  showBatchTenantDeleteBlockedModal,
  showBatchTenantDeleteFailuresModal,
} from '../modals/tenantDeleteModals';

export function useTenantsPage() {
  const [loading, setLoading] = useState(false);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [tenantUpsertModalOpen, setTenantUpsertModalOpen] = useState(false);
  const [editingTenant, setEditingTenant] = useState<Tenant | null>(null);
  const [tenantForm] = Form.useForm();
  const [filterForm] = Form.useForm();

  const [tenantSearch, setTenantSearch] = useState('');
  /** 是否有组织用户：'' 不限 | yes 有 | no 无（依赖异步加载的 tenantUserCountMap） */
  const [hasUsersFilter, setHasUsersFilter] = useState<'yes' | 'no' | ''>('');
  const [selectedTenantRowKeys, setSelectedTenantRowKeys] = useState<React.Key[]>([]);

  const [tenantOrgCountMap, setTenantOrgCountMap] = useState<Record<string, number>>({});
  const [tenantUserCountMap, setTenantUserCountMap] = useState<Record<string, number>>({});

  const navigate = useNavigate();

  const refreshUserCounts = useCallback(async (list: Tenant[]) => {
    try {
      const pairs: [string, number][] = [];

      const chunkSize = 5;
      for (let i = 0; i < list.length; i += chunkSize) {
        const chunk = list.slice(i, i + chunkSize);
        const chunkResults = await Promise.all(
          chunk.map(async (t) => {
            try {
              const res = await apiRequest(`/api/tenants/${t.id}/users`);
              const users = Array.isArray(res) ? res : (res?.users || []);
              return [t.id, users.length] as [string, number];
            } catch {
              return [t.id, 0] as [string, number];
            }
          }),
        );
        pairs.push(...chunkResults);
      }

      setTenantUserCountMap((prev) => {
        const next = { ...prev };
        for (const [id, cnt] of pairs) next[id] = cnt;
        return next;
      });
    } catch {
      // ignore
    }
  }, []);

  const refreshOrgCounts = useCallback(async (list: Tenant[]) => {
    try {
      const pairs: [string, number][] = [];

      const chunkSize = 5;
      for (let i = 0; i < list.length; i += chunkSize) {
        const chunk = list.slice(i, i + chunkSize);
        const chunkResults = await Promise.all(
          chunk.map(async (t) => {
            try {
              const res = await apiRequest(`/api/tenants/${t.id}/organizations`);
              const orgs = Array.isArray(res) ? res : (res?.organizations || []);
              return [t.id, countOrganizationsInTree(orgs)] as [string, number];
            } catch {
              return [t.id, 0] as [string, number];
            }
          }),
        );
        pairs.push(...chunkResults);
      }

      setTenantOrgCountMap((prev) => {
        const next = { ...prev };
        for (const [id, cnt] of pairs) next[id] = cnt;
        return next;
      });
    } catch {
      // ignore
    }
  }, []);

  const fetchTenants = useCallback(
    async (force: boolean = false) => {
      try {
        setLoading(true);
        const url = force ? '/api/tenants?force=true' : '/api/tenants';
        const data = await apiRequest(url, force ? { skipCache: true } : undefined);
        const tenantsList = Array.isArray(data) ? data : (data?.tenants || []);
        setTenants(tenantsList);
        refreshOrgCounts(tenantsList);
        refreshUserCounts(tenantsList);
      } catch {
        message.error('获取租户列表失败');
      } finally {
        setLoading(false);
      }
    },
    [refreshOrgCounts, refreshUserCounts],
  );

  const handleTenantSubmit = useCallback(
    async (values: CreateTenantRequest) => {
      try {
        if (editingTenant) {
          await apiPatch(`/api/tenants/${editingTenant.id}`, values);
          message.success('租户更新成功');
        } else {
          await apiPost('/api/tenants', values);
          message.success('租户创建成功');
        }
        setTenantUpsertModalOpen(false);
        setEditingTenant(null);
        tenantForm.resetFields();
        fetchTenants(true);
      } catch (error: unknown) {
        const err = error as { message?: string };
        message.error(err?.message || '操作失败');
      }
    },
    [editingTenant, tenantForm, fetchTenants],
  );

  const refreshTenantUserCount = useCallback(async (tenantId: string): Promise<number> => {
    try {
      const res = await apiRequest(`/api/tenants/${tenantId}/users`);
      const users = Array.isArray(res) ? res : (res?.users || []);
      const n = users.length;
      setTenantUserCountMap((prev) => ({ ...prev, [tenantId]: n }));
      return n;
    } catch {
      return -1;
    }
  }, []);

  const handleDeleteTenant = useCallback(
    async (id: string) => {
      await apiDelete(`/api/tenants/${id}`);
      message.success('租户删除成功');
      fetchTenants(true);
    },
    [fetchTenants],
  );

  const handleBatchDeleteTenants = useCallback(async () => {
    if (selectedTenantRowKeys.length === 0) {
      message.info('请先选择要删除的租户');
      return;
    }

    const ids = selectedTenantRowKeys.map(String);
    const counts = await Promise.all(
      ids.map(async (id) => {
        const n = await refreshTenantUserCount(id);
        return { id, n };
      }),
    );
    const blocked = counts.filter((x) => x.n > 0);
    if (blocked.length > 0) {
      showBatchTenantDeleteBlockedModal(
        blocked.map(({ id, n }) => {
          const t = tenants.find((x) => x.id === id);
          return { id, label: t?.name || id, n };
        }),
      );
      return;
    }
    if (counts.some((x) => x.n < 0)) {
      message.error('无法校验部分租户的组织用户数量，请稍后重试');
      return;
    }

    Modal.confirm({
      title: '确认批量删除租户',
      content: '删除后将无法恢复。若某租户仍存在资源绑定等占用，该租户将无法删除。',
      okText: '删除',
      cancelText: '取消',
      onOk: async () => {
        const keys = selectedTenantRowKeys.map(String);
        const results = await Promise.allSettled(keys.map((id) => apiDelete(`/api/tenants/${id}`)));
        const failures: Array<{ tenantLabel: string; message: string; resources: Array<{ name?: string; count?: number }> }> = [];
        results.forEach((r, i) => {
          if (r.status !== 'rejected') return;
          const id = keys[i];
          const t = tenants.find((x) => x.id === id);
          const parsed = parseTenantDeleteError(r.reason);
          failures.push({
            tenantLabel: t?.name || id,
            message: parsed.message,
            resources: parsed.resources,
          });
        });
        const ok = results.filter((r) => r.status === 'fulfilled').length;
        if (ok > 0) {
          message.success(`已删除 ${ok} 个租户`);
          fetchTenants(true);
          setSelectedTenantRowKeys([]);
        }
        if (failures.length > 0) {
          showBatchTenantDeleteFailuresModal(failures, ok > 0);
        }
      },
    });
  }, [selectedTenantRowKeys, tenants, refreshTenantUserCount, fetchTenants]);

  const tenantColumns: ColumnsType<Tenant> = useMemo(
    () => [
      {
        title: '租户',
        dataIndex: 'name',
        key: 'name',
        render: (text: string, record: Tenant) => (
          <a
            className="cell-link"
            href={`/admin/tenants/${record.id}/organizations`}
            onClick={(e) => {
              e.preventDefault();
              navigate(`/admin/tenants/${record.id}/organizations`);
            }}
          >
            {text}
          </a>
        ),
      },
      {
        title: 'ID',
        dataIndex: 'id',
        key: 'id',
        render: (text: string) => <Typography.Text copyable>{text}</Typography.Text>,
      },
      {
        title: '组织数量',
        key: 'orgCount',
        render: (_: unknown, record: Tenant) => tenantOrgCountMap[record.id] ?? '-',
      },
      {
        title: '用户数量',
        key: 'userCount',
        render: (_: unknown, record: Tenant) => tenantUserCountMap[record.id] ?? '-',
      },
      {
        title: '创建时间',
        dataIndex: 'createdAt',
        key: 'createdAt',
        render: (date: string) => new Date(date).toLocaleString(),
      },
      {
        title: '操作',
        key: 'action',
        render: (_: unknown, record: Tenant) => (
          <ResourceActionsDropdown
            items={[
              { key: 'orgManage', label: '组织管理' },
              { key: 'edit', label: '编辑' },
              { type: 'divider', key: 'divider-before-delete' },
              { key: 'delete', label: '删除', danger: true },
            ]}
            onClick={({ key }) => {
              if (key === 'edit') {
                setEditingTenant(record);
                tenantForm.setFieldsValue(record);
                setTenantUpsertModalOpen(true);
                return;
              }
              if (key === 'delete') {
                void (async () => {
                  const n = await refreshTenantUserCount(record.id);
                  if (n < 0) {
                    message.error('无法校验组织用户数量，请稍后重试');
                    return;
                  }
                  if (n > 0) {
                    showTenantDeleteBlockedByOrgUsersModal(record.name, n);
                    return;
                  }

                  Modal.confirm({
                    title: '确认删除租户',
                    content: '删除后将无法恢复。若仍存在资源绑定等占用，系统将拒绝删除。',
                    okText: '删除',
                    cancelText: '取消',
                    onOk: async () => {
                      try {
                        await handleDeleteTenant(record.id);
                      } catch (error: unknown) {
                        const parsed = parseTenantDeleteError(error);
                        const { status, message: errorMessage, resources, blockingReason, userCount } = parsed;

                        if (status === 409 && blockingReason === 'ORG_USERS') {
                          showTenantDeleteBlockedByOrgUsersModal(record.name, userCount ?? 1);
                          return;
                        }

                        if (status === 409) {
                          showTenantDelete409Modal(errorMessage, resources);
                        } else {
                          message.error(errorMessage);
                        }
                      }
                    },
                  });
                })();
                return;
              }
              if (key === 'orgManage') {
                navigate(`/admin/tenants/${record.id}/organizations`);
              }
            }}
          />
        ),
      },
    ],
    [
      navigate,
      tenantOrgCountMap,
      tenantUserCountMap,
      tenantForm,
      refreshTenantUserCount,
      handleDeleteTenant,
    ],
  );

  const handleFilterChange = useCallback((_: unknown, all: { keyword?: string; hasUsers?: 'yes' | 'no' }) => {
    setTenantSearch(all.keyword || '');
    const hu = all.hasUsers;
    setHasUsersFilter(hu === 'yes' || hu === 'no' ? hu : '');
  }, []);

  const filteredTenants = useMemo(() => {
    return tenants.filter((t) => {
      if (hasUsersFilter === 'yes') {
        const c = tenantUserCountMap[t.id];
        if (c === undefined) return false;
        if (c <= 0) return false;
      } else if (hasUsersFilter === 'no') {
        const c = tenantUserCountMap[t.id];
        if (c === undefined) return false;
        if (c !== 0) return false;
      }

      if (!tenantSearch) return true;
      const searchLower = tenantSearch.toLowerCase();
      return (
        t.name.toLowerCase().includes(searchLower) ||
        (t.description || '').toLowerCase().includes(searchLower) ||
        t.id.toLowerCase().includes(searchLower)
      );
    });
  }, [tenants, tenantSearch, hasUsersFilter, tenantUserCountMap]);

  const closeTenantUpsertModal = useCallback(() => {
    setTenantUpsertModalOpen(false);
    setEditingTenant(null);
    tenantForm.resetFields();
  }, [tenantForm]);

  useEffect(() => {
    fetchTenants();
  }, [fetchTenants]);

  const resetFilter = useCallback(() => {
    filterForm.resetFields();
    setTenantSearch('');
    setHasUsersFilter('');
  }, [filterForm]);

  const openCreateTenantModal = useCallback(() => {
    setEditingTenant(null);
    tenantForm.resetFields();
    setTenantUpsertModalOpen(true);
  }, [tenantForm]);

  return {
    loading,
    filteredTenants,
    tenantColumns,
    selectedTenantRowKeys,
    setSelectedTenantRowKeys,
    fetchTenants,
    filterForm,
    handleFilterChange,
    resetFilter,
    tenantUpsertModalOpen,
    editingTenant,
    tenantForm,
    handleTenantSubmit,
    closeTenantUpsertModal,
    handleBatchDeleteTenants,
    openCreateTenantModal,
  };
}
