/**
 * ==============================================================================
 * 模块名称: Harvester 配置管理视图 (ConfigsSection)
 * 文件路径: frontend/src/pages/cnmc/clouds/Harvester/containers/sections/ConfigsSection.tsx
 * ==============================================================================
 *
 * [功能描述]
 * 该组件负责展示和管理 Harvester/Kubernetes 配置资源，包括：
 * 1. ConfigMap 列表展示与管理（创建、编辑、删除）
 * 2. Secret 列表展示与管理（创建、编辑、删除）
 *
 * [核心逻辑]
 * 1. 配置类型切换: 通过 Tab 切换 ConfigMap 和 Secret
 * 2. 命名空间筛选: 支持按命名空间过滤
 * 3. Secret 类型过滤: 支持按 Secret 类型过滤
 * 4. 操作功能: 创建、详情查看、编辑、删除
 */

import React, { useState, useMemo, useCallback, useEffect } from 'react';
import {
  Table,
  Tabs,
  Segmented,
  Select,
  Button,
  Tag,
  Space,
  App,
  Drawer,
  Descriptions,
  Input,
  Typography,
  Modal,
  Switch,
  Spin,
  Tooltip,
  Form,
} from 'antd';
import {
  EyeInvisibleOutlined,
  KeyOutlined,
  FileTextOutlined,
  SearchOutlined,
  ReloadOutlined,
  EditTwoTone,
} from '@ant-design/icons';
import PageDetailSection from '../../../../../../components/PageDetailSection';
import ResourceActionsDropdown from '../../../../../../components/ResourceActionsDropdown';
import WriteGuard from '../../../../../../components/WriteGuard';
import { useTableColumnSettings } from '../../../../../../hooks/useTableColumnSettings';
import TableColumnSettingsButton from '../../../../../../components/TableColumnSettingsButton';
import { useAuth } from '../../../../../../contexts/AuthContext';
import { hasContainerSubWritePermission } from '../../../../../../utils/permissionUtils';
import { filterMenuItemsForReadOnly } from '../../../../../../utils/rbacUi';
import { ConfigMapForm, SecretForm } from '../components';
import CodeEditor, { detectLanguage } from '../../../../../../components/CodeEditor';
import {
  deleteHarvesterConfigMap,
  deleteHarvesterSecret,
  fetchHarvesterSecretDetail,
  patchHarvesterContainerResource,
} from '../../../../../../services/harvesterApi';
import {
  isSystemResource,
  getSystemResourceProtectionHint,
} from '../../../../../../utils/harvesterUtils';
import {
  createContainerToolbarRefresh,
  runContainerSectionRefresh,
  type ContainerSectionOnRefresh,
} from '../lib/containerSectionRefresh';
import {
  confirmHighRiskDelete,
  CONTAINER_DELETE_RISK_ITEMS,
} from '../../shared/lib/highRiskConfirm';
import { useHarvesterResourceLinkYamlDrawerSlot } from '../../shared/components/HarvesterResourceLinkYamlDrawerSlot';
import {
  isRegistryManagedPullSecret,
  REGISTRY_MANAGED_SECRET_HINT,
} from '../lib/registryManagedSecret';

const { Text } = Typography;

type Props = {
  configmaps: any[];
  secrets: any[];
  loading: boolean;
  namespacesOptions: string[];
  cloudId: string;
  nsValue?: string;
  onNsChange: (v?: string) => void;
  onRefresh: ContainerSectionOnRefresh;
  createDefaultNamespace?: string;
  deployments?: any[];
  statefulsets?: any[];
  daemonsets?: any[];
  showAllSwitch?: boolean;
  queryAll?: boolean;
  onQueryAllChange?: (checked: boolean) => void;
};

/**
 * Secret 类型映射
 */
const SECRET_TYPE_MAP: Record<string, { label: string; color: string }> = {
  Opaque: { label: 'Opaque', color: 'blue' },
  'kubernetes.io/service-account-token': { label: 'ServiceAccount Token', color: 'green' },
  'kubernetes.io/dockercfg': { label: 'Docker Config', color: 'orange' },
  'kubernetes.io/dockerconfigjson': { label: 'Docker Config JSON', color: 'orange' },
  'kubernetes.io/basic-auth': { label: 'Basic Auth', color: 'purple' },
  'kubernetes.io/ssh-auth': { label: 'SSH Auth', color: 'cyan' },
  'kubernetes.io/tls': { label: 'TLS', color: 'gold' },
  'bootstrap.kubernetes.io/token': { label: 'Bootstrap Token', color: 'lime' },
  'helm.sh/release.v1': { label: 'Helm Release', color: 'geekblue' },
  'provisioner.harvesterhci.io/image': { label: 'Harvester Image', color: 'magenta' },
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
 * Kubernetes 返回的是 UTC 时间（ISO 8601 格式），需要正确解析
 */
const calculateAge = (timestamp?: string) => {
  if (!timestamp) return '-';
  try {
    // Kubernetes 返回的是 UTC 时间，格式如 "2024-03-19T10:30:00Z"
    // new Date() 可以正确解析 ISO 8601 格式，包括时区
    const created = new Date(timestamp).getTime();
    const now = Date.now();
    const diff = now - created;

    // 如果时间是负数或很小，可能是刚刚创建，显示 "刚刚"
    if (diff < 0) return '刚刚';
    if (diff < 60000) return '刚刚'; // 小于1分钟

    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

    if (days > 0) return `${days}d${hours}h`;
    if (hours > 0) return `${hours}h${minutes}m`;
    return `${minutes}m`;
  } catch {
    return '-';
  }
};

/**
 * 渲染 Secret 类型标签
 */
const renderSecretType = (type: string) => {
  const typeInfo = SECRET_TYPE_MAP[type] || { label: type, color: 'default' };
  return <Tag color={typeInfo.color}>{typeInfo.label}</Tag>;
};

/**
 * ConfigMap 详情抽屉组件
 * 使用 Tabs 切换多条数据，支持语法高亮
 */
const ConfigMapDetailDrawer: React.FC<{
  configmap: any;
  visible: boolean;
  onClose: () => void;
}> = ({ configmap, visible, onClose }) => {
  const [activeDataKey, setActiveDataKey] = useState<string>('');

  // 注意：所有 hooks 必须在条件返回之前调用
  const metadata = configmap?.metadata || {};
  const data = useMemo(() => configmap?.data || {}, [configmap?.data]);
  const binaryData = useMemo(() => configmap?.binaryData || {}, [configmap?.binaryData]);
  const dataKeys = useMemo(() => Object.keys(data), [data]);
  const binaryDataKeys = useMemo(() => Object.keys(binaryData), [binaryData]);
  const allKeys = useMemo(() => [...dataKeys, ...binaryDataKeys], [dataKeys, binaryDataKeys]);

  // 当数据键变化时，重置活跃键
  useEffect(() => {
    if (allKeys.length > 0 && !activeDataKey) {
      setActiveDataKey(allKeys[0]);
    }
  }, [allKeys, activeDataKey]);

  // 生成 Tab 项
  const tabItems = useMemo(() => {
    return allKeys.map((key) => {
      const isBinary = binaryDataKeys.includes(key);
      const content = isBinary ? binaryData[key] : data[key];
      const language = detectLanguage(key);

      return {
        key,
        label: (
          <Space size={4}>
            {isBinary ? <KeyOutlined /> : <FileTextOutlined />}
            <span>{key}</span>
            {isBinary && (
              <Tag color="orange" style={{ marginLeft: 4, fontSize: 10 }}>
                二进制
              </Tag>
            )}
          </Space>
        ),
        children: (
          <div style={{ padding: '12px 0' }}>
            <div
              style={{
                marginBottom: 8,
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <Space>
                <Text type="secondary">语法: </Text>
                <Tag>{language.toUpperCase()}</Tag>
                {isBinary && <Text type="warning">（二进制数据已 Base64 编码）</Text>}
              </Space>
            </div>
            <CodeEditor
              value={typeof content === 'string' ? content : JSON.stringify(content, null, 2)}
              language={language}
              filename={key}
              readOnly
              minHeight={500}
              maxHeight="calc(100vh - 350px)"
            />
          </div>
        ),
      };
    });
  }, [data, binaryData, binaryDataKeys, allKeys]);

  return (
    <Drawer
      title={`ConfigMap 详情: ${metadata.name}`}
      placement="right"
      width={800}
      open={visible}
      onClose={() => {
        setActiveDataKey('');
        onClose();
      }}
    >
      <Descriptions column={2} bordered size="small">
        <Descriptions.Item label="名称">{metadata.name}</Descriptions.Item>
        <Descriptions.Item label="项目">{metadata.namespace}</Descriptions.Item>
        <Descriptions.Item label="运行时长">
          {calculateAge(metadata.creationTimestamp)}
        </Descriptions.Item>
        <Descriptions.Item label="数据条目">{allKeys.length}</Descriptions.Item>
        <Descriptions.Item label="创建时间" span={2}>
          {formatTime(metadata.creationTimestamp)}
        </Descriptions.Item>
        <Descriptions.Item label="标签" span={2}>
          <Space size={4} wrap>
            {Object.entries(metadata.labels || {}).map(([k, v]) => (
              <Tag key={k}>
                {k}={String(v)}
              </Tag>
            ))}
          </Space>
        </Descriptions.Item>
      </Descriptions>

      {/* 数据内容 - 使用 Tabs 切换 */}
      <div style={{ marginTop: 24 }}>
        <Text strong style={{ fontSize: 14, marginBottom: 12, display: 'block' }}>
          数据内容 ({allKeys.length} 条)
        </Text>
        {allKeys.length > 0 ? (
          <Tabs
            type="card"
            activeKey={activeDataKey}
            onChange={setActiveDataKey}
            items={tabItems}
            style={{ marginTop: 8 }}
          />
        ) : (
          <div
            style={{
              padding: 40,
              textAlign: 'center',
              color: '#999',
              background: '#fafafa',
              borderRadius: 8,
            }}
          >
            <FileTextOutlined style={{ fontSize: 48, marginBottom: 16, opacity: 0.3 }} />
            <div>暂无数据内容</div>
          </div>
        )}
      </div>
    </Drawer>
  );
};

// Secret 数据键名的友好标签映射
const SECRET_KEY_LABELS: Record<string, string> = {
  username: '用户名',
  password: '密码',
  'ssh-privatekey': 'SSH 私钥',
  'tls.crt': 'TLS 证书',
  'tls.key': 'TLS 私钥',
};

// 判断是否使用紧凑展示模式（数据条目 <= 3 时直接展示，不用 Tabs）
const SECRET_COMPACT_THRESHOLD = 3;

/**
 * Secret 详情抽屉组件（支持显示/隐藏值）
 * - 数据条目 <= 3 时：紧凑展示，一屏显示所有字段
 * - 数据条目 > 3 时：使用 Tabs 切换
 */
const SecretDetailDrawer: React.FC<{
  cloudId: string;
  secret: any;
  visible: boolean;
  onClose: () => void;
}> = ({ cloudId, secret, visible, onClose }) => {
  const [revealValues, setRevealValues] = useState(false);
  const [loadingReveal, setLoadingReveal] = useState(false);
  const [revealedData, setRevealedData] = useState<Record<string, string>>({});
  const [activeDataKey, setActiveDataKey] = useState<string>('');

  // 当 secret 变化时（如刷新后），重置 reveal 状态
  useEffect(() => {
    setRevealValues(false);
    setRevealedData({});
    setActiveDataKey('');
  }, [secret?.metadata?.uid, secret?.metadata?.resourceVersion]);

  // 注意：所有 hooks 必须在条件返回之前调用
  const metadata = secret?.metadata || {};
  const type = secret?.type || 'Opaque';
  const data = useMemo(() => secret?.data || {}, [secret?.data]);
  const dataKeys = useMemo(() => {
    const keys = Object.keys(data);
    // Basic Auth 类型：确保 username 在前，password 在后
    if (
      type === 'kubernetes.io/basic-auth' &&
      keys.includes('username') &&
      keys.includes('password')
    ) {
      return ['username', 'password'];
    }
    return keys;
  }, [data, type]);

  // 判断是否使用紧凑模式
  const useCompactMode = dataKeys.length > 0 && dataKeys.length <= SECRET_COMPACT_THRESHOLD;

  // 当数据键变化时，重置活跃键
  useEffect(() => {
    if (dataKeys.length > 0 && !activeDataKey) {
      setActiveDataKey(dataKeys[0]);
    }
  }, [dataKeys, activeDataKey]);

  // 显示/隐藏值
  const handleRevealChange = async (checked: boolean) => {
    if (checked) {
      setLoadingReveal(true);
      try {
        // 传递 reveal=true 和 force=true 参数，确保获取最新数据
        const result = await fetchHarvesterSecretDetail(
          cloudId,
          metadata.namespace,
          metadata.name,
          true,
          true,
        );
        const decodedData: Record<string, string> = {};

        // 后端在 reveal=true 时会返回 stringData（已解码的明文）
        if (result?.data?.stringData) {
          Object.assign(decodedData, result.data.stringData);
        }

        setRevealedData(decodedData);
        setRevealValues(true);
      } catch (error: any) {
        console.error('获取 Secret 明文失败:', error);
      } finally {
        setLoadingReveal(false);
      }
    } else {
      setRevealValues(false);
      setRevealedData({});
    }
  };

  // 渲染单个数据项
  const renderDataItem = (key: string) => {
    const language = detectLanguage(key);
    const content = revealValues ? revealedData[key] || '******' : '****** (已脱敏)';
    const label = SECRET_KEY_LABELS[key] || key;
    const isLongContent =
      type === 'kubernetes.io/ssh-auth' ||
      type === 'kubernetes.io/tls' ||
      key.includes('key') ||
      key.includes('crt');

    return (
      <div key={key} style={{ marginBottom: 16 }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 8,
          }}
        >
          <Space>
            <KeyOutlined style={{ color: '#1890ff' }} />
            <Text strong>{label}</Text>
            <Text type="secondary" style={{ fontSize: 12 }}>
              ({key})
            </Text>
          </Space>
          <Space>
            <Tag>{language.toUpperCase()}</Tag>
            {!revealValues && (
              <Text type="warning" style={{ fontSize: 12 }}>
                <EyeInvisibleOutlined /> 已脱敏
              </Text>
            )}
          </Space>
        </div>
        <div
          style={{
            border: revealValues ? '1px solid #ffd591' : '1px solid #d9d9d9',
            borderRadius: 4,
            overflow: 'hidden',
            background: revealValues ? '#fffbe6' : '#fafafa',
          }}
        >
          {isLongContent ? (
            // 长内容：SSH 私钥、TLS 证书等，使用 TextArea
            <Input.TextArea
              value={content}
              readOnly
              autoSize={{ minRows: 4, maxRows: 10 }}
              style={{
                fontFamily: 'monospace',
                background: 'transparent',
                border: 'none',
              }}
            />
          ) : revealValues ? (
            // 已开启显示明文：直接显示文本
            <Input
              value={content}
              readOnly
              style={{
                background: 'transparent',
                border: 'none',
              }}
            />
          ) : (
            // 未开启显示明文：使用密码框隐藏
            <Input.Password
              value={content}
              readOnly
              visibilityToggle={false}
              style={{
                background: 'transparent',
                border: 'none',
              }}
            />
          )}
        </div>
      </div>
    );
  };

  // 生成 Tab 项（仅用于数据条目 > 3 的情况）
  const tabItems = useMemo(() => {
    return dataKeys.map((key) => {
      const language = detectLanguage(key);
      const content = revealValues ? revealedData[key] || '******' : '****** (已脱敏)';

      return {
        key,
        label: (
          <Space size={4}>
            <KeyOutlined />
            <span>{key}</span>
          </Space>
        ),
        children: (
          <div style={{ padding: '12px 0' }}>
            <div
              style={{
                marginBottom: 8,
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <Space>
                <Text type="secondary">语法: </Text>
                <Tag>{language.toUpperCase()}</Tag>
              </Space>
              {!revealValues && (
                <Text type="warning" style={{ fontSize: 12 }}>
                  <EyeInvisibleOutlined /> 开启"显示值"查看明文内容
                </Text>
              )}
            </div>
            <div
              style={{
                border: revealValues ? '1px solid #ffd591' : '1px solid #d9d9d9',
                borderRadius: 4,
                overflow: 'hidden',
                background: revealValues ? '#fffbe6' : '#fff',
              }}
            >
              <CodeEditor
                value={content}
                language={revealValues ? language : 'text'}
                filename={key}
                readOnly
                minHeight={500}
                maxHeight="calc(100vh - 350px)"
              />
            </div>
          </div>
        ),
      };
    });
  }, [dataKeys, revealValues, revealedData]);

  return (
    <Drawer
      title={`Secret 详情: ${metadata.name}`}
      placement="right"
      width={800}
      open={visible}
      onClose={() => {
        setRevealValues(false);
        setRevealedData({});
        setActiveDataKey('');
        onClose();
      }}
    >
      <Descriptions column={2} bordered size="small">
        <Descriptions.Item label="名称">{metadata.name}</Descriptions.Item>
        <Descriptions.Item label="项目">{metadata.namespace}</Descriptions.Item>
        <Descriptions.Item label="类型">{renderSecretType(type)}</Descriptions.Item>
        <Descriptions.Item label="运行时长">
          {calculateAge(metadata.creationTimestamp)}
        </Descriptions.Item>
        <Descriptions.Item label="数据条目">{dataKeys.length}</Descriptions.Item>
        <Descriptions.Item label="创建时间">
          {formatTime(metadata.creationTimestamp)}
        </Descriptions.Item>
        <Descriptions.Item label="标签" span={2}>
          <Space size={4} wrap>
            {Object.entries(metadata.labels || {}).map(([k, v]) => (
              <Tag key={k}>
                {k}={String(v)}
              </Tag>
            ))}
          </Space>
        </Descriptions.Item>
      </Descriptions>

      {/* 数据内容 */}
      <div style={{ marginTop: 24 }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 12,
          }}
        >
          <Text strong style={{ fontSize: 14 }}>
            数据内容 ({dataKeys.length} 条)
          </Text>
          <Space>
            <Text type="secondary" style={{ fontSize: 12 }}>
              显示明文值
            </Text>
            <Switch
              checked={revealValues}
              onChange={handleRevealChange}
              loading={loadingReveal}
              size="small"
            />
            {loadingReveal && <Spin size="small" />}
          </Space>
        </div>

        {dataKeys.length > 0 ? (
          useCompactMode ? (
            // 紧凑模式：直接展示所有字段
            <div
              style={{
                padding: 16,
                background: '#fafafa',
                borderRadius: 8,
                border: '1px solid #f0f0f0',
              }}
            >
              {dataKeys.map((key) => renderDataItem(key))}
            </div>
          ) : (
            // 完整模式：使用 Tabs 切换
            <Tabs
              type="card"
              activeKey={activeDataKey}
              onChange={setActiveDataKey}
              items={tabItems}
              style={{ marginTop: 8 }}
            />
          )
        ) : (
          <div
            style={{
              padding: 40,
              textAlign: 'center',
              color: '#999',
              background: '#fafafa',
              borderRadius: 8,
            }}
          >
            <KeyOutlined style={{ fontSize: 48, marginBottom: 16, opacity: 0.3 }} />
            <div>暂无数据内容</div>
          </div>
        )}
      </div>
    </Drawer>
  );
};

/**
 * ConfigMap 表格组件
 */
const ConfigMapTable: React.FC<{
  data: any[];
  loading: boolean;
  cloudId: string;
  namespacesOptions: string[];
  nsValue?: string;
  onNsChange: (v?: string) => void;
  onCreateClick: () => void;
  hasContainersWrite: boolean;
  onRefresh: (force?: boolean) => void;
  onEditClick: (record: any) => void;
  checkResourceInUse: (
    resourceType: 'configmap' | 'secret',
    resourceName: string,
    namespace: string,
  ) => { inUse: boolean; usedBy: string[] };
  showAllSwitch?: boolean;
  queryAll?: boolean;
  onQueryAllChange?: (checked: boolean) => void;
  onViewYaml: (record: any, title: string) => void;
}> = ({
  data,
  loading,
  cloudId,
  namespacesOptions,
  nsValue,
  onNsChange,
  onCreateClick,
  hasContainersWrite,
  onRefresh,
  onEditClick,
  checkResourceInUse,
  showAllSwitch,
  queryAll,
  onQueryAllChange,
  onViewYaml,
}) => {
  const { message } = App.useApp();
  const [keyword, setKeyword] = useState('');
  const [selectedKeys, setSelectedKeys] = useState<React.Key[]>([]);
  const [detailVisible, setDetailVisible] = useState(false);
  const [currentConfigMap, setCurrentConfigMap] = useState<any>(null);
  const [aliasModalVisible, setAliasModalVisible] = useState(false);
  const [aliasRecord, setAliasRecord] = useState<any>(null);
  const [aliasSubmitting, setAliasSubmitting] = useState(false);
  const [aliasForm] = Form.useForm<{ alias?: string }>();

  const apiPath = '/api/v1/configmaps';

  // 过滤数据
  const filteredData = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    return data.filter((item: any) => {
      const name = item?.metadata?.name || '';
      const ns = item?.metadata?.namespace || '';
      const alias = item?.metadata?.annotations?.['tower.io/alias'] || '';
      if (
        kw &&
        !name.toLowerCase().includes(kw) &&
        !ns.toLowerCase().includes(kw) &&
        !alias.toLowerCase().includes(kw)
      ) {
        return false;
      }
      return true;
    });
  }, [data, keyword]);

  // 查看详情
  const handleViewDetail = useCallback((configmap: any) => {
    setCurrentConfigMap(configmap);
    setDetailVisible(true);
  }, []);

  // 删除操作
  const handleDelete = useCallback(
    async (configmap: any) => {
      const namespace = configmap?.metadata?.namespace;
      const name = configmap?.metadata?.name;

      try {
        await deleteHarvesterConfigMap(cloudId, namespace, name);
        message.success('删除成功');
        runContainerSectionRefresh(onRefresh, { force: true });
      } catch (error: any) {
        message.error(`删除失败: ${error?.message || '未知错误'}`);
      }
    },
    [cloudId, message, onRefresh],
  );

  // 修改别名
  const handleSubmitAlias = useCallback(
    async (nextAliasRaw?: string) => {
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
          patchBody.push({
            op: 'add',
            path: '/metadata/annotations',
            value: { 'tower.io/alias': next },
          });
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
        await patchHarvesterContainerResource(cloudId, apiPath, ns, name, patchBody);
        message.success(next ? '名称修改成功' : '已清空别名');
        setAliasModalVisible(false);
        setAliasRecord(null);
        aliasForm.resetFields();
        runContainerSectionRefresh(onRefresh, { force: true });
        return true;
      } catch (e: any) {
        console.error(e);
        message.error(e?.message || '名称修改失败');
        return false;
      } finally {
        setAliasSubmitting(false);
      }
    },
    [aliasRecord, apiPath, cloudId, message, onRefresh, aliasForm],
  );

  // 查看 YAML
  const handleViewYaml = useCallback(
    (record: any) => {
      onViewYaml(record, 'ConfigMap YAML');
    },
    [onViewYaml],
  );

  // 打开别名修改弹窗
  const handleOpenAliasModal = useCallback(
    (record: any) => {
      setAliasRecord(record);
      aliasForm.setFieldsValue({ alias: record?.metadata?.annotations?.['tower.io/alias'] || '' });
      setAliasModalVisible(true);
    },
    [aliasForm],
  );

  // 表格列定义
  const columns = useMemo(
    () => [
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
              <a onClick={() => handleViewDetail(record)} style={{ color: '#1890ff' }}>
                {hasAlias ? alias : id}
              </a>
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
        ellipsis: true,
        render: (ns: string) => <Tag>{ns}</Tag>,
      },
      {
        title: '数据条目',
        key: 'dataCount',
        render: (_: any, record: any) => {
          const dataKeys = Object.keys(record?.data || {});
          const binaryKeys = Object.keys(record?.binaryData || {});
          return dataKeys.length + binaryKeys.length;
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
        render: (_: any, record: any) => {
          const isSystem = isSystemResource(record, 'configmap');
          const systemHint = getSystemResourceProtectionHint(record, 'configmap');
          const { inUse, usedBy } = checkResourceInUse(
            'configmap',
            record?.metadata?.name,
            record?.metadata?.namespace,
          );
          const deleteDisabled = isSystem || inUse;
          const deleteTooltip = isSystem
            ? systemHint
            : inUse
              ? `被工作负载使用: ${usedBy.slice(0, 3).join(', ')}${usedBy.length > 3 ? '...' : ''}`
              : undefined;
          const items = [
            {
              key: 'edit',
              label: '编辑',
              disabled: isSystem,
              tooltip: systemHint,
              onClick: () => onEditClick(record),
            },
            {
              key: 'yaml',
              label: '查看 YAML',
              onClick: () => handleViewYaml(record),
            },
            {
              key: 'detail',
              label: '详情',
              onClick: () => handleViewDetail(record),
            },
            {
              key: 'delete',
              label: '删除',
              danger: true,
              disabled: deleteDisabled,
              tooltip: deleteTooltip,
              onClick: () => {
                const alias = record?.metadata?.annotations?.['tower.io/alias'];
                const id = record?.metadata?.name || '';
                const displayName = alias ? `${alias} (${id})` : id;
                void confirmHighRiskDelete({
                  resourceLabel: 'ConfigMap',
                  name: displayName,
                  riskItems: CONTAINER_DELETE_RISK_ITEMS,
                  onConfirm: () => handleDelete(record),
                }).catch(() => {});
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
    ],
    [
      handleViewDetail,
      handleDelete,
      handleViewYaml,
      onEditClick,
      checkResourceInUse,
      hasContainersWrite,
      handleOpenAliasModal,
    ],
  );

  // 使用列设置 Hook
  const { displayColumns: tableColumns } = useTableColumnSettings(
    columns,
    'harvester-containers-configmaps',
  );

  return (
    <div>
      <div className="page-toolbar">
        <div className="toolbar-container">
          <Input
            className="toolbar-search"
            allowClear
            placeholder="名称/项目"
            suffix={<SearchOutlined style={{ color: 'rgba(0,0,0,.45)' }} />}
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
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
              setKeyword('');
              onNsChange(undefined);
            }}
          >
            重置
          </button>
        </div>
        <div className="toolbar-actions">
          {showAllSwitch && (
            <Switch
              checkedChildren="全部"
              unCheckedChildren="默认"
              checked={queryAll}
              onChange={onQueryAllChange}
              style={{ marginRight: 8 }}
            />
          )}
          <WriteGuard canWrite={hasContainersWrite}>
            <Button type="primary" onClick={onCreateClick}>
              创建 ConfigMap
            </Button>
          </WriteGuard>
          <TableColumnSettingsButton
            allColumns={columns}
            settingsKey="harvester-containers-configmaps"
          />
          <Tooltip title="刷新">
            <Button
              type="default"
              icon={<ReloadOutlined />}
              onClick={createContainerToolbarRefresh(onRefresh)}
            />
          </Tooltip>
        </div>
      </div>

      <Table
        className="std-table"
        scroll={{ x: true }}
        bordered={false}
        rowKey={(record) => `${record?.metadata?.namespace}/${record?.metadata?.name}`}
        columns={tableColumns}
        dataSource={filteredData}
        loading={loading}
        pagination={{
          showTotal: (total) => `共 ${total} 条`,
        }}
        rowSelection={
          hasContainersWrite
            ? {
                selectedRowKeys: selectedKeys,
                onChange: setSelectedKeys,
              }
            : undefined
        }
      />

      {/* ConfigMap 详情抽屉 */}
      <ConfigMapDetailDrawer
        configmap={currentConfigMap}
        visible={detailVisible}
        onClose={() => {
          setDetailVisible(false);
          setCurrentConfigMap(null);
        }}
      />

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
    </div>
  );
};

/**
 * Secret 表格组件
 */
const SecretTable: React.FC<{
  data: any[];
  loading: boolean;
  cloudId: string;
  namespacesOptions: string[];
  nsValue?: string;
  onNsChange: (v?: string) => void;
  typeFilter?: string;
  onTypeChange: (type?: string) => void;
  onCreateClick: () => void;
  hasContainersWrite: boolean;
  onRefresh: (force?: boolean) => void;
  onEditClick: (record: any) => void;
  checkResourceInUse: (
    resourceType: 'configmap' | 'secret',
    resourceName: string,
    namespace: string,
  ) => { inUse: boolean; usedBy: string[] };
  showAllSwitch?: boolean;
  queryAll?: boolean;
  onQueryAllChange?: (checked: boolean) => void;
  onViewYaml: (record: any, title: string) => void;
}> = ({
  data,
  loading,
  cloudId,
  namespacesOptions,
  nsValue,
  onNsChange,
  typeFilter,
  onTypeChange,
  onCreateClick,
  hasContainersWrite,
  onRefresh,
  onEditClick,
  checkResourceInUse,
  showAllSwitch,
  queryAll,
  onQueryAllChange,
  onViewYaml,
}) => {
  const { message } = App.useApp();
  const [keyword, setKeyword] = useState('');
  const [selectedKeys, setSelectedKeys] = useState<React.Key[]>([]);
  const [detailVisible, setDetailVisible] = useState(false);
  const [currentSecret, setCurrentSecret] = useState<any>(null);
  const [aliasModalVisible, setAliasModalVisible] = useState(false);
  const [aliasRecord, setAliasRecord] = useState<any>(null);
  const [aliasSubmitting, setAliasSubmitting] = useState(false);
  const [aliasForm] = Form.useForm<{ alias?: string }>();

  const apiPath = '/api/v1/secrets';

  // 当列表数据刷新时，同步更新当前查看的 Secret
  useEffect(() => {
    if (currentSecret && detailVisible) {
      const namespace = currentSecret?.metadata?.namespace;
      const name = currentSecret?.metadata?.name;
      if (namespace && name) {
        const updated = data.find(
          (item: any) => item?.metadata?.namespace === namespace && item?.metadata?.name === name,
        );
        if (updated) {
          setCurrentSecret(updated);
        }
      }
    }
  }, [data, currentSecret, detailVisible]);

  // Secret 类型选项
  const secretTypeOptions = useMemo(() => {
    const types = new Set(data.map((item: any) => item?.type).filter(Boolean));
    return Array.from(types).map((type) => ({
      label: SECRET_TYPE_MAP[type as string]?.label || type,
      value: type as string,
    }));
  }, [data]);

  // 过滤数据
  const filteredData = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    return data.filter((item: any) => {
      const name = item?.metadata?.name || '';
      const ns = item?.metadata?.namespace || '';
      const alias = item?.metadata?.annotations?.['tower.io/alias'] || '';
      if (
        kw &&
        !name.toLowerCase().includes(kw) &&
        !ns.toLowerCase().includes(kw) &&
        !alias.toLowerCase().includes(kw)
      ) {
        return false;
      }
      return true;
    });
  }, [data, keyword]);

  // 查看详情
  const handleViewDetail = useCallback((secret: any) => {
    setCurrentSecret(secret);
    setDetailVisible(true);
  }, []);

  // 删除操作
  const handleDelete = useCallback(
    async (secret: any) => {
      if (isRegistryManagedPullSecret(secret)) {
        message.warning(REGISTRY_MANAGED_SECRET_HINT);
        return;
      }
      const namespace = secret?.metadata?.namespace;
      const name = secret?.metadata?.name;

      try {
        await deleteHarvesterSecret(cloudId, namespace, name);
        message.success('删除成功');
        runContainerSectionRefresh(onRefresh, { force: true });
      } catch (e: any) {
        message.error(e?.message || '删除失败');
      }
    },
    [cloudId, message, onRefresh],
  );

  const handleSubmitAlias = useCallback(
    async (nextAliasRaw?: string) => {
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
          patchBody.push({
            op: 'add',
            path: '/metadata/annotations',
            value: { 'tower.io/alias': next },
          });
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
        await patchHarvesterContainerResource(cloudId, apiPath, ns, name, patchBody);
        message.success(next ? '名称修改成功' : '已清空别名');
        setAliasModalVisible(false);
        setAliasRecord(null);
        aliasForm.resetFields();
        runContainerSectionRefresh(onRefresh, { force: true });
        return true;
      } catch (e: any) {
        console.error(e);
        message.error(e?.message || '名称修改失败');
        return false;
      } finally {
        setAliasSubmitting(false);
      }
    },
    [aliasRecord, apiPath, cloudId, message, onRefresh, aliasForm],
  );

  // 查看 YAML
  const handleViewYaml = useCallback(
    (record: any) => {
      onViewYaml(record, 'Secret YAML');
    },
    [onViewYaml],
  );

  // 打开别名修改弹窗
  const handleOpenAliasModal = useCallback(
    (record: any) => {
      setAliasRecord(record);
      aliasForm.setFieldsValue({ alias: record?.metadata?.annotations?.['tower.io/alias'] || '' });
      setAliasModalVisible(true);
    },
    [aliasForm],
  );

  // 表格列定义
  const columns = useMemo(
    () => [
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
              <a onClick={() => handleViewDetail(record)} style={{ color: '#1890ff' }}>
                {hasAlias ? alias : id}
              </a>
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
        ellipsis: true,
        render: (ns: string) => <Tag>{ns}</Tag>,
      },
      {
        title: '类型',
        dataIndex: 'type',
        key: 'type',
        ellipsis: true,
        render: (type: string, record: any) => (
          <Space size={4}>
            {renderSecretType(type)}
            {isRegistryManagedPullSecret(record) && (
              <Tag color="processing">仓库认证托管</Tag>
            )}
          </Space>
        ),
      },
      {
        title: '数据条目',
        key: 'dataCount',
        render: (_: any, record: any) => Object.keys(record?.data || {}).length,
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
        render: (_: any, record: any) => {
          const isSystem = isSystemResource(record, 'secret');
          const systemHint = getSystemResourceProtectionHint(record, 'secret');
          const isRegistryManaged = isRegistryManagedPullSecret(record);
          const { inUse, usedBy } = checkResourceInUse(
            'secret',
            record?.metadata?.name,
            record?.metadata?.namespace,
          );
          const deleteDisabled = isSystem || inUse || isRegistryManaged;
          const deleteTooltip = isRegistryManaged
            ? REGISTRY_MANAGED_SECRET_HINT
            : isSystem
              ? systemHint
              : inUse
                ? `被工作负载使用: ${usedBy.slice(0, 3).join(', ')}${usedBy.length > 3 ? '...' : ''}`
                : undefined;
          const items = [
            {
              key: 'edit',
              label: '编辑',
              disabled: isSystem || isRegistryManaged,
              tooltip: isRegistryManaged ? REGISTRY_MANAGED_SECRET_HINT : systemHint,
              onClick: () => onEditClick(record),
            },
            {
              key: 'yaml',
              label: '查看 YAML',
              onClick: () => handleViewYaml(record),
            },
            {
              key: 'detail',
              label: '详情',
              onClick: () => handleViewDetail(record),
            },
            {
              key: 'delete',
              label: '删除',
              danger: true,
              disabled: deleteDisabled,
              tooltip: deleteTooltip,
              onClick: () => {
                const alias = record?.metadata?.annotations?.['tower.io/alias'];
                const id = record?.metadata?.name || '';
                const displayName = alias ? `${alias} (${id})` : id;
                void confirmHighRiskDelete({
                  resourceLabel: 'Secret',
                  name: displayName,
                  riskItems: CONTAINER_DELETE_RISK_ITEMS,
                  onConfirm: () => handleDelete(record),
                }).catch(() => {});
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
    ],
    [
      handleViewDetail,
      handleDelete,
      handleViewYaml,
      onEditClick,
      checkResourceInUse,
      hasContainersWrite,
      handleOpenAliasModal,
    ],
  );

  // 使用列设置 Hook
  const { displayColumns: tableColumns } = useTableColumnSettings(
    columns,
    'harvester-containers-secrets',
  );

  return (
    <div>
      <div className="page-toolbar">
        <div className="toolbar-container">
          <Input
            className="toolbar-search"
            allowClear
            placeholder="名称/项目"
            suffix={<SearchOutlined style={{ color: 'rgba(0,0,0,.45)' }} />}
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
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
          <Select
            className="toolbar-filter"
            placeholder="筛选类型"
            allowClear
            showSearch
            optionFilterProp="label"
            value={typeFilter ?? undefined}
            onChange={onTypeChange}
            options={secretTypeOptions}
          />
          <button
            type="button"
            className="toolbar-reset-btn"
            onClick={() => {
              setKeyword('');
              onNsChange(undefined);
              onTypeChange(undefined);
            }}
          >
            重置
          </button>
        </div>
        <div className="toolbar-actions">
          {showAllSwitch && (
            <Switch
              checkedChildren="全部"
              unCheckedChildren="默认"
              checked={queryAll}
              onChange={onQueryAllChange}
              style={{ marginRight: 8 }}
            />
          )}
          <WriteGuard canWrite={hasContainersWrite}>
            <Button type="primary" onClick={onCreateClick}>
              创建 Secret
            </Button>
          </WriteGuard>
          <TableColumnSettingsButton
            allColumns={columns}
            settingsKey="harvester-containers-secrets"
          />
          <Tooltip title="刷新">
            <Button
              type="default"
              icon={<ReloadOutlined />}
              onClick={createContainerToolbarRefresh(onRefresh)}
            />
          </Tooltip>
        </div>
      </div>

      <Table
        className="std-table"
        scroll={{ x: true }}
        bordered={false}
        rowKey={(record) => `${record?.metadata?.namespace}/${record?.metadata?.name}`}
        columns={tableColumns}
        dataSource={filteredData}
        loading={loading}
        pagination={{
          showTotal: (total) => `共 ${total} 条`,
        }}
        rowSelection={
          hasContainersWrite
            ? {
                selectedRowKeys: selectedKeys,
                onChange: setSelectedKeys,
              }
            : undefined
        }
      />

      {/* Secret 详情抽屉 */}
      <SecretDetailDrawer
        cloudId={cloudId}
        secret={currentSecret}
        visible={detailVisible}
        onClose={() => {
          setDetailVisible(false);
          setCurrentSecret(null);
        }}
      />

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
    </div>
  );
};

/**
 * Configs Section 主组件
 */
const ConfigsSection: React.FC<Props> = ({
  configmaps,
  secrets,
  loading,
  namespacesOptions,
  cloudId,
  nsValue,
  onNsChange,
  onRefresh,
  createDefaultNamespace,
  deployments = [],
  statefulsets = [],
  daemonsets = [],
  showAllSwitch,
  queryAll,
  onQueryAllChange,
}) => {
  const { user } = useAuth();
  const { message } = App.useApp();
  const formDefaultNs = createDefaultNamespace ?? nsValue ?? 'default';
  const hasContainersWrite = useMemo(
    () => hasContainerSubWritePermission((user?.permissions ?? []) as string[], 'configs'),
    [user?.permissions],
  );
  const [activeTab, setActiveTab] = useState<'configmap' | 'secret'>('configmap');
  const [secretTypeFilter, setSecretTypeFilter] = useState<string | undefined>();

  const { openYamlDrawer, yamlDrawer } = useHarvesterResourceLinkYamlDrawerSlot(cloudId);
  const handleViewResourceYaml = useCallback(
    (record: any, title: string) => {
      const kind = title.startsWith('Secret') ? 'Secret' : 'ConfigMap';
      openYamlDrawer({ ...record, kind: record?.kind ?? kind }, { title });
    },
    [openYamlDrawer],
  );

  // ConfigMap 弹窗状态
  const [configMapModalVisible, setConfigMapModalVisible] = useState(false);
  const [configMapEditMode, setConfigMapEditMode] = useState(false);
  const [currentConfigMap, setCurrentConfigMap] = useState<any>(null);

  // Secret 弹窗状态
  const [secretModalVisible, setSecretModalVisible] = useState(false);
  const [secretEditMode, setSecretEditMode] = useState(false);
  const [currentSecret, setCurrentSecret] = useState<any>(null);

  // 当列表数据刷新时，同步更新当前编辑的 ConfigMap
  useEffect(() => {
    if (currentConfigMap && configMapEditMode && configmaps) {
      const namespace = currentConfigMap?.metadata?.namespace;
      const name = currentConfigMap?.metadata?.name;
      if (namespace && name) {
        const updated = configmaps.find(
          (item: any) => item?.metadata?.namespace === namespace && item?.metadata?.name === name,
        );
        if (updated) {
          setCurrentConfigMap(updated);
        }
      }
    }
  }, [configmaps, currentConfigMap, configMapEditMode]);

  // 当列表数据刷新时，同步更新当前编辑的 Secret
  useEffect(() => {
    if (currentSecret && secretEditMode && secrets) {
      const namespace = currentSecret?.metadata?.namespace;
      const name = currentSecret?.metadata?.name;
      if (namespace && name) {
        const updated = secrets.find(
          (item: any) => item?.metadata?.namespace === namespace && item?.metadata?.name === name,
        );
        if (updated) {
          setCurrentSecret(updated);
        }
      }
    }
  }, [secrets, currentSecret, secretEditMode]);

  const allWorkloads = useMemo(
    () => [...deployments, ...statefulsets, ...daemonsets],
    [deployments, statefulsets, daemonsets],
  );

  const checkResourceInUse = useCallback(
    (
      resourceType: 'configmap' | 'secret',
      resourceName: string,
      namespace: string,
    ): { inUse: boolean; usedBy: string[] } => {
      const usedBy: string[] = [];

      allWorkloads.forEach((workload: any) => {
        const workloadNs = workload?.metadata?.namespace;
        const workloadName = workload?.metadata?.name;
        const template = workload?.spec?.template || {};
        const volumes = template?.spec?.volumes || [];
        const containers = template?.spec?.containers || [];
        const initContainers = template?.spec?.initContainers || [];

        if (workloadNs !== namespace) return;

        if (resourceType === 'configmap') {
          const usedInVolumes = volumes.some((v: any) => v.configMap?.name === resourceName);
          const usedInEnv = [...containers, ...initContainers].some(
            (c: any) =>
              (c.env || []).some((e: any) => e.valueFrom?.configMapKeyRef?.name === resourceName) ||
              (c.envFrom || []).some((ef: any) => ef.configMapRef?.name === resourceName),
          );
          const workloadAlias = workload?.metadata?.annotations?.['tower.io/alias'];
          const workloadDisplayName = workloadAlias
            ? `${workloadAlias} (${workloadName})`
            : workloadName;
          if (usedInVolumes || usedInEnv) {
            usedBy.push(`${workloadDisplayName} (${workload.kind || 'Deployment'})`);
          }
        } else {
          const usedInVolumes = volumes.some((v: any) => v.secret?.secretName === resourceName);
          const usedInEnv = [...containers, ...initContainers].some(
            (c: any) =>
              (c.env || []).some((e: any) => e.valueFrom?.secretKeyRef?.name === resourceName) ||
              (c.envFrom || []).some((ef: any) => ef.secretRef?.name === resourceName),
          );
          const usedInImagePullSecrets = (template?.spec?.imagePullSecrets || []).some(
            (s: any) => s.name === resourceName,
          );
          const workloadAlias = workload?.metadata?.annotations?.['tower.io/alias'];
          const workloadDisplayName = workloadAlias
            ? `${workloadAlias} (${workloadName})`
            : workloadName;
          if (usedInVolumes || usedInEnv || usedInImagePullSecrets) {
            usedBy.push(`${workloadDisplayName} (${workload.kind || 'Deployment'})`);
          }
        }
      });

      return { inUse: usedBy.length > 0, usedBy };
    },
    [allWorkloads],
  );

  // ConfigMap 操作
  const handleCreateConfigMap = () => {
    setConfigMapEditMode(false);
    setCurrentConfigMap(null);
    setConfigMapModalVisible(true);
  };

  const handleEditConfigMap = (record: any) => {
    setConfigMapEditMode(true);
    setCurrentConfigMap(record);
    setConfigMapModalVisible(true);
  };

  const handleConfigMapModalClose = () => {
    setConfigMapModalVisible(false);
    setConfigMapEditMode(false);
    setCurrentConfigMap(null);
  };

  const handleConfigMapSuccess = () => {
    handleConfigMapModalClose();
    runContainerSectionRefresh(onRefresh, { force: true });
  };

  // Secret 操作
  const handleCreateSecret = () => {
    setSecretEditMode(false);
    setCurrentSecret(null);
    setSecretModalVisible(true);
  };

  const handleEditSecret = (record: any) => {
    if (isRegistryManagedPullSecret(record)) {
      message.warning(REGISTRY_MANAGED_SECRET_HINT);
      return;
    }
    setSecretEditMode(true);
    setCurrentSecret(record);
    setSecretModalVisible(true);
  };

  const handleSecretModalClose = () => {
    setSecretModalVisible(false);
    setSecretEditMode(false);
    setCurrentSecret(null);
  };

  const handleSecretSuccess = () => {
    handleSecretModalClose();
    runContainerSectionRefresh(onRefresh, { force: true });
  };

  // 根据 nsValue 过滤数据
  const filteredConfigMaps = useMemo(() => {
    let result = nsValue
      ? configmaps.filter((item: any) => item?.metadata?.namespace === nsValue)
      : configmaps;
    result = [...result].sort((a: any, b: any) => {
      const ta = a?.metadata?.creationTimestamp
        ? new Date(a.metadata.creationTimestamp).getTime()
        : 0;
      const tb = b?.metadata?.creationTimestamp
        ? new Date(b.metadata.creationTimestamp).getTime()
        : 0;
      return tb - ta;
    });
    return result;
  }, [configmaps, nsValue]);

  const filteredSecrets = useMemo(() => {
    let result = secrets;
    if (nsValue) {
      result = result.filter((item: any) => item?.metadata?.namespace === nsValue);
    }
    if (secretTypeFilter) {
      result = result.filter((item: any) => item?.type === secretTypeFilter);
    }
    result = [...result].sort((a: any, b: any) => {
      const ta = a?.metadata?.creationTimestamp
        ? new Date(a.metadata.creationTimestamp).getTime()
        : 0;
      const tb = b?.metadata?.creationTimestamp
        ? new Date(b.metadata.creationTimestamp).getTime()
        : 0;
      return tb - ta;
    });
    return result;
  }, [secrets, nsValue, secretTypeFilter]);

  return (
    <>
      <PageDetailSection asCard={false}>
        <Segmented
          style={{ marginBottom: 12 }}
          value={activeTab}
          onChange={(v) => setActiveTab(v as 'configmap' | 'secret')}
          options={[
            { label: `ConfigMap (${filteredConfigMaps.length})`, value: 'configmap' },
            { label: `Secret (${filteredSecrets.length})`, value: 'secret' },
          ]}
        />
        {activeTab === 'configmap' ? (
          <ConfigMapTable
            key="configmap"
            data={filteredConfigMaps}
            loading={loading}
            cloudId={cloudId}
            namespacesOptions={namespacesOptions}
            nsValue={nsValue}
            onNsChange={onNsChange}
            onCreateClick={handleCreateConfigMap}
            hasContainersWrite={hasContainersWrite}
            onRefresh={onRefresh}
            onEditClick={handleEditConfigMap}
            checkResourceInUse={checkResourceInUse}
            showAllSwitch={showAllSwitch}
            queryAll={queryAll}
            onQueryAllChange={onQueryAllChange}
            onViewYaml={handleViewResourceYaml}
          />
        ) : (
          <SecretTable
            key="secret"
            data={filteredSecrets}
            loading={loading}
            cloudId={cloudId}
            namespacesOptions={namespacesOptions}
            nsValue={nsValue}
            onNsChange={onNsChange}
            typeFilter={secretTypeFilter}
            onTypeChange={setSecretTypeFilter}
            onCreateClick={handleCreateSecret}
            hasContainersWrite={hasContainersWrite}
            onRefresh={onRefresh}
            onEditClick={handleEditSecret}
            checkResourceInUse={checkResourceInUse}
            showAllSwitch={showAllSwitch}
            queryAll={queryAll}
            onQueryAllChange={onQueryAllChange}
            onViewYaml={handleViewResourceYaml}
          />
        )}
      </PageDetailSection>

      {/* ConfigMap 创建/编辑弹窗 */}
      <Modal
        title={configMapEditMode ? '编辑 ConfigMap' : '创建 ConfigMap'}
        open={configMapModalVisible}
        onCancel={handleConfigMapModalClose}
        footer={null}
        width={700}
        destroyOnClose
      >
        <ConfigMapForm
          cloudId={cloudId}
          namespacesOptions={namespacesOptions}
          defaultNamespace={formDefaultNs}
          editMode={configMapEditMode}
          initialData={currentConfigMap}
          onSuccess={handleConfigMapSuccess}
          onCancel={handleConfigMapModalClose}
        />
      </Modal>

      {/* Secret 创建/编辑弹窗 */}
      <Modal
        title={secretEditMode ? '编辑 Secret' : '创建 Secret'}
        open={secretModalVisible}
        onCancel={handleSecretModalClose}
        footer={null}
        width={700}
        destroyOnClose
      >
        <SecretForm
          cloudId={cloudId}
          namespacesOptions={namespacesOptions}
          defaultNamespace={formDefaultNs}
          editMode={secretEditMode}
          initialData={currentSecret}
          onSuccess={handleSecretSuccess}
          onCancel={handleSecretModalClose}
        />
      </Modal>

      {yamlDrawer}
    </>
  );
};

export default ConfigsSection;
