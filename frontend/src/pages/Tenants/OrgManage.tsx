import React, { useEffect, useState, useCallback } from 'react';
// 页面说明：
// 组织管理页（租户上下文），提供以下能力：
// 1）左侧组织树：支持搜索、重命名、添加子组织、删除组织等操作；
// 2）右侧标签页：
//    - 用户管理：支持检索、创建用户、为用户分配角色、批量删除；
//    - 计算/存储/安全资源分配：按组织维度分配资源池，支持筛选与移除分配；
//    - 安全域相关：展示防护对象与服务链（简要概览）；
// 3）顶部概览卡片：展示租户ID、组织ID、数量统计等信息；
// 数据来源统一通过后端接口（axios）获取，并在切换组织/租户时刷新。
import { Button, Card, Col, Dropdown, Form, Input, Modal, Row, Select, Table, Tabs, Tree, Typography, Descriptions, message, Checkbox } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import type { DataNode } from 'antd/es/tree';
import { useNavigate, useParams } from 'react-router-dom';
import axios from 'axios';
import PageDetailContainer from '../../components/PageDetailContainer';
import StdSideDrawer from '../../components/StdSideDrawer';
import PermissionTreeTransfer from '../../components/TreeTransfer';
import { Tenant, Organization, TenantUser, CreateTenantUserRequest, ResourcePoolAssignment } from '../../types/tenant';
import { CheckOutlined, CloseOutlined, EditOutlined, EllipsisOutlined, PlusOutlined, ClusterOutlined, GatewayOutlined, SafetyCertificateOutlined, NodeIndexOutlined } from '@ant-design/icons';
import { fetchProtectionObjects, fetchServiceChains } from '../../services/trafficOrchestration';
import { fetchVrCachePageList } from '../../services/virtualRouterApi';

// RBAC 角色模型：名称、范围（system/tenant）、状态等
type RBACRole = { id: string; name: string; description?: string; scope: 'system' | 'tenant'; status?: 'active' | 'inactive' };
// 角色赋权记录：某用户在某范围下被赋予某角色
type Assignment = { id: string; roleId: string; userType: 'system' | 'tenant'; userId: string; createdAt: string };

const OrgManagePage: React.FC = () => {
  // 路由 & 上下文
  const navigate = useNavigate();
  const { tenantId } = useParams();
  const [modal, contextHolder] = Modal.useModal();
  const [messageApi, messageContextHolder] = message.useMessage();
  // 顶部概览 & 左侧组织树相关状态
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
  // 用户列表说明：
  // - users：选中组织的用户列表，由 fetchUsers 拉取
  // - userKeyword：表格本地过滤关键字（用户名/姓名/邮箱）
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

  // 表单实例：用户创建、资源池分配
  const [userForm] = Form.useForm();
  const [resourcePoolForm] = Form.useForm();
  // 两个独立表单：
  // - userForm：用于用户创建抽屉
  // - resourcePoolForm：用于资源池分配抽屉
  const [userDrawerOpen, setUserDrawerOpen] = useState(false);
  const [resourcePoolDrawerOpen, setResourcePoolDrawerOpen] = useState(false);
  // 资源分配类型（计算/存储/安全），用于抽屉内文案切换
  const [assignType, setAssignType] = useState<'compute'|'storage'|'security'>('compute');
  const [storageKeyword, setStorageKeyword] = useState<string>('');
  const [securityKeyword, setSecurityKeyword] = useState<string>('');
  const [nsLoading, setNsLoading] = useState<boolean>(false);
  const [nsOptions, setNsOptions] = useState<any[]>([]);
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

  // 获取租户详情
  const fetchTenant = async (id: string) => {
    try {
      const token = localStorage.getItem('token');
      const res = await axios.get(`/api/tenants/${id}`, { headers: { Authorization: `Bearer ${token}` } });
      setTenant(res.data);
    } catch {}
  };

  // 获取租户下组织树，并默认展开全部、选中根节点
  const fetchOrganizations = async (id: string) => {
    try {
      const token = localStorage.getItem('token');
      const response = await axios.get(`/api/tenants/${id}/organizations`, { headers: { Authorization: `Bearer ${token}` } });
      setOrganizations(response.data);
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
      setExpandedKeys(collectKeys(response.data));
      const root = response.data.find((o: any) => o.level === 1) || response.data[0];
      if (root) {
        setSelectedKeys([root.id]);
        setSelectedOrg(root);
      }
    } catch {}
  };

  // 获取角色库（过滤掉非活跃角色）
  const fetchTenantRoles = async () => {
    try {
      const token = localStorage.getItem('token');
      // 显式请求更多记录以防止分页截断
      const res = await axios.get('/api/system/rbac/roles', { 
        params: { limit: 1000 },
        headers: { Authorization: `Bearer ${token}` } 
      });
      const raw = res.data;
      const list: RBACRole[] = Array.isArray(raw) ? raw : (Array.isArray(raw?.roles) ? raw.roles : []);
      // 允许分配租户自定义角色和系统预置角色
      setTenantRoles(list.filter(r => String(r.status || 'active') === 'active'));
      // 兼容响应结构差异：
      // - 有的接口返回 { roles: [] }，有的直接返回数组；统一归一化为 list
      // - 仅保留 status=active 的角色，避免展示禁用项
    } catch {}
  };

  // 获取指定组织下的用户列表
  const fetchUsers = async (tid: string, orgId: string) => {
    try {
      const token = localStorage.getItem('token');
      const response = await axios.get(`/api/tenants/${tid}/organizations/${orgId}/users`, { headers: { Authorization: `Bearer ${token}` } });
      setUsers(response.data);
    } catch {}
  };

  // 获取指定组织的资源池分配列表
  const fetchAssignments = async (orgId: string) => {
    try {
      const token = localStorage.getItem('token');
      const response = await axios.get(`/api/tenants/organizations/${orgId}/resource-pools`, { headers: { Authorization: `Bearer ${token}` } });
      setAssignments(response.data);
    } catch {}
  };

  // 获取可分配资源池（抽屉内选择用）
  const fetchResourcePools = async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await axios.get('/api/tenants/available-resource-pools', { headers: { Authorization: `Bearer ${token}` } });
      setResourcePools(response.data);
    } catch {}
  };

  // 保存组织重命名，并刷新组织树
  const handleOrgRename = async (orgId: string, name: string) => {
    try {
      const token = localStorage.getItem('token');
      await axios.put(`/api/tenants/organizations/${orgId}`, { name }, { headers: { Authorization: `Bearer ${token}` } });
      setRenameOrgId(null);
      setRenameName('');
      if (tenantId) fetchOrganizations(tenantId);
      messageApi.success('重命名成功');
    } catch (e: any) {
      const msg = e?.response?.data?.message || '重命名失败';
      messageApi.error(msg);
    }
  };

  // 添加子组织保存：校验名称、调用创建接口、刷新组织树
  const handleAddChildSave = async (parentId: string) => {
    if (!tenantId) return;
    const name = newChildName.trim();
    if (!name) return;
    try {
      const token = localStorage.getItem('token');
      await axios.post(`/api/tenants/${tenantId}/organizations`, { name, parentId }, { headers: { Authorization: `Bearer ${token}` } });
      setAddingForParentId(null);
      setNewChildName('');
      fetchOrganizations(tenantId);
      messageApi.success('创建组织成功');
    } catch (e: any) {
      const msg = e?.response?.data?.message || '创建组织失败';
      messageApi.error(msg);
    }
  };

  // 提交创建用户：成功后关闭抽屉并刷新列表
  const handleUserSubmit = async (values: CreateTenantUserRequest) => {
    if (!tenantId || !selectedOrg) return;
    try {
      const token = localStorage.getItem('token');
      await axios.post(`/api/tenants/${tenantId}/organizations/${selectedOrg.id}/users`, values, { headers: { Authorization: `Bearer ${token}` } });
      setUserDrawerOpen(false);
      userForm.resetFields();
      fetchUsers(tenantId, selectedOrg.id);
      messageApi.success('创建用户成功');
    } catch (e: any) {
      const msg = e?.response?.data?.message || '创建用户失败';
      messageApi.error(msg);
    }
  };

  const openRoleAssign = async (user: TenantUser) => {
    try {
      const token = localStorage.getItem('token');
      const res = await axios.get('/api/system/rbac/assignments', {
        params: { userType: 'tenant', userId: user.id },
        headers: { Authorization: `Bearer ${token}` }
      });
      const rawData = res.data;
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
  };

  useEffect(() => {
    const run = async () => {
      if (!users.length) return;
      try {
        const token = localStorage.getItem('token');
        const resps = await Promise.all(users.map(u => axios.get('/api/system/rbac/assignments', {
          params: { userType: 'tenant', userId: u.id },
          headers: { Authorization: `Bearer ${token}` }
        })));
        const next: Record<string, Array<{ id: string; name: string }>> = {};
        users.forEach((u, i) => {
          const rawData = resps[i].data;
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
    const token = localStorage.getItem('token');
    const current = new Set(roleAssignExisting.map(x => x.roleId));
    const needAdd = roleAssignSelected.filter(id => !current.has(id));
    const needRemove = roleAssignExisting.filter(x => !roleAssignSelected.includes(x.roleId));
    // 差异保存：
    // - needAdd：新增的 roleId → POST /assignments
    // - needRemove：移除的记录（通过 assignmentId）→ DELETE /assignments/{id}
    try {
      for (const roleId of needAdd) {
        await axios.post('/api/system/rbac/assignments', { roleId, userType: 'tenant', userId: roleAssignUser.id }, { headers: { Authorization: `Bearer ${token}` } });
      }
      for (const it of needRemove) {
        await axios.delete(`/api/system/rbac/assignments/${encodeURIComponent(it.id)}`, { headers: { Authorization: `Bearer ${token}` } });
      }
      modal.success({ title: '角色赋权已保存' });
      setRoleAssignOpen(false);
      setRoleAssignUser(null);
      setRoleAssignExisting([]);
      setRoleAssignSelected([]);
      if (tenantId && selectedOrg) {
        fetchUsers(tenantId, selectedOrg.id);
      }
    } catch (e: any) {
      const msg = e?.response?.data?.message || '保存角色赋权时发生错误';
      modal.error({ title: '保存失败', content: msg });
    }
  };

  const handleDeleteUser = async (userId: string) => {
    if (!tenantId || !selectedOrg) return;
    try {
      const token = localStorage.getItem('token');
      await axios.delete(`/api/tenants/${tenantId}/organizations/${selectedOrg.id}/users/${userId}`, { headers: { Authorization: `Bearer ${token}` } });
      fetchUsers(tenantId, selectedOrg.id);
      messageApi.success('删除用户成功');
    } catch (e: any) {
      const msg = e?.response?.data?.message || '删除用户失败';
      messageApi.error(msg);
    }
  };
  // 删除用户：
  // - 依赖当前选中组织上下文；成功后刷新用户列表

  const handleResourcePoolAssign = async (values: any) => {
    if (!selectedOrg) return;
    try {
      const token = localStorage.getItem('token');
      const idsRaw = values.resourcePoolIds;
      const resourcePoolIds = Array.isArray(idsRaw) ? idsRaw.filter(Boolean) : (idsRaw ? [idsRaw] : []);
      const payload = { 
        resourcePoolIds, 
        permissions: ['use'], 
        namespace: values.namespace,
        withCloudPublic: values.withCloudPublic,
        withDefault: values.withDefault
      };
      // 分配资源池：
      // - resourcePoolIds：当前场景仅选一个池，数组保留兼容性
      // - permissions 固定为 ['use']（表示可用权限）
      // - namespace：仅在 Harvester/CloudMap 私有/边缘 provider 下需要
      // - withCloudPublic：自动命名空间策略下，是否同时分配 cloud-public
      await axios.post(`/api/tenants/organizations/${selectedOrg.id}/resource-pools`, payload, { headers: { Authorization: `Bearer ${token}` } });
      setResourcePoolDrawerOpen(false);
      resourcePoolForm.resetFields();
      fetchAssignments(selectedOrg.id);
      messageApi.success('分配资源池成功');
    } catch (e: any) {
      const msg = e?.response?.data?.message || '分配资源池失败';
      messageApi.error(msg);
    }
  };

  const handleRemoveAssignment = async (poolId: string) => {
    if (!selectedOrg) return;
    try {
      const token = localStorage.getItem('token');
      await axios.delete(`/api/tenants/organizations/${selectedOrg.id}/resource-pools/${poolId}`, { headers: { Authorization: `Bearer ${token}` } });
      fetchAssignments(selectedOrg.id);
      message.success('移除分配成功');
    } catch (e: any) {
      const msg = e?.response?.data?.message || '移除分配失败';
      message.error(msg);
    }
  };

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
            <div style={{ display:'flex', alignItems:'center', gap:6 }}>
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
                onClick={(e) => { e.stopPropagation(); handleAddChildSave(org.id); }}
              >保存</Button>
              <Button
                type="link"
                size="small"
                icon={<CloseOutlined />}
                onClick={(e) => { e.stopPropagation(); setAddingForParentId(null); setNewChildName(''); }}
              >取消</Button>
            </div>
          ),
        });
      }
      return {
        key: org.id,
        title: (
          <div style={{ display:'flex', alignItems:'center', gap:16, width:'100%' }}>
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
            <div style={{ display:'flex', alignItems:'center', marginLeft:'auto', justifyContent:'flex-end' }}>
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
                    modal.confirm({
                      title: '确认删除组织',
                      content: '将删除该组织及其所有下级组织、关联用户与资源池分配。',
                      okText: '删除',
                      cancelText: '取消',
                      onOk: async () => {
                        try {
                          const token = localStorage.getItem('token');
                          await axios.delete(`/api/tenants/organizations/${org.id}`, { headers: { Authorization: `Bearer ${token}` } });
                          if (tenantId) fetchOrganizations(tenantId);
                        } catch {}
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

  const userColumns: ColumnsType<TenantUser> = [
    { title: '用户名', dataIndex: 'username', key: 'username' },
    { title: '角色', dataIndex: 'role', key: 'role', render: (_: any, row: TenantUser) => {
      // 预置角色（Legacy）映射
      const badgeClasses: Record<string, string> = { admin: 'std-badge std-badge-error', user: 'std-badge std-badge-info', viewer: 'std-badge std-badge-success' };
      const labels: Record<string, string> = { admin: '管理员', user: '用户', viewer: '查看者' };
      
      const cls = badgeClasses[row.role] || 'std-badge std-badge-default';
      // 尝试从预置映射获取，或从租户角色库动态查找名称，最后回落到 ID
      const match = tenantRoles.find(r => r.id === row.role);
      const label = labels[row.role] || (match ? match.name : row.role);

      const assigned = rolesByUser[row.id] || [];
      return (
        <div style={{ display:'flex', gap:8, flexWrap:'wrap', alignItems:'center' }}>
          <span className={cls}>{label}</span>
          {assigned.map(it => (
            <span key={`${row.id}-${it.id}`} style={{ display:'inline-flex', alignItems:'center', gap:6 }}>
              <span className="std-badge std-badge-default">{it.name}</span>
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
      render: (_, record: TenantUser) => (
        <Dropdown
          menu={{
            items: [
              { key: 'assign', label: '配置角色' },
              { key: 'delete', label: '删除', danger: true }
            ],
            onClick: ({ key }) => {
              if (key === 'assign') {
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
  ];

  // 资源池分配表格列：
  // - 类型/供应商列做 provider → 文本的归一化映射，提升可读性
  const assignmentColumns: ColumnsType<ResourcePoolAssignment> = [
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
  ];

  return (
    <PageDetailContainer
      title="组织管理"
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
          <Descriptions.Item label="安全资源池">{assignments.filter(a => {
            const pvRaw = String((a.cloud as any)?.config?.provider || (a.cloud as any)?.type || '').trim().toLowerCase();
            return pvRaw === 'cloudmap.csm';
          }).length}</Descriptions.Item>
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
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
                      <Input
                        allowClear
                        placeholder="搜索用户关键字"
                        value={userKeyword}
                        style={{ width: 240 }}
                        onChange={(e)=> setUserKeyword(e.target.value)}
                      />
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
                                      const token = localStorage.getItem('token');
                                      await Promise.all(selectedUserRowKeys.map(id => 
                                        axios.delete(`/api/tenants/${tenantId}/organizations/${selectedOrg.id}/users/${id}`, { headers: { Authorization: `Bearer ${token}` } })
                                      ));
                                      messageApi.success('批量删除成功');
                                      setSelectedUserRowKeys([]);
                                      fetchUsers(tenantId, selectedOrg.id);
                                    } catch (e: any) {
                                      messageApi.error(e?.response?.data?.message || '批量删除失败');
                                    }
                                  },
                                });
                              }
                            }
                          }}
                        >
                          <Button icon={<EllipsisOutlined />} />
                        </Dropdown>
                      </div>
                    </div>
                    <Table
                      columns={userColumns}
                      rowSelection={{ selectedRowKeys: selectedUserRowKeys, onChange: (keys)=> setSelectedUserRowKeys(keys as string[]) }}
                      dataSource={(userKeyword.trim() ? users.filter(u => {
                        const kw = userKeyword.trim().toLowerCase();
                        return (
                          (u.username || '').toLowerCase().includes(kw) ||
                          (u.fullName || '').toLowerCase().includes(kw) ||
                          (u.email || '').toLowerCase().includes(kw)
                        );
                      }) : users)}
                      className="std-table"
                      rowKey="id"
                      pagination={{ 
                        size: 'small', 
                        showSizeChanger: true, 
                        pageSize: 10,
                        pageSizeOptions: ['10', '20', '50', '100'],
                        showQuickJumper: false 
                      }}
                      size="small"
                      bordered
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
                          placeholder="搜索资源池关键字"
                          style={{ width: 240 }}
                          value={assignmentKeyword}
                          onChange={(e)=> setAssignmentKeyword(e.target.value)}
                        />
                        <Button 
                          type="primary" 
                          onClick={() => {
                            fetchResourcePools();
                            resourcePoolForm.resetFields();
                            setAssignType('compute');
                            setResourcePoolDrawerOpen(true);
                          }}
                         >分配计算资源池</Button>
                    </div>
                    <Table
                      columns={assignmentColumns}
                      dataSource={(assignmentKeyword.trim() ? assignments.filter(a => {
                        const kw = assignmentKeyword.trim().toLowerCase();
                        const name = String((a.cloud as any)?.name || '').toLowerCase();
                        const type = String((a.cloud as any)?.type || '').toLowerCase();
                        const provider = String((a.cloud as any)?.config?.provider || '').toLowerCase();
                        return name.includes(kw) || type.includes(kw) || provider.includes(kw);
                      }) : assignments.filter(a => {
                        const pvRaw = String((a.cloud as any)?.config?.provider || (a.cloud as any)?.type || '').trim().toLowerCase();
                        const t = String((a.cloud as any)?.type || '').toLowerCase();
                        const isSecurity = pvRaw === 'cloudmap.csm';
                        const isStorage = t === 'object_storage' || t === 'file_storage';
                        return !isSecurity && !isStorage;
                      }))}
                      className="std-table"
                      rowKey="id"
                      pagination={{ 
                        size: 'small', 
                        showSizeChanger: true, 
                        pageSize: 10,
                        pageSizeOptions: ['10', '20', '50', '100'],
                        showQuickJumper: false 
                      }}
                      size="small"
                      bordered
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
                    <Table
                      columns={assignmentColumns}
                      dataSource={(storageKeyword.trim() ? assignments.filter(a => {
                        const kw = storageKeyword.trim().toLowerCase();
                        const name = String((a.cloud as any)?.name || '').toLowerCase();
                        const type = String((a.cloud as any)?.type || '').toLowerCase();
                        const provider = String((a.cloud as any)?.config?.provider || '').toLowerCase();
                        const isStorage = type === 'object_storage' || type === 'file_storage';
                        return isStorage && (name.includes(kw) || type.includes(kw) || provider.includes(kw));
                      }) : assignments.filter(a => {
                        const type = String((a.cloud as any)?.type || '').toLowerCase();
                        return type === 'object_storage' || type === 'file_storage';
                      }))}
                      className="std-table"
                      rowKey="id"
                      pagination={{ 
                        size: 'small', 
                        showSizeChanger: true, 
                        pageSize: 10,
                        pageSizeOptions: ['10', '20', '50', '100'],
                        showQuickJumper: false 
                      }}
                      size="small"
                      bordered
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
                    <Table
                      columns={assignmentColumns}
                      dataSource={(securityKeyword.trim() ? assignments.filter(a => {
                        const pvRaw = String((a.cloud as any)?.config?.provider || (a.cloud as any)?.type || '').trim().toLowerCase();
                        const isSecurity = pvRaw === 'cloudmap.csm';
                        if (!isSecurity) return false;
                        const kw = securityKeyword.trim().toLowerCase();
                        const name = String((a.cloud as any)?.name || '').toLowerCase();
                        const type = String((a.cloud as any)?.type || '').toLowerCase();
                        const provider = String((a.cloud as any)?.config?.provider || '').toLowerCase();
                        return name.includes(kw) || type.includes(kw) || provider.includes(kw);
                      }) : assignments.filter(a => {
                        const pvRaw = String((a.cloud as any)?.config?.provider || (a.cloud as any)?.type || '').trim().toLowerCase();
                        const isSecurity = pvRaw === 'cloudmap.csm';
                        return isSecurity;
                      }))}
                      className="std-table"
                      rowKey="id"
                      pagination={{ 
                        size: 'small', 
                        showSizeChanger: true, 
                        pageSize: 10,
                        pageSizeOptions: ['10', '20', '50', '100'],
                        showQuickJumper: false 
                      }}
                      size="small"
                      bordered
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
                          bordered
                          loading={sdnVrLoading}
                          rowKey={(r: any) => r.vr_unique_id || r.uuid || r.id}
                          dataSource={sdnVrs}
                          pagination={{ 
                            size: 'small', 
                            showSizeChanger: true, 
                            pageSize: 5,
                            pageSizeOptions: ['5', '10', '20'],
                            showQuickJumper: false 
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
                                        const token = localStorage.getItem('token');
                                        await axios.delete(`/api/vr-config/${r.uuid}`, { headers: { Authorization: `Bearer ${token}` } });
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
                          bordered
                          loading={securityLoading}
                          rowKey={(r: any) => r.id || r._id}
                          dataSource={protectionObjects}
                          pagination={{ 
                            size: 'small', 
                            showSizeChanger: true, 
                            pageSize: 5,
                            pageSizeOptions: ['5', '10', '20'],
                            showQuickJumper: false 
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
                          bordered
                          loading={securityLoading}
                          rowKey={(r: any) => r.id || r._id}
                          dataSource={securityChains}
                          pagination={{ 
                            size: 'small', 
                            showSizeChanger: true, 
                            pageSize: 5,
                            pageSizeOptions: ['5', '10', '20'],
                            showQuickJumper: false 
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
          <Form.Item label="邮箱" name="email" rules={[{ required: true }, { type: 'email' }]}>
            <Input placeholder="请输入邮箱" />
          </Form.Item>
          <Form.Item label="密码" name="password" rules={[{ required: true }]}>
            <Input.Password placeholder="请输入密码" />
          </Form.Item>
          <Form.Item label="角色" name="role" rules={[{ required: true }]}>
            <Select placeholder="请选择角色">
              <Select.Option value="admin">管理员</Select.Option>
              <Select.Option value="user">用户</Select.Option>
              <Select.Option value="viewer">查看者</Select.Option>
              {tenantRoles.filter(r => !['admin','user','viewer'].includes(r.name)).map(r => (
                <Select.Option key={r.id} value={r.id}>{r.name}</Select.Option>
              ))}
            </Select>
          </Form.Item>
        </Form>
      </StdSideDrawer>

      <StdSideDrawer
        title={assignType === 'security' ? '分配安全资源池' : '分配计算资源池'}
        open={resourcePoolDrawerOpen}
        width={600}
        onClose={() => {
          setResourcePoolDrawerOpen(false);
          resourcePoolForm.resetFields();
        }}
        onOk={() => resourcePoolForm.submit()}
        okText="分配"
      >
        <Form form={resourcePoolForm} layout="vertical" onFinish={handleResourcePoolAssign}>
          <Form.Item label="选择资源池" name="resourcePoolIds" rules={[{ required: true }]}> 
            <Select mode={undefined} placeholder="请选择资源池" style={{ width: '100%' }} onChange={async (val: any) => {
              try {
                setNsOptions([]);
                resourcePoolForm.setFieldsValue({ namespace: undefined });
                const poolId = Array.isArray(val) ? val[0] : val;
                const pool = (resourcePools || []).find((p:any)=> p.id === poolId);
                const pvRaw = String(pool?.config?.provider || pool?.type || '').trim().toLowerCase();
                if (pvRaw === 'harvester' || pvRaw === 'cloudmap.private' || pvRaw === 'cloudmap.edge') {
                  setNsLoading(true);
                  const token = localStorage.getItem('token');
                  const resp = await axios.get(`/api/clouds/${poolId}/resources/harvester/namespaces`, { headers: { Authorization: `Bearer ${token}` } });
                  const items: any[] = resp?.data?.data?.items || resp?.data?.items || [];
                  setNsOptions(items);
                }
              } catch { setNsOptions([]); } finally { setNsLoading(false); }
            }}>
              {(resourcePools || []).filter((pool:any) => {
                const pvRaw = String(pool?.config?.provider || pool?.type || '').trim().toLowerCase();
                const t = String(pool?.type || '').toLowerCase();
                const isSec = pvRaw === 'cloudmap.csm';
                const isStorage = t === 'object_storage' || t === 'file_storage';
                if (assignType === 'security') return isSec;
                if (assignType === 'storage') return isStorage;
                return !isSec && !isStorage;
              }).map((pool:any) => (
                <Select.Option key={pool.id} value={pool.id}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span>{pool.name}</span>
                    <div style={{ fontSize: '12px', color: '#666' }}>
                      {String(pool.config?.provider || pool.type || '-')}
                    </div>
                  </div>
                </Select.Option>
              ))}
            </Select>
          </Form.Item>
          <Form.Item noStyle shouldUpdate>
            {() => {
              const poolId = resourcePoolForm.getFieldValue('resourcePoolIds');
              const pool = (resourcePools || []).find((p:any)=> p.id === (Array.isArray(poolId) ? poolId[0] : poolId));
              const pvRaw = String(pool?.config?.provider || pool?.type || '').trim().toLowerCase();
              const needNs = pvRaw === 'harvester' || pvRaw === 'cloudmap.private' || pvRaw === 'cloudmap.edge';
              
              if (!needNs) return null;

              return (
                <>
                  <Form.Item label="工作空间" style={{ marginBottom: 12 }}>
                     <Checkbox checked disabled>自动生成 ns-{selectedOrg?.id}</Checkbox>
                     <div style={{ color: '#999', fontSize: 12, marginLeft: 24, marginTop: 4 }}>用于创建和管理该组织的专属资源（虚拟机、云盘等）</div>
                  </Form.Item>

                  <Form.Item label="模板空间" style={{ marginBottom: 12 }}>
                     <Form.Item name="withCloudPublic" valuePropName="checked" initialValue={true} noStyle>
                       <Checkbox>cloud-public</Checkbox>
                     </Form.Item>
                     <div style={{ color: '#999', fontSize: 12, marginLeft: 24, marginTop: 4 }}>用于访问公共模板和共享资源</div>
                  </Form.Item>

                  <Form.Item label="镜像空间" style={{ marginBottom: 12 }}>
                     <Form.Item name="withDefault" valuePropName="checked" initialValue={true} noStyle>
                       <Checkbox disabled>default</Checkbox>
                     </Form.Item>
                     <div style={{ color: '#999', fontSize: 12, marginLeft: 24, marginTop: 4 }}>用于访问系统默认镜像资源</div>
                  </Form.Item>

                  <Form.Item label="额外命名空间" name="namespace">
                    <Select mode="tags" placeholder="请选择或输入更多命名空间" loading={nsLoading} style={{ width: '100%' }}>
                      {(nsOptions || []).map((x:any) => {
                        const name = x?.metadata?.name || x?.name;
                        return <Select.Option key={name} value={name}>{name}</Select.Option>;
                      })}
                    </Select>
                  </Form.Item>
                </>
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
        <PermissionTreeTransfer
          dataSource={(() => {
            const base = tenantRoles
              .filter(r => String(r.status || 'active') === 'active')
              .filter(r => (roleAssignKw ? ((r.name || '').toLowerCase().includes(roleAssignKw.toLowerCase()) || (r.description || '').toLowerCase().includes(roleAssignKw.toLowerCase())) : true))
              .map(r => ({ key: r.id, title: r.name, description: r.description }));
            const selected = (roleAssignSelected || []).map(k => {
              const role = tenantRoles.find(r => r.id === k);
              return { key: String(k), title: role?.name || String(k), description: role?.description || '' };
            });
            const map = new Map<string, any>();
            [...base, ...selected].forEach(it => { map.set(String(it.key), it); });
            return Array.from(map.values());
          })()}
          targetKeys={roleAssignSelected}
          onChange={(next) => setRoleAssignSelected(next.map(String))}
          titles={["角色库","已选角色"]}
          style={{ width: '100%' }}
          listStyle={{ flex: '1 1 0', minWidth: 0, height: 420 }}
          groupMode="flat"
        />
        <div style={{ marginTop: 8, fontSize: 12, color: '#888' }}>保存将同步新增与移除的角色赋权</div>
      </StdSideDrawer>
    </PageDetailContainer>
  );
};

export default OrgManagePage;
