/**
 * Harbor 详情抽屉
 * 
 * 提供 Harbor 镜像仓库的详细管理功能，包括：
 * - 概览：状态、统计、快速操作
 * - 项目：项目管理、成员管理
 * - 上传镜像：本地镜像上传
 * - 复制规则：跨仓库复制配置
 * - 设置：连接配置、凭证同步
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Drawer, Tabs, Spin, message } from 'antd';
import { getHarborRegistry, testHarborConnection } from '../shared/harborApi';
import type { HarborRegistry, HarborProject } from '../types';

const HarborIcon: React.FC<{ style?: React.CSSProperties }> = ({ style }) => (
  <svg
    viewBox="0 0 1024 1024"
    width="1.4em"
    height="1.4em"
    style={{ ...style, verticalAlign: '-0.2em' }}
  >
    <path d="M512 506.930693m-506.930693 0a506.930693 506.930693 0 1 0 1013.861386 0 506.930693 506.930693 0 1 0-1013.861386 0Z" fill="#696566" />
    <path d="M512 506.930693m-405.544554 0a405.544554 405.544554 0 1 0 811.089108 0 405.544554 405.544554 0 1 0-811.089108 0Z" fill="#FFFFFF" />
    <path d="M494.865743 403.303921L798.872079 89.432713c22.994376 15.623604 43.018139 31.328317 60.071287 47.083723 17.053149 15.765545 33.802139 34.065743 50.246971 54.900594L494.865743 403.314059zM512 424.118495l454.524198-140.926733c12.054812 23.633109 21.453307 45.502099 28.185347 65.596832a347.511129 347.511129 0 0 1 14.630019 61.987485L512 424.118495zM503.716752 448.836436l514.788119 39.692673c0.95303 17.306614 0.141941 38.932277-2.402851 64.897267-2.554931 25.96499-6.184554 49.435881-10.89901 70.412674l-501.486258-174.992476z" fill="#83B8E2" />
    <path d="M293.512871 378.302099v-27.526337l87.496238-87.47596v-7.948673a10.067644 10.067644 0 1 1 20.135287 0v7.948673l87.486099 87.47596v27.526337h-13.991287v97.340832h13.991287v47.590653h-13.991287l29.503366 490.759604c-45.512238-2.382574-85.194772-7.745901-119.047604-16.08998-33.842693-8.333941-67.604277-21.06804-101.264475-38.192158l32.747723-436.467327H293.512871v-47.600792h15.998733v-97.340832H293.512871z" fill="#4FA434" />
    <path d="M311.782653 586.468119l171.271604 76.749307 1.571486 26.309703-174.586931-79.162297zM307.362218 645.241663l179.625822 80.703367 1.470099 27.100515-182.900594-82.649981zM302.343604 713.210931l188.933069 86.076831 1.926337 27.637862-193.252119-86.725703zM297.051248 782.143366l198.483643 90.030891 1.68301 27.648-202.204515-89.473267zM335.081188 378.44404h115.093545v97.462495h-29.128238v-43.271604a29.33101 29.33101 0 1 0-58.66202 0v43.271604H335.081188v-97.462495z" fill="#FFFFFF" />
  </svg>
);

// 懒加载 Tab 组件
const OverviewSection = React.lazy(() => import('../sections/OverviewSection'));
const ProjectsSection = React.lazy(() => import('../sections/ProjectsSection'));
const UploadSection = React.lazy(() => import('../sections/UploadSection'));
const ReplicationSection = React.lazy(() => import('../sections/ReplicationSection'));
const SettingsSection = React.lazy(() => import('../sections/SettingsSection'));

interface Props {
  visible: boolean;
  harborId: string;
  cloudId: string;
  onClose: () => void;
  onOpenProject?: (project: HarborProject) => void;
}

/**
 * Harbor 详情抽屉组件
 */
const HarborDetailDrawer: React.FC<Props> = ({
  visible,
  harborId,
  cloudId,
  onClose,
  onOpenProject,
}) => {
  const [harbor, setHarbor] = useState<HarborRegistry | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('projects');

  /**
   * 加载 Harbor 实例信息
   */
  const loadHarbor = useCallback(async () => {
    if (!harborId || !visible) return;
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
  }, [harborId, visible]);

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

  /**
   * 导航到上传镜像 Tab
   */
  const handleNavigateToUpload = useCallback(() => {
    setActiveTab('upload');
  }, []);

  useEffect(() => {
    if (visible) {
      loadHarbor();
      setActiveTab('projects'); // 默认选中项目 tab
    }
  }, [visible, loadHarbor]);

  // 不显示时返回 null
  if (!visible) return null;

  return (
    <Drawer
      title={
        <span>
          <HarborIcon style={{ color: '#4a00d8', marginRight: 8 }} />
          {harbor?.name || 'Harbor 详情'}
        </span>
      }
      placement="right"
      width={1200}
      open={visible}
      onClose={onClose}
      destroyOnClose
    >
      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 400 }}>
          <Spin size="large" tip="加载 Harbor 信息..." />
        </div>
      ) : !harbor ? (
        <div style={{ textAlign: 'center', padding: 80 }}>
          <h3>Harbor 不存在</h3>
          <p style={{ color: '#888' }}>指定的 Harbor 实例未找到或已被删除</p>
        </div>
      ) : (
        <Tabs
          activeKey={activeTab}
          onChange={setActiveTab}
          items={[
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
                    onNavigateToUpload={handleNavigateToUpload}
                  />
                </React.Suspense>
              ),
            },
            {
              key: 'projects',
              label: '项目',
              children: (
                <React.Suspense fallback={<Spin />}>
                  <ProjectsSection 
                    harbor={harbor}
                    onViewProject={onOpenProject}
                  />
                </React.Suspense>
              ),
            },
            {
              key: 'upload',
              label: '推送命令',
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
        />
      )}
    </Drawer>
  );
};

export default HarborDetailDrawer;
