import React, { useEffect, useState, useMemo } from 'react';
import { Button, Form, Input, Select, Table, Tag, message, Modal, Space, Row, Col, InputNumber, Divider, Dropdown, Checkbox, Popover } from 'antd';
import type { MenuProps } from 'antd';
import { DeleteOutlined, EllipsisOutlined, SettingOutlined } from '@ant-design/icons';
import PageContainer from '../../../components/PageContainer';
import StdSideDrawer from '../../../components/StdSideDrawer';
import '../../common/filters.css';
import type { ColumnsType } from 'antd/es/table';
import { getACLRules, createACLRule, deleteACLRule, ACLRule } from '../../../services/networkApi';
import { vrApi } from '../../../services/vrApi';
import { fetchVrCachePageList } from '../../../services/vrCacheApi';

const { Option } = Select;

const ACLPage: React.FC = () => {
  const [data, setData] = useState<ACLRule[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [vrList, setVrList] = useState<any[]>([]);
  const [vrNameMap, setVrNameMap] = useState<Record<string, string>>({});
  const [keyword, setKeyword] = useState<string>('');
  const [vrFilter, setVrFilter] = useState<string | undefined>();
  const [actionFilter, setActionFilter] = useState<'permit' | 'deny' | undefined>();
  const [protocolFilter, setProtocolFilter] = useState<'tcp' | 'udp' | 'icmp' | 'any' | undefined>();
  const [filterForm] = Form.useForm();
  
  // PageContainer handles column visibility
  const defaultHiddenColumns: string[] = [];

  // Columns control
  const defaultCheckedColumns = ['priority', 'name', 'vrId', 'action', 'protocol', 'sourceIp', 'destinationIp', 'sourcePort', 'destinationPort', 'ops'];
  const [checkedColumns, setCheckedColumns] = useState<any[]>(defaultCheckedColumns);

  useEffect(() => {
    const saved = localStorage.getItem('acl_columns_settings');
    if (saved) {
      try {
        setCheckedColumns(JSON.parse(saved));
      } catch (e) {
        console.warn('Failed to parse saved columns settings', e);
      }
    }
  }, []);

  const onColumnCheckChange = (checkedValues: any[]) => {
    setCheckedColumns(checkedValues);
    localStorage.setItem('acl_columns_settings', JSON.stringify(checkedValues));
  };
  
  // Create Drawer State
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [createForm] = Form.useForm();
  const [submitting, setSubmitting] = useState(false);

  // Fetch VRs
  const fetchVRs = async () => {
    try {
      // 优先从远端控制器获取
      const res: any = await vrApi.getVRInstances(1000, 1);
      const dataObj = res?.data ?? res;
      let vrs = Array.isArray(dataObj?.page) ? dataObj.page : 
                Array.isArray(dataObj?.list) ? dataObj.list : 
                Array.isArray(dataObj?.rows) ? dataObj.rows :
                Array.isArray(dataObj) ? dataObj : [];

      // 如果远端失败或空，回退到本地缓存
      if (!Array.isArray(vrs) || vrs.length === 0) {
        try {
          const json = await fetchVrCachePageList(1000, 1);
          const d = json?.data ?? json;
          vrs = Array.isArray(d?.page) ? d.page : [];
        } catch (cacheErr) {
          console.warn('[ACL] Failed to fetch VR cache:', cacheErr);
        }
      }

      // 二级回退：从 VR 配置角色接口读取已知 uuid 列表
      if ((!Array.isArray(vrs) || vrs.length === 0)) {
        const token = localStorage.getItem('token') || '';
        const resRoles = await fetch(`${process.env.REACT_APP_API_URL || ''}/api/vr-config/roles`, {
          headers: { 'Content-Type': 'application/json', 'Authorization': token ? `Bearer ${token}` : '' },
          credentials: 'include'
        });
        const jsonRoles = await resRoles.json();
        const roles = jsonRoles?.data?.roles || {};
        const uuids = Object.keys(roles || {});
        vrs = uuids.map(u => ({ uuid: u, name: u }));
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

  const fetchData = async () => {
    setLoading(true);
    try {
      const list = await getACLRules();
      const normalized = Array.isArray(list)
        ? list
        : Array.isArray((list as any)?.data)
          ? (list as any).data
          : Array.isArray((list as any)?.list)
            ? (list as any).list
            : Array.isArray((list as any)?.rows)
              ? (list as any).rows
              : [];
      setData(normalized);
    } catch (e: any) {
      console.error(e);
      message.error('加载 ACL 列表失败: ' + (e.message || 'Unknown error'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchVRs();
    fetchData();
  }, []);

  const handleDelete = (row: ACLRule) => {
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
          fetchData();
        } catch (error: any) {
          console.error(error);
          message.error('删除失败: ' + (error.message || 'Unknown error'));
        }
      }
    });
  };

  const handleCreate = async () => {
    try {
      const values = await createForm.validateFields();
      setSubmitting(true);
      await createACLRule(values);
      message.success('创建成功');
      setDrawerOpen(false);
      createForm.resetFields();
      fetchData();
    } catch (error: any) {
      console.error(error);
      if (error.errorFields) {
        // Validation error
      } else {
        message.error('创建失败: ' + (error.message || 'Unknown error'));
      }
    } finally {
      setSubmitting(false);
    }
  };

  const fullColumns: ColumnsType<ACLRule> = [
    { title: '优先级', dataIndex: 'priority', key: 'priority', width: 80, sorter: (a, b) => a.priority - b.priority },
    { title: '名称', dataIndex: 'name', key: 'name', width: 150 },
    { title: '所属VR', dataIndex: 'vrId', key: 'vrId', width: 150, render: (v) => vrNameMap[v] || v },
    { title: '动作', dataIndex: 'action', key: 'action', width: 100, render: (act) => (
      <Tag color={act === 'permit' ? 'green' : 'red'}>{act.toUpperCase()}</Tag>
    )},
    { title: '协议', dataIndex: 'protocol', key: 'protocol', width: 100, render: (p) => <Tag>{p.toUpperCase()}</Tag> },
    { title: '源IP', dataIndex: 'sourceIp', key: 'sourceIp' },
    { title: '目的IP', dataIndex: 'destinationIp', key: 'destinationIp' },
    { title: '源端口', dataIndex: 'sourcePort', key: 'sourcePort' },
    { title: '目的端口', dataIndex: 'destinationPort', key: 'destinationPort' },
    { title: '操作', key: 'ops', width: 100, render: (_, row) => (
      <Button type="text" danger icon={<DeleteOutlined />} onClick={() => handleDelete(row)} />
    )}
  ];

  const columns = fullColumns;

  const filteredData = data.filter((r) => {
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

  const moreMenu: MenuProps = {
    items: [
      {
        key: 'refresh',
        label: '刷新列表',
        onClick: fetchData
      },
      {
        key: 'reset',
        label: '重置筛选',
        onClick: resetFilters
      }
    ]
  };

  return (
    <PageContainer
      titleLevel={3}
      asCard={false}
      primaryAction={{
        text: '新建 ACL',
        onClick: () => setDrawerOpen(true),
        type: 'primary',
      }}
      moreMenuItems={[
        { key: 'refresh', label: '刷新列表', onClick: fetchData },
        { key: 'reset', label: '重置筛选', onClick: resetFilters }
      ]}
      defaultHiddenColumns={[]} // ACL columns seem to be all visible by default in previous code (defaultCheckedColumns had all)
      toolbarLeft={(
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
      tableProps={{
        dataSource: filteredData,
        columns: columns,
        rowKey: "id",
        loading: loading,
        pagination: { defaultPageSize: 10, showSizeChanger: true, pageSizeOptions: ['10','20','50'] },
        scroll: { x: 'max-content' },
        bordered: true
      }}
    >

      <StdSideDrawer
        title="新建 ACL 规则"
        width={600}
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        onOk={handleCreate}
        okText={submitting ? "提交中..." : "提交"}
      >
        <Form form={createForm} layout="vertical">
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="name" label="规则名称" rules={[{ required: true }]}>
                <Input placeholder="输入规则名称" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="vrId" label="所属 VR" rules={[{ required: true }]}>
                <Select placeholder="选择 VR 实例">
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
