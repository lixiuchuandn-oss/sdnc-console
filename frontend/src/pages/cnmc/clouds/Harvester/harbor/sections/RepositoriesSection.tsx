/**
 * 仓库列表 Section
 * 
 * 用于在项目详情页中展示仓库列表
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Table, Button, Input, Space, Tag, message, Tooltip, Typography } from 'antd';
import { 
  SearchOutlined, 
  ReloadOutlined, 
  DownOutlined,
  CopyOutlined,
  UploadOutlined,
  UnorderedListOutlined,
} from '@ant-design/icons';
import { getHarborRepositories, deleteHarborRepository, getHarborRegistry } from '../shared/harborApi';
import ResourceActionsDropdown from '../../../../../../components/ResourceActionsDropdown';
import {
  confirmHighRiskDelete,
  DELETE_RISK_ITEMS,
} from '../../shared/lib/highRiskConfirm';
import HarborUploadModal from '../components/HarborUploadModal';
import HarborUploadTasksDrawer from '../components/HarborUploadTasksDrawer';
import type { HarborRepository, HarborRegistry } from '../types';
import type { HarborProjectRef } from '../shared/harborApi';
import { useAuth } from '../../../../../../contexts/AuthContext';

const { Text } = Typography;

interface Props {
  /** Harbor 实例 ID */
  harborId: string;
  /** 项目引用（纯数字项目名需携带 projectId） */
  project: HarborProjectRef;
  /** 查看仓库制品回调 */
  onViewRepository?: (repo: HarborRepository) => void;
  /** 当前用户在项目中的角色（用于权限控制） */
  currentUserRole?: number;
}

/**
 * 仓库列表组件
 */
const RepositoriesSection: React.FC<Props> = ({
  harborId,
  project,
  onViewRepository,
  currentUserRole,
}) => {
  const { user } = useAuth();
  const projectName = project.name;
  const [repositories, setRepositories] = useState<HarborRepository[]>([]);
  const [harbor, setHarbor] = useState<HarborRegistry | null>(null);
  const [loading, setLoading] = useState(false);
  const [keyword, setKeyword] = useState('');
  const [repositoryName, setRepositoryName] = useState<string>('');
  const [tag, setTag] = useState<string>('latest');
  const [dropdownVisible, setDropdownVisible] = useState(false);
  const [uploadModalVisible, setUploadModalVisible] = useState(false);
  const [tasksDrawerVisible, setTasksDrawerVisible] = useState(false);
  const tagInputRef = useRef<any>(null);
  const firstInputRef = useRef<any>(null);
  const lastButtonRef = useRef<any>(null);

  /**
   * 权限控制
   * - 系统管理员：完全控制权限
   * - role_id=1（项目管理员）：完全控制权限
   * - role_id=2（开发者）：可推送和拉取镜像
   * - role_id=3（访客）：只能查看项目资源
   * - role_id=4（维护人员）：维护和镜像管理
   * - role_id=5（受限访客）：最小权限
   * - undefined（公开项目访客）：只读
   */
  const isSystemAdmin = user?.role === 'super_admin' || user?.role === 'admin';
  const canWrite = isSystemAdmin || (currentUserRole !== undefined && [1, 2, 4].includes(currentUserRole));

  /**
   * 加载仓库列表
   */
  const loadRepositories = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getHarborRepositories(harborId, project);
      const list = Array.isArray(res) ? res : (res?.data || []);
      setRepositories(list);
    } catch (e: any) {
      console.error('加载仓库列表失败:', e);
      message.error(e?.message || '加载仓库列表失败');
    } finally {
      setLoading(false);
    }
  }, [harborId, project]);

  /**
   * 加载 Harbor 信息
   */
  const loadHarbor = useCallback(async () => {
    try {
      const res = await getHarborRegistry(harborId);
      setHarbor(res);
    } catch (e: any) {
      console.warn('加载 Harbor 信息失败:', e);
    }
  }, [harborId]);

  useEffect(() => {
    loadRepositories();
    loadHarbor();
  }, [loadRepositories, loadHarbor]);

  /**
   * 删除仓库
   */
  const handleDelete = async (repo: HarborRepository) => {
    try {
      await deleteHarborRepository(harborId, project, repo.name);
      message.success('仓库已删除');
      loadRepositories();
    } catch (e: any) {
      message.error(e?.message || '删除失败');
    }
  };

  /**
   * 查看制品列表
   */
  const handleViewArtifacts = (repo: HarborRepository) => {
    onViewRepository?.(repo);
  };

  /**
   * 格式化时间
   */
  const formatTime = (time: string) => {
    if (!time) return '-';
    try {
      return new Date(time).toLocaleString('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return time;
    }
  };

  /**
   * 生成镜像地址
   */
  const getImageUrl = useCallback(() => {
    const repo = repositoryName || 'REPOSITORY';
    const t = tag || 'TAG';
    return `${harbor?.url || ''}/${projectName}/${repo}:${t}`;
  }, [harbor, projectName, repositoryName, tag]);

  /**
   * 复制命令
   */
  const copyCommand = (command: string) => {
    navigator.clipboard.writeText(command).then(() => {
      message.success('已复制到剪贴板');
    }).catch(() => {
      message.error('复制失败');
    });
  };

/**
   * 处理焦点循环 - 在每个可聚焦元素上调用
   */
  const handleElementKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      const container = document.querySelector('[data-dropdown="true"]') as HTMLElement;
      if (container) {
        const focusableElements = container.querySelectorAll('input, button');
        const elements = Array.from(focusableElements) as HTMLElement[];
        const currentIndex = elements.findIndex(el => el === document.activeElement);
        
        if (e.shiftKey) {
          const prevIndex = currentIndex <= 0 ? elements.length - 1 : currentIndex - 1;
          elements[prevIndex]?.focus();
        } else {
          const nextIndex = currentIndex >= elements.length - 1 ? 0 : currentIndex + 1;
          elements[nextIndex]?.focus();
        }
      }
    }
  };

  // 搜索过滤
  const filteredRepos = repositories.filter((r) =>
    r.name.toLowerCase().includes(keyword.toLowerCase()),
  );

  const columns = [
    {
      title: '仓库名称',
      dataIndex: 'name',
      key: 'name',
      render: (name: string, record: HarborRepository) => {
        const displayName = name.includes('/') ? name.split('/').pop() : name;
        return (
          <Tooltip title={name}>
            <a onClick={() => handleViewArtifacts(record)} style={{ color: '#1890ff' }}>
              {displayName}
            </a>
          </Tooltip>
        );
      },
    },
    {
      title: '制品数',
      dataIndex: 'artifactCount',
      key: 'artifactCount',
      width: 100,
      render: (count: number) => (
        <Tag color={count > 0 ? 'blue' : 'default'}>{count || 0}</Tag>
      ),
    },
    {
      title: '拉取数',
      dataIndex: 'pullCount',
      key: 'pullCount',
      width: 100,
      render: (count: number) => count || 0,
    },
    {
      title: '更新时间',
      dataIndex: 'updatedAt',
      key: 'updatedAt',
      width: 180,
      render: (time: string) => formatTime(time),
    },
    {
      title: '操作',
      key: 'actions',
      width: 80,
      render: (_: any, record: HarborRepository) => {
        const items = [
          {
            key: 'view',
            label: '查看制品',
            onClick: () => handleViewArtifacts(record),
          },
          // 只有写权限才显示删除按钮
          ...(canWrite
            ? [
                {
                  key: 'delete',
                  label: '删除',
                  danger: true,
                  onClick: () => {
                    void confirmHighRiskDelete({
                      resourceLabel: '仓库',
                      name: record.name,
                      description: '删除仓库将同时删除所有制品，此操作不可恢复。',
                      riskItems: DELETE_RISK_ITEMS,
                      confirmText: '确认',
                      onConfirm: () => handleDelete(record),
                    }).catch(() => {});
                  },
                },
              ]
            : []),
        ];
        return <ResourceActionsDropdown items={items} buttonProps={{ className: 'row-actions-trigger' }} />;
      },
    },
  ];

return (
    <div style={{ position: 'relative' }}>
      <Space style={{ marginBottom: 16 }}>
        <Input.Search
          placeholder="搜索仓库名称"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          style={{ width: 300 }}
          prefix={<SearchOutlined />}
          allowClear
        />
        <Button icon={<ReloadOutlined />} onClick={loadRepositories}>
          刷新
        </Button>
        {canWrite && (
          <Button
            type="primary"
            icon={<UploadOutlined />}
            onClick={() => setUploadModalVisible(true)}
          >
            上传镜像
          </Button>
        )}
        <Button
          icon={<UnorderedListOutlined />}
          onClick={() => setTasksDrawerVisible(true)}
        >
          上传任务
        </Button>
        <Button type="link" onClick={() => {
          setDropdownVisible(!dropdownVisible);
          if (!dropdownVisible) {
            setTimeout(() => firstInputRef.current?.focus(), 100);
          }
        }}>
          推送命令 <DownOutlined />
        </Button>
      </Space>

      {dropdownVisible && (
        <div 
          data-dropdown="true"
          style={{ 
            position: 'absolute',
            top: 48,
            left: 400,
            zIndex: 1000,
            padding: 16, 
            backgroundColor: '#fff', 
            borderRadius: 8, 
            boxShadow: '0 3px 6px -4px rgba(0, 0, 0, 0.12), 0 6px 16px 0 rgba(0, 0, 0, 0.08), 0 9px 28px 8px rgba(0, 0, 0, 0.05)',
            width: 650,
          }}
        >
          <div style={{ marginBottom: 12 }}>
            <Text type="secondary">仓库名称</Text>
            <Input
              ref={firstInputRef}
              size="small"
              placeholder="REPOSITORY"
              value={repositoryName}
              onChange={(e) => setRepositoryName(e.target.value)}
              onKeyDown={(e) => handleElementKeyDown(e)}
              style={{ marginTop: 4, width: '100%' }}
            />
          </div>
          <div style={{ marginBottom: 16 }}>
            <Text type="secondary">标签</Text>
            <Input
              ref={tagInputRef}
              size="small"
              placeholder="latest"
              value={tag}
              onChange={(e) => setTag(e.target.value)}
              onKeyDown={(e) => handleElementKeyDown(e)}
              style={{ marginTop: 4, width: '100%' }}
            />
          </div>

          <div style={{ borderTop: '1px solid #f0f0f0', paddingTop: 12 }}>
            <Text strong>Docker 推送命令</Text>
            <div style={{ marginTop: 8, marginBottom: 8 }}>
              <Text type="secondary" style={{ fontSize: 12 }}>标记镜像</Text>
              <Space.Compact style={{ width: '100%', marginTop: 4 }}>
                <Input
                  readOnly
                  tabIndex={0}
                  size="small"
                  value={`docker tag SOURCE_IMAGE[:TAG] ${getImageUrl()}`}
                  onKeyDown={(e) => handleElementKeyDown(e)}
                  style={{ fontFamily: 'monospace', fontSize: 13 }}
                />
                <Button 
                  size="small" 
                  icon={<CopyOutlined />} 
                  onClick={() => copyCommand(`docker tag SOURCE_IMAGE[:TAG] ${getImageUrl()}`)}
                  onKeyDown={(e) => handleElementKeyDown(e)}
                />
              </Space.Compact>
            </div>
            <div style={{ marginBottom: 8 }}>
              <Text type="secondary" style={{ fontSize: 12 }}>推送镜像</Text>
              <Space.Compact style={{ width: '100%', marginTop: 4 }}>
                <Input
                  readOnly
                  tabIndex={0}
                  size="small"
                  value={`docker push ${getImageUrl()}`}
                  onKeyDown={(e) => handleElementKeyDown(e)}
                  style={{ fontFamily: 'monospace', fontSize: 13 }}
                />
                <Button 
                  size="small" 
                  icon={<CopyOutlined />} 
                  onClick={() => copyCommand(`docker push ${getImageUrl()}`)}
                  onKeyDown={(e) => handleElementKeyDown(e)}
                />
              </Space.Compact>
            </div>
          </div>

          <div style={{ borderTop: '1px solid #f0f0f0', paddingTop: 12 }}>
            <Text strong>Podman 推送命令</Text>
            <div style={{ marginTop: 8 }}>
              <Text type="secondary" style={{ fontSize: 12 }}>推送镜像</Text>
              <Space.Compact style={{ width: '100%', marginTop: 4 }}>
                <Input
                  readOnly
                  tabIndex={0}
                  size="small"
                  value={`podman push IMAGE_ID ${getImageUrl()}`}
                  onKeyDown={(e) => handleElementKeyDown(e)}
                  style={{ fontFamily: 'monospace', fontSize: 13 }}
                />
                <Button 
                  size="small" 
                  icon={<CopyOutlined />} 
                  onClick={() => copyCommand(`podman push IMAGE_ID ${getImageUrl()}`)}
                  onKeyDown={(e) => handleElementKeyDown(e)}
                />
              </Space.Compact>
            </div>
          </div>

          <div style={{ borderTop: '1px solid #f0f0f0', paddingTop: 12 }}>
            <Text strong>Helm 推送命令</Text>
            <div style={{ marginTop: 8, marginBottom: 8 }}>
              <Text type="secondary" style={{ fontSize: 12 }}>打包 chart</Text>
              <Space.Compact style={{ width: '100%', marginTop: 4 }}>
                <Input
                  readOnly
                  tabIndex={0}
                  size="small"
                  value="helm package CHART_PATH"
                  onKeyDown={(e) => handleElementKeyDown(e)}
                  style={{ fontFamily: 'monospace', fontSize: 13 }}
                />
                <Button 
                  size="small" 
                  icon={<CopyOutlined />} 
                  onClick={() => copyCommand('helm package CHART_PATH')}
                  onKeyDown={(e) => handleElementKeyDown(e)}
                />
              </Space.Compact>
            </div>
            <div>
              <Text type="secondary" style={{ fontSize: 12 }}>推送 chart</Text>
              <Space.Compact style={{ width: '100%', marginTop: 4 }}>
                <Input
                  readOnly
                  tabIndex={0}
                  size="small"
                  value={`helm push CHART_PACKAGE oci://${harbor?.url || ''}/${projectName}`}
                  onKeyDown={(e) => handleElementKeyDown(e)}
                  style={{ fontFamily: 'monospace', fontSize: 13 }}
                />
                <Button 
                  ref={lastButtonRef}
                  size="small" 
                  icon={<CopyOutlined />} 
                  onClick={() => copyCommand(`helm push CHART_PACKAGE oci://${harbor?.url || ''}/${projectName}`)}
                  onKeyDown={(e) => handleElementKeyDown(e)}
                />
              </Space.Compact>
            </div>
          </div>
        </div>
      )}

      <Table
        columns={columns}
        dataSource={filteredRepos}
        rowKey="id"
        loading={loading}
        pagination={{
          showSizeChanger: true,
          showQuickJumper: true,
          showTotal: (total) => `共 ${total} 条`,
          defaultPageSize: 10,
        }}
      />

      <HarborUploadModal
        visible={uploadModalVisible}
        harborId={harborId}
        project={project}
        existingRepos={repositories.map(r => r.name)}
        onClose={() => setUploadModalVisible(false)}
        onSuccess={() => {
          setUploadModalVisible(false);
          loadRepositories();
        }}
      />

      <HarborUploadTasksDrawer
        visible={tasksDrawerVisible}
        harborId={harborId}
        project={project}
        onClose={() => setTasksDrawerVisible(false)}
      />
    </div>
  );
};

export default RepositoriesSection;