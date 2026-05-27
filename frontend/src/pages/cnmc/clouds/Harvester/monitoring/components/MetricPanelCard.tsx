/**
 * 监控大盘单个面板容器：标题（带可选 Tooltip） + loading + error + empty + 自定义内容。
 * 与 Grafana 单个 panel 类似，但是 Ant Design Card 风格，统一边距/卡片角。
 */
import React from 'react';
import { QuestionCircleOutlined } from '@ant-design/icons';
import { Alert, Card, Empty, Skeleton, Space, Typography } from 'antd';
import MonitoringTooltip from './MonitoringTooltip';

export interface MetricPanelCardProps {
  title: React.ReactNode;
  /** 说明文案：填了即在标题右侧显示问号 Tooltip */
  description?: React.ReactNode;
  /** 标题右侧自定义工具栏（如时间下拉、状态切换） */
  extra?: React.ReactNode;
  loading?: boolean;
  /** 错误信息：传入即覆盖 children，展示错误条 */
  error?: string;
  /** 判断是否空数据（用于 Empty 占位） */
  isEmpty?: boolean;
  emptyDescription?: React.ReactNode;
  /** Card 高度，默认按内容；图表面板一般传 280 / 300 */
  height?: number | string;
  /** Card body padding；默认 12 */
  bodyPadding?: number | string;
  children?: React.ReactNode;
}

const MetricPanelCard: React.FC<MetricPanelCardProps> = ({
  title,
  description,
  extra,
  loading,
  error,
  isEmpty,
  emptyDescription = '暂无数据',
  height,
  bodyPadding = 12,
  children,
}) => {
  const titleNode = (
    <Space size={6}>
      <Typography.Text strong style={{ fontSize: 14 }}>
        {title}
      </Typography.Text>
      {description ? (
        <MonitoringTooltip title={description}>
          <QuestionCircleOutlined
            style={{ color: 'rgba(0,0,0,.45)', fontSize: 12, cursor: 'help' }}
          />
        </MonitoringTooltip>
      ) : null}
    </Space>
  );

  let body: React.ReactNode;
  if (error) {
    body = <Alert type="error" showIcon message={error} />;
  } else if (loading && (isEmpty ?? true)) {
    body = <Skeleton active paragraph={{ rows: 4 }} />;
  } else if (isEmpty) {
    body = (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: typeof height === 'number' ? height - Number(bodyPadding) * 2 : 200,
        }}
      >
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={emptyDescription} />
      </div>
    );
  } else {
    body = children;
  }

  return (
    <Card
      size="small"
      title={titleNode}
      extra={extra}
      styles={{ body: { padding: bodyPadding, height: height ? `calc(${typeof height === 'number' ? `${height}px` : height} - 38px)` : undefined } }}
      style={{ height }}
    >
      {body}
    </Card>
  );
};

export default MetricPanelCard;
