/**
 * Harbor 仓库详情页（制品列表）
 * 
 * 展示仓库中的所有制品（Artifacts）
 */

import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Spin, message } from 'antd';
import PageDetailContainer from '../../../../../components/PageDetailContainer';
import ArtifactsSection from './sections/ArtifactsSection';
import { getHarborRegistry, getHarborProject } from './shared/harborApi';

/**
 * 仓库详情页组件
 */
const RepositoryDetailPage: React.FC = () => {
  const { harborId, projectName, repoName } = useParams<{
    cloudId: string;
    harborId: string;
    projectName: string;
    repoName: string;
  }>();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);

  const decodedProjectName = projectName ? decodeURIComponent(projectName) : '';
  const decodedRepoName = repoName ? decodeURIComponent(repoName) : '';

  const loadData = useCallback(async () => {
    if (!harborId || !decodedProjectName) return;
    setLoading(true);
    try {
      await Promise.all([
        getHarborRegistry(harborId),
        getHarborProject(harborId, decodedProjectName),
      ]);
    } catch (e: any) {
      console.error('加载数据失败:', e);
      message.error(e?.message || '加载数据失败');
    } finally {
      setLoading(false);
    }
  }, [harborId, decodedProjectName]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 400 }}>
        <Spin size="large" tip="加载中..." />
      </div>
    );
  }

  const repoDisplayName = decodedRepoName.includes('/')
    ? decodedRepoName.split('/').pop()
    : decodedRepoName;

  return (
    <PageDetailContainer
      title={`${decodedProjectName} / ${repoDisplayName}`}
      icon={<span style={{ color: '#4a00d8', fontSize: 20 }}>📦</span>}
      onBack={() => navigate(-1)}
      tabs={[
        {
          key: 'artifacts',
          label: '制品列表',
          children: (
            <ArtifactsSection
              harborId={harborId!}
              projectName={decodedProjectName}
              repositoryName={decodedRepoName}
            />
          ),
        },
      ]}
      activeTabKey="artifacts"
    />
  );
};

export default RepositoryDetailPage;
