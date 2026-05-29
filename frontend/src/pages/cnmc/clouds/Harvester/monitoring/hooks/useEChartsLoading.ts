/**
 * 对齐 ECharts 异步数据模式：实例初始化后，用 showLoading / hideLoading 表示拉取中；
 * 数据到达后由 ReactECharts 的 option 变更触发 setOption 填入 series。
 */
import { useCallback, useEffect, type RefObject } from 'react';
import type ReactEChartsCore from 'echarts-for-react';

const LOADING_OPTS = {
  text: '',
  color: '#1677ff',
  maskColor: 'rgba(255, 255, 255, 0.65)',
  zlevel: 0,
};

export function useEChartsLoading(
  chartRef: RefObject<ReactEChartsCore | null>,
  loading?: boolean,
): { onChartReady: () => void } {
  const syncLoading = useCallback(() => {
    const chart = chartRef.current?.getEchartsInstance();
    if (!chart) return;
    if (loading) {
      chart.showLoading(LOADING_OPTS);
    } else {
      chart.hideLoading();
    }
  }, [chartRef, loading]);

  useEffect(() => {
    syncLoading();
  }, [syncLoading]);

  const onChartReady = useCallback(() => {
    syncLoading();
  }, [syncLoading]);

  return { onChartReady };
}
