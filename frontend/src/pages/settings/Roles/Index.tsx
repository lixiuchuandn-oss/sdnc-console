import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Form, Input, Modal, Select, Table, Dropdown, message, App } from 'antd';
import { EllipsisOutlined, ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import PageContainer from '../../../components/PageContainer';
import { usePermissionDefinitions } from '../../../hooks/usePermissionDefinitions';
import { useTableColumnSettings } from '../../../hooks/useTableColumnSettings';
import TableColumnSettingsButton from '../../../components/TableColumnSettingsButton';
import { apiRequest, apiPost, apiDelete, apiPatch } from '../../../services/api';
import { useAuth } from '../../../contexts/AuthContext';
import { hasPermissionForAction } from '../../../utils/accessMapping';
import { expandRoleGrantOnCheck } from '../../../utils/roleGrantExpand';
import type { RBACRole } from './types';
import RoleAssignUsersDrawer from './components/RoleAssignUsersDrawer';
import RolePermissionDrawer from './components/RolePermissionDrawer';
import {
  buildRolePermissionStructure,
  EMPTY_ROLE_PERMISSION_STRUCTURE,
} from './lib/buildRolePermissionStructure';
import { filterRolePermissionStructureByKeyword } from './lib/filterRolePermissionStructure';
import {
  normalizeRoleGrantForBackendSave,
  normalizeRoleGrantIds,
  SUBNET_SPLIT_ACTIONS,
} from './lib/roleGrantNormalize';
import {
  clampActionsToTenantBoundary,
  isBuiltInRbacRole,
  isTenantRootBuiltinRole,
  resolveTenantRootDrawerCatalogAtoms,
  shouldUseTenantPermissionBoundary,
} from './lib/builtinRolePermissionView';
import { stripTenantConsoleUmbrellaPermissions } from './lib/tenantConsoleUmbrellaPermissions';
import { cloneRoleGrantIds } from './lib/cloneRoleGrantIds';
import { suggestCopyRoleName } from './lib/suggestCopyRoleName';
import { useRoleListColumns } from './lib/useRoleListColumns';

type RoleScopeTab = 'system' | 'tenant';

function formatRoleTabLabel(title: string, count: number): string {
  return `${title} (${count})`;
}

const AccessRolesPage: React.FC = () => {
  const { modal } = App.useApp();
  const { definitions: permissionDefinitions } = usePermissionDefinitions();
  const { user } = useAuth();
  const userPerms = user?.permissions && Array.isArray(user.permissions) ? user.permissions : [];
  const role = String(user?.role || '').toLowerCase();
  const canWrite = role === 'super_admin' || hasPermissionForAction(userPerms, 'system.roles:write');
  const canReadActions =
    role === 'super_admin' ||
    hasPermissionForAction(userPerms, 'system.actions:read') ||
    hasPermissionForAction(userPerms, 'system.actions:write');
  const canWriteActions =
    role === 'super_admin' || hasPermissionForAction(userPerms, 'system.actions:write');
  const canConfigurePermissions = canReadActions;
  const canEditPermissions = canWrite && canWriteActions;
  const canAssignUsersRead =
    role === 'super_admin' || hasPermissionForAction(userPerms, 'system.roles.assignments:read');
  const canAssignUsersWrite =
    role === 'super_admin' || hasPermissionForAction(userPerms, 'system.roles.assignments:write');

  const [roles, setRoles] = useState<RBACRole[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm] = Form.useForm();
  const [copyOpen, setCopyOpen] = useState(false);
  const [copySource, setCopySource] = useState<RBACRole | null>(null);
  const [copyForm] = Form.useForm();
  const [filterForm] = Form.useForm();
  /** 赋权抽屉来自「复制角色」时为 true，用于标题与说明 */
  const [grantFromCopy, setGrantFromCopy] = useState(false);

  const [roleKw, setRoleKw] = useState('');
  const [roleKindFilter, setRoleKindFilter] = useState<'系统策略' | '自定义策略' | ''>('');
  const [roleTab, setRoleTab] = useState<RoleScopeTab>('system');

  const [kw, setKw] = useState('');
  const [permVerb, setPermVerb] = useState<'全部' | 'read' | 'write'>('全部');
  const [actionAtoms, setActionAtoms] = useState<string[]>([]);
  /** 内置云租户根用户固定目录（/rbac/actions.tenantRootBoundary），不随该角色已保存权限收缩 */
  const [tenantRootCatalogAtoms, setTenantRootCatalogAtoms] = useState<string[]>([]);
  const [grantOpen, setGrantOpen] = useState(false);
  const [grantTarget, setGrantTarget] = useState<RBACRole | null>(null);
  const [grantSelectedIds, setGrantSelectedIds] = useState<string[]>([]);
  const [grantSaving, setGrantSaving] = useState(false);

  const [assignUserOpen, setAssignUserOpen] = useState(false);
  const [assignUserTarget, setAssignUserTarget] = useState<RBACRole | null>(null);
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);

  /** 租户角色抽屉固定展示目录 + 可勾选上限（与种子公式一致，不随根用户已保存权限收缩） */
  const tenantRootBoundaryAtoms = useMemo(
    () => resolveTenantRootDrawerCatalogAtoms(tenantRootCatalogAtoms, actionAtoms),
    [tenantRootCatalogAtoms, actionAtoms],
  );

  /** 系统角色用全量 actions；租户角色仅用内置云租户根用户权限范围建树 */
  const drawerStructureActionAtoms = useMemo(() => {
    if (!grantOpen) return [];
    if (grantTarget && shouldUseTenantPermissionBoundary(grantTarget)) {
      return stripTenantConsoleUmbrellaPermissions(tenantRootBoundaryAtoms);
    }
    return actionAtoms;
  }, [grantOpen, grantTarget, tenantRootBoundaryAtoms, actionAtoms]);

  const backendSupportsSubnetSplitForDrawer = useMemo(
    () => SUBNET_SPLIT_ACTIONS.some((id) => drawerStructureActionAtoms.includes(id)),
    [drawerStructureActionAtoms],
  );

  const permissionStructureBase = useMemo(() => {
    if (!grantOpen) return EMPTY_ROLE_PERMISSION_STRUCTURE;
    return buildRolePermissionStructure({
      actionAtoms: drawerStructureActionAtoms,
      backendSupportsSubnetSplit: backendSupportsSubnetSplitForDrawer,
      permVerb,
      permissionDefinitions,
    });
  }, [
    grantOpen,
    drawerStructureActionAtoms,
    backendSupportsSubnetSplitForDrawer,
    permVerb,
    permissionDefinitions,
  ]);

  const permissionStructure = useMemo(
    () => filterRolePermissionStructureByKeyword(permissionStructureBase, kw),
    [permissionStructureBase, kw],
  );

  const fetchRoles = useCallback(async () => {
    try {
      const data = await apiRequest('/api/system/rbac/roles', { skipCache: true });
      if (Array.isArray(data)) {
        setRoles(data);
      } else {
        setRoles(data.roles || []);
      }
    } catch (error: unknown) {
      console.error('获取角色列表失败:', error);
    }
  }, []);

  useEffect(() => {
    fetchRoles();
  }, [fetchRoles]);

  useEffect(() => {
    const loadActions = async () => {
      try {
        const json = await apiRequest('/api/system/rbac/actions', { skipCache: true });
        const arr: string[] = Array.isArray(json?.actions) ? json.actions : [];
        setActionAtoms(arr);
        const catalog: string[] = Array.isArray(json?.tenantRootBoundary)
          ? json.tenantRootBoundary
          : [];
        setTenantRootCatalogAtoms(catalog);
      } catch {
        setActionAtoms([]);
      }
    };
    loadActions();
  }, []);

  const handlePermissionChange = useCallback(
    (action: string, checked: boolean) => {
      if (!canEditPermissions) {
        return;
      }
      if (grantTarget && isBuiltInRbacRole(grantTarget)) {
        return;
      }
      if (checked) {
        setGrantSelectedIds((prev) => {
          let next = expandRoleGrantOnCheck(action, prev);
          if (grantTarget && shouldUseTenantPermissionBoundary(grantTarget)) {
            next = clampActionsToTenantBoundary(next, tenantRootBoundaryAtoms);
          }
          return next;
        });
      } else {
        setGrantSelectedIds((prev) => prev.filter((id) => id !== action));
      }
    },
    [canEditPermissions, grantTarget, tenantRootBoundaryAtoms],
  );

  const normalizeForBackendSave = useCallback(
    (ids: string[]) =>
      normalizeRoleGrantForBackendSave(ids, backendSupportsSubnetSplitForDrawer),
    [backendSupportsSubnetSplitForDrawer],
  );

  const openAssignUser = useCallback((target: RBACRole) => {
    if (!canAssignUsersRead) {
      message.warning('无权限执行该操作');
      return;
    }
    setAssignUserTarget(target);
    setAssignUserOpen(true);
  }, [canAssignUsersRead]);

  const closeAssignDrawer = useCallback(() => {
    setAssignUserOpen(false);
    setAssignUserTarget(null);
  }, []);

  useEffect(() => {
    if (!createOpen) return;
    createForm.resetFields();
    createForm.setFieldsValue({ scope: roleTab });
  }, [createOpen, createForm, roleTab]);

  useEffect(() => {
    setSelectedRowKeys([]);
  }, [roleTab]);

  const systemRoleCount = useMemo(
    () => roles.filter((r) => r.scope === 'system').length,
    [roles],
  );
  const tenantRoleCount = useMemo(
    () => roles.filter((r) => r.scope === 'tenant').length,
    [roles],
  );

  const roleTabList = useMemo(
    () => [
      { key: 'system', tab: formatRoleTabLabel('系统角色', systemRoleCount) },
      { key: 'tenant', tab: formatRoleTabLabel('租户组织角色', tenantRoleCount) },
    ],
    [systemRoleCount, tenantRoleCount],
  );

  const handleCreate = useCallback(async () => {
    if (!canWrite) {
      message.warning('无权限执行该操作');
      return;
    }
    try {
      const vals = await createForm.validateFields();
      const payload = { name: vals.name, description: vals.description || '', scope: vals.scope };
      const created = await apiPost('/api/system/rbac/roles', payload);
      message.success('角色创建成功');
      setCreateOpen(false);
      createForm.resetFields();
      await fetchRoles();
      setGrantFromCopy(false);
      setGrantTarget(created);
      const permArr: string[] = (() => {
        try {
          const parsed = JSON.parse(String(created?.permissions || '[]'));
          return Array.isArray(parsed) ? parsed : [];
        } catch {
          return [];
        }
      })();
      setGrantSelectedIds(normalizeRoleGrantIds(permArr));
      setGrantOpen(true);
    } catch (error: unknown) {
      message.error(error instanceof Error ? error.message : '创建角色失败');
    }
  }, [canWrite, createForm, fetchRoles]);

  const openCopyRole = useCallback(
    (source: RBACRole) => {
      if (!canWrite) {
        message.warning('无权限执行该操作');
        return;
      }
      if (!canConfigurePermissions) {
        message.warning('无权限配置角色权限');
        return;
      }
      setCopySource(source);
      copyForm.setFieldsValue({
        name: suggestCopyRoleName(
          source.name,
          roles.map((r) => r.name),
        ),
        scope: source.scope,
        description: source.description
          ? `复制自「${source.name}」：${source.description}`
          : `复制自「${source.name}」`,
      });
      setCopyOpen(true);
    },
    [canWrite, canConfigurePermissions, copyForm, roles],
  );

  const handleCopyRole = useCallback(async () => {
    const source = copySource;
    if (!canWrite || !source) return;
    try {
      const vals = await copyForm.validateFields();
      const payload = { name: vals.name, description: vals.description || '', scope: vals.scope };
      const created = await apiPost('/api/system/rbac/roles', payload);
      message.success('角色已创建，请确认并保存权限');
      setCopyOpen(false);
      copyForm.resetFields();
      setCopySource(null);
      await fetchRoles();

      setGrantFromCopy(true);
      setGrantTarget(created);
      let ids = cloneRoleGrantIds(source, tenantRootBoundaryAtoms);
      const createdRole = created as RBACRole;
      if (shouldUseTenantPermissionBoundary(createdRole)) {
        ids = clampActionsToTenantBoundary(ids, tenantRootBoundaryAtoms);
      }
      setGrantSelectedIds(ids);
      setKw('');
      setPermVerb('全部');
      setGrantOpen(true);
    } catch (error: unknown) {
      message.error(error instanceof Error ? error.message : '复制角色失败');
    }
  }, [canWrite, copySource, copyForm, fetchRoles, tenantRootBoundaryAtoms]);

  const handleGrantSave = useCallback(
    async (targetKeys: string[]) => {
      if (!canConfigurePermissions) {
        message.warning('无权限执行该操作');
        return;
      }
      if (!canEditPermissions) {
        message.warning('无权限执行该操作');
        return;
      }
      if (!grantTarget) return;
      if (isBuiltInRbacRole(grantTarget)) {
        message.warning('系统内置角色不允许修改权限');
        return;
      }
      setGrantSaving(true);
      try {
        const boundedKeys =
          shouldUseTenantPermissionBoundary(grantTarget)
            ? clampActionsToTenantBoundary(targetKeys, tenantRootBoundaryAtoms)
            : targetKeys;
        const permissionsToSave = stripTenantConsoleUmbrellaPermissions(
          normalizeForBackendSave(boundedKeys),
        );
        await apiPatch(`/api/system/rbac/roles/${grantTarget.id}/permissions`, {
          permissions: permissionsToSave,
        });
        message.success('授权成功');
        setGrantOpen(false);
        setGrantFromCopy(false);
        await fetchRoles();
      } catch (error: unknown) {
        message.error(error instanceof Error ? error.message : '保存失败');
      } finally {
        setGrantSaving(false);
      }
    },
    [
      canConfigurePermissions,
      canEditPermissions,
      grantTarget,
      tenantRootBoundaryAtoms,
      normalizeForBackendSave,
      fetchRoles,
    ],
  );

  const grantDrawerCanEdit = useMemo(
    () => canEditPermissions && !!grantTarget && !isBuiltInRbacRole(grantTarget),
    [canEditPermissions, grantTarget],
  );

  const grantDrawerTitle = useMemo(() => {
    if (!grantTarget) return '配置权限';
    if (grantFromCopy) return `复制角色 · ${grantTarget.name}`;
    if (isBuiltInRbacRole(grantTarget)) return '查看权限（内置角色）';
    if (shouldUseTenantPermissionBoundary(grantTarget)) return '配置权限（租户边界）';
    return '配置权限';
  }, [grantTarget, grantFromCopy]);

  const grantDrawerScopeHint = useMemo(() => {
    if (!grantTarget) return undefined;
    if (grantFromCopy) {
      return '已载入源角色的全部权限，可在下方增删勾选后点击「保存」生效。';
    }
    if (isBuiltInRbacRole(grantTarget)) {
      return '系统内置角色：权限由产品版本定义，仅可查看；服务重启时会与代码默认策略同步。如需裁减权限请新建自定义角色。';
    }
    if (shouldUseTenantPermissionBoundary(grantTarget)) {
      return isTenantRootBuiltinRole(grantTarget)
        ? '内置云租户根用户目录为租户组织角色可选上限；本角色权限不可在此修改。'
        : '租户组织角色可选范围不超过内置「云租户根用户」目录；取消勾选后菜单项仍会展示';
    }
    return undefined;
  }, [grantTarget, grantFromCopy]);

  const openAuthorize = useCallback(
    (target: RBACRole) => {
      if (!canConfigurePermissions) {
        message.warning('无权限执行该操作');
        return;
      }
      setGrantFromCopy(false);
      setGrantTarget(target);
      let ids = stripTenantConsoleUmbrellaPermissions(normalizeRoleGrantIds(target.actions || []));
      if (shouldUseTenantPermissionBoundary(target)) {
        ids = clampActionsToTenantBoundary(ids, tenantRootBoundaryAtoms);
      }
      setGrantSelectedIds(ids);
      setGrantOpen(true);
    },
    [canConfigurePermissions, tenantRootBoundaryAtoms],
  );

  const handleDelete = useCallback(
    async (target: RBACRole) => {
      if (!canWrite) {
        message.warning('无权限执行该操作');
        return;
      }
      try {
        await apiDelete(`/api/system/rbac/roles/${target.id}`);
        message.success('删除成功');
        await fetchRoles();
      } catch (error: unknown) {
        message.error(error instanceof Error ? error.message : '删除失败');
      }
    },
    [canWrite, fetchRoles],
  );

  const fullColumns = useRoleListColumns({
    canWrite,
    canAssignUsers: canAssignUsersRead,
    canConfigurePermissions,
    modal,
    onAuthorize: openAuthorize,
    onAssignUser: openAssignUser,
    onCopyRole: openCopyRole,
    onDelete: handleDelete,
  });

  const { displayColumns: displayedColumns } = useTableColumnSettings(fullColumns, 'access_roles_v2');

  const filteredRoles = useMemo(
    () =>
      roles.filter((r) => {
        const matchKw = roleKw
          ? (r.name || '').toLowerCase().includes(roleKw.toLowerCase()) ||
            (r.description || '').toLowerCase().includes(roleKw.toLowerCase())
          : true;
        const matchKind = !roleKindFilter ? true : r.type === roleKindFilter;
        return matchKw && matchKind && r.scope === roleTab;
      }),
    [roles, roleKw, roleKindFilter, roleTab],
  );

  return (
    <PageContainer
      titleLevel={3}
      asCard={false}
      tabList={roleTabList}
      tabActiveKey={roleTab}
      onTabChange={(key) => setRoleTab(key as RoleScopeTab)}
    >
      <div className="page-toolbar">
        <Form
          className="toolbar-container"
          layout="vertical"
          style={{ display: 'flex', alignItems: 'flex-end', rowGap: 12, columnGap: 12 }}
          form={filterForm}
          onValuesChange={(_, all) => {
            setRoleKw(all.keyword || '');
            setRoleKindFilter((all.roleKind as '系统策略' | '自定义策略' | undefined) || '');
          }}
        >
          <Form.Item name="keyword">
            <Input
              allowClear
              placeholder="搜索角色名称或说明"
              className="toolbar-search"
              suffix={<SearchOutlined style={{ color: 'rgba(0,0,0,.45)' }} />}
            />
          </Form.Item>
          <Form.Item name="roleKind">
            <Select className="toolbar-filter-sm" placeholder="全部类型" allowClear>
              <Select.Option value="系统策略">内置角色</Select.Option>
              <Select.Option value="自定义策略">自定义角色</Select.Option>
            </Select>
          </Form.Item>
          <Button
            type="link"
            className="toolbar-reset-btn"
            onClick={() => {
              filterForm.resetFields();
              setRoleKw('');
              setRoleKindFilter('');
            }}
          >
            重置
          </Button>
        </Form>

        <div className="toolbar-actions">
          {canWrite && (
            <Button type="primary" onClick={() => setCreateOpen(true)}>
              {roleTab === 'tenant' ? '新建租户组织角色' : '新建系统角色'}
            </Button>
          )}
          {canWrite ? (
            <Dropdown
            menu={{
              items: [
                {
                  key: 'delete',
                  label: '批量删除',
                  danger: true,
                  onClick: () => {
                    if (!canWrite) {
                      message.warning('无权限执行该操作');
                      return;
                    }
                    if (!selectedRowKeys.length) {
                      message.warning('请先选择角色');
                      return;
                    }
                    const selectedRoles = roles.filter((r) => selectedRowKeys.includes(r.id));
                    const systemRoles = selectedRoles.filter((r) => r.type === '系统策略');
                    if (systemRoles.length > 0) {
                      message.warning(
                        `选中的角色中包含 ${systemRoles.length} 个系统预置角色，无法删除`,
                      );
                      return;
                    }
                    modal.confirm({
                      title: '确认批量删除？',
                      content: `即将删除 ${selectedRowKeys.length} 个角色`,
                      okButtonProps: { danger: true },
                      onOk: async () => {
                        try {
                          await Promise.all(
                            selectedRowKeys.map((roleId) =>
                              apiDelete(`/api/system/rbac/roles/${roleId}`),
                            ),
                          );
                          message.success(`成功删除 ${selectedRowKeys.length} 个角色`);
                          setSelectedRowKeys([]);
                          await fetchRoles();
                        } catch (error: unknown) {
                          message.error(error instanceof Error ? error.message : '批量删除失败');
                        }
                      },
                    });
                  },
                },
              ],
            }}
            trigger={['click']}
          >
            <Button icon={<EllipsisOutlined />} />
            </Dropdown>
          ) : null}
          <TableColumnSettingsButton allColumns={fullColumns} settingsKey="access_roles_v2" />
          <Button icon={<ReloadOutlined />} onClick={() => void fetchRoles()} />
        </div>
      </div>

      <Table
        className="std-table"
        rowKey="id"
        rowSelection={
          canWrite
            ? {
                selectedRowKeys,
                onChange: setSelectedRowKeys,
              }
            : undefined
        }
        dataSource={filteredRoles}
        columns={displayedColumns}
        pagination={{
          showTotal: (total) => `共 ${total} 条`,
        }}
        scroll={{ x: true }}
        bordered={false}
      />

      <Modal
        title={roleTab === 'tenant' ? '新建租户组织角色' : '新建系统角色'}
        open={createOpen}
        onCancel={() => {
          setCreateOpen(false);
          createForm.resetFields();
        }}
        onOk={() => createForm.submit()}
        okText="创建"
        okButtonProps={{ disabled: !canWrite }}
        destroyOnHidden
        width={600}
        centered
        styles={{ body: { maxHeight: '80vh', overflowY: 'auto', overflowX: 'hidden' } }}
      >
        <Form form={createForm} layout="vertical" onFinish={() => void handleCreate()}>
          <Form.Item
            name="name"
            label="角色名称"
            rules={[{ required: true, message: '请输入角色名称' }]}
          >
            <Input placeholder="例如：安全管理员" />
          </Form.Item>
          <Form.Item name="scope" hidden rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="description" label="描述">
            <Input.TextArea placeholder="角色用途说明（可选）" autoSize={{ minRows: 3, maxRows: 6 }} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={copySource ? `复制角色「${copySource.name}」` : '复制角色'}
        open={copyOpen}
        onCancel={() => {
          setCopyOpen(false);
          setCopySource(null);
          copyForm.resetFields();
        }}
        onOk={() => copyForm.submit()}
        okText="下一步：配置权限"
        okButtonProps={{ disabled: !canWrite }}
        destroyOnHidden
        width={600}
        centered
        styles={{ body: { maxHeight: '80vh', overflowY: 'auto', overflowX: 'hidden' } }}
      >
        <Form form={copyForm} layout="vertical" onFinish={() => void handleCopyRole()}>
          <Form.Item
            name="name"
            label="新角色名称"
            rules={[{ required: true, message: '请输入角色名称' }]}
          >
            <Input placeholder="例如：安全管理员-副本" />
          </Form.Item>
          <Form.Item
            name="scope"
            label="角色范围"
            rules={[{ required: true, message: '请选择角色范围' }]}
          >
            <Select placeholder="请选择角色范围" disabled>
              <Select.Option value="system">系统角色</Select.Option>
              <Select.Option value="tenant">租户组织角色</Select.Option>
            </Select>
          </Form.Item>
          <Form.Item name="description" label="描述">
            <Input.TextArea placeholder="角色用途说明（可选）" autoSize={{ minRows: 3, maxRows: 6 }} />
          </Form.Item>
        </Form>
      </Modal>

      <RolePermissionDrawer
        open={grantOpen}
        title={grantDrawerTitle}
        scopeHint={grantDrawerScopeHint}
        canEdit={grantDrawerCanEdit}
        kw={kw}
        permVerb={permVerb}
        grantSelectedIds={grantSelectedIds}
        permissionStructure={permissionStructure}
        confirmLoading={grantSaving}
        onKwChange={setKw}
        onPermVerbChange={setPermVerb}
        onClearSelected={() => {
          if (!grantDrawerCanEdit) return;
          setGrantSelectedIds([]);
        }}
        onPermissionChange={handlePermissionChange}
        onClose={() => {
          setGrantOpen(false);
          setGrantTarget(null);
          setGrantFromCopy(false);
        }}
        onSave={() => void handleGrantSave(grantSelectedIds)}
      />

      <RoleAssignUsersDrawer
        open={assignUserOpen}
        target={assignUserTarget}
        canWrite={canAssignUsersWrite}
        onClose={closeAssignDrawer}
        onSaved={() => void fetchRoles()}
      />
    </PageContainer>
  );
};

export default AccessRolesPage;
