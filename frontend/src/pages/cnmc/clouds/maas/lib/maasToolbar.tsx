import React from 'react';
import { OverviewPoolRefreshButton } from '../../../../../components/overview';

/**
 * MAAS 池工具栏刷新钮（仅图标 Button）。
 * 须置于 `div.toolbar-actions` 内（见 frontend-layout.md §5.2）。
 */
export const MaasToolbarRefresh: React.FC<{
  loading?: boolean;
  onRefresh: () => void;
}> = ({ loading, onRefresh }) => (
  <OverviewPoolRefreshButton loading={loading} onRefresh={onRefresh} />
);
