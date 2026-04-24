import React, { useEffect, useState, useMemo } from 'react';
import { Button, Form, Input, Select, Table, Tag, message, Modal, Row, Col, InputNumber, Badge } from 'antd';
import { FolderOutlined, UnorderedListOutlined, SearchOutlined } from '@ant-design/icons';
import PageContainer from '../../../../components/PageContainer';
import StdSideDrawer from '../../../../components/StdSideDrawer';
import ResourceActionsDropdown from '../../../../components/ResourceActionsDropdown';
import type { ColumnsType } from 'antd/es/table';
import { 
  getACLRules, deleteACLRule, ACLRule,
  getACLGroups, createACLGroup, deleteACLGroup, addACLRuleToGroup, pushACLConfig, ACLGroup,
  bindACLGroupToVR, unbindACLGroupFromVR,
  type ACLGroupBinding,
  fetchVrCachePageList,
} from '../../../../services/virtualRouterApi';
import { apiPost } from '../../../../services/api';

const { Option } = Select;

const ACLPage: React.FC = () => {
  const [activeTab, setActiveTab] = useState('groups');

  // --- Common State ---
  const [vrList, setVrList] = useState<any[]>([]);
  const [vrNameMap, setVrNameMap] = useState<Record<string, string>>({});
  
  // --- Groups State ---
  const [groups, setGroups] = useState<ACLGroup[]>([]);
  const [groupsLoading, setGroupsLoading] = useState(false);
  const [groupDrawerOpen, setGroupDrawerOpen] = useState(false);
  const [groupForm] = Form.useForm();
  
  // --- Binding State ---
  const [bindDrawerOpen, setBindDrawerOpen] = useState(false);
  const [currentBindingGroup, setCurrentBindingGroup] = useState<ACLGroup | null>(null);
  const [bindForm] = Form.useForm();
  const [bindingSubmitting, setBindingSubmitting] = useState(false);

  // --- Group Filter State ---
  const [groupKeyword, setGroupKeyword] = useState('');
  const [groupVrFilter, setGroupVrFilter] = useState<string | undefined>();
  const [groupFilterForm] = Form.useForm();
  
  // --- Rules State ---
  const [rules, setRules] = useState<ACLRule[]>([]);
  const [rulesLoading, setRulesLoading] = useState<boolean>(false);
  const [keyword, setKeyword] = useState<string>('');
  const [vrFilter, setVrFilter] = useState<string | undefined>();
  const [actionFilter, setActionFilter] = useState<'permit' | 'deny' | undefined>();
  const [protocolFilter, setProtocolFilter] = useState<'tcp' | 'udp' | 'icmp' | 'any' | undefined>();
  const [filterForm] = Form.useForm();
  
  // Rule Creation State
  const [ruleDrawerOpen, setRuleDrawerOpen] = useState(false);
  const [createRuleForm] = Form.useForm();
  const [submitting, setSubmitting] = useState(false);
  const [targetGroup, setTargetGroup] = useState<ACLGroup | null>(null);

  // --- Fetch Logic ---

  const fetchVRs = async (force?: boolean) => {
    try {
      const json = await fetchVrCachePageList(1000, 1, { skipCache: !!force });
      const dataObj = json?.data ?? json;
      const vrs = Array.isArray(dataObj?.page) ? dataObj.page : 
                 Array.isArray(dataObj?.list) ? dataObj.list : 
                 Array.isArray(dataObj?.rows) ? dataObj.rows : 
                 Array.isArray(dataObj) ? dataObj : [];

      setVrList(vrs);
      const map: Record<string, string> = {};
      vrs.forEach((v: any) => {
        const id = v.uuid || v.id || v.vm_id;
        const name = v.name || id;
        if (id) map[id] = name;
      });
      setVrNameMap(map);
    } catch (e) {
      console.error('Failed to fetch VRs from cache', e);
      setVrList([]);
      setVrNameMap({});
    }
  };

  const fetchGroups = async (force?: boolean) => {
    setGroupsLoading(true);
    try {
      const res = await getACLGroups(undefined, { skipCache: !!force });
      const list = Array.isArray(res) ? res : (res as any)?.data || [];
      setGroups(list);
    } catch (e: any) {
      message.error('加载 ACL 组失败: ' + (e.message || 'Unknown error'));
    } finally {
      setGroupsLoading(false);
    }
  };

  const fetchRules = async (force?: boolean) => {
    setRulesLoading(true);
    try {
      const list = await getACLRules(undefined, { skipCache: !!force });
      const normalized = Array.isArray(list) ? list : (list as any)?.data || [];
      setRules(normalized);
    } catch (e: any) {
      message.error('加载 ACL 列表失败: ' + (e.message || 'Unknown error'));
    } finally {
      setRulesLoading(false);
    }
  };

  useEffect(() => {
    fetchVRs();
    fetchGroups();
    fetchRules();
  }, []);

  const forceRefresh = async () => {
    message.loading({ content: '正在同步 VR 与 ACL 数据...', key: 'acl_refresh' });
    try {
      await apiPost('/api/vr-instances/refresh', {});
      await fetchVRs(true);
      await fetchGroups(true);
      await fetchRules(true);
      message.success({ content: '同步完成', key: 'acl_refresh' });
    } catch {
      message.error({ content: '同步失败，请稍后重试', key: 'acl_refresh' });
    }
  };

  // --- Group Handlers ---

  const handleCreateGroup = async () => {
    try {
      const values = await groupForm.validateFields();
      setSubmitting(true);
      await createACLGroup(values);
      message.success('ACL 组创建成功');
      setGroupDrawerOpen(false);
      groupForm.resetFields();
      fetchGroups();
    } catch (e: any) {
      if (!e.errorFields) message.error('创建失败: ' + e.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteGroup = (group: ACLGroup) => {
    Modal.confirm({
      title: '确认删除 ACL 组',
      content: `确定要删除 ACL 组 "${group.name}" 吗？组内的规则也会被删除。同时会解除所有关联的 VR。`,
      okText: '删除',
      cancelText: '取消',
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await deleteACLGroup(group.id);
          message.success('删除成功');
          fetchGroups();
          fetchRules(); // Refresh rules as well since they are deleted
        } catch (e: any) {
          message.error('删除失败: ' + e.message);
        }
      }
    });
  };

  // --- Binding Handlers ---

  const handleOpenBind = (group: ACLGroup) => {
    setCurrentBindingGroup(group);
    bindForm.resetFields();
    setBindDrawerOpen(true);
  };

  const handleSubmitBind = async () => {
    try {
      const values = await bindForm.validateFields();
      setBindingSubmitting(true);
      if (currentBindingGroup) {
        await bindACLGroupToVR(currentBindingGroup.id, values.vrId);
        message.success('关联成功');
        setBindDrawerOpen(false);
        fetchGroups();
      }
    } catch (e: any) {
      if (!e.errorFields) message.error('关联失败: ' + e.message);
    } finally {
      setBindingSubmitting(false);
    }
  };

  const handleUnbind = (group: ACLGroup, vrId: string) => {
    Modal.confirm({
      title: '确认解除关联',
      content: '解除关联后，该 ACL 组将不再应用于此 VR。',
      okText: '解除关联',
      cancelText: '取消',
      onOk: async () => {
        try {
          await unbindACLGroupFromVR(group.id, vrId);
          message.success('解除关联成功');
          fetchGroups();
        } catch (e: any) {
          message.error('解除关联失败: ' + e.message);
        }
      }
    });
  };

  const handleDeploy = (vrId: string) => {
    if (!vrId) {
      message.error('未关联 VR，无法下发');
      return;
    }
    Modal.confirm({
      title: '确认下发配置',
      content: '将根据数据库中的 ACL 配置全量覆盖该 VR 的 ACL 设置。请确认。',
      okText: '立即下发',
      cancelText: '取消',
      onOk: async () => {
        const hide = message.loading('正在下发配置...', 0);
        try {
          const res = await pushACLConfig(vrId);
          hide();
          Modal.success({
            title: '下发成功',
            content: (
              <div style={{ maxHeight: 400, overflow: 'auto' }}>
                <pre>{JSON.stringify(res.data || res, null, 2)}</pre>
              </div>
            ),
            width: 600
          });
        } catch (e: any) {
          hide();
          Modal.error({
            title: '下发失败',
            content: e.message
          });
        }
      }
    });
  };

  // --- Rule Handlers ---

  const handleOpenCreateRule = (group?: ACLGroup) => {
    setTargetGroup(group || null);
    createRuleForm.resetFields();
    if (group && group.vrId) {
      createRuleForm.setFieldsValue({ vrId: group.vrId, groupId: group.id });
    }
    setRuleDrawerOpen(true);
  };

  const handleCreateRule = async () => {
    try {
      const values = await createRuleForm.validateFields();
      setSubmitting(true);
      
      if (targetGroup) {
        await addACLRuleToGroup(targetGroup.id, values);
      } else {
        const gid = String((values as any).groupId || '').trim();
        if (!gid) throw new Error('请选择所属 ACL 组');
        const { groupId, ...rest } = values as any;
        await addACLRuleToGroup(gid, rest);
      }
      
      message.success('规则创建成功');
      setRuleDrawerOpen(false);
      createRuleForm.resetFields();
      fetchRules();
      if (targetGroup) fetchGroups(); // Refresh groups to update rule list
    } catch (e: any) {
      if (!e.errorFields) message.error('创建失败: ' + e.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteRule = (row: ACLRule) => {
    Modal.confirm({
      title: '确认删除',
      content: `确定要删除 ACL 规则 "${row.name}" 吗？`,
      okText: '删除',
      cancelText: '取消',
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await deleteACLRule(row.id);
          message.success('删除成功');
          fetchRules();
          fetchGroups(); // Refresh groups in case rule was in a group
        } catch (error: any) {
          message.error('删除失败: ' + (error.message || 'Unknown error'));
        }
      }
    });
  };

  // --- Columns ---

  const groupColumns: ColumnsType<ACLGroup> = [
    { title: '组名称', dataIndex: 'name', key: 'name', render: (t) => <b>{t}</b> },
    { title: '所属VR', dataIndex: 'vrId', key: 'vrId', render: (v, r) => {
        // Primary VR
        const primary = v ? (
          <Tag color="blue" key="primary" style={{ marginRight: 4 }}>
            {vrNameMap[v] || v} (主)
          </Tag>
        ) : null;
        
        // Bound VRs
        const bounds = r.bindings?.map((b: ACLGroupBinding) => (
          <Tag color="cyan" key={b.id} closable onClose={() => handleUnbind(r, b.vrId)} style={{ marginRight: 4 }}>
            {vrNameMap[b.vrId] || b.vrId}
          </Tag>
        ));
        
        return (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {primary}
            {bounds}
            {!primary && !bounds?.length && <span style={{color:'#ccc'}}>未绑定</span>}
          </div>
        );
    }},
    { title: 'ACL ID', dataIndex: 'aclId', key: 'aclId' },
    { title: '描述', dataIndex: 'description', key: 'description' },
    { title: '规则数', key: 'rules', render: (_, r) => <Badge count={r.rules?.length || 0} showZero color="blue" /> },
    { title: '操作', key: 'ops', fixed: 'right', render: (_, r) => (
      <ResourceActionsDropdown
        items={[
          { key: 'addRule', label: '添加规则' },
          { key: 'deploy', label: '下发配置', disabled: !r.vrId },
          { key: 'bind', label: '关联其他 VR' },
          { type: 'divider' },
          { key: 'delete', label: '删除组', danger: true },
        ]}
        onClick={({ key }) => {
          if (key === 'addRule') handleOpenCreateRule(r);
          if (key === 'deploy' && r.vrId) handleDeploy(r.vrId);
          if (key === 'bind') handleOpenBind(r);
          if (key === 'delete') handleDeleteGroup(r);
        }}
        buttonProps={{ className: 'row-actions-trigger', style: { margin: 0 } }}
      />
    )}
  ];

  const ruleColumns: ColumnsType<ACLRule> = [
    { title: '优先级', dataIndex: 'priority', key: 'priority', sorter: (a, b) => a.priority - b.priority },
    { title: '名称', dataIndex: 'name', key: 'name' },
    { title: '所属VR', dataIndex: 'vrId', key: 'vrId', render: (v) => vrNameMap[v] || v },
    { title: '所属组', dataIndex: 'group', key: 'group', render: (g) => g ? <Tag color="blue">{g.name}</Tag> : '-' },
    { title: '动作', dataIndex: 'action', key: 'action', render: (act) => (
      <Tag color={act === 'permit' ? 'green' : 'red'}>{act.toUpperCase()}</Tag>
    )},
    { title: '协议', dataIndex: 'protocol', key: 'protocol', render: (p) => <Tag>{p.toUpperCase()}</Tag> },
    { title: '源IP', dataIndex: 'sourceIp', key: 'sourceIp' },
    { title: '目的IP', dataIndex: 'destinationIp', key: 'destinationIp' },
    { title: '源端口', dataIndex: 'sourcePort', key: 'sourcePort' },
    { title: '目的端口', dataIndex: 'destinationPort', key: 'destinationPort' },
    { title: '操作', key: 'ops', render: (_, row) => (
      <ResourceActionsDropdown
        items={[{ key: 'delete', label: '删除', danger: true }]}
        onClick={({ key }) => {
          if (key === 'delete') handleDeleteRule(row);
        }}
        buttonProps={{ className: 'row-actions-trigger', style: { margin: 0 } }}
      />
    )}
  ];

  // Filtering for Rules Tab
  const filteredRules = rules.filter((r) => {
    if (keyword && !String(r.name || '').toLowerCase().includes(keyword.toLowerCase())) return false;
    if (vrFilter && r.vrId !== vrFilter) return false;
    if (actionFilter && r.action !== actionFilter) return false;
    if (protocolFilter && r.protocol !== protocolFilter) return false;
    return true;
  });

  const resetFilters = () => {
    filterForm.resetFields();
    setKeyword('');
    setVrFilter(undefined);
    setActionFilter(undefined);
    setProtocolFilter(undefined);
  };
  
  const resetGroupFilters = () => {
    groupFilterForm.resetFields();
    setGroupKeyword('');
    setGroupVrFilter(undefined);
  };
  
  // Filtering for Groups Tab
  const filteredGroups = useMemo(() => {
    return groups.filter(g => {
      if (groupKeyword && !g.name.toLowerCase().includes(groupKeyword.toLowerCase())) return false;
      if (groupVrFilter && g.vrId !== groupVrFilter) return false;
      return true;
    });
  }, [groups, groupKeyword, groupVrFilter]);

  return (
    <PageContainer
      titleLevel={3}
      asCard={false}
      onRefresh={forceRefresh}
      primaryAction={activeTab === 'groups' ? {
        text: '新建 ACL 组',
        onClick: () => setGroupDrawerOpen(true),
        type: 'primary',
      } : {
        text: '新建 ACL 规则',
        onClick: () => handleOpenCreateRule(),
        type: 'primary',
      }}
      tabList={[
        { key: 'groups', tab: 'ACL 组管理' },
        { key: 'rules', tab: '所有规则列表' }
      ]}
      tabActiveKey={activeTab}
      onTabChange={setActiveTab}
      toolbarLeft={(activeTab === 'groups' && (
        <Form
          className="toolbar-container"
          form={groupFilterForm}
          layout="inline"
          style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}
          onValuesChange={(_, all) => {
            setGroupKeyword(all.keyword || '');
            setGroupVrFilter(all.vrId || undefined);
          }}
        >
          <Form.Item name="keyword" style={{ marginBottom: 0 }}>
            <Input
              allowClear
              placeholder="组名称"
              className="toolbar-search"
              suffix={<SearchOutlined style={{ color: 'rgba(0,0,0,.45)' }} />}
            />
          </Form.Item>
          <Form.Item name="vrId" style={{ marginBottom: 0 }}>
            <Select allowClear placeholder="所属 VR" className="toolbar-filter-sm">
              {vrList.map((v) => {
                const id = v.uuid || v.id || v.vm_id;
                const name = v.name || id;
                return id ? (
                  <Option key={id} value={id}>
                    {name}
                  </Option>
                ) : null;
              })}
            </Select>
          </Form.Item>
          <button type="button" className="toolbar-reset-btn" onClick={resetGroupFilters}>
            重置
          </button>
        </Form>
      )) || (activeTab === 'rules' && (
        <Form
          className="toolbar-container"
          form={filterForm}
          layout="inline"
          style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}
          onValuesChange={(_, all) => {
            setKeyword(all.keyword || '');
            setVrFilter(all.vrId || undefined);
            setActionFilter(all.action || undefined);
            setProtocolFilter(all.protocol || undefined);
          }}
        >
          <Form.Item name="keyword" style={{ marginBottom: 0 }}>
            <Input
              allowClear
              placeholder="规则名称"
              className="toolbar-search"
              suffix={<SearchOutlined style={{ color: 'rgba(0,0,0,.45)' }} />}
            />
          </Form.Item>
          <Form.Item name="vrId" style={{ marginBottom: 0 }}>
            <Select allowClear placeholder="所属 VR" className="toolbar-filter-sm">
              {vrList.map((v) => {
                const id = v.uuid || v.id || v.vm_id;
                const name = v.name || id;
                return id ? (
                  <Option key={id} value={id}>
                    {name}
                  </Option>
                ) : null;
              })}
            </Select>
          </Form.Item>
          <Form.Item name="action" style={{ marginBottom: 0 }}>
            <Select allowClear placeholder="动作" className="toolbar-filter-sm">
              <Option value="permit">Permit</Option>
              <Option value="deny">Deny</Option>
            </Select>
          </Form.Item>
          <Form.Item name="protocol" style={{ marginBottom: 0 }}>
            <Select allowClear placeholder="协议" className="toolbar-filter-sm">
              <Option value="any">Any</Option>
              <Option value="tcp">TCP</Option>
              <Option value="udp">UDP</Option>
              <Option value="icmp">ICMP</Option>
            </Select>
          </Form.Item>
          <button type="button" className="toolbar-reset-btn" onClick={resetFilters}>
            重置
          </button>
        </Form>
      ))}
    >
      {activeTab === 'groups' && (
        <Table
          dataSource={filteredGroups}
          columns={groupColumns}
          rowKey="id"
          loading={groupsLoading}
          bordered={false}
          className="std-table"
          pagination={{
            size: 'small',
            showTotal: (total) => `共 ${total} 条`,
          }}
          expandable={{
            expandedRowRender: (record) => (
              <div style={{ margin: 0 }}>
                <p style={{ marginBottom: 8 }}><b>{record.name} 的规则列表:</b></p>
                <Table
                  bordered={false}
                  className="std-table"
                  columns={ruleColumns.filter(c => c.key !== 'group' && c.key !== 'vrId')} // Hide redundant columns
                  dataSource={record.rules || []}
                  rowKey="id"
                  pagination={false}
                />
              </div>
            ),
            rowExpandable: (record) => (record.rules?.length || 0) > 0,
          }}
        />
      )}
      
      {activeTab === 'rules' && (
        <Table
          dataSource={filteredRules}
          columns={ruleColumns}
          rowKey="id"
          loading={rulesLoading}
          bordered={false}
          className="std-table"
          pagination={{
            size: 'small',
            showTotal: (total) => `共 ${total} 条`,
          }}
          scroll={{ x: 'max-content' }}
        />
      )}

      {/* Group Drawer */}
      <StdSideDrawer
        title="新建 ACL 组"
        width={500}
        open={groupDrawerOpen}
        onClose={() => setGroupDrawerOpen(false)}
        onOk={handleCreateGroup}
        okText={submitting ? "提交中..." : "提交"}
        maskClosable={false}
        confirmLoading={submitting}
      >
        <Form form={groupForm} layout="vertical">
          <Form.Item name="name" label="组名称" rules={[{ required: true }]}>
            <Input placeholder="输入 ACL 组名称" />
          </Form.Item>
          <Form.Item name="vrId" label="所属 VR" rules={[{ required: true }]}>
            <Select placeholder="选择 VR 实例">
              {vrList.map(v => {
                const id = v.uuid || v.id || v.vm_id;
                const name = v.name || id;
                return id ? (<Option key={id} value={id}>{name}</Option>) : null;
              })}
            </Select>
          </Form.Item>
          <Form.Item name="aclId" label="ACL ID" rules={[{ required: true, type: 'number', min: 1001, max: 4000, message: '请输入 1001-4000 之间的数字' }]}>
            <InputNumber placeholder="1001-4000" style={{ width: '100%' }} min={1001} max={4000} />
          </Form.Item>
          <Form.Item name="description" label="描述">
            <Input.TextArea rows={3} />
          </Form.Item>
        </Form>
      </StdSideDrawer>

      {/* Rule Drawer */}
      <StdSideDrawer
        title={targetGroup ? `新建规则 (所属组: ${targetGroup.name})` : "新建 ACL 规则"}
        width={600}
        open={ruleDrawerOpen}
        onClose={() => setRuleDrawerOpen(false)}
        onOk={handleCreateRule}
        okText={submitting ? "提交中..." : "提交"}
        maskClosable={false}
        confirmLoading={submitting}
      >
        <Form form={createRuleForm} layout="vertical">
          {!targetGroup && (
            <Row gutter={16}>
              <Col span={12}>
                <Form.Item name="groupId" label="所属 ACL 组" rules={[{ required: true, message: '请选择所属 ACL 组' }]}>
                  <Select
                    placeholder="选择 ACL 组"
                    showSearch
                    optionFilterProp="label"
                    options={(groups || []).map((g: any) => ({
                      value: g.id,
                      label: `${g.name}${g.vrId ? `（${vrNameMap[g.vrId] || g.vrId}）` : ''}`,
                      vrId: g.vrId,
                    }))}
                    onChange={(_, opt: any) => {
                      const vrId = opt?.vrId;
                      if (vrId) createRuleForm.setFieldsValue({ vrId });
                    }}
                  />
                </Form.Item>
              </Col>
              <Col span={12} />
            </Row>
          )}
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="name" label="规则名称" rules={[{ required: true }]}>
                <Input placeholder="输入规则名称" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="vrId" label="所属 VR" rules={[{ required: true }]}>
                <Select placeholder="选择 VR 实例" disabled={!!targetGroup}>
                  {vrList.map(v => {
                    const id = v.uuid || v.id || v.vm_id;
                    const name = v.name || id;
                    return id ? (<Option key={id} value={id}>{name}</Option>) : null;
                  })}
                </Select>
              </Form.Item>
            </Col>
          </Row>

          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="priority" label="优先级 (1-10000)" initialValue={100} rules={[{ required: true }]}>
                <InputNumber min={1} max={10000} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="action" label="动作" initialValue="permit" rules={[{ required: true }]}>
                <Select>
                  <Option value="permit">Permit (允许)</Option>
                  <Option value="deny">Deny (拒绝)</Option>
                </Select>
              </Form.Item>
            </Col>
          </Row>

          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="protocol" label="协议" initialValue="any" rules={[{ required: true }]}>
                <Select>
                  <Option value="any">Any</Option>
                  <Option value="tcp">TCP</Option>
                  <Option value="udp">UDP</Option>
                  <Option value="icmp">ICMP</Option>
                </Select>
              </Form.Item>
            </Col>
          </Row>

          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="sourceIp" label="源 IP/CIDR" initialValue="any" rules={[{ required: true }]}>
                <Input placeholder="e.g. 192.168.1.0/24 or any" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="destinationIp" label="目的 IP/CIDR" initialValue="any" rules={[{ required: true }]}>
                <Input placeholder="e.g. 10.0.0.1 or any" />
              </Form.Item>
            </Col>
          </Row>

          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="sourcePort" label="源端口" initialValue="any" rules={[{ required: true }]}>
                <Input placeholder="e.g. 80 or 1000-2000 or any" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="destinationPort" label="目的端口" initialValue="any" rules={[{ required: true }]}>
                <Input placeholder="e.g. 80 or 443 or any" />
              </Form.Item>
            </Col>
          </Row>

          <Form.Item name="description" label="描述">
            <Input.TextArea rows={3} />
          </Form.Item>
        </Form>
      </StdSideDrawer>

      {/* Binding Drawer */}
      <StdSideDrawer
        title={`关联 ACL 组: ${currentBindingGroup?.name}`}
        width={500}
        open={bindDrawerOpen}
        onClose={() => setBindDrawerOpen(false)}
        onOk={handleSubmitBind}
        okText={bindingSubmitting ? "提交中..." : "提交"}
        maskClosable={false}
        confirmLoading={bindingSubmitting}
      >
        <Form form={bindForm} layout="vertical">
          <Form.Item name="vrId" label="选择 VR" rules={[{ required: true }]}>
            <Select placeholder="选择 VR 实例">
              {vrList.filter(v => {
                const vid = v.uuid || v.id || v.vm_id;
                // Exclude primary VR and already bound VRs
                if (currentBindingGroup?.vrId === vid) return false;
               if (currentBindingGroup?.bindings?.some((b: ACLGroupBinding) => b.vrId === vid)) return false;
                return true;
              }).map(v => {
                const id = v.uuid || v.id || v.vm_id;
                const name = v.name || id;
                return id ? (<Option key={id} value={id}>{name}</Option>) : null;
              })}
            </Select>
          </Form.Item>
        </Form>
      </StdSideDrawer>
    </PageContainer>
  );
};

export default ACLPage;
