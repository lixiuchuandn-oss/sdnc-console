/**
 * Harbor 复制规则 Section
 * 
 * 管理 Harbor 镜像复制策略，支持跨仓库同步，包括：
 * - 复制规则列表
 * - 创建规则弹窗
 * - 执行记录列表
 * - 手动触发
 */

import React, { useState, useEffect, useCallback } from 'react';
import { 
  Table, 
  Card, 
  Button, 
  Space, 
  Tag, 
  Modal, 
  Form, 
  Input, 
  Switch, 
  Select, 
  App, 
  Empty, 
  Badge, 
  Divider, 
  Alert, 
  Tabs, 
  Tooltip, 
  Popconfirm, 
  Progress, 
  Collapse, 
  InputNumber,
  TimePicker,
} from 'antd';
import { 
  PlusOutlined, 
  ReloadOutlined, 
  SyncOutlined,
  DeleteOutlined,
  EditOutlined,
  PlayCircleOutlined,
  GlobalOutlined,
  ClockCircleOutlined,
  InfoCircleOutlined,
  ImportOutlined,
  ExportOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  LoadingOutlined,
  PauseCircleOutlined,
  FilterOutlined,
  SettingOutlined,
} from '@ant-design/icons';
import type { HarborRegistry, HarborReplicationPolicy, HarborReplicationExecution } from '../types';
import { 
  getHarborReplicationPolicies, 
  createHarborReplicationPolicy, 
  updateHarborReplicationPolicy,
  deleteHarborReplicationPolicy,
  getHarborReplicationExecutions,
  triggerHarborReplication,
} from '../shared/harborApi';

const { Panel } = Collapse;
const { TextArea } = Input;

interface Props {
  harbor: HarborRegistry;
}

/** 触发类型选项 */
const TRIGGER_OPTIONS = [
  { label: '手动触发', value: 'manual' },
  { label: '定时触发', value: 'scheduled' },
  { label: '事件触发', value: 'event_based' },
];

/** 复制类型 */
const REPLICATION_TYPE_OPTIONS = [
  { label: '推送 (Push)', value: 'push', description: '将本地镜像推送到远程仓库' },
  { label: '拉取 (Pull)', value: 'pull', description: '从远程仓库拉取镜像到本地' },
];

const ReplicationSection: React.FC<Props> = ({ harbor }) => {
  const { message, modal } = App.useApp();
  const [loading, setLoading] = useState(false);
  const [policies, setPolicies] = useState<HarborReplicationPolicy[]>([]);
  const [executions, setExecutions] = useState<HarborReplicationExecution[]>([]);
  const [createModalVisible, setCreateModalVisible] = useState(false);
  const [editModalVisible, setEditModalVisible] = useState(false);
  const [editingPolicy, setEditingPolicy] = useState<HarborReplicationPolicy | null>(null);
  const [form] = Form.useForm();
  const [activeTab, setActiveTab] = useState('policies');

  /**
   * 加载复制规则
   */
  const loadPolicies = useCallback(async () => {
    setLoading(true);
    try {
      const [policiesRes, executionsRes] = await Promise.all([
        getHarborReplicationPolicies(harbor.id),
        getHarborReplicationExecutions(harbor.id),
      ]);
      setPolicies(policiesRes || []);
      setExecutions(executionsRes || []);
    } catch (e: any) {
      console.error('加载复制规则失败:', e);
      message.error(e?.message || '加载复制规则失败');
    } finally {
      setLoading(false);
    }
  }, [harbor.id, message]);

  useEffect(() => {
    loadPolicies();
  }, [loadPolicies]);

  /**
   * 打开创建弹窗
   */
  const handleOpenCreate = useCallback(() => {
    form.resetFields();
    form.setFieldsValue({
      enabled: true,
      replicationType: 'push',
      triggerType: 'manual',
      override: true,
    });
    setCreateModalVisible(true);
  }, [form]);

  /**
   * 创建规则
   */
  const handleCreate = useCallback(async (values: any) => {
    try {
      // 构建规则数据
      const policyData: Partial<HarborReplicationPolicy> = {
        name: values.name,
        description: values.description,
        enabled: values.enabled,
        trigger: {
          type: values.triggerType,
          triggerSettings: values.triggerType === 'scheduled' ? {
            cron: values.cron,
          } : undefined,
        },
        filters: values.filters ? values.filters.split('\n').filter(Boolean).map((f: string) => ({
          type: 'name',
          value: f.trim(),
        })) : [],
      };

      await createHarborReplicationPolicy(harbor.id, policyData);
      message.success('复制规则创建成功');
      setCreateModalVisible(false);
      form.resetFields();
      loadPolicies();
    } catch (e: any) {
      message.error(e?.message || '创建复制规则失败');
    }
  }, [harbor.id, message, form, loadPolicies]);

  /**
   * 打开编辑弹窗
   */
  const handleOpenEdit = useCallback((policy: HarborReplicationPolicy) => {
    setEditingPolicy(policy);
    form.setFieldsValue({
      name: policy.name,
      description: policy.description,
      enabled: policy.enabled,
      triggerType: policy.trigger?.type || 'manual',
      cron: policy.trigger?.triggerSettings?.cron,
    });
    setEditModalVisible(true);
  }, [form]);

  /**
   * 更新规则
   */
  const handleUpdate = useCallback(async (values: any) => {
    if (!editingPolicy) return;
    
    try {
      const policyData: Partial<HarborReplicationPolicy> = {
        name: values.name,
        description: values.description,
        enabled: values.enabled,
        trigger: {
          type: values.triggerType,
          triggerSettings: values.triggerType === 'scheduled' ? {
            cron: values.cron,
          } : undefined,
        },
      };

      await updateHarborReplicationPolicy(harbor.id, editingPolicy.id, policyData);
      message.success('复制规则已更新');
      setEditModalVisible(false);
      setEditingPolicy(null);
      loadPolicies();
    } catch (e: any) {
      message.error(e?.message || '更新复制规则失败');
    }
  }, [harbor.id, editingPolicy, message, loadPolicies]);

  /**
   * 删除规则
   */
  const handleDelete = useCallback((policy: HarborReplicationPolicy) => {
    modal.confirm({
      title: '确认删除',
      content: (
        <div>
          <p>确定要删除复制规则 <strong>"{policy.name}"</strong> 吗？</p>
          <Alert
            type="warning"
            showIcon
            message="删除后将无法恢复，正在执行的复制任务不受影响"
          />
        </div>
      ),
      okType: 'danger',
      onOk: async () => {
        try {
          await deleteHarborReplicationPolicy(harbor.id, policy.id);
          message.success('复制规则已删除');
          loadPolicies();
        } catch (e: any) {
          message.error(e?.message || '删除复制规则失败');
        }
      },
    });
  }, [harbor.id, message, modal, loadPolicies]);

  /**
   * 手动触发复制
   */
  const handleTrigger = useCallback(async (policy: HarborReplicationPolicy) => {
    try {
      const result = await triggerHarborReplication(harbor.id, policy.id);
      message.success(`复制任务已触发，执行 ID: ${result.executionId}`);
      loadPolicies();
    } catch (e: any) {
      message.error(e?.message || '触发复制失败');
    }
  }, [harbor.id, message, loadPolicies]);

  /**
   * 切换规则状态
   */
  const handleToggleEnabled = useCallback(async (policy: HarborReplicationPolicy) => {
    try {
      await updateHarborReplicationPolicy(harbor.id, policy.id, {
        enabled: !policy.enabled,
      });
      message.success(`规则已${policy.enabled ? '禁用' : '启用'}`);
      loadPolicies();
    } catch (e: any) {
      message.error(e?.message || '操作失败');
    }
  }, [harbor.id, message, loadPolicies]);

  /**
   * 获取执行状态标签
   */
  const getStatusTag = (status: string) => {
    const config: Record<string, { color: string; text: string; icon: React.ReactNode }> = {
      Success: { color: 'success', text: '成功', icon: <CheckCircleOutlined /> },
      Failed: { color: 'error', text: '失败', icon: <CloseCircleOutlined /> },
      InProgress: { color: 'processing', text: '进行中', icon: <LoadingOutlined spin /> },
      Stopped: { color: 'default', text: '已停止', icon: <PauseCircleOutlined /> },
    };
    const c = config[status] || { color: 'default', text: status, icon: null };
    return <Tag color={c.color} icon={c.icon}>{c.text}</Tag>;
  };

  /**
   * 获取触发方式标签
   */
  const getTriggerTag = (trigger?: HarborReplicationPolicy['trigger']) => {
    const type = trigger?.type || 'manual';
    const config: Record<string, { color: string; text: string }> = {
      manual: { color: 'default', text: '手动' },
      scheduled: { color: 'blue', text: '定时' },
      event_based: { color: 'green', text: '事件触发' },
    };
    const c = config[type] || { color: 'default', text: type };
    return <Tag color={c.color}>{c.text}</Tag>;
  };

  /**
   * 计算执行进度
   */
  const getExecutionProgress = (record: HarborReplicationExecution) => {
    if (!record.total || record.total === 0) return 0;
    return Math.round(((record.succeeded || 0) + (record.failed || 0)) / record.total * 100);
  };

  /**
   * 规则表格列
   */
  const policyColumns = [
    {
      title: '规则名称',
      dataIndex: 'name',
      key: 'name',
      width: 200,
      render: (name: string, record: HarborReplicationPolicy) => (
        <Space>
          <SyncOutlined style={{ color: '#1890ff' }} />
          <span>{name}</span>
          {record.description && (
            <Tooltip title={record.description}>
              <InfoCircleOutlined style={{ color: '#888' }} />
            </Tooltip>
          )}
        </Space>
      ),
    },
    {
      title: '类型',
      key: 'type',
      width: 100,
      render: (_: any, record: HarborReplicationPolicy) => (
        <Tag color={record.srcRegistry ? 'blue' : 'green'}>
          {record.srcRegistry ? <ImportOutlined /> : <ExportOutlined />}{' '}
          {record.srcRegistry ? 'Pull' : 'Push'}
        </Tag>
      ),
    },
    {
      title: '源仓库',
      key: 'srcRegistry',
      width: 180,
      render: (_: any, record: HarborReplicationPolicy) => (
        record.srcRegistry ? (
          <Tooltip title={record.srcRegistry.url}>
            <span style={{ cursor: 'pointer' }}>{record.srcRegistry.name}</span>
          </Tooltip>
        ) : (
          <Tag>本地 Harbor</Tag>
        )
      ),
    },
    {
      title: '目标仓库',
      key: 'destRegistry',
      width: 180,
      render: (_: any, record: HarborReplicationPolicy) => (
        record.destRegistry ? (
          <Tooltip title={record.destRegistry.url}>
            <span style={{ cursor: 'pointer' }}>{record.destRegistry.name}</span>
          </Tooltip>
        ) : (
          <Tag>本地 Harbor</Tag>
        )
      ),
    },
    {
      title: '触发方式',
      key: 'trigger',
      width: 100,
      render: (_: any, record: HarborReplicationPolicy) => getTriggerTag(record.trigger),
    },
    {
      title: '状态',
      dataIndex: 'enabled',
      key: 'enabled',
      width: 80,
      render: (enabled: boolean, record: HarborReplicationPolicy) => (
        <Switch
          size="small"
          checked={enabled}
          onChange={() => handleToggleEnabled(record)}
        />
      ),
    },
    {
      title: '操作',
      key: 'actions',
      width: 200,
      fixed: 'right' as const,
      render: (_: any, record: HarborReplicationPolicy) => (
        <Space size="small">
          <Tooltip title="执行复制">
            <Button 
              type="link" 
              size="small" 
              icon={<PlayCircleOutlined />}
              onClick={() => handleTrigger(record)}
            />
          </Tooltip>
          <Tooltip title="编辑规则">
            <Button 
              type="link" 
              size="small" 
              icon={<EditOutlined />}
              onClick={() => handleOpenEdit(record)}
            />
          </Tooltip>
          <Popconfirm
            title="确定删除此规则？"
            onConfirm={() => handleDelete(record)}
          >
            <Tooltip title="删除规则">
              <Button 
                type="link" 
                size="small" 
                danger 
                icon={<DeleteOutlined />}
              />
            </Tooltip>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  /**
   * 执行记录表格列
   */
  const executionColumns = [
    {
      title: '执行 ID',
      dataIndex: 'id',
      key: 'id',
      width: 80,
    },
    {
      title: '规则 ID',
      dataIndex: 'policyId',
      key: 'policyId',
      width: 80,
      render: (id: number) => {
        const policy = policies.find(p => p.id === id);
        return policy ? (
          <Tooltip title={policy.name}>
            <span>{id}</span>
          </Tooltip>
        ) : id;
      },
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 100,
      render: (status: string) => getStatusTag(status),
    },
    {
      title: '进度',
      key: 'progress',
      width: 200,
      render: (_: any, record: HarborReplicationExecution) => (
        <div>
          <Progress 
            percent={getExecutionProgress(record)} 
            size="small"
            status={record.status === 'InProgress' ? 'active' : 
                    record.status === 'Success' ? 'success' : 
                    record.status === 'Failed' ? 'exception' : 'normal'}
          />
          <div style={{ fontSize: 12, color: '#888' }}>
            <CheckCircleOutlined style={{ color: '#52c41a', marginRight: 4 }} />
            {record.succeeded || 0}
            <CloseCircleOutlined style={{ color: '#ff4d4f', marginLeft: 8, marginRight: 4 }} />
            {record.failed || 0}
            <span style={{ marginLeft: 8 }}>共 {record.total || 0}</span>
          </div>
        </div>
      ),
    },
    {
      title: '开始时间',
      dataIndex: 'startTime',
      key: 'startTime',
      width: 160,
      render: (time: string) => time ? new Date(time).toLocaleString('zh-CN') : '-',
    },
    {
      title: '结束时间',
      dataIndex: 'endTime',
      key: 'endTime',
      width: 160,
      render: (time: string) => time ? new Date(time).toLocaleString('zh-CN') : '-',
    },
  ];

  // 统计信息
  const enabledCount = policies.filter(p => p.enabled).length;
  const successExecutions = executions.filter(e => e.status === 'Success').length;
  const failedExecutions = executions.filter(e => e.status === 'Failed').length;
  const inProgressExecutions = executions.filter(e => e.status === 'InProgress').length;

  return (
    <div>
      {/* 统计卡片 */}
      <div style={{ marginBottom: 16, display: 'flex', gap: 16 }}>
        <Card size="small" style={{ flex: 1 }}>
          <Space>
            <Badge status="processing" />
            <span>规则总数：</span>
            <strong>{policies.length}</strong>
            <Divider type="vertical" />
            <span>已启用：</span>
            <strong style={{ color: '#52c41a' }}>{enabledCount}</strong>
          </Space>
        </Card>
        <Card size="small" style={{ flex: 1 }}>
          <Space>
            <span>执行记录：</span>
            <strong>{executions.length}</strong>
            <Divider type="vertical" />
            <CheckCircleOutlined style={{ color: '#52c41a' }} />
            <span>{successExecutions}</span>
            <Divider type="vertical" />
            <CloseCircleOutlined style={{ color: '#ff4d4f' }} />
            <span>{failedExecutions}</span>
            <Divider type="vertical" />
            {inProgressExecutions > 0 ? (
              <LoadingOutlined style={{ color: '#1890ff' }} />
            ) : (
              <ClockCircleOutlined style={{ color: '#1890ff' }} />
            )}
            <span>{inProgressExecutions}</span>
          </Space>
        </Card>
      </div>

      {/* 说明 */}
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="复制规则说明"
        description={
          <div>
            <p>复制规则用于在不同镜像仓库之间同步镜像：</p>
            <ul style={{ margin: '8px 0', paddingLeft: 20 }}>
              <li><strong>Push</strong>：将本地 Harbor 镜像推送到外部仓库</li>
              <li><strong>Pull</strong>：从外部仓库拉取镜像到本地 Harbor</li>
            </ul>
          </div>
        }
      />

      <Tabs
        activeKey={activeTab}
        onChange={setActiveTab}
        items={[
          {
            key: 'policies',
            label: (
              <Space>
                <SyncOutlined />
                <span>复制规则</span>
                <Tag color="blue">{policies.length}</Tag>
              </Space>
            ),
            children: (
              <Card size="small">
                <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between' }}>
                  <Space>
                    <span style={{ fontSize: 14, color: '#888' }}>
                      共 {policies.length} 条规则，{enabledCount} 条已启用
                    </span>
                  </Space>
                  <Space>
                    <Button type="primary" icon={<PlusOutlined />} onClick={handleOpenCreate}>
                      创建规则
                    </Button>
                    <Button icon={<ReloadOutlined />} onClick={loadPolicies} loading={loading}>
                      刷新
                    </Button>
                  </Space>
                </div>

                <Table
                  columns={policyColumns}
                  dataSource={policies}
                  rowKey="id"
                  loading={loading}
                  pagination={policies.length > 10 ? { pageSize: 10, showSizeChanger: true } : false}
                  scroll={{ x: 1200 }}
                  locale={{
                    emptyText: <Empty description="暂无复制规则" />,
                  }}
                />
              </Card>
            ),
          },
          {
            key: 'executions',
            label: (
              <Space>
                <ClockCircleOutlined />
                <span>执行记录</span>
                <Tag color="blue">{executions.length}</Tag>
              </Space>
            ),
            children: (
              <Card size="small">
                <Table
                  columns={executionColumns}
                  dataSource={executions}
                  rowKey="id"
                  loading={loading}
                  pagination={executions.length > 20 ? { pageSize: 20, showSizeChanger: true } : false}
                  scroll={{ x: 1000 }}
                  locale={{
                    emptyText: <Empty description="暂无执行记录" />,
                  }}
                />
              </Card>
            ),
          },
        ]}
      />

      {/* 创建规则弹窗 */}
      <Modal
        title={
          <Space>
            <PlusOutlined />
            <span>创建复制规则</span>
          </Space>
        }
        open={createModalVisible}
        onOk={() => form.submit()}
        onCancel={() => {
          setCreateModalVisible(false);
          form.resetFields();
        }}
        width={700}
        confirmLoading={loading}
      >
        <Form
          form={form}
          layout="vertical"
          onFinish={handleCreate}
        >
          <Form.Item
            name="name"
            label="规则名称"
            rules={[
              { required: true, message: '请输入规则名称' },
              { pattern: /^[a-z0-9][-a-z0-9_]*$/, message: '只能包含小写字母、数字、下划线和连字符，且必须以字母或数字开头' },
            ]}
            extra="规则的唯一标识符"
          >
            <Input placeholder="例如：sync-from-docker-hub" />
          </Form.Item>
          
          <Form.Item
            name="description"
            label="描述"
          >
            <TextArea rows={2} placeholder="规则描述（可选）" />
          </Form.Item>

          <Form.Item
            name="replicationType"
            label="复制类型"
            rules={[{ required: true }]}
          >
            <Select options={REPLICATION_TYPE_OPTIONS} />
          </Form.Item>

          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 16 }}
            message="远程仓库配置请在创建后通过编辑规则进行设置"
          />

          <Form.Item
            name="triggerType"
            label="触发方式"
            rules={[{ required: true }]}
          >
            <Select options={TRIGGER_OPTIONS} />
          </Form.Item>

          <Form.Item
            noStyle
            shouldUpdate={(prev, cur) => prev.triggerType !== cur.triggerType}
          >
            {({ getFieldValue }) => {
              const triggerType = getFieldValue('triggerType');
              if (triggerType === 'scheduled') {
                return (
                  <Form.Item
                    name="cron"
                    label="Cron 表达式"
                    rules={[{ required: true, message: '请输入 Cron 表达式' }]}
                    extra="例如：0 0 * * * 表示每天凌晨执行"
                  >
                    <Input placeholder="0 0 * * *" />
                  </Form.Item>
                );
              }
              if (triggerType === 'event_based') {
                return (
                  <Alert
                    type="info"
                    showIcon
                    style={{ marginBottom: 16 }}
                    message="事件触发会在镜像推送时自动执行复制"
                  />
                );
              }
              return null;
            }}
          </Form.Item>

          <Form.Item
            name="filters"
            label="过滤规则"
            extra="每行一个过滤规则，支持通配符。例如：library/* 表示同步 library 项目下所有镜像"
          >
            <TextArea 
              rows={3} 
              placeholder="library/*&#10;myproject/nginx:*" 
            />
          </Form.Item>

          <Form.Item
            name="override"
            label="覆盖已存在镜像"
            valuePropName="checked"
          >
            <Switch checkedChildren="是" unCheckedChildren="否" />
          </Form.Item>

          <Form.Item
            name="enabled"
            label="启用规则"
            valuePropName="checked"
          >
            <Switch checkedChildren="启用" unCheckedChildren="禁用" />
          </Form.Item>
        </Form>
      </Modal>

      {/* 编辑规则弹窗 */}
      <Modal
        title={
          <Space>
            <EditOutlined />
            <span>编辑复制规则</span>
          </Space>
        }
        open={editModalVisible}
        onOk={() => form.submit()}
        onCancel={() => {
          setEditModalVisible(false);
          setEditingPolicy(null);
        }}
        width={600}
        confirmLoading={loading}
      >
        <Form
          form={form}
          layout="vertical"
          onFinish={handleUpdate}
        >
          <Form.Item
            name="name"
            label="规则名称"
            rules={[{ required: true, message: '请输入规则名称' }]}
          >
            <Input />
          </Form.Item>
          
          <Form.Item
            name="description"
            label="描述"
          >
            <TextArea rows={2} />
          </Form.Item>

          <Form.Item
            name="triggerType"
            label="触发方式"
          >
            <Select options={TRIGGER_OPTIONS} />
          </Form.Item>

          <Form.Item
            noStyle
            shouldUpdate={(prev, cur) => prev.triggerType !== cur.triggerType}
          >
            {({ getFieldValue }) => {
              if (getFieldValue('triggerType') === 'scheduled') {
                return (
                  <Form.Item
                    name="cron"
                    label="Cron 表达式"
                  >
                    <Input placeholder="0 0 * * *" />
                  </Form.Item>
                );
              }
              return null;
            }}
          </Form.Item>

          <Form.Item
            name="enabled"
            label="启用规则"
            valuePropName="checked"
          >
            <Switch checkedChildren="启用" unCheckedChildren="禁用" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

export default ReplicationSection;
