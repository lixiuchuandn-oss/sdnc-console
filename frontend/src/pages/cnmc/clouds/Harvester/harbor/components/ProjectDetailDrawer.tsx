/**
 * Harbor 项目详情抽屉
 * 
 * 提供项目的详细管理功能，包括：
 * - 概览：项目基本信息、统计
 * - 仓库：项目下的镜像仓库列表
 * - 成员：项目成员管理
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Drawer, Tabs, Spin, message, Tag, Descriptions, Card, Row, Col, Statistic, Space, Button } from 'antd';
import { 
  TeamOutlined, 
  LockOutlined, 
  UnlockOutlined,
  DatabaseOutlined,
  CloudDownloadOutlined,
  HddOutlined,
  ArrowLeftOutlined,
} from '@ant-design/icons';
import { 
  getHarborProject, 
  getHarborProjectSummary,
  getHarborRegistry,
  setHarborApiCloudId,
} from '../shared/harborApi';
import type { HarborProject, HarborProjectSummary, HarborRegistry, HarborRepository, HarborProjectWithTenant } from '../types';
import { isHarborProjectPublic } from '../shared/projectVisibility';
import type { HarborProjectRef } from '../shared/harborApi';

// 懒加载 Tab 组件
const RepositoriesSection = React.lazy(() => import('../sections/RepositoriesSection'));
const MembersSection = React.lazy(() => import('../sections/MembersSection'));

interface Props {
  visible: boolean;
  harborId: string;
  project: HarborProjectRef;
  cloudId: string;
  onClose: () => void;
  onBack: () => void;
  onOpenRepository?: (repo: HarborRepository) => void;
}

/**
 * Harbor 项目详情抽屉组件
 */
const ProjectDetailDrawer: React.FC<Props> = ({
  visible,
  harborId,
  project: projectRef,
  cloudId,
  onClose,
  onBack,
  onOpenRepository,
}) => {
  const [project, setProject] = useState<HarborProjectWithTenant | null>(null);
  const [summary, setSummary] = useState<HarborProjectSummary | null>(null);
  const [harbor, setHarbor] = useState<HarborRegistry | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('overview');

  /**
   * 格式化存储大小
   */
  const formatStorageSize = (bytes: number) => {
    if (!bytes) return '0 GB';
    const gb = bytes / 1024 / 1024 / 1024;
    return `${gb.toFixed(2)} GB`;
  };

  /**
   * 加载项目和统计信息
   */
  const loadData = useCallback(async () => {
    if (!harborId || !projectRef?.name || !visible) return;
    setLoading(true);
    try {
      // 并行加载项目详情、统计和 Harbor 信息
      const [projectRes, summaryRes, harborRes] = await Promise.all([
        getHarborProject(harborId, projectRef),
        getHarborProjectSummary(harborId, projectRef),
        getHarborRegistry(harborId, cloudId),
      ]);
      setProject(projectRes);
      setSummary(summaryRes);
      setHarbor(harborRes);

    } catch (e: any) {
      console.error('加载项目信息失败:', e);
      message.error(e?.message || '加载项目信息失败');
    } finally {
      setLoading(false);
    }
  }, [harborId, projectRef, cloudId, visible]);

  useEffect(() => {
    if (visible && cloudId) {
      setHarborApiCloudId(cloudId);
    }
    return () => {
      if (visible) {
        setHarborApiCloudId(undefined);
      }
    };
  }, [visible, cloudId]);

  useEffect(() => {
    if (visible) {
      loadData();
      setActiveTab('repositories'); // 默认选中仓库 tab
    }
  }, [visible, loadData]);

  // 不显示时返回 null
  if (!visible) return null;

  const isPublic = isHarborProjectPublic(project ?? undefined);

  // 概览内容
  const overviewContent = (
    <div>
      <Row gutter={16}>
        <Col span={6}>
          <Card size="small">
            <Statistic
              title="仓库数量"
              value={summary?.repoCount || 0}
              prefix={<DatabaseOutlined />}
              valueStyle={{ color: '#1890ff' }}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card size="small">
            <Statistic
              title="制品数量"
              value={summary?.artifactCount || 0}
              prefix={<HddOutlined />}
              valueStyle={{ color: '#52c41a' }}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card size="small">
            <Statistic
              title="拉取次数"
              value={summary?.pullCount || 0}
              prefix={<CloudDownloadOutlined />}
              valueStyle={{ color: '#722ed1' }}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card size="small">
            <Statistic
              title="存储使用"
              value={formatStorageSize(summary?.storageSize || 0)}
              valueStyle={{ color: '#fa8c16' }}
            />
          </Card>
        </Col>
      </Row>

      <Card size="small" style={{ marginTop: 16 }}>
        <Descriptions column={2} bordered size="small">
          <Descriptions.Item label="项目名称">
            <Space>
              <TeamOutlined style={{ color: '#1890ff' }} />
              <span>{project?.name}</span>
            </Space>
          </Descriptions.Item>
          <Descriptions.Item label="项目 ID">{project?.projectId}</Descriptions.Item>
          <Descriptions.Item label="所有者">{project?.ownerName || '-'}</Descriptions.Item>
          <Descriptions.Item label="访问级别">
            <Tag color={isPublic ? 'green' : 'blue'} icon={isPublic ? <UnlockOutlined /> : <LockOutlined />}>
              {isPublic ? '公开' : '私有'}
            </Tag>
          </Descriptions.Item>
          <Descriptions.Item label="创建时间">
            {project?.createdAt ? new Date(project.createdAt).toLocaleString('zh-CN') : '-'}
          </Descriptions.Item>
          <Descriptions.Item label="Harbor 实例">
            {harbor?.name || '-'}
          </Descriptions.Item>
        </Descriptions>
      </Card>
    </div>
  );

  return (
    <Drawer
      title={
        <Space>
          <Button type="text" icon={<ArrowLeftOutlined />} onClick={onBack}>
            返回
          </Button>
          <TeamOutlined style={{ color: '#1890ff' }} />
          <span>{project?.name || '项目详情'}</span>
        </Space>
      }
      placement="right"
      width={1200}
      open={visible}
      onClose={onClose}
      destroyOnClose
    >
      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 400 }}>
          <Spin size="large" tip="加载项目信息..." />
        </div>
      ) : !project ? (
        <div style={{ textAlign: 'center', padding: 80 }}>
          <h3>项目不存在</h3>
          <p style={{ color: '#888' }}>指定的项目未找到或已被删除</p>
        </div>
      ) : (
        <Tabs
          activeKey={activeTab}
          onChange={setActiveTab}
          items={[
            {
              key: 'overview',
              label: '概览',
              icon: <TeamOutlined />,
              children: <div style={{ padding: 16 }}>{overviewContent}</div>,
            },
            {
              key: 'repositories',
              label: '仓库',
              icon: <DatabaseOutlined />,
              children: (
                <React.Suspense fallback={<Spin />}>
                  <RepositoriesSection
                    harborId={harborId}
                    project={projectRef}
                    onViewRepository={onOpenRepository}
                    currentUserRole={project?.currentUserRole}
                  />
                </React.Suspense>
              ),
            },
            {
              key: 'members',
              label: '成员',
              icon: <TeamOutlined />,
              children: (
                <React.Suspense fallback={<Spin />}>
                  <MembersSection 
                    harborId={harborId} 
                    project={projectRef}
                    harborRegistry={harbor ?? undefined}
                    isProjectAdmin={project?.currentUserRole === 1}
                  />
                </React.Suspense>
              ),
            },
          ]}
        />
      )}
    </Drawer>
  );
};

export default ProjectDetailDrawer;
