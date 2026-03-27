import React, { useMemo, useState } from 'react';
import { Alert, App, Button, Input, Space, Spin, Table, Tag, Typography, message } from 'antd';
import { SearchOutlined } from '@ant-design/icons';
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
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [kw, setKw] = useState('');

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

      const activeUsers = usersList.filter((u) => u.username !== 'admin' && u.status === 'active');
      const assignmentsPromises = activeUsers.map((u) =>
        apiRequest(`/api/system/rbac/assignments?userType=system&userId=${encodeURIComponent(u.id)}`).catch(
          () => ({ assignments: [] }),
        ),
      );
      const assignmentResults = await Promise.all(assignmentsPromises);
      const allAssignments: Assignment[] = [];
      assignmentResults.forEach((result: any) => {
        const list: Assignment[] = Array.isArray(result?.assignments) ? result.assignments : [];
        allAssignments.push(...list);
      });
      const roleAssignments = allAssignments.filter((a) => a.roleId === role.id);
      setExisting(roleAssignments);
      setSelected(roleAssignments.map((x) => x.userId));
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
    setKw('');
    loadData(target);
  }, [open, target, loadData]);

  const delta = useMemo(() => {
    const current = new Set(existing.map((x) => x.userId));
    const needAdd = selected.filter((userId) => !current.has(userId));
    const needRemove = existing.filter((x) => !selected.includes(x.userId));
    return { needAdd, needRemove };
  }, [existing, selected]);

  const dirty = delta.needAdd.length > 0 || delta.needRemove.length > 0;

  const assignableUsers = useMemo(() => {
    const q = kw.trim().toLowerCase();
    return users
      .filter((u) => u.username !== 'admin' && u.status === 'active')
      .filter((u) => {
        if (!q) return true;
        return (
          String(u.username || '').toLowerCase().includes(q) ||
          String(u.fullName || '').toLowerCase().includes(q) ||
          String(u.email || '').toLowerCase().includes(q)
        );
      });
  }, [users, kw]);

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

  return (
    <StdSideDrawer
      title={`授予用户 - ${target?.name || ''}`}
      open={open}
      onClose={safeClose}
      onOk={handleSave}
      okText={dirty ? `保存变更（+${delta.needAdd.length} / -${delta.needRemove.length}）` : '无变更'}
      confirmLoading={saving}
      width={700}
    >
      <Space direction="vertical" size={12} style={{ width: '100%' }}>
        <Alert
          type={dirty ? 'warning' : 'info'}
          showIcon
          message={
            dirty
              ? `待保存变更：新增 ${delta.needAdd.length}，移除 ${delta.needRemove.length}`
              : `已分配 ${selected.length} 位用户，当前无未保存变更`
          }
        />
        {loadError ? (
          <Alert
            type="error"
            showIcon
            message={loadError}
            action={
              <Button size="small" onClick={() => target && loadData(target)}>
                重试
              </Button>
            }
          />
        ) : null}
        <Spin spinning={loading}>
          <Space direction="vertical" size={8} style={{ width: '100%' }}>
            <Input
              allowClear
              placeholder="搜索用户名 / 姓名 / 邮箱"
              value={kw}
              onChange={(e) => setKw(e.target.value)}
              suffix={<SearchOutlined style={{ color: 'rgba(0,0,0,.45)' }} />}
            />
            <Table
              rowKey="id"
              size="small"
              pagination={{ size: 'small', pageSize: 8, showTotal: (total) => `共 ${total} 条` }}
              dataSource={assignableUsers}
              rowSelection={{
                selectedRowKeys: selected,
                preserveSelectedRowKeys: true,
                onChange: (keys) => setSelected(keys as string[]),
              }}
              columns={[
                {
                  title: '用户名',
                  dataIndex: 'username',
                  key: 'username',
                  width: 180,
                  render: (v: string) => <Text>{v}</Text>,
                },
                {
                  title: '姓名',
                  dataIndex: 'fullName',
                  key: 'fullName',
                  width: 180,
                  render: (v: string, row: SysUser) => <Text>{v || row.username}</Text>,
                },
                {
                  title: '邮箱',
                  dataIndex: 'email',
                  key: 'email',
                  ellipsis: true,
                },
                {
                  title: '已授予',
                  key: 'assigned',
                  width: 90,
                  align: 'center',
                  render: (_: unknown, row: SysUser) =>
                    selected.includes(row.id) ? <Tag color="blue">是</Tag> : <Tag>否</Tag>,
                },
              ]}
            />
          </Space>
        </Spin>
      </Space>
    </StdSideDrawer>
  );
};

export default RoleAssignUsersDrawer;
