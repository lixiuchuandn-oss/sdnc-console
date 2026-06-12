/**
 * Harbor 仓库详情抽屉
 * 
 * 提供仓库的详细管理功能，包括：
 * - 概览：仓库基本信息、统计
 * - 制品：仓库下的制品列表
 */

import React, { useState } from 'react';
import { Drawer, Tabs, Spin, Descriptions, Card, Statistic, Space, Button, Tag, Row, Col } from 'antd';
import { 
  DatabaseOutlined, 
  TagOutlined,
  CloudDownloadOutlined,
  ArrowLeftOutlined,
  ClockCircleOutlined,
} from '@ant-design/icons';
import type { HarborRepository } from '../types';
import type { HarborProjectRef } from '../shared/harborApi';

// 懒加载 Tab 组件
const ArtifactsSection = React.lazy(() => import('../sections/ArtifactsSection'));

interface Props {
  visible: boolean;
  harborId: string;
  project: HarborProjectRef;
  repository: HarborRepository | null;
  cloudId: string;
  onClose: () => void;
  onBack: () => void;
  currentUserRole?: number;
}

/**
 * Harbor 仓库详情抽屉组件
 */
const RepositoryDetailDrawer: React.FC<Props> = ({
  visible,
  harborId,
  project: projectProp,
  repository,
  cloudId: _cloudId,
  onClose,
  onBack,
  currentUserRole: currentUserRoleProp,
}) => {
  const [activeTab, setActiveTab] = useState('artifacts');
  const currentUserRole = projectProp.currentUserRole ?? currentUserRoleProp;

  const project = projectProp;

  /**
   * 格式化时间
   */
  const formatTime = (time: string) => {
    if (!time) return '-';
    try {
      return new Date(time).toLocaleString('zh-CN');
    } catch {
      return time;
    }
  };

  // 概览内容
  const overviewContent = repository && (
    <div>
      <Card size="small" style={{ marginBottom: 16 }}>
        <Row gutter={16}>
          <Col span={8}>
            <Statistic 
              title="制品数" 
              value={repository.artifactCount || 0}
              prefix={<TagOutlined style={{ color: '#1890ff' }} />}
            />
          </Col>
          <Col span={8}>
            <Statistic 
              title="拉取次数" 
              value={repository.pullCount || 0}
              prefix={<CloudDownloadOutlined style={{ color: '#52c41a' }} />}
            />
          </Col>
          <Col span={8}>
            <Statistic 
              title="更新时间" 
              value={formatTime(repository.updatedAt || '').split(' ')[0]}
              prefix={<ClockCircleOutlined />}
              valueStyle={{ fontSize: 16 }}
            />
          </Col>
        </Row>
      </Card>

      <Card size="small">
        <Descriptions column={2} bordered size="small">
          <Descriptions.Item label="仓库名称">
            <Space>
              <DatabaseOutlined style={{ color: '#1890ff' }} />
              <span>{repository.name}</span>
            </Space>
          </Descriptions.Item>
          <Descriptions.Item label="项目">
            <Tag color="blue">{project.name}</Tag>
          </Descriptions.Item>
          <Descriptions.Item label="制品数量">
            {repository.artifactCount || 0}
          </Descriptions.Item>
          <Descriptions.Item label="拉取次数">
            {repository.pullCount || 0}
          </Descriptions.Item>
          <Descriptions.Item label="创建时间">
            {formatTime(repository.createdAt || '')}
          </Descriptions.Item>
          <Descriptions.Item label="更新时间">
            {formatTime(repository.updatedAt || '')}
          </Descriptions.Item>
        </Descriptions>
      </Card>
    </div>
  );

  if (!repository) return null;

  return (
    <Drawer
      title={
        <Space>
          <Button type="text" icon={<ArrowLeftOutlined />} onClick={onBack}>
            返回
          </Button>
          <DatabaseOutlined style={{ color: '#1890ff' }} />
          <span>{repository.name}</span>
        </Space>
      }
      placement="right"
      width={1200}
      open={visible}
      onClose={onClose}
      destroyOnClose
    >
      <Tabs
        activeKey={activeTab}
        onChange={setActiveTab}
        items={[
          {
            key: 'overview',
            label: '概览',
            children: <div style={{ padding: 16 }}>{overviewContent}</div>,
          },
          {
            key: 'artifacts',
            label: '制品',
            children: (
              <React.Suspense fallback={<Spin />}>
                <ArtifactsSection 
                  harborId={harborId} 
                  project={project}
                  repositoryName={repository.name}
                  currentUserRole={currentUserRole}
                />
              </React.Suspense>
            ),
          },
        ]}
      />
    </Drawer>
  );
};

export default RepositoryDetailDrawer;
