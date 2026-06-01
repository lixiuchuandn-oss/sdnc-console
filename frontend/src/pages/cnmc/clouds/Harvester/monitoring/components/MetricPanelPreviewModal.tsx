/**
 * 监控面板「大图」预览弹窗：放大展示图表等内容，loading / error / empty 与 MetricPanelCard 一致。
 * ECharts 异步模式：Modal 展开后挂载图表实例，数据到达后 setOption 更新（不用 Skeleton 挡住图表）。
 */
import React, { useEffect, useState } from 'react';
import { QuestionCircleOutlined } from '@ant-design/icons';
import { Alert, Empty, Modal, Space, Typography } from 'antd';
import { MonitoringPopover } from './MonitoringPopover';

const PREVIEW_CHART_WRAP_STYLE: React.CSSProperties = {
  width: '100%',
  minWidth: 0,
};

export interface MetricPanelPreviewModalProps {
  open: boolean;
  onClose: () => void;
  title: React.ReactNode;
  description?: React.ReactNode;
  loading?: boolean;
  error?: string;
  isEmpty?: boolean;
  width?: number | string;
  children?: React.ReactNode;
}

const MetricPanelPreviewModal: React.FC<MetricPanelPreviewModalProps> = ({
  open,
  onClose,
  title,
  description,
  loading,
  error,
  isEmpty,
  width = 960,
  children,
}) => {
  /** Modal 动画结束后再挂载图表，避免 ECharts 在 width≈0 时初始化 */
  const [chartReady, setChartReady] = useState(false);

  useEffect(() => {
    if (!open) {
      setChartReady(false);
    }
  }, [open]);

  const titleNode = (
    <Space size={6}>
      <Typography.Text strong style={{ fontSize: 16 }}>
        {title}
      </Typography.Text>
      {description ? (
        <MonitoringPopover title={description}>
          <QuestionCircleOutlined style={{ color: 'rgba(0,0,0,.45)', fontSize: 12, cursor: 'help' }} />
        </MonitoringPopover>
      ) : null}
    </Space>
  );

  let body: React.ReactNode;
  if (error) {
    body = <Alert type="error" showIcon message={error} />;
  } else if (!chartReady) {
    body = <div style={{ minHeight: 320 }} />;
  } else if (!loading && isEmpty) {
    body = (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 320 }}>
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无数据" />
      </div>
    );
  } else {
    body = <div style={PREVIEW_CHART_WRAP_STYLE}>{children}</div>;
  }

  return (
    <Modal
      open={open}
      onCancel={onClose}
      footer={null}
      width={width}
      title={titleNode}
      destroyOnHidden
      styles={{ body: { paddingTop: 16 } }}
      afterOpenChange={(visible) => {
        if (visible) {
          setChartReady(true);
        }
      }}
    >
      {body}
    </Modal>
  );
};

export default MetricPanelPreviewModal;
