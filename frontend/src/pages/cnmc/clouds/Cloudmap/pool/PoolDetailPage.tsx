// 页面门控分三层：
// 1) License/Feature：能力是否启用
// 2) RBAC：用户是否有读写权限
// 3) 标准/运维（mode）：仅影响各 Section 内交互/展示细节；Tab 显隐仅由授权 + RBAC 决定
//
// 资源状态与加载编排见 `hooks/useCloudmapPoolDetailEngine.ts`（便于后续按路由拆 Context）。

import React from 'react';
import { Alert } from 'antd';

import PoolRoutes, { CloudmapPoolDetailProvider } from './routing';
import PageDetailContainer from '../../../../../components/PageDetailContainer';
import './styles/cloudmap-detail-layout.css';
import './styles/cloudmap-resource-hub-inner-tabs.css';
import { HarvesterPublicNamespacesProvider } from '../../Harvester/context/HarvesterPublicNamespacesContext';
import { useCloudmapPoolDetailEngine } from './hooks/useCloudmapPoolDetailEngine';

const PoolDetailPage: React.FC<{ cloudId: string }> = ({ cloudId }) => {
  const { cloudmapPoolDetailValue, error } = useCloudmapPoolDetailEngine(cloudId);

  return (
    <HarvesterPublicNamespacesProvider cloudId={cloudId}>
      <PageDetailContainer
        hideHeader
        asCard={false}
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
          overflow: 'hidden',
        }}
      >
        {error && (
          <Alert
            type="error"
            message="查询失败"
            description={error}
            style={{ marginBottom: 16, flexShrink: 0 }}
            showIcon
          />
        )}
        <CloudmapPoolDetailProvider value={cloudmapPoolDetailValue}>
          <PoolRoutes />
        </CloudmapPoolDetailProvider>
      </PageDetailContainer>
    </HarvesterPublicNamespacesProvider>
  );
};

export default PoolDetailPage;
