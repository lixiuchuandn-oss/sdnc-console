import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { App, Button, Table, Space, Tabs, Tag, Tooltip, Typography, Modal, Form, Input, Select, InputNumber } from 'antd';
import { AlertOutlined, ReloadOutlined, PlusOutlined } from '@ant-design/icons';
import PageDetailSection, { RowActionsButton } from '../../../../../components/PageDetailSection';
import {
  fetchCloudProviderAlarmLogs,
  fetchCloudProviderAlarmRules,
  createCloudProviderAlarmRule,
  deleteCloudProviderAlarmRule,
} from '../../../../../services/aliyunApi';

type Props = {
  cloudId: string;
  ecs?: any[];
};

const ensureArr = <T,>(v: T | T[] | undefined | null): T[] => (Array.isArray(v) ? v : v == null ? [] : [v]);

const namespacePresets = [
  { label: 'ECS 云服务器', value: 'acs_ecs_dashboard', metrics: [{ label: 'CPU 使用率', value: 'CPUUtilization' }, { label: '内存使用率', value: 'memory_usedutilization' }, { label: '磁盘使用率', value: 'diskusage_utilization' }] },
  { label: 'RDS 云数据库', value: 'acs_rds_dashboard', metrics: [{ label: 'CPU 使用率', value: 'CpuUsage' }, { label: '内存使用率', value: 'MemoryUsage' }, { label: '磁盘使用率', value: 'DiskUsage' }, { label: '连接数使用率', value: 'ConnectionUsage' }] },
  { label: 'SLB 负载均衡', value: 'acs_slb_dashboard', metrics: [{ label: '活跃连接数', value: 'ActiveConnection' }, { label: '流入带宽', value: 'TrafficRXNew' }] },
];
const comparisonOptions = [
  { label: '>', value: 'GreaterThanThreshold' },
  { label: '≥', value: 'GreaterThanOrEqualToThreshold' },
  { label: '<', value: 'LessThanThreshold' },
  { label: '≤', value: 'LessThanOrEqualToThreshold' },
];

const MonitorAlarmSectionAliyun: React.FC<Props> = ({ cloudId, ecs }) => {
  const { message } = App.useApp();
  const [loading, setLoading] = useState(false);
  const [rules, setRules] = useState<any[]>([]);
  const [logs, setLogs] = useState<any[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm] = Form.useForm();

  const load = useCallback(async () => {
    if (!cloudId) return;
    setLoading(true);
    try {
      const [rulesJson, logsJson]: any[] = await Promise.all([
        fetchCloudProviderAlarmRules(cloudId).catch(() => null),
        fetchCloudProviderAlarmLogs(cloudId).catch(() => null),
      ]);
      setRules(ensureArr((rulesJson?.data?.Alarms?.Alarm) || (rulesJson?.Alarms?.Alarm) || (rulesJson?.data?.DatapointList)));
      setLogs(ensureArr((logsJson?.data?.AlertLogList) || (logsJson?.AlertLogList) || (logsJson?.data?.AlarmHistoryList)));
    } catch (e: any) {
      message.error(e?.message || '查询监控告警失败');
    } finally {
      setLoading(false);
    }
  }, [cloudId, message]);

  useEffect(() => { load(); }, [load]);

  const selectedNs = Form.useWatch('namespace', createForm);
  const metricOptions = useMemo(() => namespacePresets.find((n) => n.value === selectedNs)?.metrics || [], [selectedNs]);
  const ecsOptions = useMemo(() => (Array.isArray(ecs) ? ecs : []).map((i: any) => ({ label: `${i?.InstanceName || i?.InstanceId || i?.id}`, value: i?.InstanceId || i?.id })), [ecs]);

  const submitCreate = async () => {
    try {
      const v = await createForm.validateFields();
      setSubmitting(true);
      const resources = (v.instanceIds || []).map((iid: string) => ({ instanceId: iid }));
      await createCloudProviderAlarmRule(cloudId, {
        ruleName: v.ruleName,
        namespace: v.namespace,
        metricName: v.metricName,
        resources: JSON.stringify(resources.length ? resources : [{}]),
        statistics: v.statistics,
        comparisonOperator: v.comparisonOperator,
        threshold: v.threshold,
        times: v.times,
        period: v.period,
        contactGroups: v.contactGroups,
      });
      message.success('告警规则已保存');
      setCreateOpen(false);
      await load();
    } catch (e: any) { if (e?.errorFields) return; message.error(e?.message || '保存失败'); }
    finally { setSubmitting(false); }
  };

  const handleDeleteRule = (r: any) => {
    const ruleId = r?.RuleId || r?.Id;
    if (!ruleId) { message.error('无法获取规则 ID'); return; }
    Modal.confirm({
      title: '删除告警规则?', content: r?.RuleName || ruleId, okText: '确认删除', okType: 'danger', cancelText: '取消',
      onOk: async () => { try { await deleteCloudProviderAlarmRule(cloudId, ruleId); message.success('删除成功'); await load(); } catch (e: any) { message.error(e?.message || '删除失败'); } },
    });
  };

  const ruleColumns = useMemo(() => ([
    { title: '规则名称', dataIndex: 'RuleName', key: 'name', render: (v: any, r: any) => v || r?.AlertName || '-' },
    { title: '命名空间', dataIndex: 'Namespace', key: 'ns', width: 160, render: (v: any) => v || '-' },
    { title: '指标', dataIndex: 'MetricName', key: 'metric', width: 180, render: (v: any) => v || '-' },
    { title: '状态', key: 'state', width: 110, render: (_: any, r: any) => { const s = r?.AlertState || r?.EnableState; return s ? <Tag color={String(s).toUpperCase() === 'OK' || s === true ? 'green' : 'orange'}>{String(s)}</Tag> : '-'; } },
    { title: '操作', key: 'op', width: 70, render: (_: any, r: any) => (<RowActionsButton items={[{ key: 'del', label: '删除', danger: true }]} onClick={({ key }: { key: string }) => { if (key === 'del') handleDeleteRule(r); }} />) },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ]), []);

  const logColumns = useMemo(() => ([
    { title: '时间', key: 'time', width: 180, render: (_: any, r: any) => { const t = r?.Time || r?.AlarmTime || r?.timestamp; if (!t) return '-'; try { return new Date(Number(t) || t).toLocaleString('zh-CN', { hour12: false }); } catch { return String(t); } } },
    { title: '规则/指标', key: 'rule', render: (_: any, r: any) => r?.RuleName || r?.MetricName || r?.AlertName || '-' },
    { title: '级别', key: 'level', width: 100, render: (_: any, r: any) => { const lv = r?.Level || r?.levelChange; return lv ? <Tag color={/CRIT|P1|warn/i.test(String(lv)) ? 'red' : 'orange'}>{String(lv)}</Tag> : '-'; } },
    { title: '状态', dataIndex: 'Status', key: 'status', width: 100, render: (v: any) => v || '-' },
    { title: '内容', key: 'content', render: (_: any, r: any) => <Typography.Text ellipsis={{ tooltip: r?.MetricContent || r?.Expression || '' }} style={{ maxWidth: 320 }}>{r?.MetricContent || r?.Expression || '-'}</Typography.Text> },
  ]), []);

  return (
    <PageDetailSection
      title={Label}
      icon={Icon}
      toolbarRight={(
        <div className="toolbar-actions">
          <Button type="primary" icon={<PlusOutlined />} onClick={() => { createForm.resetFields(); createForm.setFieldsValue({ namespace: 'acs_ecs_dashboard', metricName: 'CPUUtilization', statistics: 'Average', comparisonOperator: 'GreaterThanThreshold', threshold: 80, times: 3, period: 60 }); setCreateOpen(true); }}>创建告警规则</Button>
          <Tooltip title="刷新"><Button icon={<ReloadOutlined />} loading={loading} onClick={load} /></Tooltip>
        </div>
      )}
      asCard={false}
    >
      <Space direction="vertical" style={{ width: '100%' }} size={8}>
        <Typography.Text type="secondary">展示云监控（CMS）告警规则与近 7 天告警历史。</Typography.Text>
        <Tabs
          items={[
            {
              key: 'rules',
              label: `告警规则（${rules.length}）`,
              children: (<Table size="small" className="std-table" bordered={false} loading={loading} rowKey={(r: any, i) => r?.RuleId || r?.UniqueId || String(i)} dataSource={rules} columns={ruleColumns as any} scroll={{ x: true }} pagination={{ size: 'small', showTotal: (t) => `共 ${t} 条` }} />),
            },
            {
              key: 'logs',
              label: `告警历史（${logs.length}）`,
              children: (<Table size="small" className="std-table" bordered={false} loading={loading} rowKey={(r: any, i) => r?.Id || String(i)} dataSource={logs} columns={logColumns as any} scroll={{ x: true }} pagination={{ size: 'small', showTotal: (t) => `共 ${t} 条` }} />),
            },
          ]}
        />
      </Space>

      <Modal title="创建告警规则" open={createOpen} onCancel={() => setCreateOpen(false)} onOk={submitCreate} confirmLoading={submitting} okText="保存" cancelText="取消" width={600} destroyOnClose>
        <Form form={createForm} layout="vertical">
          <Form.Item name="ruleName" label="规则名称" rules={[{ required: true, message: '请输入规则名称' }]}><Input placeholder="如 ECS-CPU-高负载" allowClear /></Form.Item>
          <Form.Item name="namespace" label="产品" rules={[{ required: true }]}>
            <Select options={namespacePresets.map((n) => ({ label: n.label, value: n.value }))} onChange={() => createForm.setFieldsValue({ metricName: undefined })} />
          </Form.Item>
          <Form.Item name="metricName" label="监控项" rules={[{ required: true, message: '请选择监控项' }]}>
            <Select options={metricOptions} placeholder="请选择监控项" />
          </Form.Item>
          <Form.Item name="instanceIds" label="监控实例（ECS，可多选；留空为产品全局）">
            <Select mode="multiple" showSearch optionFilterProp="label" options={ecsOptions} placeholder="留空表示该产品下全部资源" />
          </Form.Item>
          <Space style={{ display: 'flex' }} align="baseline">
            <Form.Item name="statistics" label="统计方式" rules={[{ required: true }]}>
              <Select style={{ width: 120 }} options={[{ label: '平均值', value: 'Average' }, { label: '最大值', value: 'Maximum' }, { label: '最小值', value: 'Minimum' }]} />
            </Form.Item>
            <Form.Item name="comparisonOperator" label="比较" rules={[{ required: true }]}>
              <Select style={{ width: 90 }} options={comparisonOptions} />
            </Form.Item>
            <Form.Item name="threshold" label="阈值" rules={[{ required: true }]}>
              <InputNumber min={0} style={{ width: 100 }} />
            </Form.Item>
            <Form.Item name="times" label="连续次数" rules={[{ required: true }]}>
              <InputNumber min={1} max={5} style={{ width: 90 }} />
            </Form.Item>
          </Space>
          <Form.Item name="period" label="统计周期(秒)" rules={[{ required: true }]}>
            <Select options={[15, 60, 300, 900].map((p) => ({ label: `${p}s`, value: p }))} />
          </Form.Item>
          <Form.Item name="contactGroups" label="报警联系组" extra="云监控中已创建的联系人组名，留空使用默认"><Input placeholder="如 Default Contact Group" allowClear /></Form.Item>
        </Form>
      </Modal>
    </PageDetailSection>
  );
};

export const Icon = <AlertOutlined />;
export const Label = '监控告警';
export default MonitorAlarmSectionAliyun;
