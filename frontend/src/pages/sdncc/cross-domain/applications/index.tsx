import React, { useCallback, useRef, useState } from 'react';
import { message } from 'antd';
import PageContainer from '../../../../components/PageContainer';
import DiscoveredAssets from './components/DiscoveredAssets';
import ApplicationListSection, {
  type ApplicationListCatalog,
  type ApplicationListSectionHandle,
} from './section/ApplicationListSection';

/**
 * 安全应用入口：Tab 壳层（应用列表域见 ApplicationListSection）。
 */
const SecurityApps: React.FC = () => {
  const [activeTab, setActiveTab] = useState('list');
  const listRef = useRef<ApplicationListSectionHandle>(null);
  const [catalog, setCatalog] = useState<ApplicationListCatalog>({ apps: [], allDomains: [] });

  const handleCatalogChange = useCallback((c: ApplicationListCatalog) => {
    setCatalog(c);
  }, []);

  const handleCreateFromAsset = useCallback((asset: any) => {
    listRef.current?.openCreateFromDiscoveryAsset(asset);
    setActiveTab('list');
  }, []);

  const handleLinkToApp = useCallback(() => {
    message.info('请在应用列表中找到目标应用，点击编辑并添加此IP地址。');
    setActiveTab('list');
  }, []);

  return (
    <PageContainer
      titleLevel={3}
      asCard={false}
      bordered={false}
      tabList={[
        { key: 'list', tab: <span>应用列表 </span> },
        { key: 'discovery', tab: <span>资产发现 </span> },
      ]}
      tabActiveKey={activeTab}
      onTabChange={setActiveTab}
    >
      {/* 列表域需保持挂载以执行首屏加载；切换 Tab 时仅隐藏 */}
      <div style={{ display: activeTab === 'list' ? undefined : 'none' }}>
        <ApplicationListSection ref={listRef} onCatalogChange={handleCatalogChange} />
      </div>
      {activeTab === 'discovery' ? (
        <DiscoveredAssets
          domains={catalog.allDomains}
          existingApps={catalog.apps}
          onCreateApp={handleCreateFromAsset}
          onLinkApp={handleLinkToApp}
        />
      ) : null}
    </PageContainer>
  );
};

export default SecurityApps;
