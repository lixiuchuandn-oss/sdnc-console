import React, { useEffect, useMemo, useState } from 'react';
import { App, Button, Input, InputNumber, Select, Space, Table, Tag, Tooltip, Typography, Modal, Form, Switch } from 'antd';
import { AlertOutlined, PlusOutlined, ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import PageDetailSection, { RowActionsButton } from '../../../../../components/PageDetailSection';
import { fetchHuaweiAlarms, createHuaweiAlarm, deleteHuaweiAlarm, setHuaweiAlarmAction } from '../../../../../services/huaweiApi';

type Props = {
  cloudId: string;
  ecs?: any[];
};

const ensureArr = <T,>(v: T | T[] | undefined | null): T[] => (Array.isArray(v) ? v : v == null ? [] : [v]);

const namespacePresets = [
  { label: 'ECS 云服务器', value: 'SYS.ECS', dimName: 'instance_id', metrics: [{ label: 'CPU 使用率', value: 'cpu_util' }, { label: '内存使用率', value: 'mem_util' }, { label: '磁盘读带宽', value: 'disk_read_bytes_rate' }] },
  { label: 'RDS 云数据库', value: 'SYS.RDS', dimName: 'rds_cluster_id', metrics: [{ label: 'CPU 使用率', value: 'rds001_cpu_util' }, { label: '内存使用率', value: 'rds002_mem_util' }, { label: '磁盘使用率', value: 'rds039_disk_util' }] },
  { label: 'EVS 云硬盘', value: 'SYS.EVS', dimName: 'disk_name', metrics: [{ label: '读带宽', value: 'disk_device_read_bytes_rate' }, { label: '写带宽', value: 'disk_device_write_bytes_rate' }] },
];
const comparisonOptions = [{ label: '>', value: '>' }, { label: '≥', value: '>=' }, { label: '<', value: '<' }, { label: '≤', value: '<=' }, { label: '=', value: '=' }];

const parseAlarmList = (json: any): any[] => (json?.data?.metric_alarms) || (json?.metric_alarms) || (json?.data?.alarms) || (json?.alarms) || [];

const MonitorAlarmSection: React.FC<Props> = ({ cloudId, ecs }) => {
  const { message } = App.useApp();
  const [keyword, setKeyword] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [alarms, setAlarms] = useState<any[]>([]);
  const [createOpen, setCreateOpen] = useState<boolean>(false);
  const [createForm] = Form.useForm();

  const refresh = async () => {
    if (!cloudId) return;
    setLoading(true);
    try { setAlarms(ensureArr(parseAlarmList(await fetchHuaweiAlarms(cloudId)))); }
    catch (e: any) { message.error(e?.message || '刷新失败'); }
    finally { setLoading(false); }
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (cloudId) refresh(); }, [cloudId]);

  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    return alarms.filter((r: any) => !kw || `${r?.alarm_name || ''} ${r?.alarm_id || ''} ${r?.metric?.metric_name || ''}`.toLowerCase().includes(kw));
  }, [alarms, keyword]);

  const selectedNs = Form.useWatch('namespace', createForm);
  const preset = useMemo(() => namespacePresets.find((n) => n.value === selectedNs), [selectedNs]);
  const metricOptions = useMemo(() => preset?.metrics || [], [preset]);
  const ecsOptions = useMemo(() => (Array.isArray(ecs) ? ecs : []).map((i: any) => ({ label: `${i?.name || i?.id}`, value: i?.id })), [ecs]);

  const submitCreate = async () => {
    try {
      const v = await createForm.validateFields();
      setSubmitting(true);
      await createHuaweiAlarm(cloudId, {
        alarmName: v.alarmName, namespace: v.namespace, metricName: v.metricName,
        instanceId: v.instanceId, dimensionName: preset?.dimName,
        period: v.period, filter: v.filter, comparisonOperator: v.comparisonOperator, threshold: v.threshold, count: v.count,
      });
      message.success('告警规则已创建'); setCreateOpen(false); await refresh();
    } catch (e: any) { if (e?.errorFields) return; message.error(e?.message || '创建失败'); }
    finally { setSubmitting(false); }
  };
  const toggleAlarm = async (r: any, enabled: boolean) => {
    try { await setHuaweiAlarmAction(cloudId, r?.alarm_id, enabled); message.success('操作成功'); await refresh(); }
    catch (e: any) { message.error(e?.message || '操作失败'); }
  };
  const handleDelete = (r: any) => {
    if (!r?.alarm_id) return;
    Modal.confirm({ title: '删除告警规则?', content: r?.alarm_name || r?.alarm_id, okText: '确认删除', okType: 'danger', cancelText: '取消',
      onOk: async () => { try { await deleteHuaweiAlarm(cloudId, r.alarm_id); message.success('删除成功'); await refresh(); } catch (e: any) { message.error(e?.message || '删除失败'); } } });
  };

  const columns = useMemo(() => ([
    {
      title: '规则名称/ID', key: 'name_id', fixed: 'left' as const, width: 240,
      render: (_: any, r: any) => {
        const name = r?.alarm_name || '-'; const id = r?.alarm_id || '-';
        return (
          <Space direction="vertical" size={0} style={{ width: '100%' }}>
            <Typography.Text strong ellipsis={{ tooltip: name }}>{name}</Typography.Text>
            <Typography.Text type="secondary" style={{ fontSize: 12 }} copyable={id !== '-' ? { text: id } : false}>{id}</Typography.Text>
          </Space>
        );
      },
    },
    { title: '命名空间', key: 'ns', width: 130, render: (_: any, r: any) => r?.metric?.namespace || '-' },
    { title: '指标', key: 'metric', width: 180, render: (_: any, r: any) => r?.metric?.metric_name || '-' },
    {
      title: '阈值条件', key: 'cond', width: 160,
      render: (_: any, r: any) => { const c = r?.condition; return c ? `${c.comparison_operator} ${c.value}${c.unit || ''}（${c.count}次）` : '-'; },
    },
    { title: '启用', key: 'enabled', width: 90, render: (_: any, r: any) => <Switch size="small" checked={r?.alarm_enabled !== false} onChange={(v) => toggleAlarm(r, v)} /> },
    { title: '状态', key: 'state', width: 110, render: (_: any, r: any) => { const s = r?.alarm_state; return s ? <Tag color={String(s).toUpperCase() === 'OK' ? 'green' : String(s).toUpperCase() === 'ALARM' ? 'red' : 'default'}>{s}</Tag> : '-'; } },
    {
      title: '操作', key: 'actions', fixed: 'right' as const, width: 70,
      render: (_: any, r: any) => (<RowActionsButton items={[{ key: 'del', label: '删除', danger: true }]} onClick={({ key }: { key: string }) => { if (key === 'del') handleDelete(r); }} />),
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ]), [cloudId]);

  return (
    <PageDetailSection
      title={Label}
      icon={Icon}
      toolbarLeft={(
        <>
          <Input className="toolbar-search" prefix={<SearchOutlined style={{ color: 'rgba(0,0,0,.45)' }} />} placeholder="名称 / ID / 指标" allowClear value={keyword} onChange={(e) => setKeyword(e.target.value)} />
          <button type="button" className="toolbar-reset-btn" onClick={() => setKeyword('')}>重置</button>
        </>
      )}
      toolbarRight={(
        <div className="toolbar-actions">
          <Button type="primary" icon={<PlusOutlined />} onClick={() => { createForm.resetFields(); createForm.setFieldsValue({ namespace: 'SYS.ECS', metricName: 'cpu_util', period: 300, filter: 'average', comparisonOperator: '>', threshold: 80, count: 3 }); setCreateOpen(true); }}>创建告警规则</Button>
          <Tooltip title="刷新"><Button icon={<ReloadOutlined />} loading={loading} onClick={refresh} /></Tooltip>
        </div>
      )}
      asCard={false}
    >
      <Typography.Paragraph type="secondary" style={{ marginBottom: 8 }}>展示云监控（CES）告警规则，支持创建/启停/删除。</Typography.Paragraph>
      <Table className="std-table" bordered={false} rowKey={(r: any) => r?.alarm_id} dataSource={filtered} columns={columns as any} loading={loading} scroll={{ x: true }} pagination={{ size: 'small', showTotal: (total) => `共 ${total} 条` }} />

      <Modal title="创建告警规则" open={createOpen} onCancel={() => setCreateOpen(false)} onOk={submitCreate} confirmLoading={submitting} okText="创建" cancelText="取消" width={600} destroyOnHidden>
        <Form form={createForm} layout="vertical">
          <Form.Item name="alarmName" label="规则名称" rules={[{ required: true, message: '请输入规则名称' }]}><Input placeholder="如 ECS-CPU-高负载" allowClear /></Form.Item>
          <Form.Item name="namespace" label="产品" rules={[{ required: true }]}><Select options={namespacePresets.map((n) => ({ label: n.label, value: n.value }))} onChange={() => createForm.setFieldsValue({ metricName: undefined })} /></Form.Item>
          <Form.Item name="metricName" label="监控项" rules={[{ required: true, message: '请选择监控项' }]}><Select options={metricOptions} placeholder="请选择监控项" /></Form.Item>
          <Form.Item name="instanceId" label="监控实例（ECS，可选）"><Select showSearch optionFilterProp="label" options={ecsOptions} placeholder="留空表示该产品全局" allowClear /></Form.Item>
          <Space style={{ display: 'flex' }} align="baseline">
            <Form.Item name="filter" label="统计方式" rules={[{ required: true }]}><Select style={{ width: 110 }} options={[{ label: '平均值', value: 'average' }, { label: '最大值', value: 'max' }, { label: '最小值', value: 'min' }, { label: '求和', value: 'sum' }]} /></Form.Item>
            <Form.Item name="comparisonOperator" label="比较" rules={[{ required: true }]}><Select style={{ width: 90 }} options={comparisonOptions} /></Form.Item>
            <Form.Item name="threshold" label="阈值" rules={[{ required: true }]}><InputNumber min={0} style={{ width: 100 }} /></Form.Item>
            <Form.Item name="count" label="连续次数" rules={[{ required: true }]}><InputNumber min={1} max={5} style={{ width: 90 }} /></Form.Item>
          </Space>
          <Form.Item name="period" label="监控周期(秒)" rules={[{ required: true }]}><Select options={[1, 300, 1200, 3600, 14400, 86400].map((p) => ({ label: `${p}s`, value: p }))} /></Form.Item>
        </Form>
      </Modal>
    </PageDetailSection>
  );
};

export const Icon = <AlertOutlined />;
export const Label = '监控告警';
export default MonitorAlarmSection;
