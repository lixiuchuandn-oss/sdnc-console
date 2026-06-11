/**
 * Harbor 概览 Section
 * 
 * 展示 Harbor 实例的状态、统计信息和快速操作入口
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Card, Row, Col, Statistic, Tag, Space, Button, Progress, App, Modal, Form, Input, Select } from 'antd';
import { 
  PlusOutlined, 
  CloudUploadOutlined, 
  SyncOutlined, 
  ApiOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  QuestionCircleOutlined,
  DatabaseOutlined,
  FolderOutlined,
  SafetyCertificateOutlined,
} from '@ant-design/icons';
import type { HarborRegistry } from '../types';
import { getHarborSystemInfo, getHarborProjects, syncHarborProjects, createHarborProject } from '../shared/harborApi';

interface Props {
  harbor: HarborRegistry;
  cloudId?: string;
  onRefresh: () => void;
  onTestConnection: () => void;
  onNavigateToUpload?: () => void;
}

/**
 * 状态图标
 */
const StatusIcon: React.FC<{ status: string }> = ({ status }) => {
  switch (status) {
    case 'healthy':
      return <CheckCircleOutlined style={{ color: '#52c41a' }} />;
    case 'unhealthy':
      return <CloseCircleOutlined style={{ color: '#ff4d4f' }} />;
    default:
      return <QuestionCircleOutlined style={{ color: '#8c8c8c' }} />;
  }
};

/**
 * 状态文本
 */
const StatusText: React.FC<{ status: string }> = ({ status }) => {
  switch (status) {
    case 'healthy':
      return <span style={{ color: '#52c41a' }}>健康</span>;
    case 'unhealthy':
      return <span style={{ color: '#ff4d4f' }}>异常</span>;
    default:
      return <span style={{ color: '#8c8c8c' }}>未知</span>;
  }
};

const OverviewSection: React.FC<Props> = ({ harbor, onRefresh, onTestConnection, onNavigateToUpload }) => {
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [createModalVisible, setCreateModalVisible] = useState(false);
  const [systemInfo, setSystemInfo] = useState<{
    version?: string;
    storage?: { total: number; used: number };
    scanEnabled?: boolean;
  }>({});
  const [projectCount, setProjectCount] = useState(harbor.projectCount || 0);

  /**
   * 加载系统信息
   */
  const loadSystemInfo = useCallback(async () => {
    setLoading(true);
    try {
      const info = await getHarborSystemInfo(harbor.id);
      setSystemInfo(info || {});
      
      // 同时获取项目数量
      const projectsRes = await getHarborProjects(harbor.id, { page: 1, pageSize: 100 });
      // projectsRes 是数组，直接使用长度
      const count = Array.isArray(projectsRes) ? projectsRes.length : (projectsRes as any)?.total || 0;
      setProjectCount(count);
    } catch (e: any) {
      console.warn('加载系统信息失败:', e);
    } finally {
      setLoading(false);
    }
  }, [harbor.id]);

  useEffect(() => {
    loadSystemInfo();
  }, [loadSystemInfo]);

  /**
   * 同步项目列表
   */
  const handleSyncProjects = useCallback(async () => {
    const hide = message.loading('正在同步项目...', 0);
    try {
      const result = await syncHarborProjects(harbor.id);
      hide();
      message.success(`项目同步成功：新增 ${result.added}，更新 ${result.updated}，删除 ${result.deleted}`);
      loadSystemInfo();
      onRefresh();
    } catch (e: any) {
      hide();
      message.error(e?.message || '同步项目失败');
    }
  }, [harbor.id, message, loadSystemInfo, onRefresh]);

  /**
   * 创建项目
   */
  const handleCreateProject = useCallback(async (values: any) => {
    try {
      await createHarborProject(harbor.id, values);
      message.success('项目创建成功');
      setCreateModalVisible(false);
      form.resetFields();
      loadSystemInfo();
      onRefresh();
    } catch (e: any) {
      message.error(e?.message || '创建项目失败');
    }
  }, [harbor.id, message, form, loadSystemInfo, onRefresh]);

  /**
   * 推送镜像
   */
  const handleUploadImage = useCallback(() => {
    if (onNavigateToUpload) {
      onNavigateToUpload();
    } else {
      message.info('请切换到"推送命令" Tab 查看推送指南');
    }
  }, [onNavigateToUpload, message]);

  /**
   * 计算存储使用百分比
   */
  const storagePercent = systemInfo.storage 
    ? Math.round((systemInfo.storage.used / systemInfo.storage.total) * 100) 
    : 0;

  /**
   * 格式化存储大小
   */
  const formatStorage = (bytes: number) => {
    const gb = bytes / (1024 * 1024 * 1024);
    return `${gb.toFixed(1)}GB`;
  };

  return (
    <div>
      {/* 状态卡片 */}
      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={6}>
          <Card size="small" loading={loading}>
            <Statistic
              title="状态"
              valueRender={() => (
                <Space>
                  <StatusIcon status={harbor.status} />
                  <StatusText status={harbor.status} />
                </Space>
              )}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card size="small" loading={loading}>
            <Statistic
              title="版本"
              value={systemInfo.version || harbor.version || '-'}
              prefix={<TagOutlined />}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card size="small" loading={loading}>
            <Statistic
              title="项目数"
              value={projectCount}
              prefix={<FolderOutlined />}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card size="small" loading={loading}>
            {systemInfo.storage ? (
              <div>
                <div style={{ marginBottom: 4 }}>
                  <span style={{ fontSize: 14, color: '#888' }}>存储使用</span>
                </div>
                <Progress 
                  percent={storagePercent} 
                  size="small"
                  status={storagePercent > 80 ? 'exception' : undefined}
                />
                <div style={{ fontSize: 12, color: '#888', marginTop: 4 }}>
                  {formatStorage(systemInfo.storage.used)} / {formatStorage(systemInfo.storage.total)}
                </div>
              </div>
            ) : (
              <Statistic title="存储" value="-" />
            )}
          </Card>
        </Col>
      </Row>

      {/* 功能特性 */}
      <Card title="功能特性" size="small" style={{ marginBottom: 16 }}>
        <Space size="large">
          <Tag color={harbor.insecure ? 'orange' : 'green'}>
            {harbor.insecure ? 'HTTP' : 'HTTPS'}
          </Tag>
          {systemInfo.scanEnabled !== undefined && (
            <Tag color={systemInfo.scanEnabled ? 'blue' : 'default'} icon={<SafetyCertificateOutlined />}>
              漏洞扫描 {systemInfo.scanEnabled ? '已启用' : '未启用'}
            </Tag>
          )}
          {harbor.isBuiltIn && (
            <Tag color="purple">平台内置</Tag>
          )}
        </Space>
      </Card>

      {/* 快速操作 */}
      <Card title="快速操作" size="small" style={{ marginBottom: 16 }}>
        <Space wrap>
          <Button 
            icon={<PlusOutlined />}
            onClick={() => setCreateModalVisible(true)}
          >
            创建项目
          </Button>
          <Button 
            icon={<CloudUploadOutlined />}
            onClick={handleUploadImage}
          >
            推送镜像
          </Button>
          <Button 
            icon={<SyncOutlined />} 
            onClick={handleSyncProjects}
          >
            同步项目
          </Button>
          <Button icon={<ApiOutlined />} onClick={onTestConnection}>
            测试连接
          </Button>
          <Button icon={<DatabaseOutlined />} onClick={onRefresh}>
            刷新
          </Button>
        </Space>
      </Card>

      {/* 访问信息 */}
      <Card title="访问信息" size="small">
        <Row gutter={[16, 16]}>
          <Col span={12}>
            <div style={{ marginBottom: 8 }}>
              <span style={{ color: '#888' }}>服务地址：</span>
              <Tag color="blue">{harbor.url}</Tag>
            </div>
          </Col>
          <Col span={12}>
            <div style={{ marginBottom: 8 }}>
              <span style={{ color: '#888' }}>管理员账号：</span>
              <Tag>{harbor.username}</Tag>
            </div>
          </Col>
        </Row>
        <div style={{ marginTop: 8, padding: 12, background: '#f5f5f5', borderRadius: 4 }}>
          <div style={{ fontSize: 12, color: '#888', marginBottom: 4 }}>Docker 登录命令：</div>
          <code style={{ fontSize: 12 }}>
            docker login {harbor.url}
          </code>
        </div>
      </Card>

      {/* 创建项目弹窗 */}
      <Modal
        title="创建项目"
        open={createModalVisible}
        onOk={() => form.submit()}
        onCancel={() => {
          setCreateModalVisible(false);
          form.resetFields();
        }}
      >
        <Form
          form={form}
          layout="vertical"
          onFinish={handleCreateProject}
          initialValues={{ public: 0 }}
        >
          <Form.Item
            name="projectName"
            label="项目名称"
            rules={[
              { required: true, message: '请输入项目名称' },
              { pattern: /^[a-z0-9][-a-z0-9]*$/, message: '只能包含小写字母、数字和连字符' },
            ]}
          >
            <Input placeholder="例如：my-project" />
          </Form.Item>
          <Form.Item
            name="public"
            label="访问级别"
          >
            <Select
              options={[
                { label: '私有（仅项目成员可访问）', value: 0 },
                { label: '公开（所有人可访问）', value: 1 },
              ]}
            />
          </Form.Item>
          <Form.Item
            name="storageLimit"
            label="存储配额（GB）"
          >
            <Input type="number" placeholder="不限制" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

// TagOutlined 不在 antd icons 中，用 FolderOutlined 替代
const TagOutlined = DatabaseOutlined;

export default OverviewSection;
