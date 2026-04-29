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
  Typography,
} from 'antd';
import { 
  EllipsisOutlined,
  SettingOutlined,
  ReloadOutlined,
  SearchOutlined
} from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { Tenant, Organization, CreateTenantRequest } from '../../../types/tenant';
import { useNavigate } from 'react-router-dom';
import PageContainer from '../../../components/PageContainer';
import StdSideDrawer from '../../../components/StdSideDrawer';
// import SharedToolbar from '../../../components/SharedToolbar';
import ResourceActionsDropdown from '../../../components/ResourceActionsDropdown';
import { apiRequest, apiPost, apiPatch, apiDelete } from '../../../services/api';

const { TextArea } = Input;

/** 与删除接口一致：有组织用户则不可删；单框提示，避免「确认删除」后再弹错误 */
function showTenantDeleteBlockedByOrgUsersModal(
  tenantName: string,
  userCount: number,
) {
  Modal.warning({
    title: '无法删除租户',
    width: 480,
    okText: '知道了',
    content: (
      <div>
        <p style={{ marginBottom: 12 }}>
          租户「{tenantName}」下仍有组织用户（共 <strong>{userCount}</strong> 个），无法删除。
        </p>
        <p style={{ marginBottom: 0, color: '#8c8c8c', fontSize: 13 }}>
          请先在「租户用户」中删除全部组织用户后，再删除租户。
        </p>
      </div>
    ),
  });
}

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
  
  const navigate = useNavigate();

  // 获取租户列表
  const fetchTenants = async (force: boolean = false) => {
    try {
      setLoading(true);
      const url = force ? '/api/tenants?force=true' : '/api/tenants';
      // 强制刷新时跳过缓存，确保获取最新数据
      const data = await apiRequest(url, force ? { skipCache: true } : undefined);
      const tenantsList = Array.isArray(data) ? data : (data?.tenants || []);
      setTenants(tenantsList);
      // 异步刷新组织数量
      refreshOrgCounts(tenantsList);
      // 异步刷新用户数量
      refreshUserCounts(tenantsList);
    } catch (error) {
      message.error('获取租户列表失败');
    } finally {
      setLoading(false);
    }
  };

  // 批量刷新所有租户的用户数量
  const refreshUserCounts = async (list: Tenant[]) => {
    try {
      const pairs: [string, number][] = [];
      
      const chunkSize = 5;
      for (let i = 0; i < list.length; i += chunkSize) {
        const chunk = list.slice(i, i + chunkSize);
        const chunkResults = await Promise.all(chunk.map(async (t) => {
          try {
            const res = await apiRequest(`/api/tenants/${t.id}/users`);
            const users = Array.isArray(res) ? res : (res?.users || []);
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
      const pairs: [string, number][] = [];
      
      // 分批处理，避免并发过高
      const chunkSize = 5;
      for (let i = 0; i < list.length; i += chunkSize) {
        const chunk = list.slice(i, i + chunkSize);
        const chunkResults = await Promise.all(chunk.map(async (t) => {
          try {
            const res = await apiRequest(`/api/tenants/${t.id}/organizations`);
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
            const orgs = Array.isArray(res) ? res : (res?.organizations || []);
            return [t.id, countAll(orgs)] as const;
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
      if (editingTenant) {
        await apiPatch(`/api/tenants/${editingTenant.id}`, values);
        message.success('租户更新成功');
      } else {
        await apiPost('/api/tenants', values);
        message.success('租户创建成功');
      }
      setTenantDrawerOpen(false);
      setEditingTenant(null);
      tenantForm.resetFields();
      fetchTenants(true);
    } catch (error: any) {
      message.error(error?.message || '操作失败');
    }
  };

  // 删除前拉取组织用户数量（与后端删除校验一致）；用于单框拦截，避免先确认再报错
  const refreshTenantUserCount = async (tenantId: string): Promise<number> => {
    try {
      const res = await apiRequest(`/api/tenants/${tenantId}/users`);
      const users = Array.isArray(res) ? res : (res?.users || []);
      const n = users.length;
      setTenantUserCountMap((prev) => ({ ...prev, [tenantId]: n }));
      return n;
    } catch {
      return -1;
    }
  };

  // 删除租户
  const handleDeleteTenant = async (id: string) => {
    await apiDelete(`/api/tenants/${id}`);
    message.success('租户删除成功');
    fetchTenants(true);
    if (selectedTenant?.id === id) {
      setSelectedTenant(null);
    }
  };

  const handleBatchDeleteTenants = async () => {
    if (selectedTenantRowKeys.length === 0) { message.info('请先选择要删除的租户'); return; }

    const ids = selectedTenantRowKeys.map(String);
    const counts = await Promise.all(
      ids.map(async (id) => {
        const n = await refreshTenantUserCount(id);
        return { id, n };
      }),
    );
    const blocked = counts.filter((x) => x.n > 0);
    if (blocked.length > 0) {
      Modal.warning({
        title: '无法批量删除',
        width: 520,
        okText: '知道了',
        content: (
          <div>
            <p style={{ marginBottom: 12 }}>
              以下租户仍包含组织用户，无法删除（需先删除租户下全部组织用户）：
            </p>
            <ul style={{ margin: '0 0 0 18px', padding: 0 }}>
              {blocked.map(({ id, n }) => {
                const t = tenants.find((x) => x.id === id);
                const label = t?.name || id;
                return (
                  <li key={id} style={{ marginBottom: 4 }}>
                    「{label}」：{n} 名组织用户
                  </li>
                );
              })}
            </ul>
            <p style={{ marginBottom: 0, color: '#8c8c8c', fontSize: 13 }}>
              请处理后再执行批量删除。
            </p>
          </div>
        ),
      });
      return;
    }
    if (counts.some((x) => x.n < 0)) {
      message.error('无法校验部分租户的组织用户数量，请稍后重试');
      return;
    }

    Modal.confirm({
      title: '确认批量删除租户',
      content:
        '删除后将无法恢复。若某租户仍存在资源绑定等占用， 해당租户将无法删除。',
      okText: '删除',
      cancelText: '取消',
      onOk: async () => {
        const results = await Promise.allSettled(
          selectedTenantRowKeys.map((id) => apiDelete(`/api/tenants/${id}`))
        );
        const errors: string[] = [];
        results.forEach((r, i) => {
          if (r.status === 'rejected') {
            const reason = r.reason as { response?: { data?: { message?: string } }; message?: string };
            const msg =
              reason?.response?.data?.message ||
              reason?.message ||
              `租户 ${selectedTenantRowKeys[i]} 删除失败`;
            errors.push(msg);
          }
        });
        const ok = results.filter((r) => r.status === 'fulfilled').length;
        if (ok > 0) {
          message.success(`已删除 ${ok} 个租户`);
          fetchTenants(true);
          setSelectedTenantRowKeys([]);
        }
        if (errors.length > 0) {
          Modal.error({
            title: ok > 0 ? '部分租户删除失败' : '批量删除租户失败',
            width: 520,
            content: (
              <div style={{ maxHeight: 280, overflow: 'auto', whiteSpace: 'pre-wrap' }}>
                {errors.join('\n')}
              </div>
            ),
          });
        }
      },
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
          <a
            className="cell-link"
            href={`/admin/tenants/${record.id}/organizations`}
            onClick={(e) => {
              e.preventDefault();
              navigate(`/admin/tenants/${record.id}/organizations`);
            }}
          >
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
              void (async () => {
                const n = await refreshTenantUserCount(record.id);
                if (n < 0) {
                  message.error('无法校验组织用户数量，请稍后重试');
                  return;
                }
                if (n > 0) {
                  showTenantDeleteBlockedByOrgUsersModal(record.name, n);
                  return;
                }

                Modal.confirm({
                  title: '确认删除租户',
                  content:
                    '删除后将无法恢复。若仍存在资源绑定等占用，系统将拒绝删除。',
                  okText: '删除',
                  cancelText: '取消',
                  onOk: async () => {
                    try {
                      await handleDeleteTenant(record.id);
                    } catch (error: any) {
                      const status = error?.response?.status;
                      const errorMessage =
                        error?.response?.data?.message || error?.message || '删除租户失败';
                      const resources = error?.response?.data?.resources || [];
                      const blockingReason = error?.response?.data?.blockingReason;
                      const fallbackUserCount =
                        typeof error?.response?.data?.userCount === 'number'
                          ? error.response.data.userCount
                          : undefined;

                      if (status === 409 && blockingReason === 'ORG_USERS') {
                        showTenantDeleteBlockedByOrgUsersModal(
                          record.name,
                          fallbackUserCount ?? 1,
                        );
                        return;
                      }

                      if (status === 409) {
                        Modal.error({
                          title: '无法删除租户',
                          width: 500,
                          content: (
                            <div style={{ marginTop: 16 }}>
                              <p style={{ marginBottom: 16, color: '#ff4d4f' }}>{errorMessage}</p>

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
                                {resources.length > 0
                                  ? '请先解除上述资源绑定后再尝试删除租户。'
                                  : '请根据页面提示处理后再尝试删除租户。'}
                              </p>
                            </div>
                          ),
                        });
                      } else {
                        message.error(errorMessage);
                      }
                    }
                  },
                });
              })();
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
  const handleFilterChange = (_: any, all: any) => {
    setTenantSearch(all.keyword || '');
  };
  
  const filteredTenants = tenants.filter(t => {
    if (!tenantSearch) return true;
    const searchLower = tenantSearch.toLowerCase();
    return t.name.toLowerCase().includes(searchLower) || 
           (t.description || '').toLowerCase().includes(searchLower) ||
           t.id.toLowerCase().includes(searchLower);
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
          <Form.Item name="keyword">
            <Input 
              className="toolbar-search" 
              allowClear 
              placeholder="关键字搜索" 
              suffix={<SearchOutlined style={{ color: 'rgba(0,0,0,.45)' }} />}
            />
          </Form.Item>
          <button
            type="button"
            className="toolbar-reset-btn"
            onClick={()=>{ filterForm.resetFields(); setTenantSearch(''); }}
            style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}
          >
            重置
          </button>
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
          <Button icon={<ReloadOutlined />} onClick={() => fetchTenants(true)} loading={loading} />
        </div>
      </div>

      {/* 表格与详情 */}
      <Row gutter={[16,16]}>
        <Col span={24}>
          <Table
            className="std-table"
            bordered={false}
            columns={tenantColumns}
            dataSource={filteredTenants}
            rowKey="id"
            rowSelection={{ selectedRowKeys: selectedTenantRowKeys, onChange: (keys)=> setSelectedTenantRowKeys(keys as string[]) }}
            pagination={{
              size: 'small',
              showTotal: (total) => `共 ${total} 条`,
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
