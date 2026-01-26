import React, { useEffect, useMemo, useState } from 'react';
import { Button, Card, Space, Select, Switch, Popover, Checkbox } from 'antd';
import { ReloadOutlined, LineChartOutlined } from '@ant-design/icons';
import ReactECharts from 'echarts-for-react';
import { fetchAliyunEcsMetrics } from '../../../../services/aliyunApi';
type Props = { cloudId: string; instance: any; metrics?: any[]; onRefresh?: () => void | Promise<void>; };
const MonitorSectionAliyunInner: React.FC<Props> = ({ cloudId, instance, metrics, onRefresh }) => {
  const iid = String(instance?.InstanceId || instance?.id || '');
  const [loading, setLoading] = useState<boolean>(false);
  const [seriesMap, setSeriesMap] = useState<Record<string, any[]>>({});
  const [period, setPeriod] = useState<number>(60);
  const [autoRefresh, setAutoRefresh] = useState<boolean>(false);
  const [enabledKeys, setEnabledKeys] = useState<string[]>([]);
  const metricDefs = useMemo(() => ([
    { key: 'CPUUtilization', label: 'CPU利用率（%）', unit: '%', value: (r: any) => Number(r?.Average ?? r?.Value ?? r?.Minimum ?? r?.Maximum) },
    { key: 'IntranetInRate', label: '内网入带宽（bps）', unit: 'bps', value: (r: any) => Number(r?.Average ?? r?.Value) },
    { key: 'IntranetOutRate', label: '内网出带宽（bps）', unit: 'bps', value: (r: any) => Number(r?.Average ?? r?.Value) },
    { key: 'InternetInRate', label: '公网入带宽（bps）', unit: 'bps', value: (r: any) => Number(r?.Average ?? r?.Value) },
    { key: 'InternetOutRate', label: '公网出带宽（bps）', unit: 'bps', value: (r: any) => Number(r?.Average ?? r?.Value) },
    { key: 'DiskReadBPS', label: '磁盘读速率（B/s）', unit: 'B/s', value: (r: any) => Number(r?.Average ?? r?.Value) },
    { key: 'DiskWriteBPS', label: '磁盘写速率（B/s）', unit: 'B/s', value: (r: any) => Number(r?.Average ?? r?.Value) },
    { key: 'DiskReadIOPS', label: '磁盘读IOPS', unit: 'iops', value: (r: any) => Number(r?.Average ?? r?.Value) },
    { key: 'DiskWriteIOPS', label: '磁盘写IOPS', unit: 'iops', value: (r: any) => Number(r?.Average ?? r?.Value) },
  ]), []);
  useEffect(() => { setEnabledKeys(metricDefs.map(m => m.key)); }, [metricDefs]);
  const parsePoints = (raw: any): any[] => {
    const dpRaw = raw?.data?.Datapoints || raw?.Datapoints || '';
    try { return typeof dpRaw === 'string' ? JSON.parse(dpRaw || '[]') : (Array.isArray(dpRaw) ? dpRaw : []); } catch { return []; }
  };
  const loadAll = async () => {
    if (!cloudId || !iid) return;
    setLoading(true);
    try {
      const entries: Record<string, any[]> = {};
      await Promise.all(metricDefs.map(async (m) => {
        try {
          const json: any = await fetchAliyunEcsMetrics(cloudId, iid, { metric: m.key, period });
          const arr = parsePoints(json);
          if (Array.isArray(arr) && arr.length) entries[m.key] = arr;
        } catch {}
      }));
      setSeriesMap(entries);
    } finally { setLoading(false); }
  };
  useEffect(() => { loadAll(); }, [cloudId, iid, period]);
  useEffect(() => {
    if (!autoRefresh) return;
    const timer = setInterval(() => { loadAll(); }, Math.max(period * 1000, 30000));
    return () => { clearInterval(timer); };
  }, [autoRefresh, period, cloudId, iid]);
  const optionsFor = (key: string, label: string, unit: string) => {
    const arr = seriesMap[key] || [];
    const xs = arr.map((r: any) => {
      const t = r?.timestamp || r?.Timestamp;
      const n = typeof t === 'number' ? t : Date.parse(String(t || ''));
      return (n && !isNaN(n)) ? new Date(n).toLocaleString('zh-CN', { hour12: false }) : String(t || '-');
    });
    const ys = arr.map((r: any) => r?.Average ?? r?.Value ?? r?.Minimum ?? r?.Maximum ?? 0);
    return {
      grid: { left: 40, right: 16, top: 28, bottom: 30 },
      tooltip: { trigger: 'axis' },
      xAxis: { type: 'category', data: xs },
      yAxis: { type: 'value', name: unit },
      series: [{ type: 'line', smooth: true, showSymbol: false, name: label, data: ys, areaStyle: { opacity: 0.15 } }],
    };
  };
  const formatNum = (v: number) => {
    if (v == null || isNaN(v)) return '-';
    const abs = Math.abs(v);
    if (abs >= 1000) return `${(v / 1000).toFixed(1)}k`;
    return `${v}`;
  };
  const cards = metricDefs
    .filter(m => enabledKeys.includes(m.key))
    .filter(m => (seriesMap[m.key] || []).length)
    .map(m => {
      const arr = seriesMap[m.key] || [];
      const vals = arr.map(r => m.value(r)).filter((n: any) => typeof n === 'number' && !isNaN(n));
      const cur = vals.length ? vals[vals.length - 1] : undefined;
      const min = vals.length ? Math.min(...vals) : undefined;
      const max = vals.length ? Math.max(...vals) : undefined;
      return (
        <Card
          key={m.key}
          size="small"
          title={m.label}
          variant="outlined"
          bodyStyle={{ padding: 12 }}
          style={{ overflow: 'hidden' }}
          extra={<span style={{ fontSize: 12, color: '#8c8c8c' }}>当前 {formatNum(Number(cur))} · 最小 {formatNum(Number(min))} · 最大 {formatNum(Number(max))}</span>}
        >
          <ReactECharts notMerge lazyUpdate option={optionsFor(m.key, m.label, m.unit)} style={{ width: '100%', height: 220 }} />
        </Card>
      );
    });
  const metricsSelector = (
    <div style={{ width: 300 }}>
      <Space size={8} style={{ marginBottom: 8 }}>
        <Button size="small" onClick={() => setEnabledKeys(metricDefs.map(m => m.key))}>全选</Button>
        <Button size="small" onClick={() => setEnabledKeys([])}>清空</Button>
      </Space>
      <Checkbox.Group
        value={enabledKeys}
        onChange={(vals) => setEnabledKeys((vals as string[]) || [])}
        options={metricDefs.map(m => ({ label: m.label, value: m.key }))}
      />
    </div>
  );
  return (
    <div>
      <Space style={{ marginBottom: 8, flexWrap: 'wrap' }}>
        <Popover content={metricsSelector} trigger="click" placement="bottomLeft">
          <Button>选择指标（{enabledKeys.length}）</Button>
        </Popover>
        <Select
          value={period}
          onChange={setPeriod as any}
          options={[{ value: 60, label: '周期 60s' }, { value: 300, label: '周期 300s' }, { value: 900, label: '周期 900s' }]}
          style={{ width: 140 }}
        />
        <Button loading={loading} icon={<ReloadOutlined />} onClick={async () => { await loadAll(); if (onRefresh) await onRefresh(); }} />
        <Switch checked={autoRefresh} onChange={setAutoRefresh} checkedChildren="自动刷新" unCheckedChildren="手动刷新" />
      </Space>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
        {cards.length ? cards : (<Card size="small">暂无可用监控数据</Card>)}
      </div>
    </div>
  );
};

const MonitorSectionAliyun = React.memo(MonitorSectionAliyunInner);

(MonitorSectionAliyun as any).tabMeta = {
  key: 'monitor',
  title: '监控',
  icon: <LineChartOutlined style={{ color: '#1677FF' }} />,
  countOf: (_p: any) => undefined,
};

export default MonitorSectionAliyun;
