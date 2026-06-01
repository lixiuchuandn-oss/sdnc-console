/**
 * 按需加载 echarts-for-react，避免进入非监控页时拉取 ECharts 主包。
 */
import React, { Suspense, forwardRef } from 'react';
import type ReactEChartsCore from 'echarts-for-react';

const ReactEChartsLazy = React.lazy(() => import('echarts-for-react'));

export type LazyReactEChartsProps = React.ComponentProps<typeof ReactEChartsLazy>;

const chartFallbackStyle: React.CSSProperties = {
  width: '100%',
  minHeight: 120,
};

const LazyReactECharts = forwardRef<ReactEChartsCore, LazyReactEChartsProps>((props, ref) => {
  const height = props.style?.height ?? props.opts?.height ?? 240;
  return (
    <Suspense
      fallback={
        <div
          style={{
            ...chartFallbackStyle,
            height: typeof height === 'number' ? height : chartFallbackStyle.minHeight,
          }}
        />
      }
    >
      <ReactEChartsLazy ref={ref} {...props} />
    </Suspense>
  );
});

LazyReactECharts.displayName = 'LazyReactECharts';

export default LazyReactECharts;
