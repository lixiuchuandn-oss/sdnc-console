import React, { useEffect, useState, useMemo } from 'react';
import { Button, Form, Input, Select, Table, Tag, message, Modal, Space, Row, Col, Typography, Divider, Dropdown, Checkbox, Popover } from 'antd';
import type { MenuProps } from 'antd';
import { DeleteOutlined, EllipsisOutlined, SettingOutlined } from '@ant-design/icons';
import PageContainer from '../../../components/PageContainer';
import StdSideDrawer from '../../../components/StdSideDrawer';
import '../../common/filters.css';
import type { ColumnsType } from 'antd/es/table';
import { getNATRules, createNATRule, deleteNATRule, NATRule } from '../../../services/networkApi';
import { vrApi } from '../../../services/vrApi';

const { Option } = Select;
const { Text } = Typography;

const NATPage: React.FC = () => {
  const [data, setData] = useState<NATRule[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [vrList, setVrList] = useState<any[]>([]);
  const [vrNameMap, setVrNameMap] = useState<Record<string, string>>({});
  const [keyword, setKeyword] = useState<string>('');
  const [vrFilter, setVrFilter] = useState<string | undefined>();
  const [typeFilter, setTypeFilter] = useState<'snat' | 'dnat' | 'static' | undefined>();
  const [filterForm] = Form.useForm();
  
  // PageContainer handles column visibility
  const defaultHiddenColumns: string[] = [];
  
  // Create Drawer State
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [createForm] = Form.useForm();
  const [submitting, setSubmitting] = useState(false);

  // Fetch VRs and NAT Rules
  const fetchData = async () => {
    setLoading(true);
    try {
      // Fetch VRs first to build map
      const res: any = await vrApi.getVRInstances(1000, 1);
      const dataObj = res?.data ?? res;
      let vrs = Array.isArray(dataObj?.page) ? dataObj.page : 
                Array.isArray(dataObj?.list) ? dataObj.list : 
                Array.isArray(dataObj?.rows) ? dataObj.rows :
                Array.isArray(dataObj) ? dataObj : [];
      if (!Array.isArray(vrs) || vrs.length === 0) {
        const fallback = await fetch(`${process.env.REACT_APP_API_URL || ''}/api/vr-cache/pagelist?page_num=1&page_size=1000`, {
          credentials: 'include'
        });
        const json = await fallback.json();
        const d = json?.data ?? json;
        vrs = Array.isArray(d?.page) ? d.page : [];
      }
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

      // Fetch NAT Rules
      const list = await getNATRules();
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
      message.error('加载 NAT 规则列表失败: ' + (e.message || 'Unknown error'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleDelete = (record: NATRule) => {
    Modal.confirm({
      title: '确认删除',
      content: `确定要删除 NAT 规则 "${record.name}" 吗？`,
      okText: '删除',
      okType: 'danger',
      cancelText: '取消',
      onOk: async () => {
        try {
          await deleteNATRule(record.id);
          message.success('删除成功');
          fetchData();
        } catch (e: any) {
          message.error('删除失败: ' + (e.message || 'Unknown error'));
        }
      },
    });
  };

  const handleCreate = async () => {
    try {
      const values = await createForm.validateFields();
      setSubmitting(true);
      await createNATRule(values);
      message.success('创建成功');
      setDrawerOpen(false);
      createForm.resetFields();
      fetchData();
    } catch (e: any) {
      console.error(e);
      // If validation error, don't show message
      if (!e.errorFields) {
        message.error('创建失败: ' + (e.message || 'Unknown error'));
      }
    } finally {
      setSubmitting(false);
    }
  };

  const fullColumns: ColumnsType<NATRule> = [
    {
      title: '规则名称',
      dataIndex: 'name',
      key: 'name',
      width: 150,
      render: (text, record) => (
        <Space direction="vertical" size={0}>
          <Text strong>{text}</Text>
          {record.description && <Text type="secondary" style={{ fontSize: 12 }}>{record.description}</Text>}
        </Space>
      ),
    },
    {
      title: 'VR 实例',
      dataIndex: 'vrId',
      key: 'vrId',
      width: 150,
      render: (id) => vrNameMap[id] || id,
    },
    {
      title: '类型',
      dataIndex: 'type',
      key: 'type',
      width: 100,
      render: (type) => {
        let color = 'blue';
        if (type === 'dnat') color = 'green';
        if (type === 'static') color = 'orange';
        return <Tag color={color}>{type.toUpperCase()}</Tag>;
      },
    },
    {
      title: '接口',
      dataIndex: 'interface',
      key: 'interface',
      width: 100,
      render: (text) => text || '-',
    },
    {
      title: '原始地址/端口',
      key: 'original',
      width: 250,
      render: (_, r) => (
        <div style={{ fontSize: 13 }}>
          <div>Src: {r.originalSourceIp || 'any'}:{r.originalSourcePort || 'any'}</div>
          <div>Dst: {r.originalDestinationIp || 'any'}:{r.originalDestinationPort || 'any'}</div>
        </div>
      ),
    },
    {
      title: '转换后地址/端口',
      key: 'translated',
      width: 250,
      render: (_, r) => (
        <div style={{ fontSize: 13 }}>
          <div>Src: {r.translatedSourceIp || '-'}:{r.translatedSourcePort || '-'}</div>
          <div>Dst: {r.translatedDestinationIp || '-'}:{r.translatedDestinationPort || '-'}</div>
        </div>
      ),
    },
    {
      title: '操作',
      key: 'action',
      width: 100,
      render: (_, record) => (
        <Button 
          type="text" 
          danger 
          icon={<DeleteOutlined />} 
          onClick={() => handleDelete(record)}
        >
          删除
        </Button>
      ),
    },
  ];

  const columns = fullColumns;

  const filteredData = data.filter((r) => {
    if (keyword && !String(r.name || '').toLowerCase().includes(keyword.toLowerCase())) return false;
    if (vrFilter && r.vrId !== vrFilter) return false;
    if (typeFilter && r.type !== typeFilter) return false;
    return true;
  });

  const resetFilters = () => {
    setKeyword('');
    setVrFilter(undefined);
    setTypeFilter(undefined);
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
        text: '新建 NAT',
        onClick: () => setDrawerOpen(true),
        type: 'primary',
      }}
      moreMenuItems={[
        { key: 'refresh', label: '刷新列表', onClick: fetchData },
        { key: 'reset', label: '重置筛选', onClick: resetFilters }
      ]}
      defaultHiddenColumns={[]}
      toolbarLeft={(
        <Form
          className="filter-tools filter-tools--center"
          form={filterForm}
          layout="vertical"
          style={{ rowGap: 12, columnGap: 12, display: 'flex', alignItems: 'flex-end' }}
          onValuesChange={(_, all) => {
            setKeyword(all.keyword || '');
            setVrFilter(all.vrId || undefined);
            setTypeFilter(all.type || undefined);
          }}
        >
          <Form.Item name="keyword" label="名称">
            <Input allowClear placeholder="搜索名称" style={{ width: 200 }} />
          </Form.Item>
          <Form.Item name="vrId" label="所属VR">
            <Select allowClear placeholder="选择 VR" style={{ width: 180 }}>
              {vrList.map(v => (<Option key={v.uuid} value={v.uuid}>{v.name}</Option>))}
            </Select>
          </Form.Item>
          <Form.Item name="type" label="类型">
            <Select allowClear placeholder="选择类型" style={{ width: 160 }}>
              <Option value="snat">SNAT</Option>
              <Option value="dnat">DNAT</Option>
              <Option value="static">STATIC</Option>
            </Select>
          </Form.Item>
        </Form>
      )}
      tableProps={{
        dataSource: filteredData,
        columns: columns,
        rowKey: "id",
        loading: loading,
        pagination: { pageSize: 10, showSizeChanger: true, pageSizeOptions: ['10','20','50'] },
        scroll: { x: 'max-content' },
        bordered: true
      }}
    >

      <StdSideDrawer
        title="新建 NAT 规则"
        width={700}
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        onOk={handleCreate}
        okText={submitting ? "提交中..." : "提交"}
      >
        <Form form={createForm} layout="vertical">
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item 
                name="name" 
                label="规则名称" 
                rules={[{ required: true, message: '请输入名称' }]}
              >
                <Input placeholder="例如: nat-rule-01" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item 
                name="vrId" 
                label="所属 VR" 
                rules={[{ required: true, message: '请选择 VR' }]}
              >
                <Select placeholder="选择 VR 实例">
                  {vrList.map(vr => {
                    const id = vr.uuid || vr.id || vr.vm_id;
                    const name = vr.name || id;
                    return id ? (<Option key={id} value={id}>{name}</Option>) : null;
                  })}
                </Select>
              </Form.Item>
            </Col>
          </Row>

          <Row gutter={16}>
            <Col span={12}>
              <Form.Item 
                name="type" 
                label="NAT 类型" 
                initialValue="snat"
                rules={[{ required: true }]}
              >
                <Select>
                  <Option value="snat">SNAT (源地址转换)</Option>
                  <Option value="dnat">DNAT (目的地址转换)</Option>
                  <Option value="static">STATIC (静态一对一)</Option>
                </Select>
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item 
                name="interface" 
                label="接口 (可选)"
              >
                <Input placeholder="例如: eth0" />
              </Form.Item>
            </Col>
          </Row>
          
          <Form.Item name="description" label="描述">
            <Input.TextArea rows={2} />
          </Form.Item>

          <div style={{ border: '1px solid #f0f0f0', padding: '16px', marginBottom: '16px', borderRadius: '4px' }}>
            <Text strong style={{ display: 'block', marginBottom: '12px' }}>原始匹配条件</Text>
            <Row gutter={16}>
              <Col span={12}>
                <Form.Item name="originalSourceIp" label="原始源 IP">
                  <Input placeholder="IP 或网段" />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item name="originalSourcePort" label="原始源端口">
                  <Input placeholder="端口号" />
                </Form.Item>
              </Col>
            </Row>
            <Row gutter={16}>
              <Col span={12}>
                <Form.Item name="originalDestinationIp" label="原始目的 IP">
                  <Input placeholder="IP 或网段" />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item name="originalDestinationPort" label="原始目的端口">
                  <Input placeholder="端口号" />
                </Form.Item>
              </Col>
            </Row>
          </div>

          <div style={{ border: '1px solid #f0f0f0', padding: '16px', marginBottom: '16px', borderRadius: '4px', background: '#fafafa' }}>
            <Text strong style={{ display: 'block', marginBottom: '12px' }}>转换后动作</Text>
            <Row gutter={16}>
              <Col span={12}>
                <Form.Item name="translatedSourceIp" label="转换后源 IP">
                  <Input placeholder="IP 或网段" />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item name="translatedSourcePort" label="转换后源端口">
                  <Input placeholder="端口号" />
                </Form.Item>
              </Col>
            </Row>
            <Row gutter={16}>
              <Col span={12}>
                <Form.Item name="translatedDestinationIp" label="转换后目的 IP">
                  <Input placeholder="IP 或网段" />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item name="translatedDestinationPort" label="转换后目的端口">
                  <Input placeholder="端口号" />
                </Form.Item>
              </Col>
            </Row>
          </div>
        </Form>
      </StdSideDrawer>
    </PageContainer>
  );
};

export default NATPage;
