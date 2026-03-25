import React, { useEffect, useMemo, useState } from 'react';
import type { MenuProps } from 'antd';
import { Button, Form, Input, Select, Table, Dropdown, message, Space, Tag, App, Tree, Empty, List, Transfer, Checkbox, Divider, Card, Row, Col, Typography } from 'antd';
import { EllipsisOutlined, ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import ResourceActionsDropdown from '../../components/ResourceActionsDropdown';
import StdSideDrawer from '../../components/StdSideDrawer';
import StdFormModal from '../../components/StdFormModal';
import PageContainer from '../../components/PageContainer';
import { featureLabelOf } from '../../constants/permissionCatalog';
import { usePermissionDefinitions } from '../../hooks/usePermissionDefinitions';
import { GROUPS, PLATFORM_LABELS, PLATFORMS } from '../../constants/navigation';
import { 
  getGroupFromDefinition, 
  getFeatureFromDefinition, 
  normalizeFeatureName,
  getPlatformFromDefinition,
  groupResourceConsoleChildFeatures,
  splitResourceConsoleFeatures,
} from '../../utils/permissionUtils';
import { useTableColumnSettings } from '../../hooks/useTableColumnSettings';
import TableColumnSettingsButton from '../../components/TableColumnSettingsButton';
import { apiRequest, apiPost, apiDelete, apiPatch } from '../../services/api';
import { useAuth } from '../../contexts/AuthContext';
import { hasPermissionForAction } from '../../utils/accessMapping';

const { Title, Text } = Typography;

// 角色数据结构定义
type RBACRole = {
  id: string;
  name: string;
  description?: string;
  scope: 'system' | 'tenant'; // 角色范围：系统级或租户级
  permissions?: string;       // 权限字符串 (JSON)
  actions?: string[];         // 权限原子列表
  type?: '系统策略' | '自定义策略'; // 角色类型：系统角色(预置)或自定义角色
  status: 'active' | 'inactive';
  createdAt?: string;
  updatedAt?: string;
  /** 后端聚合：rbac 分配记录数，与「授予用户」抽屉一致 */
  grantedUserCount?: number;
};

// 系统用户类型
type SysUser = {
  id: string;
  username: string;
  email: string;
  fullName: string;
  role: 'super_admin' | 'admin' | 'tenant';
  status: 'active' | 'inactive' | 'suspended';
  createdAt?: string;
  builtIn?: boolean;
};

// 角色分配类型
type Assignment = { id: string; roleId: string; userType: 'system'|'tenant'; userId: string; createdAt: string };

/** 租户角色在「配置权限」中不展示「资源总览」「资源池」两张父级卡片（细分 clouds.* 仍可选） */
const TENANT_HIDDEN_RESOURCE_PREFIXES = new Set(['clouds.dashboard', 'clouds']);

function stripTenantForbiddenPermissionIds(ids: string[]): string[] {
  return ids.filter((id) => {
    const resource = String(id).split(':')[0];
    return !TENANT_HIDDEN_RESOURCE_PREFIXES.has(resource);
  });
}

// 将权限原子转换为可读描述（优先使用后端定义）
const describeAction = (action: string, definitions?: any[]): string => {
  // 优先使用后端权限定义的描述
  const backendDef = definitions?.find(d => d.id === action);
  if (backendDef?.description) {
    return backendDef.description;
  }
  
  // 回退到生成描述
  const [resource, op] = String(action).split(':');
  const f = featureLabelOf(resource || action, definitions);
  if (op === 'read') return `查看${f}列表与详情`;
  if (op === 'write') return `创建、修改、删除${f}`;
  return `${f}操作`;
};

const AccessRolesPage: React.FC = () => {
  // 使用 App.useApp() 获取 modal 实例（支持 destroyOnHidden）
  const { modal } = App.useApp();
  // 权限定义数据
  const { definitions: permissionDefinitions } = usePermissionDefinitions();
  const { user } = useAuth();
  const userPerms = user?.permissions && Array.isArray(user.permissions) ? user.permissions : [];
  const role = String(user?.role || '').toLowerCase();
  // super_admin 拥有所有权限，admin 需要检查具体权限
  const canWrite = role === 'super_admin' || hasPermissionForAction(userPerms, 'system.roles:write');
  
  // 状态管理
  const [roles, setRoles] = useState<RBACRole[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm] = Form.useForm();
  const [filterForm] = Form.useForm();
  
  // 筛选状态
  const [roleKw, setRoleKw] = useState('');
  const [roleType, setRoleType] = useState<string>('全部');
  
  // 授权抽屉状态（权限配置）
  const [kw, setKw] = useState('');
  const [permVerb, setPermVerb] = useState<'全部'|'read'|'write'>('全部');
  const [actionAtoms, setActionAtoms] = useState<string[]>([]);
  const [grantOpen, setGrantOpen] = useState(false);
  const [grantTarget, setGrantTarget] = useState<RBACRole | null>(null);
  const [grantSelectedIds, setGrantSelectedIds] = useState<string[]>([]);
  
  // 构建按平台->分组->功能组织的权限数据
  const permissionStructure = useMemo(() => {
    // 获取所有权限原子（用于构建结构，不进行筛选）
    const allActionsForStructure = actionAtoms;
    
    // 获取筛选后的权限原子（用于确定哪些权限应该显示复选框）
    // 注意：这个变量现在主要用于兼容，实际筛选在构建结构时进行

    // 按平台->分组->功能组织（使用所有权限构建结构）
    type PlatformMap = Map<string, Map<string, Map<string, { resourcePrefix?: string; read?: string; write?: string; readVisible?: boolean; writeVisible?: boolean }>>>;
    const platformMap: PlatformMap = new Map();
    const processedResources = new Set<string>();

    allActionsForStructure.forEach(action => {
      const [resource] = action.split(':');
      
      // 如果已经处理过该资源，跳过
      if (processedResources.has(resource)) return;
      processedResources.add(resource);

      const platform = getPlatformFromDefinition(action, permissionDefinitions);
      const group = getGroupFromDefinition(action, permissionDefinitions);
      const featureRaw = getFeatureFromDefinition(action, permissionDefinitions);
      const feature = normalizeFeatureName(featureRaw);
      
      // 如果有关键字筛选，检查功能名称是否匹配
      if ((kw||'').length > 0) {
        if (!feature.toLowerCase().includes(kw.toLowerCase()) && 
            !resource.toLowerCase().includes(kw.toLowerCase())) {
          return; // 不匹配关键字，跳过
        }
      }

      if (!platformMap.has(platform)) {
        platformMap.set(platform, new Map());
      }
      const groupMap = platformMap.get(platform)!;

      if (!groupMap.has(group)) {
        groupMap.set(group, new Map());
      }
      const featureMap = groupMap.get(group)!;
      
      if (!featureMap.has(feature)) {
        featureMap.set(feature, { resourcePrefix: resource });
      }
      const featurePerms = featureMap.get(feature)!;
      featurePerms.resourcePrefix = resource;

      // 查找同一资源的所有权限（read/write）
      const readAction = allActionsForStructure.find(a => a === `${resource}:read`);
      const writeAction = allActionsForStructure.find(a => a === `${resource}:write`);
      
      if (readAction) {
        featurePerms.read = readAction;
        // 根据筛选条件决定是否显示
        featurePerms.readVisible = permVerb === '全部' || permVerb === 'read';
      }
      if (writeAction) {
        featurePerms.write = writeAction;
        // 根据筛选条件决定是否显示
        featurePerms.writeVisible = permVerb === '全部' || permVerb === 'write';
      }
    });

    // 转换为数组并排序
    const platforms = Array.from(platformMap.entries())
      .sort(([platformA], [platformB]) => {
        const indexA = PLATFORMS.indexOf(platformA as any);
        const indexB = PLATFORMS.indexOf(platformB as any);
        if (indexA === -1 && indexB === -1) return platformA.localeCompare(platformB);
        if (indexA === -1) return 1;
        if (indexB === -1) return -1;
        return indexA - indexB;
      })
      .map(([platform, groupMap]) => {
        const groups = Array.from(groupMap.entries())
          .sort(([groupA], [groupB]) => {
            const indexA = GROUPS.indexOf(groupA as any);
            const indexB = GROUPS.indexOf(groupB as any);
            if (indexA === -1 && indexB === -1) return groupA.localeCompare(groupB);
            if (indexA === -1) return 1;
            if (indexB === -1) return -1;
            return indexA - indexB;
          })
          .map(([group, featureMap]) => {
            type PermissionFeatureItem = {
              feature: string;
              resourcePrefix: string;
              read?: string;
              write?: string;
              readVisible: boolean;
              writeVisible: boolean;
            };

            const rawFeatures: PermissionFeatureItem[] = Array.from(featureMap.entries())
              .map(([feature, perms]) => ({
                feature,
                resourcePrefix: perms.read?.split(':')[0] || perms.write?.split(':')[0] || '',
                read: perms.read,
                write: perms.write,
                readVisible: perms.readVisible !== false,
                writeVisible: perms.writeVisible !== false,
              }));

            const features = group === '资源控制台'
              ? (() => {
                  const { parents, children } = splitResourceConsoleFeatures(rawFeatures);
                  const parentItems =
                    grantTarget?.scope === 'tenant'
                      ? parents.filter(
                          (p) => !TENANT_HIDDEN_RESOURCE_PREFIXES.has(p.resourcePrefix),
                        )
                      : parents;
                  return [
                    ...parentItems.map((item) => ({ ...item, isResourceParent: true })),
                    ...children.map((item) => ({ ...item, isResourceParent: false })),
                  ];
                })()
              : rawFeatures.sort((a, b) => a.feature.localeCompare(b.feature));
            return { group, features };
          });
        return { platform, groups };
      });

    return platforms;
  }, [actionAtoms, permVerb, kw, grantSelectedIds, permissionDefinitions, grantTarget?.scope]);
  
  // 处理权限复选框变化
  const handlePermissionChange = (action: string, checked: boolean) => {
    if (checked) {
      setGrantSelectedIds([...grantSelectedIds, action]);
    } else {
      setGrantSelectedIds(grantSelectedIds.filter(id => id !== action));
    }
  };
  
  // 授予用户抽屉状态
  const [assignUserOpen, setAssignUserOpen] = useState(false);
  const [assignUserTarget, setAssignUserTarget] = useState<RBACRole | null>(null);
  const [users, setUsers] = useState<SysUser[]>([]);
  const [assignUserSelected, setAssignUserSelected] = useState<string[]>([]);
  const [assignUserExisting, setAssignUserExisting] = useState<Assignment[]>([]);
  
  // 表格选择与列配置
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);

  // 获取角色列表（支持跳过缓存，用于手动刷新）
  const fetchRoles = async () => {
    try {
      const data = await apiRequest('/api/system/rbac/roles', { skipCache: true });
      if (Array.isArray(data)) {
        setRoles(data);
      } else {
        setRoles(data.roles || []);
      }
    } catch (error: any) {
      // 避免“刷新无反应”的体验，至少在控制台打印错误
      // 这里不直接弹出 message，防止频繁刷新时打扰用户
      // 如需更明显提示，可改为：message.error(error?.message || '获取角色列表失败');
      console.error('获取角色列表失败:', error);
    }
  };

  // 初始化加载
  useEffect(() => { fetchRoles(); }, []);

  // 加载系统权限原子
  useEffect(() => {
    const loadActions = async () => {
      try {
        const json = await apiRequest('/api/system/rbac/actions');
        const arr: string[] = Array.isArray(json?.actions) ? json.actions : [];
        setActionAtoms(arr);
      } catch {
        setActionAtoms([]);
      }
    };
    loadActions();
  }, []);

  // 加载系统用户列表
  const fetchUsers = async () => {
    try {
      const json = await apiRequest('/api/users');
      setUsers(Array.isArray(json) ? json : (Array.isArray(json?.users) ? json.users : []));
    } catch {
      setUsers([]);
    }
  };

  // 打开授予用户抽屉
  const openAssignUser = React.useCallback(async (role: RBACRole) => {
    setAssignUserTarget(role);
    try {
      // 先加载用户列表
      const usersJson = await apiRequest('/api/users');
      const usersList: SysUser[] = Array.isArray(usersJson) ? usersJson : (Array.isArray(usersJson?.users) ? usersJson.users : []);
      setUsers(usersList);
      
      // 遍历所有用户，获取每个用户的角色分配，然后过滤出包含该角色的分配
      const activeUsers = usersList.filter(u => u.username !== 'admin' && u.status === 'active');
      const assignmentsPromises = activeUsers.map(u => 
        apiRequest(`/api/system/rbac/assignments?userType=system&userId=${encodeURIComponent(u.id)}`)
          .catch(() => ({ assignments: [] }))
      );
      const assignmentsResults = await Promise.all(assignmentsPromises);
      const allAssignments: Assignment[] = [];
      assignmentsResults.forEach(result => {
        const list: Assignment[] = Array.isArray(result?.assignments) ? result.assignments : [];
        allAssignments.push(...list);
      });
      // 过滤出包含该角色的分配
      const roleAssignments = allAssignments.filter(a => a.roleId === role.id);
      setAssignUserExisting(roleAssignments);
      const selected = roleAssignments.map(it => it.userId);
      setAssignUserSelected(selected);
      setAssignUserOpen(true);
    } catch (error: any) {
      message.error('获取用户分配信息失败');
      setAssignUserOpen(true);
    }
  }, []);

  // 保存用户分配
  const handleAssignUserSave = React.useCallback(async () => {
    if (!assignUserTarget) return;
    const current = new Set(assignUserExisting.map(x => x.userId));
    const needAdd = assignUserSelected.filter(userId => !current.has(userId));
    const needRemove = assignUserExisting.filter(x => !assignUserSelected.includes(x.userId));
    try {
      for (const userId of needAdd) {
        await apiPost('/api/system/rbac/assignments', { 
          roleId: assignUserTarget.id, 
          userType: 'system', 
          userId 
        });
      }
      for (const it of needRemove) {
        await apiDelete(`/api/system/rbac/assignments/${encodeURIComponent(it.id)}`);
      }
      message.success('用户分配已保存');
      setAssignUserOpen(false);
      setAssignUserTarget(null);
      setAssignUserExisting([]);
      setAssignUserSelected([]);
      fetchRoles(); // 刷新角色列表
    } catch (error: any) {
      message.error(error?.message || '保存失败');
    }
  }, [assignUserTarget, assignUserExisting, assignUserSelected]);

  // 处理角色创建
  const handleCreate = React.useCallback(async () => {
    try {
      const vals = await createForm.validateFields();
      const payload = { name: vals.name, description: vals.description || '', scope: vals.scope };
      const role = await apiPost('/api/system/rbac/roles', payload);
      message.success('角色创建成功');
      setCreateOpen(false);
      createForm.resetFields();
      fetchRoles();
      // 创建后直接打开授权界面
      setGrantTarget(role);
      const permArr: string[] = (()=>{ try{ return Array.isArray(JSON.parse(String(role?.permissions||'[]'))) ? JSON.parse(String(role?.permissions||'[]')) : []; }catch{ return []; } })();
      setGrantSelectedIds(
        role.scope === 'tenant' ? stripTenantForbiddenPermissionIds(permArr) : permArr,
      );
      setGrantOpen(true);
    } catch (error: any) {
      message.error(error?.message || '创建角色失败');
    }
  }, [createForm]);

  // 提交授权
  const handleGrantSave = React.useCallback(async (targetKeys: string[]) => {
    if (!grantTarget) return;
    try {
      const permissionsToSave =
        grantTarget.scope === 'tenant'
          ? stripTenantForbiddenPermissionIds(targetKeys)
          : targetKeys;
      await apiPatch(`/api/system/rbac/roles/${grantTarget.id}/permissions`, { permissions: permissionsToSave });
      message.success('授权成功');
      setGrantOpen(false);
      fetchRoles();
    } catch (error: any) {
      message.error(error?.message || '保存失败');
    }
  }, [grantTarget]);

  const openAuthorize = React.useCallback((role: RBACRole) => {
    setGrantTarget(role);
    const ids = role.actions || [];
    setGrantSelectedIds(
      role.scope === 'tenant' ? stripTenantForbiddenPermissionIds(ids) : ids,
    );
    setGrantOpen(true);
  }, []);

  const handleDelete = React.useCallback(async (role: RBACRole) => {
    try {
      await apiDelete(`/api/system/rbac/roles/${role.id}`);
      message.success('删除成功');
      fetchRoles();
    } catch (error: any) {
      message.error(error?.message || '删除失败');
    }
  }, []);

  const fullColumns = useMemo(
    () => [
      {
        title: '角色名称',
        key: 'name',
        dataIndex: 'name',
        render: (v: React.ReactNode) => <Space>{v}</Space>,
      },
      {
        title: '角色类型',
        key: 'type',
        dataIndex: 'type',
        width: 140,
        render: (_: unknown, row: RBACRole) =>
          row.type === '系统策略' ? (
            <Tag color="purple">内置角色</Tag>
          ) : row.type === '自定义策略' ? (
            <Tag color="orange">自定义角色</Tag>
          ) : (
            <Tag>-</Tag>
          ),
      },
      {
        title: '角色范围',
        key: 'scope',
        dataIndex: 'scope',
        width: 130,
        render: (_: unknown, row: RBACRole) =>
          row.scope === 'system' ? <Tag color="blue">System</Tag> : <Tag color="green">Tenant</Tag>,
      },
      {
        title: '授予用户数',
        key: 'grantedUserCount',
        dataIndex: 'grantedUserCount',
        width: 110,
        align: 'right' as const,
        render: (n: number | undefined) => (
          <Text>{typeof n === 'number' ? n : 0}</Text>
        ),
      },
      { title: '描述', key: 'description', dataIndex: 'description', ellipsis: true },
      {
        title: '创建时间',
        key: 'createdAt',
        dataIndex: 'createdAt',
        width: 180,
        render: (v: string) => (v ? new Date(v).toLocaleString() : '-'),
      },
      {
        title: '操作',
        key: 'action',
        width: 72,
        align: 'center' as const,
        fixed: 'right' as const,
        render: (_: unknown, row: RBACRole) => {
          if (!canWrite) return <Text type="secondary">—</Text>;
          const items: MenuProps['items'] = [
            {
              key: 'auth',
              label: '配置权限',
              onClick: () => openAuthorize(row),
            },
            {
              key: 'assign',
              label: '授予用户',
              onClick: () => openAssignUser(row),
            },
          ];
          if (row.type !== '系统策略') {
            items.push({ type: 'divider' });
            items.push({
              key: 'delete',
              label: '删除',
              danger: true,
              onClick: () => {
                modal.confirm({
                  title: '确认删除该自定义角色？',
                  content: '若角色已分配给用户或租户用户，将无法删除，请先解除关联。',
                  okText: '删除',
                  okType: 'danger',
                  onOk: () => handleDelete(row),
                });
              },
            });
          }
          return (
            <ResourceActionsDropdown
              items={items}
              buttonProps={{ className: 'row-actions-trigger', style: { margin: 0 } }}
            />
          );
        },
      },
    ],
    [canWrite, modal, openAuthorize, openAssignUser, handleDelete],
  );

  const { displayColumns: displayedColumns } = useTableColumnSettings(fullColumns, 'access_roles_table');

  return (
    <PageContainer
      titleLevel={3}
      asCard={false}
    >
      <div className="page-toolbar">
        {/* 筛选工具栏 */}
        <Form
          className="toolbar-container"
          layout="vertical"
          style={{ display:'flex', alignItems:'flex-end', rowGap:12, columnGap:12 }}
          form={filterForm}
          initialValues={{ type: '全部' }}
          onValuesChange={(_, all) => {
            setRoleKw(all.keyword || '');
            setRoleType(all.type || '全部');
          }}
        >
          <Form.Item name="keyword">
            <Input allowClear placeholder="搜索角色名称或说明" className="toolbar-search" suffix={<SearchOutlined style={{ color: 'rgba(0,0,0,.45)' }} />} />
          </Form.Item>
          <Form.Item name="type">
            <Select className="toolbar-filter" placeholder="全部类型">
              <Select.Option value="全部">全部类型</Select.Option>
              <Select.Option value="系统策略">系统角色</Select.Option>
              <Select.Option value="自定义策略">自定义角色</Select.Option>
            </Select>
          </Form.Item>
          <Button type="link" className="toolbar-reset-btn" onClick={() => { filterForm.resetFields(); setRoleKw(''); setRoleType('全部'); }}>重置</Button>
        </Form>
        
        {/* 操作按钮区 */}
        <div className="toolbar-actions">
          {canWrite && (
            <Button type="primary" onClick={() => { setCreateOpen(true); }}>新建角色</Button>
          )}
          <Dropdown menu={{ 
            items: [
              { key: 'delete', label: '批量删除', danger: true, onClick: () => {
                if (!selectedRowKeys.length) return message.warning('请先选择角色');
                
                // 过滤出选中的角色，检查是否有系统预置角色
                const selectedRoles = roles.filter(r => selectedRowKeys.includes(r.id));
                const systemRoles = selectedRoles.filter(r => r.type === '系统策略');
                
                if (systemRoles.length > 0) {
                  return message.warning(`选中的角色中包含 ${systemRoles.length} 个系统预置角色，无法删除`);
                }
                
                modal.confirm({
                  title: '确认批量删除？',
                  content: `即将删除 ${selectedRowKeys.length} 个角色`,
                  okButtonProps: { danger: true },
                  onOk: async () => {
                    try {
                      // 批量删除角色
                      await Promise.all(selectedRowKeys.map(roleId => 
                        apiDelete(`/api/system/rbac/roles/${roleId}`)
                      ));
                      message.success(`成功删除 ${selectedRowKeys.length} 个角色`);
                      setSelectedRowKeys([]);
                      fetchRoles(); // 刷新列表
                    } catch (error: any) {
                      message.error(error?.message || '批量删除失败');
                    }
                  }
                });
              }}
            ] 
          }} trigger={['click']}>
            <Button icon={<EllipsisOutlined />} />
          </Dropdown>
          <TableColumnSettingsButton
            allColumns={fullColumns}
            settingsKey="access_roles_table"
          />
          <Button icon={<ReloadOutlined />} onClick={fetchRoles} />
        </div>
      </div>
      
      {/* 角色列表表格 */}
      <Table
        className="std-table"
        rowKey="id"
        rowSelection={{
          selectedRowKeys,
          onChange: setSelectedRowKeys
        }}
        dataSource={roles.filter(r => {
          const matchKw = roleKw ? ((r.name||'').toLowerCase().includes(roleKw.toLowerCase()) || (r.description||'').toLowerCase().includes(roleKw.toLowerCase())) : true;
          // type 筛选逻辑可能需要根据实际数据调整，这里假设前端不做严格过滤或数据源已有 type 字段
          // 如果数据源没有 type 字段，可能需要根据 scope 或其他属性推断
          const matchType = roleType === '全部' ? true : (r.type === roleType || (roleType === '系统策略' && r.scope === 'system') || (roleType === '自定义策略' && r.scope === 'tenant'));
          return matchKw && matchType;
        })}
        columns={displayedColumns}
        pagination={{
          size: 'small',
          showTotal: (total) => `共 ${total} 条`,
        }}
        scroll={{ x: 'max-content' }}
        bordered={false}
      />

      {/* 新建角色模态框 */}
      <StdFormModal title="新建授权角色" open={createOpen} onCancel={()=> setCreateOpen(false)} okText="创建" destroyOnHidden width={600} form={createForm} onFinish={handleCreate}>
        <Form.Item name="name" label="角色名称" rules={[{ required: true, message: '请输入角色名称' }]}>
          <Input placeholder="例如：安全管理员" />
        </Form.Item>
        <Form.Item name="scope" label="角色范围" rules={[{ required: true, message: '请选择角色范围' }]}>
          <Select placeholder="请选择角色范围">
            <Select.Option value="system">系统角色</Select.Option>
            <Select.Option value="tenant">租户角色</Select.Option>
          </Select>
        </Form.Item>
        <Form.Item name="description" label="描述">
          <Input.TextArea placeholder="角色用途说明（可选）" autoSize={{ minRows: 3, maxRows: 6 }} />
        </Form.Item>
      </StdFormModal>

      {/* 授权配置抽屉（配置角色权限） */}
      <StdSideDrawer 
        title={`配置权限 - ${grantTarget?.name}`} 
        open={grantOpen} 
        onClose={()=> { setGrantOpen(false); setGrantTarget(null); }} 
        onOk={() => handleGrantSave(grantSelectedIds)} 
        width={1200} 
        styles={{ body: { display: 'flex', flexDirection: 'column', overflow: 'hidden', padding: 24 } }}
      >
        {/* 搜索和筛选栏 */}
        <div className="page-toolbar">
          <Form
            className="toolbar-container"
            layout="vertical"
            style={{ display:'flex', alignItems:'flex-end', rowGap:12, columnGap:12 }}
          >
          <Form.Item style={{ width: 160, marginBottom: 0 }}>
              <Select 
                value={permVerb} 
                onChange={(v:any)=> setPermVerb(v)} 
                options={[
                  { value:'全部', label:'全部' }, 
                  { value:'read', label:'只读' }, 
                  { value:'write', label:'读写' }
                ]} 
              />
          </Form.Item>
          <Form.Item style={{ flex: 1, marginBottom: 0 }}>
              <Input 
                allowClear 
                placeholder="搜索功能名称" 
                className="toolbar-search"
                suffix={<SearchOutlined style={{ color: 'rgba(0,0,0,.45)' }} />}
                value={kw} 
                onChange={e => setKw(e.target.value)} 
              />
          </Form.Item>
        </Form>
          <div className="toolbar-actions" style={{ display: 'flex', alignItems: 'center' }}>
            <Space>
              <Text>
                已选择 <Text strong style={{ color: '#1890ff' }}>{grantSelectedIds.length}</Text> 个权限
              </Text>
              <Button 
                type="link" 
                size="small"
                onClick={() => setGrantSelectedIds([])}
              >
                清空选择
              </Button>
            </Space>
            </div>
          </div>
          
        {/* 权限配置内容区 */}
        <Card style={{ flex: 1, overflow: 'auto' }} bodyStyle={{ padding: 16 }}>
          {permissionStructure.length === 0 ? (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无权限数据" />
          ) : (
            permissionStructure.map((platform, platformIdx) => (
              <div key={platform.platform} style={{ marginBottom: platformIdx < permissionStructure.length - 1 ? 32 : 0 }}>
                {/* 分组列表 */}
                {platform.groups.map((group, groupIdx) => (
                  <div key={group.group} style={{ marginBottom: groupIdx < platform.groups.length - 1 ? 24 : 0 }}>
                    {/* 分组标题 */}
                    <Text strong style={{ display: 'block', marginBottom: 12, marginTop: groupIdx > 0 ? 16 : 0 }}>
                      {group.group}
                    </Text>

                    {/* 功能项分栏布局（3列） */}
                    {(() => {
                      const parentFeatures = group.features.filter((feature: any) => feature.isResourceParent);
                      const childFeatures = group.features.filter((feature: any) => !feature.isResourceParent);
                      const isResourceConsoleGroup = group.group === '资源控制台';
                      const hasSplit =
                        isResourceConsoleGroup &&
                        (parentFeatures.length > 0 || childFeatures.length > 0);

                      const renderFeatureCards = (
                        features: any[],
                        opts?: { showParentScopeHints?: boolean; cardSpan?: number }
                      ) => (
                        <Row gutter={[16, 12]}>
                          {features.map((feature) => {
                            return (
                            <Col span={opts?.cardSpan ?? 8} key={`${feature.resourcePrefix || feature.feature}`}>
                              <Card size="small">
                                <div
                                  style={{
                                    display: 'flex',
                                    width: '100%',
                                    gap: 12,
                                    alignItems: 'flex-start',
                                    justifyContent: 'space-between',
                                  }}
                                >
                                  <div style={{ flex: 1, minWidth: 0 }}>
                                    <Text ellipsis style={{ display: 'block' }}>
                                      {feature.feature}
                                    </Text>
                                    <Text
                                      type="secondary"
                                      style={{
                                        display: 'block',
                                        marginTop: 4,
                                        fontSize: 12,
                                        lineHeight: 1.4,
                                        wordBreak: 'break-all',
                                      }}
                                    >
                                      {Array.from(
                                        new Set(
                                          [feature.readVisible ? feature.read : null, feature.writeVisible ? feature.write : null]
                                            .filter(Boolean)
                                            .map((id) => String(id).split(':')[0]),
                                        ),
                                      ).join(' / ')}
                                    </Text>
                                  </div>
                                  <Space style={{ flexShrink: 0 }}>
                                    {feature.read && feature.readVisible && (
                                      <Checkbox
                                        checked={grantSelectedIds.includes(feature.read)}
                                        onChange={(e) => handlePermissionChange(feature.read!, e.target.checked)}
                                      >
                                        只读
                                      </Checkbox>
                                    )}
                                    {feature.write && feature.writeVisible && (
                                      <Checkbox
                                        checked={grantSelectedIds.includes(feature.write)}
                                        onChange={(e) => handlePermissionChange(feature.write!, e.target.checked)}
                                      >
                                        读写
                                      </Checkbox>
                                    )}
                                  </Space>
                                </div>
                              </Card>
                            </Col>
                            );
                          })}
                        </Row>
                      );

                      if (!hasSplit) {
                        return renderFeatureCards(group.features);
                      }

                      return (
                        <>
                          {parentFeatures.length > 0 && (
                            <>
                              {renderFeatureCards(parentFeatures, { showParentScopeHints: true, cardSpan: 24 })}
                              <Divider style={{ margin: '16px 0' }} />
                            </>
                          )}
                          {groupResourceConsoleChildFeatures(childFeatures.length > 0 ? childFeatures : group.features).map((childGroup, idx, arr) => (
                            <div key={childGroup.label}>
                              <Text type="secondary" style={{ display: 'block', marginBottom: 8 }}>
                                {childGroup.label}
                              </Text>
                              {renderFeatureCards(childGroup.items)}
                              {idx < arr.length - 1 && <Divider style={{ margin: '16px 0' }} />}
                            </div>
                          ))}
                        </>
                      );
                    })()}

                    {/* 分组分隔线 */}
                    {groupIdx < platform.groups.length - 1 && (
                      <Divider style={{ margin: '16px 0' }} />
              )}
            </div>
                ))}

                {/* 平台分隔线 */}
                {platformIdx < permissionStructure.length - 1 && (
                  <Divider style={{ margin: '24px 0' }} />
                )}
          </div>
            ))
          )}
        </Card>
      </StdSideDrawer>

      {/* 授予用户抽屉 */}
      <StdSideDrawer 
        title={`授予用户 - ${assignUserTarget?.name}`} 
        open={assignUserOpen} 
        onClose={()=> { 
          setAssignUserOpen(false); 
          setAssignUserTarget(null); 
          setAssignUserExisting([]); 
          setAssignUserSelected([]); 
        }} 
        onOk={handleAssignUserSave} 
        width={700}
      >
        <Transfer
          dataSource={users
            .filter(u => u.username !== 'admin' && u.status === 'active') // 排除 admin 用户和非活跃用户
            .map(u => ({
              key: u.id,
              title: `${u.fullName || u.username} (${u.username})`,
              description: u.email,
            }))}
          titles={['可选用户', '已选用户']}
          targetKeys={assignUserSelected}
          onChange={(nextTargetKeys) => setAssignUserSelected(nextTargetKeys as string[])}
          render={(item) => item.title}
          rowKey={(item) => item.key}
          listStyle={{ width: 300, height: 400 }}
          showSearch
          filterOption={(inputValue, item) => 
            (item.title as string).toLowerCase().includes(inputValue.toLowerCase()) ||
            (item.description as string)?.toLowerCase().includes(inputValue.toLowerCase())
          }
        />
      </StdSideDrawer>
    </PageContainer>
  );
};

export default AccessRolesPage;
