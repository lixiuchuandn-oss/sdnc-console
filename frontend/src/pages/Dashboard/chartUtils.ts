import * as echarts from 'echarts';

export const CHART_COLORS = {
  light: [
    '#3b82f6', '#6366f1', '#0ea5e9', '#94a3b8', '#cbd5e1'
  ],
  dark: [
    '#3b82f6', '#6366f1', '#0ea5e9', '#475569', '#334155'
  ]
};

// --- Chart Options ---
export const getProviderChartOption = (data: any[], isDark: boolean) => ({
  color: isDark ? CHART_COLORS.dark : CHART_COLORS.light,
  tooltip: { 
    trigger: 'item', 
    backgroundColor: isDark ? '#1f1f1f' : '#fff',
    borderColor: isDark ? '#303030' : '#e5e7eb',
    borderWidth: 1,
    textStyle: { color: isDark ? '#fff' : '#374151' },
    padding: [8, 12],
    extraCssText: 'box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1); border-radius: 6px;'
  },
  legend: { 
    bottom: '0%', 
    left: 'center', 
    icon: 'circle',
    itemWidth: 8,
    itemHeight: 8,
    itemGap: 16,
    textStyle: { color: isDark ? '#a6a6a6' : '#6b7280', fontSize: 12 } 
  },
  series: [
    {
      name: '资源分布',
      type: 'pie',
      radius: ['50%', '80%'],
      center: ['50%', '40%'],
      avoidLabelOverlap: false,
      itemStyle: { 
        borderRadius: 8, 
        borderColor: isDark ? '#1f1f1f' : '#fff', 
        borderWidth: 2 
      },
      label: { show: false, position: 'center' },
      emphasis: { 
        label: { show: true, fontSize: 18, fontWeight: 'bold', color: isDark ? '#fff' : '#111827' },
        scale: true,
        scaleSize: 10,
        itemStyle: {
          shadowBlur: 10,
          shadowOffsetX: 0,
          shadowColor: 'rgba(0, 0, 0, 0.5)'
        }
      },
      labelLine: { show: false },
      data: data,
      animationType: 'scale',
      animationEasing: 'elasticOut',
      animationDuration: 1200,
      animationDelay: function (idx: number) {
        return idx * 100;
      }
    }
  ]
});

export const getRegionChartOption = (data: any[], isDark: boolean) => ({
  tooltip: { 
    trigger: 'axis', 
    axisPointer: { type: 'shadow' }, // Shadow pointer for better focus
    backgroundColor: isDark ? 'rgba(31, 31, 31, 0.9)' : 'rgba(255, 255, 255, 0.9)',
    borderColor: isDark ? '#303030' : '#e5e7eb',
    borderWidth: 0,
    textStyle: { color: isDark ? '#fff' : '#374151' },
    padding: [12, 16],
    extraCssText: 'box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05); border-radius: 8px;'
  },
  grid: { left: '150', right: '10%', bottom: '3%', top: '3%', containLabel: false },
  xAxis: { 
    type: 'value', 
    splitLine: { show: false }, // Clean look, no grid lines
    axisLabel: { show: false },
    axisLine: { show: false },
    axisTick: { show: false }
  },
  yAxis: { 
    type: 'category', 
    data: data.map(i => i.name), 
    axisLabel: { 
      color: isDark ? '#a6a6a6' : '#64748b', 
      fontWeight: 600, 
      fontSize: 13,
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial',
      margin: 130,
      width: 120,
      overflow: 'truncate',
      align: 'left',
    },
    axisLine: { show: false },
    axisTick: { show: false },
    inverse: true // Top items first
  },
  series: [
    {
      name: '资源',
      type: 'bar',
      data: data.map(i => i.value),
      itemStyle: { 
        borderRadius: 20, // Full capsule shape
        color: new echarts.graphic.LinearGradient(0, 0, 1, 0, [
          { offset: 0, color: '#2563eb' }, // Blue 600
          { offset: 1, color: '#60a5fa' }  // Blue 400
        ]),
        shadowBlur: 5,
        shadowColor: 'rgba(37, 99, 235, 0.2)',
        shadowOffsetY: 2
      },
      barWidth: 24, 
      showBackground: true,
      backgroundStyle: { color: isDark ? '#303030' : '#f1f5f9', borderRadius: 20 },
      label: {
        show: true,
        position: 'right',
        color: isDark ? '#a6a6a6' : '#64748b',
        fontSize: 13,
        fontWeight: 600,
        formatter: '{c}',
        fontFamily: 'Monaco, Menlo, Consolas, "Courier New", monospace' // Tech feel for numbers
      },
      animationDelay: function (idx: number) {
        return idx * 100;
      },
      animationEasing: 'elasticOut',
      animationDuration: 1200
    }
  ]
});

export const getBarOption = (data: any[], isDarkTheme: boolean) => {
  const names = data.map(d => String(d.name || ''));
  const maxLen = names.reduce((m, n) => Math.max(m, n.length), 0);
  const labelWidth = Math.min(220, Math.max(120, maxLen * 9));
  const leftGap = Math.min(240, Math.max(120, labelWidth + 18));
  return {
    grid: { left: leftGap, right: '6%', top: '8%', bottom: '12%' },
    xAxis: { type: 'value', axisLine: { show: false }, axisTick: { show: false }, splitLine: { show: true, lineStyle: { color: isDarkTheme ? '#303030' : '#e5e7eb' } } },
    yAxis: { 
      type: 'category', 
      data: names, 
      axisLabel: { align: 'right', margin: 12, color: isDarkTheme ? '#e5e7eb' : '#374151', width: labelWidth, overflow: 'truncate', ellipsis: '…' }, 
      axisLine: { show: false }, 
      axisTick: { show: false } 
    },
    series: [{ type: 'bar', data: data.map(d => d.value), barWidth: 14, itemStyle: { color: '#1677ff', borderRadius: [6, 6, 6, 6] } }],
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } }
  };
};

export const getDonutOption = (data: any[], isDarkTheme: boolean) => ({
  tooltip: { trigger: 'item', backgroundColor: isDarkTheme ? '#1f1f1f' : '#fff', textStyle: { color: isDarkTheme ? '#fff' : '#333' } },
  legend: { bottom: 0, left: 'center', textStyle: { color: isDarkTheme ? '#a6a6a6' : '#333' } },
  series: [{ type: 'pie', radius: ['50%', '75%'], center: ['50%', '40%'], label: { show: false }, data: data, itemStyle: { borderColor: isDarkTheme ? '#1f1f1f' : '#fff', borderWidth: 2 } }]
});