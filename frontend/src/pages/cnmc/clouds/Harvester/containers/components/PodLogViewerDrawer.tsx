/**
 * Pod 日志抽屉：Drawer 壳 + 复用 PodLogViewer
 */
import React from 'react';
import { Drawer, Button, Space } from 'antd';
import { ArrowLeftOutlined } from '@ant-design/icons';
import PodLogViewer from './PodLogViewer';

export interface PodLogViewerDrawerProps {
  cloudId: string;
  namespace: string;
  podName: string;
  containers: string[];
  open: boolean;
  onClose: () => void;
  onBack?: () => void;
  width?: number;
  /** 与列表/拓扑内联抽屉历史默认一致 */
  defaultTailLines?: number;
}

const PodLogViewerDrawer: React.FC<PodLogViewerDrawerProps> = ({
  cloudId,
  namespace,
  podName,
  containers,
  open,
  onClose,
  onBack,
  width = 800,
  defaultTailLines = 500,
}) => (
  <Drawer
    title={
      <Space>
        {onBack ? (
          <Button type="text" icon={<ArrowLeftOutlined />} onClick={onBack}>
            返回
          </Button>
        ) : null}
        <span>日志: {podName}</span>
      </Space>
    }
    placement="right"
    width={width}
    open={open}
    onClose={onClose}
    destroyOnClose
  >
    {open ? (
      <PodLogViewer
        cloudId={cloudId}
        namespace={namespace}
        podName={podName}
        containers={containers}
        height="calc(100vh - 150px)"
        defaultTailLines={defaultTailLines}
      />
    ) : null}
  </Drawer>
);

export default PodLogViewerDrawer;
