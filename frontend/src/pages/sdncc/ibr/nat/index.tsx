import React, { useEffect, useMemo, useState } from 'react';

import { Form, Input, InputNumber, Modal, Select, Tag, message, Space, Row, Col, Typography } from 'antd';

import PageContainer from '../../../../components/PageContainer';

import ResourceActionsDropdown from '../../../../components/ResourceActionsDropdown';

import type { ColumnsType } from 'antd/es/table';

import {
  createNATStaticMapping,
  deleteNATStaticMapping,
  getNATStaticMappings,
  type NATStaticMappingRow,
} from '../../../../services/virtualRouterApi';

import {

  loadIbrVrCatalog,

  syncAndLoadIbrVrCatalog,

} from '../lib/ibrVrCatalog';

import { runIbrDeployPushInteractive, DeployDriftCancelledError } from '../lib/vrConfigDeployFlow';

import { useAuth } from '../../../../contexts/AuthContext';

import { hasPermissionForAction } from '../../../../utils/accessMapping';

import type { IbrSectionEmbedProps } from '../lib/embedProps';



const { Option } = Select;

const { Text } = Typography;



const NATPage: React.FC<IbrSectionEmbedProps> = ({ embedded = false, scopedVrUuid }) => {

  const { user } = useAuth();

  const perms = Array.isArray(user?.permissions) ? user?.permissions ?? [] : [];

  const canWrite =

    user?.role === 'super_admin' || hasPermissionForAction(perms, 'networks.nat:write');

  const scopedVr = String(scopedVrUuid || '').trim();

  const [data, setData] = useState<NATStaticMappingRow[]>([]);

  const [loading, setLoading] = useState<boolean>(false);

  const [vrList, setVrList] = useState<any[]>([]);

  const [vrNameMap, setVrNameMap] = useState<Record<string, string>>({});

  const [keyword, setKeyword] = useState<string>('');

  const [vrFilter, setVrFilter] = useState<string | undefined>();

  const [filterForm] = Form.useForm();

  const [createOpen, setCreateOpen] = useState(false);

  const [createSubmitting, setCreateSubmitting] = useState(false);

  const [createForm] = Form.useForm();



  const fetchData = async (force?: boolean) => {

    setLoading(true);

    try {

      const { vrs, nameMap } = force

        ? await syncAndLoadIbrVrCatalog()

        : await loadIbrVrCatalog();

      setVrList(vrs);

      setVrNameMap(nameMap);



      const list = (await getNATStaticMappings(scopedVr || undefined, { skipCache: !!force })) as NATStaticMappingRow[];

      setData(Array.isArray(list) ? list : []);

    } catch (e: unknown) {

      console.error(e);

      const msg = e instanceof Error ? e.message : String(e);

      message.error('加载 NAT 规则列表失败: ' + msg);

    } finally {

      setLoading(false);

    }

  };



  useEffect(() => {

    void fetchData();

  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- mount-only initial load



  useEffect(() => {

    if (!scopedVr) return;

    setVrFilter(scopedVr);

    filterForm.setFieldsValue({ vrId: scopedVr });

  }, [scopedVr, filterForm]);



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

      if (!vrId) throw new Error('请选择 IBR');



      setCreateSubmitting(true);



      await createNATStaticMapping({

        vrId,

        groupId: Number(values.groupId),

        range: String(values.range || '').trim() || undefined,

        proto: String(values.proto || 'tcp').trim(),

        inside: String(values.inside || '').trim(),

        localPort: Number(values.localPort),

        outside: String(values.outside || '').trim(),

        externalPort: Number(values.externalPort),

        vrf: String(values.vrf || '').trim() || undefined,

        twiceNat: String(values.twiceNat || '').trim() || undefined,

      });



      message.success('NAT 规则已保存到平台（未下发）');

      setCreateOpen(false);

      createForm.resetFields();

      void fetchData(true);

    } catch (e: any) {

      if (e?.errorFields) return;

      message.error(e?.message || '创建失败');

    } finally {

      setCreateSubmitting(false);

    }

  };



  const handleDelete = (row: NATStaticMappingRow) => {

    Modal.confirm({

      title: '确认删除',

      content: '删除后仅从平台移除，需重新下发才会同步到设备。',

      okText: '删除',

      okButtonProps: { danger: true },

      cancelText: '取消',

      onOk: async () => {

        try {

          await deleteNATStaticMapping(row.id);

          message.success('已删除');

          void fetchData(true);

        } catch (e: unknown) {

          const msg = e instanceof Error ? e.message : String(e);

          message.error('删除失败: ' + msg);

        }

      },

    });

  };



  const handleDeploy = (vrId: string) => {

    if (!vrId) {

      message.error('未关联 IBR，无法下发');

      return;

    }

    const hide = message.loading('正在准备下发...', 0);

    runIbrDeployPushInteractive({ vrId, feature: 'nat' })

      .then((res) => {

        hide();

        Modal.success({

          title: '下发成功',

          content: (

            <div style={{ maxHeight: 400, overflow: 'auto' }}>

              <pre>{JSON.stringify((res as { data?: unknown })?.data ?? res, null, 2)}</pre>

            </div>

          ),

          width: 600,

        });

      })

      .catch((e: unknown) => {

        hide();

        if (e instanceof DeployDriftCancelledError) {

          message.info('已取消下发');

          return;

        }

        const msg = e instanceof Error ? e.message : String(e);

        Modal.error({ title: '下发失败', content: msg });

      });

  };



  const fullColumns: ColumnsType<NATStaticMappingRow> = [

    {

      title: '地址池',

      dataIndex: 'groupId',

      key: 'groupId',

      fixed: 'left',

      render: (text, record) => (

        <Space direction="vertical" size={0}>

          <Text strong>{String(text ?? '-')}</Text>

          <Text type="secondary" style={{ fontSize: 12 }}>{record.rangeText || '-'}</Text>

        </Space>

      ),

    },

    {

      title: 'IBR实例',

      dataIndex: 'vrId',

      key: 'vrId',

      render: (id) => vrNameMap[id] || id,

    },

    {

      title: '类型',

      dataIndex: 'type',

      key: 'type',

      render: () => <Tag color="orange">STATIC</Tag>,

    },

    {

      title: '协议',

      dataIndex: 'proto',

      key: 'proto',

      render: (text) => text || '-',

    },

    {

      title: '内部地址/端口',

      key: 'inside',

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

      render: (t) => (t !== undefined && t !== null && String(t).trim() !== '' ? String(t) : '-'),

    },

    {

      title: 'Twice NAT',

      dataIndex: 'twiceNat',

      key: 'twiceNat',

      render: (t) => t || '-',

    },

    ...(canWrite
      ? [
          {
            title: '操作',
            key: 'actions',
            fixed: 'right' as const,
            render: (_: unknown, r: NATStaticMappingRow) => (
              <ResourceActionsDropdown
                items={[
                  { key: 'deploy', label: '下发配置', disabled: !r.vrId },
                  { key: 'delete', label: '删除', danger: true },
                ]}
                onClick={({ key }) => {
                  if (key === 'deploy' && r.vrId) handleDeploy(r.vrId);
                  if (key === 'delete') handleDelete(r);
                }}
                buttonProps={{ className: 'row-actions-trigger', style: { margin: 0 } }}
              />
            ),
          },
        ]
      : []),
  ];



  const filteredData = data.filter((r) => {

    if (scopedVr && r.vrId !== scopedVr) return false;

    if (keyword) {

      const kw = keyword.toLowerCase();

      const hay = [

        r.groupId,

        r.rangeText,

        r.inside,

        r.outside,

        r.proto,

        r.twiceNat,

      ].map((x) => String(x ?? '').toLowerCase()).join(' ');

      if (!hay.includes(kw)) return false;

    }

    if (vrFilter && r.vrId !== vrFilter) return false;

    return true;

  });



  const resetFilters = () => {

    filterForm.resetFields();

    setKeyword('');

    setVrFilter(undefined);

  };



  return (

    <PageContainer

      titleLevel={3}

      asCard={false}

      hideHeader={embedded}

      pagePadding={embedded ? 0 : undefined}

      primaryAction={
        canWrite
          ? {
              text: '创建 NAT',
              onClick: () => {
                createForm.resetFields();
                if (scopedVr) {
                  createForm.setFieldsValue({ vrId: scopedVr });
                }
                setCreateOpen(true);
              },
              type: 'primary' as const,
            }
          : undefined
      }

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

          }}

        >

          <Form.Item name="keyword" style={{ marginBottom: 0 }}>

            <Input allowClear placeholder="搜索" className="toolbar-search" />

          </Form.Item>

          {!scopedVr && (

            <Form.Item name="vrId" style={{ marginBottom: 0 }}>

              <Select allowClear placeholder="所属 IBR" className="toolbar-filter">

                {vrList.map((v) => (

                  <Option key={v.uuid} value={v.uuid}>

                    {v.name}

                  </Option>

                ))}

              </Select>

            </Form.Item>

          )}

          <button type="button" className="toolbar-reset-btn" onClick={resetFilters}>

            重置

          </button>

        </Form>

      )}

      tableProps={{

        dataSource: filteredData,

        columns: fullColumns,

        rowKey: 'id',

        loading: loading,

        pagination: {

          size: 'small',

          showTotal: (total) => `共 ${total} 条`,

        },

        scroll: { x: true },

        bordered: false,

        className: 'std-table',

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

              <Form.Item name="vrId" label="所属 IBR" rules={[{ required: true, message: '请选择 IBR' }]}>

                <Select

                  showSearch

                  optionFilterProp="label"

                  options={vrOptions}

                  placeholder="选择 IBR"

                  disabled={!!scopedVr}

                />

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

          说明：保存后写入平台库并同步 vr_config；在列表行操作点击「下发配置」后才会 POST 到设备（含漂移检测）。

        </div>

      </Modal>

    </PageContainer>

  );

};



export default NATPage;


