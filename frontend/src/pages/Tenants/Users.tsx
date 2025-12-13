import React, { useState, useEffect } from 'react';
import { Table, Button, Space, Tag, message, Typography, Input, Select, Form, Divider } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { ColumnsType } from 'antd/es/table';
import axios from 'axios';
import PageContainer from '../../components/PageContainer';
import '../common/filters.css';

const { Text } = Typography;
const { Option } = Select;

interface TenantUser {
  id: string;
  username: string;
  email: string;
  fullName: string;
  role: 'admin' | 'user' | 'viewer';
  status: 'active' | 'inactive';
  createdAt: string;
  tenant: {
    id: string;
    name: string;
    description?: string;
  } | null;
  organization: {
    id: string;
    name: string;
    level: number;
  } | null;
}

const UserManagement: React.FC = () => {
  const [users, setUsers] = useState<TenantUser[]>([]);
  const [filteredUsers, setFilteredUsers] = useState<TenantUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [selectedTenant, setSelectedTenant] = useState<string>('');
  const [selectedRole, setSelectedRole] = useState<string>('');
  const [selectedStatus, setSelectedStatus] = useState<string>('');
  const [filterForm] = Form.useForm();
  const handleFilterChange = (_: any, all: any) => {
    setSearchText(all.keyword || '');
    setSelectedTenant(all.tenant || '');
    setSelectedRole(all.role || '');
    setSelectedStatus(all.status || '');
  };

  const fetchTenantUsers = async () => {
    try {
      setLoading(true);
      const token = localStorage.getItem('token');
      const response = await axios.get('/api/users/tenant-users', {
        headers: { Authorization: `Bearer ${token}` }
      });
      setUsers(response.data);
      setFilteredUsers(response.data);
    } catch (error: any) {
      message.error(error.response?.data?.message || '获取用户列表失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTenantUsers();
  }, []);

  useEffect(() => {
    let filtered = users;
    if (searchText) {
      filtered = filtered.filter(user => 
        user.username.toLowerCase().includes(searchText.toLowerCase()) ||
        user.fullName.toLowerCase().includes(searchText.toLowerCase()) ||
        user.email.toLowerCase().includes(searchText.toLowerCase()) ||
        user.tenant?.name.toLowerCase().includes(searchText.toLowerCase()) ||
        user.organization?.name.toLowerCase().includes(searchText.toLowerCase())
      );
    }
    if (selectedTenant) {
      filtered = filtered.filter(user => user.tenant?.id === selectedTenant);
    }
    if (selectedRole) {
      filtered = filtered.filter(user => user.role === selectedRole);
    }
    if (selectedStatus) {
      filtered = filtered.filter(user => user.status === selectedStatus);
    }
    setFilteredUsers(filtered);
  }, [users, searchText, selectedTenant, selectedRole, selectedStatus]);

  const getTenantOptions = () => {
    const tenants = users.reduce((acc, user) => {
      if (user.tenant && !acc.find(t => t.id === user.tenant!.id)) {
        acc.push(user.tenant);
      }
      return acc;
    }, [] as Array<{ id: string; name: string; description?: string }>);
    return tenants;
  };

  const columns: ColumnsType<TenantUser> = [
    { title: '姓名', dataIndex: 'fullName', key: 'fullName', width: 160 },
    { title: '用户名', dataIndex: 'username', key: 'username', width: 140 },
    { title: '邮箱', dataIndex: 'email', key: 'email', width: 220 },
    { title: '租户', key: 'tenant.name', width: 180, render: (_, record) => record.tenant?.name || '-' },
    { title: '租户描述', key: 'tenant.description', width: 220, render: (_, record) => record.tenant?.description || '-' },
    { title: '组织', key: 'organization.name', width: 180, render: (_, record) => record.organization?.name || '-' },
    { title: '组织级别', key: 'organization.level', width: 110, render: (_, record) => {
      const lvl = record.organization?.level;
      const label = lvl === 1 ? '根组织' : lvl === 2 ? '二级' : lvl === 3 ? '三级' : '-';
      const color = lvl === 1 ? 'blue' : lvl === 2 ? 'green' : lvl === 3 ? 'orange' : 'default';
      return <Tag color={color}>{label}</Tag>;
    } },
    {
      title: '角色',
      dataIndex: 'role',
      key: 'role',
      width: 100,
      render: (role: string) => {
        const colors = { admin: 'red', user: 'blue', viewer: 'green' } as const;
        const labels = { admin: '管理员', user: '用户', viewer: '查看者' } as const;
        return <Tag color={colors[role as keyof typeof colors]}>{labels[role as keyof typeof labels]}</Tag>;
      },
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 100,
      render: (status: string) => (
        <Tag color={status === 'active' ? 'green' : 'red'}>{status === 'active' ? '活跃' : '非活跃'}</Tag>
      ),
    },
    {
      title: '创建时间',
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: 160,
      render: (date: string) => new Date(date).toLocaleString(),
    },
  ];

  return (
    <PageContainer
      titleLevel={3}
      subtitle="管理租户用户，并支持按租户、角色与状态筛选"
      asCard={false}
    >
      <Divider style={{ margin: '0 0 20px 0' }} />
      <div className="filters-row">
        <Form
          className="filter-tools filter-tools--center"
          form={filterForm}
          layout="vertical"
          style={{ rowGap: 12, columnGap: 12, display: 'flex', alignItems: 'flex-end' }}
          onValuesChange={handleFilterChange}
        >
          <Form.Item name="keyword" label="关键词"><Input allowClear placeholder="用户名/姓名/邮箱" style={{ width:200 }} /></Form.Item>
          <Form.Item name="tenant" label="租户"><Select allowClear placeholder="选择租户" style={{ width:200 }}>
            {getTenantOptions().map(tenant=>(<Option key={tenant.id} value={tenant.id}>{tenant.name}</Option>))}
          </Select></Form.Item>
          <Form.Item name="role" label="角色"><Select allowClear placeholder="选择角色" style={{ width:120 }}>
            <Option value="admin">管理员</Option>
            <Option value="user">用户</Option>
            <Option value="viewer">查看者</Option>
          </Select></Form.Item>
          <Form.Item name="status" label="状态"><Select allowClear placeholder="选择状态" style={{ width:120 }}>
            <Option value="active">活跃</Option>
            <Option value="inactive">非活跃</Option>
          </Select></Form.Item>
          <Form.Item>
            <Button type="link" style={{ padding:0 }} onClick={()=>{filterForm.resetFields(); setSearchText(''); setSelectedTenant(''); setSelectedRole(''); setSelectedStatus('');}}>重置</Button>
          </Form.Item>
        </Form>
        <Space className="filter-actions">
          <Button icon={<ReloadOutlined />} onClick={fetchTenantUsers} loading={loading}>刷新</Button>
        </Space>
      </div>

      <Table
        className="vr-table vr-table--middle"
        columns={columns}
        dataSource={filteredUsers}
        rowKey="id"
        loading={loading}
        pagination={{ pageSize:20, showSizeChanger:true, showQuickJumper:true, showTotal:(total,range)=>`第 ${range[0]}-${range[1]} 条，共 ${total} 条记录`, }}
        bordered
        tableLayout="fixed"
        scroll={{ x:'max-content' }}
      />
    </PageContainer>
  );
};

export default UserManagement;

export {};