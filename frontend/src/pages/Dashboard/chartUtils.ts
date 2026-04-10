import type { GlobalToken } from 'antd/es/theme';
import { blue, blueDark, geekblue, geekblueDark } from '@ant-design/colors';

/** 饼图：Ant Design 蓝 / 极客蓝同色系阶梯，首色跟主题主色，避免高饱和跳色 */
const getAntdPieBlueTonalColors = (token: GlobalToken, isDark: boolean): string[] => {
  if (isDark) {
    return [
      token.colorPrimary,
      blueDark[4],
      blueDark[5],
      geekblueDark[4],
      geekblueDark[5],
      blueDark[6],
      geekblueDark[6],
      blueDark[7],
      blueDark[8],
    ];
  }
  return [
    token.colorPrimary,
    blue[4],
    blue[5],
    geekblue[4],
    geekblue[5],
    blue[6],
    geekblue[6],
    blue[7],
    blue[8],
  ];
};

const chartTooltipExtraCss = (token: GlobalToken) =>
  `box-shadow: ${token.boxShadowSecondary}; border-radius: ${token.borderRadiusLG}px;`;

export const getProviderChartOption = (data: any[], token: GlobalToken, isDark: boolean) => {
  const br = token.borderRadius;
  return {
    color: getAntdPieBlueTonalColors(token, isDark),
    tooltip: {
      trigger: 'item',
      backgroundColor: token.colorBgElevated,
      borderColor: token.colorBorderSecondary,
      borderWidth: 1,
      textStyle: { color: token.colorText, fontSize: token.fontSize },
      padding: [token.paddingSM, token.padding],
      extraCssText: chartTooltipExtraCss(token),
    },
    legend: {
      left: 'center',
      bottom: 12,
      icon: 'circle',
      itemWidth: 8,
      itemHeight: 8,
      itemGap: token.margin,
      textStyle: { color: token.colorTextSecondary, fontSize: token.fontSizeSM },
    },
    series: [
      {
        name: '资源分布',
        type: 'pie',
        radius: ['54%', '68%'],
        center: ['50%', '42%'],
        avoidLabelOverlap: false,
        itemStyle: {
          borderRadius: br,
          borderColor: token.colorBgContainer,
          borderWidth: 2,
        },
        label: { show: false, position: 'center' },
        emphasis: {
          label: {
            show: true,
            fontSize: token.fontSizeLG + 2,
            fontWeight: token.fontWeightStrong,
            color: token.colorText,
          },
          scale: true,
          scaleSize: 10,
          itemStyle: {
            shadowBlur: 8,
            shadowOffsetX: 0,
            shadowColor: token.colorBgMask,
          },
        },
        labelLine: { show: false },
        data,
        animationType: 'scale',
        animationEasing: 'elasticOut',
        animationDuration: 1200,
        animationDelay: (idx: number) => idx * 100,
      },
    ],
  };
};
