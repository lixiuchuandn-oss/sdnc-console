import React, { useMemo, useState } from 'react';
import { App, Button, Input, Select, Table, Space, Tooltip, Typography, Tag, Modal, Form, InputNumber, AutoComplete } from 'antd';
import { DatabaseOutlined, PlusOutlined, ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import PageDetailSection, { RowActionsButton } from '../../../../../components/PageDetailSection';
import { statusTag } from '../../Hw/components/Common';
import RdsDetailDrawerAliyun from '../drawers/RdsDetailDrawerAliyun';
import {
  fetchCloudProviderRds,
  createCloudProviderRds,
  deleteCloudProviderRds,
  restartCloudProviderRds,
} from '../../../../../services/aliyunApi';

type Props = {
  cloudId: string;
  rds: any[];
  vpcs: any[];
  vswitches: any[];
  onSetRds: (list: any[]) => void;
  onRefreshAll?: () => Promise<void> | void;
};

const engineOptions = [
  { label: 'MySQL', value: 'MySQL' },
  { label: 'PostgreSQL', value: 'PostgreSQL' },
  { label: 'SQLServer', value: 'SQLServer' },
  { label: 'MariaDB', value: 'MariaDB' },
];
const engineVersionMap: Record<string, string[]> = {
  MySQL: ['8.0', '5.7', '5.6'],
  PostgreSQL: ['15.0', '14.0', '13.0'],
  SQLServer: ['2019_std', '2017_std'],
  MariaDB: ['10.3'],
};

const parseRdsList = (json: any): any[] =>
  (json?.data?.Items?.DBInstance) || (json?.Items?.DBInstance) || (json?.data?.items) || (json?.items) || [];

const RdsSectionAliyun: React.FC<Props> = ({ cloudId, rds, vpcs, vswitches, onSetRds, onRefreshAll }) => {
  const { message } = App.useApp();
  const [keyword, setKeyword] = useState<string>('');
  const [engineFilter, setEngineFilter] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState<boolean>(false);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [createOpen, setCreateOpen] = useState<boolean>(false);
  const [createForm] = Form.useForm();
  const [drawerRds, setDrawerRds] = useState<any | null>(null);

  const refresh = async () => {
    if (!cloudId) return;
    setLoading(true);
    try {
      const json = await fetchCloudProviderRds(cloudId);
      onSetRds(parseRdsList(json));
    } catch (e: any) { message.error(e?.message || '刷新失败'); }
    finally { setLoading(false); }
  };

  const reloadAfterWrite = async () => {
    await refresh();
    if (onRefreshAll) await onRefreshAll();
  };

  const filtered = useMemo(() => {
    const list = Array.isArray(rds) ? rds : [];
    const kw = keyword.trim().toLowerCase();
    return list.filter((r: any) => {
      const text = `${r?.DBInstanceDescription || ''} ${r?.DBInstanceId || ''} ${r?.ConnectionString || ''}`.toLowerCase();
      const okKw = !kw || text.includes(kw);
      const eng = String(r?.Engine || '');
      const okEng = !engineFilter || eng === engineFilter;
      return okKw && okEng;
    });
  }, [rds, keyword, engineFilter]);

  const submitCreate = async () => {
    try {
      const v = await createForm.validateFields();
      setSubmitting(true);
      await createCloudProviderRds(cloudId, {
        engine: v.engine,
        engineVersion: v.engineVersion,
        dbInstanceClass: v.dbInstanceClass,
        dbInstanceStorage: v.dbInstanceStorage,
        payType: 'Postpaid',
        dbInstanceNetType: 'Intranet',
        instanceNetwork: v.vpcId ? 'VPC' : 'Classic',
        vpcId: v.vpcId,
        vSwitchId: v.vSwitchId,
        zoneId: v.zoneId,
        securityIPList: v.securityIPList || '127.0.0.1',
        dbInstanceDescription: v.dbInstanceDescription,
      });
      message.success('创建数据库指令已下发');
      setCreateOpen(false);
      await reloadAfterWrite();
    } catch (e: any) {
      if (e?.errorFields) return;
      message.error(e?.message || '创建失败');
    } finally { setSubmitting(false); }
  };

  const handleRestart = (r: any) => {
    const idv = r?.DBInstanceId;
    if (!idv) return;
    Modal.confirm({
      title: '确定重启该数据库实例?', content: idv, okText: '确认重启', cancelText: '取消',
      onOk: async () => { try { await restartCloudProviderRds(cloudId, idv); message.success('重启指令已下发'); await reloadAfterWrite(); } catch (e: any) { message.error(e?.message || '重启失败'); } },
    });
  };
  const handleDelete = (r: any) => {
    const idv = r?.DBInstanceId;
    if (!idv) return;
    Modal.confirm({
      title: '确定删除该数据库实例?', content: `${idv} 删除后不可恢复`, okText: '确认删除', okType: 'danger', cancelText: '取消',
      onOk: async () => { try { await deleteCloudProviderRds(cloudId, idv); message.success('删除成功'); await reloadAfterWrite(); } catch (e: any) { message.error(e?.message || '删除失败'); } },
    });
  };

  const vpcOptions = useMemo(() => (vpcs || []).map((v: any) => ({ label: `${v.VpcName || v.name || v.VpcId || v.id}（${v.VpcId || v.id}）`, value: v.VpcId || v.id })), [vpcs]);
  const selectedVpc = Form.useWatch('vpcId', createForm);
  const vswOptions = useMemo(() => (vswitches || []).filter((s: any) => !selectedVpc || String(s?.VpcId || s?.vpc_id || '') === String(selectedVpc)).map((s: any) => ({ label: `${s?.VSwitchName || s?.VSwitchId}（${s?.ZoneId || ''}）`, value: s?.VSwitchId || s?.id })), [vswitches, selectedVpc]);
  const selectedEngine = Form.useWatch('engine', createForm);
  const versionOptions = useMemo(() => (engineVersionMap[selectedEngine] || []).map((v) => ({ label: v, value: v })), [selectedEngine]);

  const columns = useMemo(() => ([
    {
      title: '实例描述/ID', key: 'name_id', fixed: 'left' as const, width: 240,
      sorter: (a: any, b: any) => String(a?.DBInstanceDescription || '').localeCompare(String(b?.DBInstanceDescription || '')),
      render: (_: any, r: any) => {
        const name = r?.DBInstanceDescription || r?.DBInstanceId || '-';
        const idv = r?.DBInstanceId || '-';
        return (
          <Space direction="vertical" size={0} style={{ width: '100%' }}>
            <Typography.Text strong ellipsis={{ tooltip: name }}>{name}</Typography.Text>
            <Typography.Text type="secondary" style={{ fontSize: 12 }} copyable={idv !== '-' ? { text: idv } : false}>{idv}</Typography.Text>
          </Space>
        );
      },
    },
    {
      title: '引擎', key: 'engine', width: 160,
      render: (_: any, r: any) => {
        const eng = r?.Engine || '-';
        const ver = r?.EngineVersion;
        return <span>{eng}{ver ? ` ${ver}` : ''}</span>;
      },
    },
    { title: '规格', key: 'class', width: 160, render: (_: any, r: any) => r?.DBInstanceClass || '-' },
    {
      title: '类型', key: 'type', width: 100,
      render: (_: any, r: any) => {
        const t = r?.DBInstanceType;
        const map: Record<string, string> = { Primary: '主实例', Readonly: '只读', Guard: '灾备', Temp: '临时' };
        return t ? <Tag>{map[t] || t}</Tag> : '-';
      },
    },
    { title: '网络', key: 'net', width: 120, render: (_: any, r: any) => r?.InstanceNetworkType || r?.DBInstanceNetType || '-' },
    { title: '状态', key: 'status', width: 110, render: (_: any, r: any) => statusTag(r?.DBInstanceStatus || r?.status) },
    {
      title: '创建时间', key: 'ctime', width: 170,
      render: (_: any, r: any) => {
        const t = r?.CreateTime;
        if (!t) return '-';
        try { return new Date(t).toLocaleString('zh-CN', { hour12: false }); } catch { return t; }
      },
    },
    {
      title: '操作', key: 'actions', fixed: 'right' as const, width: 80,
      render: (_: any, r: any) => (
        <RowActionsButton
          items={[
            { key: 'manage', label: '管理(账号/库/白名单/备份)' },
            { key: 'detail', label: '详情(JSON)' },
            { key: 'restart', label: '重启' },
            { key: 'del', label: '删除', danger: true },
          ]}
          onClick={({ key }: { key: string }) => {
            if (key === 'manage') { setDrawerRds(r); return; }
            if (key === 'detail') { Modal.info({ title: '数据库详情', width: 600, maskClosable: true, content: (<pre style={{ maxHeight: 400, overflow: 'auto', background: '#f5f5f5', padding: 10 }}>{JSON.stringify(r, null, 2)}</pre>) }); return; }
            if (key === 'restart') handleRestart(r);
            if (key === 'del') handleDelete(r);
          }}
        />
      ),
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ]), [cloudId]);

  const engineFilterOptions = useMemo(() => Array.from(new Set((rds || []).map((r: any) => String(r?.Engine || '').trim()).filter(Boolean))).map(e => ({ label: e, value: e })), [rds]);

  return (
    <PageDetailSection
      title={Label}
      icon={Icon}
      toolbarLeft={(
        <>
          <Input className="toolbar-search" prefix={<SearchOutlined style={{ color: 'rgba(0,0,0,.45)' }} />} placeholder="描述 / ID / 连接地址" allowClear value={keyword} onChange={(e) => setKeyword(e.target.value)} />
          <Select className="toolbar-filter-sm" placeholder="引擎" allowClear value={engineFilter} onChange={setEngineFilter} options={engineFilterOptions} dropdownMatchSelectWidth={false} />
          <button type="button" className="toolbar-reset-btn" onClick={() => { setKeyword(''); setEngineFilter(undefined); }}>重置</button>
        </>
      )}
      toolbarRight={(
        <div className="toolbar-actions">
          <Button type="primary" icon={<PlusOutlined />} onClick={() => { createForm.resetFields(); createForm.setFieldsValue({ engine: 'MySQL', engineVersion: '8.0', dbInstanceStorage: 20 }); setCreateOpen(true); }}>创建数据库</Button>
          <Tooltip title="刷新"><Button icon={<ReloadOutlined />} loading={loading} onClick={refresh} /></Tooltip>
        </div>
      )}
      asCard={false}
    >
      <Table
        className="std-table"
        bordered={false}
        rowKey={(r: any) => r?.DBInstanceId}
        dataSource={filtered}
        columns={columns as any}
        loading={loading}
        scroll={{ x: true }}
        pagination={{ size: 'small', showTotal: (total) => `共 ${total} 条` }}
      />

      <Modal title="创建云数据库 (RDS)" open={createOpen} onCancel={() => setCreateOpen(false)} onOk={submitCreate} confirmLoading={submitting} okText="创建" cancelText="取消" width={620} destroyOnClose>
        <Form form={createForm} layout="vertical">
          <Form.Item name="engine" label="数据库引擎" rules={[{ required: true }]}>
            <Select options={engineOptions} onChange={() => createForm.setFieldsValue({ engineVersion: undefined })} />
          </Form.Item>
          <Form.Item name="engineVersion" label="版本" rules={[{ required: true, message: '请选择版本' }]}>
            <Select options={versionOptions} placeholder="请选择版本" />
          </Form.Item>
          <Form.Item name="dbInstanceClass" label="实例规格" rules={[{ required: true, message: '请输入实例规格' }]} extra="如 mysql.n2.medium.1 / rds.mysql.s2.large">
            <Input placeholder="如 mysql.n2.medium.1" allowClear />
          </Form.Item>
          <Form.Item name="dbInstanceStorage" label="存储空间 (GB)" rules={[{ required: true }]}>
            <InputNumber min={5} max={6000} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="vpcId" label="专有网络 VPC">
            <Select showSearch optionFilterProp="label" placeholder="选填，选则为 VPC 网络" options={vpcOptions} allowClear onChange={() => createForm.setFieldsValue({ vSwitchId: undefined })} />
          </Form.Item>
          <Form.Item name="vSwitchId" label="交换机">
            <Select showSearch optionFilterProp="label" placeholder="选择 VPC 后可选" options={vswOptions} allowClear />
          </Form.Item>
          <Form.Item name="zoneId" label="可用区">
            <AutoComplete options={(vswitches || []).map((s: any) => ({ value: s?.ZoneId })).filter((o: any) => o.value)} placeholder="如 cn-hangzhou-i" allowClear />
          </Form.Item>
          <Form.Item name="securityIPList" label="白名单 IP" extra="逗号分隔，默认 127.0.0.1">
            <Input placeholder="如 10.0.0.0/8,192.168.0.0/16" allowClear />
          </Form.Item>
          <Form.Item name="dbInstanceDescription" label="实例描述"><Input placeholder="选填" maxLength={256} allowClear /></Form.Item>
        </Form>
      </Modal>

      <RdsDetailDrawerAliyun open={!!drawerRds} cloudId={cloudId} rds={drawerRds} onClose={() => setDrawerRds(null)} />
    </PageDetailSection>
  );
};

export const Icon = <DatabaseOutlined />;
export const Label = '云数据库';
export default RdsSectionAliyun;
