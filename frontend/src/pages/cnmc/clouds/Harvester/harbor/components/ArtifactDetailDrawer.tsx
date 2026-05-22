/**
 * 制品详情抽屉
 * 
 * 展示制品的基本信息、漏洞报告、标签管理等内容
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Drawer, Descriptions, Tabs, Table, Tag, Button, Space, message, Spin, Input, Popconfirm, Modal } from 'antd';
import { PlusOutlined, DeleteOutlined } from '@ant-design/icons';
import { getHarborVulnerabilities, getHarborTags, addHarborTag, deleteHarborTag } from '../shared/harborApi';
import type { HarborArtifact, HarborVulnerabilityItem, HarborTag } from '../types';

interface Props {
  /** 是否显示 */
  visible: boolean;
  /** 制品信息 */
  artifact: HarborArtifact | null;
  /** Harbor 实例 ID */
  harborId: string;
  /** 项目名称 */
  projectName: string;
  /** 仓库名称 */
  repositoryName: string;
  /** 关闭回调 */
  onClose: () => void;
}

/**
 * 制品详情抽屉组件
 */
const ArtifactDetailDrawer: React.FC<Props> = ({
  visible,
  artifact,
  harborId,
  projectName,
  repositoryName,
  onClose,
}) => {
  const [vulnerabilities, setVulnerabilities] = useState<HarborVulnerabilityItem[]>([]);
  const [vulnerabilityOverview, setVulnerabilityOverview] = useState<{
    critical: number;
    high: number;
    medium: number;
    low: number;
  } | null>(null);
  const [tags, setTags] = useState<HarborTag[]>([]);
  const [loading, setLoading] = useState(false);
  const [addTagVisible, setAddTagVisible] = useState(false);
  const [newTagName, setNewTagName] = useState('');
  const [selectedTagKeys, setSelectedTagKeys] = useState<React.Key[]>([]);

  /**
   * 加载详情数据
   */
  const loadDetails = useCallback(async () => {
    if (!artifact) return;
    setLoading(true);
    try {
      const [vulnRes, tagsRes] = await Promise.all([
        getHarborVulnerabilities(harborId, projectName, repositoryName, artifact.digest),
        getHarborTags(harborId, projectName, repositoryName, artifact.digest),
      ]);
      
      // 处理漏洞数据
      const vulnList = vulnRes?.vulnerabilities || vulnRes || [];
      setVulnerabilities(Array.isArray(vulnList) ? vulnList : []);
      
      const overview = vulnRes?.overview?.summary;
      if (overview) {
        setVulnerabilityOverview(overview);
      }
      
      // 处理标签数据
      const tagList = tagsRes || [];
      setTags(Array.isArray(tagList) ? tagList : []);
    } catch (e: any) {
      console.error('加载详情失败:', e);
    } finally {
      setLoading(false);
    }
  }, [artifact, harborId, projectName, repositoryName]);

  useEffect(() => {
    if (visible && artifact) {
      loadDetails();
    } else {
      // 关闭时清空数据
      setVulnerabilities([]);
      setTags([]);
      setVulnerabilityOverview(null);
    }
  }, [visible, artifact, loadDetails]);

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
    // Harbor 返回 "0001-01-01T00:00:00Z" 表示未拉取
    if (time.startsWith('0001-') || time.startsWith('0001-01-01')) {
      return '-';
    }
    try {
      return new Date(time).toLocaleString('zh-CN');
    } catch {
      return time;
    }
  };

  /**
   * 渲染漏洞严重性标签
   */
  const renderSeverityTag = (severity: string) => {
    const severityMap: Record<string, { bgColor: string; textColor: string; label: string }> = {
      Critical: { bgColor: '#ff4d2e', textColor: '#fff', label: '危急' },
      High: { bgColor: '#ff8f3d', textColor: '#fff', label: '严重' },
      Medium: { bgColor: '#ffce66', textColor: '#333', label: '中等' },
      Low: { bgColor: '#fff5c8', textColor: '#333', label: '较低' },
      Negligible: { bgColor: '#a7a7a7', textColor: '#fff', label: '可忽略' },
      Unknown: { bgColor: '#a7a7a7', textColor: '#fff', label: '未知' },
    };
    const item = severityMap[severity] || { bgColor: '#a7a7a7', textColor: '#fff', label: severity };
    return <Tag style={{ backgroundColor: item.bgColor, color: item.textColor, border: 'none' }}>{item.label}</Tag>;
  };

  /**
   * 添加标签
   */
  const handleAddTag = async () => {
    if (!artifact || !newTagName.trim()) {
      message.warning('请输入标签名称');
      return;
    }
    try {
      await addHarborTag(harborId, projectName, repositoryName, artifact.digest, newTagName.trim());
      message.success('标签添加成功');
      setAddTagVisible(false);
      setNewTagName('');
      loadDetails();
    } catch (e: any) {
      message.error(e?.message || '添加标签失败');
    }
  };

  /**
   * 删除标签
   */
  const handleDeleteTag = async (tagName: string) => {
    if (!artifact) return;
    try {
      await deleteHarborTag(harborId, projectName, repositoryName, artifact.digest, tagName);
      message.success('标签已删除');
      loadDetails();
    } catch (e: any) {
      message.error(e?.message || '删除标签失败');
    }
  };

  /**
   * 批量删除标签
   */
  const handleBatchDeleteTags = async () => {
    if (!artifact || selectedTagKeys.length === 0) return;
    try {
      await Promise.all(
        selectedTagKeys.map((tagName) =>
          deleteHarborTag(harborId, projectName, repositoryName, artifact.digest, tagName as string)
        )
      );
      message.success(`已删除 ${selectedTagKeys.length} 个标签`);
      setSelectedTagKeys([]);
      loadDetails();
    } catch (e: any) {
      message.error(e?.message || '批量删除标签失败');
    }
  };

  if (!artifact) return null;

  // 获取显示名称
  const displayName = artifact.tags?.[0]?.name || artifact.digest.slice(0, 12);

  return (
    <Drawer
      title={`${repositoryName}:${displayName}`}
      width={800}
      open={visible}
      onClose={onClose}
      destroyOnClose
    >
      <Spin spinning={loading}>
        <Tabs
          defaultActiveKey="basic"
          items={[
            {
              key: 'basic',
              label: '基本信息',
              children: (
                <Descriptions column={2} bordered size="small">
                  <Descriptions.Item label="制品摘要" span={2}>
                    <code style={{ fontSize: 12 }}>{artifact.digest}</code>
                  </Descriptions.Item>
                  <Descriptions.Item label="大小">
                    {formatSize(artifact.size)}
                  </Descriptions.Item>
                  <Descriptions.Item label="推送时间">
                    {formatTime(artifact.pushTime)}
                  </Descriptions.Item>
                  <Descriptions.Item label="标签">
                    {(artifact.tags?.length ?? 0) > 0 ? (
                      <Space size={[4, 8]} wrap>
                        {artifact.tags?.map((t) => (
                          <Tag color="blue" key={t.name}>
                            {t.name}
                          </Tag>
                        ))}
                      </Space>
                    ) : (
                      <Tag>无标签</Tag>
                    )}
                  </Descriptions.Item>
                  <Descriptions.Item label="架构">
                    {artifact.extraAttrs?.os || '-'} / {artifact.extraAttrs?.arch || '-'}
                  </Descriptions.Item>
                  <Descriptions.Item label="制品类型">
                    {artifact.type || 'IMAGE'}
                  </Descriptions.Item>
                  <Descriptions.Item label="最后拉取">
                    {formatTime(artifact.pullTime || '')}
                  </Descriptions.Item>
                </Descriptions>
              ),
            },
            {
              key: 'vulnerabilities',
              label: (
                <span>
                  漏洞报告{' '}
                  {vulnerabilityOverview && (
                    <Tag color="orange">
                      {vulnerabilityOverview.critical + vulnerabilityOverview.high}
                    </Tag>
                  )}
                </span>
              ),
              children: (
                <div>
                  {vulnerabilityOverview && (
                    <Space style={{ marginBottom: 16 }} size="middle">
                      {vulnerabilityOverview.critical > 0 && (
                        <Tag style={{ backgroundColor: '#ff4d2e', color: '#fff', border: 'none' }}>危急: {vulnerabilityOverview.critical}</Tag>
                      )}
                      {vulnerabilityOverview.high > 0 && (
                        <Tag style={{ backgroundColor: '#ff8f3d', color: '#fff', border: 'none' }}>严重: {vulnerabilityOverview.high}</Tag>
                      )}
                      {vulnerabilityOverview.medium > 0 && (
                        <Tag style={{ backgroundColor: '#ffce66', color: '#333', border: 'none' }}>中等: {vulnerabilityOverview.medium}</Tag>
                      )}
                      {vulnerabilityOverview.low > 0 && (
                        <Tag style={{ backgroundColor: '#fff5c8', color: '#333', border: 'none' }}>较低: {vulnerabilityOverview.low}</Tag>
                      )}
                    </Space>
                  )}
                  <Table
                    size="small"
                    dataSource={vulnerabilities}
                    rowKey="id"
                    loading={loading}
                    pagination={{
                      pageSize: 10,
                      showSizeChanger: true,
                    }}
                    columns={[
                      {
                        title: 'CVE 编号',
                        dataIndex: 'id',
                        key: 'id',
                        render: (id: string) => (
                          <a
                            href={`https://nvd.nist.gov/vuln/detail/${id}`}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            {id}
                          </a>
                        ),
                      },
                      {
                        title: '严重性',
                        dataIndex: 'severity',
                        key: 'severity',
                        width: 100,
                        render: renderSeverityTag,
                      },
                      {
                        title: '受影响包',
                        dataIndex: 'package',
                        key: 'package',
                      },
                      {
                        title: '当前版本',
                        dataIndex: 'version',
                        key: 'version',
                        width: 120,
                      },
                      {
                        title: '修复版本',
                        dataIndex: 'fixVersion',
                        key: 'fixVersion',
                        width: 120,
                        render: (v: string) => v || '-',
                      },
                    ]}
                  />
                </div>
              ),
            },
            {
              key: 'tags',
              label: `标签管理 (${tags.length})`,
              children: (
                <div>
                  <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
                    <Space>
                      {selectedTagKeys.length > 0 && (
                        <Button 
                          danger 
                          icon={<DeleteOutlined />}
                          onClick={() => {
                            Modal.confirm({
                              title: '确认批量删除',
                              content: `确定要删除选中的 ${selectedTagKeys.length} 个标签吗？`,
                              okText: '确认',
                              cancelText: '取消',
                              okButtonProps: { danger: true },
                              onOk: handleBatchDeleteTags,
                            });
                          }}
                        >
                          批量删除 ({selectedTagKeys.length})
                        </Button>
                      )}
                      <Button 
                        type="primary" 
                        icon={<PlusOutlined />}
                        onClick={() => setAddTagVisible(true)}
                      >
                        添加标签
                      </Button>
                    </Space>
                  </div>

                  {/* 内联添加标签 */}
                  {addTagVisible && (
                    <div style={{ marginBottom: 16, padding: 16, backgroundColor: '#f5f5f5', borderRadius: 4 }}>
                      <Space direction="vertical" style={{ width: '100%' }}>
                        <Input
                          placeholder="请输入标签名称，如：v1.0.0"
                          value={newTagName}
                          onChange={(e) => setNewTagName(e.target.value)}
                          onPressEnter={handleAddTag}
                        />
                        <Space>
                          <Button type="primary" onClick={handleAddTag}>添加</Button>
                          <Button onClick={() => {
                            setAddTagVisible(false);
                            setNewTagName('');
                          }}>取消</Button>
                        </Space>
                      </Space>
                    </div>
                  )}

                  <Table
                    size="small"
                    dataSource={tags}
                    rowKey="name"
                    rowSelection={{
                      selectedRowKeys: selectedTagKeys,
                      onChange: setSelectedTagKeys,
                    }}
                    pagination={{
                      pageSize: 10,
                    }}
                    columns={[
                      {
                        title: '标签名',
                        dataIndex: 'name',
                        key: 'name',
                        render: (name: string) => <Tag color="blue">{name}</Tag>,
                      },
                      {
                        title: '推送时间',
                        dataIndex: 'pushTime',
                        key: 'pushTime',
                        render: formatTime,
                      },
                      {
                        title: '最后拉取',
                        dataIndex: 'pullTime',
                        key: 'pullTime',
                        render: (t: string) => t ? formatTime(t) : '-',
                      },
{
                        title: '操作',
                        key: 'actions',
                        width: 80,
                        render: (_: any, record: HarborTag) => (
                          <Popconfirm
                            title="确认删除"
                            description={`确定要删除标签 "${record.name}" 吗？`}
                            onConfirm={() => handleDeleteTag(record.name)}
                            okText="确认"
                            cancelText="取消"
                            okButtonProps={{ danger: true }}
                          >
                            <Button 
                              type="link" 
                              danger 
                              icon={<DeleteOutlined />}
                            >
                              删除
                            </Button>
                          </Popconfirm>
                        ),
                      },
                    ]}
                  />
                </div>
              ),
            },
            {
              key: 'attributes',
              label: '属性总览',
              children: (
                <Descriptions column={1} bordered size="small">
                  <Descriptions.Item label="架构">
                    {artifact.extraAttrs?.architecture || '-'}
                  </Descriptions.Item>
                  <Descriptions.Item label="操作系统">
                    {artifact.extraAttrs?.os || '-'}
                  </Descriptions.Item>
                  <Descriptions.Item label="创建时间">
                    {artifact.extraAttrs?.created 
                      ? new Date(artifact.extraAttrs.created).toLocaleString()
                      : '-'}
                  </Descriptions.Item>
                  <Descriptions.Item label="作者">
                    {artifact.extraAttrs?.author || '-'}
                  </Descriptions.Item>
                  {artifact.extraAttrs?.config && (
                    <Descriptions.Item label="配置">
                      <pre style={{ margin: 0, fontSize: 12, maxHeight: 200, overflow: 'auto' }}>
                        {JSON.stringify(artifact.extraAttrs.config, null, 2)}
                      </pre>
                    </Descriptions.Item>
                  )}
                </Descriptions>
              ),
            },
          ]}
        />
      </Spin>
    </Drawer>
  );
};

export default ArtifactDetailDrawer;
