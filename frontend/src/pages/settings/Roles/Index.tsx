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
  isTenantRootBuiltinRole,
  isTenantScopeRole,
  resolveTenantRootBoundaryActionAtoms,
  shouldUseTenantPermissionBoundary,
} from './lib/builtinRolePermissionView';
import { useRoleListColumns } from './lib/useRoleListColumns';

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
  const [filterForm] = Form.useForm();

  const [roleKw, setRoleKw] = useState('');
  const [roleType, setRoleType] = useState<string>('');

  const [kw, setKw] = useState('');
  const [permVerb, setPermVerb] = useState<'全部' | 'read' | 'write'>('全部');
  const [actionAtoms, setActionAtoms] = useState<string[]>([]);
  const [grantOpen, setGrantOpen] = useState(false);
  const [grantTarget, setGrantTarget] = useState<RBACRole | null>(null);
  const [grantSelectedIds, setGrantSelectedIds] = useState<string[]>([]);
  const [grantSaving, setGrantSaving] = useState(false);

  const [assignUserOpen, setAssignUserOpen] = useState(false);
  const [assignUserTarget, setAssignUserTarget] = useState<RBACRole | null>(null);
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);

  /** 内置云租户根用户权限边界（租户角色配置抽屉的可选上限） */
  const tenantRootBoundaryAtoms = useMemo(
    () => resolveTenantRootBoundaryActionAtoms(roles),
    [roles],
  );

  /** 系统角色用全量 actions；租户角色仅用内置云租户根用户权限范围建树 */
  const drawerStructureActionAtoms = useMemo(() => {
    if (!grantOpen) return [];
    if (grantTarget && shouldUseTenantPermissionBoundary(grantTarget)) {
      return tenantRootBoundaryAtoms.length > 0 ? tenantRootBoundaryAtoms : actionAtoms;
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
        const json = await apiRequest('/api/system/rbac/actions', { enableCache: true });
        const arr: string[] = Array.isArray(json?.actions) ? json.actions : [];
        setActionAtoms(arr);
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
      if (checked) {
        setGrantSelectedIds((prev) => {
          let next = expandRoleGrantOnCheck(action, prev);
          if (
            grantTarget &&
            isTenantScopeRole(grantTarget) &&
            tenantRootBoundaryAtoms.length > 0
          ) {
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
      setGrantSaving(true);
      try {
        const boundedKeys =
          isTenantScopeRole(grantTarget) && tenantRootBoundaryAtoms.length > 0
            ? clampActionsToTenantBoundary(targetKeys, tenantRootBoundaryAtoms)
            : targetKeys;
        const permissionsToSave = normalizeForBackendSave(boundedKeys);
        await apiPatch(`/api/system/rbac/roles/${grantTarget.id}/permissions`, {
          permissions: permissionsToSave,
        });
        message.success('授权成功');
        setGrantOpen(false);
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

  const openAuthorize = useCallback(
    (target: RBACRole) => {
      if (!canConfigurePermissions) {
        message.warning('无权限执行该操作');
        return;
      }
      setGrantTarget(target);
      let ids = normalizeRoleGrantIds(target.actions || []);
      const boundary = resolveTenantRootBoundaryActionAtoms(roles);
      if (isTenantScopeRole(target) && boundary.length > 0) {
        ids = clampActionsToTenantBoundary(ids, boundary);
      }
      setGrantSelectedIds(ids);
      setGrantOpen(true);
    },
    [canConfigurePermissions, roles],
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
        const matchType = !roleType
          ? true
          : r.type === roleType ||
            (roleType === '系统策略' && r.scope === 'system') ||
            (roleType === '自定义策略' && r.scope === 'tenant');
        return matchKw && matchType;
      }),
    [roles, roleKw, roleType],
  );

  return (
    <PageContainer titleLevel={3} asCard={false}>
      <div className="page-toolbar">
        <Form
          className="toolbar-container"
          layout="vertical"
          style={{ display: 'flex', alignItems: 'flex-end', rowGap: 12, columnGap: 12 }}
          form={filterForm}
          onValuesChange={(_, all) => {
            setRoleKw(all.keyword || '');
            setRoleType(all.type ?? '');
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
          <Form.Item name="type">
            <Select className="toolbar-filter-sm" placeholder="全部类型" allowClear>
              <Select.Option value="系统策略">系统角色</Select.Option>
              <Select.Option value="自定义策略">自定义角色</Select.Option>
            </Select>
          </Form.Item>
          <Button
            type="link"
            className="toolbar-reset-btn"
            onClick={() => {
              filterForm.resetFields();
              setRoleKw('');
              setRoleType('');
            }}
          >
            重置
          </Button>
        </Form>

        <div className="toolbar-actions">
          {canWrite && (
            <Button type="primary" onClick={() => setCreateOpen(true)}>
              新建角色
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
        title="新建授权角色"
        open={createOpen}
        onCancel={() => setCreateOpen(false)}
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
          <Form.Item
            name="scope"
            label="角色范围"
            rules={[{ required: true, message: '请选择角色范围' }]}
          >
            <Select placeholder="请选择角色范围">
              <Select.Option value="system">系统角色</Select.Option>
              <Select.Option value="tenant">租户角色</Select.Option>
            </Select>
          </Form.Item>
          <Form.Item name="description" label="描述">
            <Input.TextArea placeholder="角色用途说明（可选）" autoSize={{ minRows: 3, maxRows: 6 }} />
          </Form.Item>
        </Form>
      </Modal>

      <RolePermissionDrawer
        open={grantOpen}
        title={
          grantTarget && isTenantScopeRole(grantTarget) ? '配置权限（租户角色）' : '配置权限'
        }
        scopeHint={
          grantTarget && isTenantScopeRole(grantTarget)
            ? isTenantRootBuiltinRole(grantTarget)
              ? '内置云租户根用户：可在下列权限范围内自定义（保存后亦作为其他租户角色的可选上限）'
              : '可选权限不超过内置「云租户根用户」范围'
            : undefined
        }
        canEdit={canEditPermissions}
        kw={kw}
        permVerb={permVerb}
        grantSelectedIds={grantSelectedIds}
        permissionStructure={permissionStructure}
        confirmLoading={grantSaving}
        onKwChange={setKw}
        onPermVerbChange={setPermVerb}
        onClearSelected={() => {
          if (!canEditPermissions) return;
          setGrantSelectedIds([]);
        }}
        onPermissionChange={handlePermissionChange}
        onClose={() => {
          setGrantOpen(false);
          setGrantTarget(null);
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
