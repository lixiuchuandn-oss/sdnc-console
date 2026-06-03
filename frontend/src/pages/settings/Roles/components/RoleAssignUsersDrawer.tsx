import React, { useMemo, useState } from 'react';
import {
  App,
  Button,
  Card,
  Drawer,
  Empty,
  Flex,
  Input,
  Popconfirm,
  Space,
  Spin,
  Table,
  Tag,
  Tooltip,
  Typography,
  message,
} from 'antd';
import type { DrawerProps } from 'antd';
import { apiDelete, apiPost } from '../../../../services/api';
import { loadRoleAssignUsersData } from '../lib/roleAssignUsersLoad';
import type { Assignment, RBACRole, RbacAssignmentUserType, SysUser } from '../types';

const { Text } = Typography;

const G = 10;

const drawerStyles: DrawerProps['styles'] = {
  body: {
    display: 'flex',
    flexDirection: 'column',
    flex: 1,
    minHeight: 0,
    overflow: 'hidden',
    padding: G,
  },
  footer: {
    marginTop: 0,
    padding: G,
    flexShrink: 0,
  },
};

type Props = {
  open: boolean;
  target: RBACRole | null;
  canWrite?: boolean;
  onClose: () => void;
  onSaved?: () => void;
};

const RoleAssignUsersDrawer: React.FC<Props> = ({ open, target, canWrite = false, onClose, onSaved }) => {
  const { modal } = App.useApp();
  const [users, setUsers] = useState<SysUser[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [existing, setExisting] = useState<Assignment[]>([]);
  const [allAssignments, setAllAssignments] = useState<Assignment[]>([]);
  const [roles, setRoles] = useState<RBACRole[]>([]);
  const [userType, setUserType] = useState<RbacAssignmentUserType>('system');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [memberKw, setMemberKw] = useState('');
  const [addKw, setAddKw] = useState('');
  const loadData = React.useCallback(async (role: RBACRole) => {
    try {
      setLoading(true);
      setLoadError('');
      const data = await loadRoleAssignUsersData(role);
      setUserType(data.userType);
      setUsers(data.users);
      setRoles(data.roles);
      setAllAssignments(data.allAssignments);
      setExisting(data.roleAssignments);
      setSelected(data.roleAssignments.map((x) => String(x.userId)));
    } catch {
      setLoadError('加载用户分配信息失败，请重试');
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    if (!open || !target) return;
    setUsers([]);
    setExisting([]);
    setSelected([]);
    setMemberKw('');
    setAddKw('');
    loadData(target);
  }, [open, target, loadData]);

  const triPower = Boolean(target && /三权|三全/.test(String(target?.name || '')));

  const lockedBuiltInUserIds = useMemo(() => {
    if (triPower) return new Set<string>();
    const ids = new Set<string>();
    existing.forEach((a) => {
      const u = users.find((x) => String(x.id) === String(a.userId));
      if (u?.builtIn) ids.add(String(a.userId));
    });
    return ids;
  }, [triPower, existing, users]);

  const mergeSelection = React.useCallback(
    (keys: string[]) => {
      if (triPower) return keys;
      const merged = new Set(keys);
      lockedBuiltInUserIds.forEach((id) => merged.add(id));
      return Array.from(merged);
    },
    [triPower, lockedBuiltInUserIds],
  );

  const delta = useMemo(() => {
    const current = new Set(existing.map((x) => String(x.userId)));
    const needAdd = selected.filter((userId) => !current.has(userId));
    const needRemove = existing.filter((x) => !selected.includes(String(x.userId)));
    return { needAdd, needRemove };
  }, [existing, selected]);

  const dirty = delta.needAdd.length > 0 || delta.needRemove.length > 0;

  const roleNameById = useMemo(() => {
    const m = new Map<string, string>();
    roles.forEach((r) => {
      if (r?.id) m.set(String(r.id), String(r.name || ''));
    });
    return m;
  }, [roles]);

  const roleIdsByUserId = useMemo(() => {
    const m = new Map<string, string[]>();
    allAssignments.forEach((a) => {
      const uid = String(a.userId);
      const rid = String(a.roleId);
      const list = m.get(uid);
      if (list) list.push(rid);
      else m.set(uid, [rid]);
    });
    m.forEach((list, uid) => {
      m.set(uid, Array.from(new Set(list)));
    });
    return m;
  }, [allAssignments]);

  const matchesKw = (u: SysUser, q: string) => {
    if (!q) return true;
    const t = q.trim().toLowerCase();
    return (
      String(u.username || '').toLowerCase().includes(t) ||
      String(u.fullName || '').toLowerCase().includes(t) ||
      String(u.email || '').toLowerCase().includes(t)
    );
  };

  const activeUsers = useMemo(() => {
    return users.filter((u) => {
      if (u.status !== 'active') return false;
      if (userType === 'system' && u.username === 'admin') return false;
      return true;
    });
  }, [users, userType]);

  const membersInRole = useMemo(() => {
    const q = memberKw;
    const list = activeUsers.filter((u) => selected.includes(String(u.id)) && matchesKw(u, q));
    return [...list].sort((a, b) => {
      const ab = a.builtIn ? 1 : 0;
      const bb = b.builtIn ? 1 : 0;
      if (ab !== bb) return ab - bb;
      return String(a.username || '').localeCompare(String(b.username || ''));
    });
  }, [activeUsers, selected, memberKw]);

  const candidates = useMemo(() => {
    const q = addKw;
    return activeUsers.filter(
      (u) => !selected.includes(String(u.id)) && !u.builtIn && matchesKw(u, q),
    );
  }, [activeUsers, selected, addKw]);

  const handleRemove = React.useCallback(
    (userId: string) => {
      const u = users.find((x) => String(x.id) === userId);
      if (u?.builtIn) return;
      setSelected(mergeSelection(selected.filter((id) => id !== userId)));
    },
    [mergeSelection, selected, users],
  );

  const handleAdd = React.useCallback(
    (userId: string) => {
      setSelected(mergeSelection([...selected, userId]));
    },
    [mergeSelection, selected],
  );

  const renderOtherRolesCell = React.useCallback(
    (row: SysUser) => {
      const roleIds = roleIdsByUserId.get(String(row.id)) || [];
      const other = roleIds.filter((id) => id !== String(target?.id));
      if (other.length === 0) return <Tag>无</Tag>;
      const names = other
        .map((id) => roleNameById.get(id) || id)
        .filter(Boolean)
        .join('、');
      return names ? (
        <Tooltip title={names}>
          <Tag color="geekblue">{`${other.length} 个`}</Tag>
        </Tooltip>
      ) : (
        <Tag color="geekblue">{`${other.length} 个`}</Tag>
      );
    },
    [roleIdsByUserId, roleNameById, target?.id],
  );

  const memberColumns = useMemo(() => {
    const cols: any[] = [
      {
        title: '用户名',
        dataIndex: 'username',
        key: 'username',
        align: 'left' as const,
        render: (v: string) => <Text>{v}</Text>,
      },
      {
        title: '姓名',
        dataIndex: 'fullName',
        key: 'fullName',
        align: 'left' as const,
        render: (v: string, row: SysUser) => <Text>{v || row.username}</Text>,
      },
      {
        title: '类型',
        key: 'kind',
        align: 'left' as const,
        render: (_: unknown, row: SysUser) =>
          row.builtIn ? <Tag color="default">内置</Tag> : <Tag color="blue">用户</Tag>,
      },
      {
        title: '其他角色',
        key: 'cross',
        align: 'left' as const,
        render: (_: unknown, row: SysUser) => renderOtherRolesCell(row),
      },
    ];
    cols.push({
      title: '操作',
      key: 'op',
      width: 80,
      align: 'left' as const,
      fixed: 'right' as const,
      render: (_: unknown, row: SysUser) => {
        if (!canWrite) return <Text type="secondary">—</Text>;
        const id = String(row.id);
        if (row.builtIn) {
          return (
            <Tooltip title="内置用户不可在此移除">
              <Button type="link" size="small" disabled>
                移除
              </Button>
            </Tooltip>
          );
        }
        return (
          <Popconfirm title="从本角色移除该用户？" okText="移除" cancelText="取消" onConfirm={() => handleRemove(id)}>
            <Button type="link" size="small" danger>
              移除
            </Button>
          </Popconfirm>
        );
      },
    });
    return cols;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [renderOtherRolesCell, handleRemove]);

  const candidateColumns = useMemo(() => {
    const cols: any[] = [
      {
        title: '用户名',
        dataIndex: 'username',
        key: 'username',
        align: 'left' as const,
        render: (v: string) => <Text>{v}</Text>,
      },
      {
        title: '姓名',
        dataIndex: 'fullName',
        key: 'fullName',
        align: 'left' as const,
        render: (v: string, row: SysUser) => <Text>{v || row.username}</Text>,
      },
      ...(userType === 'tenant'
        ? [
            {
              title: '租户',
              key: 'tenant',
              align: 'left' as const,
              ellipsis: true,
              render: (_: unknown, row: SysUser) => (
                <Text type="secondary">{row.tenant?.name || '—'}</Text>
              ),
            },
          ]
        : []),
      {
        title: '类型',
        key: 'kind',
        align: 'left' as const,
        render: () => <Tag color="blue">用户</Tag>,
      },
      {
        title: '其他角色',
        key: 'cross',
        align: 'left' as const,
        render: (_: unknown, row: SysUser) => renderOtherRolesCell(row),
      },
    ];
    cols.push({
      title: '操作',
      key: 'op',
      width: 80,
      align: 'left' as const,
      fixed: 'right' as const,
      render: (_: unknown, row: SysUser) =>
        canWrite ? (
          <Button type="link" size="small" onClick={() => handleAdd(String(row.id))}>
            加入
          </Button>
        ) : (
          <Text type="secondary">—</Text>
        ),
    });
    return cols;
  }, [canWrite, renderOtherRolesCell, handleAdd, userType]);

  const safeClose = React.useCallback(() => {
    if (!dirty) {
      onClose();
      return;
    }
    modal.confirm({
      title: '放弃未保存的变更？',
      content: `将丢失新增 ${delta.needAdd.length} 项、移除 ${delta.needRemove.length} 项的修改。`,
      okText: '放弃',
      cancelText: '继续编辑',
      onOk: onClose,
    });
  }, [dirty, delta.needAdd.length, delta.needRemove.length, modal, onClose]);

  const handleSave = React.useCallback(async () => {
    if (!canWrite) {
      message.warning('无权限执行该操作');
      return;
    }
    if (!target) return;
    if (!delta.needAdd.length && !delta.needRemove.length) {
      message.info('没有变更，无需保存');
      return;
    }
    try {
      setSaving(true);
      await Promise.all([
        ...delta.needAdd.map((userId) =>
          apiPost('/api/system/rbac/assignments', {
            roleId: target.id,
            userType: 'system',
            userId,
          }),
        ),
        ...delta.needRemove.map((item) =>
          apiDelete(`/api/system/rbac/assignments/${encodeURIComponent(item.id)}`),
        ),
      ]);
      message.success(`用户分配已保存（新增 ${delta.needAdd.length}，移除 ${delta.needRemove.length}）`);
      onClose();
      onSaved?.();
    } catch (error: any) {
      message.error(error?.message || '保存失败');
    } finally {
      setSaving(false);
    }
  }, [canWrite, target, userType, delta, onClose, onSaved]);

  const memberInRoleCount = activeUsers.filter((u) => selected.includes(String(u.id))).length;

  /** 左右分栏后单表区域较窄，略大于半宽即可触发横向滚动（固定列） */
  const tableScrollX: number | string = 'max-content';

  return (
    <Drawer
      rootClassName="role-assign-users-drawer"
      title="授予用户"
      placement="right"
      width={1280}
      open={open}
      onClose={safeClose}
      destroyOnHidden
      maskClosable
      styles={drawerStyles}
      footer={
        <Flex justify="flex-end" gap={G}>
          <Button onClick={safeClose}>取消</Button>
          {canWrite ? (
            <Button
              type="primary"
              onClick={handleSave}
              loading={saving}
              disabled={!dirty}
            >
              {dirty ? `保存（+${delta.needAdd.length} / -${delta.needRemove.length}）` : '无变更'}
            </Button>
          ) : null}
        </Flex>
      }
    >
      <Flex vertical gap={G} style={{ flex: 1, minHeight: 0, width: '100%', height: '100%' }}>
        {loadError ? (
          <Flex wrap="wrap" gap={G} align="center" style={{ flexShrink: 0 }}>
            <Text type="danger">{loadError}</Text>
            <Button size="small" onClick={() => target && loadData(target)}>
              重试
            </Button>
          </Flex>
        ) : null}

        <Spin
          spinning={loading}
          wrapperClassName="role-assign-users-drawer-spin"
          style={{ flex: 1, minHeight: 0, width: '100%', height: '100%' }}
        >
          <Flex
            gap={G}
            style={{
              flex: 1,
              minHeight: 0,
              width: '100%',
              height: '100%',
              alignItems: 'stretch',
            }}
          >
            <Card
              className="role-assign-users-drawer-card"
              size="small"
              variant="borderless"
              title={
                <Space size={G} wrap>
                  <span style={{ fontWeight: 500 }}>本角色成员</span>
                  <Tag>{memberInRoleCount} 人</Tag>
                </Space>
              }
              style={{
                flex: '1 1 0',
                minWidth: 0,
                minHeight: 0,
                height: '100%',
                maxHeight: '100%',
                display: 'flex',
                flexDirection: 'column',
                overflow: 'hidden',
                border: '1px solid var(--ant-color-border-secondary, #f0f0f0)',
                borderRadius: 8,
                boxShadow: 'none',
              }}
              styles={{
                header: { padding: G, minHeight: 'auto', flexShrink: 0 },
                body: {
                  flex: 1,
                  minHeight: 0,
                  overflow: 'hidden',
                  display: 'flex',
                  flexDirection: 'column',
                  padding: G,
                },
              }}
            >
              <Input.Search
                allowClear
                placeholder="在成员中搜索（用户名、姓名、邮箱）"
                value={memberKw}
                onChange={(e) => setMemberKw(e.target.value)}
                style={{ width: '100%', marginBottom: G }}
              />
              <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
                {membersInRole.length === 0 ? (
                  <Empty
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                    description={
                      memberKw.trim()
                        ? '未找到匹配成员'
                        : '暂无成员，请在右侧卡片中添加'
                    }
                  />
                ) : (
                  <Table
                    className="std-table"
                    rowKey={(r) => String(r.id)}
                    size="small"
                    pagination={{ size: 'small', pageSize: 6, showTotal: (t) => `共 ${t} 条` }}
                    dataSource={membersInRole}
                    columns={memberColumns}
                    scroll={{ x: tableScrollX }}
                    bordered={false}
                  />
                )}
              </div>
            </Card>

            <Card
              className="role-assign-users-drawer-card"
              size="small"
              variant="borderless"
              title={<span style={{ fontWeight: 500 }}>添加成员</span>}
              style={{
                flex: '1 1 0',
                minWidth: 0,
                minHeight: 0,
                height: '100%',
                maxHeight: '100%',
                display: 'flex',
                flexDirection: 'column',
                overflow: 'hidden',
                border: '1px solid var(--ant-color-border-secondary, #f0f0f0)',
                borderRadius: 8,
                boxShadow: 'none',
              }}
              styles={{
                header: { padding: G, minHeight: 'auto', flexShrink: 0 },
                body: {
                  flex: 1,
                  minHeight: 0,
                  overflow: 'hidden',
                  display: 'flex',
                  flexDirection: 'column',
                  padding: G,
                },
              }}
            >
              <Input.Search
                allowClear
                placeholder="搜索用户（用户名、姓名、邮箱）"
                value={addKw}
                onChange={(e) => setAddKw(e.target.value)}
                style={{ width: '100%', marginBottom: G }}
              />
              <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
                {candidates.length === 0 ? (
                  <Empty
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                    description={
                      addKw.trim()
                        ? '未找到匹配用户'
                        : '没有可添加的用户'
                    }
                  />
                ) : (
                  <Table
                    className="std-table"
                    rowKey={(r) => String(r.id)}
                    size="small"
                    pagination={{ size: 'small', pageSize: 6, showTotal: (t) => `共 ${t} 条` }}
                    dataSource={candidates}
                    columns={candidateColumns}
                    scroll={{ x: tableScrollX }}
                    bordered={false}
                  />
                )}
              </div>
            </Card>
          </Flex>
        </Spin>
      </Flex>
    </Drawer>
  );
};

export default RoleAssignUsersDrawer;
