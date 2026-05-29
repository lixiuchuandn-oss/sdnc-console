import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { App, Button, Table, Space, Tabs, Tag, Tooltip, Typography } from 'antd';
import { AlertOutlined, ReloadOutlined } from '@ant-design/icons';
import PageDetailSection from '../../../../../components/PageDetailSection';
import { fetchCloudProviderAlarmLogs, fetchCloudProviderAlarmRules } from '../../../../../services/aliyunApi';

type Props = {
  cloudId: string;
};

const ensureArr = <T,>(v: T | T[] | undefined | null): T[] => (Array.isArray(v) ? v : v == null ? [] : [v]);

const MonitorAlarmSectionAliyun: React.FC<Props> = ({ cloudId }) => {
  const { message } = App.useApp();
  const [loading, setLoading] = useState(false);
  const [rules, setRules] = useState<any[]>([]);
  const [logs, setLogs] = useState<any[]>([]);

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

  const ruleColumns = useMemo(() => ([
    { title: '规则名称', dataIndex: 'RuleName', key: 'name', render: (v: any, r: any) => v || r?.AlertName || '-' },
    { title: '命名空间', dataIndex: 'Namespace', key: 'ns', width: 160, render: (v: any) => v || '-' },
    { title: '指标', dataIndex: 'MetricName', key: 'metric', width: 180, render: (v: any) => v || '-' },
    { title: '状态', key: 'state', width: 110, render: (_: any, r: any) => { const s = r?.AlertState || r?.EnableState; return s ? <Tag color={String(s).toUpperCase() === 'OK' || s === true ? 'green' : 'orange'}>{String(s)}</Tag> : '-'; } },
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
    </PageDetailSection>
  );
};

export const Icon = <AlertOutlined />;
export const Label = '监控告警';
export default MonitorAlarmSectionAliyun;
