/**
 * Harbor 详情页
 * 
 * 提供 Harbor 镜像仓库的详细管理功能，包括：
 * - 概览：状态、统计、快速操作
 * - 项目：项目管理、成员管理
 * - 上传镜像：本地镜像上传
 * - 复制规则：跨仓库复制配置
 * - 设置：连接配置、凭证同步
 */

import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Spin, message } from 'antd';
import PageDetailContainer from '../../../../../components/PageDetailContainer';
import { getHarborRegistry, testHarborConnection } from './shared/harborApi';
import type { HarborRegistry } from './types';

// 懒加载 Tab 组件
const OverviewSection = React.lazy(() => import('./sections/OverviewSection'));
const ProjectsSection = React.lazy(() => import('./sections/ProjectsSection'));
const UploadSection = React.lazy(() => import('./sections/UploadSection'));
const ReplicationSection = React.lazy(() => import('./sections/ReplicationSection'));
const SettingsSection = React.lazy(() => import('./sections/SettingsSection'));

/**
 * Harbor 详情页组件
 */
const HarborDetailPage: React.FC = () => {
  const { cloudId, harborId } = useParams<{ cloudId: string; harborId: string }>();
  const navigate = useNavigate();
  const [harbor, setHarbor] = useState<HarborRegistry | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('overview');

  /**
   * 加载 Harbor 实例信息
   */
  const loadHarbor = useCallback(async () => {
    if (!harborId) return;
    setLoading(true);
    try {
      const res = await getHarborRegistry(harborId);
      setHarbor(res);
    } catch (e: any) {
      console.error('加载 Harbor 信息失败:', e);
      message.error(e?.message || '加载 Harbor 信息失败');
    } finally {
      setLoading(false);
    }
  }, [harborId]);

  /**
   * 测试连接
   */
  const handleTestConnection = useCallback(async () => {
    if (!harborId) return;
    const hide = message.loading('正在测试连接...', 0);
    try {
      const res = await testHarborConnection(harborId);
      hide();
      if (res?.success) {
        message.success('连接测试成功');
        // 更新状态
        setHarbor(prev => prev ? { ...prev, status: 'healthy', version: res.version || prev.version } : null);
      } else {
        message.warning('连接测试失败');
        setHarbor(prev => prev ? { ...prev, status: 'unhealthy' } : null);
      }
    } catch (e: any) {
      hide();
      message.error(e?.message || '连接测试失败');
      setHarbor(prev => prev ? { ...prev, status: 'unhealthy' } : null);
    }
  }, [harborId]);

  useEffect(() => {
    loadHarbor();
  }, [loadHarbor]);

  // 加载状态
  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 400 }}>
        <Spin size="large" tip="加载 Harbor 信息..." />
      </div>
    );
  }

  // 不存在状态
  if (!harbor) {
    return (
      <div style={{ textAlign: 'center', padding: 80 }}>
        <h3>Harbor 不存在</h3>
        <p style={{ color: '#888' }}>指定的 Harbor 实例未找到或已被删除</p>
      </div>
    );
  }

  return (
    <PageDetailContainer
      title={harbor.name}
      icon={<span style={{ color: '#4a00d8', fontSize: 20 }}>⚓</span>}
      onBack={() => navigate(-1)}
      tabs={[
        {
          key: 'overview',
          label: '概览',
          children: (
            <React.Suspense fallback={<Spin />}>
              <OverviewSection 
                harbor={harbor} 
                cloudId={cloudId}
                onRefresh={loadHarbor} 
                onTestConnection={handleTestConnection}
              />
            </React.Suspense>
          ),
        },
        {
          key: 'projects',
          label: '项目',
          children: (
            <React.Suspense fallback={<Spin />}>
              <ProjectsSection harbor={harbor} />
            </React.Suspense>
          ),
        },
        {
          key: 'upload',
          label: '上传镜像',
          children: (
            <React.Suspense fallback={<Spin />}>
              <UploadSection harbor={harbor} />
            </React.Suspense>
          ),
        },
        {
          key: 'replication',
          label: '复制规则',
          children: (
            <React.Suspense fallback={<Spin />}>
              <ReplicationSection harbor={harbor} />
            </React.Suspense>
          ),
        },
        {
          key: 'settings',
          label: '设置',
          children: (
            <React.Suspense fallback={<Spin />}>
              <SettingsSection harbor={harbor} onRefresh={loadHarbor} />
            </React.Suspense>
          ),
        },
      ]}
      activeTabKey={activeTab}
      onTabChange={setActiveTab}
    />
  );
};

export default HarborDetailPage;
