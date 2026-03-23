/**
 * ==============================================================================
 * 模块名称: Harvester 配置管理视图 (ConfigsSection)
 * 文件路径: src/pages/Clouds/Harvester/containers/ConfigsSection.tsx
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
import { Table, Tabs, Select, Button, Tag, Space, App, Drawer, Descriptions, Input, Typography, Modal, Switch, Spin } from 'antd';
import { DeleteOutlined, EyeOutlined, EyeInvisibleOutlined, KeyOutlined, FileTextOutlined, PlusOutlined, EditOutlined } from '@ant-design/icons';
import PageDetailSection from '../../../../components/PageDetailSection';
import ResourceActionsDropdown from '../../../../components/ResourceActionsDropdown';
import { useTableColumnSettings } from '../../../../hooks/useTableColumnSettings';
import TableColumnSettingsButton from '../../../../components/TableColumnSettingsButton';
import { ConfigMapForm, SecretForm } from './components';
import CodeEditor, { detectLanguage } from '../../../../components/CodeEditor';
import {
  deleteHarvesterConfigMap,
  deleteHarvesterSecret,
  fetchHarvesterSecretDetail,
} from '../../../../services/harvesterApi';

const { Text } = Typography;

type Props = {
  configmaps: any[];
  secrets: any[];
  loading: boolean;
  namespacesOptions: string[];
  cloudId: string;
  nsValue?: string;
  onNsChange: (v?: string) => void;
  onRefresh: (force?: boolean) => void;
};

/**
 * Secret 类型映射
 */
const SECRET_TYPE_MAP: Record<string, { label: string; color: string }> = {
  'Opaque': { label: 'Opaque', color: 'blue' },
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
  const data = configmap?.data || {};
  const binaryData = configmap?.binaryData || {};
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
            {isBinary && <Tag color="orange" style={{ marginLeft: 4, fontSize: 10 }}>二进制</Tag>}
          </Space>
        ),
        children: (
          <div style={{ padding: '12px 0' }}>
            <div style={{ marginBottom: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
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
  }, [data, binaryData, dataKeys, binaryDataKeys]);
  
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
        <Descriptions.Item label="命名空间">{metadata.namespace}</Descriptions.Item>
        <Descriptions.Item label="运行时长">{calculateAge(metadata.creationTimestamp)}</Descriptions.Item>
        <Descriptions.Item label="数据条目">{allKeys.length}</Descriptions.Item>
        <Descriptions.Item label="创建时间" span={2}>{formatTime(metadata.creationTimestamp)}</Descriptions.Item>
        <Descriptions.Item label="标签" span={2}>
          <Space size={4} wrap>
            {Object.entries(metadata.labels || {}).map(([k, v]) => (
              <Tag key={k}>{k}={String(v)}</Tag>
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
          <div style={{ padding: 40, textAlign: 'center', color: '#999', background: '#fafafa', borderRadius: 8 }}>
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
  'username': '用户名',
  'password': '密码',
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
  const data = secret?.data || {};
  const dataKeys = useMemo(() => {
    const keys = Object.keys(data);
    // Basic Auth 类型：确保 username 在前，password 在后
    if (type === 'kubernetes.io/basic-auth' && keys.includes('username') && keys.includes('password')) {
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
        const result = await fetchHarvesterSecretDetail(cloudId, metadata.namespace, metadata.name, true, true);
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
    const content = revealValues ? (revealedData[key] || '******') : '****** (已脱敏)';
    const label = SECRET_KEY_LABELS[key] || key;
    const isLongContent = type === 'kubernetes.io/ssh-auth' || type === 'kubernetes.io/tls' || key.includes('key') || key.includes('crt');
    
    return (
      <div key={key} style={{ marginBottom: 16 }}>
        <div style={{ 
          display: 'flex', 
          justifyContent: 'space-between', 
          alignItems: 'center',
          marginBottom: 8,
        }}>
          <Space>
            <KeyOutlined style={{ color: '#1890ff' }} />
            <Text strong>{label}</Text>
            <Text type="secondary" style={{ fontSize: 12 }}>({key})</Text>
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
        <div style={{ 
          border: revealValues ? '1px solid #ffd591' : '1px solid #d9d9d9', 
          borderRadius: 4, 
          overflow: 'hidden',
          background: revealValues ? '#fffbe6' : '#fafafa',
        }}>
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
      const content = revealValues ? (revealedData[key] || '******') : '****** (已脱敏)';
      
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
            <div style={{ marginBottom: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
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
            <div style={{ 
              border: revealValues ? '1px solid #ffd591' : '1px solid #d9d9d9', 
              borderRadius: 4, 
              overflow: 'hidden',
              background: revealValues ? '#fffbe6' : '#fff',
            }}>
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
        <Descriptions.Item label="命名空间">{metadata.namespace}</Descriptions.Item>
        <Descriptions.Item label="类型">{renderSecretType(type)}</Descriptions.Item>
        <Descriptions.Item label="运行时长">{calculateAge(metadata.creationTimestamp)}</Descriptions.Item>
        <Descriptions.Item label="数据条目">{dataKeys.length}</Descriptions.Item>
        <Descriptions.Item label="创建时间">{formatTime(metadata.creationTimestamp)}</Descriptions.Item>
        <Descriptions.Item label="标签" span={2}>
          <Space size={4} wrap>
            {Object.entries(metadata.labels || {}).map(([k, v]) => (
              <Tag key={k}>{k}={String(v)}</Tag>
            ))}
          </Space>
        </Descriptions.Item>
      </Descriptions>
      
      {/* 数据内容 */}
      <div style={{ marginTop: 24 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <Text strong style={{ fontSize: 14 }}>
            数据内容 ({dataKeys.length} 条)
          </Text>
          <Space>
            <Text type="secondary" style={{ fontSize: 12 }}>显示明文值</Text>
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
            <div style={{ 
              padding: 16, 
              background: '#fafafa', 
              borderRadius: 8,
              border: '1px solid #f0f0f0',
            }}>
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
          <div style={{ padding: 40, textAlign: 'center', color: '#999', background: '#fafafa', borderRadius: 8 }}>
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
  onRefresh: () => void;
  onCreateClick: () => void;
  onEditClick: (record: any) => void;
}> = ({ data, loading, cloudId, namespacesOptions, nsValue, onRefresh, onCreateClick, onEditClick }) => {
  const { modal, message } = App.useApp();
  const [keyword, setKeyword] = useState('');
  const [selectedKeys, setSelectedKeys] = useState<React.Key[]>([]);
  const [detailVisible, setDetailVisible] = useState(false);
  const [currentConfigMap, setCurrentConfigMap] = useState<any>(null);
  
  // 过滤数据
  const filteredData = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    return data.filter((item: any) => {
      const name = item?.metadata?.name || '';
      const ns = item?.metadata?.namespace || '';
      if (kw && !name.toLowerCase().includes(kw) && !ns.toLowerCase().includes(kw)) {
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
  const handleDelete = useCallback(async (configmap: any) => {
    const namespace = configmap?.metadata?.namespace;
    const name = configmap?.metadata?.name;
    
    try {
      await deleteHarvesterConfigMap(cloudId, namespace, name);
      message.success('删除成功');
      onRefresh();
    } catch (e: any) {
      message.error(e?.message || '删除失败');
    }
  }, [cloudId, message, onRefresh]);
  
  // 表格列定义
  const columns = useMemo(() => [
    {
      title: '名称',
      dataIndex: ['metadata', 'name'],
      key: 'name',
      width: 250,
      ellipsis: true,
      render: (name: string) => (
        <Space>
          <FileTextOutlined />
          <Text>{name}</Text>
        </Space>
      ),
    },
    {
      title: '命名空间',
      dataIndex: ['metadata', 'namespace'],
      key: 'namespace',
      width: 140,
      ellipsis: true,
      render: (ns: string) => <Tag>{ns}</Tag>,
    },
    {
      title: '数据条目',
      key: 'dataCount',
      width: 100,
      render: (_: any, record: any) => {
        const dataKeys = Object.keys(record?.data || {});
        const binaryKeys = Object.keys(record?.binaryData || {});
        return dataKeys.length + binaryKeys.length;
      },
    },
    {
      title: '运行时长',
      key: 'age',
      width: 100,
      render: (_: any, record: any) => calculateAge(record?.metadata?.creationTimestamp),
    },
    {
      title: '创建时间',
      dataIndex: ['metadata', 'creationTimestamp'],
      key: 'creationTimestamp',
      width: 180,
      render: formatTime,
    },
    {
      title: '操作',
      key: 'actions',
      width: 150,
      fixed: 'right' as const,
      render: (_: any, record: any) => {
        const items = [
          {
            key: 'detail',
            label: '详情',
            icon: <EyeOutlined />,
            onClick: () => handleViewDetail(record),
          },
          {
            key: 'edit',
            label: '编辑',
            icon: <EditOutlined />,
            onClick: () => onEditClick(record),
          },
          {
            key: 'delete',
            label: '删除',
            icon: <DeleteOutlined />,
            danger: true,
            onClick: () => {
              modal.confirm({
                title: '确认删除',
                content: `确定要删除 ConfigMap "${record?.metadata?.name}" 吗？`,
                okType: 'danger',
                onOk: () => handleDelete(record),
              });
            },
          },
        ];
        
        return <ResourceActionsDropdown items={items} />;
      },
    },
  ], [handleViewDetail, handleDelete, modal, onEditClick]);
  
  // 使用列设置 Hook
  const { displayColumns: tableColumns } = useTableColumnSettings(
    columns,
    'harvester-containers-configmaps',
  );
  
  return (
    <div>
      <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Input.Search
          placeholder="搜索名称/命名空间"
          allowClear
          style={{ width: 250 }}
          onSearch={setKeyword}
          onChange={(e) => setKeyword(e.target.value)}
        />
        <Space>
          <Button type="primary" icon={<PlusOutlined />} onClick={onCreateClick}>
            创建 ConfigMap
          </Button>
          <TableColumnSettingsButton
            allColumns={columns}
            settingsKey="harvester-containers-configmaps"
          />
        </Space>
      </div>
      
      <Table
        rowKey={(record) => `${record?.metadata?.namespace}/${record?.metadata?.name}`}
        columns={tableColumns}
        dataSource={filteredData}
        loading={loading}
        scroll={{ x: 950 }}
        pagination={{
          showSizeChanger: true,
          showQuickJumper: true,
          showTotal: (total) => `共 ${total} 条`,
          defaultPageSize: 20,
        }}
        rowSelection={{
          selectedRowKeys: selectedKeys,
          onChange: setSelectedKeys,
        }}
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
  typeFilter?: string;
  onTypeChange: (type?: string) => void;
  onRefresh: () => void;
  onCreateClick: () => void;
  onEditClick: (record: any) => void;
}> = ({ data, loading, cloudId, namespacesOptions, nsValue, typeFilter, onTypeChange, onRefresh, onCreateClick, onEditClick }) => {
  const { modal, message } = App.useApp();
  const [keyword, setKeyword] = useState('');
  const [selectedKeys, setSelectedKeys] = useState<React.Key[]>([]);
  const [detailVisible, setDetailVisible] = useState(false);
  const [currentSecret, setCurrentSecret] = useState<any>(null);

  // 当列表数据刷新时，同步更新当前查看的 Secret
  useEffect(() => {
    if (currentSecret && detailVisible) {
      const namespace = currentSecret?.metadata?.namespace;
      const name = currentSecret?.metadata?.name;
      if (namespace && name) {
        const updated = data.find((item: any) =>
          item?.metadata?.namespace === namespace &&
          item?.metadata?.name === name
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
      if (kw && !name.toLowerCase().includes(kw) && !ns.toLowerCase().includes(kw)) {
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
  const handleDelete = useCallback(async (secret: any) => {
    const namespace = secret?.metadata?.namespace;
    const name = secret?.metadata?.name;
    
    try {
      await deleteHarvesterSecret(cloudId, namespace, name);
      message.success('删除成功');
      onRefresh();
    } catch (e: any) {
      message.error(e?.message || '删除失败');
    }
  }, [cloudId, message, onRefresh]);
  
  // 表格列定义
  const columns = useMemo(() => [
    {
      title: '名称',
      dataIndex: ['metadata', 'name'],
      key: 'name',
      width: 250,
      ellipsis: true,
      render: (name: string) => (
        <Space>
          <KeyOutlined />
          <Text>{name}</Text>
        </Space>
      ),
    },
    {
      title: '命名空间',
      dataIndex: ['metadata', 'namespace'],
      key: 'namespace',
      width: 140,
      ellipsis: true,
      render: (ns: string) => <Tag>{ns}</Tag>,
    },
    {
      title: '类型',
      dataIndex: 'type',
      key: 'type',
      width: 180,
      ellipsis: true,
      render: renderSecretType,
    },
    {
      title: '数据条目',
      key: 'dataCount',
      width: 100,
      render: (_: any, record: any) => Object.keys(record?.data || {}).length,
    },
    {
      title: '运行时长',
      key: 'age',
      width: 100,
      render: (_: any, record: any) => calculateAge(record?.metadata?.creationTimestamp),
    },
    {
      title: '创建时间',
      dataIndex: ['metadata', 'creationTimestamp'],
      key: 'creationTimestamp',
      width: 180,
      render: formatTime,
    },
    {
      title: '操作',
      key: 'actions',
      width: 150,
      fixed: 'right' as const,
      render: (_: any, record: any) => {
        const items = [
          {
            key: 'detail',
            label: '详情',
            icon: <EyeOutlined />,
            onClick: () => handleViewDetail(record),
          },
          {
            key: 'edit',
            label: '编辑',
            icon: <EditOutlined />,
            onClick: () => onEditClick(record),
          },
          {
            key: 'delete',
            label: '删除',
            icon: <DeleteOutlined />,
            danger: true,
            onClick: () => {
              modal.confirm({
                title: '确认删除',
                content: `确定要删除 Secret "${record?.metadata?.name}" 吗？`,
                okType: 'danger',
                onOk: () => handleDelete(record),
              });
            },
          },
        ];
        
        return <ResourceActionsDropdown items={items} />;
      },
    },
  ], [handleViewDetail, handleDelete, modal, onEditClick]);
  
  // 使用列设置 Hook
  const { displayColumns: tableColumns } = useTableColumnSettings(
    columns,
    'harvester-containers-secrets',
  );
  
  return (
    <div>
      <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Space>
          <Input.Search
            placeholder="搜索名称/命名空间"
            allowClear
            style={{ width: 200 }}
            onSearch={setKeyword}
            onChange={(e) => setKeyword(e.target.value)}
          />
          <Select
            placeholder="筛选类型"
            allowClear
            showSearch
            optionFilterProp="label"
            style={{ width: 180 }}
            value={typeFilter}
            onChange={onTypeChange}
            options={secretTypeOptions}
          />
        </Space>
        <Space>
          <Button type="primary" icon={<PlusOutlined />} onClick={onCreateClick}>
            创建 Secret
          </Button>
          <TableColumnSettingsButton
            allColumns={columns}
            settingsKey="harvester-containers-secrets"
          />
        </Space>
      </div>
      
      <Table
        rowKey={(record) => `${record?.metadata?.namespace}/${record?.metadata?.name}`}
        columns={tableColumns}
        dataSource={filteredData}
        loading={loading}
        scroll={{ x: 1050 }}
        pagination={{
          showSizeChanger: true,
          showQuickJumper: true,
          showTotal: (total) => `共 ${total} 条`,
          defaultPageSize: 20,
        }}
        rowSelection={{
          selectedRowKeys: selectedKeys,
          onChange: setSelectedKeys,
        }}
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
}) => {
  const [activeTab, setActiveTab] = useState<'configmap' | 'secret'>('configmap');
  const [secretTypeFilter, setSecretTypeFilter] = useState<string | undefined>();
  
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
        const updated = configmaps.find((item: any) =>
          item?.metadata?.namespace === namespace &&
          item?.metadata?.name === name
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
        const updated = secrets.find((item: any) =>
          item?.metadata?.namespace === namespace &&
          item?.metadata?.name === name
        );
        if (updated) {
          setCurrentSecret(updated);
        }
      }
    }
  }, [secrets, currentSecret, secretEditMode]);

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
    onRefresh(true); // 强制刷新，绕过缓存
  };
  
  // Secret 操作
  const handleCreateSecret = () => {
    setSecretEditMode(false);
    setCurrentSecret(null);
    setSecretModalVisible(true);
  };
  
  const handleEditSecret = (record: any) => {
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
    onRefresh(true); // 强制刷新，绕过缓存
  };
  
  // Tab 切换
  const handleTabChange = (key: string) => {
    setActiveTab(key as 'configmap' | 'secret');
  };
  
  // 根据 nsValue 过滤数据
  const filteredConfigMaps = useMemo(() => {
    if (!nsValue) return configmaps;
    return configmaps.filter((item: any) => item?.metadata?.namespace === nsValue);
  }, [configmaps, nsValue]);
  
  const filteredSecrets = useMemo(() => {
    let result = secrets;
    // 先按命名空间过滤
    if (nsValue) {
      result = result.filter((item: any) => item?.metadata?.namespace === nsValue);
    }
    // 再按类型过滤
    if (secretTypeFilter) {
      result = result.filter((item: any) => item?.type === secretTypeFilter);
    }
    return result;
  }, [secrets, nsValue, secretTypeFilter]);
  
  return (
    <>
      <PageDetailSection
        title="配置管理"
        toolbarLeft={
          <Select
            placeholder="筛选命名空间"
            allowClear
            showSearch
            optionFilterProp="label"
            style={{ width: 200 }}
            value={nsValue}
            onChange={onNsChange}
            options={namespacesOptions.map((ns) => ({ label: ns, value: ns }))}
          />
        }
        onRefresh={onRefresh}
      >
        <Tabs
          type="line"
          activeKey={activeTab}
          onChange={handleTabChange}
          items={[
            {
              key: 'configmap',
              label: `ConfigMap (${filteredConfigMaps.length})`,
              children: (
                <ConfigMapTable
                  data={filteredConfigMaps}
                  loading={loading}
                  cloudId={cloudId}
                  namespacesOptions={namespacesOptions}
                  nsValue={nsValue}
                  onRefresh={onRefresh}
                  onCreateClick={handleCreateConfigMap}
                  onEditClick={handleEditConfigMap}
                />
              ),
            },
            {
              key: 'secret',
              label: `Secret (${filteredSecrets.length})`,
              children: (
                <SecretTable
                  data={filteredSecrets}
                  loading={loading}
                  cloudId={cloudId}
                  namespacesOptions={namespacesOptions}
                  nsValue={nsValue}
                  typeFilter={secretTypeFilter}
                  onTypeChange={setSecretTypeFilter}
                  onRefresh={onRefresh}
                  onCreateClick={handleCreateSecret}
                  onEditClick={handleEditSecret}
                />
              ),
            },
          ]}
        />
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
          defaultNamespace={nsValue}
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
          defaultNamespace={nsValue}
          editMode={secretEditMode}
          initialData={currentSecret}
          onSuccess={handleSecretSuccess}
          onCancel={handleSecretModalClose}
        />
      </Modal>
    </>
  );
};

export default ConfigsSection;