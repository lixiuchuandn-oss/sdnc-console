import React, { useState, useEffect } from 'react';
import { 
  Table, 
  Button, 
  Form, 
  Input, 
  message, 
  Dropdown,
  Modal,
  Row,
  Col,
  Tabs,
  Typography,
  Select,
} from 'antd';
import { 
  EllipsisOutlined,
  SettingOutlined,
  ReloadOutlined
} from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { Tenant, Organization, CreateTenantRequest } from '../../types/tenant';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import PageContainer from '../../components/PageContainer';
import StdSideDrawer from '../../components/StdSideDrawer';
// import SharedToolbar from '../../components/SharedToolbar';
import ResourceActionsDropdown from '../../components/ResourceActionsDropdown';

const { TextArea } = Input;

const TenantsPage: React.FC = () => {
  const [loading, setLoading] = useState(false);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [tenantDrawerOpen, setTenantDrawerOpen] = useState(false);
  const [editingTenant, setEditingTenant] = useState<Tenant | null>(null);
  const [tenantForm] = Form.useForm();
  const [filterForm] = Form.useForm();
  
  // 租户搜索关键字
  const [tenantSearch, setTenantSearch] = useState('');
  
  // 选中的行
  const [selectedTenantRowKeys, setSelectedTenantRowKeys] = useState<React.Key[]>([]);
  const [selectedTenant, setSelectedTenant] = useState<Tenant | null>(null);

  // 组织数量缓存
  const [tenantOrgCountMap, setTenantOrgCountMap] = useState<Record<string, number>>({});
  const [tenantUserCountMap, setTenantUserCountMap] = useState<Record<string, number>>({});
  
  // 展开的树节点
  const [expandedKeys, setExpandedKeys] = useState<React.Key[]>([]);
  const [selectedKeys, setSelectedKeys] = useState<React.Key[]>([]);
  const navigate = useNavigate();

  // 获取租户列表
  const fetchTenants = async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await axios.get('/api/tenants', {
        headers: { Authorization: `Bearer ${token}` }
      });
      setTenants(response.data);
      // 异步刷新组织数量
      refreshOrgCounts(response.data);
      // 异步刷新用户数量
      refreshUserCounts(response.data);
    } catch (error) {
      message.error('获取租户列表失败');
    }
  };

  // 批量刷新所有租户的用户数量
  const refreshUserCounts = async (list: Tenant[]) => {
    try {
      const token = localStorage.getItem('token');
      const pairs: [string, number][] = [];
      
      const chunkSize = 5;
      for (let i = 0; i < list.length; i += chunkSize) {
        const chunk = list.slice(i, i + chunkSize);
        const chunkResults = await Promise.all(chunk.map(async (t) => {
          try {
            const res = await axios.get(`/api/tenants/${t.id}/users`, {
              headers: { Authorization: `Bearer ${token}` }
            });
            const users = Array.isArray(res.data) ? res.data : (res.data?.users || []);
            return [t.id, users.length] as const;
          } catch {
            return [t.id, 0] as const;
          }
        }));
        // @ts-ignore
        pairs.push(...chunkResults);
      }

      setTenantUserCountMap(prev => {
        const next = { ...prev };
        for (const [id, cnt] of pairs) next[id] = cnt;
        return next;
      });
    } catch {
      // ignore
    }
  };

  // 批量刷新所有租户的组织数量
  const refreshOrgCounts = async (list: Tenant[]) => {
    try {
      const token = localStorage.getItem('token');
      const pairs: [string, number][] = [];
      
      // 分批处理，避免并发过高
      const chunkSize = 5;
      for (let i = 0; i < list.length; i += chunkSize) {
        const chunk = list.slice(i, i + chunkSize);
        const chunkResults = await Promise.all(chunk.map(async (t) => {
          try {
            const res = await axios.get(`/api/tenants/${t.id}/organizations`, {
              headers: { Authorization: `Bearer ${token}` }
            });
            const countAll = (orgs: Organization[]): number => {
              let c = 0;
              const visited = new Set<string>();
              const recur = (ls: Organization[]) => {
                for (const o of ls) {
                  if (visited.has(o.id)) continue;
                  visited.add(o.id);
                  c += 1;
                  if (o.children && o.children.length) recur(o.children);
                }
              };
              recur(orgs);
              return c;
            };
            return [t.id, countAll(res.data)] as const;
          } catch {
            return [t.id, 0] as const;
          }
        }));
        // @ts-ignore
        pairs.push(...chunkResults);
      }

      setTenantOrgCountMap(prev => {
        const next = { ...prev };
        for (const [id, cnt] of pairs) next[id] = cnt;
        return next;
      });
    } catch {
      // ignore
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
    const token = localStorage.getItem('token');
    await axios.delete(`/api/tenants/${id}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    message.success('租户删除成功');
    fetchTenants();
    if (selectedTenant?.id === id) {
      setSelectedTenant(null);
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

  // 租户表格列定义
  const tenantColumns: ColumnsType<Tenant> = [
    {
      title: '租户',
      dataIndex: 'name',
      key: 'name',
      render: (text: string, record: Tenant) => (
        <div style={{ display:'flex', alignItems:'center', gap:8 }}>
          <a className="cell-link" onClick={()=>navigate(`/admin/tenants/${record.id}/organizations`)}>
            {text}
          </a>
        </div>
      )
    },
    {
      title: 'ID',
      dataIndex: 'id',
      key: 'id',
      render: (text: string) => <Typography.Text copyable style={{ fontSize: 12 }}>{text}</Typography.Text>
    },
    {
      title: '组织数量',
      key: 'orgCount',
      render: (_: any, record: Tenant) => <span className="stat-trigger">{tenantOrgCountMap[record.id] ?? '-'}</span>
    },
    {
      title: '用户数量',
      key: 'userCount',
      render: (_: any, record: Tenant) => <span className="stat-trigger">{tenantUserCountMap[record.id] ?? '-'}</span>
    },
    {
      title: '创建时间',
      dataIndex: 'createdAt',
      key: 'createdAt',
      render: (date: string) => <span className="std-time">{new Date(date).toLocaleString()}</span>
    },
    {
      title: '操作',
      key: 'action',
      render: (_, record: Tenant) => (
        <ResourceActionsDropdown
          items={[
            { key: 'edit', label: '编辑' },
            { key: 'delete', label: '删除', danger: true },
            { key: 'orgManage', label: '组织管理' },
          ]}
          onClick={({ key }) => {
            if (key === 'edit') {
              setEditingTenant(record);
              tenantForm.setFieldsValue(record);
              setTenantDrawerOpen(true);
              return;
            }
            if (key === 'delete') {
              const confirmInstance = Modal.confirm({
                title: '确认删除租户',
                content: '删除后将无法恢复，相关的组织和用户也会被删除。',
                okText: '删除',
                cancelText: '取消',
                onOk: async () => {
                  try {
                    await handleDeleteTenant(record.id);
                  } catch (error: any) {
                    const errorMessage = error?.response?.data?.message || '删除租户失败';
                    const resources = error?.response?.data?.resources || [];
                    
                    // 关闭确认框
                    confirmInstance.destroy();
                    
                    // 如果是资源绑定错误，使用 Modal.error 显示详细信息
                    if (error?.response?.status === 409) {
                      Modal.error({
                        title: '无法删除租户',
                        width: 500,
                        content: (
                          <div style={{ marginTop: 16 }}>
                            <p style={{ marginBottom: 16, color: '#ff4d4f' }}>
                              {errorMessage}
                            </p>
                            
                            {resources.length > 0 && (
                              <div style={{ marginBottom: 16 }}>
                                <div style={{ marginBottom: 8, fontWeight: 500 }}>关联资源：</div>
                                <ul style={{ margin: 0, paddingLeft: 20 }}>
                                  {resources.map((r: any, index: number) => (
                                    <li key={index} style={{ marginBottom: 4 }}>
                                      {r.name} ({r.count}个)
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            )}

                            <p style={{ margin: 0, color: '#8c8c8c', fontSize: 12 }}>
                              请先解除上述资源绑定后再尝试删除租户。
                            </p>
                          </div>
                        ),
                      });
                    } else {
                      // 其他错误显示普通消息
                      message.error(errorMessage);
                    }
                  }
                },
              });
              return;
            }
            if (key === 'orgManage') {
              navigate(`/admin/tenants/${record.id}/organizations`);
              return;
            }
          }}
        />
      ),
    },
  ];

  // 过滤后的租户列表
  const [idFilter, setIdFilter] = useState<string>('');
  
  const handleFilterChange = (_: any, all: any) => {
    setTenantSearch(all.keyword || '');
    setIdFilter(all.id || '');
  };
  
  const filteredTenants = tenants.filter(t => {
    const okKeyword = t.name.toLowerCase().includes(tenantSearch.toLowerCase()) || (t.description || '').toLowerCase().includes(tenantSearch.toLowerCase());
    const okId = !idFilter || t.id.toLowerCase().includes(idFilter.toLowerCase());
    return okKeyword && okId;
  });

  useEffect(() => {
    fetchTenants();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <PageContainer
      titleLevel={3}
      asCard={false}
    >

      <div className="page-toolbar">
        <Form
          className="toolbar-container"
          form={filterForm}
          layout="vertical"
          style={{ rowGap: 12, columnGap: 12, display: 'flex', alignItems: 'flex-end' }}
          onValuesChange={handleFilterChange}
        >
          <Form.Item name="keyword" label="租户名称"><Input className="toolbar-search" allowClear placeholder="支持模糊查询" /></Form.Item>
          <Form.Item name="id" label="ID"><Input className="toolbar-search" allowClear placeholder="请输入ID" /></Form.Item>
          <a className="toolbar-reset-btn" onClick={()=>{ filterForm.resetFields(); setTenantSearch(''); setIdFilter(''); }}>重置</a>
        </Form>
        <div className="toolbar-actions">
          <Button type="primary" onClick={()=> setTenantDrawerOpen(true)}>添加租户</Button>
          <Dropdown
            menu={{
              items: [
                { key: 'batchDelete', label: '批量删除', danger: true, disabled: selectedTenantRowKeys.length === 0 },
              ],
              onClick: ({ key }) => {
                if (key === 'batchDelete') { handleBatchDeleteTenants(); return; }
              }
            }}
          >
            <Button icon={<EllipsisOutlined />} />
          </Dropdown>
          <Button icon={<SettingOutlined />} />
          <Button icon={<ReloadOutlined />} onClick={fetchTenants} loading={loading} />
        </div>
      </div>

      {/* 表格与详情 */}
      <Row gutter={[16,16]}>
        <Col span={24}>
          <Table
            className="std-table"
            bordered
            columns={tenantColumns}
            dataSource={filteredTenants}
            rowKey="id"
            rowSelection={{ selectedRowKeys: selectedTenantRowKeys, onChange: (keys)=> setSelectedTenantRowKeys(keys as string[]) }}
            pagination={{ 
              size: 'small', 
              showSizeChanger: true, 
              pageSize: 10,
              pageSizeOptions: ['10', '20', '50', '100'],
              showQuickJumper: false 
            }}
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
        </Form>
      </StdSideDrawer>
    </PageContainer>
  );
};

export default TenantsPage;
