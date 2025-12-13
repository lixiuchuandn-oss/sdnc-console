import React, { useEffect, useRef } from 'react';
import * as echarts from 'echarts';

const TestChart: React.FC = () => {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    console.log('创建测试图表...');
    const chart = echarts.init(containerRef.current);

    const option = {
      title: {
        text: '测试图表',
        textStyle: {
          color: '#333',
        },
      },
      xAxis: {
        type: 'category',
        data: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
      },
      yAxis: {
        type: 'value',
      },
      series: [
        {
          data: [820, 932, 901, 934, 1290, 1330, 1320],
          type: 'line',
        },
      ],
    };

    chart.setOption(option);

    return () => {
      chart.dispose();
    };
  }, []);

  return (
    <div 
      ref={containerRef} 
      style={{ 
        width: '400px', 
        height: '300px',
        border: '1px solid #ccc',
        margin: '20px',
      }}
    />
  );
};

export default TestChart; 