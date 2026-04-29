/**
 * ==============================================================================
 * 模块名称: 镜像仓库管理视图 (RegistriesSection)
 * 文件路径: frontend/src/pages/cnmc/clouds/Harvester/containers/sections/RegistriesSection.tsx
 * ==============================================================================
 * 
 * [功能描述]
 * 该组件负责展示和管理 Kubernetes 镜像仓库相关资源，包括：
 * 1. 镜像凭证 (Secrets) 管理 - dockerconfigjson 类型（支持双轨制命名）
 * 2. 镜像仓库管理 - 添加/删除/浏览仓库（localStorage，本地配置）
 */

import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { Table, Select, Button, Tag, Space, App, Drawer, Descriptions, Input, Typography, Segmented, Modal, Form, Switch, Popconfirm, Empty, Statistic, Card, Divider, Alert, Tooltip } from 'antd';
import { 
  DeleteOutlined, KeyOutlined, 
  FolderOutlined, EditOutlined, SearchOutlined, DatabaseOutlined,
  LinkOutlined, TagOutlined,
  CopyOutlined, GlobalOutlined, LockOutlined, UnlockOutlined, ClockCircleOutlined,
  InfoCircleOutlined, EyeOutlined, EditTwoTone, PlusOutlined, ReloadOutlined,
} from '@ant-design/icons';
import yaml from 'js-yaml';
import PageDetailSection from '../../../../../../components/PageDetailSection';
import ResourceActionsDropdown from '../../../../../../components/ResourceActionsDropdown';
import { useTableColumnSettings } from '../../../../../../hooks/useTableColumnSettings';
import TableColumnSettingsButton from '../../../../../../components/TableColumnSettingsButton';
import YamlEditor from '../../../../../../components/YamlEditor';
import {
  deleteHarvesterContainerResource,
  addInsecureRegistry,
  patchHarvesterContainerResource,
  fetchHarvesterSecretDetail,
} from '../../../../../../services/harvesterApi';
import { RegistryCredentialModal, RegistryBrowserDrawer } from '../components';

const { Text, Link } = Typography;

// 本地存储键名
const REGISTRIES_STORAGE_KEY = 'harvester-registries';

// API 路径（镜像凭证使用）
const SECRETS_API_PATH = '/api/v1/secrets';

/**
 * 仓库配置接口
 */
interface RegistryConfig {
  id: string;
  name: string;
  server: string;
  username?: string;
  password?: string;
  insecure: boolean;
  createdAt: string;
}

/**
 * 从 localStorage 加载仓库列表
 */
const loadRegistries = (): RegistryConfig[] => {
  try {
    const data = localStorage.getItem(REGISTRIES_STORAGE_KEY);
    const registries = data ? JSON.parse(data) : [];
    // 确保 insecure 字段有默认值
    return registries.map((r: RegistryConfig) => ({
      ...r,
      insecure: r.insecure ?? true,
    }));
  } catch {
    return [];
  }
};

/**
 * 保存仓库列表到 localStorage
 */
const saveRegistries = (registries: RegistryConfig[]) => {
  localStorage.setItem(REGISTRIES_STORAGE_KEY, JSON.stringify(registries));
};

type Props = {
  secrets: any[];
  secretsWithCredentials?: any[];
  loading: boolean;
  namespacesOptions: string[];
  cloudId: string;
  nsValue?: string;
  onNsChange: (v?: string) => void;
  onRefresh: (force?: boolean) => void;
  createDefaultNamespace?: string;
};

/**
 * 解析仓库服务器地址
 */
const getRegistryServer = (secret: any) => {
  // 优先使用后端解析的字段
  if (secret?._registryServer) {
    return secret._registryServer;
  }
  // 兼容旧逻辑：尝试从 data 解析
  try {
    const data = secret?.data?.['.dockerconfigjson'];
    if (!data || data === '******') return '-';
    const decoded = atob(data);
    const config = JSON.parse(decoded);
    return Object.keys(config.auths || {})[0] || '-';
  } catch {
    return '-';
  }
};

/**
 * 格式化时间
 */
const formatTime = (timestamp?: string) => {
  if (!timestamp) return '-';
  try {
    const date = new Date(timestamp);
    return date.toLocaleString('zh-CN');
  } catch {
    return timestamp;
  }
};

/**
 * 计算运行时长
 */
const calculateAge = (timestamp?: string) => {
  if (!timestamp) return '-';
  try {
    const created = new Date(timestamp).getTime();
    const now = Date.now();
    const diff = now - created;
    
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    
    if (days > 0) return `${days}天 ${hours}小时`;
    if (hours > 0) return `${hours}小时 ${minutes}分钟`;
    return `${minutes}分钟`;
  } catch {
    return '-';
  }
};

/**
 * 镜像凭证详情抽屉组件
 */
const RegistryDetailDrawer: React.FC<{
  secret: any;
  visible: boolean;
  onClose: () => void;
}> = ({ secret, visible, onClose }) => {
  if (!secret) return null;
  
  const metadata = secret?.metadata || {};
  const registryServer = getRegistryServer(secret);
  const data = secret?.data || {};
  const dataKeys = Object.keys(data);
  
  return (
    <Drawer
      title={
        <Space>
          <KeyOutlined style={{ color: '#1890ff' }} />
          <span>镜像凭证详情</span>
        </Space>
      }
      placement="right"
      width={640}
      open={visible}
      onClose={onClose}
      extra={
        <Button icon={<CopyOutlined />} onClick={() => {
          navigator.clipboard.writeText(metadata.name);
          message.success('已复制名称');
        }}>
          复制名称
        </Button>
      }
    >
      <Card size="small" style={{ marginBottom: 16 }}>
        <Statistic 
          title="仓库地址" 
          value={registryServer}
          prefix={<GlobalOutlined />}
          valueStyle={{ fontSize: 18, fontFamily: 'monospace' }}
        />
      </Card>
      
      <Descriptions column={2} bordered size="small">
        <Descriptions.Item label="名称" span={2}>
          <Text code copyable>{metadata.name}</Text>
        </Descriptions.Item>
        <Descriptions.Item label="命名空间">
          <Tag color="blue">{metadata.namespace}</Tag>
        </Descriptions.Item>
        <Descriptions.Item label="类型">
          <Tag>kubernetes.io/dockerconfigjson</Tag>
        </Descriptions.Item>
        <Descriptions.Item label="运行时长">
          <Space>
            <ClockCircleOutlined />
            {calculateAge(metadata.creationTimestamp)}
          </Space>
        </Descriptions.Item>
        <Descriptions.Item label="创建时间">
          {formatTime(metadata.creationTimestamp)}
        </Descriptions.Item>
      </Descriptions>
      
      <Divider orientation="left">标签</Divider>
      <Space size={4} wrap>
        {Object.entries(metadata.labels || {}).map(([k, v]) => (
          <Tag key={k} color="geekblue">{k}={String(v)}</Tag>
        ))}
        {Object.keys(metadata.labels || {}).length === 0 && (
          <Text type="secondary">无标签</Text>
        )}
      </Space>
      
      <Divider orientation="left">数据键</Divider>
      <Space size={4} wrap>
        {dataKeys.length > 0 ? (
          dataKeys.map((key) => (
            <Tag key={key} icon={<LockOutlined />} color="purple">{key}</Tag>
          ))
        ) : (
          <Text type="secondary">无数据</Text>
        )}
      </Space>
      
      <Alert 
        type="info" 
        showIcon 
        icon={<InfoCircleOutlined />}
        style={{ marginTop: 16 }}
        message="凭证内容已脱敏，仅显示键名"
      />
    </Drawer>
  );
};

const message = { success: (msg: string) => console.log(msg) };

/**
 * 仓库详情抽屉组件
 */
const RegistryInfoDrawer: React.FC<{
  registry: RegistryConfig | null;
  visible: boolean;
  onClose: () => void;
  onBrowse: () => void;
  onEdit: () => void;
  onDelete: () => void;
}> = ({ registry, visible, onClose, onBrowse, onEdit, onDelete }) => {
  if (!registry) return null;
  
  const protocol = registry.insecure ? 'HTTP' : 'HTTPS';
  const hasAuth = !!registry.username;
  
  return (
    <Drawer
      title={
        <Space>
          <DatabaseOutlined style={{ color: '#1890ff' }} />
          <span>{registry.name}</span>
        </Space>
      }
      placement="right"
      width={640}
      open={visible}
      onClose={onClose}
      extra={
        <Space>
          <Button icon={<FolderOutlined />} onClick={onBrowse}>
            浏览镜像
          </Button>
          <Button icon={<EditOutlined />} onClick={onEdit}>
            编辑
          </Button>
          <Button danger icon={<DeleteOutlined />} onClick={onDelete}>
            删除
          </Button>
        </Space>
      }
    >
      {/* 状态卡片 */}
      <Card size="small" style={{ marginBottom: 16 }}>
        <Space split={<Divider type="vertical" />} wrap>
          <Statistic 
            title="协议" 
            value={protocol}
            prefix={registry.insecure ? <UnlockOutlined /> : <LockOutlined />}
            valueStyle={{ 
              fontSize: 16,
              color: registry.insecure ? '#fa8c16' : '#52c41a'
            }}
          />
          <Statistic 
            title="认证" 
            value={hasAuth ? '已配置' : '无需认证'}
            prefix={hasAuth ? <LockOutlined /> : <UnlockOutlined />}
            valueStyle={{ 
              fontSize: 16,
              color: hasAuth ? '#1890ff' : '#8c8c8c'
            }}
          />
          <Statistic 
            title="添加时间" 
            value={formatTime(registry.createdAt).split(' ')[0]}
            prefix={<ClockCircleOutlined />}
            valueStyle={{ fontSize: 16 }}
          />
        </Space>
      </Card>
      
      <Descriptions column={1} bordered size="small">
        <Descriptions.Item label="仓库名称">
          <Text strong>{registry.name}</Text>
        </Descriptions.Item>
        <Descriptions.Item label="仓库地址">
          <Space>
            <Text code copyable={{ text: registry.server }}>{registry.server}</Text>
          </Space>
        </Descriptions.Item>
        <Descriptions.Item label="协议类型">
          <Tag color={registry.insecure ? 'orange' : 'green'}>
            {registry.insecure ? 'HTTP' : 'HTTPS'}
          </Tag>
          {registry.insecure && (
            <Text type="secondary" style={{ marginLeft: 8 }}>
              (非安全连接)
            </Text>
          )}
        </Descriptions.Item>
        <Descriptions.Item label="认证信息">
          {hasAuth ? (
            <Space>
              <Tag color="blue" icon={<LockOutlined />}>已配置</Tag>
              <Text type="secondary">用户名: {registry.username}</Text>
            </Space>
          ) : (
            <Tag icon={<UnlockOutlined />}>公开仓库，无需认证</Tag>
          )}
        </Descriptions.Item>
      </Descriptions>
      
      <Divider orientation="left">快速操作</Divider>
      <Space direction="vertical" style={{ width: '100%' }}>
        <Alert
          type="info"
          showIcon
          message={
            <Space direction="vertical" size={4}>
              <Text>推送镜像命令：</Text>
              <Text code copyable>{`docker tag <image> ${registry.server}/<image-name> && docker push ${registry.server}/<image-name>`}</Text>
            </Space>
          }
        />
      </Space>
    </Drawer>
  );
};

/**
 * 添加仓库弹窗组件
 * 支持配置 HTTP 仓库到 Harvester containerd-registry
 */
const AddRegistryModal: React.FC<{
  visible: boolean;
  onOk: (registry: Omit<RegistryConfig, 'id' | 'createdAt'>) => void;
  onCancel: () => void;
  editData?: RegistryConfig | null;
  cloudId?: string;
}> = ({ visible, onOk, onCancel, editData, cloudId }) => {
  const [form] = Form.useForm();
  const { message } = App.useApp();
  const [loading, setLoading] = useState(false);
  
  useEffect(() => {
    if (visible) {
      if (editData) {
        form.setFieldsValue(editData);
      } else {
        form.resetFields();
        form.setFieldsValue({ insecure: true });
      }
    }
  }, [visible, editData, form]);
  
  const handleOk = async () => {
    try {
      const values = await form.validateFields();
      setLoading(true);
      
      // 如果是 HTTP 仓库且有 cloudId，则配置到 Harvester containerd-registry
      if (values.insecure && cloudId && values.server) {
        try {
          // 清理 server 地址（去掉协议前缀）
          let server = values.server.trim();
          if (server.startsWith('http://')) {
            server = server.slice(7);
          } else if (server.startsWith('https://')) {
            server = server.slice(8);
          }
          
          await addInsecureRegistry(cloudId, server);
        } catch (e: any) {
          // 配置失败但继续保存本地记录
          console.warn('配置 containerd-registry 失败:', e);
          message.warning(`containerd 配置失败: ${e.message}，但仓库信息已保存到本地`);
        }
      }
      
      onOk(values);
      form.resetFields();
    } catch (e: any) {
      // 表单验证失败
    } finally {
      setLoading(false);
    }
  };
  
  return (
    <Modal
      title={editData ? '编辑仓库' : '添加仓库'}
      open={visible}
      onOk={handleOk}
      onCancel={() => {
        form.resetFields();
        onCancel();
      }}
      confirmLoading={loading}
      destroyOnClose
      width={480}
    >
      <Form form={form} layout="vertical">
        <Form.Item
          name="name"
          label="仓库名称"
          rules={[{ required: true, message: '请输入仓库名称' }]}
        >
          <Input placeholder="如：本地Registry、阿里云镜像仓库" />
        </Form.Item>
        <Form.Item
          name="server"
          label="仓库地址"
          rules={[{ required: true, message: '请输入仓库地址' }]}
          extra="格式: host:port，如 172.16.3.79:30500"
        >
          <Input placeholder="如：172.16.3.79:30500" />
        </Form.Item>
        <Form.Item
          name="username"
          label="用户名"
          extra="公开仓库可留空"
        >
          <Input placeholder="可选" />
        </Form.Item>
        <Form.Item
          name="password"
          label="密码"
          extra="公开仓库可留空"
        >
          <Input.Password placeholder="可选" />
        </Form.Item>
        <Form.Item
          name="insecure"
          label="使用 HTTP"
          valuePropName="checked"
          tooltip="私有仓库通常使用 HTTP，勾选后会自动配置 containerd 允许拉取 HTTP 镜像"
        >
          <Switch checkedChildren="HTTP" unCheckedChildren="HTTPS" />
        </Form.Item>
        <Alert
          type="info"
          showIcon
          style={{ marginTop: 8 }}
          message="勾选 HTTP 后会自动配置 containerd 允许从此仓库拉取镜像"
        />
      </Form>
    </Modal>
  );
};

/**
 * 凭证表格组件（支持双轨制命名）
 */
const CredentialTable: React.FC<{
  secrets: any[];
  loading: boolean;
  cloudId: string;
  keyword: string;
  onKeywordChange: (v: string) => void;
  nsValue?: string;
  onNsChange: (v?: string) => void;
  namespacesOptions: string[];
  onViewDetail: (secret: any) => void;
  onEdit: (secret: any) => void;
  onDelete: (secret: any) => void;
  onBrowse: (secret: any) => void;
  onRefresh: (force?: boolean) => void;
  onCreateCredential: () => void;
}> = ({
  secrets,
  loading,
  cloudId,
  keyword,
  onKeywordChange,
  nsValue,
  onNsChange,
  namespacesOptions,
  onViewDetail,
  onEdit,
  onDelete,
  onBrowse,
  onRefresh,
  onCreateCredential,
}) => {
  const { modal, message } = App.useApp();
  const [aliasModalVisible, setAliasModalVisible] = useState(false);
  const [aliasRecord, setAliasRecord] = useState<any>(null);
  const [aliasSubmitting, setAliasSubmitting] = useState(false);
  const [aliasForm] = Form.useForm<{ alias?: string }>();
  const [yamlModalVisible, setYamlModalVisible] = useState(false);
  const [yamlContent, setYamlContent] = useState('');

  // 过滤数据
  const filteredSecrets = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    return secrets.filter((item: any) => {
      const name = item?.metadata?.name || '';
      const ns = item?.metadata?.namespace || '';
      const alias = item?.metadata?.annotations?.['tower.io/alias'] || '';
      
      if (kw && !name.toLowerCase().includes(kw) && !ns.toLowerCase().includes(kw) && !alias.toLowerCase().includes(kw)) {
        return false;
      }
      if (nsValue && ns !== nsValue) {
        return false;
      }
      return true;
    });
  }, [secrets, keyword, nsValue]);

  // 打开别名编辑弹窗
  const handleOpenAliasModal = useCallback((record: any) => {
    const currentAlias = record?.metadata?.annotations?.['tower.io/alias'] || '';
    setAliasRecord(record);
    setAliasModalVisible(true);
    aliasForm.setFieldsValue({ alias: String(currentAlias || '') });
  }, [aliasForm]);

  // 提交别名修改
  const handleSubmitAlias = useCallback(async (nextAliasRaw?: string) => {
    if (!aliasRecord) return false;
    const ns = aliasRecord?.metadata?.namespace;
    const name = aliasRecord?.metadata?.name;
    if (!ns || !name) {
      message.error('未能解析资源命名空间或名称');
      return false;
    }

    const next = String(nextAliasRaw || '').trim();
    const prev = String(aliasRecord?.metadata?.annotations?.['tower.io/alias'] || '').trim();
    if (next === prev) {
      setAliasModalVisible(false);
      return true;
    }

    const hasAnnotations = !!aliasRecord?.metadata?.annotations;
    const hasPrev = !!aliasRecord?.metadata?.annotations?.['tower.io/alias'];
    const aliasPath = '/metadata/annotations/tower.io~1alias';

    const patchBody: any[] = [];
    if (!next) {
      if (hasPrev) patchBody.push({ op: 'remove', path: aliasPath });
    } else {
      if (!hasAnnotations) {
        patchBody.push({ op: 'add', path: '/metadata/annotations', value: { 'tower.io/alias': next } });
      } else {
        patchBody.push({ op: 'add', path: aliasPath, value: next });
      }
    }

    if (patchBody.length === 0) {
      setAliasModalVisible(false);
      return true;
    }

    setAliasSubmitting(true);
    try {
      await patchHarvesterContainerResource(cloudId, SECRETS_API_PATH, ns, name, patchBody);
      message.success(next ? '名称修改成功' : '已清空别名');
      setAliasModalVisible(false);
      setAliasRecord(null);
      aliasForm.resetFields();
      onRefresh(true); // 强制刷新
      return true;
    } catch (e: any) {
      console.error(e);
      message.error(e?.message || '名称修改失败');
      return false;
    } finally {
      setAliasSubmitting(false);
    }
  }, [aliasRecord, cloudId, message, onRefresh, aliasForm]);

  // 查看 YAML
  const handleViewYaml = useCallback((record: any) => {
    try {
      const yamlStr = yaml.dump(record, { indent: 2, lineWidth: -1, noRefs: true });
      setYamlContent(yamlStr);
      setYamlModalVisible(true);
    } catch (e: any) {
      message.error('生成 YAML 失败: ' + e.message);
    }
  }, [message]);

  // 表格列
  const columns = useMemo(() => [
    {
      title: '名称',
      key: 'name',
      ellipsis: true,
      render: (_: any, record: any) => {
        const alias = record?.metadata?.annotations?.['tower.io/alias'];
        const id = record?.metadata?.name || '';
        const hasAlias = !!alias;
        
        return (
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span>{hasAlias ? alias : id}</span>
            <Tooltip title={hasAlias ? '修改别名' : '设置别名'}>
              <Button
                type="text"
                size="small"
                icon={<EditTwoTone />}
                onClick={(e) => {
                  e.stopPropagation();
                  handleOpenAliasModal(record);
                }}
              />
            </Tooltip>
          </span>
        );
      },
    },
    {
      title: 'ID',
      dataIndex: ['metadata', 'name'],
      key: 'id',
      ellipsis: true,
      render: (id: string) => <span style={{ color: '#888', fontSize: 12 }}>{id}</span>,
    },
    {
      title: '命名空间',
      dataIndex: ['metadata', 'namespace'],
      key: 'namespace',
      render: (ns: string) => <Tag>{ns}</Tag>,
    },
    {
      title: '仓库地址',
      key: 'registryServer',
      ellipsis: true,
      render: (_: any, record: any) => {
        const server = getRegistryServer(record);
        return (
          <Text code copyable={{ text: server }} ellipsis={{ tooltip: server }}>
            {server}
          </Text>
        );
      },
    },
    {
      title: '运行时长',
      key: 'age',
      render: (_: any, record: any) => calculateAge(record?.metadata?.creationTimestamp),
    },
    {
      title: '创建时间',
      dataIndex: ['metadata', 'creationTimestamp'],
      key: 'creationTimestamp',
      render: formatTime,
    },
    {
      title: '操作',
      key: 'actions',
      fixed: 'right' as const,
      render: (_: any, record: any) => {
        const items = [
          {
            key: 'detail',
            label: '详情',
            onClick: () => onViewDetail(record),
          },
          {
            key: 'yaml',
            label: '查看 YAML',
            onClick: () => handleViewYaml(record),
          },
          {
            key: 'browse',
            label: '浏览仓库',
            onClick: () => onBrowse(record),
          },
          {
            key: 'edit',
            label: '编辑',
            onClick: () => onEdit(record),
          },
          {
            key: 'delete',
            label: '删除',
            danger: true,
            onClick: () => {
              modal.confirm({
                title: '确认删除',
                content: `确定要删除镜像凭证 "${record?.metadata?.name}" 吗？`,
                okType: 'danger',
                onOk: () => onDelete(record),
              });
            },
          },
        ];
        return <ResourceActionsDropdown items={items} buttonProps={{ className: 'row-actions-trigger' }} />;
      },
    },
  ], [handleOpenAliasModal, handleViewYaml, onViewDetail, onDelete, onEdit, onBrowse, modal]);

  // 使用列设置 Hook
  const { displayColumns: credentialDisplayColumns } = useTableColumnSettings(
    columns,
    'harvester-containers-registries-credentials',
  );

  return (
    <div>
      <div className="page-toolbar">
        <div className="toolbar-container">
          <Input
            className="toolbar-search"
            allowClear
            placeholder="名称/命名空间/别名"
            suffix={<SearchOutlined style={{ color: 'rgba(0,0,0,.45)' }} />}
            value={keyword}
            onChange={(e) => onKeywordChange(e.target.value)}
          />
          <Select
            className="toolbar-filter-sm"
            placeholder="筛选命名空间"
            allowClear
            showSearch
            optionFilterProp="label"
            value={nsValue || undefined}
            onChange={onNsChange}
            options={namespacesOptions.map((ns) => ({ label: ns, value: ns }))}
          />
          <button
            type="button"
            className="toolbar-reset-btn"
            onClick={() => {
              onKeywordChange('');
              onNsChange(undefined);
            }}
          >
            重置
          </button>
        </div>
        <div className="toolbar-actions">
          <Button type="primary" icon={<PlusOutlined />} onClick={onCreateCredential}>
            创建凭证
          </Button>
          <TableColumnSettingsButton
            allColumns={columns}
            settingsKey="harvester-containers-registries-credentials"
          />
          <Tooltip title="刷新">
            <Button
              type="default"
              icon={<ReloadOutlined />}
              onClick={() => onRefresh(true)}
            />
          </Tooltip>
        </div>
      </div>

      <Table
        className="std-table"
        scroll={{ x: true }}
        bordered={false}
        rowKey={(record) => `${record?.metadata?.namespace}/${record?.metadata?.name}`}
        columns={credentialDisplayColumns}
        dataSource={filteredSecrets}
        loading={loading}
        pagination={{
          showTotal: (total) => `共 ${total} 条`,
        }}
      />

      {/* 别名编辑弹窗 */}
      <Modal
        title="名称修改"
        open={aliasModalVisible}
        centered
        okText="保存"
        cancelText="取消"
        confirmLoading={aliasSubmitting}
        onOk={async () => {
          try {
            const values = await aliasForm.validateFields();
            await handleSubmitAlias(values?.alias);
          } catch {}
        }}
        onCancel={() => {
          if (aliasSubmitting) return;
          setAliasModalVisible(false);
          setAliasRecord(null);
          aliasForm.resetFields();
        }}
      >
        <Form form={aliasForm} layout="vertical">
          <Form.Item
            name="alias"
            label="名称"
            rules={[
              { max: 64, message: '别名最长 64 个字符' },
              { required: true, message: '请输入名称' },
            ]}
          >
            <Input
              autoFocus
              placeholder="请输入名称（留空则清空别名）"
              maxLength={64}
              onPressEnter={async () => {
                if (aliasSubmitting) return;
                try {
                  const values = await aliasForm.validateFields();
                  await handleSubmitAlias(values?.alias);
                } catch {}
              }}
            />
          </Form.Item>
        </Form>
      </Modal>

      {/* YAML 查看弹窗 */}
      <Modal
        title="YAML 查看"
        open={yamlModalVisible}
        onCancel={() => setYamlModalVisible(false)}
        footer={null}
        width={800}
      >
        <YamlEditor
          value={yamlContent}
          onChange={() => {}}
          maxHeight={500}
          readOnly
        />
      </Modal>
    </div>
  );
};

/**
 * Registries Section 主组件
 */
const RegistriesSection: React.FC<Props> = ({
  secrets,
  secretsWithCredentials,
  loading,
  namespacesOptions,
  cloudId,
  nsValue,
  onNsChange,
  onRefresh,
  createDefaultNamespace,
}) => {
  const formDefaultNs = createDefaultNamespace ?? nsValue;
  const { modal, message } = App.useApp();
  
  // Tab 状态
  const [activeTab, setActiveTab] = useState('credentials');
  
  // 凭证列表状态
  const [keyword, setKeyword] = useState('');
  const [selectedKeys, setSelectedKeys] = useState<React.Key[]>([]);
  const [detailVisible, setDetailVisible] = useState(false);
  const [currentSecret, setCurrentSecret] = useState<any>(null);
  
  // 创建/编辑凭证弹窗状态
  const [createModalVisible, setCreateModalVisible] = useState(false);
  const [editData, setEditData] = useState<any>(null);
  
  // 仓库浏览器状态
  const [browserVisible, setBrowserVisible] = useState(false);
  const [browserCredential, setBrowserCredential] = useState<any>(null);
  
  // 仓库列表状态
  const [registries, setRegistries] = useState<RegistryConfig[]>([]);
  const [addRegistryVisible, setAddRegistryVisible] = useState(false);
  const [editingRegistry, setEditingRegistry] = useState<RegistryConfig | null>(null);
  const [registryKeyword, setRegistryKeyword] = useState('');
  
  // 仓库详情抽屉状态
  const [registryInfoVisible, setRegistryInfoVisible] = useState(false);
  const [currentRegistry, setCurrentRegistry] = useState<RegistryConfig | null>(null);
  
  // 加载仓库列表
  useEffect(() => {
    setRegistries(loadRegistries());
  }, []);
  
  // 查看凭证详情
  const handleViewDetail = useCallback((secret: any) => {
    setCurrentSecret(secret);
    setDetailVisible(true);
  }, []);
  
  // 删除凭证
  const handleDeleteSecret = useCallback(async (secret: any) => {
    const namespace = secret?.metadata?.namespace;
    const name = secret?.metadata?.name;
    
    try {
      await deleteHarvesterContainerResource(cloudId, SECRETS_API_PATH, namespace, name);
      message.success('删除成功');
      onRefresh(true);
    } catch (e: any) {
      message.error(e?.message || '删除失败');
    }
  }, [cloudId, message, onRefresh]);
  
  // 打开创建凭证弹窗
  const handleCreateCredential = useCallback(() => {
    setEditData(null);
    setCreateModalVisible(true);
  }, []);
  
  // 打开编辑凭证弹窗
  const handleEditCredential = useCallback(async (secret: any) => {
    const ns = secret?.metadata?.namespace;
    const name = secret?.metadata?.name;
    
    if (ns && name) {
      try {
        // 调用详情 API 并设置 reveal=true 获取未脱敏数据
        const result = await fetchHarvesterSecretDetail(cloudId, ns, name, true);
        const fullSecret = result?.data || result;
        setEditData(fullSecret);
      } catch (e: any) {
        console.error('获取凭证详情失败:', e);
        // 失败时使用列表中的数据
        setEditData(secret);
      }
    } else {
      setEditData(secret);
    }
    
    setCreateModalVisible(true);
  }, [cloudId]);
  
  // 浏览仓库（从凭证）
  const handleBrowseFromSecret = useCallback((secret: any) => {
    const server = getRegistryServer(secret);
    setBrowserCredential({
      server,
      username: '',
      password: '',
      insecure: true,
    });
    setBrowserVisible(true);
  }, []);
  
  // 浏览仓库（从仓库列表）
  const handleBrowseRegistry = useCallback((registry: RegistryConfig) => {
    // 智能推断 insecure：如果用户没有明确勾选过，根据端口推断
    // 注意：registry.insecure 可能是 false（明确设置为 HTTPS），需要区分
    // 对于非标准 HTTPS 端口，默认当作 HTTP 仓库处理
    const port = registry.server.split(':')[1];
    const httpPorts = ['30500', '5000', '8080', '80', '5001', '5002'];
    const isHttpPort = httpPorts.includes(port || '');
    
    // 如果是 HTTP 端口，强制使用 insecure=true
    const insecure = isHttpPort ? true : (registry.insecure ?? true);
    
    console.log('[handleBrowseRegistry] registry:', registry, 'port:', port, 'isHttpPort:', isHttpPort, 'insecure:', insecure);
    
    setBrowserCredential({
      server: registry.server,
      username: registry.username,
      password: registry.password,
      insecure,
    });
    setBrowserVisible(true);
  }, []);
  
  // 查看仓库详情
  const handleViewRegistry = useCallback((registry: RegistryConfig) => {
    setCurrentRegistry(registry);
    setRegistryInfoVisible(true);
  }, []);
  
  // 添加/编辑仓库
  const handleSaveRegistry = useCallback((data: Omit<RegistryConfig, 'id' | 'createdAt'>) => {
    const now = new Date().toISOString();
    
    if (editingRegistry) {
      // 编辑
      const updated = registries.map(r => 
        r.id === editingRegistry.id 
          ? { ...r, ...data }
          : r
      );
      setRegistries(updated);
      saveRegistries(updated);
      message.success('仓库已更新');
    } else {
      // 新增
      const newRegistry: RegistryConfig = {
        ...data,
        id: `registry-${Date.now()}`,
        createdAt: now,
      };
      const updated = [...registries, newRegistry];
      setRegistries(updated);
      saveRegistries(updated);
      message.success('仓库已添加');
    }
    
    setAddRegistryVisible(false);
    setEditingRegistry(null);
  }, [registries, editingRegistry, message]);
  
  // 删除仓库
  const handleDeleteRegistry = useCallback((id: string) => {
    const updated = registries.filter(r => r.id !== id);
    setRegistries(updated);
    saveRegistries(updated);
    message.success('仓库已删除');
    setRegistryInfoVisible(false);
    setCurrentRegistry(null);
  }, [registries, message]);
  
  // 凭证创建成功回调
  const handleCredentialSuccess = useCallback(() => {
    setCreateModalVisible(false);
    setEditData(null);
    onRefresh(true);
  }, [onRefresh]);
  
  // 仓库表格列（localStorage 仓库列表，不需要双轨制）
  const registryColumns = useMemo(() => [
    {
      title: '名称',
      dataIndex: 'name',
      key: 'name',
      render: (name: string, record: RegistryConfig) => (
        <Space>
          <DatabaseOutlined style={{ color: '#1890ff' }} />
          <Link onClick={() => handleViewRegistry(record)}>{name}</Link>
        </Space>
      ),
    },
    {
      title: '仓库地址',
      dataIndex: 'server',
      key: 'server',
      ellipsis: true,
      render: (server: string) => (
        <Text code copyable={{ text: server }} ellipsis={{ tooltip: server }}>
          {server}
        </Text>
      ),
    },
    {
      title: '协议',
      dataIndex: 'insecure',
      key: 'insecure',
      render: (insecure: boolean) => (
        <Tag color={insecure ? 'orange' : 'green'}>
          {insecure ? 'HTTP' : 'HTTPS'}
        </Tag>
      ),
    },
    {
      title: '认证',
      key: 'auth',
      render: (_: any, record: RegistryConfig) => (
        <Tag color={record.username ? 'blue' : 'default'}>
          {record.username ? '已配置' : '无需认证'}
        </Tag>
      ),
    },
    {
      title: '添加时间',
      dataIndex: 'createdAt',
      key: 'createdAt',
      render: formatTime,
    },
    {
      title: '操作',
      key: 'actions',
      fixed: 'right' as const,
      render: (_: any, record: RegistryConfig) => {
        const items = [
          {
            key: 'browse',
            label: '浏览镜像',
            onClick: () => handleBrowseRegistry(record),
          },
          {
            key: 'edit',
            label: '编辑',
            onClick: () => {
              setEditingRegistry(record);
              setAddRegistryVisible(true);
            },
          },
          {
            key: 'delete',
            label: '删除',
            danger: true,
            onClick: () => {
              modal.confirm({
                title: '确认删除',
                content: `确定要删除仓库 "${record.name}" 吗？`,
                okType: 'danger',
                onOk: () => handleDeleteRegistry(record.id),
              });
            },
          },
        ];
        return <ResourceActionsDropdown items={items} buttonProps={{ className: 'row-actions-trigger' }} />;
      },
    },
  ], [handleViewRegistry, handleBrowseRegistry, handleDeleteRegistry, modal]);
  
  // 使用列设置 Hook（镜像仓库）
  const { displayColumns: registryDisplayColumns } = useTableColumnSettings(
    registryColumns,
    'harvester-containers-registries',
  );
  
  return (
    <>
      <PageDetailSection asCard={false}>
        <Segmented
          style={{ marginBottom: 12 }}
          value={activeTab}
          onChange={setActiveTab}
          options={[
            { label: `镜像凭证 (${secrets.length})`, value: 'credentials' },
            { label: `镜像仓库 (${registries.length})`, value: 'registries' },
          ]}
        />
        {activeTab === 'credentials' ? (
          <CredentialTable
            secrets={secrets}
            loading={loading}
            cloudId={cloudId}
            keyword={keyword}
            onKeywordChange={setKeyword}
            nsValue={nsValue}
            onNsChange={onNsChange}
            namespacesOptions={namespacesOptions}
            onViewDetail={handleViewDetail}
            onEdit={handleEditCredential}
            onDelete={handleDeleteSecret}
            onBrowse={handleBrowseFromSecret}
            onRefresh={onRefresh}
            onCreateCredential={handleCreateCredential}
          />
        ) : (
          <div key="registries">
            <div className="page-toolbar">
              <div className="toolbar-container">
                <Input
                  className="toolbar-search"
                  allowClear
                  placeholder="搜索仓库名称/地址"
                  suffix={<SearchOutlined style={{ color: 'rgba(0,0,0,.45)' }} />}
                  value={registryKeyword}
                  onChange={(e) => setRegistryKeyword(e.target.value)}
                />
              </div>
              <div className="toolbar-actions">
                <Button type="primary" icon={<DatabaseOutlined />} onClick={() => { setEditingRegistry(null); setAddRegistryVisible(true); }}>
                  添加仓库
                </Button>
                <TableColumnSettingsButton
                  allColumns={registryColumns}
                  settingsKey="harvester-containers-registries"
                />
                <Tooltip title="刷新">
                  <Button
                    type="default"
                    icon={<ReloadOutlined />}
                    onClick={() => setRegistries(loadRegistries())}
                  />
                </Tooltip>
              </div>
            </div>
            <Table
              className="std-table"
              scroll={{ x: true }}
              bordered={false}
              rowKey="id"
              columns={registryDisplayColumns}
              dataSource={registries.filter(r => {
                if (!registryKeyword.trim()) return true;
                const kw = registryKeyword.toLowerCase();
                return r.name.toLowerCase().includes(kw) || r.server.toLowerCase().includes(kw);
              })}
              pagination={{
                showTotal: (total) => `共 ${total} 条`,
              }}
              locale={{
                emptyText: (
                  <Empty
                    description='暂无仓库，点击"添加仓库"开始'
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                  />
                ),
              }}
            />
          </div>
        )}
      </PageDetailSection>
      
      {/* 镜像凭证详情抽屉 */}
      <RegistryDetailDrawer
        secret={currentSecret}
        visible={detailVisible}
        onClose={() => {
          setDetailVisible(false);
          setCurrentSecret(null);
        }}
      />
      
      {/* 仓库详情抽屉 */}
      <RegistryInfoDrawer
        registry={currentRegistry}
        visible={registryInfoVisible}
        onClose={() => {
          setRegistryInfoVisible(false);
          setCurrentRegistry(null);
        }}
        onBrowse={() => {
          if (currentRegistry) {
            handleBrowseRegistry(currentRegistry);
            setRegistryInfoVisible(false);
          }
        }}
        onEdit={() => {
          if (currentRegistry) {
            setEditingRegistry(currentRegistry);
            setAddRegistryVisible(true);
            setRegistryInfoVisible(false);
          }
        }}
        onDelete={() => {
          if (currentRegistry) {
            modal.confirm({
              title: '确认删除',
              content: `确定要删除仓库 "${currentRegistry.name}" 吗？`,
              okType: 'danger',
              onOk: () => handleDeleteRegistry(currentRegistry.id),
            });
          }
        }}
      />
      
      {/* 创建/编辑凭证弹窗 */}
      <RegistryCredentialModal
        visible={createModalVisible}
        editData={editData}
        namespaces={namespacesOptions}
        cloudId={cloudId}
        defaultNamespace={formDefaultNs}
        onCancel={() => {
          setCreateModalVisible(false);
          setEditData(null);
        }}
        onSuccess={handleCredentialSuccess}
      />
      
      {/* 仓库浏览器抽屉 */}
      {browserVisible && (
        <RegistryBrowserDrawer
          cloudId={cloudId}
          visible={browserVisible}
          credential={browserCredential}
          onClose={() => {
            setBrowserVisible(false);
            setBrowserCredential(null);
          }}
        />
      )}
      
      {/* 添加/编辑仓库弹窗 */}
      <AddRegistryModal
        visible={addRegistryVisible}
        onOk={handleSaveRegistry}
        onCancel={() => {
          setAddRegistryVisible(false);
          setEditingRegistry(null);
        }}
        editData={editingRegistry}
        cloudId={cloudId}
      />
    </>  );
};

export default RegistriesSection;