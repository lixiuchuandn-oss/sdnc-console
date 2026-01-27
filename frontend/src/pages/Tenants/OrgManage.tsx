import React, { useEffect, useState } from 'react';
import { Button, Card, Col, Dropdown, Form, Input, Modal, Row, Select, Space, Table, Tabs, Tag, Tree, Typography, Descriptions, Transfer, message } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import type { DataNode } from 'antd/es/tree';
import { useNavigate, useParams } from 'react-router-dom';
import axios from 'axios';
import PageDetailContainer from '../../components/PageDetailContainer';
import StdSideDrawer from '../../components/StdSideDrawer';
import { Tenant, Organization, TenantUser, CreateTenantUserRequest, ResourcePoolAssignment } from '../../types/tenant';
import { CheckOutlined, CloseOutlined, EditOutlined, EllipsisOutlined, PlusOutlined, ClusterOutlined, GatewayOutlined, SafetyCertificateOutlined, NodeIndexOutlined } from '@ant-design/icons';
import { fetchProtectionObjects, fetchServiceChains } from '../../services/trafficOrchestration';
import { fetchVrCachePageList } from '../../services/virtualRouterApi';

const { TextArea } = Input;

type RBACRole = { id: string; name: string; description?: string; scope: 'system' | 'tenant'; status?: 'active' | 'inactive' };
type Assignment = { id: string; roleId: string; userType: 'system' | 'tenant'; userId: string; createdAt: string };

const OrgManagePage: React.FC = () => {
  const navigate = useNavigate();
  const { tenantId } = useParams();
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [selectedOrg, setSelectedOrg] = useState<Organization | null>(null);
  const [expandedKeys, setExpandedKeys] = useState<string[]>([]);
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [orgKeyword, setOrgKeyword] = useState<string>('');
  const [users, setUsers] = useState<TenantUser[]>([]);
  const [userKeyword, setUserKeyword] = useState<string>('');
  const [assignments, setAssignments] = useState<ResourcePoolAssignment[]>([]);
  const [assignmentKeyword, setAssignmentKeyword] = useState<string>('');
  const [resourcePools, setResourcePools] = useState<any[]>([]);
  const [securityLoading, setSecurityLoading] = useState(false);
  const [protectionObjects, setProtectionObjects] = useState<any[]>([]);
  const [securityChains, setSecurityChains] = useState<any[]>([]);
  const [sdnVrLoading, setSdnVrLoading] = useState(false);
  const [sdnVrs, setSdnVrs] = useState<any[]>([]);
  const [renameOrgId, setRenameOrgId] = useState<string | null>(null);
  const [renameName, setRenameName] = useState<string>('');
  const [addingForParentId, setAddingForParentId] = useState<string | null>(null);
  const [newChildName, setNewChildName] = useState<string>('');

  const [userForm] = Form.useForm();
  const [resourcePoolForm] = Form.useForm();
  const [userDrawerOpen, setUserDrawerOpen] = useState(false);
  const [resourcePoolDrawerOpen, setResourcePoolDrawerOpen] = useState(false);
  const [assignType, setAssignType] = useState<'compute'|'storage'|'security'>('compute');
  const [storageKeyword, setStorageKeyword] = useState<string>('');
  const [securityKeyword, setSecurityKeyword] = useState<string>('');
  const [nsLoading, setNsLoading] = useState<boolean>(false);
  const [nsOptions, setNsOptions] = useState<any[]>([]);
  const [sdnActiveKey, setSdnActiveKey] = useState<'vr'|'objects'|'chains'>('vr');
  const [sdnContentOpacity, setSdnContentOpacity] = useState<number>(1);
  const [tenantRoles, setTenantRoles] = useState<RBACRole[]>([]);
  const [roleAssignOpen, setRoleAssignOpen] = useState(false);
  const [roleAssignUser, setRoleAssignUser] = useState<TenantUser | null>(null);
  const [roleAssignSelected, setRoleAssignSelected] = useState<string[]>([]);
  const [roleAssignExisting, setRoleAssignExisting] = useState<Assignment[]>([]);
  const [roleAssignKw, setRoleAssignKw] = useState('');

  const fetchTenant = async (id: string) => {
    try {
      const token = localStorage.getItem('token');
      const res = await axios.get(`/api/tenants/${id}`, { headers: { Authorization: `Bearer ${token}` } });
      setTenant(res.data);
    } catch {}
  };

  const fetchOrganizations = async (id: string) => {
    try {
      const token = localStorage.getItem('token');
      const response = await axios.get(`/api/tenants/${id}/organizations`, { headers: { Authorization: `Bearer ${token}` } });
      setOrganizations(response.data);
      const collectKeys = (orgs: Organization[]): string[] => {
        const out: string[] = [];
        const visited = new Set<string>();
        const recur = (list: Organization[]) => {
          for (const o of list) {
            if (visited.has(o.id)) continue;
            visited.add(o.id);
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
    } catch {}
  };

  const fetchTenantRoles = async () => {
    try {
      const token = localStorage.getItem('token');
      const res = await axios.get('/api/system/rbac/roles', { headers: { Authorization: `Bearer ${token}` } });
      const list: RBACRole[] = Array.isArray((res.data as any)?.roles) ? (res.data as any).roles : [];
      setTenantRoles(list.filter(r => r.scope === 'tenant' && String(r.status || 'active') === 'active'));
    } catch {}
  };

  const fetchUsers = async (tid: string, orgId: string) => {
    try {
      const token = localStorage.getItem('token');
      const response = await axios.get(`/api/tenants/${tid}/organizations/${orgId}/users`, { headers: { Authorization: `Bearer ${token}` } });
      setUsers(response.data);
    } catch {}
  };

  const fetchAssignments = async (orgId: string) => {
    try {
      const token = localStorage.getItem('token');
      const response = await axios.get(`/api/tenants/organizations/${orgId}/resource-pools`, { headers: { Authorization: `Bearer ${token}` } });
      setAssignments(response.data);
    } catch {}
  };

  const fetchResourcePools = async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await axios.get('/api/tenants/available-resource-pools', { headers: { Authorization: `Bearer ${token}` } });
      setResourcePools(response.data);
    } catch {}
  };

  const handleOrgRename = async (orgId: string, name: string) => {
    try {
      const token = localStorage.getItem('token');
      await axios.put(`/api/tenants/organizations/${orgId}`, { name }, { headers: { Authorization: `Bearer ${token}` } });
      setRenameOrgId(null);
      setRenameName('');
      if (tenantId) fetchOrganizations(tenantId);
    } catch {}
  };

  const handleAddChildSave = async (parentId: string) => {
    if (!tenantId) return;
    const name = newChildName.trim();
    if (!name) return;
    try {
      const token = localStorage.getItem('token');
      await axios.post(`/api/tenants/${tenantId}/organizations`, { name, parentId }, { headers: { Authorization: `Bearer ${token}` } });
      setAddingForParentId(null);
      setNewChildName('');
      fetchOrganizations(tenantId);
    } catch {}
  };

  const handleUserSubmit = async (values: CreateTenantUserRequest) => {
    if (!tenantId || !selectedOrg) return;
    try {
      const token = localStorage.getItem('token');
      await axios.post(`/api/tenants/${tenantId}/organizations/${selectedOrg.id}/users`, values, { headers: { Authorization: `Bearer ${token}` } });
      setUserDrawerOpen(false);
      userForm.resetFields();
      fetchUsers(tenantId, selectedOrg.id);
    } catch {}
  };

  const openRoleAssign = async (user: TenantUser) => {
    try {
      const token = localStorage.getItem('token');
      const res = await axios.get('/api/system/rbac/assignments', {
        params: { userType: 'tenant', userId: user.id },
        headers: { Authorization: `Bearer ${token}` }
      });
      const list: Assignment[] = Array.isArray((res.data as any)?.assignments) ? (res.data as any).assignments : [];
      setRoleAssignUser(user);
      setRoleAssignExisting(list);
      setRoleAssignSelected(list.map(it => it.roleId));
      setRoleAssignOpen(true);
    } catch {}
  };

  const saveRoleAssign = async () => {
    if (!roleAssignUser) return;
    const token = localStorage.getItem('token');
    const current = new Set(roleAssignExisting.map(x => x.roleId));
    const needAdd = roleAssignSelected.filter(id => !current.has(id));
    const needRemove = roleAssignExisting.filter(x => !roleAssignSelected.includes(x.roleId));
    try {
      for (const roleId of needAdd) {
        await axios.post('/api/system/rbac/assignments', { roleId, userType: 'tenant', userId: roleAssignUser.id }, { headers: { Authorization: `Bearer ${token}` } });
      }
      for (const it of needRemove) {
        await axios.delete(`/api/system/rbac/assignments/${encodeURIComponent(it.id)}`, { headers: { Authorization: `Bearer ${token}` } });
      }
      Modal.success({ title: '角色赋权已保存' });
      setRoleAssignOpen(false);
      setRoleAssignUser(null);
      setRoleAssignExisting([]);
      setRoleAssignSelected([]);
      if (tenantId && selectedOrg) {
        fetchUsers(tenantId, selectedOrg.id);
      }
    } catch {
      Modal.error({ title: '保存失败', content: '保存角色赋权时发生错误' });
    }
  };

  const handleDeleteUser = async (userId: string) => {
    if (!tenantId || !selectedOrg) return;
    try {
      const token = localStorage.getItem('token');
      await axios.delete(`/api/tenants/${tenantId}/organizations/${selectedOrg.id}/users/${userId}`, { headers: { Authorization: `Bearer ${token}` } });
      fetchUsers(tenantId, selectedOrg.id);
    } catch {}
  };

  const handleResourcePoolAssign = async (values: any) => {
    if (!selectedOrg) return;
    try {
      const token = localStorage.getItem('token');
      const idsRaw = values.resourcePoolIds;
      const resourcePoolIds = Array.isArray(idsRaw) ? idsRaw.filter(Boolean) : (idsRaw ? [idsRaw] : []);
      const payload = { resourcePoolIds, permissions: ['use'], namespace: values.namespace };
      await axios.post(`/api/tenants/organizations/${selectedOrg.id}/resource-pools`, payload, { headers: { Authorization: `Bearer ${token}` } });
      setResourcePoolDrawerOpen(false);
      resourcePoolForm.resetFields();
      fetchAssignments(selectedOrg.id);
    } catch {}
  };

  const handleRemoveAssignment = async (poolId: string) => {
    if (!selectedOrg) return;
    try {
      const token = localStorage.getItem('token');
      await axios.delete(`/api/tenants/organizations/${selectedOrg.id}/resource-pools/${poolId}`, { headers: { Authorization: `Bearer ${token}` } });
      fetchAssignments(selectedOrg.id);
    } catch {}
  };

  useEffect(() => {
    if (!tenantId) return;
    fetchTenant(tenantId);
    fetchOrganizations(tenantId);
    fetchTenantRoles();
  }, [tenantId]);

  const fetchSdnVrs = async () => {
    if (!selectedOrg?.id || !tenantId) return;
    try {
      setSdnVrLoading(true);
      const res = await fetchVrCachePageList(1000, 1);
      const data = res?.data || res;
      let items: any[] = [];
      
      if (data && Array.isArray(data.page)) {
          items = data.page;
      } else if (data && Array.isArray(data.list)) {
          items = data.list;
      } else if (Array.isArray(data)) {
          items = data;
      }

      // Filter by tenantId and organizationId
      items = items.filter((item: any) => {
        const tid = String(item.tenant_id || item.tenantId || '');
        const oid = String(item.org_id || item.organizationId || '');
        return tid === String(tenantId) && oid === String(selectedOrg.id);
      });

      setSdnVrs(items);
    } catch {
      setSdnVrs([]);
    } finally {
      setSdnVrLoading(false);
    }
  };

  useEffect(() => {
    if (!selectedOrg?.id) return;
    if (!tenantId) return;
    fetchUsers(tenantId, selectedOrg.id);
    fetchAssignments(selectedOrg.id);
    (async () => {
      try {
        setSecurityLoading(true);
        const [objs, chains] = await Promise.all([
          fetchProtectionObjects({ organizationId: selectedOrg.id }),
          fetchServiceChains({ organizationId: selectedOrg.id }),
        ]);
        setProtectionObjects(Array.isArray(objs) ? objs : (objs?.data || []));
        setSecurityChains(Array.isArray(chains) ? chains : (chains?.data || []));
      } catch {
        setProtectionObjects([]);
        setSecurityChains([]);
      } finally {
        setSecurityLoading(false);
      }
    })();
    fetchSdnVrs();
  }, [selectedOrg?.id, tenantId]);

  useEffect(() => {
    setSdnContentOpacity(0);
    const t = setTimeout(() => setSdnContentOpacity(1), 0);
    return () => clearTimeout(t);
  }, [sdnActiveKey, selectedOrg?.id]);

  const filterOrgs = (orgs: Organization[], keyword: string): Organization[] => {
    const kw = keyword.trim().toLowerCase();
    if (!kw) return orgs;
    const visited = new Set<string>();
    const recur = (list: Organization[]): Organization[] => {
      const out: Organization[] = [];
      for (const org of list) {
        if (visited.has(org.id)) continue;
        visited.add(org.id);
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

  const buildTreeData = (orgs: Organization[]): DataNode[] => {
    const visited = new Set<string>();
    const recur = (list: Organization[]): DataNode[] => {
      return list.map(org => {
        if (visited.has(org.id)) return null;
        visited.add(org.id);
        const children = org.children ? recur(org.children) : [];
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
                icon={<CheckOutlined />}
                disabled={!newChildName.trim()}
                onClick={(e) => { e.stopPropagation(); handleAddChildSave(org.id); }}
              >保存</Button>
              <Button
                type="link"
                size="small"
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
              <Typography.Text style={{ pointerEvents: 'none' }}>{org.name}</Typography.Text>
            )}
            <div style={{ display:'flex', alignItems:'center', marginLeft:'auto', justifyContent:'flex-end' }}>
              {renameOrgId === org.id ? (
                <>
                  <Button
                    type="link"
                    size="small"
                    icon={<CheckOutlined />}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (!renameName.trim()) return;
                      handleOrgRename(org.id, renameName.trim());
                    }}
                  >保存</Button>
                  <Button
                    type="link"
                    size="small"
                    icon={<CloseOutlined />}
                    onClick={(e) => { e.stopPropagation(); setRenameOrgId(null); setRenameName(''); }}
                  >取消</Button>
                </>
              ) : (
                <Button
                  type="link"
                  size="small"
                  icon={<EditOutlined />}
                  onClick={(e) => { e.stopPropagation(); setRenameOrgId(org.id); setRenameName(org.name); }}
                >重命名</Button>
              )}
              <Button
                type="link"
                size="small"
                icon={<PlusOutlined />}
                disabled={org.level >= 4}
                onClick={(e) => {
                  e.stopPropagation();
                  setExpandedKeys(prev => (prev.includes(org.id) ? prev : [...prev, org.id]));
                  setAddingForParentId(org.id);
                  setNewChildName('');
                }}
              >添加子组织</Button>
              {org.level !== 1 && (
                <Button
                  type="link"
                  danger
                  size="small"
                  icon={<EditOutlined />}
                  onClick={(e) => {
                    e.stopPropagation();
                    Modal.confirm({
                      title: '确认删除组织',
                      content: '将删除该组织及其所有下级组织、关联用户与资源池分配。',
                      okText: '删除',
                      cancelText: '取消',
                      onOk: async () => {
                        try {
                          const token = localStorage.getItem('token');
                          await axios.delete(`/api/tenants/organizations/${org.id}`, { headers: { Authorization: `Bearer ${token}` } });
                          if (tenantId) fetchOrganizations(tenantId);
                        } catch {}
                      }
                    });
                  }}
                >删除</Button>
              )}
            </div>
          </div>
        ),
        children,
      } as DataNode;
    }).filter(Boolean) as DataNode[];
    };
    return recur(orgs);
  };

  const userColumns: ColumnsType<TenantUser> = [
    { title: '用户名', dataIndex: 'username', key: 'username' },
    { title: '角色', dataIndex: 'role', key: 'role', render: (role: string) => {
      const colors = { admin: 'red', user: 'blue', viewer: 'green' };
      const labels = { admin: '管理员', user: '用户', viewer: '查看者' };
      return <Tag color={colors[role as keyof typeof colors]}>{labels[role as keyof typeof labels]}</Tag>;
    }},
    { title: '状态', dataIndex: 'status', key: 'status', render: (status: string) => (
      <Tag color={status === 'active' ? 'green' : 'red'}>{status === 'active' ? '活跃' : '非活跃'}</Tag>
    )},
    {
      title: '操作',
      key: 'action',
      render: (_, record: TenantUser) => (
        <Dropdown
          menu={{
            items: [
              { key: 'assign', label: '配置角色' },
              { key: 'delete', label: '删除', danger: true }
            ],
            onClick: ({ key }) => {
              if (key === 'assign') {
                openRoleAssign(record);
              } else if (key === 'delete') {
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

  const assignmentColumns: ColumnsType<ResourcePoolAssignment> = [
    { title: '资源池名称', dataIndex: ['cloud', 'name'], key: 'name' },
    { 
      title: '资源池类型', 
      key: 'poolType', 
      render: (_: any, record: ResourcePoolAssignment) => {
        const pvRaw = String((record.cloud as any)?.config?.provider || '').trim().toLowerCase();
        const label =
          (pvRaw === 'aliyun' || pvRaw === 'huaweicloud' || pvRaw === 'tencentcloud') ? '公有云' :
          (pvRaw === 'cloudmap.private') ? '私有云' :
          (pvRaw === 'cloudmap.edge') ? '边缘计算' :
          (pvRaw === 'harvester') ? '虚拟化' :
          ((record.cloud as any)?.type || '-');
        return <Tag color="blue">{label}</Tag>;
      }
    },
    { title: '命名空间', dataIndex: 'namespace', key: 'namespace', render: (ns: string) => (ns ? <Tag>{ns}</Tag> : <span>-</span>) },
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
            items: [{ key: 'remove', label: '移除', danger: true }],
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

  return (
    <PageDetailContainer
      title="组织管理"
      icon={<ClusterOutlined />}
      subtitle="集中管理租户组织架构信息，提供用户与资源池的生命周期管理能力"
      overviewContent={
        <Descriptions bordered size="small" column={4}>
          <Descriptions.Item label="租户ID"><Typography.Text copyable>{tenant?.id || '-'}</Typography.Text></Descriptions.Item>
          <Descriptions.Item label="租户名称">{tenant?.name || '-'}</Descriptions.Item>
          <Descriptions.Item label="组织ID"><Typography.Text copyable>{selectedOrg?.id || '-'}</Typography.Text></Descriptions.Item>
          <Descriptions.Item label="组织名称">{selectedOrg?.name || '-'}</Descriptions.Item>
          <Descriptions.Item label="用户数量">{users.length}</Descriptions.Item>
          <Descriptions.Item label="资源池数量">{assignments.length}</Descriptions.Item>
          <Descriptions.Item label="安全资源池">{assignments.filter(a => {
            const pvRaw = String((a.cloud as any)?.config?.provider || (a.cloud as any)?.type || '').trim().toLowerCase();
            return pvRaw === 'cloudmap.csm';
          }).length}</Descriptions.Item>
          <Descriptions.Item label="防护对象数量">{protectionObjects.length}</Descriptions.Item>
          <Descriptions.Item label="服务链数量">{securityChains.length}</Descriptions.Item>
        </Descriptions>
      }
      defaultOverviewCollapsed={false}
      onBack={() => navigate('/admin/tenants')}
      asCard={false}
    >
      {organizations.length > 0 ? (
        <Row gutter={[16,16]}>
          <Col span={8}>
            <Card size="small" title="组织架构" styles={{ body: { padding: 0 } }}>
              <div style={{ padding: 12, borderBottom: '1px solid #f0f0f0', background: '#fafafa' }}>
                <Input
                  allowClear
                  placeholder="搜索组织名称"
                  value={orgKeyword}
                  onChange={(e)=> setOrgKeyword(e.target.value)}
                />
              </div>
              <div style={{ maxHeight: '70vh', overflow: 'auto', padding: 12 }}>
                <Tree
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
            </Card>
          </Col>
          <Col span={16}>
            <Card size="small" title="组织管理" styles={{ body: { padding: 12 } }}>
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
              <Tabs.TabPane tab="计算资源分配" key="assign">
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
                          setAssignType('compute');
                          setResourcePoolDrawerOpen(true);
                        }}
                       >分配计算资源池</Button>
                    </div>
                    <Table
                      columns={assignmentColumns}
                      dataSource={(assignmentKeyword.trim() ? assignments.filter(a => {
                        const kw = assignmentKeyword.trim().toLowerCase();
                        const name = String((a.cloud as any)?.name || '').toLowerCase();
                        const type = String((a.cloud as any)?.type || '').toLowerCase();
                        const provider = String((a.cloud as any)?.config?.provider || '').toLowerCase();
                        return name.includes(kw) || type.includes(kw) || provider.includes(kw);
                      }) : assignments.filter(a => {
                        const pvRaw = String((a.cloud as any)?.config?.provider || (a.cloud as any)?.type || '').trim().toLowerCase();
                        const t = String((a.cloud as any)?.type || '').toLowerCase();
                        const isSecurity = pvRaw === 'cloudmap.csm';
                        const isStorage = t === 'object_storage' || t === 'file_storage';
                        return !isSecurity && !isStorage;
                      }))}
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
              <Tabs.TabPane tab="存储资源分配" key="storage">
                {selectedOrg ? (
                  <div>
                    <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <Input
                        allowClear
                        placeholder="搜索资源池关键字"
                        style={{ width: 240 }}
                        value={storageKeyword}
                        onChange={(e)=> setStorageKeyword(e.target.value)}
                      />
                      <Button 
                        type="primary" 
                        onClick={() => {
                          fetchResourcePools();
                          resourcePoolForm.resetFields();
                          setAssignType('storage');
                          setResourcePoolDrawerOpen(true);
                        }}
                       >分配存储资源池</Button>
                    </div>
                    <Table
                      columns={assignmentColumns}
                      dataSource={(storageKeyword.trim() ? assignments.filter(a => {
                        const kw = storageKeyword.trim().toLowerCase();
                        const name = String((a.cloud as any)?.name || '').toLowerCase();
                        const type = String((a.cloud as any)?.type || '').toLowerCase();
                        const provider = String((a.cloud as any)?.config?.provider || '').toLowerCase();
                        const isStorage = type === 'object_storage' || type === 'file_storage';
                        return isStorage && (name.includes(kw) || type.includes(kw) || provider.includes(kw));
                      }) : assignments.filter(a => {
                        const type = String((a.cloud as any)?.type || '').toLowerCase();
                        return type === 'object_storage' || type === 'file_storage';
                      }))}
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
              <Tabs.TabPane tab="安全资源分配" key="cloud-security">
                {selectedOrg ? (
                  <div>
                    <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <Input
                        allowClear
                        placeholder="搜索资源池关键字"
                        style={{ width: 240 }}
                        value={securityKeyword}
                        onChange={(e)=> setSecurityKeyword(e.target.value)}
                      />
                      <Button
                        type="primary"
                        onClick={() => {
                          fetchResourcePools();
                          resourcePoolForm.resetFields();
                          setAssignType('security');
                          setResourcePoolDrawerOpen(true);
                        }}
                      >分配安全资源池</Button>
                    </div>
                    <Table
                      columns={assignmentColumns}
                      dataSource={(securityKeyword.trim() ? assignments.filter(a => {
                        const pvRaw = String((a.cloud as any)?.config?.provider || (a.cloud as any)?.type || '').trim().toLowerCase();
                        const isSecurity = pvRaw === 'cloudmap.csm';
                        if (!isSecurity) return false;
                        const kw = securityKeyword.trim().toLowerCase();
                        const name = String((a.cloud as any)?.name || '').toLowerCase();
                        const type = String((a.cloud as any)?.type || '').toLowerCase();
                        const provider = String((a.cloud as any)?.config?.provider || '').toLowerCase();
                        return name.includes(kw) || type.includes(kw) || provider.includes(kw);
                      }) : assignments.filter(a => {
                        const pvRaw = String((a.cloud as any)?.config?.provider || (a.cloud as any)?.type || '').trim().toLowerCase();
                        const isSecurity = pvRaw === 'cloudmap.csm';
                        return isSecurity;
                      }))}
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
              <Tabs.TabPane tab="SDN资源" key="sdn-resources">
                {selectedOrg ? (
                  <div style={{ display: 'flex', minHeight: 260 }}>
                    <div
                      style={{
                        width: 200,
                        borderRight: '1px solid #f0f0f0',
                        padding: '8px 0',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 4
                      }}
                      tabIndex={0}
                      onKeyDown={(e) => {
                        const order: Array<'vr'|'objects'|'chains'> = ['vr', 'objects', 'chains'];
                        const idx = order.indexOf(sdnActiveKey);
                        if (e.key === 'ArrowDown') {
                          const next = order[(idx + 1) % order.length];
                          setSdnActiveKey(next);
                          e.preventDefault();
                        } else if (e.key === 'ArrowUp') {
                          const next = order[(idx - 1 + order.length) % order.length];
                          setSdnActiveKey(next);
                          e.preventDefault();
                        }
                      }}
                    >
                      {[
                        { key: 'vr' as const, label: 'VR / 网关', icon: <GatewayOutlined /> },
                        { key: 'objects' as const, label: '防护对象', icon: <SafetyCertificateOutlined /> },
                        { key: 'chains' as const, label: '服务链', icon: <NodeIndexOutlined /> },
                      ].map(item => {
                        const active = sdnActiveKey === item.key;
                        return (
                          <div
                            key={item.key}
                            role="tab"
                            aria-selected={active}
                            tabIndex={active ? 0 : -1}
                            onClick={() => setSdnActiveKey(item.key)}
                            style={{
                              height: 40,
                              display: 'flex',
                              alignItems: 'center',
                              padding: '0 16px',
                              cursor: 'pointer',
                              gap: 8,
                              color: active ? '#1677ff' : 'rgba(0,0,0,0.65)',
                              background: active ? '#e6f4ff' : 'transparent',
                              borderLeft: active ? '3px solid #1677ff' : '3px solid transparent'
                            }}
                          >
                            {item.icon}
                            <span>{item.label}</span>
                          </div>
                        );
                      })}
                    </div>
                    <div
                      style={{
                        flex: 1,
                        padding: '8px 16px',
                        transition: 'opacity 0.2s ease',
                        opacity: sdnContentOpacity
                      }}
                    >
                      {sdnActiveKey === 'vr' && (
                        <Table
                          size="small"
                          bordered
                          loading={sdnVrLoading}
                          rowKey={(r: any) => r.vr_unique_id || r.uuid || r.id}
                          dataSource={sdnVrs}
                          pagination={{ pageSize: 5 }}
                          columns={[
                            { title: '名称', dataIndex: 'name', key: 'name' },
                            { title: 'VR唯一ID', dataIndex: 'vr_unique_id', key: 'vr_unique_id', ellipsis: true },
                            { title: '租户ID', dataIndex: 'tenant_id', key: 'tenant_id', ellipsis: true },
                            { title: '组织ID', dataIndex: 'org_id', key: 'org_id', ellipsis: true },
                            { title: '绑定状态', dataIndex: 'bind_status', key: 'bind_status', render: (v: string, r: any) => {
                              if (r.is_deleted) return <Tag color="error">CSM已删除</Tag>;
                              if (!v) return <Tag>未知</Tag>;
                              if (v === 'BOUND') return <Tag color="green">已绑定</Tag>;
                              if (v === 'UNBOUND') return <Tag color="default">未绑定</Tag>;
                              return <Tag color="orange">{v}</Tag>;
                            } },
                            {
                              title: '操作',
                              key: 'action',
                              width: 100,
                              render: (_: any, r: any) => (
                                <Button type="link" danger size="small" onClick={() => {
                                  Modal.confirm({
                                    title: '确认删除',
                                    content: '确定要删除该VR绑定记录吗？',
                                    onOk: async () => {
                                      try {
                                        const token = localStorage.getItem('token');
                                        await axios.delete(`/api/vr-config/${r.uuid}`, { headers: { Authorization: `Bearer ${token}` } });
                                        message.success('删除成功');
                                        fetchSdnVrs();
                                      } catch (e) {
                                        message.error('删除失败');
                                      }
                                    }
                                  });
                                }}>删除</Button>
                              )
                            }
                          ]}
                        />
                      )}
                      {sdnActiveKey === 'objects' && (
                        <Table
                          size="small"
                          bordered
                          loading={securityLoading}
                          rowKey={(r: any) => r.id || r._id}
                          dataSource={protectionObjects}
                          pagination={{ pageSize: 5 }}
                          columns={[
                            { title: '名称', dataIndex: 'name', key: 'name' },
                            { title: '类型', dataIndex: 'type', key: 'type' },
                            { title: '值', dataIndex: 'value', key: 'value' },
                            { title: '描述', dataIndex: 'description', key: 'description', ellipsis: true }
                          ]}
                        />
                      )}
                      {sdnActiveKey === 'chains' && (
                        <Table
                          size="small"
                          bordered
                          loading={securityLoading}
                          rowKey={(r: any) => r.id || r._id}
                          dataSource={securityChains}
                          pagination={{ pageSize: 5 }}
                          columns={[
                            { title: '名称', dataIndex: 'name', key: 'name' },
                            { title: '服务链ID', dataIndex: 'id', key: 'id' },
                            { title: '状态', dataIndex: 'status', key: 'status' }
                          ]}
                        />
                      )}
                    </div>
                  </div>
                ) : (
                  <div style={{ textAlign: 'center', padding: 40, color: '#999' }}>请先在左侧选择一个组织</div>
                )}
              </Tabs.TabPane>
            </Tabs>
            </Card>
          </Col>
        </Row>
      ) : (
        <div style={{ textAlign: 'center', padding: 40, color: '#999' }}>暂无组织数据</div>
      )}

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
          <Form.Item label="用户名" name="username" rules={[{ required: true }]}>
            <Input placeholder="请输入用户名" />
          </Form.Item>
          <Form.Item label="姓名" name="fullName" rules={[{ required: true }]}>
            <Input placeholder="请输入姓名" />
          </Form.Item>
          <Form.Item label="邮箱" name="email" rules={[{ required: true }, { type: 'email' }]}>
            <Input placeholder="请输入邮箱" />
          </Form.Item>
          <Form.Item label="密码" name="password" rules={[{ required: true }]}>
            <Input.Password placeholder="请输入密码" />
          </Form.Item>
          <Form.Item label="角色" name="role" rules={[{ required: true }]}>
            <Select placeholder="请选择角色">
              <Select.Option value="admin">管理员</Select.Option>
              <Select.Option value="user">用户</Select.Option>
              <Select.Option value="viewer">查看者</Select.Option>
            </Select>
          </Form.Item>
        </Form>
      </StdSideDrawer>

      <StdSideDrawer
        title={assignType === 'security' ? '分配安全资源池' : '分配计算资源池'}
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
          <Form.Item label="选择资源池" name="resourcePoolIds" rules={[{ required: true }]}> 
            <Select mode={undefined} placeholder="请选择资源池" style={{ width: '100%' }} onChange={async (val: any) => {
              try {
                setNsOptions([]);
                resourcePoolForm.setFieldsValue({ namespace: undefined });
                const poolId = Array.isArray(val) ? val[0] : val;
                const pool = (resourcePools || []).find((p:any)=> p.id === poolId);
                const pvRaw = String(pool?.config?.provider || pool?.type || '').trim().toLowerCase();
                if (pvRaw === 'harvester' || pvRaw === 'cloudmap.private' || pvRaw === 'cloudmap.edge') {
                  setNsLoading(true);
                  const token = localStorage.getItem('token');
                  const resp = await axios.get(`/api/clouds/${poolId}/resources/harvester/namespaces`, { headers: { Authorization: `Bearer ${token}` } });
                  const items: any[] = resp?.data?.data?.items || resp?.data?.items || [];
                  setNsOptions(items);
                }
              } catch { setNsOptions([]); } finally { setNsLoading(false); }
            }}>
              {(resourcePools || []).filter((pool:any) => {
                const pvRaw = String(pool?.config?.provider || pool?.type || '').trim().toLowerCase();
                const t = String(pool?.type || '').toLowerCase();
                const isSec = pvRaw === 'cloudmap.csm';
                const isStorage = t === 'object_storage' || t === 'file_storage';
                if (assignType === 'security') return isSec;
                if (assignType === 'storage') return isStorage;
                return !isSec && !isStorage;
              }).map((pool:any) => (
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
          <Form.Item noStyle shouldUpdate>
            {() => {
              const poolId = resourcePoolForm.getFieldValue('resourcePoolIds');
              const pool = (resourcePools || []).find((p:any)=> p.id === (Array.isArray(poolId) ? poolId[0] : poolId));
              const pvRaw = String(pool?.config?.provider || pool?.type || '').trim().toLowerCase();
              const needNs = pvRaw === 'harvester' || pvRaw === 'cloudmap.private' || pvRaw === 'cloudmap.edge';
              return needNs ? (
                <Form.Item label="命名空间" name="namespace" rules={[{ required: true, message: '请选择命名空间' }]}>
                  <Select placeholder="请选择命名空间" loading={nsLoading} style={{ width: '100%' }}>
                    {(nsOptions || []).map((x:any) => {
                      const name = x?.metadata?.name || x?.name;
                      return <Select.Option key={name} value={name}>{name}</Select.Option>;
                    })}
                  </Select>
                </Form.Item>
              ) : null;
            }}
          </Form.Item>
        </Form>
      </StdSideDrawer>

      <StdSideDrawer
        title="配置权限角色"
        open={roleAssignOpen}
        width={800}
        onClose={() => {
          setRoleAssignOpen(false);
          setRoleAssignUser(null);
          setRoleAssignExisting([]);
          setRoleAssignSelected([]);
        }}
        onOk={saveRoleAssign}
        okText="保存"
      >
        <Form layout="vertical" style={{ display: 'flex', gap: 16, marginBottom: 16 }}>
          <Form.Item label="关键字" style={{ flex: 1, marginBottom: 0 }}>
            <Input.Search
              allowClear
              placeholder="搜索角色名称或说明"
              value={roleAssignKw}
              onChange={e => setRoleAssignKw(e.target.value)}
            />
          </Form.Item>
        </Form>
        <Transfer
          dataSource={tenantRoles
            .filter(r => (roleAssignKw ? ((r.name || '').toLowerCase().includes(roleAssignKw.toLowerCase()) || (r.description || '').toLowerCase().includes(roleAssignKw.toLowerCase())) : true))
            .map(r => ({ key: r.id, title: r.name, description: r.description }))}
          titles={['角色库', '已选角色']}
          targetKeys={roleAssignSelected}
          onChange={next => setRoleAssignSelected(next.map(String))}
          showSearch
          filterOption={(inputValue, item) => {
            const v = inputValue.toLowerCase();
            return (item.title || '').toLowerCase().includes(v) || (item.description || '').toLowerCase().includes(v);
          }}
          style={{ width: '100%' }}
          listStyle={{ flex: '1 1 0', minWidth: 0, height: 420 }}
          render={item => (
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <span style={{ fontWeight: 500 }}>{item.title}</span>
              <span style={{ color: '#888', fontSize: 12 }}>{item.description || '—'}</span>
            </div>
          )}
        />
        <div style={{ marginTop: 8, fontSize: 12, color: '#888' }}>保存将同步新增与移除的角色赋权</div>
      </StdSideDrawer>
    </PageDetailContainer>
  );
};

export default OrgManagePage;
