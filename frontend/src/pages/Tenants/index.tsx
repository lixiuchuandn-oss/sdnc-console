import React, { useState, useEffect } from 'react';
import { 
  Table, 
  Button, 
  Form, 
  Input, 
  Select, 
  message, 
  Space, 
  Tag, 
  Popconfirm,
  Dropdown,
  Modal,
  Card,
  Row,
  Col,
  Tree,
  Tabs,
  Badge,
  Typography,
  Statistic,
  Divider
} from 'antd';
import { 
  PlusOutlined, 
  DeleteOutlined, 
  TeamOutlined, 
  MoreOutlined,
  EditOutlined,
  CheckOutlined,
  CloseOutlined,
  EllipsisOutlined
} from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import type { DataNode } from 'antd/es/tree';
import { Tenant, Organization, TenantUser, CreateTenantRequest, CreateOrganizationRequest, CreateTenantUserRequest, ResourcePoolAssignment } from '../../types/tenant';
import axios from 'axios';
import { Space as AntSpace } from 'antd';
import PageContainer from '../../components/PageContainer';
import StdSideDrawer from '../../components/StdSideDrawer';
import SharedToolbar from '../../components/SharedToolbar';
import '../common/filters.css';

const { TextArea } = Input;
const { TabPane } = Tabs;
const { Title } = Typography;

const TenantsPage: React.FC = () => {
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedTenant, setSelectedTenant] = useState<Tenant | null>(null);
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [selectedOrg, setSelectedOrg] = useState<Organization | null>(null);
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [expandedKeys, setExpandedKeys] = useState<string[]>([]);
  const [users, setUsers] = useState<TenantUser[]>([]);
  const [resourcePools, setResourcePools] = useState<any[]>([]);
  const [assignments, setAssignments] = useState<ResourcePoolAssignment[]>([]);
  const [selectedTenantRowKeys, setSelectedTenantRowKeys] = useState<string[]>([]);
  const [userKeyword, setUserKeyword] = useState<string>('');
  const [tenantOrgCountMap, setTenantOrgCountMap] = useState<Record<string, number>>({});
  const [tenantUserCountMap, setTenantUserCountMap] = useState<Record<string, number>>({});
  const [tenantSearch, setTenantSearch] = useState<string>('');
  const [renameOrgId, setRenameOrgId] = useState<string | null>(null);
  const [renameName, setRenameName] = useState<string>('');
  const [addingForParentId, setAddingForParentId] = useState<string | null>(null);
  const [newChildName, setNewChildName] = useState<string>('');
  const [orgKeyword, setOrgKeyword] = useState<string>('');
  const [assignmentKeyword, setAssignmentKeyword] = useState<string>('');
  
  // 模态框状态
  const [tenantDrawerOpen, setTenantDrawerOpen] = useState(false);
  const [userDrawerOpen, setUserDrawerOpen] = useState(false);
  const [resourcePoolDrawerOpen, setResourcePoolDrawerOpen] = useState(false);
  const [orgTreeDrawerOpen, setOrgTreeDrawerOpen] = useState(false);
  const [usersManageDrawerOpen, setUsersManageDrawerOpen] = useState(false);
  const [assignDrawerOpen, setAssignDrawerOpen] = useState(false);
  const [editingTenant, setEditingTenant] = useState<Tenant | null>(null);

  
  // 表单实例
  const [tenantForm] = Form.useForm();
  const [userForm] = Form.useForm();
  const [resourcePoolForm] = Form.useForm();
  const [filterForm] = Form.useForm();

  // 获取租户列表
  const fetchTenants = async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem('token');
      const response = await axios.get('/api/tenants', {
        headers: { Authorization: `Bearer ${token}` }
      });
      setTenants(response.data);
    } catch (error) {
      message.error('获取租户列表失败');
    } finally {
      setLoading(false);
    }
  };

  

  // 获取组织树
  const fetchOrganizations = async (tenantId: string) => {
    try {
      const token = localStorage.getItem('token');
      const response = await axios.get(`/api/tenants/${tenantId}/organizations`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setOrganizations(response.data);
      const countAll = (orgs: Organization[]): number => {
        let c = 0;
        const recur = (list: Organization[]) => {
          for (const o of list) {
            c += 1;
            if (o.children && o.children.length) recur(o.children);
          }
        };
        recur(orgs);
        return c;
      };
      setTenantOrgCountMap(prev => ({ ...prev, [tenantId]: countAll(response.data) }));
      const collectKeys = (orgs: Organization[]): string[] => {
        const out: string[] = [];
        const recur = (list: Organization[]) => {
          for (const o of list) {
            out.push(o.id);
            if (o.children && o.children.length) recur(o.children);
          }
        };
        recur(orgs);
        return out;
      };
      setExpandedKeys(collectKeys(response.data));
      const root = response.data.find((o: any) => o.level === 1) || response.data[0];
      if (root) {
        setSelectedKeys([root.id]);
        setSelectedOrg(root);
      }
    } catch (error) {
      message.error('获取组织列表失败');
    }
  };

  // 获取用户列表
  const fetchUsers = async (tenantId: string, orgId: string) => {
    try {
      const token = localStorage.getItem('token');
      const response = await axios.get(`/api/tenants/${tenantId}/organizations/${orgId}/users`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setUsers(response.data);
    } catch (error) {
      message.error('获取用户列表失败');
    }
  };

  // 获取可分配的资源池列表
  const fetchResourcePools = async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await axios.get('/api/tenants/available-resource-pools', {
        headers: { Authorization: `Bearer ${token}` }
      });
      setResourcePools(response.data);
    } catch (error) {
      message.error('获取资源池列表失败');
    }
  };

  // 获取组织的资源池分配
  const fetchAssignments = async (orgId: string) => {
    try {
      const token = localStorage.getItem('token');
      const response = await axios.get(`/api/tenants/organizations/${orgId}/resource-pools`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setAssignments(response.data);
    } catch (error) {
      message.error('获取资源池分配失败');
    }
  };

  // 分配资源池
  const handleResourcePoolAssign = async (values: any) => {
    if (!selectedOrg) return;
    
    try {
      const token = localStorage.getItem('token');
      const payload = { resourcePoolIds: values.resourcePoolIds, permissions: ['use'] };
      await axios.post(`/api/tenants/organizations/${selectedOrg.id}/resource-pools`, payload, {
        headers: { Authorization: `Bearer ${token}` }
      });
      message.success('资源池分配成功');
      setResourcePoolDrawerOpen(false);
      resourcePoolForm.resetFields();
      fetchAssignments(selectedOrg.id);
    } catch (error: any) {
      message.error(error.response?.data?.message || '分配失败');
    }
  };

  // 移除资源池分配
  const handleRemoveAssignment = async (poolId: string) => {
    if (!selectedOrg) return;
    
    try {
      const token = localStorage.getItem('token');
      await axios.delete(`/api/tenants/organizations/${selectedOrg.id}/resource-pools/${poolId}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      message.success('资源池分配已移除');
      fetchAssignments(selectedOrg.id);
    } catch (error: any) {
      message.error(error.response?.data?.message || '移除失败');
    }
  };

  // 创建/更新租户
  const handleTenantSubmit = async (values: CreateTenantRequest) => {
    try {
      const token = localStorage.getItem('token');
      if (editingTenant) {
        await axios.put(`/api/tenants/${editingTenant.id}`, values, {
          headers: { Authorization: `Bearer ${token}` }
        });
        message.success('租户更新成功');
      } else {
        await axios.post('/api/tenants', values, {
          headers: { Authorization: `Bearer ${token}` }
        });
        message.success('租户创建成功');
      }
      setTenantDrawerOpen(false);
      setEditingTenant(null);
      tenantForm.resetFields();
      fetchTenants();
    } catch (error: any) {
      message.error(error.response?.data?.message || '操作失败');
    }
  };

  // 删除租户
  const handleDeleteTenant = async (id: string) => {
    try {
      const token = localStorage.getItem('token');
      await axios.delete(`/api/tenants/${id}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      message.success('租户删除成功');
      fetchTenants();
      if (selectedTenant?.id === id) {
        setSelectedTenant(null);
        setOrganizations([]);
        setUsers([]);
      }
    } catch (error: any) {
      message.error(error.response?.data?.message || '删除失败');
    }
  };

  const handleBatchDeleteTenants = async () => {
    if (selectedTenantRowKeys.length === 0) { message.info('请先选择要删除的租户'); return; }
    Modal.confirm({
      title: '确认批量删除租户',
      content: '删除后将无法恢复，相关的组织和用户也会被删除。',
      okText: '删除',
      cancelText: '取消',
      onOk: async () => {
        try {
          const token = localStorage.getItem('token');
          await Promise.all(selectedTenantRowKeys.map(id => axios.delete(`/api/tenants/${id}`, { headers: { Authorization: `Bearer ${token}` } })));
          message.success('批量删除成功');
          setSelectedTenantRowKeys([]);
          fetchTenants();
        } catch (error: any) {
          message.error(error.response?.data?.message || '批量删除失败');
        }
      }
    });
  };

  // 创建组织
  const handleOrgSubmit = async (values: CreateOrganizationRequest) => {
    if (!selectedTenant) return;
    
    try {
      const token = localStorage.getItem('token');
      await axios.post(`/api/tenants/${selectedTenant.id}/organizations`, values, {
        headers: { Authorization: `Bearer ${token}` }
      });
      message.success('组织创建成功');
      fetchOrganizations(selectedTenant.id);
    } catch (error: any) {
      message.error(error.response?.data?.message || '创建失败');
    }
  };

  // 删除组织（级联删除）
  const handleOrgDelete = async (orgId: string) => {
    try {
      const token = localStorage.getItem('token');
      await axios.delete(`/api/tenants/organizations/${orgId}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      message.success('组织删除成功');
      if (selectedTenant?.id) fetchOrganizations(selectedTenant.id);
    } catch (error: any) {
      message.error(error.response?.data?.message || '删除失败');
    }
  };

  const handleOrgRename = async (orgId: string, name: string) => {
    try {
      const token = localStorage.getItem('token');
      await axios.put(`/api/tenants/organizations/${orgId}`, { name }, {
        headers: { Authorization: `Bearer ${token}` }
      });
      message.success('组织名称已更新');
      setRenameOrgId(null);
      setRenameName('');
      if (selectedTenant?.id) fetchOrganizations(selectedTenant.id);
    } catch (error: any) {
      message.error(error.response?.data?.message || '更新失败');
    }
  };

  const handleAddChildSave = async (parentId: string) => {
    if (!selectedTenant) return;
    const name = newChildName.trim();
    if (!name) { message.warning('组织名称不能为空'); return; }
    try {
      const token = localStorage.getItem('token');
      await axios.post(`/api/tenants/${selectedTenant.id}/organizations`, { name, parentId }, {
        headers: { Authorization: `Bearer ${token}` }
      });
      message.success('子组织创建成功');
      setAddingForParentId(null);
      setNewChildName('');
      fetchOrganizations(selectedTenant.id);
    } catch (error: any) {
      message.error(error.response?.data?.message || '创建失败');
    }
  };

  // 创建用户
  const handleUserSubmit = async (values: CreateTenantUserRequest) => {
    if (!selectedTenant || !selectedOrg) return;
    
    try {
      const token = localStorage.getItem('token');
      await axios.post(`/api/tenants/${selectedTenant.id}/organizations/${selectedOrg.id}/users`, values, {
        headers: { Authorization: `Bearer ${token}` }
      });
      message.success('用户创建成功');
      setUserDrawerOpen(false);
      userForm.resetFields();
      fetchUsers(selectedTenant.id, selectedOrg.id);
    } catch (error: any) {
      message.error(error.response?.data?.message || '创建失败');
    }
  };

  // 删除用户
  const handleDeleteUser = async (userId: string) => {
    if (!selectedTenant || !selectedOrg) return;
    
    try {
      const token = localStorage.getItem('token');
      await axios.delete(`/api/tenants/${selectedTenant.id}/organizations/${selectedOrg.id}/users/${userId}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      message.success('用户删除成功');
      fetchUsers(selectedTenant.id, selectedOrg.id);
    } catch (error: any) {
      message.error(error.response?.data?.message || '删除失败');
    }
  };

  // 过滤组织树
  const filterOrgs = (orgs: Organization[], keyword: string): Organization[] => {
    const kw = keyword.trim().toLowerCase();
    if (!kw) return orgs;
    const recur = (list: Organization[]): Organization[] => {
      const out: Organization[] = [];
      for (const org of list) {
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

  // 构建组织树数据
  const buildTreeData = (orgs: Organization[]): DataNode[] => {
    return orgs.map(org => {
      const children = org.children ? buildTreeData(org.children) : [];
      // 如果当前节点正在添加子组织，插入一个占位子节点
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
                className="org-action-btn"
                icon={<CheckOutlined />}
                disabled={!newChildName.trim()}
                onClick={(e) => { e.stopPropagation(); handleAddChildSave(org.id); }}
              >保存</Button>
              <Button
                type="link"
                size="small"
                className="org-action-btn"
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
              <Typography.Text className="org-tree-title" style={{ pointerEvents: 'none' }}>{org.name}</Typography.Text>
            )}
            <div style={{ display:'flex', alignItems:'center', marginLeft:'auto', justifyContent:'flex-end' }}>
              {renameOrgId === org.id ? (
                <>
                  <Button
                    type="link"
                    size="small"
                    className="org-action-btn"
                    icon={<CheckOutlined />}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (!renameName.trim()) { message.warning('组织名称不能为空'); return; }
                      handleOrgRename(org.id, renameName.trim());
                    }}
                  >保存</Button>
                  <Button
                    type="link"
                    size="small"
                    className="org-action-btn"
                    icon={<CloseOutlined />}
                    onClick={(e) => { e.stopPropagation(); setRenameOrgId(null); setRenameName(''); }}
                  >取消</Button>
                </>
              ) : (
                <Button
                  type="link"
                  size="small"
                  className="org-action-btn"
                  icon={<EditOutlined />}
                  onClick={(e) => { e.stopPropagation(); setRenameOrgId(org.id); setRenameName(org.name); }}
                >重命名</Button>
              )}
              <Divider type="vertical" />
              <Button
                type="link"
                size="small"
                icon={<PlusOutlined />}
                className="org-action-btn"
                disabled={org.level >= 4}
                onClick={(e) => {
                  e.stopPropagation();
                  setExpandedKeys(prev => (prev.includes(org.id) ? prev : [...prev, org.id]));
                  setAddingForParentId(org.id);
                  setNewChildName('');
                }}
              >添加子组织</Button>
              {org.level !== 1 && (
                <>
                  <Divider type="vertical" />
                  <Button
                    type="link"
                    danger
                    size="small"
                    icon={<DeleteOutlined />}
                    className="org-action-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      Modal.confirm({
                        title: '确认删除组织',
                        content: '将删除该组织及其所有下级组织、关联用户与资源池分配。',
                        okText: '删除',
                        cancelText: '取消',
                        onOk: async () => { await handleOrgDelete(org.id); }
                      });
                    }}
                  >删除</Button>
                </>
              )}
            </div>
          </div>
        ),
        children,
      } as DataNode;
    });
  };

  // 资源池分配表格列定义
  const assignmentColumns: ColumnsType<ResourcePoolAssignment> = [
    {
      title: '资源池名称',
      dataIndex: ['cloud', 'name'],
      key: 'name',
    },
    {
      title: '资源池类型',
      dataIndex: ['cloud', 'type'],
      key: 'type',
      render: (type: string) => {
        const typeMap: { [key: string]: string } = {
          'virtual_machine': '虚拟机',
          'container': '容器',
          'bare_metal': '裸金属',
          'vpc': 'VPC网络',
          'file_storage': '文件存储',
          'object_storage': '对象存储'
        };
        return <Tag color="blue">{typeMap[type] || type}</Tag>;
      },
    },
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
        return <Tag color="blue">{name}</Tag>;
      }
    },
    {
      title: '操作',
      key: 'action',
      render: (_: any, record: ResourcePoolAssignment) => (
        <Dropdown
          menu={{
            items: [
              { key: 'remove', label: '移除', danger: true },
            ],
            onClick: ({ key }) => {
              if (key === 'remove') {
                Modal.confirm({
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
          <Button type="link" size="small" icon={<EllipsisOutlined />} />
        </Dropdown>
      ),
    },
  ];

  // 租户表格列定义
  const tenantColumns: ColumnsType<Tenant> = [
    {
      title: '租户',
      dataIndex: 'name',
      key: 'name',
      render: (text: string, record: Tenant) => (
        <div style={{ display:'flex', alignItems:'center', gap:8 }}>
          <span style={{ fontSize:14, cursor:'default' }}>{text}</span>
        </div>
      )
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      render: (status: string) => {
        const colors = {
          active: 'green',
          inactive: 'orange',
          suspended: 'red'
        };
        const labels = {
          active: '活跃',
          inactive: '非活跃',
          suspended: '暂停'
        };
        return <Tag color={colors[status as keyof typeof colors]}>{labels[status as keyof typeof labels]}</Tag>;
      }
    },
    {
      title: '组织数量',
      key: 'orgCount',
      render: (_: any, record: Tenant) => <Typography.Text style={{ fontSize: 12 }}>{tenantOrgCountMap[record.id] ?? '-'}</Typography.Text>
    },
    {
      title: '用户数量',
      key: 'userCount',
      render: (_: any, record: Tenant) => <Typography.Text style={{ fontSize: 12 }}>{tenantUserCountMap[record.id] ?? '-'}</Typography.Text>
    },
    {
      title: '创建时间',
      dataIndex: 'createdAt',
      key: 'createdAt',
      render: (date: string) => <Typography.Text style={{ fontSize: 12 }}>{new Date(date).toLocaleDateString()}</Typography.Text>
    },
    {
      title: '操作',
      key: 'action',
      render: (_, record: Tenant) => (
        <Dropdown
          menu={{
            items: [
              { key: 'edit', label: '编辑' },
              { key: 'delete', label: '删除', danger: true },
              { key: 'orgManage', label: '组织管理' },
            ],
            onClick: ({ key }) => {
              if (key === 'edit') {
                setEditingTenant(record);
                tenantForm.setFieldsValue(record);
                setTenantDrawerOpen(true);
                return;
              }
              if (key === 'delete') {
                Modal.confirm({
                  title: '确认删除租户',
                  content: '删除后将无法恢复，相关的组织和用户也会被删除。',
                  okText: '删除',
                  cancelText: '取消',
                  onOk: async () => { await handleDeleteTenant(record.id); },
                });
                return;
              }
              if (key === 'orgManage') {
                setSelectedTenant(record);
                fetchOrganizations(record.id);
                setOrgTreeDrawerOpen(true);
                return;
              }
            }
          }}
        >
          <Button type="link" size="small" icon={<EllipsisOutlined />} />
        </Dropdown>
      ),
    },
  ];

  // 用户表格列定义
  const userColumns: ColumnsType<TenantUser> = [
    {
      title: '用户名',
      dataIndex: 'username',
      key: 'username'
    },
    {
      title: '角色',
      dataIndex: 'role',
      key: 'role',
      render: (role: string) => {
        const colors = {
          admin: 'red',
          user: 'blue',
          viewer: 'green'
        };
        const labels = {
          admin: '管理员',
          user: '用户',
          viewer: '查看者'
        };
        return <Tag color={colors[role as keyof typeof colors]}>{labels[role as keyof typeof labels]}</Tag>;
      }
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      render: (status: string) => (
        <Tag color={status === 'active' ? 'green' : 'red'}>
          {status === 'active' ? '活跃' : '非活跃'}
        </Tag>
      )
    },
    {
      title: '操作',
      key: 'action',
      render: (_, record: TenantUser) => (
        <Dropdown
          menu={{
            items: [
              { key: 'delete', label: '删除', danger: true },
            ],
            onClick: ({ key }) => {
              if (key === 'delete') {
                Modal.confirm({
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
          <Button type="link" size="small" icon={<EllipsisOutlined />} />
        </Dropdown>
      ),
    }
  ];

  // 过滤后的租户列表
  const [statusFilter, setStatusFilter] = useState<string | undefined>(undefined);
  const handleFilterChange = (_: any, all: any) => {
    setTenantSearch(all.keyword || '');
    setStatusFilter(all.status || undefined);
  };
  const filteredTenants = tenants.filter(t => {
    const okKeyword = t.name.toLowerCase().includes(tenantSearch.toLowerCase()) || (t.description || '').toLowerCase().includes(tenantSearch.toLowerCase());
    const okStatus = !statusFilter || t.status === statusFilter;
    return okKeyword && okStatus;
  });

  const totalTenants = tenants.length;
  const orgTotal = organizations.length; // only for selected? maybe compute all
  const totalUsers = users.length;

  useEffect(() => {
    fetchTenants();
  }, []);

  useEffect(() => {
    if (orgTreeDrawerOpen && selectedTenant?.id && selectedOrg?.id) {
      fetchUsers(selectedTenant.id, selectedOrg.id);
      fetchAssignments(selectedOrg.id);
    }
  }, [orgTreeDrawerOpen, selectedTenant?.id, selectedOrg?.id]);

  useEffect(() => {
    if (selectedTenant?.id) {
      setTenantUserCountMap(prev => ({ ...prev, [selectedTenant.id]: users.length }));
    }
  }, [users, selectedTenant?.id]);

  return (
    <PageContainer
      title="租户管理"
      titleLevel={3}
      subtitle="租户（Tenant）用于隔离不同组织或项目的资源与权限，支持组织架构、用户与角色管理、资源池分配等。"
      asCard={false}
    >
      <Divider style={{ margin: '0 0 16px 0' }} />

      <SharedToolbar
        style={{ alignItems:'flex-end' }}
        left={(
          <Form
            className="filter-tools"
            form={filterForm}
            layout="vertical"
            style={{ rowGap:12, columnGap:12, display:'flex', alignItems:'flex-end' }}
            onValuesChange={handleFilterChange}
          >
            <Form.Item name="keyword" label="租户名称">
              <Input allowClear placeholder="支持模糊查询" style={{ width:200 }} />
            </Form.Item>
            <Form.Item name="status" label="状态">
              <Select allowClear placeholder="选择状态" style={{ width:200 }}>
                <Select.Option value="active">活跃</Select.Option>
                <Select.Option value="inactive">非活跃</Select.Option>
                <Select.Option value="suspended">暂停</Select.Option>
              </Select>
            </Form.Item>
            <Form.Item>
              <Button type="link" style={{ padding:0 }} onClick={()=>{ filterForm.resetFields(); setTenantSearch(''); setStatusFilter(undefined); }}>重置</Button>
            </Form.Item>
          </Form>
        )}
        right={(
          <Space>
            <Button type="primary" onClick={()=> setTenantDrawerOpen(true)}>新增租户</Button>
            <Dropdown
              menu={{
                items: [
                  { key: 'refresh', label: '刷新' },
                  { key: 'batchDelete', label: '批量删除', danger: true, disabled: selectedTenantRowKeys.length === 0 },
                ],
                onClick: ({ key }) => {
                  if (key === 'refresh') { fetchTenants(); return; }
                  if (key === 'batchDelete') { handleBatchDeleteTenants(); return; }
                }
              }}
            >
              <Button icon={<EllipsisOutlined />} loading={loading}>更多</Button>
            </Dropdown>
          </Space>
        )}
      />

      {/* 表格与详情 */}
      <Row gutter={[16,16]}>
        <Col span={24}>
          <Table
            bordered
            columns={tenantColumns}
            dataSource={filteredTenants}
            rowKey="id"
            rowSelection={{ selectedRowKeys: selectedTenantRowKeys, onChange: (keys)=> setSelectedTenantRowKeys(keys as string[]) }}
            pagination={{ pageSize:10 }}
            style={{ width: '100%', fontSize: 14 }}
            className="tenant-table"
          />
        </Col>
        {/* 右侧说明卡片去除，直接以行操作菜单进入抽屉 */}
      </Row>

      {/* 创建/编辑租户抽屉 */}
      <StdSideDrawer
        title={editingTenant ? '编辑租户' : '创建租户'}
        open={tenantDrawerOpen}
        width={600}
        onClose={() => {
          setTenantDrawerOpen(false);
          setEditingTenant(null);
          tenantForm.resetFields();
        }}
        onOk={() => tenantForm.submit()}
        okText={editingTenant ? '更新' : '创建'}
      >
        <Form form={tenantForm} layout="vertical" onFinish={handleTenantSubmit}>
          <Form.Item label="租户名称" name="name" rules={[{ required: true, message: '请输入租户名称' }]}>
            <Input placeholder="请输入租户名称" />
          </Form.Item>
          <Form.Item label="描述" name="description">
            <TextArea rows={3} placeholder="请输入租户描述" />
          </Form.Item>
          {editingTenant && (
            <Form.Item label="状态" name="status">
              <Select placeholder="请选择状态">
                <Select.Option value="active">活跃</Select.Option>
                <Select.Option value="inactive">非活跃</Select.Option>
                <Select.Option value="suspended">暂停</Select.Option>
              </Select>
            </Form.Item>
          )}
        </Form>
      </StdSideDrawer>

      

      {/* 创建用户抽屉 */}
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
          <Form.Item label="用户名" name="username" rules={[{ required: true, message: '请输入用户名' }]}>
            <Input placeholder="请输入用户名" />
          </Form.Item>
          <Form.Item label="姓名" name="fullName" rules={[{ required: true, message: '请输入姓名' }]}>
            <Input placeholder="请输入姓名" />
          </Form.Item>
          <Form.Item label="邮箱" name="email" rules={[{ required: true, message: '请输入邮箱' }, { type: 'email', message: '请输入有效的邮箱地址' }]}>
            <Input placeholder="请输入邮箱" />
          </Form.Item>
          <Form.Item label="密码" name="password" rules={[{ required: true, message: '请输入密码' }]}>
            <Input.Password placeholder="请输入密码" />
          </Form.Item>
          <Form.Item label="角色" name="role" rules={[{ required: true, message: '请选择角色' }]}>
            <Select placeholder="请选择角色">
              <Select.Option value="admin">管理员</Select.Option>
              <Select.Option value="user">用户</Select.Option>
              <Select.Option value="viewer">查看者</Select.Option>
            </Select>
          </Form.Item>
        </Form>
      </StdSideDrawer>

      {/* 资源池分配抽屉 */}
      <StdSideDrawer
        title="分配资源池"
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
          <Form.Item label="选择资源池" name="resourcePoolIds" rules={[{ required: true, message: '请选择要分配的资源池' }]}> 
            <Select mode="multiple" placeholder="请选择资源池" style={{ width: '100%' }}>
              {resourcePools.map(pool => (
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
          
        </Form>
      </StdSideDrawer>
      <StdSideDrawer
        title="组织管理"
        open={orgTreeDrawerOpen}
        width={1000}
        onClose={() => setOrgTreeDrawerOpen(false)}
        onOk={() => setOrgTreeDrawerOpen(false)}
        okText="关闭"
      >
        
        {organizations.length > 0 ? (
          <>
            <Row gutter={[16,0]} style={{ height:'100%' }}>
              <Col span={12} style={{ height:'100%' }}>
                {/* 左侧：组织树 */}
                <div className="org-tree-container" style={{ display:'flex', flexDirection:'column', height:'100%' }}>
                  <div style={{ display:'flex', alignItems:'center', marginBottom: 8 }}>
                    <Input
                      allowClear
                      placeholder="搜索组织名称"
                      style={{ width: '100%' }}
                      value={orgKeyword}
                      onChange={(e)=> setOrgKeyword(e.target.value)}
                    />
                  </div>
                  <div className="org-tree-scroll">
                    <Tree
                      className="org-tree"
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
                </div>
              </Col>
              <Col span={12}>
                {/* 右侧：标签页（用户管理、资源分配） */}
                <Tabs defaultActiveKey="users">
                  <Tabs.TabPane tab="用户管理" key="users">
                    {selectedOrg ? (
                      <div>
                        <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <Input
                            allowClear
                            placeholder="搜索用户关键字"
                            style={{ width: 240 }}
                            value={userKeyword}
                            onChange={(e)=> setUserKeyword(e.target.value)}
                          />
                          <Button 
                            type="primary" 
                            onClick={() => {
                              userForm.resetFields();
                              const rand = `user-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,6)}`;
                              userForm.setFieldsValue({ organizationId: selectedOrg?.id, username: rand });
                              setUserDrawerOpen(true);
                            }}
                          >添加用户</Button>
                        </div>
                        <Table
                          columns={userColumns}
                          dataSource={(userKeyword.trim() ? users.filter(u => {
                            const kw = userKeyword.trim().toLowerCase();
                            return (
                              (u.username || '').toLowerCase().includes(kw) ||
                              (u.fullName || '').toLowerCase().includes(kw) ||
                              (u.email || '').toLowerCase().includes(kw)
                            );
                          }) : users)}
                          rowKey="id"
                          pagination={{ pageSize: 10 }}
                          size="small"
                          bordered
                        />
                      </div>
                    ) : (
                      <div style={{ textAlign: 'center', padding: 40, color: '#999' }}>请先在左侧选择一个组织</div>
                    )}
                  </Tabs.TabPane>
                  <Tabs.TabPane tab="资源分配" key="assign">
                    {selectedOrg ? (
                      <div>
                        <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
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
                              setResourcePoolDrawerOpen(true);
                            }}
                          >分配资源池</Button>
                        </div>
                        <Table
                          columns={assignmentColumns}
                          dataSource={(assignmentKeyword.trim() ? assignments.filter(a => {
                            const kw = assignmentKeyword.trim().toLowerCase();
                            const name = String((a.cloud as any)?.name || '').toLowerCase();
                            const type = String((a.cloud as any)?.type || '').toLowerCase();
                            const provider = String((a.cloud as any)?.config?.provider || '').toLowerCase();
                            return name.includes(kw) || type.includes(kw) || provider.includes(kw);
                          }) : assignments)}
                          rowKey="id"
                          pagination={{ pageSize: 10 }}
                          size="small"
                          bordered
                        />
                      </div>
                    ) : (
                      <div style={{ textAlign: 'center', padding: 40, color: '#999' }}>请先在左侧选择一个组织</div>
                    )}
                  </Tabs.TabPane>
                </Tabs>
              </Col>
            </Row>
          </>
        ) : (
          <div style={{ textAlign: 'center', padding: 40, color: '#999' }}>暂无组织数据</div>
        )}
      </StdSideDrawer>

      <StdSideDrawer
        title="用户管理"
        open={usersManageDrawerOpen}
        width={720}
        onClose={() => setUsersManageDrawerOpen(false)}
        onOk={() => setUsersManageDrawerOpen(false)}
        okText="关闭"
      >
        {selectedOrg ? (
          <div>
            <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <Space>
                <Select
                  value={selectedOrg?.id}
                  placeholder="选择组织"
                  style={{ width: 240 }}
                  onChange={(orgId)=>{
                    const org = organizations.find(o => o.id === orgId) || null;
                    setSelectedOrg(org);
                    if (selectedTenant?.id && orgId) fetchUsers(selectedTenant.id, orgId);
                  }}
                >
                  {organizations.map(org => (
                    <Select.Option key={org.id} value={org.id}>{org.name}</Select.Option>
                  ))}
                </Select>
                {selectedOrg && <Tag color="blue">{selectedOrg.name}</Tag>}
                <span style={{ color: '#666' }}>共 {users.length} 个用户</span>
              </Space>
              <Button 
                type="primary" 
                onClick={() => {
                  userForm.resetFields();
                  const rand = `user-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,6)}`;
                  userForm.setFieldsValue({ organizationId: selectedOrg?.id, username: rand });
                  setUserDrawerOpen(true);
                }}
              >添加用户</Button>
            </div>
            <Table
              columns={userColumns}
              dataSource={users}
              rowKey="id"
              pagination={{ pageSize: 10 }}
              size="small"
              bordered
            />
          </div>
        ) : (
          <div style={{ textAlign: 'center', padding: 40, color: '#999' }}>请先在“组织架构”中选择一个组织</div>
        )}
      </StdSideDrawer>

      <StdSideDrawer
        title="资源池分配"
        open={assignDrawerOpen}
        width={800}
        onClose={() => setAssignDrawerOpen(false)}
        onOk={() => setAssignDrawerOpen(false)}
        okText="关闭"
      >
        {selectedOrg ? (
          <div>
            <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <Tag color="蓝色">{selectedOrg.name}</Tag>
                <span style={{ color: '#666' }}>共 {assignments.length} 个资源池</span>
              </div>
              <Button 
                type="primary"                
                onClick={() => {
                  fetchResourcePools();
                  resourcePoolForm.resetFields();
                  setResourcePoolDrawerOpen(true);
                }}
              >分配资源池</Button>
            </div>
            <Table
              columns={assignmentColumns}
              dataSource={assignments}
              rowKey="id"
              pagination={{ pageSize: 10 }}
              size="small"
              bordered
            />
          </div>
        ) : (
          <div style={{ textAlign: 'center', padding: 40, color: '#999' }}>请先在“组织架构”中选择一个组织</div>
        )}
      </StdSideDrawer>
    </PageContainer>
  );
};

export default TenantsPage;
