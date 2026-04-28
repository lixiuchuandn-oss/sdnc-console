// 页面说明：
// 组织管理页（租户上下文），提供以下能力：
// 1）左侧组织树：支持搜索、重命名、添加子组织、删除组织等操作；
// 2）右侧标签页：
//    - 用户管理：支持检索、创建用户、编辑用户信息、为用户分配角色、批量删除；
//    - 计算/存储/安全资源分配：按组织维度分配资源池，支持筛选与移除分配；
//    - 安全域相关：展示防护对象与服务链（简要概览）；
// 3）顶部概览卡片：展示租户ID、组织ID、数量统计等信息；
// 数据来源统一通过后端接口（axios）获取，并在切换组织/租户时刷新。
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Alert,
  Button,
  Card,
  Col,
  Radio,
  Descriptions,
  Dropdown,
  Form,
  Input,
  message,
  Modal,
  Row,
  Select,
  Space,
  Table,
  Tag,
  Tabs,
  Tooltip,
  Transfer,
  Tree,
  Typography,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import type { DataNode } from 'antd/es/tree';
import {
  CheckOutlined,
  CloseOutlined,
  ClusterOutlined,
  EditOutlined,
  EllipsisOutlined,
  GatewayOutlined,
  NodeIndexOutlined,
  PlusOutlined,
  ReloadOutlined,
  SafetyCertificateOutlined,
  SearchOutlined,
} from '@ant-design/icons';

import PageDetailContainer from '../../../components/PageDetailContainer';
import StdSideDrawer from '../../../components/StdSideDrawer';
import TableColumnSettingsButton from '../../../components/TableColumnSettingsButton';
import { useTableColumnSettings } from '../../../hooks/useTableColumnSettings';
import { apiDelete, apiPatch, apiPost, apiPut, apiRequest } from '../../../services/api';
import { fetchProtectionObjects, fetchServiceChains } from '../../../services/trafficOrchestration';
import { fetchVrCachePageList } from '../../../services/virtualRouterApi';
import {
  CreateTenantUserRequest,
  Organization,
  ResourcePoolAssignment,
  Tenant,
  TenantUser,
} from '../../../types/tenant';

// RBAC 角色模型：名称、范围（system/tenant）、状态等
type RBACRole = { id: string; name: string; description?: string; scope: 'system' | 'tenant'; status?: 'active' | 'inactive' };
// 角色赋权记录：某用户在某范围下被赋予某角色
type Assignment = { id: string; roleId: string; userType: 'system' | 'tenant'; userId: string; createdAt: string };

/** 平台预置租户级 RBAC 策略全名（与 backend/constants/rbacBuiltInRoles、seeders/initRoles 同步） */
const RBAC_BUILTIN_TENANT_ROLE_NAMES = new Set([
  '云租户根用户',
  '三权-审计管理员',
  '三权-安全管理员',
  '三权-系统管理员',
]);

/** 租户用户表单里可能出现的占位/简写角色名（非 RBAC 策略全名时） */
const TENANT_USER_ROLE_LABEL_FALLBACK: Record<string, string> = {
  admin: '管理员',
  user: '用户',
  viewer: '查看者',
};

function formatRoleDisplayName(name: string | undefined): string {
  if (!name) return '';
  if (RBAC_BUILTIN_TENANT_ROLE_NAMES.has(name)) return name;
  return TENANT_USER_ROLE_LABEL_FALLBACK[name] || name;
}

// --- 资源池 / 分配记录：provider 与 Tab 归类（与后端 Cloud.config.provider 对齐）---

function getCloudPoolProviderRaw(pool: { config?: { provider?: string }; type?: string } | null | undefined): string {
  return String(pool?.config?.provider ?? pool?.type ?? '').trim().toLowerCase();
}

/** 界面展示用（保留大小写，与配置一致） */
function getCloudPoolDisplayProvider(pool: { config?: { provider?: string }; type?: string } | null | undefined): string {
  if (!pool) return '';
  return String(pool.config?.provider || pool.type || '-');
}

const HARVESTER_LIKE_OPERATORS = new Set(['harvester', 'cloudmap', 'cloudmap.private', 'cloudmap.edge']);

function isHarvesterLikeOperator(pvRaw: string): boolean {
  return HARVESTER_LIKE_OPERATORS.has(pvRaw);
}

/** 分配抽屉内「计算 / 存储 / 安全」Tab 与可选资源池列表一致 */
function poolMatchesAssignDrawerTab(
  pool: { config?: { provider?: string }; type?: string },
  tab: 'compute' | 'storage' | 'security',
): boolean {
  const pvRaw = getCloudPoolProviderRaw(pool);
  const typeLower = String(pool?.type ?? '').toLowerCase();
  const isSecurity = pvRaw === 'cloudmap.csm';
  const isStorage = typeLower === 'object_storage' || typeLower === 'file_storage';
  if (tab === 'security') return isSecurity;
  if (tab === 'storage') return isStorage;
  return !isSecurity && !isStorage;
}

type AssignableCloudShape = { config?: { provider?: string }; type?: string };

/** 分配记录上的 cloud 与「可分配资源池」同类判定，避免重复维护 isSecurity/isStorage 规则 */
function assignmentMatchesAssignTab(
  a: ResourcePoolAssignment,
  tab: 'compute' | 'storage' | 'security',
): boolean {
  return poolMatchesAssignDrawerTab((a.cloud as AssignableCloudShape) ?? {}, tab);
}

function assignmentMatchesKeyword(a: ResourcePoolAssignment, keyword: string): boolean {
  const k = keyword.trim().toLowerCase();
  if (!k) return true;
  const c = a.cloud as { name?: string; type?: string; config?: { provider?: string } } | undefined;
  const name = String(c?.name ?? '').toLowerCase();
  const type = String(c?.type ?? '').toLowerCase();
  const provider = String(c?.config?.provider ?? '').toLowerCase();
  return name.includes(k) || type.includes(k) || provider.includes(k);
}

const OrgManagePage: React.FC = () => {
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
  const [securityLoading, setSecurityLoading] = useState(false);
  const [protectionObjects, setProtectionObjects] = useState<any[]>([]);
  const [securityChains, setSecurityChains] = useState<any[]>([]);
  // SDN/VR 相关展示状态
  const [sdnVrLoading, setSdnVrLoading] = useState(false);
  const [sdnVrs, setSdnVrs] = useState<any[]>([]);
  // 说明：
  // - resourcePools：抽屉“分配资源池”的候选集合（由 fetchResourcePools 获取）
  // - sdnVrLoading/sdnVrs：安全域页签“SDN/VR”的加载状态与数据集合
  // 组织树内联编辑/新增相关状态
  const [renameOrgId, setRenameOrgId] = useState<string | null>(null);
  const [renameName, setRenameName] = useState<string>('');
  const [addingForParentId, setAddingForParentId] = useState<string | null>(null);
  const [newChildName, setNewChildName] = useState<string>('');
  // 组织树内联编辑说明：
  // - renameOrgId/renameName：重命名的目标组织与输入值
  // - addingForParentId/newChildName：在父组织下添加子组织的内联行与名称

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
  /** 分配抽屉「目标命名空间」：排除公共空间 + 已被其他组织绑定 */
  const filteredAssignNsNames = useMemo(() => {
    const occupied = new Set(
      (occupiedNamespaceNames || []).map((n) => String(n || '').trim()).filter(Boolean),
    );
    return (nsOptions || [])
      .filter((x: any) => {
        const sc = String(x?.metadata?.labels?.['tower.io/scenario'] || '').toLowerCase();
        return sc !== 'public' && sc !== 'admin';
      })
      .map((x: any) => x?.metadata?.name || x?.name)
      .map((n: string | undefined) => String(n || '').trim())
      .filter((n: string): n is string => n.length > 0 && !occupied.has(n));
  }, [nsOptions, occupiedNamespaceNames]);
  // 分配资源池模式说明：
  // - assignType：计算/存储/安全三类，用于候选池过滤与文案切换
  // - storageKeyword/securityKeyword：对应页签的本地过滤关键字
  // - nsLoading/nsOptions：按 provider 条件联动加载命名空间（Harvester/CloudMap 私有/边缘）
  // 安全域标签页切换与内容淡入动画
  const [sdnActiveKey, setSdnActiveKey] = useState<'vr'|'objects'|'chains'>('vr');
  const [sdnContentOpacity, setSdnContentOpacity] = useState<number>(1);
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
    try {
      await apiPatch(`/api/tenants/organizations/${orgId}`, { name });
      setRenameOrgId(null);
      setRenameName('');
      if (tenantId) fetchOrganizations(tenantId, true); // 强制刷新，跳过缓存
      messageApi.success('重命名成功');
    } catch (e: any) {
      const msg = e?.message || '重命名失败';
      messageApi.error(msg);
    }
  };

  // 添加子组织保存：校验名称、调用创建接口、刷新组织树
  const handleAddChildSave = async (parentId: string) => {
    if (!tenantId) return;
    const name = newChildName.trim();
    if (!name) return;
    try {
      await apiPost(`/api/tenants/${tenantId}/organizations`, { name, parentId });
      setAddingForParentId(null);
      setNewChildName('');
      fetchOrganizations(tenantId, true); // 强制刷新，跳过缓存
      messageApi.success('创建组织成功');
    } catch (e: any) {
      const msg = e?.message || '创建组织失败';
      messageApi.error(msg);
    }
  };

  // 提交创建用户：成功后关闭抽屉并刷新列表
  const handleUserSubmit = async (values: CreateTenantUserRequest) => {
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
  }, []);

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
    if (!tenantId || !selectedOrg) return;
    try {
      await apiDelete(`/api/tenants/${tenantId}/organizations/${selectedOrg.id}/users/${userId}`);
      fetchUsers(tenantId, selectedOrg.id, true); // 强制刷新，跳过缓存
      messageApi.success('删除用户成功');
    } catch (e: any) {
      const msg = e?.response?.data?.message || '删除用户失败';
      messageApi.error(msg);
    }
  }, [tenantId, selectedOrg, messageApi]);
  // 删除用户：
  // - 依赖当前选中组织上下文；成功后刷新用户列表

  const openEditUser = useCallback(
    (user: TenantUser) => {
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
    [tenantId, selectedOrg?.id, editUserForm, messageApi],
  );

  const handleEditUserSave = async () => {
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
      const vmCount = responseData?.vmCount || 0;
      const volumes = responseData?.volumes || [];
      const volumeCount = responseData?.volumeCount || 0;
      
      // 对于 409（冲突）和 503（服务不可用）错误，使用 Modal 显示详细错误信息
      if (status === 409 || status === 503) {
        modal.error({
          title: '无法移除资源池分配',
          width: 700,
          content: (
            <div style={{ marginTop: 16 }}>
              <p style={{ marginBottom: 16, color: '#ff4d4f' }}>
                {errorMsg}
              </p>
              {errorDetail && (
                <p style={{ marginBottom: 16, color: '#8c8c8c', fontSize: 12 }}>
                  {errorDetail}
                </p>
              )}
              {vms.length > 0 && (
                <div style={{ marginBottom: 16 }}>
                  <div style={{ marginBottom: 8, fontWeight: 500 }}>存在的虚拟机资源（{vmCount}个）：</div>
                  <div style={{ maxHeight: 200, overflowY: 'auto', border: '1px solid #f0f0f0', borderRadius: 4, padding: 8 }}>
                    <Table
                      size="small"
                      dataSource={vms}
                      columns={[
                        { title: '虚拟机名称', dataIndex: 'name', key: 'name', width: 200 },
                        { title: '命名空间', dataIndex: 'namespace', key: 'namespace', width: 150 },
                        { title: '状态', dataIndex: 'status', key: 'status', width: 100 },
                      ]}
                      pagination={false}
                      rowKey={(record: any) => `vm-${record.namespace}/${record.name}`}
                    />
                  </div>
                </div>
              )}
              {volumes.length > 0 && (
                <div style={{ marginBottom: 16 }}>
                  <div style={{ marginBottom: 8, fontWeight: 500 }}>存在的虚拟卷资源（{volumeCount}个）：</div>
                  <div style={{ maxHeight: 200, overflowY: 'auto', border: '1px solid #f0f0f0', borderRadius: 4, padding: 8 }}>
                    <Table
                      size="small"
                      dataSource={volumes}
                      columns={[
                        { title: '虚拟卷名称', dataIndex: 'name', key: 'name', width: 200 },
                        { title: '命名空间', dataIndex: 'namespace', key: 'namespace', width: 150 },
                        { title: '状态', dataIndex: 'status', key: 'status', width: 100 },
                        { title: '大小', dataIndex: 'size', key: 'size', width: 100 },
                      ]}
                      pagination={false}
                      rowKey={(record: any) => `vol-${record.namespace}/${record.name}`}
                    />
                  </div>
                </div>
              )}
            </div>
          ),
        });
      } else {
        // 其他错误使用简单的 message 提示
        message.error(errorMsg);
      }
    }
  }, [selectedOrg, modal]);

  useEffect(() => {
    if (!tenantId) return;
    fetchTenant(tenantId);
    fetchOrganizations(tenantId);
    fetchTenantRoles();
  }, [tenantId]);

  const fetchSdnVrs = useCallback(async () => {
    if (!selectedOrg?.id || !tenantId) return;
    try {
      setSdnVrLoading(true);
      const res = await fetchVrCachePageList(1000, 1);
      const data = res?.data || res;
      let items: any[] = [];
      
      if (data && Array.isArray(data.page)) {
          items = data.page;
      } else if (data && Array.isArray(data.list)) {
          items = data.list;
      } else if (Array.isArray(data)) {
          items = data;
      }

      // Filter by tenantId and organizationId
      items = items.filter((item: any) => {
        const tid = String(item.tenant_id || item.tenantId || '');
        const oid = String(item.org_id || item.organizationId || '');
        return tid === String(tenantId) && oid === String(selectedOrg.id);
      });

      setSdnVrs(items);
    } catch {
      setSdnVrs([]);
    } finally {
      setSdnVrLoading(false);
    }
  }, [selectedOrg?.id, tenantId]);

  // SDN/VR 数据归一化与过滤：
  // - 兼容 { page: [] } / { list: [] } / [] 三类返回结构
  // - 仅保留与当前租户/组织匹配的 VR 项

  useEffect(() => {
    if (!selectedOrg?.id) return;
    if (!tenantId) return;
    fetchUsers(tenantId, selectedOrg.id);
    fetchAssignments(selectedOrg.id);
    (async () => {
      try {
        setSecurityLoading(true);
        const [objs, chains] = await Promise.all([
          fetchProtectionObjects({ organizationId: selectedOrg.id }),
          fetchServiceChains({ organizationId: selectedOrg.id }),
        ]);
        setProtectionObjects(Array.isArray(objs) ? objs : (objs?.data || []));
        setSecurityChains(Array.isArray(chains) ? chains : (chains?.data || []));
      } catch {
        setProtectionObjects([]);
        setSecurityChains([]);
      } finally {
        setSecurityLoading(false);
      }
    })();
    fetchSdnVrs();
  }, [selectedOrg?.id, tenantId, fetchSdnVrs]);
  // 组织上下文变化后联动刷新：
  // - 用户列表、资源池分配、防护对象、服务链、SDN/VR
  // - 失败时回落为空集合并结束加载态

  useEffect(() => {
    setSdnContentOpacity(0);
    const t = setTimeout(() => setSdnContentOpacity(1), 0);
    return () => clearTimeout(t);
  }, [sdnActiveKey, selectedOrg?.id]);

  // --- 纯函数与表格列（依赖组件状态）---
  const filterOrgs = (orgs: Organization[], keyword: string): Organization[] => {
    const kw = keyword.trim().toLowerCase();
    if (!kw) return orgs;
    const visited = new Set<string>();
    const recur = (list: Organization[]): Organization[] => {
      const out: Organization[] = [];
      for (const org of list) {
        if (visited.has(org.id)) continue;
        visited.add(org.id);
        const children = org.children ? recur(org.children) : [];
        const selfMatch = org.name.toLowerCase().includes(kw);
        if (selfMatch || children.length) {
          out.push({ ...org, children });
        }
      }
      return out;
    };
    return recur(orgs);
  };
  // 组织树本地过滤：
  // - 子节点命中时保留父节点以维持结构；visited 防止重复处理

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
        if (addingForParentId === org.id) {
          children.push({
            key: `__new__-${org.id}`,
            title: (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <Input
                  size="small"
                  value={newChildName}
                  onChange={(e) => setNewChildName(e.target.value)}
                  placeholder="请输入组织名称"
                  style={{ width: 200 }}
                />
                <Button
                  type="link"
                  size="small"
                  icon={<CheckOutlined />}
                  disabled={!newChildName.trim()}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleAddChildSave(org.id);
                  }}
                >
                  保存
                </Button>
                <Button
                  type="link"
                  size="small"
                  icon={<CloseOutlined />}
                  onClick={(e) => {
                    e.stopPropagation();
                    setAddingForParentId(null);
                    setNewChildName('');
                  }}
                >
                  取消
                </Button>
              </div>
            ),
          });
        }
        return {
          key: org.id,
          title: (
            <div style={{ display: 'flex', alignItems: 'center', gap: 16, width: '100%' }}>
            {renameOrgId === org.id ? (
              <Input
                size="small"
                value={renameName}
                onChange={(e) => setRenameName(e.target.value)}
                style={{ width: 180 }}
              />
            ) : (
              <Typography.Text style={{ pointerEvents: 'none' }}>{org.name}</Typography.Text>
            )}
            <div style={{ display: 'flex', alignItems: 'center', marginLeft: 'auto', justifyContent: 'flex-end' }}>
              {renameOrgId === org.id ? (
                <>
                  <Button
                    type="link"
                    size="small"
                    icon={<CheckOutlined />}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (!renameName.trim()) return;
                      handleOrgRename(org.id, renameName.trim());
                    }}
                  >保存</Button>
                  <Button
                    type="link"
                    size="small"
                    icon={<CloseOutlined />}
                    onClick={(e) => { e.stopPropagation(); setRenameOrgId(null); setRenameName(''); }}
                  >取消</Button>
                </>
              ) : (
                <Button
                  type="link"
                  size="small"
                  icon={<EditOutlined />}
                  onClick={(e) => { e.stopPropagation(); setRenameOrgId(org.id); setRenameName(org.name); }}
                >重命名</Button>
              )}
              <Button
                type="link"
                size="small"
                icon={<PlusOutlined />}
                disabled={org.level >= 4}
                onClick={(e) => {
                  e.stopPropagation();
                  setExpandedKeys(prev => (prev.includes(org.id) ? prev : [...prev, org.id]));
                  setAddingForParentId(org.id);
                  setNewChildName('');
                }}
              >添加子组织</Button>
              {org.level !== 1 && (
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
                                <div style={{ marginTop: 16 }}>
                                  <p style={{ marginBottom: 16, color: '#ff4d4f' }}>
                                    {errorMessage}
                                  </p>
                                  
                                  {resources.length > 0 && (
                                    <div style={{ marginBottom: 16 }}>
                                      <div style={{ marginBottom: 8, fontWeight: 500 }}>关联资源：</div>
                                      <ul style={{ margin: 0, paddingLeft: 20 }}>
                                        {resources.map((r: any, index: number) => (
                                          <li key={index} style={{ marginBottom: 4 }}>
                                            {r.name} ({r.count}个)
                                          </li>
                                        ))}
                                      </ul>
                                    </div>
                                  )}

                                  <p style={{ margin: 0, color: '#8c8c8c', fontSize: 12 }}>
                                    请先解除上述资源绑定后再尝试删除组织。
                                  </p>
                                </div>
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
      render: (_: any, record: TenantUser) => (
        <Dropdown
          menu={{
            items: [
              { key: 'edit', label: '编辑' },
              { key: 'assign', label: '配置角色' },
              { key: 'delete', label: '删除', danger: true }
            ],
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
      ),
    }
  ], [rolesByUser, openRoleAssign, openEditUser, handleDeleteUser, modal]);

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
      render: (_: any, record: ResourcePoolAssignment) => (
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
      ),
    },
  ], [handleRemoveAssignment, modal]);

  const { displayColumns: assignmentDisplayColumns } = useTableColumnSettings(assignmentColumns, 'org_manage_assignments');

  return (
    <PageDetailContainer
      icon={<ClusterOutlined />}
      subtitle="集中管理租户组织架构信息，提供用户与资源池的生命周期管理能力"
      overviewContent={
        <Descriptions bordered size="small" column={4}>
          <Descriptions.Item label="租户ID"><Typography.Text copyable>{tenant?.id || '-'}</Typography.Text></Descriptions.Item>
          <Descriptions.Item label="租户名称">{tenant?.name || '-'}</Descriptions.Item>
          <Descriptions.Item label="组织ID"><Typography.Text copyable>{selectedOrg?.id || '-'}</Typography.Text></Descriptions.Item>
          <Descriptions.Item label="组织名称">{selectedOrg?.name || '-'}</Descriptions.Item>
          <Descriptions.Item label="用户数量">{users.length}</Descriptions.Item>
          <Descriptions.Item label="资源池数量">{assignments.length}</Descriptions.Item>
          <Descriptions.Item label="安全资源池">
            {assignments.filter((a) => assignmentMatchesAssignTab(a, 'security')).length}
          </Descriptions.Item>
          <Descriptions.Item label="防护对象数量">{protectionObjects.length}</Descriptions.Item>
          <Descriptions.Item label="服务链数量">{securityChains.length}</Descriptions.Item>
        </Descriptions>
      }
      defaultOverviewCollapsed={false}
      onBack={() => navigate('/admin/tenants')}
      asCard={false}
    >
      {contextHolder}
      {messageContextHolder}
      {organizations.length > 0 ? (
        <Row gutter={[16,16]}>
          <Col span={8}>
            <Card size="small" title="组织架构" styles={{ body: { padding: 0 } }}>
              <div style={{ padding: 12, borderBottom: '1px solid #f0f0f0', background: '#fafafa' }}>
                <Input
                  allowClear
                  placeholder="搜索组织名称"
                  value={orgKeyword}
                  onChange={(e)=> setOrgKeyword(e.target.value)}
                  suffix={<SearchOutlined />}
                />
              </div>
              <div style={{ maxHeight: '70vh', overflow: 'auto', padding: 12 }}>
                <Tree
                  showLine={{ showLeafIcon: false }}
                  defaultExpandAll
                  expandedKeys={expandedKeys}
                  onExpand={(keys)=> setExpandedKeys(keys as string[])}
                  selectedKeys={selectedKeys}
                  treeData={buildTreeData(filterOrgs(organizations, orgKeyword))}
                  onSelect={(keys) => {
                    if (keys.length > 0) {
                      const findOrg = (orgs: Organization[], id: string): Organization | null => {
                        for (const org of orgs) {
                          if (org.id === id) return org;
                          if (org.children) {
                            const found = findOrg(org.children, id);
                            if (found) return found;
                          }
                        }
                        return null;
                      };
                      const org = findOrg(organizations, keys[0] as string);
                      if (org) {
                        setSelectedKeys([org.id]);
                        setSelectedOrg(org);
                      }
                    }
                  }}
                />
              </div>
            </Card>
          </Col>
          <Col span={16}>
            <Card size="small" title="组织管理" styles={{ body: { padding: 12 } }}>
            <Tabs defaultActiveKey="users">
              <Tabs.TabPane tab="用户管理" key="users">
                {selectedOrg ? (
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
                      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
                        <Input
                          allowClear
                          placeholder="搜索用户关键字"
                          value={userKeyword}
                          className="toolbar-search"
                          onChange={(e) => setUserKeyword(e.target.value)}
                          suffix={<SearchOutlined />}
                        />
                        <Select
                          allowClear
                          placeholder="选择状态"
                          className="toolbar-filter-sm"
                          value={userStatusFilter}
                          options={[
                            { label: '活跃', value: 'active' },
                            { label: '非活跃', value: 'inactive' },
                          ]}
                          onChange={(v) => setUserStatusFilter(v)}
                        />
                      </div>

                      <div className="toolbar-actions" style={{ display: 'flex', gap: 8 }}>
                        <Button 
                          type="primary" 
                          onClick={() => {
                            userForm.resetFields();
                            const rand = `user-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,6)}`;
                            userForm.setFieldsValue({ organizationId: selectedOrg?.id, username: rand });
                            setUserDrawerOpen(true);
                          }}
                        >添加用户</Button>
                        <TableColumnSettingsButton allColumns={userColumns} settingsKey="org_manage_users" />
                        <Dropdown
                          menu={{
                            items: [
                              { key: 'batchDelete', label: '批量删除', danger: true, disabled: selectedUserRowKeys.length === 0 },
                            ],
                            onClick: ({ key }) => {
                              if (key === 'batchDelete') {
                                modal.confirm({
                                  title: '确认批量删除用户',
                                  content: '删除后将无法恢复，这些用户将无法继续访问系统。',
                                  okText: '删除',
                                  cancelText: '取消',
                                  onOk: async () => { 
                                    if (!tenantId || !selectedOrg) return;
                                    try {
                                      await Promise.all(selectedUserRowKeys.map(id => 
                                        apiDelete(`/api/tenants/${tenantId}/organizations/${selectedOrg.id}/users/${id}`)
                                      ));
                                      messageApi.success('批量删除成功');
                                      setSelectedUserRowKeys([]);
                                      fetchUsers(tenantId, selectedOrg.id, true); // 强制刷新，跳过缓存
                                    } catch (e: any) {
                                      messageApi.error(e?.message || '批量删除失败');
                                    }
                                  },
                                });
                              }
                            }
                          }}
                        >
                          <Button icon={<EllipsisOutlined />} />
                        </Dropdown>
                        <Tooltip title="刷新列表">
                          <Button 
                            icon={<ReloadOutlined />} 
                            onClick={() => {
                              if (tenantId && selectedOrg) {
                                fetchUsers(tenantId, selectedOrg.id, true);
                              }
                            }} 
                          />
                        </Tooltip>
                      </div>
                    </div>
                    <Table
                      columns={userDisplayColumns}
                      rowSelection={{ selectedRowKeys: selectedUserRowKeys, onChange: (keys)=> setSelectedUserRowKeys(keys as string[]) }}
                      dataSource={users.filter((u) => {
                        if (userStatusFilter && u.status !== userStatusFilter) return false;
                        if (!userKeyword.trim()) return true;
                        const kw = userKeyword.trim().toLowerCase();
                        return (
                          (u.username || '').toLowerCase().includes(kw) ||
                          (u.fullName || '').toLowerCase().includes(kw) ||
                          (u.email || '').toLowerCase().includes(kw)
                        );
                      })}
                      className="std-table"
                      rowKey="id"
                      pagination={{
                        size: 'small',
                        showTotal: (total) => `共 ${total} 条`,
                      }}
                      size="small"
                      bordered={false}
                    />
                  </div>
                ) : (
                  <div style={{ textAlign: 'center', padding: 40, color: '#999' }}>请先在左侧选择一个组织</div>
                )}
              </Tabs.TabPane>
              <Tabs.TabPane tab="计算资源分配" key="assign">
                {selectedOrg ? (
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
                        <Input
                          allowClear
                          placeholder="搜索资源池名称"
                          style={{ width: 240 }}
                          suffix={<SearchOutlined />}
                          value={assignmentKeyword}
                          onChange={(e)=> setAssignmentKeyword(e.target.value)}
                        />
                        <div style={{ display: 'flex', gap: 8 }}>

                          <Button 
                            type="primary" 
                            onClick={() => {
                              fetchResourcePools();
                              resourcePoolForm.resetFields();
                              setAssignType('compute');
                              setResourcePoolDrawerOpen(true);
                            }}
                          >分配计算资源池</Button>
                          <TableColumnSettingsButton allColumns={assignmentColumns} settingsKey="org_manage_assignments" />
                          <Tooltip title="刷新列表">
                            <Button 
                              icon={<ReloadOutlined />} 
                              onClick={() => {
                                if (selectedOrg) {
                                  fetchAssignments(selectedOrg.id);
                                }
                              }} 
                            />
                          </Tooltip>
                        </div>
                    </div>
                    <Table
                      columns={assignmentDisplayColumns}
                      dataSource={
                        assignmentKeyword.trim()
                          ? assignments.filter((a) => assignmentMatchesKeyword(a, assignmentKeyword))
                          : assignments.filter((a) => assignmentMatchesAssignTab(a, 'compute'))
                      }
                      className="std-table"
                      rowKey="id"
                      pagination={{
                        size: 'small',
                        showTotal: (total) => `共 ${total} 条`,
                      }}
                      size="small"
                      bordered={false}
                    />
                  </div>
                ) : (
                  <div style={{ textAlign: 'center', padding: 40, color: '#999' }}>请先在左侧选择一个组织</div>
                )}
              </Tabs.TabPane>
              <Tabs.TabPane tab="存储资源分配" key="storage">
                {selectedOrg ? (
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
                        <Input
                          allowClear
                          placeholder="搜索资源池关键字"
                          style={{ width: 240 }}
                          value={storageKeyword}
                          onChange={(e)=> setStorageKeyword(e.target.value)}
                        />
                        <div style={{ display: 'flex', gap: 8 }}>
                          <Tooltip title="刷新列表">
                            <Button 
                              icon={<ReloadOutlined />} 
                              onClick={() => {
                                if (selectedOrg) {
                                  fetchAssignments(selectedOrg.id);
                                }
                              }} 
                            />
                          </Tooltip>
                          <Button 
                            type="primary" 
                            onClick={() => {
                              fetchResourcePools();
                              resourcePoolForm.resetFields();
                              setAssignType('storage');
                              setResourcePoolDrawerOpen(true);
                            }}
                         >分配存储资源池</Button>
                        </div>
                    </div>
                    <Table
                      columns={assignmentColumns}
                      dataSource={
                        storageKeyword.trim()
                          ? assignments.filter(
                              (a) =>
                                assignmentMatchesAssignTab(a, 'storage') && assignmentMatchesKeyword(a, storageKeyword),
                            )
                          : assignments.filter((a) => assignmentMatchesAssignTab(a, 'storage'))
                      }
                      className="std-table"
                      rowKey="id"
                      pagination={{
                        size: 'small',
                        showTotal: (total) => `共 ${total} 条`,
                      }}
                      size="small"
                      bordered={false}
                    />
                  </div>
                ) : (
                  <div style={{ textAlign: 'center', padding: 40, color: '#999' }}>请先在左侧选择一个组织</div>
                )}
              </Tabs.TabPane>
              <Tabs.TabPane tab="安全资源分配" key="cloud-security">
                {selectedOrg ? (
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
                        <Input
                          allowClear
                          placeholder="搜索资源池关键字"
                          style={{ width: 240 }}
                          value={securityKeyword}
                          onChange={(e)=> setSecurityKeyword(e.target.value)}
                        />
                        <div style={{ display: 'flex', gap: 8 }}>
                          <Tooltip title="刷新列表">
                            <Button 
                              icon={<ReloadOutlined />} 
                              onClick={() => {
                                if (selectedOrg) {
                                  fetchAssignments(selectedOrg.id);
                                }
                              }} 
                            />
                          </Tooltip>
                          <Button
                            type="primary"
                            onClick={() => {
                              fetchResourcePools();
                              resourcePoolForm.resetFields();
                              setAssignType('security');
                              setResourcePoolDrawerOpen(true);
                            }}
                          >分配安全资源池</Button>
                        </div>
                    </div>
                    <Table
                      columns={assignmentColumns}
                      dataSource={
                        securityKeyword.trim()
                          ? assignments.filter(
                              (a) =>
                                assignmentMatchesAssignTab(a, 'security') && assignmentMatchesKeyword(a, securityKeyword),
                            )
                          : assignments.filter((a) => assignmentMatchesAssignTab(a, 'security'))
                      }
                      className="std-table"
                      rowKey="id"
                      pagination={{
                        size: 'small',
                        showTotal: (total) => `共 ${total} 条`,
                      }}
                      size="small"
                      bordered={false}
                    />
                  </div>
                ) : (
                  <div style={{ textAlign: 'center', padding: 40, color: '#999' }}>请先在左侧选择一个组织</div>
                )}
              </Tabs.TabPane>
              <Tabs.TabPane tab="SDN资源" key="sdn-resources">
                {selectedOrg ? (
                  <div style={{ display: 'flex', minHeight: 260 }}>
                    <div
                      style={{
                        width: 200,
                        borderRight: '1px solid #f0f0f0',
                        padding: '8px 0',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 4
                      }}
                      tabIndex={0}
                      onKeyDown={(e) => {
                        const order: Array<'vr'|'objects'|'chains'> = ['vr', 'objects', 'chains'];
                        const idx = order.indexOf(sdnActiveKey);
                        if (e.key === 'ArrowDown') {
                          const next = order[(idx + 1) % order.length];
                          setSdnActiveKey(next);
                          e.preventDefault();
                        } else if (e.key === 'ArrowUp') {
                          const next = order[(idx - 1 + order.length) % order.length];
                          setSdnActiveKey(next);
                          e.preventDefault();
                        }
                      }}
                    >
                      {[
                        { key: 'vr' as const, label: 'VR / 网关', icon: <GatewayOutlined /> },
                        { key: 'objects' as const, label: '防护对象', icon: <SafetyCertificateOutlined /> },
                        { key: 'chains' as const, label: '服务链', icon: <NodeIndexOutlined /> },
                      ].map(item => {
                        const active = sdnActiveKey === item.key;
                        return (
                          <div
                            key={item.key}
                            role="tab"
                            aria-selected={active}
                            tabIndex={active ? 0 : -1}
                            onClick={() => setSdnActiveKey(item.key)}
                            style={{
                              height: 40,
                              display: 'flex',
                              alignItems: 'center',
                              padding: '0 16px',
                              cursor: 'pointer',
                              gap: 8,
                              color: active ? '#1677ff' : 'rgba(0,0,0,0.65)',
                              background: active ? '#e6f4ff' : 'transparent',
                              borderLeft: active ? '3px solid #1677ff' : '3px solid transparent'
                            }}
                          >
                            {item.icon}
                            <span>{item.label}</span>
                          </div>
                        );
                      })}
                    </div>
                    <div
                      style={{
                        flex: 1,
                        padding: '8px 16px',
                        transition: 'opacity 0.2s ease',
                        opacity: sdnContentOpacity
                      }}
                    >
                      {sdnActiveKey === 'vr' && (
                        <Table
                          className="std-table"
                          size="small"
                          bordered={false}
                          loading={sdnVrLoading}
                          rowKey={(r: any) => r.vr_unique_id || r.uuid || r.id}
                          dataSource={sdnVrs}
                          pagination={{
                            size: 'small',
                            showTotal: (total) => `共 ${total} 条`,
                          }}
                          columns={[
                            { title: '名称', dataIndex: 'name', key: 'name' },
                            { title: 'VR唯一ID', dataIndex: 'vr_unique_id', key: 'vr_unique_id', ellipsis: true },
                            { title: '租户ID', dataIndex: 'tenant_id', key: 'tenant_id', ellipsis: true },
                            { title: '组织ID', dataIndex: 'org_id', key: 'org_id', ellipsis: true },
                            { title: '绑定状态', dataIndex: 'bind_status', key: 'bind_status', render: (v: string, r: any) => {
                              if (r.is_deleted) return <span className="std-badge std-badge-error">CSM已删除</span>;
                              if (!v) return <span className="std-badge std-badge-default">未知</span>;
                              if (v === 'BOUND') return <span className="std-badge std-badge-success">已绑定</span>;
                              if (v === 'UNBOUND') return <span className="std-badge std-badge-default">未绑定</span>;
                              return <span className="std-badge std-badge-warning">{v}</span>;
                            } },
                            {
                              title: '操作',
                              key: 'action',
                              width: 100,
                              render: (_: any, r: any) => (
                                <Button type="link" danger size="small" onClick={() => {
                                  modal.confirm({
                                    title: '确认删除',
                                    content: '确定要删除该VR绑定记录吗？',
                                    onOk: async () => {
                                      try {
                                        await apiDelete(`/api/vr-config/${r.uuid}`);
                                        messageApi.success('删除成功');
                                        fetchSdnVrs();
                                      } catch (e) {
                                        messageApi.error('删除失败');
                                      }
                                    }
                                  });
                                }}>删除</Button>
                              )
                            }
                          ]}
                        />
                      )}
                      {sdnActiveKey === 'objects' && (
                        <Table
                          className="std-table"
                          size="small"
                          bordered={false}
                          loading={securityLoading}
                          rowKey={(r: any) => r.id || r._id}
                          dataSource={protectionObjects}
                          pagination={{
                            size: 'small',
                            showTotal: (total) => `共 ${total} 条`,
                          }}
                          columns={[
                            { title: '名称', dataIndex: 'name', key: 'name' },
                            { title: '类型', dataIndex: 'type', key: 'type' },
                            { title: '值', dataIndex: 'value', key: 'value' },
                            { title: '描述', dataIndex: 'description', key: 'description', ellipsis: true }
                          ]}
                        />
                      )}
                      {sdnActiveKey === 'chains' && (
                        <Table
                          className="std-table"
                          size="small"
                          bordered={false}
                          loading={securityLoading}
                          rowKey={(r: any) => r.id || r._id}
                          dataSource={securityChains}
                          pagination={{
                            size: 'small',
                            showTotal: (total) => `共 ${total} 条`,
                          }}
                          columns={[
                            { title: '名称', dataIndex: 'name', key: 'name' },
                            { title: '服务链ID', dataIndex: 'id', key: 'id' },
                            { title: '状态', dataIndex: 'status', key: 'status', render: (status: string) => (
                              <span className={status === 'active' ? 'std-badge std-badge-success' : 'std-badge std-badge-default'}>{status}</span>
                            ) }
                          ]}
                        />
                      )}
                    </div>
                  </div>
                ) : (
                  <div style={{ textAlign: 'center', padding: 40, color: '#999' }}>请先在左侧选择一个组织</div>
                )}
              </Tabs.TabPane>
            </Tabs>
            </Card>
          </Col>
        </Row>
      ) : (
        <div style={{ textAlign: 'center', padding: 40, color: '#999' }}>暂无组织数据</div>
      )}

      <StdSideDrawer
        title="添加用户"
        open={userDrawerOpen}
        width={600}
        onClose={() => {
          setUserDrawerOpen(false);
          userForm.resetFields();
        }}
        onOk={() => userForm.submit()}
        okText="创建"
      >
        <Form form={userForm} layout="vertical" onFinish={handleUserSubmit}>
          <Form.Item name="organizationId" hidden><Input /></Form.Item>
          <Form.Item label="用户名" name="username" rules={[{ required: true }]}>
            <Input placeholder="请输入用户名" />
          </Form.Item>
          <Form.Item label="姓名" name="fullName" rules={[{ required: true }]}>
            <Input placeholder="请输入姓名" />
          </Form.Item>
          <Form.Item label="邮箱" name="email" rules={[{ required: true }, { type: 'email', message: '请输入有效的邮箱地址' }]}>
            <Input placeholder="请输入邮箱" />
          </Form.Item>
          <Form.Item label="密码" name="password" rules={[{ required: true }]}>
            <Input.Password placeholder="请输入密码" />
          </Form.Item>
          <Form.Item label="角色" name="role" rules={[{ required: true }]}>
            <Select 
              placeholder="请选择角色" 
              showSearch
              filterOption={(input, option) => {
                const label = option?.children?.toString() || '';
                return label.toLowerCase().includes(input.toLowerCase());
              }}
              notFoundContent={tenantRoles.length === 0 ? '暂无可用角色' : '未找到匹配的角色'}
            >
              {tenantRoles.map(r => {
                const displayName = formatRoleDisplayName(r.name);
                return (
                  <Select.Option key={r.id} value={r.id} title={r.description || displayName}>
                    {displayName}
                    {r.description && <span style={{ color: '#999', marginLeft: 8, fontSize: 12 }}>({r.description})</span>}
                  </Select.Option>
                );
              })}
            </Select>
          </Form.Item>
        </Form>
      </StdSideDrawer>

      <Modal
        title="编辑用户"
        open={editUserModalOpen}
        width={520}
        okText="保存"
        cancelText="取消"
        destroyOnClose
        onCancel={() => {
          setEditUserModalOpen(false);
          setEditTargetUserId(null);
          editUserForm.resetFields();
        }}
        onOk={handleEditUserSave}
      >
        <Form form={editUserForm} layout="vertical" style={{ marginTop: 8 }}>
          <Form.Item name="username" label="用户名">
            <Input disabled />
          </Form.Item>
          <Form.Item name="fullName" label="姓名" rules={[{ required: true, message: '请输入姓名' }]}>
            <Input placeholder="请输入姓名" />
          </Form.Item>
          <Form.Item
            name="email"
            label="邮箱"
            rules={[{ required: true, message: '请输入邮箱' }, { type: 'email', message: '请输入有效的邮箱地址' }]}
          >
            <Input placeholder="请输入邮箱" />
          </Form.Item>
          <Form.Item name="password" label="新密码" extra="留空则不修改密码">
            <Input.Password placeholder="留空则不修改" autoComplete="new-password" />
          </Form.Item>
          <Form.Item name="status" label="状态" rules={[{ required: true, message: '请选择状态' }]}>
            <Select
              options={[
                { value: 'active', label: '活跃' },
                { value: 'inactive', label: '非活跃' },
              ]}
            />
          </Form.Item>
        </Form>
      </Modal>

      <StdSideDrawer
        title={assignType === 'security' ? '分配安全资源池' : '分配计算资源池'}
        open={resourcePoolDrawerOpen}
        width={600}
        onClose={() => {
          setResourcePoolDrawerOpen(false);
          resourcePoolForm.resetFields();
          setNsOptions([]);
          setOccupiedNamespaceNames([]);
        }}
        onOk={() => resourcePoolForm.submit()}
        okText="分配"
      >
        <Form
          form={resourcePoolForm}
          layout="vertical"
          initialValues={{ tenantNamespaceMode: 'auto' }}
          onFinish={handleResourcePoolAssign}
        >
          <Form.Item label="选择资源池" name="resourcePoolIds" rules={[{ required: true }]}>
            {/*
              optionLabelProp="label"：搜索/语义用资源池名称。
              labelRender：收起后由我们绘制「名称 + 右侧类型」，与下拉里布局一致（不会与 Option 的 children 叠两层）。
            */}
            <Select
              placeholder="请选择资源池"
              style={{ width: '100%' }}
              optionLabelProp="label"
              notFoundContent={
                assignableResourcePools.length === 0
                  ? '没有可选项：本 Tab 下资源池可能已全部绑定当前组织，或列表尚未加载'
                  : undefined
              }
              labelRender={(li) => {
                const pool = assignableResourcePools.find((p: any) => p.id === li.value);
                const provider = getCloudPoolDisplayProvider(pool);
                return (
                  <span
                    style={{
                      display: 'flex',
                      width: '100%',
                      minWidth: 0,
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 8,
                    }}
                  >
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{li.label}</span>
                    {provider ? (
                      <Typography.Text type="secondary" style={{ fontSize: 12, flexShrink: 0 }}>
                        {provider}
                      </Typography.Text>
                    ) : null}
                  </span>
                );
              }}
              onChange={async (val: any) => {
                try {
                  setNsOptions([]);
                  setOccupiedNamespaceNames([]);
                  resourcePoolForm.setFieldsValue({
                    tenantNamespaceMode: 'auto',
                    existingTenantNamespace: undefined,
                  });
                  const poolId = Array.isArray(val) ? val[0] : val;
                  const pool = (resourcePools || []).find((p: any) => p.id === poolId);
                  const pvRaw = getCloudPoolProviderRaw(pool);
                  if (isHarvesterLikeOperator(pvRaw)) {
                    setNsLoading(true);
                    const orgId = selectedOrg?.id;
                    const [nsResp, occResp] = await Promise.all([
                      apiRequest(`/api/clouds/${poolId}/resources/harvester/namespaces`),
                      orgId
                        ? apiRequest(
                            `/api/tenants/organizations/${encodeURIComponent(orgId)}/resource-pools/occupied-namespaces?cloudId=${encodeURIComponent(poolId)}`,
                            { skipCache: true },
                          ).catch(() => null)
                        : Promise.resolve(null),
                    ]);
                    const items: any[] =
                      nsResp?.data?.data?.items ||
                      nsResp?.data?.items ||
                      (Array.isArray(nsResp) ? nsResp : []);
                    setNsOptions(Array.isArray(items) ? items : []);
                    const occNames = (occResp as { names?: unknown } | null)?.names;
                    setOccupiedNamespaceNames(Array.isArray(occNames) ? (occNames as string[]) : []);
                  }
                } catch {
                  setNsOptions([]);
                  setOccupiedNamespaceNames([]);
                } finally {
                  setNsLoading(false);
                }
              }}
            >
              {assignableResourcePools.map((pool: any) => {
                const provider = getCloudPoolDisplayProvider(pool);
                return (
                  <Select.Option key={pool.id} value={pool.id} label={pool.name}>
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        gap: 8,
                        width: '100%',
                      }}
                    >
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{pool.name}</span>
                      <Typography.Text type="secondary" style={{ fontSize: 12, flexShrink: 0 }}>
                        {provider}
                      </Typography.Text>
                    </div>
                  </Select.Option>
                );
              })}
            </Select>
          </Form.Item>
          <Form.Item noStyle shouldUpdate>
            {() => {
              const poolId = resourcePoolForm.getFieldValue('resourcePoolIds');
              const pool = (resourcePools || []).find((p: any) => p.id === (Array.isArray(poolId) ? poolId[0] : poolId));
              const needNs = isHarvesterLikeOperator(getCloudPoolProviderRaw(pool));
              
              if (!needNs) return null;

              const nsSectionWrap: React.CSSProperties = {
                marginTop: 4,
                padding: '14px 16px',
                background: 'var(--ant-color-fill-quaternary, #fafafa)',
                border: '1px solid var(--ant-color-border-secondary, #f0f0f0)',
                borderRadius: 8,
              };

              return (
                <div style={nsSectionWrap}>
                  <Typography.Text strong style={{ display: 'block'}}>
                    组织工作命名空间
                  </Typography.Text>
                  <Typography.Paragraph type="secondary" style={{ marginBottom: 12, fontSize: 12}}>
                    决定该组织在计算池中的主命名空间。
                  </Typography.Paragraph>

                  <Form.Item
                    name="tenantNamespaceMode"
                    label={null}
                    colon={false}
                    style={{ marginBottom: 12 }}
                    rules={[{ required: true, message: '请选择派生方式' }]}
                  >
                    <Radio.Group style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                      <Radio value="auto">
                        <div style={{ lineHeight: 1.5 }}>
                          <div style={{ fontWeight: 500 }}>自动生成</div>
                          <Typography.Text type="secondary" style={{ display: 'block', fontSize: 12, marginTop: 2 }}>
                            按组织 ID 生成固定名称，推荐新租户
                          </Typography.Text>
                        </div>
                      </Radio>
                      <Radio value="existing">
                        <div style={{ lineHeight: 1.5 }}>
                          <div style={{ fontWeight: 500 }}>使用集群已有命名空间</div>
                          <Typography.Text type="secondary" style={{ display: 'block', fontSize: 12, marginTop: 2 }}>
                            用于历史数据、迁移或故障恢复（名称须与集群中已有命名空间一致）
                          </Typography.Text>
                        </div>
                      </Radio>
                    </Radio.Group>
                  </Form.Item>

                  <Form.Item noStyle shouldUpdate>
                    {() =>
                      (resourcePoolForm.getFieldValue('tenantNamespaceMode') || 'auto') === 'auto' ? (
                        <Alert
                          type="info"
                          showIcon
                          style={{ marginBottom: 0 }}
                          message={
                            <Space direction="vertical" size={6} style={{ width: '100%' }}>
                              <span>创建新命名空间，用于业务资源（虚拟机、云盘等）。</span>
                              <div>
                                <Typography.Text type="secondary" style={{ fontSize: 12, marginRight: 8 }}>
                                  命名空间
                                </Typography.Text>
                                <Tag style={{ fontFamily: 'monospace', marginInlineEnd: 0 }}>
                                  ns-{selectedOrg?.id}
                                </Tag>
                              </div>
                            </Space>
                          }
                        />
                      ) : (
                        <Form.Item
                          name="existingTenantNamespace"
                          label="目标命名空间"
                          style={{ marginBottom: 0 }}
                          rules={[
                            ({ getFieldValue }) => ({
                              validator(_rule, v) {
                                if (getFieldValue('tenantNamespaceMode') !== 'existing') {
                                  return Promise.resolve();
                                }
                                const arr = Array.isArray(v)
                                  ? v
                                  : v != null && String(v).trim()
                                    ? [String(v).trim()]
                                    : [];
                                if (arr.length !== 1 || !String(arr[0]).trim()) {
                                  return Promise.reject(new Error('请选择或输入恰好一个命名空间'));
                                }
                                return Promise.resolve();
                              },
                            }),
                          ]}
                          extra={
                            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                              请先选择资源池以加载列表。已排除公共空间（
                              <Typography.Text code style={{ fontSize: 11 }}>
                                tower.io/scenario=public
                              </Typography.Text>
                              ）
                            </Typography.Text>
                          }
                        >
                          <Select
                            mode="tags"
                            maxCount={1}
                            placeholder="从列表选择或手动输入一个名称"
                            loading={nsLoading}
                            style={{ width: '100%' }}
                            tokenSeparators={[]}
                          >
                            {filteredAssignNsNames.map((name: string) => (
                              <Select.Option key={name} value={name}>
                                {name}
                              </Select.Option>
                            ))}
                          </Select>
                        </Form.Item>
                      )
                    }
                  </Form.Item>

                  <div
                    style={{
                      marginTop: 14,
                      paddingTop: 12,
                      borderTop: '1px dashed var(--ant-color-border-secondary, #f0f0f0)',
                    }}
                  >
                    <Typography.Text type="secondary" style={{ fontSize: 12, lineHeight: 1.6 }}>
                      <Typography.Text strong style={{ fontSize: 12 }}>
                        公共空间
                      </Typography.Text>
                      ：集群中带{' '}
                      <Typography.Text code style={{ fontSize: 11 }}>
                        tower.io/scenario=public
                      </Typography.Text>
                      的命名空间由租户控制台自动识别（模板、共享镜像等），无需在此配置。
                    </Typography.Text>
                  </div>
                </div>
              );
            }}
          </Form.Item>
        </Form>
      </StdSideDrawer>

      <StdSideDrawer
        title="配置权限角色"
        open={roleAssignOpen}
        width={800}
        onClose={() => {
          setRoleAssignOpen(false);
          setRoleAssignUser(null);
          setRoleAssignExisting([]);
          setRoleAssignSelected([]);
        }}
        onOk={saveRoleAssign}
        okText="保存"
      >
        <Form layout="inline" style={{ display: 'flex', gap: 16, marginBottom: 16 }}>
          <Form.Item style={{ flex: 1, marginBottom: 0 }}>
            <Input.Search
              allowClear
              placeholder="搜索角色名称或说明"
              value={roleAssignKw}
              onChange={e => setRoleAssignKw(e.target.value)}
            />
          </Form.Item>
        </Form>
        <Transfer
          dataSource={(() =>
            tenantRoles
              .filter(r => r.scope === 'tenant' && String(r.status || 'active') === 'active')
              .filter(r => (roleAssignKw ? ((r.name || '').toLowerCase().includes(roleAssignKw.toLowerCase()) || (r.description || '').toLowerCase().includes(roleAssignKw.toLowerCase())) : true))
              .map(r => ({ key: r.id, title: formatRoleDisplayName(r.name), description: r.description }))
          )()}
          targetKeys={roleAssignSelected}
          onChange={(next) => setRoleAssignSelected(next.map(String))}
          titles={["角色库","已选角色"]}
          render={(item: any) => item.title}
          rowKey={(item: any) => item.key}
          listStyle={{ width: '50%', height: 420 }}
          showSearch
          filterOption={(inputValue: string, item: any) => 
            (item.title as string).toLowerCase().includes(inputValue.toLowerCase()) ||
            (item.description as string)?.toLowerCase().includes(inputValue.toLowerCase())
          }
        />
        <div style={{ marginTop: 8, fontSize: 12, color: '#888' }}>保存将同步新增与移除的角色赋权</div>
      </StdSideDrawer>
    </PageDetailContainer>
  );
};

export default OrgManagePage;
