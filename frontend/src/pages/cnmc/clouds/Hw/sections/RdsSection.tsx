import React, { useEffect, useMemo, useState } from 'react';
import { App, Button, Input, InputNumber, Select, Space, Table, Tag, Tooltip, Typography, Modal, Form, AutoComplete } from 'antd';
import { DatabaseOutlined, PlusOutlined, ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import PageDetailSection, { RowActionsButton } from '../../../../../components/PageDetailSection';
import { statusTag } from '../components/Common';
import {
  fetchHuaweiRds, fetchHuaweiRdsDatastores, fetchHuaweiRdsFlavors,
  createHuaweiRds, deleteHuaweiRds, restartHuaweiRds,
} from '../../../../../services/huaweiApi';

type Props = {
  cloudId: string;
  rds: any[];
  vpcs: any[];
  subnets: any[];
  secGroups: any[];
  onSetRds: (list: any[]) => void;
  onRefreshAll?: () => Promise<void> | void;
};

const engineOptions = [
  { label: 'MySQL', value: 'MySQL' },
  { label: 'PostgreSQL', value: 'PostgreSQL' },
  { label: 'SQLServer', value: 'SQLServer' },
];
const volumeTypeOptions = [
  { label: '超高IO (ULTRAHIGH)', value: 'ULTRAHIGH' },
  { label: '高IO (HIGH)', value: 'HIGH' },
  { label: '通用型SSD (CLOUDSSD)', value: 'CLOUDSSD' },
];

const parseRdsList = (json: any): any[] => (json?.data?.instances) || (json?.instances) || [];

const RdsSection: React.FC<Props> = ({ cloudId, rds, vpcs, subnets, secGroups, onSetRds, onRefreshAll }) => {
  const { message } = App.useApp();
  const [keyword, setKeyword] = useState<string>('');
  const [engineFilter, setEngineFilter] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState<boolean>(false);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [createOpen, setCreateOpen] = useState<boolean>(false);
  const [createForm] = Form.useForm();
  const [versions, setVersions] = useState<string[]>([]);
  const [flavors, setFlavors] = useState<any[]>([]);

  const refresh = async () => {
    if (!cloudId) return;
    setLoading(true);
    try { onSetRds(parseRdsList(await fetchHuaweiRds(cloudId))); }
    catch (e: any) { message.error(e?.message || '刷新失败'); }
    finally { setLoading(false); }
  };
  const reloadAfterWrite = async () => { await refresh(); if (onRefreshAll) await onRefreshAll(); };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (cloudId && (!rds || rds.length === 0)) refresh(); }, [cloudId]);

  const filtered = useMemo(() => {
    const list = Array.isArray(rds) ? rds : [];
    const kw = keyword.trim().toLowerCase();
    return list.filter((r: any) => {
      const text = `${r?.name || ''} ${r?.id || ''}`.toLowerCase();
      const okKw = !kw || text.includes(kw);
      const eng = String(r?.datastore?.type || '');
      const okEng = !engineFilter || eng === engineFilter;
      return okKw && okEng;
    });
  }, [rds, keyword, engineFilter]);

  const selectedEngine = Form.useWatch('engine', createForm);
  const selectedVersion = Form.useWatch('engineVersion', createForm);
  useEffect(() => {
    if (!createOpen || !selectedEngine) return;
    fetchHuaweiRdsDatastores(cloudId, selectedEngine).then((j: any) => {
      const ds = (j?.data?.dataStores) || (j?.dataStores) || [];
      setVersions(Array.from(new Set(ds.map((d: any) => d?.name).filter(Boolean))));
    }).catch(() => setVersions([]));
  }, [createOpen, selectedEngine, cloudId]);
  useEffect(() => {
    if (!createOpen || !selectedEngine || !selectedVersion) return;
    fetchHuaweiRdsFlavors(cloudId, selectedEngine, selectedVersion).then((j: any) => {
      setFlavors((j?.data?.flavors) || (j?.flavors) || []);
    }).catch(() => setFlavors([]));
  }, [createOpen, selectedEngine, selectedVersion, cloudId]);

  const vpcOptions = useMemo(() => (vpcs || []).map((v: any) => ({ label: v?.name || v?.id, value: v?.id })), [vpcs]);
  const selectedVpc = Form.useWatch('vpcId', createForm);
  const subnetOptions = useMemo(() => (subnets || []).filter((s: any) => !selectedVpc || String(s?.vpc_id || '') === String(selectedVpc)).map((s: any) => ({ label: `${s?.name || s?.id}（${s?.cidr || ''}）`, value: s?.id })), [subnets, selectedVpc]);
  const sgOptions = useMemo(() => (secGroups || []).map((g: any) => ({ label: g?.name || g?.id, value: g?.id })), [secGroups]);
  const versionOptions = useMemo(() => versions.map((v) => ({ label: v, value: v })), [versions]);
  const flavorOptions = useMemo(() => flavors.map((f: any) => ({ label: `${f?.spec_code}（${f?.vcpus}vCPU ${f?.ram}GB）`, value: f?.spec_code })), [flavors]);
  const azSuggestions = useMemo(() => {
    const set = new Set<string>();
    (subnets || []).forEach((s: any) => { const z = s?.availability_zone; if (z) set.add(z); });
    return Array.from(set).map((z) => ({ value: z }));
  }, [subnets]);

  const submitCreate = async () => {
    try {
      const v = await createForm.validateFields();
      setSubmitting(true);
      await createHuaweiRds(cloudId, {
        name: v.name, engine: v.engine, engineVersion: v.engineVersion, flavorRef: v.flavorRef,
        volumeType: v.volumeType, volumeSize: v.volumeSize, vpcId: v.vpcId, subnetId: v.subnetId,
        securityGroupId: v.securityGroupId, availabilityZone: v.availabilityZone, password: v.password, port: v.port,
      });
      message.success('创建数据库指令已下发'); setCreateOpen(false); await reloadAfterWrite();
    } catch (e: any) { if (e?.errorFields) return; message.error(e?.message || '创建失败'); }
    finally { setSubmitting(false); }
  };
  const handleRestart = (r: any) => { if (!r?.id) return; Modal.confirm({ title: '确定重启该数据库实例?', content: r?.name || r?.id, okText: '确认重启', cancelText: '取消', onOk: async () => { try { await restartHuaweiRds(cloudId, r.id); message.success('重启指令已下发'); await reloadAfterWrite(); } catch (e: any) { message.error(e?.message || '重启失败'); } } }); };
  const handleDelete = (r: any) => { if (!r?.id) return; Modal.confirm({ title: '确定删除该数据库实例?', content: `${r?.name || r?.id} 删除后不可恢复`, okText: '确认删除', okType: 'danger', cancelText: '取消', onOk: async () => { try { await deleteHuaweiRds(cloudId, r.id); message.success('删除成功'); await reloadAfterWrite(); } catch (e: any) { message.error(e?.message || '删除失败'); } } }); };

  const columns = useMemo(() => ([
    {
      title: '名称/ID', key: 'name_id', fixed: 'left' as const, width: 240,
      sorter: (a: any, b: any) => String(a?.name || '').localeCompare(String(b?.name || '')),
      render: (_: any, r: any) => {
        const name = r?.name || '-'; const id = r?.id || '-';
        return (
          <Space direction="vertical" size={0} style={{ width: '100%' }}>
            <Typography.Text strong ellipsis={{ tooltip: name }}>{name}</Typography.Text>
            <Typography.Text type="secondary" style={{ fontSize: 12 }} copyable={id !== '-' ? { text: id } : false}>{id}</Typography.Text>
          </Space>
        );
      },
    },
    { title: '引擎', key: 'engine', width: 160, render: (_: any, r: any) => { const e = r?.datastore?.type || '-'; const v = r?.datastore?.version; return <span>{e}{v ? ` ${v}` : ''}</span>; } },
    { title: '规格', key: 'flavor', width: 160, render: (_: any, r: any) => r?.flavor_ref || '-' },
    { title: '存储', key: 'vol', width: 130, render: (_: any, r: any) => { const vol = r?.volume; return vol ? `${vol.type || ''} ${vol.size != null ? `${vol.size}GB` : ''}`.trim() : '-'; } },
    { title: '类型', key: 'type', width: 100, render: (_: any, r: any) => { const t = r?.type; const map: any = { Single: '单机', Ha: '主备', Replica: '只读' }; return t ? <Tag>{map[t] || t}</Tag> : '-'; } },
    { title: '状态', key: 'status', width: 110, render: (_: any, r: any) => statusTag(r?.status) },
    {
      title: '操作', key: 'actions', fixed: 'right' as const, width: 80,
      render: (_: any, r: any) => (
        <RowActionsButton
          items={[{ key: 'detail', label: '详情' }, { key: 'restart', label: '重启' }, { key: 'del', label: '删除', danger: true }]}
          onClick={({ key }: { key: string }) => {
            if (key === 'detail') { Modal.info({ title: '数据库详情', width: 600, maskClosable: true, content: (<pre style={{ maxHeight: 400, overflow: 'auto', background: '#f5f5f5', padding: 10 }}>{JSON.stringify(r, null, 2)}</pre>) }); return; }
            if (key === 'restart') handleRestart(r);
            if (key === 'del') handleDelete(r);
          }}
        />
      ),
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ]), [cloudId]);

  const engineFilterOptions = useMemo(() => Array.from(new Set((rds || []).map((r: any) => String(r?.datastore?.type || '').trim()).filter(Boolean))).map(e => ({ label: e, value: e })), [rds]);

  return (
    <PageDetailSection
      title={Label}
      icon={Icon}
      toolbarLeft={(
        <>
          <Input className="toolbar-search" prefix={<SearchOutlined style={{ color: 'rgba(0,0,0,.45)' }} />} placeholder="名称 / ID" allowClear value={keyword} onChange={(e) => setKeyword(e.target.value)} />
          <Select className="toolbar-filter-sm" placeholder="引擎" allowClear value={engineFilter} onChange={setEngineFilter} options={engineFilterOptions} dropdownMatchSelectWidth={false} />
          <button type="button" className="toolbar-reset-btn" onClick={() => { setKeyword(''); setEngineFilter(undefined); }}>重置</button>
        </>
      )}
      toolbarRight={(
        <div className="toolbar-actions">
          <Button type="primary" icon={<PlusOutlined />} onClick={() => { createForm.resetFields(); createForm.setFieldsValue({ engine: 'MySQL', volumeType: 'CLOUDSSD', volumeSize: 40 }); setCreateOpen(true); }}>创建数据库</Button>
          <Tooltip title="刷新"><Button icon={<ReloadOutlined />} loading={loading} onClick={refresh} /></Tooltip>
        </div>
      )}
      asCard={false}
    >
      <Table className="std-table" bordered={false} rowKey={(r: any) => r?.id} dataSource={filtered} columns={columns as any} loading={loading} scroll={{ x: true }} pagination={{ size: 'small', showTotal: (total) => `共 ${total} 条` }} />

      <Modal title="创建云数据库 (RDS)" open={createOpen} onCancel={() => setCreateOpen(false)} onOk={submitCreate} confirmLoading={submitting} okText="创建" cancelText="取消" width={640} destroyOnHidden>
        <Form form={createForm} layout="vertical">
          <Form.Item name="name" label="实例名称" rules={[{ required: true, message: '请输入名称' }]}><Input placeholder="如 rds-mysql-01" allowClear /></Form.Item>
          <Form.Item name="engine" label="数据库引擎" rules={[{ required: true }]}><Select options={engineOptions} onChange={() => createForm.setFieldsValue({ engineVersion: undefined, flavorRef: undefined })} /></Form.Item>
          <Form.Item name="engineVersion" label="版本" rules={[{ required: true, message: '请选择版本' }]}><Select options={versionOptions} placeholder="请选择版本" onChange={() => createForm.setFieldsValue({ flavorRef: undefined })} /></Form.Item>
          <Form.Item name="flavorRef" label="规格" rules={[{ required: true, message: '请选择规格' }]}><Select showSearch optionFilterProp="label" options={flavorOptions} placeholder={flavorOptions.length ? '请选择规格' : '先选引擎与版本'} /></Form.Item>
          <Form.Item name="availabilityZone" label="可用区" rules={[{ required: true, message: '请输入可用区' }]}><AutoComplete options={azSuggestions} placeholder="如 cn-north-4a" allowClear filterOption={(val, o) => String(o?.value || '').includes(val)} /></Form.Item>
          <Form.Item name="volumeType" label="存储类型" rules={[{ required: true }]}><Select options={volumeTypeOptions} /></Form.Item>
          <Form.Item name="volumeSize" label="存储空间 (GB)" rules={[{ required: true }]}><InputNumber min={40} max={4000} style={{ width: '100%' }} /></Form.Item>
          <Form.Item name="vpcId" label="VPC" rules={[{ required: true, message: '请选择 VPC' }]}><Select showSearch optionFilterProp="label" options={vpcOptions} onChange={() => createForm.setFieldsValue({ subnetId: undefined })} /></Form.Item>
          <Form.Item name="subnetId" label="子网" rules={[{ required: true, message: '请选择子网' }]}><Select showSearch optionFilterProp="label" options={subnetOptions} /></Form.Item>
          <Form.Item name="securityGroupId" label="安全组" rules={[{ required: true, message: '请选择安全组' }]}><Select showSearch optionFilterProp="label" options={sgOptions} /></Form.Item>
          <Form.Item name="password" label="管理员密码" rules={[{ required: true, message: '请输入密码' }, { min: 8, message: '至少 8 位' }]}><Input.Password placeholder="含大小写字母、数字、特殊字符" /></Form.Item>
          <Form.Item name="port" label="端口（选填）"><InputNumber min={1024} max={65535} style={{ width: '100%' }} /></Form.Item>
        </Form>
      </Modal>
    </PageDetailSection>
  );
};

export const Icon = <DatabaseOutlined />;
export const Label = '云数据库';
export default RdsSection;
