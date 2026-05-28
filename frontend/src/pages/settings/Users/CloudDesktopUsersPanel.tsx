import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  App,
  Button,
  Form,
  Input,
  Modal,
  Select,
  Space,
  Table,
  Tag,
  Typography,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import ResourceActionsDropdown from '../../../components/ResourceActionsDropdown';
import { useCloudDesktopPermission } from '../../../hooks/useCloudDesktopPermission';
import {
  createCloudDesktopUser,
  deleteCloudDesktopUser,
  fetchCloudDesktopUsers,
  syncCloudDesktopUsers,
  updateCloudDesktopUser,
  type CloudDesktopUserDto,
} from '../../../services/guacamoleApi';

const CloudDesktopUsersPanel: React.FC = () => {
  const { message } = App.useApp();
  const { canWrite } = useCloudDesktopPermission();

  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [rows, setRows] = useState<CloudDesktopUserDto[]>([]);
  const [kw, setKw] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<CloudDesktopUserDto | null>(null);
  const [form] = Form.useForm();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchCloudDesktopUsers();
      setRows(Array.isArray(res?.data) ? res.data : []);
    } catch (e: unknown) {
      message.error(e instanceof Error ? e.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, [message]);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const q = kw.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) =>
        r.username.toLowerCase().includes(q) ||
        r.fullName.toLowerCase().includes(q) ||
        (r.email || '').toLowerCase().includes(q),
    );
  }, [rows, kw]);

  const onSyncAll = async () => {
    setSyncing(true);
    try {
      const res = await syncCloudDesktopUsers();
      message.success(res.message || '同步完成');
      await load();
    } catch (e: unknown) {
      message.error(e instanceof Error ? e.message : '同步失败');
    } finally {
      setSyncing(false);
    }
  };

  const columns: ColumnsType<CloudDesktopUserDto> = [
    {
      title: '用户名',
      dataIndex: 'username',
      key: 'username',
      fixed: 'left',
      render: (v, row) => (
        <Space>
          <Tag color="purple">云桌面用户</Tag>
          <Typography.Text strong>{v}</Typography.Text>
        </Space>
      ),
    },
    { title: '姓名', dataIndex: 'fullName', key: 'fullName' },
    { title: '网关登录账号', dataIndex: 'guacamoleUsername', key: 'guacamoleUsername' },
    { title: '邮箱', dataIndex: 'email', key: 'email', render: (v) => v || '—' },
    {
      title: '同步状态',
      key: 'syncStatus',
      render: (_, row) => {
        const color =
          row.syncStatus === 'synced' ? 'success' : row.syncStatus === 'failed' ? 'error' : 'default';
        return (
          <Space direction="vertical" size={0}>
            <Tag color={color}>{row.syncStatus || 'pending'}</Tag>
            {row.lastSyncMessage ? (
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                {row.lastSyncMessage}
              </Typography.Text>
            ) : null}
          </Space>
        );
      },
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      render: (v) =>
        v === 'active' ? <Tag color="success">活跃</Tag> : <Tag color="default">非活跃</Tag>,
    },
    {
      title: '操作',
      key: 'actions',
      width: 80,
      fixed: 'right',
      render: (_, row) => {
        if (!canWrite) return null;
        return (
          <ResourceActionsDropdown
            items={[
              {
                key: 'edit',
                label: '编辑',
                onClick: () => {
                  setEditing(row);
                  form.setFieldsValue({
                    fullName: row.fullName,
                    email: row.email,
                    status: row.status,
                  });
                  setModalOpen(true);
                },
              },
              { type: 'divider' },
              {
                key: 'del',
                label: '删除',
                danger: true,
                onClick: () => {
                  Modal.confirm({
                    title: '删除云桌面用户',
                    content: `确定删除「${row.username}」？云桌面网关侧账号需另行清理。`,
                    okType: 'danger',
                    onOk: async () => {
                      try {
                        await deleteCloudDesktopUser(row.id);
                        message.success('已删除');
                        await load();
                      } catch (e: unknown) {
                        message.error(e instanceof Error ? e.message : '删除失败');
                        return Promise.reject(e instanceof Error ? e : new Error('删除失败'));
                      }
                    },
                  });
                },
              },
            ]}
          />
        );
      },
    },
  ];

  const onSubmit = async (values: any) => {
    try {
      if (editing) {
        await updateCloudDesktopUser(editing.id, {
          full_name: values.fullName,
          email: values.email,
          status: values.status,
        });
        message.success('已更新');
      } else {
        await createCloudDesktopUser({
          username: values.username,
          full_name: values.fullName,
          email: values.email,
        });
        message.success('已创建并尝试同步到云桌面网关');
      }
      setModalOpen(false);
      setEditing(null);
      form.resetFields();
      await load();
    } catch (e: unknown) {
      message.error(e instanceof Error ? e.message : '保存失败');
    }
  };

  return (
    <div>
      <Typography.Paragraph type="secondary" style={{ marginTop: 0 }}>
        云桌面用户<strong>不能登录 Tower</strong>，不参与 RBAC；使用下方云桌面网关配置的<strong>统一密码</strong>登录
        云桌面网关门户，仅可访问已分配的虚拟机连接。
      </Typography.Paragraph>
      <div className="page-toolbar" style={{ marginBottom: 12 }}>
        <Input
          allowClear
          placeholder="搜索用户名/姓名"
          className="toolbar-search"
          value={kw}
          onChange={(e) => setKw(e.target.value)}
          style={{ maxWidth: 280 }}
        />
        <div className="toolbar-actions">
          {canWrite ? (
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => {
                setEditing(null);
                form.resetFields();
                setModalOpen(true);
              }}
            >
              新建云桌面用户
            </Button>
          ) : null}
          {canWrite ? (
            <Button loading={syncing} onClick={() => void onSyncAll()}>
              同步到云桌面网关
            </Button>
          ) : null}
          <Button icon={<ReloadOutlined />} onClick={() => void load()} />
        </div>
      </div>
      <Table
        className="std-table"
        bordered={false}
        rowKey="id"
        loading={loading}
        dataSource={filtered}
        columns={columns}
        scroll={{ x: true }}
        pagination={{ size: 'small', showTotal: (t) => `共 ${t} 条` }}
      />
      <Modal
        title={editing ? '编辑云桌面用户' : '新建云桌面用户'}
        open={modalOpen}
        onCancel={() => {
          setModalOpen(false);
          setEditing(null);
        }}
        onOk={() => form.submit()}
        destroyOnHidden
      >
        <Form form={form} layout="vertical" onFinish={onSubmit}>
          {!editing ? (
            <Form.Item
              name="username"
              label="用户名"
              rules={[{ required: true, message: '请输入用户名' }]}
              extra="用于登录云桌面网关；创建后使用网关统一密码"
            >
              <Input placeholder="例如：desktop-zhangsan" />
            </Form.Item>
          ) : null}
          <Form.Item name="fullName" label="姓名" rules={[{ required: true, message: '请输入姓名' }]}>
            <Input />
          </Form.Item>
          <Form.Item name="email" label="邮箱">
            <Input placeholder="可选" />
          </Form.Item>
          {editing ? (
            <Form.Item name="status" label="状态" initialValue="active">
              <Select
                options={[
                  { value: 'active', label: '活跃' },
                  { value: 'inactive', label: '非活跃' },
                ]}
              />
            </Form.Item>
          ) : null}
        </Form>
      </Modal>
    </div>
  );
};

export default CloudDesktopUsersPanel;
