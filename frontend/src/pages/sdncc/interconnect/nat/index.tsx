import React, { useEffect, useMemo, useState } from 'react';
import { Form, Input, InputNumber, Modal, Select, Tag, message, Space, Row, Col, Typography } from 'antd';
import PageContainer from '../../../../components/PageContainer';
import type { ColumnsType } from 'antd/es/table';
import { vrApi, getVRConfig, saveVRConfig, fetchVrCachePageList, getVRRoles } from '../../../../services/virtualRouterApi';
import { apiPost } from '../../../../services/api';

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
  const [createOpen, setCreateOpen] = useState(false);
  const [createSubmitting, setCreateSubmitting] = useState(false);
  const [createForm] = Form.useForm();

  // Fetch VRs and NAT Rules
  const fetchData = async (force?: boolean) => {
    setLoading(true);
    try {
      if (force) {
        await apiPost('/api/vr-instances/refresh', {});
      }
      // Fetch VRs first to build map
      const res: any = await vrApi.getVRInstances(1000, 1);
      const dataObj = res?.data ?? res;
      let vrs = Array.isArray(dataObj?.page) ? dataObj.page : 
                Array.isArray(dataObj?.list) ? dataObj.list : 
                Array.isArray(dataObj?.rows) ? dataObj.rows :
                Array.isArray(dataObj) ? dataObj : [];
      if (!Array.isArray(vrs) || vrs.length === 0) {
        const json = await fetchVrCachePageList(1000, 1, { skipCache: !!force });
        const d = json?.data ?? json;
        vrs = Array.isArray(d?.page) ? d.page : [];
      }
      if ((!Array.isArray(vrs) || vrs.length === 0)) {
        const roles = await getVRRoles([], { skipCache: !!force });
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
          const cfg = await getVRConfig(vid, { skipCache: !!force });
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

  const vrOptions = useMemo(
    () =>
      (vrList || [])
        .map((v: any) => {
          const id = v.uuid || v.id || v.vm_id;
          const name = v.name || id;
          return id ? { value: String(id), label: String(name) } : null;
        })
        .filter(Boolean) as Array<{ value: string; label: string }>,
    [vrList],
  );

  const handleCreateNat = async () => {
    try {
      const values = await createForm.validateFields();
      const vrId = String(values.vrId || '').trim();
      if (!vrId) throw new Error('请选择 VR');

      setCreateSubmitting(true);

      // 读取当前 DB 配置（没有则从空开始）
      const existing = (await getVRConfig(vrId)) || {};
      const cfg: any = (existing && typeof existing === 'object') ? { ...existing } : {};

      const groupId = Number(values.groupId);
      const rangeText = String(values.range || '').trim();
      const rangeArr = rangeText ? rangeText.split(/[\n,;，；\s]+/).map((s) => s.trim()).filter(Boolean) : [];

      const mapping: any = {
        proto: String(values.proto || '').trim(),
        inside: String(values.inside || '').trim(),
        local_port: Number(values.localPort),
        vrf: String(values.vrf || '').trim(),
        outside: String(values.outside || '').trim(),
        external_port: Number(values.externalPort),
        twice_nat: String(values.twiceNat || '').trim(),
      };

      const groups = Array.isArray(cfg.nat_address_group) ? [...cfg.nat_address_group] : [];
      const idx = groups.findIndex((g: any) => Number(g?.group_id ?? g?.groupId) === groupId);
      if (idx >= 0) {
        const g = { ...(groups[idx] || {}) };
        const curRange = Array.isArray(g.range) ? g.range : (g.range ? [g.range] : []);
        const nextRange = rangeArr.length ? rangeArr : curRange;
        g.group_id = groupId;
        g.range = nextRange;
        const curMappings = Array.isArray(g.static_mapping) ? g.static_mapping : [];
        g.static_mapping = [...curMappings, mapping];
        groups[idx] = g;
      } else {
        groups.push({
          group_id: groupId,
          range: rangeArr,
          static_mapping: [mapping],
        });
      }
      cfg.nat_address_group = groups;

      await saveVRConfig(vrId, cfg);
      message.success('NAT 规则已保存到平台（未下发）');
      setCreateOpen(false);
      createForm.resetFields();
      fetchData();
    } catch (e: any) {
      if (e?.errorFields) return;
      message.error(e?.message || '创建失败');
    } finally {
      setCreateSubmitting(false);
    }
  };

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
    {
      title: '操作',
      key: 'actions',
      width: 120,
      fixed: 'right',
      render: () => <span style={{ color: '#999' }}>—</span>,
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
    filterForm.resetFields();
    setKeyword('');
    setVrFilter(undefined);
    setTypeFilter(undefined);
  };

  return (
    <PageContainer
      titleLevel={3}
      asCard={false}
      primaryAction={{
        text: '创建 NAT',
        onClick: () => {
          createForm.resetFields();
          setCreateOpen(true);
        },
        type: 'primary',
      }}
      onRefresh={() => { void fetchData(true); }}
      defaultHiddenColumns={[]}
      toolbarLeft={(
        <Form
          className="toolbar-container"
          form={filterForm}
          layout="inline"
          style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}
          onValuesChange={(_, all) => {
            setKeyword(all.keyword || '');
            setVrFilter(all.vrId || undefined);
            setTypeFilter(all.type || undefined);
          }}
        >
          <Form.Item name="keyword" style={{ marginBottom: 0 }}>
            <Input allowClear placeholder="名称" className="toolbar-search" />
          </Form.Item>
          <Form.Item name="vrId" style={{ marginBottom: 0 }}>
            <Select allowClear placeholder="所属 VR" className="toolbar-filter">
              {vrList.map((v) => (
                <Option key={v.uuid} value={v.uuid}>
                  {v.name}
                </Option>
              ))}
            </Select>
          </Form.Item>
          <Form.Item name="type" style={{ marginBottom: 0 }}>
            <Select allowClear placeholder="类型" className="toolbar-filter-sm">
              <Option value="snat">SNAT</Option>
              <Option value="dnat">DNAT</Option>
              <Option value="static">STATIC</Option>
            </Select>
          </Form.Item>
          <button type="button" className="toolbar-reset-btn" onClick={resetFilters}>
            重置
          </button>
        </Form>
      )}
      tableProps={{
        dataSource: filteredData,
        columns: columns,
        rowKey: "id",
        loading: loading,
        pagination: {
          size: 'small',
          showTotal: (total) => `共 ${total} 条`,
        },
        scroll: { x: 'max-content' },
        bordered: false,
        className: "std-table"
      }}
    >
      <Modal
        title="创建 NAT（静态映射）"
        open={createOpen}
        onCancel={() => setCreateOpen(false)}
        onOk={handleCreateNat}
        confirmLoading={createSubmitting}
        okText="保存"
        cancelText="取消"
        destroyOnHidden
        width={720}
      >
        <Form form={createForm} layout="vertical">
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="vrId" label="所属 VR" rules={[{ required: true, message: '请选择 VR' }]}>
                <Select showSearch optionFilterProp="label" options={vrOptions} placeholder="选择 VR" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item
                name="groupId"
                label="地址池（group_id）"
                rules={[{ required: true, message: '请输入地址池 ID' }]}
              >
                <InputNumber style={{ width: '100%' }} min={0} placeholder="例如：1" />
              </Form.Item>
            </Col>
          </Row>

          <Form.Item name="range" label="地址池范围（range，可选，多值用逗号/换行分隔）">
            <Input.TextArea rows={2} placeholder="例如：203.0.113.10-203.0.113.20 或 203.0.113.10/32" />
          </Form.Item>

          <Row gutter={16}>
            <Col span={8}>
              <Form.Item name="proto" label="协议" initialValue="tcp" rules={[{ required: true, message: '请选择协议' }]}>
                <Select
                  options={[
                    { value: 'tcp', label: 'TCP' },
                    { value: 'udp', label: 'UDP' },
                    { value: 'icmp', label: 'ICMP' },
                    { value: 'any', label: 'ANY' },
                  ]}
                />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="vrf" label="VRF（可选）">
                <Input placeholder="例如：4001" />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="twiceNat" label="Twice NAT（可选）">
                <Input placeholder="例如：enable/disable" />
              </Form.Item>
            </Col>
          </Row>

          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="inside" label="内部地址" rules={[{ required: true, message: '请输入内部地址' }]}>
                <Input placeholder="例如：10.0.0.10" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item
                name="localPort"
                label="内部端口"
                rules={[{ required: true, message: '请输入内部端口' }]}
              >
                <InputNumber style={{ width: '100%' }} min={1} max={65535} placeholder="例如：80" />
              </Form.Item>
            </Col>
          </Row>

          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="outside" label="外部地址" rules={[{ required: true, message: '请输入外部地址' }]}>
                <Input placeholder="例如：203.0.113.10" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item
                name="externalPort"
                label="外部端口"
                rules={[{ required: true, message: '请输入外部端口' }]}
              >
                <InputNumber style={{ width: '100%' }} min={1} max={65535} placeholder="例如：8080" />
              </Form.Item>
            </Col>
          </Row>
        </Form>
        <div style={{ fontSize: 12, color: '#999' }}>
          说明：当前仅保存到平台 `vr-config`（`nat_address_group.static_mapping`），后续可在专家模式统一下发。
        </div>
      </Modal>
    </PageContainer>
  );
};

export default NATPage;
