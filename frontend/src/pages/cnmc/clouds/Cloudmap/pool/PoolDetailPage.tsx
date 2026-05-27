// 页面门控分三层：
// 1) License/Feature：能力是否启用
// 2) RBAC：用户是否有读写权限
// 3) 列表扩展列（项目/租户等）：管理员默认展示，可用列设置隐藏；Tab 显隐由授权 + 各叶 poolPageAction 决定
//
// 资源状态与加载编排见 `hooks/useCloudmapPoolDetailEngine.ts`（便于后续按路由拆 Context）。

import React from 'react';
import { Alert } from 'antd';

import { CloudmapPoolDetailProvider, CloudmapPoolRoutes } from './routing';
import PageDetailContainer from '../../../../../components/PageDetailContainer';
import './styles/layout.css';
import { HarvesterPublicNamespacesProvider } from '../../Harvester/shared/context/HarvesterPublicNamespacesContext';
import { useCloudmapPoolDetailEngine } from './hooks/useCloudmapPoolDetailEngine';

const PoolDetailPage: React.FC<{ cloudId: string }> = ({ cloudId }) => {
  const { cloudmapPoolDetailValue, error } = useCloudmapPoolDetailEngine(cloudId);

  return (
    <HarvesterPublicNamespacesProvider cloudId={cloudId}>
      <PageDetailContainer
        hideHeader
        asCard={false}
        pagePadding={0}
        rootStyle={{
          height: '100%',
          maxHeight: '100%',
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          boxSizing: 'border-box',
        }}
        contentWrapperStyle={{
          flex: 1,
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
          overflowX: 'hidden',
          overflowY: 'auto',
        }}
      >
        {error && (
          <Alert
            type="error"
            message="查询失败"
            description={error}
            style={{ margin: '24px 24px 16px', flexShrink: 0 }}
            showIcon
          />
        )}
        <CloudmapPoolDetailProvider value={cloudmapPoolDetailValue}>
          <CloudmapPoolRoutes />
        </CloudmapPoolDetailProvider>
      </PageDetailContainer>
    </HarvesterPublicNamespacesProvider>
  );
};

export default PoolDetailPage;
