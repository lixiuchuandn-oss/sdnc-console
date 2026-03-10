/**
 * ==============================================================================
 * 模块名称: Harvester 配置管理视图 (ConfigsSection)
 * 文件路径: src/pages/Clouds/Harvester/containers/ConfigsSection.tsx
 * ==============================================================================
 * 
 * [功能描述]
 * 该组件负责展示和管理 Harvester/Kubernetes 配置资源，包括：
 * 1. ConfigMap 列表展示与管理
 * 2. Secret 列表展示与管理
 * 
 * [核心逻辑]
 * 1. 配置类型切换: 通过 Tab 切换 ConfigMap 和 Secret
 * 2. 命名空间筛选: 支持按命名空间过滤
 * 3. Secret 类型过滤: 支持按 Secret 类型过滤
 * 4. 操作功能: 详情查看、删除
 */

import React, { useState, useMemo, useCallback } from 'react';
import { Table, Tabs, Select, Button, Tag, Space, App, Drawer, Descriptions, Input, Typography } from 'antd';
import { ReloadOutlined, DeleteOutlined, SearchOutlined, EyeOutlined, KeyOutlined, FileTextOutlined } from '@ant-design/icons';
import PageDetailSection from '../../../../components/PageDetailSection';
import ResourceActionsDropdown from '../../../../components/ResourceActionsDropdown';
import { useTableColumnSettings } from '../../../../hooks/useTableColumnSettings';
import TableColumnSettingsButton from '../../../../components/TableColumnSettingsButton';
import {
  deleteHarvesterContainerResource,
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
 */
const ConfigMapDetailDrawer: React.FC<{
  configmap: any;
  visible: boolean;
  onClose: () => void;
}> = ({ configmap, visible, onClose }) => {
  if (!configmap) return null;
  
  const metadata = configmap?.metadata || {};
  const data = configmap?.data || {};
  const binaryData = configmap?.binaryData || {};
  const dataKeys = Object.keys(data);
  const binaryDataKeys = Object.keys(binaryData);
  
  return (
    <Drawer
      title={`ConfigMap 详情: ${metadata.name}`}
      placement="right"
      width={700}
      open={visible}
      onClose={onClose}
    >
      <Descriptions column={2} bordered size="small">
        <Descriptions.Item label="名称">{metadata.name}</Descriptions.Item>
        <Descriptions.Item label="命名空间">{metadata.namespace}</Descriptions.Item>
        <Descriptions.Item label="运行时长">{calculateAge(metadata.creationTimestamp)}</Descriptions.Item>
        <Descriptions.Item label="数据条目">{dataKeys.length + binaryDataKeys.length}</Descriptions.Item>
        <Descriptions.Item label="创建时间" span={2}>{formatTime(metadata.creationTimestamp)}</Descriptions.Item>
        <Descriptions.Item label="标签" span={2}>
          <Space size={4} wrap>
            {Object.entries(metadata.labels || {}).map(([k, v]) => (
              <Tag key={k}>{k}={String(v)}</Tag>
            ))}
          </Space>
        </Descriptions.Item>
      </Descriptions>
      
      {/* 数据内容 */}
      <div style={{ marginTop: 16 }}>
        <Text strong>数据内容 ({dataKeys.length} 条)</Text>
        <div style={{ marginTop: 8, maxHeight: 400, overflow: 'auto' }}>
          {dataKeys.length > 0 ? (
            dataKeys.map((key) => (
              <div key={key} style={{ marginBottom: 8 }}>
                <Text code>{key}</Text>
                <pre style={{ 
                  margin: '4px 0', 
                  padding: 8, 
                  background: '#f5f5f5', 
                  borderRadius: 4,
                  maxHeight: 150,
                  overflow: 'auto',
                  fontSize: 12,
                }}>
                  {typeof data[key] === 'string' ? data[key] : JSON.stringify(data[key], null, 2)}
                </pre>
              </div>
            ))
          ) : (
            <Text type="secondary">无数据</Text>
          )}
        </div>
      </div>
    </Drawer>
  );
};

/**
 * Secret 详情抽屉组件
 */
const SecretDetailDrawer: React.FC<{
  secret: any;
  visible: boolean;
  onClose: () => void;
}> = ({ secret, visible, onClose }) => {
  if (!secret) return null;
  
  const metadata = secret?.metadata || {};
  const type = secret?.type || 'Opaque';
  const data = secret?.data || {};
  const dataKeys = Object.keys(data);
  
  return (
    <Drawer
      title={`Secret 详情: ${metadata.name}`}
      placement="right"
      width={700}
      open={visible}
      onClose={onClose}
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
      
      {/* 数据键列表 (值已脱敏) */}
      <div style={{ marginTop: 16 }}>
        <Text strong>数据键 ({dataKeys.length} 条)</Text>
        <div style={{ marginTop: 8 }}>
          {dataKeys.length > 0 ? (
            <Space size={4} wrap>
              {dataKeys.map((key) => (
                <Tag key={key} icon={<KeyOutlined />}>{key}</Tag>
              ))}
            </Space>
          ) : (
            <Text type="secondary">无数据</Text>
          )}
        </div>
        <Text type="secondary" style={{ display: 'block', marginTop: 8, fontSize: 12 }}>
          * 出于安全考虑，Secret 值已脱敏，仅显示键名
        </Text>
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
  onRefresh: () => void;
}> = ({ data, loading, cloudId, onRefresh }) => {
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
      await deleteHarvesterContainerResource(cloudId, '/api/v1/configmaps', namespace, name);
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
      width: 120,
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
  ], [handleViewDetail, handleDelete, modal]);
  
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
          <Button icon={<ReloadOutlined />} onClick={() => onRefresh()}>
            刷新
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
        scroll={{ x: 900 }}
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
  typeFilter?: string;
  onTypeChange: (type?: string) => void;
  onRefresh: () => void;
}> = ({ data, loading, cloudId, typeFilter, onTypeChange, onRefresh }) => {
  const { modal, message } = App.useApp();
  const [keyword, setKeyword] = useState('');
  const [selectedKeys, setSelectedKeys] = useState<React.Key[]>([]);
  const [detailVisible, setDetailVisible] = useState(false);
  const [currentSecret, setCurrentSecret] = useState<any>(null);
  
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
      await deleteHarvesterContainerResource(cloudId, '/api/v1/secrets', namespace, name);
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
      width: 120,
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
  ], [handleViewDetail, handleDelete, modal]);
  
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
          <Button icon={<ReloadOutlined />} onClick={() => onRefresh()}>
            刷新
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
        scroll={{ x: 1000 }}
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
                onRefresh={onRefresh}
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
                typeFilter={secretTypeFilter}
                onTypeChange={setSecretTypeFilter}
                onRefresh={onRefresh}
              />
            ),
          },
        ]}
      />
    </PageDetailSection>
  );
};

export default ConfigsSection;
