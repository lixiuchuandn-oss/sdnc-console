import React, { useEffect, useState } from 'react';
import { Form, Input, Select, Tag, message, Space, Row, Col, Typography } from 'antd';
import type { MenuProps } from 'antd';
import { EllipsisOutlined, SettingOutlined } from '@ant-design/icons';
import PageContainer from '../../../components/PageContainer';
import type { ColumnsType } from 'antd/es/table';
import { vrApi, getVRConfigCached } from '../../../services/virtualRouterApi';
import { apiRequest } from '../../../services/api';

const { Option } = Select;
const { Text } = Typography;

const NATPage: React.FC = () => {
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [vrList, setVrList] = useState<any[]>([]);
  const [vrNameMap, setVrNameMap] = useState<Record<string, string>>({});
  const [keyword, setKeyword] = useState<string>('');
  const [vrFilter, setVrFilter] = useState<string | undefined>();
  const [typeFilter, setTypeFilter] = useState<'snat' | 'dnat' | 'static' | undefined>();
  const [filterForm] = Form.useForm();
  
  // PageContainer handles column visibility
  const defaultHiddenColumns: string[] = [];
  
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
        const json = await apiRequest('/api/vr-cache/pagelist?page_num=1&page_size=1000');
        const d = json?.data ?? json;
        vrs = Array.isArray(d?.page) ? d.page : [];
      }
      if ((!Array.isArray(vrs) || vrs.length === 0)) {
        const jsonRoles = await apiRequest('/api/vr-config/roles');
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

      const natRows: any[] = [];
      for (const v of vrs) {
        const vid = v.uuid || v.id || v.vm_id;
        if (!vid) continue;
        try {
          const cfg = await getVRConfigCached(vid);
          const natGroups = cfg?.nat_address_group || [];
          for (const g of Array.isArray(natGroups) ? natGroups : []) {
            const gid = g?.group_id ?? g?.groupId ?? '';
            const ranges = g?.range ?? [];
            const rangeArr = Array.isArray(ranges) ? ranges : (ranges ? [ranges] : []);
            const rangeText = rangeArr.map((x: any) => (typeof x === 'string' ? x : JSON.stringify(x))).join('；');

            const mappingsRaw =
              (Array.isArray(g?.static_mapping) ? g.static_mapping : null) ??
              (Array.isArray(g?.staticMapping) ? g.staticMapping : null) ??
              null;

            if (mappingsRaw) {
              mappingsRaw.forEach((sm: any, idx: number) => {
                natRows.push({
                  id: `${vid}:${gid}:${idx}:${sm?.inside || ''}:${sm?.local_port || ''}:${sm?.outside || ''}:${sm?.external_port || ''}`,
                  groupId: String(gid),
                  rangeText,
                  vrId: vid,
                  type: 'static',
                  proto: sm?.proto || '',
                  inside: sm?.inside || '',
                  localPort: sm?.local_port ?? '',
                  outside: sm?.outside || '',
                  externalPort: sm?.external_port ?? '',
                  vrf: sm?.vrf ?? '',
                  twiceNat: sm?.twice_nat || '',
                });
              });
              continue;
            }

            const nested = rangeArr
              .map((r: any) => r?.static_mapping || r?.staticMapping)
              .filter(Boolean);
            nested.forEach((sm: any, idx: number) => {
              natRows.push({
                id: `${vid}:${gid}:nested:${idx}:${sm?.inside || ''}:${sm?.local_port || ''}:${sm?.outside || ''}:${sm?.external_port || ''}`,
                groupId: String(gid),
                rangeText,
                vrId: vid,
                type: 'static',
                proto: sm?.proto || '',
                inside: sm?.inside || '',
                localPort: sm?.local_port ?? '',
                outside: sm?.outside || '',
                externalPort: sm?.external_port ?? '',
                vrf: sm?.vrf ?? '',
                twiceNat: sm?.twice_nat || '',
              });
            });
          }
        } catch (e) {
        }
      }
      setData(natRows);
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

  const fullColumns: ColumnsType<any> = [
    {
      title: '地址池',
      dataIndex: 'groupId',
      key: 'groupId',
      width: 150,
      render: (text, record) => (
        <Space direction="vertical" size={0}>
          <Text strong>{String(text || '-')}</Text>
          <Text type="secondary" style={{ fontSize: 12 }}>{record.rangeText || '-'}</Text>
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
      title: '协议',
      dataIndex: 'proto',
      key: 'proto',
      width: 100,
      render: (text) => text || '-',
    },
    {
      title: '内部地址/端口',
      key: 'inside',
      width: 250,
      render: (_, r) => (
        <div style={{ fontSize: 13 }}>
          <div>{r.inside || '-'}</div>
          <div>端口: {r.localPort !== undefined ? r.localPort : '-'}</div>
        </div>
      ),
    },
    {
      title: '外部地址/端口',
      key: 'outside',
      width: 250,
      render: (_, r) => (
        <div style={{ fontSize: 13 }}>
          <div>{r.outside || '-'}</div>
          <div>端口: {r.externalPort !== undefined ? r.externalPort : '-'}</div>
        </div>
      ),
    },
    {
      title: 'VRF',
      dataIndex: 'vrf',
      key: 'vrf',
      width: 100,
      render: (t) => (t !== undefined && t !== null && String(t).trim() !== '' ? String(t) : '-'),
    },
    {
      title: 'Twice NAT',
      dataIndex: 'twiceNat',
      key: 'twiceNat',
      width: 120,
      render: (t) => t || '-',
    },
  ];

  const columns = fullColumns;

  const filteredData = data.filter((r) => {
    if (keyword) {
      const kw = keyword.toLowerCase();
      const hay = [
        r.groupId,
        r.rangeText,
        r.inside,
        r.outside,
        r.proto,
        r.twiceNat,
      ].map((x: any) => String(x || '').toLowerCase()).join(' ');
      if (!hay.includes(kw)) return false;
    }
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
      moreMenuItems={[
        { key: 'refresh', label: '刷新列表', onClick: fetchData },
        { key: 'reset', label: '重置筛选', onClick: resetFilters }
      ]}
      defaultHiddenColumns={[]}
      toolbarLeft={(
        <Form
          className="toolbar-container"
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
            <Input allowClear placeholder="搜索名称" className="toolbar-search" />
          </Form.Item>
          <Form.Item name="vrId" label="所属VR">
            <Select allowClear placeholder="选择 VR" className="toolbar-filter">
              {vrList.map(v => (<Option key={v.uuid} value={v.uuid}>{v.name}</Option>))}
            </Select>
          </Form.Item>
          <Form.Item name="type" label="类型">
            <Select allowClear placeholder="选择类型" className="toolbar-filter-sm">
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
    </PageContainer>
  );
};

export default NATPage;
