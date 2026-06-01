import React from 'react';
import { Button } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';

type Props = {
  loading?: boolean;
  onRefresh: () => void;
};

/** 资源池概览 · 资源池信息卡右上角刷新钮；加载态由外层 OverviewSectionSpin 统一展示，此处仅禁用 */
const OverviewPoolRefreshButton: React.FC<Props> = ({ loading, onRefresh }) => (
  <div className="toolbar-actions">
    <Button icon={<ReloadOutlined />} disabled={loading} onClick={onRefresh} />
  </div>
);

export default OverviewPoolRefreshButton;
