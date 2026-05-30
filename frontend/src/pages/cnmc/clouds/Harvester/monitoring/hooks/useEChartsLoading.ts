/**
 * 对齐 ECharts 异步数据模式：实例初始化后，用 showLoading / hideLoading 表示**首次**拉取中；
 * 轮询刷新不在图表上重复 Spin。
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
  /** 仅首次加载时为 true；轮询 refreshing 时不传 true */
  initialLoading?: boolean,
): { onChartReady: () => void } {
  const syncLoading = useCallback(() => {
    const chart = chartRef.current?.getEchartsInstance();
    if (!chart) return;
    if (initialLoading) {
      chart.showLoading(LOADING_OPTS);
    } else {
      chart.hideLoading();
    }
  }, [chartRef, initialLoading]);

  useEffect(() => {
    syncLoading();
  }, [syncLoading]);

  const onChartReady = useCallback(() => {
    syncLoading();
  }, [syncLoading]);

  return { onChartReady };
}
