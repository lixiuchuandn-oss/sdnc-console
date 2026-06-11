/**
 * 制品列表 Section
 * 
 * 用于在仓库详情页中展示制品列表
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Table, Button, Input, Space, Tag, message, Modal } from 'antd';
import { SearchOutlined, ReloadOutlined, PlusOutlined } from '@ant-design/icons';
import { getHarborArtifacts, deleteHarborArtifact, addHarborTag } from '../shared/harborApi';
import ResourceActionsDropdown from '../../../../../../components/ResourceActionsDropdown';
import {
  confirmHighRiskDelete,
  DELETE_RISK_ITEMS,
} from '../../shared/lib/highRiskConfirm';
import type { HarborArtifact } from '../types';
import type { HarborProjectRef } from '../shared/harborApi';
import ArtifactDetailDrawer from '../components/ArtifactDetailDrawer';

interface Props {
  /** Harbor 实例 ID */
  harborId: string;
  /** 项目引用（纯数字项目名需携带 projectId） */
  project: HarborProjectRef;
  /** 仓库名称 */
  repositoryName: string;
}

/**
 * 制品列表组件
 */
const ArtifactsSection: React.FC<Props> = ({ harborId, project, repositoryName }) => {
  const [artifacts, setArtifacts] = useState<HarborArtifact[]>([]);
  const [loading, setLoading] = useState(false);
  const [keyword, setKeyword] = useState('');
  const [selectedArtifact, setSelectedArtifact] = useState<HarborArtifact | null>(null);
  const [drawerVisible, setDrawerVisible] = useState(false);
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);
  const [addTagModalVisible, setAddTagModalVisible] = useState(false);
  const [newTagName, setNewTagName] = useState('');

  /**
   * 加载制品列表
   */
  const loadArtifacts = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getHarborArtifacts(harborId, project, repositoryName, {
        withTag: true,
        withScanOverview: true,
      });
      // 兼容分页响应和数组响应
      const list = Array.isArray(res) ? res : (res?.data || []);
      setArtifacts(list);
    } catch (e: any) {
      console.error('加载制品列表失败:', e);
      message.error(e?.message || '加载制品列表失败');
    } finally {
      setLoading(false);
    }
  }, [harborId, project, repositoryName]);

  /**
   * 查看制品详情
   */
  const handleViewDetail = (artifact: HarborArtifact) => {
    setSelectedArtifact(artifact);
    setDrawerVisible(true);
  };

  /**
   * 删除制品
   */
  const handleDelete = async (artifact: HarborArtifact) => {
    try {
      await deleteHarborArtifact(harborId, project, repositoryName, artifact.digest);
      message.success('制品已删除');
      loadArtifacts();
    } catch (e: any) {
      message.error(e?.message || '删除失败');
    }
  };

  /**
   * 批量添加标签
   */
  const handleBatchAddTag = async () => {
    if (!newTagName.trim()) {
      message.warning('请输入标签名称');
      return;
    }
    if (selectedRowKeys.length === 0) {
      message.warning('请先选择制品');
      return;
    }
    try {
      const tagName = newTagName.trim();
      await Promise.all(
        selectedRowKeys.map((digest) =>
          addHarborTag(harborId, project, repositoryName, digest as string, tagName)
        )
      );
      message.success(`已为 ${selectedRowKeys.length} 个制品添加标签 "${tagName}"`);
      setAddTagModalVisible(false);
      setNewTagName('');
      setSelectedRowKeys([]);
      loadArtifacts();
    } catch (e: any) {
      message.error(e?.message || '批量添加标签失败');
    }
  };

  /**
   * 格式化文件大小
   */
  const formatSize = (bytes: number) => {
    if (!bytes) return '-';
    const mb = bytes / 1024 / 1024;
    if (mb < 1024) {
      return `${mb.toFixed(2)} MB`;
    }
    return `${(mb / 1024).toFixed(2)} GB`;
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
   * 渲染漏洞信息
   */
  const renderVulnerability = (artifact: HarborArtifact) => {
    const overview = artifact.scanOverview;
    if (!overview) return <Tag>未扫描</Tag>;

    const { summary } = overview;
    if (!summary) return <Tag>未扫描</Tag>;

    const { critical = 0, high = 0, medium = 0, low = 0 } = summary;
    const total = critical + high + medium + low;

    if (total === 0) return <Tag color="success">无漏洞</Tag>;

    return (
      <Space size="small" wrap>
        {critical > 0 && <Tag style={{ backgroundColor: '#ff4d2e', color: '#fff', border: 'none' }}>{critical} 危急</Tag>}
        {high > 0 && <Tag style={{ backgroundColor: '#ff8f3d', color: '#fff', border: 'none' }}>{high} 严重</Tag>}
        {medium > 0 && <Tag style={{ backgroundColor: '#ffce66', color: '#333', border: 'none' }}>{medium} 中等</Tag>}
        {low > 0 && <Tag style={{ backgroundColor: '#fff5c8', color: '#333', border: 'none' }}>{low} 较低</Tag>}
      </Space>
    );
  };

  useEffect(() => {
    loadArtifacts();
  }, [loadArtifacts]);

  // 搜索过滤（按标签名搜索）
  const filteredArtifacts = artifacts.filter((artifact) => {
    if (!keyword) return true;
    const lowerKeyword = keyword.toLowerCase();
    // 搜索标签
    if (artifact.tags?.some((t) => t.name.toLowerCase().includes(lowerKeyword))) {
      return true;
    }
    // 搜索 digest
    if (artifact.digest.toLowerCase().includes(lowerKeyword)) {
      return true;
    }
    return false;
  });

  const columns = [
    {
      title: '标签',
      dataIndex: 'tags',
      key: 'tags',
      width: 200,
      render: (tags: any[]) => {
        if (!tags || tags.length === 0) {
          return <Tag>无标签</Tag>;
        }
        return (
          <Space size={[4, 8]} wrap>
            {tags.map((t) => (
              <Tag color="blue" key={t.name}>
                {t.name}
              </Tag>
            ))}
          </Space>
        );
      },
    },
    {
      title: '制品摘要',
      dataIndex: 'digest',
      key: 'digest',
      width: 220,
      ellipsis: true,
      render: (digest: string, record: HarborArtifact) => (
        <a onClick={() => handleViewDetail(record)} style={{ color: '#1890ff', cursor: 'pointer' }}>
          <code style={{ fontSize: 12 }}>
            {digest.slice(0, 32)}...
          </code>
        </a>
      ),
    },
    {
      title: '大小',
      dataIndex: 'size',
      key: 'size',
      width: 100,
      render: formatSize,
    },
    {
      title: '推送时间',
      dataIndex: 'pushTime',
      key: 'pushTime',
      width: 160,
      render: formatTime,
    },
    {
      title: '漏洞扫描',
      key: 'vulnerability',
      width: 200,
      render: renderVulnerability,
    },
    {
      title: '操作',
      key: 'actions',
      width: 80,
      render: (_: any, record: HarborArtifact) => {
        const items = [
          {
            key: 'detail',
            label: '详情',
            onClick: () => handleViewDetail(record),
          },
          {
            key: 'delete',
            label: '删除',
            danger: true,
            onClick: () => {
              void confirmHighRiskDelete({
                resourceLabel: '制品',
                name: record.digest || record.tags?.[0]?.name || '-',
                description: '删除制品将同时删除关联的标签，此操作不可恢复。',
                riskItems: DELETE_RISK_ITEMS,
                confirmText: '确认',
                onConfirm: () => handleDelete(record),
              }).catch(() => {});
            },
          },
        ];
        return <ResourceActionsDropdown items={items} buttonProps={{ className: 'row-actions-trigger' }} />;
      },
    },
  ];

  return (
    <div>
      <Space style={{ marginBottom: 16 }}>
        <Input.Search
          placeholder="搜索标签或制品摘要"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          style={{ width: 300 }}
          prefix={<SearchOutlined />}
          allowClear
        />
        <Button icon={<ReloadOutlined />} onClick={loadArtifacts}>
          刷新
        </Button>
        {selectedRowKeys.length > 0 && (
          <Button 
            type="primary" 
            icon={<PlusOutlined />}
            onClick={() => setAddTagModalVisible(true)}
          >
            批量添加标签 ({selectedRowKeys.length})
          </Button>
        )}
      </Space>
      <Table
        columns={columns}
        dataSource={filteredArtifacts}
        rowKey="digest"
        loading={loading}
        scroll={{ x: 1000 }}
        rowSelection={{
          selectedRowKeys,
          onChange: setSelectedRowKeys,
        }}
        pagination={{
          showSizeChanger: true,
          showQuickJumper: true,
          showTotal: (total) => `共 ${total} 条`,
          defaultPageSize: 10,
        }}
      />
      <ArtifactDetailDrawer
        visible={drawerVisible}
        artifact={selectedArtifact}
        harborId={harborId}
        project={project}
        repositoryName={repositoryName}
        onClose={() => setDrawerVisible(false)}
      />

      {/* 批量添加标签弹窗 */}
      <Modal
        title="批量添加标签"
        open={addTagModalVisible}
        onOk={handleBatchAddTag}
        onCancel={() => setAddTagModalVisible(false)}
        okText="添加"
        cancelText="取消"
      >
        <div style={{ marginBottom: 16 }}>
          <div>已选择 <strong>{selectedRowKeys.length}</strong> 个制品</div>
        </div>
        <Input
          placeholder="请输入标签名称，如：v1.0.0"
          value={newTagName}
          onChange={(e) => setNewTagName(e.target.value)}
          onPressEnter={handleBatchAddTag}
        />
      </Modal>
    </div>
  );
};

export default ArtifactsSection;
