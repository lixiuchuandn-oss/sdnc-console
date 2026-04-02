import React, { useMemo, useState } from 'react';
import {
  App,
  Button,
  Divider,
  Empty,
  Input,
  Modal,
  Popconfirm,
  Space,
  Spin,
  Table,
  Tag,
  Tooltip,
  Typography,
  message,
} from 'antd';
import { PlusOutlined, SearchOutlined, UnorderedListOutlined } from '@ant-design/icons';
import StdSideDrawer from '../../../../components/StdSideDrawer';
import { apiDelete, apiPost, apiRequest } from '../../../../services/api';
import type { Assignment, RBACRole, SysUser } from '../types';

const { Text } = Typography;

type Props = {
  open: boolean;
  target: RBACRole | null;
  onClose: () => void;
  onSaved?: () => void;
};

const RoleAssignUsersDrawer: React.FC<Props> = ({ open, target, onClose, onSaved }) => {
  const { modal } = App.useApp();
  const [users, setUsers] = useState<SysUser[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [existing, setExisting] = useState<Assignment[]>([]);
  const [allAssignments, setAllAssignments] = useState<Assignment[]>([]);
  const [roles, setRoles] = useState<RBACRole[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [memberKw, setMemberKw] = useState('');
  const [addKw, setAddKw] = useState('');
  const [detailOpen, setDetailOpen] = useState(false);

  const loadData = React.useCallback(async (role: RBACRole) => {
    try {
      setLoading(true);
      setLoadError('');
      const usersJson = await apiRequest('/api/users', { skipCache: true });
      const usersList: SysUser[] = Array.isArray(usersJson)
        ? usersJson
        : Array.isArray(usersJson?.users)
          ? usersJson.users
          : [];
      setUsers(usersList);

      const rolesJson = await apiRequest('/api/system/rbac/roles', { skipCache: true }).catch(() => []);
      const rolesList: RBACRole[] = Array.isArray(rolesJson)
        ? rolesJson
        : Array.isArray((rolesJson as any)?.roles)
          ? (rolesJson as any).roles
          : [];
      setRoles(rolesList);

      const activeUserIds = usersList
        .filter((u) => u.username !== 'admin' && u.status === 'active')
        .map((u) => String(u.id));
      const allAssignmentsJson = await apiRequest(
        `/api/system/rbac/assignments/by-users?userType=system&userIds=${encodeURIComponent(activeUserIds.join(','))}`,
        { skipCache: true },
      ).catch(() => ({ assignments: [] }));
      const allAssignmentsList: Assignment[] = Array.isArray(allAssignmentsJson?.assignments)
        ? allAssignmentsJson.assignments
        : [];
      setAllAssignments(allAssignmentsList);

      const assignmentsJson = await apiRequest(
        `/api/system/rbac/assignments/by-role?roleId=${encodeURIComponent(role.id)}&userType=system`,
        { skipCache: true },
      ).catch(() => ({ assignments: [] }));
      const roleAssignments: Assignment[] = Array.isArray(assignmentsJson?.assignments)
        ? assignmentsJson.assignments
        : [];
      setExisting(roleAssignments);
      setSelected(roleAssignments.map((x) => String(x.userId)));
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

  /** 三权/三全角色：不在 mergeSelection 中强制合并内置（与旧逻辑一致） */
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

  const activeUsers = useMemo(
    () => users.filter((u) => u.username !== 'admin' && u.status === 'active'),
    [users],
  );

  /** 本角色成员：内置与普通用户同一列表，用户优先排序 */
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

  /** 下区：可添加的候选（未加入、非内置；内置不可在此新增） */
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
        width: 130,
        render: (v: string) => <Text>{v}</Text>,
      },
      {
        title: '姓名',
        dataIndex: 'fullName',
        key: 'fullName',
        width: 120,
        render: (v: string, row: SysUser) => <Text>{v || row.username}</Text>,
      },
      {
        title: '邮箱',
        dataIndex: 'email',
        key: 'email',
        ellipsis: true,
      },
      {
        title: '类型',
        key: 'kind',
        width: 80,
        align: 'center',
        render: (_: unknown, row: SysUser) =>
          row.builtIn ? <Tag color="default">内置</Tag> : <Tag color="blue">用户</Tag>,
      },
      {
        title: '其他角色',
        key: 'cross',
        width: 100,
        align: 'center',
        render: (_: unknown, row: SysUser) => renderOtherRolesCell(row),
      },
    ];
    cols.push({
      title: '操作',
      key: 'op',
      width: 72,
      align: 'center',
      render: (_: unknown, row: SysUser) => {
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
  }, [renderOtherRolesCell, handleRemove]);

  const candidateColumns = useMemo(() => {
    const cols: any[] = [
      {
        title: '用户名',
        dataIndex: 'username',
        key: 'username',
        width: 130,
        render: (v: string) => <Text>{v}</Text>,
      },
      {
        title: '姓名',
        dataIndex: 'fullName',
        key: 'fullName',
        width: 120,
        render: (v: string, row: SysUser) => <Text>{v || row.username}</Text>,
      },
      {
        title: '邮箱',
        dataIndex: 'email',
        key: 'email',
        ellipsis: true,
      },
      {
        title: '类型',
        key: 'kind',
        width: 80,
        align: 'center',
        render: () => <Tag color="blue">用户</Tag>,
      },
      {
        title: '其他角色',
        key: 'cross',
        width: 100,
        align: 'center',
        render: (_: unknown, row: SysUser) => renderOtherRolesCell(row),
      },
    ];
    cols.push({
      title: '操作',
      key: 'op',
      width: 72,
      align: 'center',
      render: (_: unknown, row: SysUser) => (
        <Button type="link" size="small" icon={<PlusOutlined />} onClick={() => handleAdd(String(row.id))}>
          加入
        </Button>
      ),
    });
    return cols;
  }, [renderOtherRolesCell, handleAdd]);

  const userById = useMemo(() => {
    const m = new Map<string, SysUser>();
    users.forEach((u) => m.set(String(u.id), u));
    return m;
  }, [users]);

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
    if (!target) return;
    if (!delta.needAdd.length && !delta.needRemove.length) {
      message.info('没有变更，无需保存');
      return;
    }
    try {
      setSaving(true);
      for (const userId of delta.needAdd) {
        await apiPost('/api/system/rbac/assignments', {
          roleId: target.id,
          userType: 'system',
          userId,
        });
      }
      for (const item of delta.needRemove) {
        await apiDelete(`/api/system/rbac/assignments/${encodeURIComponent(item.id)}`);
      }
      message.success(`用户分配已保存（新增 ${delta.needAdd.length}，移除 ${delta.needRemove.length}）`);
      onClose();
      onSaved?.();
    } catch (error: any) {
      message.error(error?.message || '保存失败');
    } finally {
      setSaving(false);
    }
  }, [target, delta, onClose, onSaved]);

  const memberInRoleCount = activeUsers.filter((u) => selected.includes(String(u.id))).length;

  return (
    <StdSideDrawer
      title={`授予用户 - ${target?.name || ''}`}
      open={open}
      onClose={safeClose}
      onOk={handleSave}
      okText={dirty ? `保存变更（+${delta.needAdd.length} / -${delta.needRemove.length}）` : '无变更'}
      confirmLoading={saving}
      width={900}
    >
      <Space direction="vertical" size={12} style={{ width: '100%' }}>
        {loadError ? (
          <Space wrap>
            <Text type="danger">{loadError}</Text>
            <Button size="small" onClick={() => target && loadData(target)}>
              重试
            </Button>
          </Space>
        ) : null}

        <Spin spinning={loading}>
          <Space direction="vertical" size={16} style={{ width: '100%' }}>
            {/* 上区：本角色成员 — 与「添加成员」相同：首行标题行，次行搜索 */}
            <div>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 12,
                  flexWrap: 'wrap',
                  marginBottom: 8,
                }}
              >
                <Space align="center" wrap>
                  <Typography.Title level={5} style={{ margin: 0 }}>
                    本角色成员
                  </Typography.Title>
                  <Tag>{memberInRoleCount} 人</Tag>
                </Space>
                {dirty ? (
                  <Button type="link" size="small" icon={<UnorderedListOutlined />} onClick={() => setDetailOpen(true)}>
                    查看待保存明细
                  </Button>
                ) : null}
              </div>
              <Input
                allowClear
                placeholder="在成员中搜索"
                value={memberKw}
                onChange={(e) => setMemberKw(e.target.value)}
                suffix={<SearchOutlined style={{ color: 'rgba(0,0,0,.45)' }} />}
                style={{ width: '100%', marginBottom: 8 }}
              />
              {membersInRole.length === 0 ? (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无成员，请在下方添加" />
              ) : (
                <Table
                  rowKey={(r) => String(r.id)}
                  size="small"
                  pagination={{ size: 'small', pageSize: 6, showTotal: (t) => `共 ${t} 条` }}
                  dataSource={membersInRole}
                  columns={memberColumns}
                />
              )}
            </div>

            <Divider style={{ margin: '4px 0' }} />

            {/* 下区：添加成员 — 首行标题，次行说明，再次行搜索（与上区搜索同宽对齐） */}
            <div>
              <Typography.Title level={5} style={{ margin: '0 0 8px' }}>
                添加成员
              </Typography.Title>
              <Input
                allowClear
                placeholder="搜索用户名 / 姓名 / 邮箱"
                value={addKw}
                onChange={(e) => setAddKw(e.target.value)}
                suffix={<SearchOutlined style={{ color: 'rgba(0,0,0,.45)' }} />}
                style={{ width: '100%', marginBottom: 8 }}
              />
              <Table
                rowKey={(r) => String(r.id)}
                size="small"
                pagination={{ size: 'small', pageSize: 6, showTotal: (t) => `共 ${t} 条` }}
                dataSource={candidates}
                columns={candidateColumns}
                locale={{ emptyText: '没有可添加的用户（或已全部在本角色中）' }}
              />
            </div>
          </Space>
        </Spin>
      </Space>

      <Modal
        title="待保存变更明细"
        open={detailOpen}
        footer={null}
        onCancel={() => setDetailOpen(false)}
        width={480}
      >
        <Space direction="vertical" style={{ width: '100%' }} size="middle">
          <div>
            <Text strong>将新增（{delta.needAdd.length}）</Text>
            <ul style={{ margin: '8px 0 0', paddingLeft: 20 }}>
              {delta.needAdd.length === 0 ? (
                <li>无</li>
              ) : (
                delta.needAdd.map((id) => {
                  const u = userById.get(id);
                  return (
                    <li key={id}>
                      {u ? `${u.username}（${u.fullName || u.username}）` : id}
                    </li>
                  );
                })
              )}
            </ul>
          </div>
          <div>
            <Text strong>将移除（{delta.needRemove.length}）</Text>
            <ul style={{ margin: '8px 0 0', paddingLeft: 20 }}>
              {delta.needRemove.length === 0 ? (
                <li>无</li>
              ) : (
                delta.needRemove.map((a) => {
                  const u = userById.get(String(a.userId));
                  return (
                    <li key={a.id}>
                      {u ? `${u.username}（${u.fullName || u.username}）` : a.userId}
                    </li>
                  );
                })
              )}
            </ul>
          </div>
        </Space>
      </Modal>
    </StdSideDrawer>
  );
};

export default RoleAssignUsersDrawer;
