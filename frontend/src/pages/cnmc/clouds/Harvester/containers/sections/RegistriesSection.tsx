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
import { Table, Select, Button, Tag, Space, App, Drawer, Descriptions, Input, Typography, Segmented, Modal, Form, Switch, Empty, Statistic, Card, Divider, Alert, Tooltip } from 'antd';
import { 
  KeyOutlined, 
  DatabaseOutlined,
  SearchOutlined,
  CopyOutlined, GlobalOutlined, LockOutlined, ClockCircleOutlined,
  InfoCircleOutlined, EditTwoTone, PlusOutlined, ReloadOutlined,
  DockerOutlined, ApiOutlined,
} from '@ant-design/icons';
import yaml from 'js-yaml';
import PageDetailSection from '../../../../../../components/PageDetailSection';
import ResourceActionsDropdown from '../../../../../../components/ResourceActionsDropdown';
import WriteGuard from '../../../../../../components/WriteGuard';
import { useTableColumnSettings } from '../../../../../../hooks/useTableColumnSettings';
import TableColumnSettingsButton from '../../../../../../components/TableColumnSettingsButton';
import { useAuth } from '../../../../../../contexts/AuthContext';
import { hasPermissionForAction } from '../../../../../../utils/accessMapping';
import { filterMenuItemsForReadOnly } from '../../../../../../utils/rbacUi';
import YamlEditor from '../../../../../../components/YamlEditor';
import {
  deleteHarvesterContainerResource,
  addInsecureRegistry,
  patchHarvesterContainerResource,
  fetchHarvesterSecretDetail,
  getHarborRegistries,
  testHarborConnection,
  deleteHarborRegistry,
  createHarborRegistry,
  updateHarborRegistry,
  getRegistryCatalog,
} from '../../../../../../services/harvesterApi';
import { RegistryCredentialModal, RegistryBrowserDrawer } from '../components';
import GenericRegistryDrawer from '../components/GenericRegistryDrawer';
import HarborDetailDrawer from '../../harbor/components/HarborDetailDrawer';
import ProjectDetailDrawer from '../../harbor/components/ProjectDetailDrawer';
import RepositoryDetailDrawer from '../../harbor/components/RepositoryDetailDrawer';
import type { HarborProject, HarborRepository } from '../../harbor/types';

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
  // Harbor 扩展字段
  type?: 'generic' | 'harbor';
  status?: 'healthy' | 'unhealthy' | 'unknown';
  harborId?: string;
  isBuiltIn?: boolean;
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
 * Harbor 图标组件
 */
const HarborIcon: React.FC<{ style?: React.CSSProperties }> = ({ style }) => (
  <svg
    viewBox="0 0 1024 1024"
    width="1.1em"
    height="1.1em"
    style={{ ...style, verticalAlign: '-0.15em' }}
  >
    <path d="M512 506.930693m-506.930693 0a506.930693 506.930693 0 1 0 1013.861386 0 506.930693 506.930693 0 1 0-1013.861386 0Z" fill="#696566" />
    <path d="M512 506.930693m-405.544554 0a405.544554 405.544554 0 1 0 811.089108 0 405.544554 405.544554 0 1 0-811.089108 0Z" fill="#FFFFFF" />
    <path d="M494.865743 403.303921L798.872079 89.432713c22.994376 15.623604 43.018139 31.328317 60.071287 47.083723 17.053149 15.765545 33.802139 34.065743 50.246971 54.900594L494.865743 403.314059zM512 424.118495l454.524198-140.926733c12.054812 23.633109 21.453307 45.502099 28.185347 65.596832a347.511129 347.511129 0 0 1 14.630019 61.987485L512 424.118495zM503.716752 448.836436l514.788119 39.692673c0.95303 17.306614 0.141941 38.932277-2.402851 64.897267-2.554931 25.96499-6.184554 49.435881-10.89901 70.412674l-501.486258-174.992476z" fill="#83B8E2" />
    <path d="M293.512871 378.302099v-27.526337l87.496238-87.47596v-7.948673a10.067644 10.067644 0 1 1 20.135287 0v7.948673l87.486099 87.47596v27.526337h-13.991287v97.340832h13.991287v47.590653h-13.991287l29.503366 490.759604c-45.512238-2.382574-85.194772-7.745901-119.047604-16.08998-33.842693-8.333941-67.604277-21.06804-101.264475-38.192158l32.747723-436.467327H293.512871v-47.600792h15.998733v-97.340832H293.512871z" fill="#4FA434" />
    <path d="M311.782653 586.468119l171.271604 76.749307 1.571486 26.309703-174.586931-79.162297zM307.362218 645.241663l179.625822 80.703367 1.470099 27.100515-182.900594-82.649981zM302.343604 713.210931l188.933069 86.076831 1.926337 27.637862-193.252119-86.725703zM297.051248 782.143366l198.483643 90.030891 1.68301 27.648-202.204515-89.473267zM335.081188 378.44404h115.093545v97.462495h-29.128238v-43.271604a29.33101 29.33101 0 1 0-58.66202 0v43.271604H335.081188v-97.462495z" fill="#FFFFFF" />
  </svg>
);

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
        <Descriptions.Item label="项目">
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
 * 添加仓库弹窗组件
 * 支持两种类型：generic（通用仓库）和 harbor（Harbor 仓库）
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
  const [registryType, setRegistryType] = useState<'generic' | 'harbor'>('generic');
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message?: string } | null>(null);
  
  // 监听 visible 变化，初始化表单
  useEffect(() => {
    if (visible) {
      if (editData) {
        form.setFieldsValue(editData);
        setRegistryType(editData.type || 'generic');
      } else {
        form.resetFields();
        form.setFieldsValue({ insecure: true, type: 'generic' });
        setRegistryType('generic');
      }
      setTestResult(null);
    }
  }, [visible, editData, form]);
  
  // 类型切换处理
  const handleTypeChange = useCallback((type: 'generic' | 'harbor') => {
    setRegistryType(type);
    setTestResult(null);
    // 切换类型时重置部分字段
    form.setFieldsValue({
      username: undefined,
      password: undefined,
    });
  }, [form]);
  
  // 测试连接（Harbor 类型）
  const handleTestConnection = useCallback(async () => {
    try {
      const values = await form.validateFields(['server', 'username', 'password', 'insecure']);
      setTesting(true);
      setTestResult(null);
      
      // 清理 server 地址
      let server = values.server?.trim() || '';
      if (server.startsWith('http://')) {
        server = server.slice(7);
      } else if (server.startsWith('https://')) {
        server = server.slice(8);
      }
      
      // 如果是编辑模式，使用现有 harborId
      if (editData?.harborId) {
        const res = await testHarborConnection(editData.harborId);
        const success = res?.data?.success || res?.success;
        if (success) {
          setTestResult({ success: true, message: '连接成功' });
          message.success('连接测试成功');
        } else {
          setTestResult({ success: false, message: res?.data?.message || res?.message || '连接失败' });
          message.warning('连接测试失败');
        }
      } else {
        // 新建时，先创建临时实例进行测试
        try {
          const tempPayload = {
            name: '__temp_test__',
            url: server,
            username: values.username,
            password: values.password,
            insecure: values.insecure ?? false,
          };
          
          // 创建临时实例
          const tempRegistry = await createHarborRegistry(tempPayload);
          const tempId = tempRegistry?.id || tempRegistry?.data?.id;
          
          if (!tempId) {
            throw new Error('创建临时实例失败');
          }
          
          // 测试连接
          const res = await testHarborConnection(tempId);
          const success = res?.data?.success || res?.success;
          if (success) {
            setTestResult({ success: true, message: '连接成功' });
            message.success('连接测试成功');
          } else {
            setTestResult({ success: false, message: res?.data?.message || res?.message || '连接失败' });
            message.warning('连接测试失败');
          }
          
          // 删除临时实例
          await deleteHarborRegistry(tempId);
        } catch (err: any) {
          setTestResult({ success: false, message: err?.message || '测试失败' });
          message.error(err?.message || '连接测试失败');
        }
      }
    } catch (e: any) {
      // 表单验证失败
      if (e?.errorFields?.length) {
        message.warning('请先填写完整信息');
      }
    } finally {
      setTesting(false);
    }
  }, [editData, message, form]);
  
  // 提交处理
  const handleOk = async () => {
    try {
      const values = await form.validateFields();
      setLoading(true);
      
      if (values.type === 'harbor') {
        // Harbor 类型：调用后端 API
        try {
          // 清理 server 地址
          let server = values.server?.trim() || '';
          if (server.startsWith('http://')) {
            server = server.slice(7);
          } else if (server.startsWith('https://')) {
            server = server.slice(8);
          }
          
          const payload: any = {
            name: values.name,
            url: server,
            username: values.username,
            insecure: values.insecure ?? false,
          };
          
          // 编辑模式下，只有填写了密码才传递密码字段
          if (!editData || values.password?.trim()) {
            payload.password = values.password;
          }
          
          let result;
          if (editData?.harborId) {
            // 编辑模式
            result = await updateHarborRegistry(editData.harborId, payload);
            message.success('Harbor 仓库已更新');
          } else {
            // 新建模式
            result = await createHarborRegistry(payload);
            message.success('Harbor 仓库已添加');
          }
          
          // 通知父组件刷新
          onOk({
            ...values,
            server,
            type: 'harbor',
            harborId: result?.id || result?.data?.id || editData?.harborId,
          });
        } catch (e: any) {
          message.error(e?.message || '保存 Harbor 仓库失败');
          return;
        }
      } else {
        // Generic 类型：保持现有逻辑
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
      }
      
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
        setTestResult(null);
        onCancel();
      }}
      confirmLoading={loading}
      destroyOnClose
      width={520}
    >
      <Form form={form} layout="vertical">
        {/* 仓库类型选择 */}
        <Form.Item
          name="type"
          label="仓库类型"
          rules={[{ required: true, message: '请选择仓库类型' }]}
          initialValue="generic"
        >
          <Select onChange={handleTypeChange}>
            <Select.Option value="generic">
              <Space>
                <DockerOutlined style={{ color: '#2496ED' }} />
                <span>通用仓库</span>
              </Space>
            </Select.Option>
            <Select.Option value="harbor">
              <Space>
                <HarborIcon style={{ color: '#4a00d8' }} />
                <span>Harbor 仓库</span>
              </Space>
            </Select.Option>
          </Select>
        </Form.Item>
        
        {/* 通用字段 */}
        <Form.Item
          name="name"
          label="仓库名称"
          rules={[{ required: true, message: '请输入仓库名称' }]}
        >
          <Input placeholder="如：本地Registry、阿里云镜像仓库" />
        </Form.Item>
        <Form.Item
          name="server"
          label={registryType === 'harbor' ? 'Harbor 地址' : '仓库地址'}
          rules={[{ required: true, message: '请输入仓库地址' }]}
          extra={registryType === 'harbor' ? '格式: host:port 或完整 URL' : '格式: host:port，如 172.16.3.79:30500'}
        >
          <Input placeholder={registryType === 'harbor' ? '如：harbor.example.com' : '如：172.16.3.79:30500'} />
        </Form.Item>
        
        {/* Harbor 类型：用户名密码必填 */}
        {registryType === 'harbor' && (
          <>
            <Form.Item
              name="username"
              label="用户名"
              rules={[{ required: true, message: 'Harbor 仓库需要用户名' }]}
            >
              <Input placeholder="必填" />
            </Form.Item>
            <Form.Item
              name="password"
              label="密码"
              rules={[{ required: !editData, message: 'Harbor 仓库需要密码' }]}
              extra={editData ? '留空则不修改密码' : undefined}
            >
              <Input.Password placeholder={editData ? '留空则不修改' : '必填'} />
            </Form.Item>
          </>
        )}
        
        {/* Generic 类型：用户名密码可选 */}
        {registryType === 'generic' && (
          <>
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
          </>
        )}
        
        {/* 协议选择 */}
        <Form.Item
          name="insecure"
          label="协议类型"
          valuePropName="checked"
          tooltip={registryType === 'harbor' 
            ? '选择 HTTP 将使用非安全连接访问 Harbor' 
            : '私有仓库通常使用 HTTP，勾选后会自动配置 containerd 允许拉取 HTTP 镜像'}
        >
          <Switch checkedChildren="HTTP" unCheckedChildren="HTTPS" />
        </Form.Item>
        
        {/* Harbor 类型：测试连接按钮 */}
        {registryType === 'harbor' && (
          <Form.Item>
            <Space>
              <Button 
                onClick={handleTestConnection}
                loading={testing}
                icon={<ApiOutlined />}
              >
                测试连接
              </Button>
              {testResult && (
                <Tag color={testResult.success ? 'success' : 'error'}>
                  {testResult.success ? '✓ 连接成功' : `✗ ${testResult.message || '连接失败'}`}
                </Tag>
              )}
            </Space>
          </Form.Item>
        )}
        
        {/* Generic 类型：提示信息 */}
        {registryType === 'generic' && (
          <Alert
            type="info"
            showIcon
            style={{ marginTop: 8 }}
            message="勾选 HTTP 后会自动配置 containerd 允许从此仓库拉取镜像"
          />
        )}
        
        {/* Harbor 类型：提示信息 */}
        {registryType === 'harbor' && (
          <Alert
            type="info"
            showIcon
            style={{ marginTop: 8 }}
            message="Harbor 仓库将保存到系统，支持项目管理、镜像扫描等高级功能"
          />
        )}
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
  hasContainersWrite: boolean;
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
  hasContainersWrite,
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
      title: '项目',
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
              const alias = record?.metadata?.annotations?.['tower.io/alias'];
              const id = record?.metadata?.name || '';
              const displayName = alias ? `${alias} (${id})` : id;
              modal.confirm({
                title: '确认删除',
                content: `确定要删除镜像凭证 "${displayName}" 吗？`,
                okType: 'danger',
                onOk: () => onDelete(record),
              });
            },
          },
        ];
        return (
          <ResourceActionsDropdown
            items={filterMenuItemsForReadOnly(items, hasContainersWrite)}
            buttonProps={{ className: 'row-actions-trigger' }}
          />
        );
      },
    },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [handleViewYaml, onViewDetail, onDelete, onEdit, onBrowse, modal, hasContainersWrite]);

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
            placeholder="名称/项目/别名"
            suffix={<SearchOutlined style={{ color: 'rgba(0,0,0,.45)' }} />}
            value={keyword}
            onChange={(e) => onKeywordChange(e.target.value)}
          />
          <Select
            className="toolbar-filter-sm"
            placeholder="筛选项目"
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
          <WriteGuard canWrite={hasContainersWrite}>
            <Button type="primary" icon={<PlusOutlined />} onClick={onCreateCredential}>
              创建凭证
            </Button>
          </WriteGuard>
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
  secretsWithCredentials: _secretsWithCredentials,
  loading,
  namespacesOptions,
  cloudId,
  nsValue,
  onNsChange,
  onRefresh,
  createDefaultNamespace,
}) => {
  const { user } = useAuth();
  const formDefaultNs = createDefaultNamespace ?? nsValue ?? 'default';
  const { modal, message } = App.useApp();
  const hasContainersWrite = useMemo(() => {
    const perms = (user?.permissions ?? []) as string[];
    return (
      hasPermissionForAction(perms, 'clouds.containers:write') ||
      hasPermissionForAction(perms, 'clouds:write') ||
      hasPermissionForAction(perms, 'clouds.console:write')
    );
  }, [user?.permissions]);
  
  // Tab 状态
  const [activeTab, setActiveTab] = useState('credentials');
  
  // 凭证列表状态
  const [keyword, setKeyword] = useState('');
  const [detailVisible, setDetailVisible] = useState(false);
  const [currentSecret, setCurrentSecret] = useState<any>(null);
  
  // 创建/编辑凭证弹窗状态
  const [createModalVisible, setCreateModalVisible] = useState(false);
  const [editData, setEditData] = useState<any>(null);
  
  // 仓库浏览器状态
  const [browserVisible, setBrowserVisible] = useState(false);
  const [browserCredential, setBrowserCredential] = useState<any>(null);
  
  // 仓库列表状态（generic + harbor）
  const [localRegistries, setLocalRegistries] = useState<RegistryConfig[]>([]);
  const [harborRegistries, setHarborRegistries] = useState<RegistryConfig[]>([]);
  const [harborLoading, setHarborLoading] = useState(false);
  const [addRegistryVisible, setAddRegistryVisible] = useState(false);
  const [editingRegistry, setEditingRegistry] = useState<RegistryConfig | null>(null);
  const [registryKeyword, setRegistryKeyword] = useState('');
  
  // 通用仓库管理抽屉状态
  const [genericDrawerVisible, setGenericDrawerVisible] = useState(false);
  const [selectedGenericRegistry, setSelectedGenericRegistry] = useState<RegistryConfig | null>(null);
  
  // Harbor 抽屉状态
  const [harborDrawerVisible, setHarborDrawerVisible] = useState(false);
  const [selectedHarborId, setSelectedHarborId] = useState<string | null>(null);

  // 项目抽屉状态
  const [projectDrawerVisible, setProjectDrawerVisible] = useState(false);
  const [selectedProject, setSelectedProject] = useState<HarborProject | null>(null);

  // 仓库抽屉状态
  const [repoDrawerVisible, setRepoDrawerVisible] = useState(false);
  const [selectedRepo, setSelectedRepo] = useState<HarborRepository | null>(null);
  
  // 合并后的仓库列表（按添加时间倒序）
  const allRegistries = useMemo(() => {
    const merged = [
      ...localRegistries.map(r => ({ ...r, type: 'generic' as const })),
      ...harborRegistries,
    ];
    return merged.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [localRegistries, harborRegistries]);
  
  // 加载本地仓库列表
  useEffect(() => {
    setLocalRegistries(loadRegistries());
  }, []);
  
  // 加载 Harbor 仓库列表
  const loadHarborRegistries = useCallback(async () => {
    setHarborLoading(true);
    try {
      const res = await getHarborRegistries();
      const harborData = (res?.data || res || []).map((item: any) => ({
        ...item,
        id: `harbor-${item.id}`,
        type: 'harbor' as const,
        server: item.url || item.server,
        harborId: item.id,
        name: item.name || item.url,
        insecure: item.insecure ?? false,
        createdAt: item.createdAt || new Date().toISOString(),
        status: item.status || 'unknown',
        isBuiltIn: item.isBuiltIn || false,
      }));
      setHarborRegistries(harborData);
    } catch (e: any) {
      // Harbor API 不存在或失败时，忽略错误，不影响通用仓库
      console.warn('加载 Harbor 仓库列表失败:', e);
      setHarborRegistries([]);
    } finally {
      setHarborLoading(false);
    }
  }, []);
  
  useEffect(() => {
    loadHarborRegistries();
  }, [loadHarborRegistries]);
  
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
  
  // 打开 Harbor 详情
  const handleOpenHarbor = useCallback((harborId: string) => {
    setSelectedHarborId(harborId);
    setHarborDrawerVisible(true);
  }, []);

  // 打开项目详情
  const handleOpenProject = useCallback((project: HarborProject) => {
    setHarborDrawerVisible(false);
    setSelectedProject(project);
    setProjectDrawerVisible(true);
  }, []);

  // 从项目返回 Harbor
  const handleBackToHarbor = useCallback(() => {
    setProjectDrawerVisible(false);
    setSelectedProject(null);
    setHarborDrawerVisible(true);
  }, []);

  // 打开仓库详情
  const handleOpenRepository = useCallback((repo: HarborRepository) => {
    setProjectDrawerVisible(false);
    setSelectedRepo(repo);
    setRepoDrawerVisible(true);
  }, []);

  // 从仓库返回项目
  const handleBackToProject = useCallback(() => {
    setRepoDrawerVisible(false);
    setSelectedRepo(null);
    setProjectDrawerVisible(true);
  }, []);

  // 关闭所有抽屉
  const handleCloseAll = useCallback(() => {
    setHarborDrawerVisible(false);
    setProjectDrawerVisible(false);
    setRepoDrawerVisible(false);
    setSelectedHarborId(null);
    setSelectedProject(null);
    setSelectedRepo(null);
  }, []);
  
  // 添加/编辑仓库
  const handleSaveRegistry = useCallback((data: Omit<RegistryConfig, 'id' | 'createdAt'>) => {
    const now = new Date().toISOString();
    
    // Harbor 类型：由 AddRegistryModal 内部处理 API 调用，这里只需要刷新列表
    if (data.type === 'harbor') {
      // 刷新 Harbor 列表
      const reloadHarbor = async () => {
        try {
          const res = await getHarborRegistries();
          const harborData = (res?.data || res || []).map((item: any) => ({
            ...item,
            id: `harbor-${item.id}`,
            type: 'harbor' as const,
            server: item.url || item.server,
            harborId: item.id,
            name: item.name || item.url,
            insecure: item.insecure ?? false,
            createdAt: item.createdAt || new Date().toISOString(),
            status: item.status || 'unknown',
            isBuiltIn: item.isBuiltIn || false,
          }));
          setHarborRegistries(harborData);
        } catch (e: any) {
          console.warn('刷新 Harbor 列表失败:', e);
        }
      };
      reloadHarbor();
      
      setAddRegistryVisible(false);
      setEditingRegistry(null);
      return;
    }
    
    // Generic 类型：保存到 localStorage
    if (editingRegistry && editingRegistry.type === 'generic') {
      // 编辑 generic 仓库 - 校验重复（排除自身）
      const nameExists = localRegistries.some((r: RegistryConfig) => 
        r.id !== editingRegistry.id && r.name === data.name
      );
      const serverExists = localRegistries.some((r: RegistryConfig) => 
        r.id !== editingRegistry.id && r.server === data.server
      );
      if (nameExists) {
        message.error('仓库名称已存在');
        return;
      }
      if (serverExists) {
        message.error('仓库地址已存在');
        return;
      }
      
      const updated = localRegistries.map((r: RegistryConfig) => 
        r.id === editingRegistry.id 
          ? { ...r, ...data }
          : r
      );
      setLocalRegistries(updated);
      saveRegistries(updated);
      message.success('仓库已更新');
    } else if (!editingRegistry || editingRegistry.type === 'generic') {
      // 新增 generic 仓库 - 校验重复
      const nameExists = localRegistries.some((r: RegistryConfig) => r.name === data.name);
      const serverExists = localRegistries.some((r: RegistryConfig) => r.server === data.server);
      if (nameExists) {
        message.error('仓库名称已存在');
        return;
      }
      if (serverExists) {
        message.error('仓库地址已存在');
        return;
      }
      
      const newRegistry: RegistryConfig = {
        ...data,
        id: `registry-${Date.now()}`,
        createdAt: now,
        type: 'generic',
      };
      const updated = [...localRegistries, newRegistry];
      setLocalRegistries(updated);
      saveRegistries(updated);
      message.success('仓库已添加');
    }
    
    setAddRegistryVisible(false);
    setEditingRegistry(null);
  }, [localRegistries, editingRegistry, message]);
  
  // 删除仓库
  const handleDeleteRegistry = useCallback(async (record: RegistryConfig) => {
    if (record.type === 'harbor' && record.harborId) {
      // 删除 Harbor 仓库
      try {
        await deleteHarborRegistry(record.harborId);
        message.success('Harbor 仓库已删除');
        // 刷新 Harbor 列表
        setHarborRegistries(prev => prev.filter(r => r.id !== record.id));
      } catch (e: any) {
        message.error(e?.message || '删除 Harbor 仓库失败');
        return;
      }
    } else {
      // 删除 generic 仓库
      const updated = localRegistries.filter((r: RegistryConfig) => r.id !== record.id);
      setLocalRegistries(updated);
      saveRegistries(updated);
      message.success('仓库已删除');
    }
  }, [localRegistries, message]);
  
  // 测试通用仓库连接
  const handleTestGenericConnection = useCallback(async (record: RegistryConfig) => {
    const hide = message.loading('正在测试连接...');
    try {
      await getRegistryCatalog(
        cloudId,
        record.server,
        record.username,
        record.password,
        record.insecure,
        1,
      );
      hide();
      message.success('连接测试成功');
      // 更新 localStorage 和状态
      const updated = localRegistries.map(r =>
        r.id === record.id ? { ...r, status: 'healthy' as const } : r
      );
      setLocalRegistries(updated);
      saveRegistries(updated);
    } catch (e: any) {
      hide();
      message.error(e?.message || '连接测试失败');
      const updated = localRegistries.map(r =>
        r.id === record.id ? { ...r, status: 'unhealthy' as const } : r
      );
      setLocalRegistries(updated);
      saveRegistries(updated);
    }
  }, [cloudId, localRegistries, message]);
  
  // 测试 Harbor 连接
  const handleTestHarborConnection = useCallback(async (record: RegistryConfig) => {
    if (!record.harborId) return;
    
    const hide = message.loading('正在测试连接...');
    try {
      const res = await testHarborConnection(record.harborId);
      hide();
      const success = res?.data?.success || res?.success;
      if (success) {
        message.success('连接测试成功');
        // 更新状态
        setHarborRegistries(prev => prev.map(r => 
          r.id === record.id ? { ...r, status: 'healthy' } : r
        ));
      } else {
        message.warning('连接测试失败');
        setHarborRegistries(prev => prev.map(r => 
          r.id === record.id ? { ...r, status: 'unhealthy' } : r
        ));
      }
    } catch (e: any) {
      hide();
      message.error(e?.message || '连接测试失败');
      setHarborRegistries(prev => prev.map(r => 
        r.id === record.id ? { ...r, status: 'unhealthy' } : r
      ));
    }
  }, [message]);
  
  // 凭证创建成功回调
  const handleCredentialSuccess = useCallback(() => {
    setCreateModalVisible(false);
    setEditData(null);
    onRefresh(true);
  }, [onRefresh]);
  
  // 仓库表格列（支持 generic + harbor）
  const registryColumns = useMemo(() => [
    {
      title: '名称',
      dataIndex: 'name',
      key: 'name',
      render: (name: string, record: RegistryConfig) => (
        <Space>
          <Link onClick={() => {
            if (record.type === 'harbor' && record.harborId) {
              handleOpenHarbor(record.harborId);
            } else {
              setSelectedGenericRegistry(record);
              setGenericDrawerVisible(true);
            }
          }}>{name}</Link>
          {record.isBuiltIn && (
            <Tag color="blue" style={{ marginLeft: 4 }}>默认</Tag>
          )}
        </Space>
      ),
    },
    {
      title: '类型',
      dataIndex: 'type',
      key: 'type',
      width: 120,
      render: (type: string, _record: RegistryConfig) => {
        if (type === 'harbor') {
          return (
            <Space>
              <HarborIcon style={{ color: '#4a00d8' }} />
              <span>Harbor</span>
            </Space>
          );
        }
        return (
          <Space>
            <DockerOutlined style={{ color: '#2496ED' }} />
            <span>通用</span>
          </Space>
        );
      },
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
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 100,
      render: (status: string) => {
        const statusConfig: Record<string, { icon: string; text: string; color: string }> = {
          healthy: { icon: '🟢', text: '健康', color: 'success' },
          unhealthy: { icon: '🔴', text: '异常', color: 'error' },
          unknown: { icon: '⚪', text: '未知', color: 'default' },
        };
        
        const config = statusConfig[status || 'unknown'];
        return <Tag color={config.color}>{config.icon} {config.text}</Tag>;
      },
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
        // Harbor 仓库操作
        if (record.type === 'harbor') {
          const items = [
            {
              key: 'manage',
              label: '进入管理',
              onClick: () => handleOpenHarbor(record.harborId!),
            },
            {
              key: 'test',
              label: '测试连接',
              onClick: () => handleTestHarborConnection(record),
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
                  content: `确定要删除 Harbor 仓库 "${record.name}" 吗？`,
                  okType: 'danger',
                  onOk: () => handleDeleteRegistry(record),
                });
              },
            },
          ];
          return (
            <ResourceActionsDropdown
              items={filterMenuItemsForReadOnly(items, hasContainersWrite)}
              buttonProps={{ className: 'row-actions-trigger' }}
            />
          );
        }
        
        // 通用仓库操作
        const items = [
          {
            key: 'manage',
            label: '进入管理',
            onClick: () => {
              setSelectedGenericRegistry(record);
              setGenericDrawerVisible(true);
            },
          },
          {
            key: 'test',
            label: '测试连接',
            onClick: () => handleTestGenericConnection(record),
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
                onOk: () => handleDeleteRegistry(record),
              });
            },
          },
        ];
        return (
          <ResourceActionsDropdown
            items={filterMenuItemsForReadOnly(items, hasContainersWrite)}
            buttonProps={{ className: 'row-actions-trigger' }}
          />
        );
      },
    },
  ], [handleDeleteRegistry, handleTestHarborConnection, handleTestGenericConnection, handleOpenHarbor, modal, hasContainersWrite]);
  
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
            { label: `镜像仓库 (${allRegistries.length})`, value: 'registries' },
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
            hasContainersWrite={hasContainersWrite}
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
                <WriteGuard canWrite={hasContainersWrite}>
                  <Button type="primary" icon={<DatabaseOutlined />} onClick={() => { setEditingRegistry(null); setAddRegistryVisible(true); }}>
                    添加仓库
                  </Button>
                </WriteGuard>
                <TableColumnSettingsButton
                  allColumns={registryColumns}
                  settingsKey="harvester-containers-registries"
                />
                <Tooltip title="刷新">
                  <Button
                    type="default"
                    icon={<ReloadOutlined />}
                    loading={harborLoading}
                    onClick={() => {
                      setLocalRegistries(loadRegistries());
                      loadHarborRegistries();
                    }}
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
              dataSource={allRegistries.filter((r: RegistryConfig) => {
                if (!registryKeyword.trim()) return true;
                const kw = registryKeyword.toLowerCase();
                return r.name.toLowerCase().includes(kw) || r.server.toLowerCase().includes(kw);
              })}
              loading={harborLoading}
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
      
      {/* Harbor 详情抽屉 */}
      {selectedHarborId && (
        <HarborDetailDrawer
          visible={harborDrawerVisible}
          harborId={selectedHarborId}
          cloudId={cloudId}
          onClose={handleCloseAll}
          onOpenProject={handleOpenProject}
        />
      )}

      {/* 通用仓库管理抽屉 */}
      {selectedGenericRegistry && (
        <GenericRegistryDrawer
          visible={genericDrawerVisible}
          registry={selectedGenericRegistry}
          cloudId={cloudId}
          onClose={() => {
            setGenericDrawerVisible(false);
            setSelectedGenericRegistry(null);
          }}
          onRefresh={() => {
            setLocalRegistries(loadRegistries());
          }}
        />
      )}

      {/* 项目详情抽屉 */}
      {selectedProject && (
        <ProjectDetailDrawer
          visible={projectDrawerVisible}
          harborId={selectedHarborId!}
          projectName={selectedProject.name}
          cloudId={cloudId}
          onClose={handleCloseAll}
          onBack={handleBackToHarbor}
          onOpenRepository={handleOpenRepository}
        />
      )}

      {/* 仓库详情抽屉 */}
      {selectedRepo && (
        <RepositoryDetailDrawer
          visible={repoDrawerVisible}
          harborId={selectedHarborId!}
          projectName={selectedProject!.name}
          repository={selectedRepo}
          cloudId={cloudId}
          onClose={handleCloseAll}
          onBack={handleBackToProject}
        />
      )}
    </>  );
};

export default RegistriesSection;