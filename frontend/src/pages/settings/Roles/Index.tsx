import React, { useEffect, useMemo, useState } from 'react';
import type { MenuProps } from 'antd';
import { Button, Form, Input, Select, Table, Dropdown, message, Space, Tag, App, Typography } from 'antd';
import { EllipsisOutlined, ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import ResourceActionsDropdown from '../../../components/ResourceActionsDropdown';
import StdFormModal from '../../../components/StdFormModal';
import PageContainer from '../../../components/PageContainer';
import { usePermissionDefinitions } from '../../../hooks/usePermissionDefinitions';
import { GROUPS, PLATFORMS } from '../../../constants/navigation';
import { 
  getGroupFromDefinition, 
  getFeatureFromDefinition, 
  normalizeFeatureName,
  getPlatformFromDefinition,
  splitResourceConsoleFeatures,
  sortCloudmapFeatures,
  RESOURCE_POOL_PLATFORM_ENTRY_PREFIX_SET,
  sortByResourceConsoleFeatureOrder,
  groupResourceConsoleChildFeatures,
  mergeResourceConsoleIntoPlatformEntryGroup,
  ALL_CLOUD_CONTAINER_SUB_READ,
  CLOUD_CONTAINER_TAB_WRITE,
} from '../../../utils/permissionUtils';
import { useTableColumnSettings } from '../../../hooks/useTableColumnSettings';
import TableColumnSettingsButton from '../../../components/TableColumnSettingsButton';
import { apiRequest, apiPost, apiDelete, apiPatch } from '../../../services/api';
import { useAuth } from '../../../contexts/AuthContext';
import { hasPermissionForAction } from '../../../utils/accessMapping';
import type { RBACRole } from './types';
import RoleAssignUsersDrawer from './components/RoleAssignUsersDrawer';
import RolePermissionDrawer from './components/RolePermissionDrawer';
import {
  CLOUD_CONTAINERS_READ,
  CLOUD_CONTAINERS_WRITE,
  CLOUD_SUBNETS_FLAT_READ,
  CLOUD_SUBNETS_FLAT_WRITE,
  CLOUD_SUBNETS_PUBLIC_READ,
  CLOUD_SUBNETS_PUBLIC_WRITE,
  CLOUD_SUBNETS_VPC_READ,
  CLOUD_SUBNETS_VPC_WRITE,
} from '../../../constants/cloudPermissions';

const CONTAINER_ACTIONS_INJECT: string[] = [
  CLOUD_CONTAINERS_READ,
  CLOUD_CONTAINERS_WRITE,
  ...ALL_CLOUD_CONTAINER_SUB_READ,
  ...Object.values(CLOUD_CONTAINER_TAB_WRITE),
];

const { Text, Link } = Typography;

const SUBNET_SPLIT_ACTIONS = [
  CLOUD_SUBNETS_VPC_READ,
  CLOUD_SUBNETS_VPC_WRITE,
  CLOUD_SUBNETS_FLAT_READ,
  CLOUD_SUBNETS_FLAT_WRITE,
  CLOUD_SUBNETS_PUBLIC_READ,
  CLOUD_SUBNETS_PUBLIC_WRITE,
] as const;

const SUBNET_SPLIT_SET = new Set<string>(SUBNET_SPLIT_ACTIONS);
const SUBNET_SPLIT_RESOURCE_NAME: Record<string, string> = {
  'clouds.subnets.vpc': 'VPC 子网',
  'clouds.subnets.flat': '扁平网络',
  'clouds.subnets.public': '公共子网',
};

function getRolePermissionCount(row: RBACRole): number {
  if (Array.isArray(row.actions) && row.actions.length > 0) {
    return row.actions.length;
  }
  try {
    const p = JSON.parse(String(row.permissions || '[]'));
    return Array.isArray(p) ? p.length : 0;
  } catch {
    return 0;
  }
}

const EMPTY_PERMISSION_STRUCTURE: { platform: string; groups: { group: string; features: any[] }[] }[] = [];

function filterPermissionStructureByKeyword(
  platforms: { platform: string; groups: { group: string; features: any[] }[] }[],
  kw: string,
) {
  const q = kw.trim().toLowerCase();
  if (!q) return platforms;
  return platforms
    .map((platform) => ({
      ...platform,
      groups: platform.groups
        .map((group) => ({
          ...group,
          features: group.features.filter((f) => {
            if (String(f.feature || '').toLowerCase().includes(q)) return true;
            if (String(f.resourcePrefix || '').toLowerCase().includes(q)) return true;
            if (f.read && String(f.read).toLowerCase().includes(q)) return true;
            if (f.write && String(f.write).toLowerCase().includes(q)) return true;
            return false;
          }),
        }))
        .filter((g) => g.features.length > 0),
    }))
    .filter((p) => p.groups.length > 0);
}

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
  const [roleType, setRoleType] = useState<string>('');
  
  // 授权抽屉状态（权限配置）
  const [kw, setKw] = useState('');
  const [permVerb, setPermVerb] = useState<'全部'|'read'|'write'>('全部');
  const [actionAtoms, setActionAtoms] = useState<string[]>([]);
  const backendSupportsSubnetSplit = useMemo(
    () => SUBNET_SPLIT_ACTIONS.some((id) => actionAtoms.includes(id)),
    [actionAtoms],
  );
  const [grantOpen, setGrantOpen] = useState(false);
  const [grantTarget, setGrantTarget] = useState<RBACRole | null>(null);
  const [grantSelectedIds, setGrantSelectedIds] = useState<string[]>([]);
  const [grantSaving, setGrantSaving] = useState(false);
  
  // 构建按平台->分组->功能组织的权限数据（仅抽屉打开时计算；搜索词在下游轻量过滤）
  const permissionStructureBase = useMemo(() => {
    if (!grantOpen) {
      return EMPTY_PERMISSION_STRUCTURE;
    }
    // 获取所有权限原子（用于构建结构，不进行筛选）
    const withFrontendSubnetSplit =
      !backendSupportsSubnetSplit &&
      (actionAtoms.includes('clouds.subnets:read') || actionAtoms.includes('clouds.subnets:write'))
        ? Array.from(new Set([...actionAtoms, ...SUBNET_SPLIT_ACTIONS]))
        : actionAtoms;
    /** 与原子子网拆分同理：保证容器总权与子域 atoms 在抽屉内可勾选（旧后端 /actions 未带齐时仍展示） */
    const needsContainerActionsInject = CONTAINER_ACTIONS_INJECT.some(
      (id) => !withFrontendSubnetSplit.includes(id),
    );
    const allActionsForStructure = needsContainerActionsInject
      ? Array.from(new Set([...withFrontendSubnetSplit, ...CONTAINER_ACTIONS_INJECT]))
      : withFrontendSubnetSplit;
    const actionSet = new Set(allActionsForStructure);

    // 按平台->分组->功能组织（使用所有权限构建结构）
    type PlatformMap = Map<string, Map<string, Map<string, { resourcePrefix?: string; read?: string; write?: string; readVisible?: boolean; writeVisible?: boolean }>>>;
    const platformMap: PlatformMap = new Map();
    const processedResources = new Set<string>();

    allActionsForStructure.forEach(action => {
      const [resource] = action.split(':');
      
      // 如果已经处理过该资源，跳过
      if (processedResources.has(resource)) return;
      processedResources.add(resource);

      const isFrontendSubnetSplit = SUBNET_SPLIT_SET.has(action);
      const platform = isFrontendSubnetSplit
        ? 'CNMC'
        : getPlatformFromDefinition(action, permissionDefinitions);
      let group = isFrontendSubnetSplit
        ? '资源池管理'
        : getGroupFromDefinition(action, permissionDefinitions);
      if (!group && resource === 'clouds.containers') {
        group = '资源池管理';
      }
      const featureRaw = isFrontendSubnetSplit
        ? (SUBNET_SPLIT_RESOURCE_NAME[resource] || resource)
        : resource === 'clouds.containers'
          ? '容器服务（K8s）'
          : getFeatureFromDefinition(action, permissionDefinitions);
      const feature = normalizeFeatureName(featureRaw);

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

      const readKey = `${resource}:read`;
      const writeKey = `${resource}:write`;
      const readAction = actionSet.has(readKey) ? readKey : undefined;
      const writeAction = actionSet.has(writeKey) ? writeKey : undefined;
      
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
          .flatMap(([group, featureMap]) => {
            type PermissionFeatureItem = {
              feature: string;
              resourcePrefix: string;
              read?: string;
              write?: string;
              readVisible: boolean;
              writeVisible: boolean;
              isResourceParent?: boolean;
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

            const features: PermissionFeatureItem[] =
              group === '资源池管理'
                ? (() => {
                    const { parents, children } = splitResourceConsoleFeatures(rawFeatures);
                    return [
                      ...parents.map((item) => ({ ...item, isResourceParent: true })),
                      ...children.map((item) => ({ ...item, isResourceParent: false })),
                    ];
                  })()
                : group === '资源控制台'
                  ? sortCloudmapFeatures(rawFeatures)
                  : rawFeatures.sort((a, b) => a.feature.localeCompare(b.feature));

            if (group !== '资源池管理') {
              return [{ group, features }];
            }

            const entryFeatures = sortByResourceConsoleFeatureOrder(
              features.filter((f) => RESOURCE_POOL_PLATFORM_ENTRY_PREFIX_SET.has(f.resourcePrefix)),
            );
            const restFeatures = sortByResourceConsoleFeatureOrder(
              features.filter((f) => !RESOURCE_POOL_PLATFORM_ENTRY_PREFIX_SET.has(f.resourcePrefix)),
            );

            const out: { group: string; features: PermissionFeatureItem[] }[] = [];
            if (entryFeatures.length > 0) {
              out.push({ group: '平台入口能力', features: entryFeatures });
            }
            if (restFeatures.length > 0) {
              const catalogSections = groupResourceConsoleChildFeatures(restFeatures);
              for (const sec of catalogSections) {
                out.push({ group: sec.label, features: sec.items });
              }
            }
            return out.length > 0 ? out : [{ group: '资源池管理', features: [] }];
          });
        const mergedGroups =
          platform === 'CNMC' ? mergeResourceConsoleIntoPlatformEntryGroup(groups) : groups;
        return { platform, groups: mergedGroups };
      });

    return platforms;
  }, [grantOpen, actionAtoms, backendSupportsSubnetSplit, permVerb, permissionDefinitions]);

  const permissionStructure = useMemo(
    () => filterPermissionStructureByKeyword(permissionStructureBase, kw),
    [permissionStructureBase, kw],
  );

  // 处理权限复选框变化
  const handlePermissionChange = (action: string, checked: boolean) => {
    if (checked) {
      setGrantSelectedIds([...grantSelectedIds, action]);
    } else {
      setGrantSelectedIds(grantSelectedIds.filter(id => id !== action));
    }
  };

  const mapLegacySubnetsToSplit = React.useCallback((ids: string[]) => {
    const out = new Set(ids);
    if (out.has('clouds.subnets:read')) {
      out.add(CLOUD_SUBNETS_VPC_READ);
      out.add(CLOUD_SUBNETS_FLAT_READ);
      out.add(CLOUD_SUBNETS_PUBLIC_READ);
    }
    if (out.has('clouds.subnets:write')) {
      out.add(CLOUD_SUBNETS_VPC_WRITE);
      out.add(CLOUD_SUBNETS_FLAT_WRITE);
      out.add(CLOUD_SUBNETS_PUBLIC_WRITE);
    }
    return Array.from(out);
  }, []);

  const normalizeForBackendSave = React.useCallback((ids: string[]) => {
    if (backendSupportsSubnetSplit) return ids;
    const out = new Set(ids.filter((id) => !SUBNET_SPLIT_SET.has(id)));
    const hasAnyRead = [CLOUD_SUBNETS_VPC_READ, CLOUD_SUBNETS_FLAT_READ, CLOUD_SUBNETS_PUBLIC_READ].some((id) =>
      ids.includes(id),
    );
    const hasAnyWrite = [CLOUD_SUBNETS_VPC_WRITE, CLOUD_SUBNETS_FLAT_WRITE, CLOUD_SUBNETS_PUBLIC_WRITE].some((id) =>
      ids.includes(id),
    );
    if (hasAnyRead) out.add('clouds.subnets:read');
    if (hasAnyWrite) out.add('clouds.subnets:write');
    return Array.from(out);
  }, [backendSupportsSubnetSplit]);
  
  // 授予用户抽屉状态
  const [assignUserOpen, setAssignUserOpen] = useState(false);
  const [assignUserTarget, setAssignUserTarget] = useState<RBACRole | null>(null);
  
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
        const json = await apiRequest('/api/system/rbac/actions', { enableCache: true });
        const arr: string[] = Array.isArray(json?.actions) ? json.actions : [];
        setActionAtoms(arr);
      } catch {
        setActionAtoms([]);
      }
    };
    loadActions();
  }, []);

  const openAssignUser = React.useCallback((role: RBACRole) => {
    setAssignUserTarget(role);
    setAssignUserOpen(true);
  }, []);

  const closeAssignDrawer = React.useCallback(() => {
    setAssignUserOpen(false);
    setAssignUserTarget(null);
  }, []);

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
      const expandedPerms = mapLegacySubnetsToSplit(permArr);
      setGrantSelectedIds(expandedPerms);
      setGrantOpen(true);
    } catch (error: any) {
      message.error(error?.message || '创建角色失败');
    }
  }, [createForm, mapLegacySubnetsToSplit]);

  // 提交授权
  const handleGrantSave = React.useCallback(async (targetKeys: string[]) => {
    if (!grantTarget) return;
    setGrantSaving(true);
    try {
      const permissionsToSave = normalizeForBackendSave(targetKeys);
      await apiPatch(`/api/system/rbac/roles/${grantTarget.id}/permissions`, { permissions: permissionsToSave });
      message.success('授权成功');
      setGrantOpen(false);
      fetchRoles();
    } catch (error: any) {
      message.error(error?.message || '保存失败');
    } finally {
      setGrantSaving(false);
    }
  }, [grantTarget, normalizeForBackendSave]);

  const openAuthorize = React.useCallback((role: RBACRole) => {
    setGrantTarget(role);
    const ids = mapLegacySubnetsToSplit(role.actions || []);
    setGrantSelectedIds(ids);
    setGrantOpen(true);
  }, [mapLegacySubnetsToSplit]);

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
        align: 'left' as const,
        render: (_: unknown, row: RBACRole) => <Text>{row.name}</Text>,
      },
      {
        title: '角色类型',
        key: 'type',
        dataIndex: 'type',
        align: 'left' as const,
        render: (_: unknown, row: RBACRole) =>
          row.type === '系统策略' ? (
            <Tag color="blue">内置角色</Tag>
          ) : row.type === '自定义策略' ? (
            <Tag color="green">自定义角色</Tag>
          ) : (
            <Tag>-</Tag>
          ),
      },
      {
        title: '角色范围',
        key: 'scope',
        dataIndex: 'scope',
        align: 'left' as const,
        render: (_: unknown, row: RBACRole) =>
          row.scope === 'system' ? '系统角色' : row.scope === 'tenant' ? '租户角色' : '-',
      },
      {
        title: '权限数量',
        key: 'permissionCount',
        align: 'left' as const,
        render: (_: unknown, row: RBACRole) => {
          const n = getRolePermissionCount(row);
          if (!canWrite) return <Text>{n}</Text>;
          return (
            <Link
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                openAuthorize(row);
              }}
            >
              {n}
            </Link>
          );
        },
      },
      {
        title: '授予用户数',
        key: 'grantedUserCount',
        dataIndex: 'grantedUserCount',
        align: 'left' as const,
        render: (_: unknown, row: RBACRole) => {
          const n = typeof row.grantedUserCount === 'number' ? row.grantedUserCount : 0;
          if (!canWrite) return <Text>{n}</Text>;
          return (
            <Link
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                openAssignUser(row);
              }}
            >
              {n}
            </Link>
          );
        },
      },
      {
        title: '描述',
        key: 'description',
        dataIndex: 'description',
        ellipsis: true,
        align: 'left' as const,
      },
      {
        title: '创建时间',
        key: 'createdAt',
        dataIndex: 'createdAt',
        align: 'left' as const,
        render: (v: string) => (v ? new Date(v).toLocaleString() : '-'),
      },
      {
        title: '操作',
        key: 'action',
        width: 80,
        align: 'left' as const,
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

  const { displayColumns: displayedColumns } = useTableColumnSettings(fullColumns, 'access_roles_v2');

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
          onValuesChange={(_, all) => {
            setRoleKw(all.keyword || '');
            setRoleType(all.type ?? '');
          }}
        >
          <Form.Item name="keyword">
            <Input allowClear placeholder="搜索角色名称或说明" className="toolbar-search" suffix={<SearchOutlined style={{ color: 'rgba(0,0,0,.45)' }} />} />
          </Form.Item>
          <Form.Item name="type">
            <Select className="toolbar-filter-sm" placeholder="全部类型" allowClear>
              <Select.Option value="系统策略">系统角色</Select.Option>
              <Select.Option value="自定义策略">自定义角色</Select.Option>
            </Select>
          </Form.Item>
          <Button type="link" className="toolbar-reset-btn" onClick={() => { filterForm.resetFields(); setRoleKw(''); setRoleType(''); }}>重置</Button>
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
            settingsKey="access_roles_v2"
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
          const matchType = !roleType ? true : (r.type === roleType || (roleType === '系统策略' && r.scope === 'system') || (roleType === '自定义策略' && r.scope === 'tenant'));
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

      <RolePermissionDrawer
        open={grantOpen}
        kw={kw}
        permVerb={permVerb}
        grantSelectedIds={grantSelectedIds}
        permissionStructure={permissionStructure}
        confirmLoading={grantSaving}
        onKwChange={setKw}
        onPermVerbChange={setPermVerb}
        onClearSelected={() => setGrantSelectedIds([])}
        onPermissionChange={handlePermissionChange}
        onClose={() => {
          setGrantOpen(false);
          setGrantTarget(null);
        }}
        onSave={() => handleGrantSave(grantSelectedIds)}
      />

      <RoleAssignUsersDrawer
        open={assignUserOpen}
        target={assignUserTarget}
        onClose={closeAssignDrawer}
        onSaved={fetchRoles}
      />
    </PageContainer>
  );
};

export default AccessRolesPage;
