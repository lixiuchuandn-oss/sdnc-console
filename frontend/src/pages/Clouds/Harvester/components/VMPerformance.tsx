import React, { useEffect, useState, useMemo, useRef } from 'react';
import { Card, Radio, Spin, Row, Col } from 'antd';
import ReactECharts from 'echarts-for-react';
import { fetchMetricRange } from '../../../../services/monitoringApi';

interface VMPerformanceProps {
  cloudId: string;
  namespace: string;
  name: string;
}

const REFRESH_INTERVAL = 5 * 60 * 1000; // 每 5 分钟抓取一次

/** 性能考虑：支持 5/10/15 分钟，动态调整步长控制点数 */
const TIME_RANGES = [
  { label: '5分钟', value: 5 * 60, step: 5 },
  { label: '10分钟', value: 10 * 60, step: 10 },
  { label: '15分钟', value: 15 * 60, step: 15 },
];

const DEFAULT_TIME_RANGE = TIME_RANGES[0];

export const VMPerformance: React.FC<VMPerformanceProps> = ({ cloudId, namespace, name }) => {
  const [timeRange, setTimeRange] = useState(DEFAULT_TIME_RANGE);
  const [loading, setLoading] = useState(false);
  const [cpuData, setCpuData] = useState<any[]>([]);
  const [memData, setMemData] = useState<any[]>([]);
  const [netData, setNetData] = useState<{ rx: any[]; tx: any[] }>({ rx: [], tx: [] });
  const [netPpsData, setNetPpsData] = useState<{ rx: any[]; tx: any[] }>({ rx: [], tx: [] });
  const [diskData, setDiskData] = useState<{ read: any[]; write: any[] }>({ read: [], write: [] });
  const [diskIopsData, setDiskIopsData] = useState<{ read: any[]; write: any[] }>({ read: [], write: [] });
  const timerRef = useRef<NodeJS.Timeout>();

  const fetchData = async () => {
    if (!cloudId || !namespace || !name) return;
    
    setLoading(true);
    const end = Math.floor(Date.now() / 1000);
    const start = end - timeRange.value;
    const step = timeRange.step;

    try {
      // CPU 使用率：与 Grafana harvester-vm-detail 一致，kubevirt_vmi_vcpu_seconds_total，percentunit (0-1)
      const cpuQuery = `sum(avg(rate(kubevirt_vmi_vcpu_seconds_total{namespace="${namespace}", name="${name}"}[5m])) by (domain, name)) / 1000`;
      
      // 内存使用率：与 Grafana harvester-vm-detail 一致，(available-unused)/available，percentunit (0-1)
      const memQuery = `sum((kubevirt_vmi_memory_available_bytes{namespace="${namespace}", name="${name}"} - kubevirt_vmi_memory_unused_bytes{namespace="${namespace}", name="${name}"}) / kubevirt_vmi_memory_available_bytes{namespace="${namespace}", name="${name}"})`;

      // 网络流量：与 Grafana harvester-vm-detail 一致，irate * 8 得到 bps，sum 聚合多网卡
      const netRxQuery = `sum(irate(kubevirt_vmi_network_receive_bytes_total{namespace="${namespace}", name="${name}"}[5m]))*8`;
      const netTxQuery = `sum(irate(kubevirt_vmi_network_transmit_bytes_total{namespace="${namespace}", name="${name}"}[5m]))*8`;

      // Network RX/TX (PPS)
      const netRxPpsQuery = `sum(rate(container_network_receive_packets_total{namespace="${namespace}", pod=~"virt-launcher-${name}-.*"}[5m]))`;
      const netTxPpsQuery = `sum(rate(container_network_transmit_packets_total{namespace="${namespace}", pod=~"virt-launcher-${name}-.*"}[5m]))`;

      // IO Traffic：与 Grafana harvester-vm-detail 一致，irate bytes/s，sum 聚合多盘，展示 KiB/s
      const diskReadQuery = `sum(irate(kubevirt_vmi_storage_read_traffic_bytes_total{namespace="${namespace}", name="${name}"}[5m]))`;
      const diskWriteQuery = `sum(irate(kubevirt_vmi_storage_write_traffic_bytes_total{namespace="${namespace}", name="${name}"}[5m]))`;

      // 磁盘 IOPS：与 Grafana harvester-vm-detail 一致，irate，sum 聚合多盘
      const diskReadIopsQuery = `sum(irate(kubevirt_vmi_storage_iops_read_total{namespace="${namespace}", name="${name}"}[5m]))`;
      const diskWriteIopsQuery = `sum(irate(kubevirt_vmi_storage_iops_write_total{namespace="${namespace}", name="${name}"}[5m]))`;

      const [
        cpuRes, memRes, 
        netRxRes, netTxRes, netRxPpsRes, netTxPpsRes,
        diskReadRes, diskWriteRes, diskReadIopsRes, diskWriteIopsRes
      ] = await Promise.all([
        fetchMetricRange(cloudId, { query: cpuQuery, start, end, step }),
        fetchMetricRange(cloudId, { query: memQuery, start, end, step }),
        fetchMetricRange(cloudId, { query: netRxQuery, start, end, step }),
        fetchMetricRange(cloudId, { query: netTxQuery, start, end, step }),
        fetchMetricRange(cloudId, { query: netRxPpsQuery, start, end, step }),
        fetchMetricRange(cloudId, { query: netTxPpsQuery, start, end, step }),
        fetchMetricRange(cloudId, { query: diskReadQuery, start, end, step }),
        fetchMetricRange(cloudId, { query: diskWriteQuery, start, end, step }),
        fetchMetricRange(cloudId, { query: diskReadIopsQuery, start, end, step }),
        fetchMetricRange(cloudId, { query: diskWriteIopsQuery, start, end, step }),
      ]);

      if (cpuRes.ok && cpuRes.data?.data?.result?.[0]?.values) {
        setCpuData(cpuRes.data.data.result[0].values);
      } else {
        setCpuData([]);
      }

      if (memRes.ok && memRes.data?.data?.result?.[0]?.values) {
        setMemData(memRes.data.data.result[0].values);
      } else {
        setMemData([]);
      }

      const rx = (netRxRes.ok && netRxRes.data?.data?.result?.[0]?.values) ? netRxRes.data.data.result[0].values : [];
      const tx = (netTxRes.ok && netTxRes.data?.data?.result?.[0]?.values) ? netTxRes.data.data.result[0].values : [];
      setNetData({ rx, tx });

      const rxPps = (netRxPpsRes.ok && netRxPpsRes.data?.data?.result?.[0]?.values) ? netRxPpsRes.data.data.result[0].values : [];
      const txPps = (netTxPpsRes.ok && netTxPpsRes.data?.data?.result?.[0]?.values) ? netTxPpsRes.data.data.result[0].values : [];
      setNetPpsData({ rx: rxPps, tx: txPps });

      const diskRead = (diskReadRes.ok && diskReadRes.data?.data?.result?.[0]?.values) ? diskReadRes.data.data.result[0].values : [];
      const diskWrite = (diskWriteRes.ok && diskWriteRes.data?.data?.result?.[0]?.values) ? diskWriteRes.data.data.result[0].values : [];
      setDiskData({ read: diskRead, write: diskWrite });

      const diskReadIops = (diskReadIopsRes.ok && diskReadIopsRes.data?.data?.result?.[0]?.values) ? diskReadIopsRes.data.data.result[0].values : [];
      const diskWriteIops = (diskWriteIopsRes.ok && diskWriteIopsRes.data?.data?.result?.[0]?.values) ? diskWriteIopsRes.data.data.result[0].values : [];
      setDiskIopsData({ read: diskReadIops, write: diskWriteIops });

    } catch (e) {
      console.error('Fetch metrics failed', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    timerRef.current = setInterval(fetchData, REFRESH_INTERVAL);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [cloudId, namespace, name, timeRange]);

  /** 动态计算 x 轴间隔，保持约 5 个刻度 */
  const xAxisMinIntervalMs = (timeRange.value / 5) * 1000;
  
  // 计算当前图表显示的时间范围，确保无数据时也能显示正确的 X 轴
  const nowTs = Math.floor(Date.now() / 1000) * 1000;
  const chartMin = nowTs - timeRange.value * 1000;
  const chartMax = nowTs;

  /** 字节速率图表：按数据量级自动选择 B/s、KiB/s、MiB/s、GiB/s，Y 轴与 tooltip 动态展示 */
  const getByteRateOption = (
    title: string,
    series: { name: string; data: [number | string, number | string][]; color?: string }[],
    color: string
  ) => {
    const allValues = series.flatMap((s) => (s.data || []).map((d) => Number(d[1]) || 0));
    const maxVal = Math.max(0, ...allValues);
    const scale =
      maxVal >= 1024 ** 3 ? { div: 1024 ** 3, unit: 'GiB/s' }
      : maxVal >= 1024 ** 2 ? { div: 1024 ** 2, unit: 'MiB/s' }
      : maxVal >= 1024 ? { div: 1024, unit: 'KiB/s' }
      : { div: 1, unit: 'B/s' };
    const scaleData = (d: [number | string, number | string]) => {
      const ts = Number(d[0]);
      return [ts < 1e12 ? ts * 1000 : ts, (Number(d[1]) || 0) / scale.div] as [number, number];
    };

    const isEmpty = series.every(s => !s.data || s.data.length === 0);

    return {
      title: { text: title, textStyle: { fontSize: 14, fontWeight: 500 }, left: 0 },
      tooltip: {
        trigger: 'axis',
        formatter: (params: any[]) => {
          const ts = params[0].value[0];
          const date = new Date(ts);
          const label =
            timeRange.value > 6 * 60 * 60
              ? `${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
              : `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
          let html = `${label}<br/>`;
          params.forEach((p) => {
            html += `${p.marker} ${p.seriesName}: ${parseFloat(String(p.value[1])).toFixed(2)} ${scale.unit}<br/>`;
          });
          return html;
        },
      },
      grid: { left: 80, right: 20, top: 40, bottom: 30 },
      xAxis: {
        type: 'time',
        boundaryGap: false,
        min: chartMin,
        max: chartMax,
        minInterval: xAxisMinIntervalMs,
        splitNumber: 4,
        axisLabel: {
          hideOverlap: true,
          formatter: (value: number) => {
            const d = new Date(value);
            if (timeRange.value > 6 * 60 * 60) {
              return `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
            }
            return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
          },
        },
      },
      yAxis: {
        type: 'value',
        axisLabel: {
          formatter: (value: number) => `${Number(value).toFixed(1)} ${scale.unit}`,
        },
      },
      series: series.map((s) => ({
        name: s.name,
        type: 'line',
        showSymbol: false,
        smooth: true,
        areaStyle: { opacity: 0.1 },
        lineStyle: { width: 1.5 },
        itemStyle: { color: s.color || color },
        data: (s.data || []).map(scaleData),
      })),
      graphic: isEmpty ? [{
          type: 'text',
          left: 'center',
          top: 'center',
          style: {
              text: '暂无数据',
              fill: '#ccc',
              fontSize: 14
          }
      }] : []
    };
  };

  const getOption = (
    title: string,
    unit: string,
    series: any[],
    color: string,
    opts?: { unitOnYAxis?: string }
  ) => {
    const displayUnit = opts?.unitOnYAxis ?? unit;
    const titleText = opts?.unitOnYAxis ? title : `${title} (${unit})`;
    const isEmpty = series.every(s => !s.data || s.data.length === 0);

    return {
    title: { text: titleText, textStyle: { fontSize: 14, fontWeight: 500 }, left: 0 },
    tooltip: { 
      trigger: 'axis',
      formatter: (params: any[]) => {
        const ts = params[0].value[0];
        const date = new Date(ts);
        const label =
          timeRange.value > 6 * 60 * 60
            ? `${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
            : `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
        let html = `${label}<br/>`;
        params.forEach(p => {
            html += `${p.marker} ${p.seriesName}: ${parseFloat(p.value[1]).toFixed(2)} ${displayUnit}<br/>`;
        });
        return html;
      }
    },
    grid: { left: 80, right: 20, top: 40, bottom: 30 },
    xAxis: { 
      type: 'time', 
      boundaryGap: false,
      min: chartMin,
      max: chartMax,
      minInterval: xAxisMinIntervalMs,
      splitNumber: 4,
      axisLabel: {
        hideOverlap: true,
        formatter: (value: number) => {
          const d = new Date(value);
          if (timeRange.value > 6 * 60 * 60) {
            return `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
          }
          return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
        }
      }
    },
    yAxis: opts?.unitOnYAxis
      ? {
          type: 'value' as const,
          axisLabel: { formatter: (value: number) => `${Number(value).toFixed(1)} ${opts.unitOnYAxis}` },
        }
      : { type: 'value' as const },
    series: series.map(s => ({
        name: s.name,
        type: 'line',
        showSymbol: false,
        smooth: true,
        areaStyle: { opacity: 0.1 },
        lineStyle: { width: 1.5 },
        itemStyle: { color: s.color || color },
        data: (s.data || []).map((d: [number | string, number | string]) => {
          const ts = Number(d[0]);
          return [ts < 1e12 ? ts * 1000 : ts, d[1]] as [number, number];
        })
    })),
    graphic: isEmpty ? [{
          type: 'text',
          left: 'center',
          top: 'center',
          style: {
              text: '暂无数据',
              fill: '#ccc',
              fontSize: 14
          }
      }] : []
  };
  };

  return (
    <div>
      <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'flex-start' }}>
        <Radio.Group 
            value={timeRange.value} 
            onChange={e => setTimeRange(TIME_RANGES.find(t => t.value === e.target.value) || TIME_RANGES[0])}
            buttonStyle="solid"
            size="small"
        >
          {TIME_RANGES.map(t => <Radio.Button key={t.value} value={t.value}>{t.label}</Radio.Button>)}
        </Radio.Group>
      </div>

      <Row gutter={[16, 16]}>
        <Col span={12}>
          <Card bordered={false} bodyStyle={{ padding: 16 }}>
            <Spin spinning={loading}>
              <ReactECharts 
                  option={getOption(
                    'CPU使用率',
                    '%',
                    [{ name: 'Usage', data: cpuData.map((d) => [d[0], (Number(d[1]) || 0) * 100]) }],
                    '#1890ff',
                    { unitOnYAxis: '%' }
                  )} 
                  style={{ height: 300 }} 
              />
            </Spin>
          </Card>
        </Col>
        <Col span={12}>
          <Card bordered={false} bodyStyle={{ padding: 16 }}>
            <Spin spinning={loading}>
              <ReactECharts 
                  option={getOption('内存使用率', '%', [{ 
                      name: 'Usage', 
                      data: memData.map((d) => [d[0], (Number(d[1]) || 0) * 100]) 
                  }], '#52c41a', { unitOnYAxis: '%' })} 
                  style={{ height: 300 }} 
              />
            </Spin>
          </Card>
        </Col>
        <Col span={24}>
          <Row gutter={[16, 16]}>
            <Col span={12}>
              <Card bordered={false} bodyStyle={{ padding: 16 }}>
                <Spin spinning={loading}>
                  <ReactECharts 
                      option={getByteRateOption('网络吞吐量', [
                          { name: 'Receive', data: netData.rx.map((d) => [d[0], (Number(d[1]) || 0) / 8]), color: '#faad14' },
                          { name: 'Transmit', data: netData.tx.map((d) => [d[0], (Number(d[1]) || 0) / 8]), color: '#13c2c2' }
                      ], '#1890ff')} 
                      style={{ height: 300 }} 
                  />
                </Spin>
              </Card>
            </Col>
            <Col span={12}>
              <Card bordered={false} bodyStyle={{ padding: 16 }}>
                <Spin spinning={loading}>
                  <ReactECharts 
                      option={getOption('网络包速率', 'pps', [
                          { name: 'Receive', data: netPpsData.rx, color: '#faad14' },
                          { name: 'Transmit', data: netPpsData.tx, color: '#13c2c2' }
                      ], '#1890ff', { unitOnYAxis: 'pps' })} 
                      style={{ height: 300 }} 
                  />
                </Spin>
              </Card>
            </Col>
          </Row>
        </Col>

        <Col span={24}>
          <Row gutter={[16, 16]}>
            <Col span={12}>
              <Card bordered={false} bodyStyle={{ padding: 16 }}>
                <Spin spinning={loading}>
                  <ReactECharts 
                      option={getByteRateOption('磁盘IO吞吐量', [
                          { name: 'Read', data: diskData.read, color: '#722ed1' },
                          { name: 'Write', data: diskData.write, color: '#eb2f96' }
                      ], '#1890ff')} 
                      style={{ height: 300 }} 
                  />
                </Spin>
              </Card>
            </Col>
            <Col span={12}>
              <Card bordered={false} bodyStyle={{ padding: 16 }}>
                <Spin spinning={loading}>
                  <ReactECharts 
                      option={getOption('磁盘 IOPS', 'IOPS', [
                          { name: 'Read', data: diskIopsData.read, color: '#722ed1' },
                          { name: 'Write', data: diskIopsData.write, color: '#eb2f96' }
                      ], '#1890ff', { unitOnYAxis: 'io/s' })} 
                      style={{ height: 300 }} 
                  />
                </Spin>
              </Card>
            </Col>
          </Row>
        </Col>
      </Row>
    </div>
  );
};
