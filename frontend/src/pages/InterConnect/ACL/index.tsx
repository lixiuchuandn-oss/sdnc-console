import React, { useEffect, useState, useMemo } from 'react';
import { Button, Form, Input, Select, Table, Tag, message, Modal, Space, Row, Col, InputNumber, Divider, Dropdown, Checkbox, Popover, Tabs, Card, List, Tooltip, Descriptions, Badge } from 'antd';
import type { MenuProps } from 'antd';
import { DeleteOutlined, EllipsisOutlined, SettingOutlined, PlusOutlined, RocketOutlined, FolderOutlined, UnorderedListOutlined } from '@ant-design/icons';
import PageContainer from '../../../components/PageContainer';
import StdSideDrawer from '../../../components/StdSideDrawer';
import ResourceActionsDropdown from '../../../components/ResourceActionsDropdown';
import '../../common/filters.css';
import type { ColumnsType } from 'antd/es/table';
import { 
  getACLRules, createACLRule, deleteACLRule, ACLRule,
  getACLGroups, createACLGroup, deleteACLGroup, addACLRuleToGroup, pushACLConfig, ACLGroup
} from '../../../services/networkApi';
import { vrApi, fetchVrCachePageList } from '../../../services/virtualRouterApi';

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

  const fetchVRs = async () => {
    try {
      const res: any = await vrApi.getVRInstances(1000, 1);
      const dataObj = res?.data ?? res;
      let vrs = Array.isArray(dataObj?.page) ? dataObj.page : 
                Array.isArray(dataObj?.list) ? dataObj.list : 
                Array.isArray(dataObj?.rows) ? dataObj.rows :
                Array.isArray(dataObj) ? dataObj : [];

      if (!Array.isArray(vrs) || vrs.length === 0) {
        try {
          const json = await fetchVrCachePageList(1000, 1);
          const d = json?.data ?? json;
          vrs = Array.isArray(d?.page) ? d.page : [];
        } catch (cacheErr) {
          console.warn('[ACL] Failed to fetch VR cache:', cacheErr);
        }
      }

      if ((!Array.isArray(vrs) || vrs.length === 0)) {
        const token = localStorage.getItem('token') || '';
        try {
            const resRoles = await fetch(`${process.env.REACT_APP_API_URL || ''}/api/vr-config/roles`, {
            headers: { 'Content-Type': 'application/json', 'Authorization': token ? `Bearer ${token}` : '' },
            credentials: 'include'
            });
            const jsonRoles = await resRoles.json();
            const roles = jsonRoles?.data?.roles || {};
            const uuids = Object.keys(roles || {});
            vrs = uuids.map(u => ({ uuid: u, name: u }));
        } catch (e) {
            console.warn('Failed to fetch roles', e);
        }
      }

      setVrList(vrs);
      const map: Record<string, string> = {};
      vrs.forEach((v: any) => {
        const id = v.uuid || v.id || v.vm_id;
        const name = v.name || id;
        if (id) map[id] = name;
      });
      setVrNameMap(map);
    } catch (e) {
      console.error('Failed to fetch VRs', e);
      setVrList([]);
      setVrNameMap({});
    }
  };

  const fetchGroups = async () => {
    setGroupsLoading(true);
    try {
      const res = await getACLGroups();
      const list = Array.isArray(res) ? res : (res as any)?.data || [];
      setGroups(list);
    } catch (e: any) {
      message.error('加载 ACL 组失败: ' + (e.message || 'Unknown error'));
    } finally {
      setGroupsLoading(false);
    }
  };

  const fetchRules = async () => {
    setRulesLoading(true);
    try {
      const list = await getACLRules();
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
      content: `确定要删除 ACL 组 "${group.name}" 吗？组内的规则也会被删除。`,
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
      createRuleForm.setFieldsValue({ vrId: group.vrId });
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
        await createACLRule(values);
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
    { title: '组名称', dataIndex: 'name', key: 'name', width: 200, render: (t) => <b>{t}</b> },
    { title: '所属VR', dataIndex: 'vrId', key: 'vrId', width: 200, render: (v) => v ? (vrNameMap[v] || v) : <span style={{color:'#ccc'}}>未绑定</span> },
    { title: '描述', dataIndex: 'description', key: 'description' },
    { title: '规则数', key: 'rules', width: 100, render: (_, r) => <Badge count={r.rules?.length || 0} showZero color="blue" /> },
    { title: '操作', key: 'ops', width: 150, render: (_, r) => (
      <Space>
        <Tooltip title="添加规则">
          <Button type="text" icon={<PlusOutlined />} onClick={() => handleOpenCreateRule(r)} />
        </Tooltip>
        <Tooltip title="下发配置">
          <Button type="text" icon={<RocketOutlined />} onClick={() => r.vrId && handleDeploy(r.vrId)} disabled={!r.vrId} />
        </Tooltip>
        <ResourceActionsDropdown
          items={[
            { key: 'delete', label: '删除组', danger: true }
          ]}
          onClick={({ key }) => {
            if (key === 'delete') handleDeleteGroup(r);
          }}
        />
      </Space>
    )}
  ];

  const ruleColumns: ColumnsType<ACLRule> = [
    { title: '优先级', dataIndex: 'priority', key: 'priority', width: 80, sorter: (a, b) => a.priority - b.priority },
    { title: '名称', dataIndex: 'name', key: 'name', width: 150 },
    { title: '所属VR', dataIndex: 'vrId', key: 'vrId', width: 150, render: (v) => vrNameMap[v] || v },
    { title: '所属组', dataIndex: 'group', key: 'group', width: 150, render: (g) => g ? <Tag color="blue">{g.name}</Tag> : '-' },
    { title: '动作', dataIndex: 'action', key: 'action', width: 100, render: (act) => (
      <Tag color={act === 'permit' ? 'green' : 'red'}>{act.toUpperCase()}</Tag>
    )},
    { title: '协议', dataIndex: 'protocol', key: 'protocol', width: 100, render: (p) => <Tag>{p.toUpperCase()}</Tag> },
    { title: '源IP', dataIndex: 'sourceIp', key: 'sourceIp' },
    { title: '目的IP', dataIndex: 'destinationIp', key: 'destinationIp' },
    { title: '源端口', dataIndex: 'sourcePort', key: 'sourcePort' },
    { title: '目的端口', dataIndex: 'destinationPort', key: 'destinationPort' },
    { title: '操作', key: 'ops', width: 100, render: (_, row) => (
      <ResourceActionsDropdown
        items={[
          { key: 'delete', label: '删除', danger: true }
        ]}
        onClick={({ key }) => {
          if (key === 'delete') handleDeleteRule(row);
        }}
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
    setKeyword('');
    setVrFilter(undefined);
    setActionFilter(undefined);
    setProtocolFilter(undefined);
  };

  return (
    <PageContainer
      titleLevel={3}
      asCard={false}
      onRefresh={() => { fetchGroups(); fetchRules(); }}
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
        { key: 'groups', tab: <span><FolderOutlined />ACL 组管理</span> },
        { key: 'rules', tab: <span><UnorderedListOutlined />所有规则列表</span> }
      ]}
      tabActiveKey={activeTab}
      onTabChange={setActiveTab}
      toolbarLeft={activeTab === 'rules' && (
        <Form
          className="filter-tools filter-tools--center"
          form={filterForm}
          layout="vertical"
          style={{ rowGap: 12, columnGap: 12, display: 'flex', alignItems: 'flex-end' }}
          onValuesChange={(_, all) => {
            setKeyword(all.keyword || '');
            setVrFilter(all.vrId || undefined);
            setActionFilter(all.action || undefined);
            setProtocolFilter(all.protocol || undefined);
          }}
        >
          <Form.Item name="keyword" label="名称">
            <Input allowClear placeholder="搜索名称" style={{ width: 200 }} />
          </Form.Item>
          <Form.Item name="vrId" label="所属VR">
            <Select allowClear placeholder="选择 VR" style={{ width: 180 }}>
              {vrList.map(v => {
                const id = v.uuid || v.id || v.vm_id;
                const name = v.name || id;
                return id ? (<Option key={id} value={id}>{name}</Option>) : null;
              })}
            </Select>
          </Form.Item>
          <Form.Item name="action" label="动作">
            <Select allowClear placeholder="选择动作" style={{ width: 140 }}>
              <Option value="permit">Permit</Option>
              <Option value="deny">Deny</Option>
            </Select>
          </Form.Item>
          <Form.Item name="protocol" label="协议">
            <Select allowClear placeholder="选择协议" style={{ width: 140 }}>
              <Option value="any">Any</Option>
              <Option value="tcp">TCP</Option>
              <Option value="udp">UDP</Option>
              <Option value="icmp">ICMP</Option>
            </Select>
          </Form.Item>
        </Form>
      )}
    >
      {activeTab === 'groups' && (
        <Card bodyStyle={{ padding: 0 }} bordered={false}>
          <Table
            dataSource={groups}
            columns={groupColumns}
            rowKey="id"
            loading={groupsLoading}
            pagination={{ pageSize: 10 }}
            expandable={{
              expandedRowRender: (record) => (
                <div style={{ margin: 0 }}>
                  <p style={{ marginBottom: 8 }}><b>{record.name} 的规则列表:</b></p>
                  <Table
                    size="small"
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
        </Card>
      )}
      
      {activeTab === 'rules' && (
        <Card bodyStyle={{ padding: 0 }} bordered={false}>
          <Table
            dataSource={filteredRules}
            columns={ruleColumns}
            rowKey="id"
            loading={rulesLoading}
            pagination={{ pageSize: 20 }}
            scroll={{ x: 'max-content' }}
          />
        </Card>
      )}

      {/* Group Drawer */}
      <StdSideDrawer
        title="新建 ACL 组"
        width={500}
        open={groupDrawerOpen}
        onClose={() => setGroupDrawerOpen(false)}
        onOk={handleCreateGroup}
        okText={submitting ? "提交中..." : "提交"}
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
      >
        <Form form={createRuleForm} layout="vertical">
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
    </PageContainer>
  );
};

export default ACLPage;
