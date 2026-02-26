import React, { useEffect, useState, useMemo, useRef } from 'react';
import { Card, Radio, Spin, Empty, Row, Col } from 'antd';
import ReactECharts from 'echarts-for-react';
import { fetchMetricRange } from '../../../../services/monitoringApi';

interface VMPerformanceProps {
  cloudId: string;
  namespace: string;
  name: string;
}

const REFRESH_INTERVAL = 30 * 1000;

const TIME_RANGES = [
  { label: '1小时', value: 1 * 60 * 60, step: 15 },
  { label: '6小时', value: 6 * 60 * 60, step: 60 },
  { label: '24小时', value: 24 * 60 * 60, step: 300 },
];

export const VMPerformance: React.FC<VMPerformanceProps> = ({ cloudId, namespace, name }) => {
  const [timeRange, setTimeRange] = useState(TIME_RANGES[0]);
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
      // CPU Query (Cores)
      const cpuQuery = `rate(container_cpu_usage_seconds_total{namespace="${namespace}", pod=~"virt-launcher-${name}-.*", container="compute"}[5m])`;
      
      // Memory Query (Bytes)
      const memQuery = `container_memory_usage_bytes{namespace="${namespace}", pod=~"virt-launcher-${name}-.*", container="compute"}`;

      // Network RX/TX (Bytes/s)
      const netRxQuery = `sum(rate(container_network_receive_bytes_total{namespace="${namespace}", pod=~"virt-launcher-${name}-.*"}[5m]))`;
      const netTxQuery = `sum(rate(container_network_transmit_bytes_total{namespace="${namespace}", pod=~"virt-launcher-${name}-.*"}[5m]))`;

      // Network RX/TX (PPS)
      const netRxPpsQuery = `sum(rate(container_network_receive_packets_total{namespace="${namespace}", pod=~"virt-launcher-${name}-.*"}[5m]))`;
      const netTxPpsQuery = `sum(rate(container_network_transmit_packets_total{namespace="${namespace}", pod=~"virt-launcher-${name}-.*"}[5m]))`;

      // Disk Read/Write (Bytes/s)
      const diskReadQuery = `sum(rate(kubevirt_vmi_storage_read_traffic_bytes_total{namespace="${namespace}", name="${name}"}[5m]))`;
      const diskWriteQuery = `sum(rate(kubevirt_vmi_storage_write_traffic_bytes_total{namespace="${namespace}", name="${name}"}[5m]))`;

      // Disk Read/Write (IOPS)
      const diskReadIopsQuery = `sum(rate(kubevirt_vmi_storage_iops_read_total{namespace="${namespace}", name="${name}"}[5m]))`;
      const diskWriteIopsQuery = `sum(rate(kubevirt_vmi_storage_iops_write_total{namespace="${namespace}", name="${name}"}[5m]))`;

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

  const getOption = (title: string, unit: string, series: any[], color: string) => ({
    title: { text: `${title} (${unit})`, textStyle: { fontSize: 14, fontWeight: 500 }, left: 0 },
    tooltip: { 
      trigger: 'axis',
      formatter: (params: any[]) => {
        const ts = params[0].value[0];
        const date = new Date(ts * 1000);
        let html = `${date.getHours()}:${String(date.getMinutes()).padStart(2, '0')}<br/>`;
        params.forEach(p => {
            html += `${p.marker} ${p.seriesName}: ${parseFloat(p.value[1]).toFixed(2)} ${unit}<br/>`;
        });
        return html;
      }
    },
    grid: { left: 50, right: 20, top: 40, bottom: 30 },
    xAxis: { 
      type: 'time', 
      boundaryGap: false,
      axisLabel: { formatter: '{HH}:{mm}' }
    },
    yAxis: { type: 'value' },
    series: series.map(s => ({
        name: s.name,
        type: 'line',
        showSymbol: false,
        smooth: true,
        areaStyle: { opacity: 0.1 },
        lineStyle: { width: 1.5 },
        itemStyle: { color: s.color || color },
        data: s.data
    }))
  });

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
            {cpuData.length > 0 ? (
                <ReactECharts 
                    option={getOption('CPU 使用率', 'Cores', [{ name: 'Usage', data: cpuData }], '#1890ff')} 
                    style={{ height: 300 }} 
                />
            ) : <Empty description="暂无 CPU 数据" image={Empty.PRESENTED_IMAGE_SIMPLE} />}
          </Card>
        </Col>
        <Col span={12}>
          <Card bordered={false} bodyStyle={{ padding: 16 }}>
            {memData.length > 0 ? (
                <ReactECharts 
                    option={getOption('内存 使用量', 'GiB', [{ 
                        name: 'Usage', 
                        data: memData.map(d => [d[0], d[1] / (1024 ** 3)]) 
                    }], '#52c41a')} 
                    style={{ height: 300 }} 
                />
            ) : <Empty description="暂无内存数据" image={Empty.PRESENTED_IMAGE_SIMPLE} />}
          </Card>
        </Col>
        <Col span={24}>
          <Row gutter={[16, 16]}>
            <Col span={12}>
              <Card bordered={false} bodyStyle={{ padding: 16 }}>
                {(netData.rx.length > 0 || netData.tx.length > 0) ? (
                    <ReactECharts 
                        option={getOption('网络吞吐量', 'MiB/s', [
                            { name: 'Receive', data: netData.rx.map(d => [d[0], d[1] / (1024 ** 2)]), color: '#faad14' },
                            { name: 'Transmit', data: netData.tx.map(d => [d[0], d[1] / (1024 ** 2)]), color: '#13c2c2' }
                        ], '#1890ff')} 
                        style={{ height: 300 }} 
                    />
                ) : <Empty description="暂无网络吞吐数据" image={Empty.PRESENTED_IMAGE_SIMPLE} />}
              </Card>
            </Col>
            <Col span={12}>
              <Card bordered={false} bodyStyle={{ padding: 16 }}>
                {(netPpsData.rx.length > 0 || netPpsData.tx.length > 0) ? (
                    <ReactECharts 
                        option={getOption('网络包速率 (PPS)', 'pps', [
                            { name: 'Receive', data: netPpsData.rx, color: '#faad14' },
                            { name: 'Transmit', data: netPpsData.tx, color: '#13c2c2' }
                        ], '#1890ff')} 
                        style={{ height: 300 }} 
                    />
                ) : <Empty description="暂无网络 PPS 数据" image={Empty.PRESENTED_IMAGE_SIMPLE} />}
              </Card>
            </Col>
          </Row>
        </Col>

        <Col span={24}>
          <Row gutter={[16, 16]}>
            <Col span={12}>
              <Card bordered={false} bodyStyle={{ padding: 16 }}>
                {(diskData.read.length > 0 || diskData.write.length > 0) ? (
                    <ReactECharts 
                        option={getOption('磁盘吞吐量', 'MiB/s', [
                            { name: 'Read', data: diskData.read.map(d => [d[0], d[1] / (1024 ** 2)]), color: '#722ed1' },
                            { name: 'Write', data: diskData.write.map(d => [d[0], d[1] / (1024 ** 2)]), color: '#eb2f96' }
                        ], '#1890ff')} 
                        style={{ height: 300 }} 
                    />
                ) : <Empty description="暂无磁盘吞吐数据" image={Empty.PRESENTED_IMAGE_SIMPLE} />}
              </Card>
            </Col>
            <Col span={12}>
              <Card bordered={false} bodyStyle={{ padding: 16 }}>
                {(diskIopsData.read.length > 0 || diskIopsData.write.length > 0) ? (
                    <ReactECharts 
                        option={getOption('磁盘 IOPS', 'IOPS', [
                            { name: 'Read', data: diskIopsData.read, color: '#722ed1' },
                            { name: 'Write', data: diskIopsData.write, color: '#eb2f96' }
                        ], '#1890ff')} 
                        style={{ height: 300 }} 
                    />
                ) : <Empty description="暂无磁盘 IOPS 数据" image={Empty.PRESENTED_IMAGE_SIMPLE} />}
              </Card>
            </Col>
          </Row>
        </Col>
      </Row>
    </div>
  );
};
