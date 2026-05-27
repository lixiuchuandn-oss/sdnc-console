/**
 * 组织管理页主视图（状态见 `hooks/useOrgManagePage.tsx`）。
 */
import React from 'react';
import {
  Alert,
  Button,
  Card,
  Col,
  Radio,
  Descriptions,
  Dropdown,
  Form,
  Input,
  Modal,
  Row,
  Select,
  Space,
  Table,
  Tag,
  Tabs,
  Tooltip,
  Transfer,
  Tree,
  Typography,
} from 'antd';
import {
  ClusterOutlined,
  EllipsisOutlined,
  GatewayOutlined,
  NodeIndexOutlined,
  ReloadOutlined,
  SafetyCertificateOutlined,
  SearchOutlined,
} from '@ant-design/icons';

import PageDetailContainer from '../../../components/PageDetailContainer';
import StdSideDrawer from '../../../components/StdSideDrawer';
import TableColumnSettingsButton from '../../../components/TableColumnSettingsButton';
import { apiDelete, apiRequest } from '../../../services/api';
import { useOrgManagePage } from '../hooks/useOrgManagePage';
import { formatRoleDisplayName } from '../lib/orgManageConstants';
import {
  assignmentMatchesAssignTab,
  assignmentMatchesKeyword,
  getCloudPoolDisplayProvider,
  getCloudPoolProviderRaw,
  isHarvesterLikeOperator,
} from '../lib/orgManagePoolHelpers';
import { filterOrganizationsByKeyword, findOrganizationById } from '../lib/orgManageTreeFilter';
export default function OrgManageWorkspace() {
  const {
    navigate,
    tenantId,
    modal,
    contextHolder,
    messageApi,
    messageContextHolder,
    tenant,
    organizations,
    selectedOrg,
    setSelectedOrg,
    expandedKeys,
    setExpandedKeys,
    selectedKeys,
    setSelectedKeys,
    orgKeyword,
    setOrgKeyword,
    users,
    userKeyword,
    setUserKeyword,
    userStatusFilter,
    setUserStatusFilter,
    assignments,
    assignmentKeyword,
    setAssignmentKeyword,
    resourcePools,
    securityLoading,
    protectionObjects,
    securityChains,
    sdnVrLoading,
    sdnVrs,
    userForm,
    editUserForm,
    resourcePoolForm,
    userDrawerOpen,
    setUserDrawerOpen,
    editUserModalOpen,
    setEditUserModalOpen,
    setEditTargetUserId,
    resourcePoolDrawerOpen,
    setResourcePoolDrawerOpen,
    assignType,
    setAssignType,
    storageKeyword,
    setStorageKeyword,
    securityKeyword,
    setSecurityKeyword,
    nsLoading,
    setNsLoading,
    setNsOptions,
    occupiedNamespaceNames,
    setOccupiedNamespaceNames,
    filteredAssignNsNames,
    sdnActiveKey,
    setSdnActiveKey,
    sdnContentOpacity,
    tenantRoles,
    roleAssignOpen,
    setRoleAssignOpen,
    setRoleAssignUser,
    roleAssignSelected,
    setRoleAssignSelected,
    setRoleAssignExisting,
    roleAssignKw,
    setRoleAssignKw,
    selectedUserRowKeys,
    setSelectedUserRowKeys,
    assignableResourcePools,
    fetchUsers,
    fetchAssignments,
    fetchResourcePools,
    fetchSdnVrs,
    handleUserSubmit,
    handleEditUserSave,
    handleResourcePoolAssign,
    saveRoleAssign,
    buildTreeData,
    userColumns,
    userDisplayColumns,
    assignmentColumns,
    assignmentDisplayColumns,
  } = useOrgManagePage();

  return (
    <PageDetailContainer
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
          <Descriptions.Item label="安全资源池">
            {assignments.filter((a) => assignmentMatchesAssignTab(a, 'security')).length}
          </Descriptions.Item>
          <Descriptions.Item label="防护对象数量">{protectionObjects.length}</Descriptions.Item>
          <Descriptions.Item label="服务链数量">{securityChains.length}</Descriptions.Item>
        </Descriptions>
      }
      defaultOverviewCollapsed={false}
      onBack={() => navigate('/admin/tenants')}
      asCard={false}
    >
      {contextHolder}
      {messageContextHolder}
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
                  suffix={<SearchOutlined />}
                />
              </div>
              <div style={{ maxHeight: '70vh', overflow: 'auto', padding: 12 }}>
                <Tree
                  showLine={{ showLeafIcon: false }}
                  defaultExpandAll
                  expandedKeys={expandedKeys}
                  onExpand={(keys)=> setExpandedKeys(keys as string[])}
                  selectedKeys={selectedKeys}
                  treeData={buildTreeData(filterOrganizationsByKeyword(organizations, orgKeyword))}
                  onSelect={(keys) => {
                    if (keys.length > 0) {
                      const org = findOrganizationById(organizations, keys[0] as string);
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
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
                      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
                        <Input
                          allowClear
                          placeholder="搜索用户关键字"
                          value={userKeyword}
                          className="toolbar-search"
                          onChange={(e) => setUserKeyword(e.target.value)}
                          suffix={<SearchOutlined />}
                        />
                        <Select
                          allowClear
                          placeholder="选择状态"
                          className="toolbar-filter-sm"
                          value={userStatusFilter}
                          options={[
                            { label: '活跃', value: 'active' },
                            { label: '非活跃', value: 'inactive' },
                          ]}
                          onChange={(v) => setUserStatusFilter(v)}
                        />
                      </div>

                      <div className="toolbar-actions" style={{ display: 'flex', gap: 8 }}>
                        <Button 
                          type="primary" 
                          onClick={() => {
                            userForm.resetFields();
                            const rand = `user-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,6)}`;
                            userForm.setFieldsValue({ organizationId: selectedOrg?.id, username: rand });
                            setUserDrawerOpen(true);
                          }}
                        >添加用户</Button>
                        <TableColumnSettingsButton allColumns={userColumns} settingsKey="org_manage_users" />
                        <Dropdown
                          menu={{
                            items: [
                              { key: 'batchDelete', label: '批量删除', danger: true, disabled: selectedUserRowKeys.length === 0 },
                            ],
                            onClick: ({ key }) => {
                              if (key === 'batchDelete') {
                                modal.confirm({
                                  title: '确认批量删除用户',
                                  content: '删除后将无法恢复，这些用户将无法继续访问系统。',
                                  okText: '删除',
                                  cancelText: '取消',
                                  onOk: async () => { 
                                    if (!tenantId || !selectedOrg) return;
                                    try {
                                      await Promise.all(selectedUserRowKeys.map(id => 
                                        apiDelete(`/api/tenants/${tenantId}/organizations/${selectedOrg.id}/users/${id}`)
                                      ));
                                      messageApi.success('批量删除成功');
                                      setSelectedUserRowKeys([]);
                                      fetchUsers(tenantId, selectedOrg.id, true); // 强制刷新，跳过缓存
                                    } catch (e: any) {
                                      messageApi.error(e?.message || '批量删除失败');
                                    }
                                  },
                                });
                              }
                            }
                          }}
                        >
                          <Button icon={<EllipsisOutlined />} />
                        </Dropdown>
                        <Tooltip title="刷新列表">
                          <Button 
                            icon={<ReloadOutlined />} 
                            onClick={() => {
                              if (tenantId && selectedOrg) {
                                fetchUsers(tenantId, selectedOrg.id, true);
                              }
                            }} 
                          />
                        </Tooltip>
                      </div>
                    </div>
                    <Table
                      columns={userDisplayColumns}
                      rowSelection={{ selectedRowKeys: selectedUserRowKeys, onChange: (keys)=> setSelectedUserRowKeys(keys as string[]) }}
                      dataSource={users.filter((u) => {
                        if (userStatusFilter && u.status !== userStatusFilter) return false;
                        if (!userKeyword.trim()) return true;
                        const kw = userKeyword.trim().toLowerCase();
                        return (
                          (u.username || '').toLowerCase().includes(kw) ||
                          (u.fullName || '').toLowerCase().includes(kw) ||
                          (u.email || '').toLowerCase().includes(kw)
                        );
                      })}
                      className="std-table"
                      rowKey="id"
                      pagination={{
                        size: 'small',
                        showTotal: (total) => `共 ${total} 条`,
                      }}
                      size="small"
                      bordered={false}
                    />
                  </div>
                ) : (
                  <div style={{ textAlign: 'center', padding: 40, color: '#999' }}>请先在左侧选择一个组织</div>
                )}
              </Tabs.TabPane>
              <Tabs.TabPane tab="计算资源分配" key="assign">
                {selectedOrg ? (
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
                        <Input
                          allowClear
                          placeholder="搜索资源池名称"
                          style={{ width: 240 }}
                          suffix={<SearchOutlined />}
                          value={assignmentKeyword}
                          onChange={(e)=> setAssignmentKeyword(e.target.value)}
                        />
                        <div style={{ display: 'flex', gap: 8 }}>

                          <Button 
                            type="primary" 
                            onClick={() => {
                              fetchResourcePools();
                              resourcePoolForm.resetFields();
                              setAssignType('compute');
                              setResourcePoolDrawerOpen(true);
                            }}
                          >分配计算资源池</Button>
                          <TableColumnSettingsButton allColumns={assignmentColumns} settingsKey="org_manage_assignments" />
                          <Tooltip title="刷新列表">
                            <Button 
                              icon={<ReloadOutlined />} 
                              onClick={() => {
                                if (selectedOrg) {
                                  fetchAssignments(selectedOrg.id);
                                }
                              }} 
                            />
                          </Tooltip>
                        </div>
                    </div>
                    <Table
                      columns={assignmentDisplayColumns}
                      dataSource={
                        assignmentKeyword.trim()
                          ? assignments.filter((a) => assignmentMatchesKeyword(a, assignmentKeyword))
                          : assignments.filter((a) => assignmentMatchesAssignTab(a, 'compute'))
                      }
                      className="std-table"
                      rowKey="id"
                      pagination={{
                        size: 'small',
                        showTotal: (total) => `共 ${total} 条`,
                      }}
                      size="small"
                      bordered={false}
                    />
                  </div>
                ) : (
                  <div style={{ textAlign: 'center', padding: 40, color: '#999' }}>请先在左侧选择一个组织</div>
                )}
              </Tabs.TabPane>
              <Tabs.TabPane tab="存储资源分配" key="storage">
                {selectedOrg ? (
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
                        <Input
                          allowClear
                          placeholder="搜索资源池关键字"
                          style={{ width: 240 }}
                          value={storageKeyword}
                          onChange={(e)=> setStorageKeyword(e.target.value)}
                        />
                        <div style={{ display: 'flex', gap: 8 }}>
                          <Tooltip title="刷新列表">
                            <Button 
                              icon={<ReloadOutlined />} 
                              onClick={() => {
                                if (selectedOrg) {
                                  fetchAssignments(selectedOrg.id);
                                }
                              }} 
                            />
                          </Tooltip>
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
                    </div>
                    <Table
                      columns={assignmentColumns}
                      dataSource={
                        storageKeyword.trim()
                          ? assignments.filter(
                              (a) =>
                                assignmentMatchesAssignTab(a, 'storage') && assignmentMatchesKeyword(a, storageKeyword),
                            )
                          : assignments.filter((a) => assignmentMatchesAssignTab(a, 'storage'))
                      }
                      className="std-table"
                      rowKey="id"
                      pagination={{
                        size: 'small',
                        showTotal: (total) => `共 ${total} 条`,
                      }}
                      size="small"
                      bordered={false}
                    />
                  </div>
                ) : (
                  <div style={{ textAlign: 'center', padding: 40, color: '#999' }}>请先在左侧选择一个组织</div>
                )}
              </Tabs.TabPane>
              <Tabs.TabPane tab="安全资源分配" key="cloud-security">
                {selectedOrg ? (
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
                        <Input
                          allowClear
                          placeholder="搜索资源池关键字"
                          style={{ width: 240 }}
                          value={securityKeyword}
                          onChange={(e)=> setSecurityKeyword(e.target.value)}
                        />
                        <div style={{ display: 'flex', gap: 8 }}>
                          <Tooltip title="刷新列表">
                            <Button 
                              icon={<ReloadOutlined />} 
                              onClick={() => {
                                if (selectedOrg) {
                                  fetchAssignments(selectedOrg.id);
                                }
                              }} 
                            />
                          </Tooltip>
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
                    </div>
                    <Table
                      columns={assignmentColumns}
                      dataSource={
                        securityKeyword.trim()
                          ? assignments.filter(
                              (a) =>
                                assignmentMatchesAssignTab(a, 'security') && assignmentMatchesKeyword(a, securityKeyword),
                            )
                          : assignments.filter((a) => assignmentMatchesAssignTab(a, 'security'))
                      }
                      className="std-table"
                      rowKey="id"
                      pagination={{
                        size: 'small',
                        showTotal: (total) => `共 ${total} 条`,
                      }}
                      size="small"
                      bordered={false}
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
                          className="std-table"
                          size="small"
                          bordered={false}
                          loading={sdnVrLoading}
                          rowKey={(r: any) => r.vr_unique_id || r.uuid || r.id}
                          dataSource={sdnVrs}
                          pagination={{
                            size: 'small',
                            showTotal: (total) => `共 ${total} 条`,
                          }}
                          columns={[
                            { title: '名称', dataIndex: 'name', key: 'name' },
                            { title: 'VR唯一ID', dataIndex: 'vr_unique_id', key: 'vr_unique_id', ellipsis: true },
                            { title: '租户ID', dataIndex: 'tenant_id', key: 'tenant_id', ellipsis: true },
                            { title: '组织ID', dataIndex: 'org_id', key: 'org_id', ellipsis: true },
                            { title: '绑定状态', dataIndex: 'bind_status', key: 'bind_status', render: (v: string, r: any) => {
                              if (r.is_deleted) return <span className="std-badge std-badge-error">CSM已删除</span>;
                              if (!v) return <span className="std-badge std-badge-default">未知</span>;
                              if (v === 'BOUND') return <span className="std-badge std-badge-success">已绑定</span>;
                              if (v === 'UNBOUND') return <span className="std-badge std-badge-default">未绑定</span>;
                              return <span className="std-badge std-badge-warning">{v}</span>;
                            } },
                            {
                              title: '操作',
                              key: 'action',
                              width: 100,
                              render: (_: any, r: any) => (
                                <Button type="link" danger size="small" onClick={() => {
                                  modal.confirm({
                                    title: '确认删除',
                                    content: '确定要删除该VR绑定记录吗？',
                                    onOk: async () => {
                                      try {
                                        await apiDelete(`/api/vr-config/${r.uuid}`);
                                        messageApi.success('删除成功');
                                        fetchSdnVrs();
                                      } catch (e) {
                                        messageApi.error('删除失败');
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
                          className="std-table"
                          size="small"
                          bordered={false}
                          loading={securityLoading}
                          rowKey={(r: any) => r.id || r._id}
                          dataSource={protectionObjects}
                          pagination={{
                            size: 'small',
                            showTotal: (total) => `共 ${total} 条`,
                          }}
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
                          className="std-table"
                          size="small"
                          bordered={false}
                          loading={securityLoading}
                          rowKey={(r: any) => r.id || r._id}
                          dataSource={securityChains}
                          pagination={{
                            size: 'small',
                            showTotal: (total) => `共 ${total} 条`,
                          }}
                          columns={[
                            { title: '名称', dataIndex: 'name', key: 'name' },
                            { title: '服务链ID', dataIndex: 'id', key: 'id' },
                            { title: '状态', dataIndex: 'status', key: 'status', render: (status: string) => (
                              <span className={status === 'active' ? 'std-badge std-badge-success' : 'std-badge std-badge-default'}>{status}</span>
                            ) }
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
          <Form.Item label="邮箱" name="email" rules={[{ required: true }, { type: 'email', message: '请输入有效的邮箱地址' }]}>
            <Input placeholder="请输入邮箱" />
          </Form.Item>
          <Form.Item label="密码" name="password" rules={[{ required: true }]}>
            <Input.Password placeholder="请输入密码" />
          </Form.Item>
          <Form.Item label="角色" name="role" rules={[{ required: true }]}>
            <Select 
              placeholder="请选择角色" 
              showSearch
              filterOption={(input, option) => {
                const label = option?.children?.toString() || '';
                return label.toLowerCase().includes(input.toLowerCase());
              }}
              notFoundContent={tenantRoles.length === 0 ? '暂无可用角色' : '未找到匹配的角色'}
            >
              {tenantRoles.map(r => {
                const displayName = formatRoleDisplayName(r.name);
                return (
                  <Select.Option key={r.id} value={r.id} title={r.description || displayName}>
                    {displayName}
                    {r.description && <span style={{ color: '#999', marginLeft: 8, fontSize: 12 }}>({r.description})</span>}
                  </Select.Option>
                );
              })}
            </Select>
          </Form.Item>
        </Form>
      </StdSideDrawer>

      <Modal
        title="编辑用户"
        open={editUserModalOpen}
        width={520}
        okText="保存"
        cancelText="取消"
        destroyOnClose
        onCancel={() => {
          setEditUserModalOpen(false);
          setEditTargetUserId(null);
          editUserForm.resetFields();
        }}
        onOk={handleEditUserSave}
      >
        <Form form={editUserForm} layout="vertical" style={{ marginTop: 8 }}>
          <Form.Item name="username" label="用户名">
            <Input disabled />
          </Form.Item>
          <Form.Item name="fullName" label="姓名" rules={[{ required: true, message: '请输入姓名' }]}>
            <Input placeholder="请输入姓名" />
          </Form.Item>
          <Form.Item
            name="email"
            label="邮箱"
            rules={[{ required: true, message: '请输入邮箱' }, { type: 'email', message: '请输入有效的邮箱地址' }]}
          >
            <Input placeholder="请输入邮箱" />
          </Form.Item>
          <Form.Item name="password" label="新密码" extra="留空则不修改密码">
            <Input.Password placeholder="留空则不修改" autoComplete="new-password" />
          </Form.Item>
          <Form.Item name="status" label="状态" rules={[{ required: true, message: '请选择状态' }]}>
            <Select
              options={[
                { value: 'active', label: '活跃' },
                { value: 'inactive', label: '非活跃' },
              ]}
            />
          </Form.Item>
        </Form>
      </Modal>

      <StdSideDrawer
        title={assignType === 'security' ? '分配安全资源池' : '分配计算资源池'}
        open={resourcePoolDrawerOpen}
        width={600}
        onClose={() => {
          setResourcePoolDrawerOpen(false);
          resourcePoolForm.resetFields();
          setNsOptions([]);
          setOccupiedNamespaceNames([]);
        }}
        onOk={() => resourcePoolForm.submit()}
        okText="分配"
      >
        <Form
          form={resourcePoolForm}
          layout="vertical"
          initialValues={{ tenantNamespaceMode: 'auto' }}
          onFinish={handleResourcePoolAssign}
        >
          <Form.Item label="选择资源池" name="resourcePoolIds" rules={[{ required: true }]}>
            {/*
              optionLabelProp="label"：搜索/语义用资源池名称。
              labelRender：收起后由我们绘制「名称 + 右侧类型」，与下拉里布局一致（不会与 Option 的 children 叠两层）。
            */}
            <Select
              placeholder="请选择资源池"
              style={{ width: '100%' }}
              optionLabelProp="label"
              notFoundContent={
                assignableResourcePools.length === 0
                  ? '没有可选项：本 Tab 下资源池可能已全部绑定当前组织，或列表尚未加载'
                  : undefined
              }
              labelRender={(li) => {
                const pool = assignableResourcePools.find((p: any) => p.id === li.value);
                const provider = getCloudPoolDisplayProvider(pool);
                return (
                  <span
                    style={{
                      display: 'flex',
                      width: '100%',
                      minWidth: 0,
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 8,
                    }}
                  >
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{li.label}</span>
                    {provider ? (
                      <Typography.Text type="secondary" style={{ fontSize: 12, flexShrink: 0 }}>
                        {provider}
                      </Typography.Text>
                    ) : null}
                  </span>
                );
              }}
              onChange={async (val: any) => {
                try {
                  setNsOptions([]);
                  setOccupiedNamespaceNames([]);
                  resourcePoolForm.setFieldsValue({
                    tenantNamespaceMode: 'auto',
                    existingTenantNamespace: undefined,
                  });
                  const poolId = Array.isArray(val) ? val[0] : val;
                  const pool = (resourcePools || []).find((p: any) => p.id === poolId);
                  const pvRaw = getCloudPoolProviderRaw(pool);
                  if (isHarvesterLikeOperator(pvRaw)) {
                    setNsLoading(true);
                    const orgId = selectedOrg?.id;
                    const [nsResp, occResp] = await Promise.all([
                      apiRequest(`/api/clouds/${poolId}/resources/harvester/namespaces`),
                      orgId
                        ? apiRequest(
                            `/api/tenants/organizations/${encodeURIComponent(orgId)}/resource-pools/occupied-namespaces?cloudId=${encodeURIComponent(poolId)}`,
                            { skipCache: true },
                          ).catch(() => null)
                        : Promise.resolve(null),
                    ]);
                    const items: any[] =
                      nsResp?.data?.data?.items ||
                      nsResp?.data?.items ||
                      (Array.isArray(nsResp) ? nsResp : []);
                    setNsOptions(Array.isArray(items) ? items : []);
                    const occNames = (occResp as { names?: unknown } | null)?.names;
                    setOccupiedNamespaceNames(Array.isArray(occNames) ? (occNames as string[]) : []);
                  }
                } catch {
                  setNsOptions([]);
                  setOccupiedNamespaceNames([]);
                } finally {
                  setNsLoading(false);
                }
              }}
            >
              {assignableResourcePools.map((pool: any) => {
                const provider = getCloudPoolDisplayProvider(pool);
                return (
                  <Select.Option key={pool.id} value={pool.id} label={pool.name}>
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        gap: 8,
                        width: '100%',
                      }}
                    >
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{pool.name}</span>
                      <Typography.Text type="secondary" style={{ fontSize: 12, flexShrink: 0 }}>
                        {provider}
                      </Typography.Text>
                    </div>
                  </Select.Option>
                );
              })}
            </Select>
          </Form.Item>
          <Form.Item noStyle shouldUpdate>
            {() => {
              const poolId = resourcePoolForm.getFieldValue('resourcePoolIds');
              const pool = (resourcePools || []).find((p: any) => p.id === (Array.isArray(poolId) ? poolId[0] : poolId));
              const needNs = isHarvesterLikeOperator(getCloudPoolProviderRaw(pool));
              
              if (!needNs) return null;

              const nsSectionWrap: React.CSSProperties = {
                marginTop: 4,
                padding: '14px 16px',
                background: 'var(--ant-color-fill-quaternary, #fafafa)',
                border: '1px solid var(--ant-color-border-secondary, #f0f0f0)',
                borderRadius: 8,
              };

              return (
                <div style={nsSectionWrap}>
                  <Typography.Text strong style={{ display: 'block'}}>
                    组织工作命名空间
                  </Typography.Text>
                  <Typography.Paragraph type="secondary" style={{ marginBottom: 12, fontSize: 12}}>
                    决定该组织在计算池中的主命名空间。
                  </Typography.Paragraph>

                  <Form.Item
                    name="tenantNamespaceMode"
                    label={null}
                    colon={false}
                    style={{ marginBottom: 12 }}
                    rules={[{ required: true, message: '请选择派生方式' }]}
                  >
                    <Radio.Group style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                      <Radio value="auto">
                        <div style={{ lineHeight: 1.5 }}>
                          <div style={{ fontWeight: 500 }}>自动生成</div>
                          <Typography.Text type="secondary" style={{ display: 'block', fontSize: 12, marginTop: 2 }}>
                            按组织 ID 生成固定名称，推荐新租户
                          </Typography.Text>
                        </div>
                      </Radio>
                      <Radio value="existing">
                        <div style={{ lineHeight: 1.5 }}>
                          <div style={{ fontWeight: 500 }}>使用集群已有命名空间</div>
                          <Typography.Text type="secondary" style={{ display: 'block', fontSize: 12, marginTop: 2 }}>
                            用于历史数据、迁移或故障恢复（名称须与集群中已有命名空间一致）
                          </Typography.Text>
                        </div>
                      </Radio>
                    </Radio.Group>
                  </Form.Item>

                  <Form.Item noStyle shouldUpdate>
                    {() =>
                      (resourcePoolForm.getFieldValue('tenantNamespaceMode') || 'auto') === 'auto' ? (
                        <Alert
                          type="info"
                          showIcon
                          style={{ marginBottom: 0 }}
                          message={
                            <Space direction="vertical" size={6} style={{ width: '100%' }}>
                              <span>创建新命名空间，用于业务资源（虚拟机、云盘等）。</span>
                              <div>
                                <Typography.Text type="secondary" style={{ fontSize: 12, marginRight: 8 }}>
                                  命名空间
                                </Typography.Text>
                                <Tag style={{ fontFamily: 'monospace', marginInlineEnd: 0 }}>
                                  ns-{selectedOrg?.id}
                                </Tag>
                              </div>
                            </Space>
                          }
                        />
                      ) : (
                        <Form.Item
                          name="existingTenantNamespace"
                          label="目标命名空间"
                          style={{ marginBottom: 0 }}
                          rules={[
                            ({ getFieldValue }) => ({
                              validator(_rule, v) {
                                if (getFieldValue('tenantNamespaceMode') !== 'existing') {
                                  return Promise.resolve();
                                }
                                const arr = Array.isArray(v)
                                  ? v
                                  : v != null && String(v).trim()
                                    ? [String(v).trim()]
                                    : [];
                                if (arr.length !== 1 || !String(arr[0]).trim()) {
                                  return Promise.reject(new Error('请选择或输入恰好一个命名空间'));
                                }
                                const name = String(arr[0]).trim();
                                const occLc = new Set(
                                  (occupiedNamespaceNames || [])
                                    .map((n) => String(n || '').trim().toLowerCase())
                                    .filter(Boolean),
                                );
                                if (occLc.has(name.toLowerCase())) {
                                  return Promise.reject(new Error('该命名空间已被其它组织占用，请选择其它名称'));
                                }
                                const allowedLc = new Set(
                                  filteredAssignNsNames.map((x: string) =>
                                    String(x || '').trim().toLowerCase(),
                                  ).filter(Boolean),
                                );
                                if (!allowedLc.has(name.toLowerCase())) {
                                  return Promise.reject(
                                    new Error(
                                      '请从下拉列表选择租户项目（须带 tower.io/scenario=tenant）；不支持任意手填名称',
                                    ),
                                  );
                                }
                                return Promise.resolve();
                              },
                            }),
                          ]}
                          extra={
                            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                              请先选择资源池以加载列表。下拉里仅限带{' '}
                              <Typography.Text code style={{ fontSize: 11 }}>
                                tower.io/scenario=tenant
                              </Typography.Text>
                              的命名空间，已排除系统及已被其它组织占用的条目；请从下拉选择，勿随意手填。
                            </Typography.Text>
                          }
                        >
                          <Select
                            mode="tags"
                            maxCount={1}
                            placeholder="从列表选择或手动输入一个名称"
                            loading={nsLoading}
                            style={{ width: '100%' }}
                            tokenSeparators={[]}
                          >
                            {filteredAssignNsNames.map((name: string) => (
                              <Select.Option key={name} value={name}>
                                {name}
                              </Select.Option>
                            ))}
                          </Select>
                        </Form.Item>
                      )
                    }
                  </Form.Item>

                  <div
                    style={{
                      marginTop: 14,
                      paddingTop: 12,
                      borderTop: '1px dashed var(--ant-color-border-secondary, #f0f0f0)',
                    }}
                  >
                    <Typography.Text type="secondary" style={{ fontSize: 12, lineHeight: 1.6 }}>
                      <Typography.Text strong style={{ fontSize: 12 }}>
                        公共空间
                      </Typography.Text>
                      ：集群中带{' '}
                      <Typography.Text code style={{ fontSize: 11 }}>
                        tower.io/scenario=public
                      </Typography.Text>
                      的命名空间由租户控制台自动识别（模板、共享镜像等），无需在此配置。
                    </Typography.Text>
                  </div>
                </div>
              );
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
        <Form layout="inline" style={{ display: 'flex', gap: 16, marginBottom: 16 }}>
          <Form.Item style={{ flex: 1, marginBottom: 0 }}>
            <Input.Search
              allowClear
              placeholder="搜索角色名称或说明"
              value={roleAssignKw}
              onChange={e => setRoleAssignKw(e.target.value)}
            />
          </Form.Item>
        </Form>
        <Transfer
          dataSource={(() =>
            tenantRoles
              .filter(r => r.scope === 'tenant' && String(r.status || 'active') === 'active')
              .filter(r => (roleAssignKw ? ((r.name || '').toLowerCase().includes(roleAssignKw.toLowerCase()) || (r.description || '').toLowerCase().includes(roleAssignKw.toLowerCase())) : true))
              .map(r => ({ key: r.id, title: formatRoleDisplayName(r.name), description: r.description }))
          )()}
          targetKeys={roleAssignSelected}
          onChange={(next) => setRoleAssignSelected(next.map(String))}
          titles={["角色库","已选角色"]}
          render={(item: any) => item.title}
          rowKey={(item: any) => item.key}
          listStyle={{ width: '50%', height: 420 }}
          showSearch
          filterOption={(inputValue: string, item: any) => 
            (item.title as string).toLowerCase().includes(inputValue.toLowerCase()) ||
            (item.description as string)?.toLowerCase().includes(inputValue.toLowerCase())
          }
        />
        <div style={{ marginTop: 8, fontSize: 12, color: '#888' }}>保存将同步新增与移除的角色赋权</div>
      </StdSideDrawer>
    </PageDetailContainer>
  );
}
