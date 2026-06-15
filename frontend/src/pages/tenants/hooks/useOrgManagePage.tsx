/**
 * 组织管理页状态与副作用（视图：`sections/OrgManageWorkspace.tsx`）。
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Button, Dropdown, Form, Input, message, Modal, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import type { DataNode } from 'antd/es/tree';
import {
  CheckOutlined,
  CloseOutlined,
  EditOutlined,
  EllipsisOutlined,
  PlusOutlined,
} from '@ant-design/icons';

import { useTableColumnSettings } from '../../../hooks/useTableColumnSettings';
import { useAuth } from '../../../contexts/AuthContext';
import { apiDelete, apiPost, apiPut, apiRequest } from '../../../services/api';
import { hasPermissionForAction } from '../../../utils/accessMapping';
import { filterMenuItemsForReadOnly } from '../../../utils/rbacUi';
import { listSecurityDomains } from '../../../services/securityDomainApi';
import { formatCategoryLabel } from '../../../utils/securityDomainKind';
import { inferRoleKindFromDomain } from '../../../utils/internetworkRoutingDomain';
import {
  CreateTenantUserRequest,
  Organization,
  ResourcePoolAssignment,
  Tenant,
  TenantUser,
} from '../../../types/tenant';
import {
  formatRoleDisplayName,
  type OrgManageAssignment as Assignment,
  type OrgManageRBACRole as RBACRole,
} from '../lib/orgManageConstants';
import {
  isAssignableExistingNamespaceRecord,
  poolMatchesAssignDrawerTab,
} from '../lib/orgManagePoolHelpers';
import { InlineOrgAddChildRow, InlineOrgRenameRow } from '../components/InlineOrgTreeNameInput';
import { DeleteOrgConflict } from '../modals/DeleteOrgConflict';
import { RemoveAssignmentConflict } from '../modals/RemoveAssignmentConflict';

export function useOrgManagePage() {
  const { user } = useAuth();
  const userPerms = user?.permissions && Array.isArray(user.permissions) ? user.permissions : [];
  const role = String(user?.role || '').toLowerCase();
  const isSuperAdmin = role === 'super_admin';
  const canReadOrganizations =
    isSuperAdmin ||
    hasPermissionForAction(userPerms, 'organizations:read') ||
    hasPermissionForAction(userPerms, 'organizations:write');
  const canWriteOrganizations =
    isSuperAdmin || hasPermissionForAction(userPerms, 'organizations:write');
  const canReadTenantUsers =
    isSuperAdmin ||
    hasPermissionForAction(userPerms, 'tenant-users:read') ||
    hasPermissionForAction(userPerms, 'tenant-users:write');
  const canWriteTenantUsers = isSuperAdmin || hasPermissionForAction(userPerms, 'tenant-users:write');
  const canReadRoleAssignments =
    isSuperAdmin ||
    hasPermissionForAction(userPerms, 'system.roles.assignments:read') ||
    hasPermissionForAction(userPerms, 'system.roles.assignments:write');
  const canWriteRoleAssignments =
    isSuperAdmin || hasPermissionForAction(userPerms, 'system.roles.assignments:write');

  // --- 路由与全局反馈 ---
  const navigate = useNavigate();
  const { tenantId } = useParams();
  const [modal, contextHolder] = Modal.useModal();
  const [messageApi, messageContextHolder] = message.useMessage();

  // --- 页面状态（数据域）---
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [selectedOrg, setSelectedOrg] = useState<Organization | null>(null);
  const [expandedKeys, setExpandedKeys] = useState<string[]>([]);
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [orgKeyword, setOrgKeyword] = useState<string>('');
  // 组织树状态说明：
  // - expandedKeys：Tree 展开节点集合（提高交互一致性）
  // - selectedKeys：Tree 选中节点集合（通常仅保留当前 id）
  // - selectedOrg：当前业务上下文组织对象（右侧操作均依赖）
  // - orgKeyword：组织树搜索关键字（前端过滤，不触发后端检索）
  // 用户列表 & 过滤关键字
  const [users, setUsers] = useState<TenantUser[]>([]);
  const [userKeyword, setUserKeyword] = useState<string>('');
  const [userStatusFilter, setUserStatusFilter] = useState<'active' | 'inactive' | undefined>(undefined);
  // 用户列表说明：
  // - users：选中组织的用户列表，由 fetchUsers 拉取
  // - userKeyword：表格本地过滤关键字（用户名/姓名/邮箱）
  // - userStatusFilter：按活跃/非活跃筛选（与 TenantUser.status 一致）
  // 资源池分配列表 & 过滤关键字
  const [assignments, setAssignments] = useState<ResourcePoolAssignment[]>([]);
  const [assignmentKeyword, setAssignmentKeyword] = useState<string>('');
  // 资源池分配说明：
  // - assignments：当前组织的资源池分配列表
  // - assignmentKeyword：用于“计算资源分配”页签的本地过滤
  // 可分配资源池缓存（抽屉内选择使用）
  const [resourcePools, setResourcePools] = useState<any[]>([]);
  const [irdLoading, setIrdLoading] = useState(false);
  const [internetworkRoutingDomains, setInternetworkRoutingDomains] = useState<any[]>([]);
  const [irdKeyword, setIrdKeyword] = useState('');
  // 说明：
  // - resourcePools：抽屉“分配资源池”的候选集合（由 fetchResourcePools 获取）
  // - internetworkRoutingDomains：当前组织下网际路由域（只读展示；编排入口在 SDN → 网际路由域）
  // 组织树内联编辑/新增相关状态
  const [renameOrgId, setRenameOrgId] = useState<string | null>(null);
  const [addingForParentId, setAddingForParentId] = useState<string | null>(null);
  // 组织树内联编辑说明：
  // - renameOrgId：重命名的目标组织（名称输入在 InlineOrgRenameRow 本地 state）
  // - addingForParentId：在父组织下添加子组织的内联行（名称输入在 InlineOrgAddChildRow 本地 state）

  // --- 页面状态（表单与抽屉）---
  const [userForm] = Form.useForm();
  const [editUserForm] = Form.useForm();
  const [resourcePoolForm] = Form.useForm();
  // 两个独立表单：
  // - userForm：用于用户创建抽屉
  // - editUserForm：用于用户编辑弹窗
  // - resourcePoolForm：用于资源池分配抽屉
  const [userDrawerOpen, setUserDrawerOpen] = useState(false);
  const [editUserModalOpen, setEditUserModalOpen] = useState(false);
  const [editTargetUserId, setEditTargetUserId] = useState<string | null>(null);
  const [resourcePoolDrawerOpen, setResourcePoolDrawerOpen] = useState(false);
  // 资源分配类型（计算/存储/安全），用于抽屉内文案切换
  const [assignType, setAssignType] = useState<'compute'|'storage'|'security'>('compute');
  const [storageKeyword, setStorageKeyword] = useState<string>('');
  const [securityKeyword, setSecurityKeyword] = useState<string>('');
  const [nsLoading, setNsLoading] = useState<boolean>(false);
  const [nsOptions, setNsOptions] = useState<any[]>([]);
  /** 当前所选资源池上已被其他组织占用的命名空间（用于下拉排除） */
  const [occupiedNamespaceNames, setOccupiedNamespaceNames] = useState<string[]>([]);
  /** 分配抽屉「目标命名空间」：仅 tower.io/scenario=tenant；排除已被其他组织绑定 */
  const filteredAssignNsNames = useMemo(() => {
    const occupiedLc = new Set(
      (occupiedNamespaceNames || []).map((n) => String(n || '').trim().toLowerCase()).filter(Boolean),
    );
    return (nsOptions || [])
      .filter((x: any) => isAssignableExistingNamespaceRecord(x, occupiedLc))
      .map((x: any) => String(x?.metadata?.name || x?.name || '').trim())
      .filter((n): n is string => n.length > 0)
      .sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'));
  }, [nsOptions, occupiedNamespaceNames]);
  // 分配资源池模式说明：
  // - assignType：计算/存储/安全三类，用于候选池过滤与文案切换
  // - storageKeyword/securityKeyword：对应页签的本地过滤关键字
  // - nsLoading/nsOptions：按 provider 条件联动加载命名空间（Harvester/CloudMap 私有/边缘）
  // 角色库：用于为用户分配角色时的源数据
  const [tenantRoles, setTenantRoles] = useState<RBACRole[]>([]);
  const [roleAssignOpen, setRoleAssignOpen] = useState(false);
  const [roleAssignUser, setRoleAssignUser] = useState<TenantUser | null>(null);
  const [roleAssignSelected, setRoleAssignSelected] = useState<string[]>([]);
  const [roleAssignExisting, setRoleAssignExisting] = useState<Assignment[]>([]);
  const [roleAssignKw, setRoleAssignKw] = useState('');
  // 用户已分配角色名称映射（roleId → name），以及表格选择集（批量删除）
  const [rolesByUser, setRolesByUser] = useState<Record<string, Array<{ id: string; name: string }>>>({});
  const [selectedUserRowKeys, setSelectedUserRowKeys] = useState<string[]>([]);
  // 角色分配抽屉状态：
  // - roleAssignOpen：抽屉开关；roleAssignUser：当前用户
  // - roleAssignSelected：已选角色 id 集；roleAssignExisting：已有赋权记录
  // - roleAssignKw：角色库搜索关键字（前端过滤）
  // 用户表格辅助：
  // - rolesByUser：用户 → 角色名称映射（表格显示 name+id）
  // - selectedUserRowKeys：复选集（用于批量删除）

  // --- 派生数据 ---
  /** 已绑定到当前组织的 cloudId（分配抽屉内不再展示，避免重复提交被 skipped） */
  const assignedCloudIdsForOrg = useMemo(() => {
    const ids = new Set<string>();
    for (const a of assignments || []) {
      const cid = (a as { cloudId?: string; cloud?: { id?: string } }).cloudId || (a as { cloud?: { id?: string } }).cloud?.id;
      if (cid) ids.add(String(cid));
    }
    return ids;
  }, [assignments]);

  /** 当前分配 Tab 下可选资源池（与抽屉内 Select 一致，供 labelRender 解析 provider） */
  const assignableResourcePools = useMemo(
    () =>
      (resourcePools || []).filter(
        (pool: any) =>
          poolMatchesAssignDrawerTab(pool, assignType) && !assignedCloudIdsForOrg.has(String(pool.id)),
      ),
    [resourcePools, assignType, assignedCloudIdsForOrg],
  );

  // --- 数据请求 ---

  // 获取租户详情
  const fetchTenant = async (id: string) => {
    try {
      const data = await apiRequest(`/api/tenants/${id}`);
      setTenant(data);
    } catch {}
  };

  // 获取租户下组织树，并默认展开全部、选中根节点
  const fetchOrganizations = async (id: string, skipCache: boolean = false) => {
    try {
      const data = await apiRequest(`/api/tenants/${id}/organizations`, skipCache ? { skipCache: true } : undefined);
      const orgs = Array.isArray(data) ? data : (data?.organizations || []);
      setOrganizations(orgs);
      const collectKeys = (orgs: Organization[]): string[] => {
        const out: string[] = [];
        const visited = new Set<string>();
        const recur = (list: Organization[]) => {
          for (const o of list) {
            if (visited.has(o.id)) continue;
            visited.add(o.id);
            out.push(o.id);
            if (o.children && o.children.length) recur(o.children);
          }
        };
        recur(orgs);
        return out;
      };
      // 默认展开策略：
      // - 通过递归收集所有节点 id 作为 expandedKeys
      // - visited 集避免重复，保证整棵树被展开
      setExpandedKeys(collectKeys(orgs));
      const root = orgs.find((o: any) => o.level === 1) || orgs[0];
      if (root) {
        setSelectedKeys([root.id]);
        setSelectedOrg(root);
      }
    } catch {}
  };

  // 获取角色库（过滤掉非活跃角色，只保留租户级角色）
  const fetchTenantRoles = async () => {
    try {
      // 显式请求更多记录以防止分页截断
      const raw = await apiRequest('/api/system/rbac/roles?limit=1000', { enableCache: true });
      const list: RBACRole[] = Array.isArray(raw) ? raw : (Array.isArray(raw?.roles) ? raw.roles : []);
      // 只显示租户级角色（修复逻辑问题：租户用户只能分配租户级角色）
      const filtered = list.filter(r => 
        r.scope === 'tenant' && 
        String(r.status || 'active') === 'active'
      );
      setTenantRoles(filtered);
      // 兼容响应结构差异：
      // - 有的接口返回 { roles: [] }，有的直接返回数组；统一归一化为 list
      // - 仅保留 scope=tenant 且 status=active 的角色，避免展示禁用项和系统角色
    } catch (e) {
      console.error('[OrgManage] 获取租户角色失败:', e);
      setTenantRoles([]);
    }
  };

  // 获取指定组织下的用户列表
  const fetchUsers = async (tid: string, orgId: string, skipCache: boolean = false) => {
    try {
      const data = await apiRequest(`/api/tenants/${tid}/organizations/${orgId}/users`, skipCache ? { skipCache: true } : undefined);
      setUsers(Array.isArray(data) ? data : (data?.users || []));
    } catch (error) {
      console.error('获取用户列表失败:', error);
    }
  };

  // 获取指定组织的资源池分配列表（跳过缓存，确保最新）
  const fetchAssignments = async (orgId: string) => {
    try {
      const data = await apiRequest(`/api/tenants/organizations/${orgId}/resource-pools`, { skipCache: true });
      setAssignments(Array.isArray(data) ? data : (data?.assignments || []));
    } catch (error) {
      // 避免“分配后列表没变化却无任何提示”的困惑，至少记录日志
      console.error('获取资源池分配列表失败:', error);
    }
  };

  // 获取可分配资源池（抽屉内选择用）
  const fetchResourcePools = async () => {
    try {
      const data = await apiRequest('/api/tenants/available-resource-pools');
      setResourcePools(Array.isArray(data) ? data : (data?.pools || []));
    } catch {}
  };

  // --- 事件处理 ---
  // 保存组织重命名，并刷新组织树
  const handleOrgRename = async (orgId: string, name: string) => {
    if (!canWriteOrganizations) {
      messageApi.warning('无权限执行该操作');
      return;
    }
    try {
      await apiPut(`/api/tenants/organizations/${orgId}`, { name });
      setRenameOrgId(null);
      if (tenantId) fetchOrganizations(tenantId, true); // 强制刷新，跳过缓存
      messageApi.success('重命名成功');
    } catch (e: any) {
      const msg = e?.message || '重命名失败';
      messageApi.error(msg);
    }
  };

  // 添加子组织保存：校验名称、调用创建接口、刷新组织树
  const handleAddChildSave = async (parentId: string, name: string) => {
    if (!canWriteOrganizations) {
      messageApi.warning('无权限执行该操作');
      return;
    }
    if (!tenantId) return;
    const trimmed = name.trim();
    if (!trimmed) return;
    try {
      await apiPost(`/api/tenants/${tenantId}/organizations`, { name: trimmed, parentId });
      setAddingForParentId(null);
      fetchOrganizations(tenantId, true); // 强制刷新，跳过缓存
      messageApi.success('创建组织成功');
    } catch (e: any) {
      const msg = e?.message || '创建组织失败';
      messageApi.error(msg);
    }
  };

  // 提交创建用户：成功后关闭抽屉并刷新列表
  const handleUserSubmit = async (values: CreateTenantUserRequest) => {
    if (!canWriteTenantUsers) {
      messageApi.warning('无权限执行该操作');
      return;
    }
    if (!tenantId || !selectedOrg) return;
    try {
      await apiPost(`/api/tenants/${tenantId}/organizations/${selectedOrg.id}/users`, values);
      setUserDrawerOpen(false);
      userForm.resetFields();
      fetchUsers(tenantId, selectedOrg.id, true); // 强制刷新，跳过缓存
      messageApi.success('创建用户成功');
    } catch (e: any) {
      const msg = e?.message || '创建用户失败';
      messageApi.error(msg);
    }
  };

  const openRoleAssign = useCallback(async (user: TenantUser) => {
    if (!canReadRoleAssignments) {
      messageApi.warning('无权限执行该操作');
      return;
    }
    try {
      const rawData = await apiRequest(
        `/api/system/rbac/assignments?userType=tenant&userId=${encodeURIComponent(user.id)}`,
        { skipCache: true }
      );
      const rawList = Array.isArray(rawData) 
        ? rawData 
        : (Array.isArray((rawData as any)?.assignments) ? (rawData as any).assignments : []);
      // 归一化处理：确保 roleId 存在（兼容 role_id）
      const list: Assignment[] = rawList.map((it: any) => ({
        ...it,
        roleId: it.roleId || it.role_id
      }));
      // 初始化抽屉：
      // - roleAssignExisting：后端已存在的赋权记录（保存时用于差异计算）
      // - roleAssignSelected：以 roleId 初始化穿梭框右侧集合
      setRoleAssignUser(user);
      setRoleAssignExisting(list);
      setRoleAssignSelected(list.map(it => it.roleId));
      setRoleAssignOpen(true);
    } catch {}
  }, [canReadRoleAssignments, messageApi]);

  useEffect(() => {
    const run = async () => {
      if (!users.length) return;
      try {
        const resps = await Promise.all(users.map(u => 
          apiRequest(
            `/api/system/rbac/assignments?userType=tenant&userId=${encodeURIComponent(u.id)}`,
            { skipCache: true }
          ).catch(() => ({ assignments: [] }))
        ));
        const next: Record<string, Array<{ id: string; name: string }>> = {};
        users.forEach((u, i) => {
          const rawData = resps[i];
          const rawList = Array.isArray(rawData) 
            ? rawData 
            : (Array.isArray((rawData as any)?.assignments) ? (rawData as any).assignments : []);
          
          const list: Assignment[] = rawList.map((it: any) => ({
             ...it,
             roleId: it.roleId || it.role_id
          }));

          const details = list.map(it => {
            const rid = it.roleId;
            const match = tenantRoles.find(r => r.id === rid);
            return { id: rid, name: match ? match.name : rid };
          });
          next[u.id] = details;
        });
        setRolesByUser(next);
      } catch {}
    };
    run();
  }, [users, tenantRoles]);
  // 说明：
  // - 当用户集合或角色库变化时，重建“用户 → 角色名称映射”供表格展示
  // - 使用 Promise.all 并发请求以提升体验；失败时保持已有映射

  const saveRoleAssign = async () => {
    if (!canWriteRoleAssignments) {
      messageApi.warning('无权限执行该操作');
      return;
    }
    if (!roleAssignUser) return;
    const current = new Set(roleAssignExisting.map(x => x.roleId));
    const needAdd = roleAssignSelected.filter(id => !current.has(id));
    const needRemove = roleAssignExisting.filter(x => !roleAssignSelected.includes(x.roleId));
    // 差异保存：
    // - needAdd：新增的 roleId → POST /assignments
    // - needRemove：移除的记录（通过 assignmentId）→ DELETE /assignments/{id}
    try {
      for (const roleId of needAdd) {
        await apiPost('/api/system/rbac/assignments', { roleId, userType: 'tenant', userId: roleAssignUser.id });
      }
      for (const it of needRemove) {
        await apiDelete(`/api/system/rbac/assignments/${encodeURIComponent(it.id)}`);
      }
      modal.success({ title: '角色赋权已保存' });
      setRoleAssignOpen(false);
      setRoleAssignUser(null);
      setRoleAssignExisting([]);
      setRoleAssignSelected([]);
      if (tenantId && selectedOrg) {
        fetchUsers(tenantId, selectedOrg.id, true); // 强制刷新，确保角色信息更新
      }
    } catch (e: any) {
      const msg = e?.message || '保存角色赋权时发生错误';
      modal.error({ title: '保存失败', content: msg });
    }
  };

  const handleDeleteUser = useCallback(async (userId: string) => {
    if (!canWriteTenantUsers) {
      messageApi.warning('无权限执行该操作');
      return;
    }
    if (!tenantId || !selectedOrg) return;
    try {
      await apiDelete(`/api/tenants/${tenantId}/organizations/${selectedOrg.id}/users/${userId}`);
      fetchUsers(tenantId, selectedOrg.id, true); // 强制刷新，跳过缓存
      messageApi.success('删除用户成功');
    } catch (e: any) {
      const msg = e?.response?.data?.message || '删除用户失败';
      messageApi.error(msg);
    }
  }, [canWriteTenantUsers, tenantId, selectedOrg, messageApi]);
  // 删除用户：
  // - 依赖当前选中组织上下文；成功后刷新用户列表

  const openEditUser = useCallback(
    (user: TenantUser) => {
      if (!canWriteTenantUsers) {
        messageApi.warning('无权限执行该操作');
        return;
      }
      if (!tenantId || !selectedOrg?.id) {
        messageApi.error('缺少租户或组织上下文，无法编辑');
        return;
      }
      setEditTargetUserId(user.id);
      editUserForm.setFieldsValue({
        username: user.username,
        fullName: user.fullName,
        email: user.email,
        status: user.status,
        password: '',
      });
      setEditUserModalOpen(true);
    },
    [canWriteTenantUsers, tenantId, selectedOrg?.id, editUserForm, messageApi],
  );

  const handleEditUserSave = async () => {
    if (!canWriteTenantUsers) {
      messageApi.warning('无权限执行该操作');
      return;
    }
    if (!tenantId || !selectedOrg?.id || !editTargetUserId) {
      messageApi.error('无法保存：缺少租户、组织或用户');
      throw new Error('abort');
    }
    try {
      const values = await editUserForm.validateFields();
      const payload: { email: string; fullName: string; status: string; password?: string } = {
        email: values.email,
        fullName: values.fullName,
        status: values.status,
      };
      const pwd = String(values.password || '').trim();
      if (pwd) payload.password = pwd;
      await apiPut(`/api/tenants/${tenantId}/organizations/${selectedOrg.id}/users/${editTargetUserId}`, payload);
      messageApi.success('保存成功');
      setEditUserModalOpen(false);
      setEditTargetUserId(null);
      editUserForm.resetFields();
      fetchUsers(tenantId, selectedOrg.id, true);
    } catch (e: any) {
      if (e?.errorFields) return;
      messageApi.error(e?.response?.data?.message || e?.message || '保存失败');
      throw e;
    }
  };
  const handleResourcePoolAssign = async (values: any) => {
    if (!canWriteOrganizations) {
      messageApi.warning('无权限执行该操作');
      return;
    }
    if (!selectedOrg) return;
    try {
      const idsRaw = values.resourcePoolIds;
      const resourcePoolIds = Array.isArray(idsRaw) ? idsRaw.filter(Boolean) : (idsRaw ? [idsRaw] : []);
      const tenantNamespaceMode = values.tenantNamespaceMode === 'existing' ? 'existing' : 'auto';
      let existingTenantNamespace: string | undefined;
      if (tenantNamespaceMode === 'existing') {
        const raw = values.existingTenantNamespace;
        const arr = Array.isArray(raw)
          ? raw
          : raw != null && String(raw).trim()
            ? [String(raw).trim()]
            : [];
        existingTenantNamespace = arr[0]?.trim();
      }
      const payload: Record<string, unknown> = {
        resourcePoolIds,
        permissions: ['use'],
        tenantNamespaceMode,
      };
      if (tenantNamespaceMode === 'existing' && existingTenantNamespace) {
        payload.existingTenantNamespace = existingTenantNamespace;
      }
      // 分配资源池：
      // - resourcePoolIds：当前场景仅选一个池，数组保留兼容性
      // - permissions 固定为 ['use']（表示可用权限）
      // - tenantNamespaceMode / existingTenantNamespace：Harvester 类计算池下主命名空间派生方式（自动 ns-组织ID 或绑定已有）
      // 公共空间由集群 tower.io/scenario=public 标识，不再随分配写入固定 cloud-public/default
      const resp = (await apiPost(`/api/tenants/organizations/${selectedOrg.id}/resource-pools`, payload)) as {
        assignedCount?: number;
        skippedCount?: number;
        message?: string;
      };
      setResourcePoolDrawerOpen(false);
      resourcePoolForm.resetFields();
      fetchAssignments(selectedOrg.id);
      const hasCounts =
        resp &&
        typeof resp === 'object' &&
        'assignedCount' in resp &&
        'skippedCount' in resp;
      const assigned = Number((resp as { assignedCount?: unknown }).assignedCount);
      const skipped = Number((resp as { skippedCount?: unknown }).skippedCount);
      if (!hasCounts || Number.isNaN(assigned) || Number.isNaN(skipped)) {
        messageApi.warning(
          '请求已完成，但未返回 assignedCount/skippedCount。请升级并重启后端；或看浏览器「网络」里该接口响应体，并核对后端日志中的「SQLite 使用文件」是否为您正在查看的 data.sqlite。',
        );
      } else if (skipped > 0 && assigned === 0) {
        messageApi.warning(resp?.message || '所选资源池此前已绑定该组织，未新增记录');
      } else if (skipped > 0) {
        messageApi.success(`分配完成：新增 ${assigned}，已绑定跳过 ${skipped}`);
      } else {
        messageApi.success(resp?.message || '分配资源池成功');
      }
    } catch (e: any) {
      const msg = e?.response?.data?.message || '分配资源池失败';
      messageApi.error(msg);
    }
  };

  const handleRemoveAssignment = useCallback(async (poolId: string) => {
    if (!canWriteOrganizations) {
      messageApi.warning('无权限执行该操作');
      return;
    }
    if (!selectedOrg) return;
    try {
      await apiDelete(`/api/tenants/organizations/${selectedOrg.id}/resource-pools/${poolId}`);
      fetchAssignments(selectedOrg.id); // fetchAssignments 已经默认 skipCache
      message.success('移除分配成功');
    } catch (e: any) {
      // 优先使用 parseErrorResponse 处理后的完整错误消息（包含 message + error）
      // 注意：requestManager 会将解析后的数据保存在 e.responseData 中
      const responseData = e?.responseData || e?.response?.data || {};
      const errorMsg = e?.message || responseData?.message || '移除分配失败';
      const errorDetail = responseData?.error;
      const status = e?.status || e?.response?.status;
      const vms = responseData?.vms || [];
      const vmCount = responseData?.vmCount ?? vms.length;
      const volumes = responseData?.volumes || [];
      const volumeCount = responseData?.volumeCount ?? volumes.length;
      const containers = responseData?.containers || [];
      const containerCount = responseData?.containerCount ?? containers.length;
      const databases = responseData?.databases || [];
      const databaseCount = responseData?.databaseCount ?? databases.length;
      const vpcs = responseData?.vpcs || [];
      const vpcCount = responseData?.vpcCount ?? vpcs.length;
      
      // 对于 409（冲突）和 503（服务不可用）错误，使用 Modal 显示详细错误信息
      if (status === 409 || status === 503) {
        modal.error({
          title: '无法移除资源池分配',
          width: 760,
          content: (
            <RemoveAssignmentConflict
              errorMsg={errorMsg}
              errorDetail={errorDetail}
              vms={vms}
              vmCount={vmCount}
              containers={containers}
              containerCount={containerCount}
              databases={databases}
              databaseCount={databaseCount}
              vpcs={vpcs}
              vpcCount={vpcCount}
              volumes={volumes}
              volumeCount={volumeCount}
            />
          ),
        });
      } else {
        // 其他错误使用简单的 message 提示
        message.error(errorMsg);
      }
    }
  }, [canWriteOrganizations, selectedOrg, modal, messageApi]);

  useEffect(() => {
    if (!tenantId) return;
    fetchTenant(tenantId);
    fetchOrganizations(tenantId);
    fetchTenantRoles();
  }, [tenantId]);

  const fetchInternetworkRoutingDomains = useCallback(async () => {
    if (!selectedOrg?.id || !tenantId) {
      setInternetworkRoutingDomains([]);
      return;
    }
    try {
      setIrdLoading(true);
      const list = await listSecurityDomains({ roleKind: 'internetwork_routing' });
      const rows = (Array.isArray(list) ? list : []).filter((d: any) => {
        const tid = String(d?.tenantId || '').trim();
        const oid = String(d?.organizationId || '').trim();
        if (tid !== String(tenantId) || oid !== String(selectedOrg.id)) return false;
        const kind = d?.roleKind || inferRoleKindFromDomain(d);
        return kind === 'internetwork_routing';
      });
      setInternetworkRoutingDomains(rows);
    } catch {
      setInternetworkRoutingDomains([]);
    } finally {
      setIrdLoading(false);
    }
  }, [selectedOrg?.id, tenantId]);

  const filteredInternetworkRoutingDomains = useMemo(() => {
    const kw = irdKeyword.trim().toLowerCase();
    if (!kw) return internetworkRoutingDomains;
    return internetworkRoutingDomains.filter((d: any) => {
      const text = [
        d?.name,
        d?.category,
        formatCategoryLabel(d?.category),
        d?.provider,
        d?.region,
        d?.vpcId,
        d?.vrUuid,
        d?.vrName,
        d?.linkedCsmSecurityDomainId,
        d?.linkedCsmSecurityDomain?.name,
        d?.cidr,
        Array.isArray(d?.cidr4) ? d.cidr4.join(' ') : '',
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return text.includes(kw);
    });
  }, [internetworkRoutingDomains, irdKeyword]);

  const internetworkRoutingDomainColumns: ColumnsType<any> = useMemo(
    () => [
      {
        title: '名称',
        dataIndex: 'name',
        key: 'name',
        fixed: 'left',
        render: (text: string, record: any) => (
          <Typography.Link
            onClick={() => navigate(`/admin/sec-mgr-plane/security-domain/${record.id}`)}
          >
            {text || record.id || '—'}
          </Typography.Link>
        ),
      },
      {
        title: '类型',
        key: 'category',
        render: (_: unknown, r: any) => formatCategoryLabel(r?.category) || r?.category || '—',
      },
      {
        title: '云厂商 / 地域',
        key: 'providerRegion',
        render: (_: unknown, r: any) => {
          const txt = [r?.provider, r?.region].filter(Boolean).join(' / ');
          return txt || '—';
        },
      },
      {
        title: 'VPC / 网段',
        key: 'network',
        ellipsis: true,
        render: (_: unknown, r: any) => {
          if (r?.vpcId) return String(r.vpcId);
          const cidr4 = Array.isArray(r?.cidr4) && r.cidr4.length ? r.cidr4.join('，') : '';
          return cidr4 || r?.cidr || '—';
        },
      },
      {
        title: 'VR',
        key: 'vr',
        ellipsis: true,
        render: (_: unknown, r: any) => r?.vrName || r?.vrUuid || '—',
      },
      {
        title: '关联 CSM 安全域',
        key: 'csm',
        ellipsis: true,
        render: (_: unknown, r: any) =>
          r?.linkedCsmSecurityDomain?.name || r?.linkedCsmSecurityDomainId || '—',
      },
      {
        title: '状态',
        dataIndex: 'status',
        key: 'status',
        render: (v: string) => {
          const active = String(v || '').toLowerCase() === 'active';
          return (
            <span className={active ? 'std-badge std-badge-success' : 'std-badge std-badge-default'}>
              {active ? '启用' : v || '—'}
            </span>
          );
        },
      },
    ],
    [navigate],
  );

  useEffect(() => {
    if (!selectedOrg?.id) return;
    if (!tenantId) return;
    fetchUsers(tenantId, selectedOrg.id, true);
    fetchAssignments(selectedOrg.id);
    void fetchInternetworkRoutingDomains();
  }, [selectedOrg?.id, tenantId, fetchInternetworkRoutingDomains]);
  // 组织上下文变化后联动刷新：用户列表、资源池分配、网际路由域（只读）

  // 构造 Tree 组件数据：
  // - 支持在当前节点下插入“添加子组织”的内联行
  // - 支持内联重命名；通过 stopPropagation 避免影响树选中
  const buildTreeData = (orgs: Organization[]): DataNode[] => {
    const visited = new Set<string>();
    const recur = (list: Organization[]): DataNode[] => {
      return list.map(org => {
        if (visited.has(org.id)) return null;
        visited.add(org.id);
        const children = org.children ? recur(org.children) : [];
        if (canWriteOrganizations && addingForParentId === org.id) {
          children.push({
            key: `__new__-${org.id}`,
            title: (
              <InlineOrgAddChildRow
                onSave={(name) => handleAddChildSave(org.id, name)}
                onCancel={() => setAddingForParentId(null)}
              />
            ),
          });
        }
        return {
          key: org.id,
          title: (
            <div style={{ display: 'flex', alignItems: 'center', gap: 16, width: '100%' }}>
            {renameOrgId === org.id ? (
              <InlineOrgRenameRow
                initialName={org.name}
                onSave={(name) => handleOrgRename(org.id, name)}
                onCancel={() => setRenameOrgId(null)}
              />
            ) : (
              <Typography.Text style={{ pointerEvents: 'none' }}>{org.name}</Typography.Text>
            )}
            <div style={{ display: 'flex', alignItems: 'center', marginLeft: 'auto', justifyContent: 'flex-end' }}>
              {canWriteOrganizations && renameOrgId !== org.id ? (
                <Button
                  type="link"
                  size="small"
                  icon={<EditOutlined />}
                  onClick={(e) => { e.stopPropagation(); setRenameOrgId(org.id); }}
                >重命名</Button>
              ) : null}
              {canWriteOrganizations ? (
                <Button
                  type="link"
                  size="small"
                  icon={<PlusOutlined />}
                  disabled={org.level >= 4}
                  onClick={(e) => {
                    e.stopPropagation();
                    setExpandedKeys(prev => (prev.includes(org.id) ? prev : [...prev, org.id]));
                    setAddingForParentId(org.id);
                  }}
                >添加子组织</Button>
              ) : null}
              {canWriteOrganizations && org.level !== 1 && (
                <Button
                  type="link"
                  danger
                  size="small"
                  icon={<CloseOutlined />}
                  onClick={(e) => {
                    e.stopPropagation();
                    const confirmInstance = modal.confirm({
                      title: '确认删除组织',
                      content: '将删除该组织及其所有下级组织、关联用户与资源池分配。',
                      okText: '删除',
                      cancelText: '取消',
                      onOk: async () => {
                        try {
                          await apiDelete(`/api/tenants/organizations/${org.id}`);
                          messageApi.success('删除组织成功');
                          if (tenantId) fetchOrganizations(tenantId, true); // 强制刷新，跳过缓存
                        } catch (error: any) {
                          const errorMessage = error?.message || '删除组织失败';
                          const resources = error?.response?.data?.resources || [];
                          
                          // 关闭确认框
                          confirmInstance.destroy();
                          
                          // 如果是资源绑定错误，使用 Modal.error 显示详细信息
                          if (error?.response?.status === 409) {
                            modal.error({
                              title: '无法删除组织',
                              width: 500,
                              content: (
                                <DeleteOrgConflict errorMessage={errorMessage} resources={resources} />
                              ),
                            });
                          } else {
                            // 其他错误显示普通消息
                            messageApi.error(errorMessage);
                          }
                        }
                      }
                    });
                  }}
                >删除</Button>
              )}
            </div>
            </div>
          ),
          children,
        } as DataNode;
      }).filter(Boolean) as DataNode[];
    };
    return recur(orgs);
  };

  const userColumns: ColumnsType<TenantUser> = useMemo(() => [
    { title: '用户名', dataIndex: 'username', key: 'username' },
    { title: '角色', dataIndex: 'role', key: 'role', render: (_: any, row: TenantUser) => {
      // 仅展示 RBAC 分配角色（RoleAssignment），避免与 TenantUser.role 重复显示
      const assigned = rolesByUser[row.id] || [];
      if (assigned.length === 0) return <span style={{ color: '#999' }}>未分配</span>;
      return (
        <div style={{ display:'flex', gap:8, flexWrap:'wrap', alignItems:'center' }}>
          {assigned.map(it => (
            <span key={`${row.id}-${it.id}`} style={{ display:'inline-flex', alignItems:'center', gap:6 }}>
              <span className="std-badge std-badge-default">{formatRoleDisplayName(it.name)}</span>
              <Typography.Text copyable style={{ fontSize: 12 }}>{it.id}</Typography.Text>
            </span>
          ))}
        </div>
      );
    }},
    // 状态列：以徽章展示 active/inactive，提升可读性
    { title: '状态', dataIndex: 'status', key: 'status', render: (status: string) => (
      <span className={status === 'active' ? 'std-badge std-badge-success' : 'std-badge std-badge-error'}>{status === 'active' ? '活跃' : '非活跃'}</span>
    )},
    {
      title: '操作',
      key: 'action',
      render: (_: any, record: TenantUser) => {
        const items = filterMenuItemsForReadOnly(
          [
            { key: 'edit', label: '编辑' },
            ...(canReadRoleAssignments ? [{ key: 'assign', label: '配置角色' } as const] : []),
            { type: 'divider', key: 'divider-before-delete' },
            { key: 'delete', label: '删除', danger: true },
          ],
          canWriteTenantUsers,
        );
        if (!items.length) {
          return <Typography.Text type="secondary">—</Typography.Text>;
        }
        return (
          <Dropdown
            menu={{
              items,
              onClick: ({ key }) => {
                if (key === 'edit') {
                  openEditUser(record);
                } else if (key === 'assign') {
                  openRoleAssign(record);
                } else if (key === 'delete') {
                  modal.confirm({
                    title: '确认删除用户',
                    content: '删除后将无法恢复，该用户将无法继续访问系统。',
                    okText: '删除',
                    cancelText: '取消',
                    onOk: async () => { await handleDeleteUser(record.id); },
                  });
                }
              }
            }}
          >
            <Button type="link" size="small" icon={<EllipsisOutlined />} className="row-actions-trigger" />
          </Dropdown>
        );
      },
    }
  ], [rolesByUser, canReadRoleAssignments, canWriteTenantUsers, openRoleAssign, openEditUser, handleDeleteUser, modal]);

  const { displayColumns: userDisplayColumns } = useTableColumnSettings(userColumns, 'org_manage_users');

  // 资源池分配表格列：
  // - 类型/供应商列做 provider → 文本的归一化映射，提升可读性
  const assignmentColumns: ColumnsType<ResourcePoolAssignment> = useMemo(() => [
    { title: '资源池名称', dataIndex: ['cloud', 'name'], key: 'name' },
    { 
      title: '资源池类型', 
      key: 'poolType', 
      render: (_: any, record: ResourcePoolAssignment) => {
        const pvRaw = String((record.cloud as any)?.config?.provider || '').trim().toLowerCase();
        const label =
          (pvRaw === 'aliyun' || pvRaw === 'huaweicloud' || pvRaw === 'tencentcloud') ? '公有云' :
          (pvRaw === 'cloudmap.private') ? '私有云' :
          (pvRaw === 'cloudmap.edge') ? '边缘计算' :
          (pvRaw === 'harvester') ? '虚拟化' :
          ((record.cloud as any)?.type || '-');
        return <span className="std-badge std-badge-info">{label}</span>;
      }
    },
    { title: '命名空间', dataIndex: 'namespace', key: 'namespace', render: (ns: string) => (ns ? ns.split(',').map(n => <span className="std-badge std-badge-default" key={n}>{n.trim()}</span>) : <span>-</span>) },
    {
      title: '供应商',
      key: 'vendor',
      render: (_: any, record: ResourcePoolAssignment) => {
        const pv = String((record.cloud as any)?.config?.provider || (record.cloud as any)?.type || '').toLowerCase();
        const name = (
          (pv === 'aliyun' && '阿里云') ||
          (pv === 'huaweicloud' && '华为云') ||
          (pv === 'tencentcloud' && '腾讯云') ||
          (pv === 'harvester' && 'Harvester') ||
          (pv === 'cloudmap' && 'Cloudmap') ||
          ((record.cloud as any)?.config?.provider || (record.cloud as any)?.type || '-')
        );
        return <span className="std-badge std-badge-info">{name}</span>;
      }
    },
    {
      title: '操作',
      key: 'action',
      render: (_: any, record: ResourcePoolAssignment) => {
        if (!canWriteOrganizations) {
          return <Typography.Text type="secondary">—</Typography.Text>;
        }
        return (
          <Dropdown
            menu={{
              items: [{ key: 'remove', label: '移除', danger: true }],
              onClick: ({ key }) => {
                if (key === 'remove') {
                  modal.confirm({
                    title: '确认移除资源池分配',
                    content: '移除后，组织将不再拥有该资源池的关联权限。',
                    okText: '移除',
                    cancelText: '取消',
                    onOk: async () => { await handleRemoveAssignment(record.cloudId || (record.cloud as any)?.id); },
                  });
                }
              }
            }}
          >
            <Button type="link" size="small" icon={<EllipsisOutlined />} className="row-actions-trigger" />
          </Dropdown>
        );
      },
    },
  ], [canWriteOrganizations, handleRemoveAssignment, modal]);

  const { displayColumns: assignmentDisplayColumns } = useTableColumnSettings(assignmentColumns, 'org_manage_assignments');
  return {
    navigate,
    tenantId,
    canReadOrganizations,
    canWriteOrganizations,
    canReadTenantUsers,
    canWriteTenantUsers,
    canReadRoleAssignments,
    canWriteRoleAssignments,
    modal,
    contextHolder,
    messageApi,
    messageContextHolder,
    tenant,
    organizations,
    selectedOrg,
    setSelectedOrg,
    expandedKeys,
    setExpandedKeys,
    selectedKeys,
    setSelectedKeys,
    orgKeyword,
    setOrgKeyword,
    users,
    userKeyword,
    setUserKeyword,
    userStatusFilter,
    setUserStatusFilter,
    assignments,
    assignmentKeyword,
    setAssignmentKeyword,
    resourcePools,
    irdLoading,
    internetworkRoutingDomains,
    filteredInternetworkRoutingDomains,
    internetworkRoutingDomainColumns,
    irdKeyword,
    setIrdKeyword,
    fetchInternetworkRoutingDomains,
    userForm,
    editUserForm,
    resourcePoolForm,
    userDrawerOpen,
    setUserDrawerOpen,
    editUserModalOpen,
    setEditUserModalOpen,
    editTargetUserId,
    setEditTargetUserId,
    resourcePoolDrawerOpen,
    setResourcePoolDrawerOpen,
    assignType,
    setAssignType,
    storageKeyword,
    setStorageKeyword,
    securityKeyword,
    setSecurityKeyword,
    nsLoading,
    setNsLoading,
    nsOptions,
    setNsOptions,
    occupiedNamespaceNames,
    setOccupiedNamespaceNames,
    filteredAssignNsNames,
    tenantRoles,
    roleAssignOpen,
    setRoleAssignOpen,
    roleAssignUser,
    setRoleAssignUser,
    roleAssignSelected,
    setRoleAssignSelected,
    roleAssignExisting,
    setRoleAssignExisting,
    roleAssignKw,
    setRoleAssignKw,
    selectedUserRowKeys,
    setSelectedUserRowKeys,
    assignableResourcePools,
    fetchOrganizations,
    fetchUsers,
    fetchAssignments,
    fetchResourcePools,
    handleUserSubmit,
    handleEditUserSave,
    handleResourcePoolAssign,
    saveRoleAssign,
    buildTreeData,
    userColumns,
    userDisplayColumns,
    assignmentColumns,
    assignmentDisplayColumns,
  };
}

export type OrgManagePageVm = ReturnType<typeof useOrgManagePage>;

