/**
 * ==============================================================================
 * 模块名称: Harvester 镜像凭证视图 (RegistriesSection)
 * 文件路径: src/pages/Clouds/Harvester/containers/RegistriesSection.tsx
 * ==============================================================================
 * 
 * [功能描述]
 * 该组件负责展示和管理 Harvester/Kubernetes 镜像凭证资源，包括：
 * 1. dockerconfigjson 类型 Secret 列表展示
 * 2. 镜像仓库地址解析与显示
 * 3. 命名空间筛选与搜索功能
 * 
 * [核心逻辑]
 * 1. 解析仓库地址: 从 .dockerconfigjson 解析服务器地址
 * 2. 安全显示: 详情中不展示密码/凭证内容
 * 3. 命名空间筛选: 支持按命名空间过滤
 * 4. 操作功能: 详情查看、删除
 */

import React, { useState, useMemo, useCallback } from 'react';
import { Table, Select, Button, Tag, Space, App, Drawer, Descriptions, Input, Typography } from 'antd';
import { ReloadOutlined, DeleteOutlined, EyeOutlined, KeyOutlined } from '@ant-design/icons';
import PageDetailSection from '../../../../components/PageDetailSection';
import ResourceActionsDropdown from '../../../../components/ResourceActionsDropdown';
import { useTableColumnSettings } from '../../../../hooks/useTableColumnSettings';
import TableColumnSettingsButton from '../../../../components/TableColumnSettingsButton';
import {
  deleteHarvesterContainerResource,
} from '../../../../services/harvesterApi';

const { Text } = Typography;

type Props = {
  secrets: any[];           // 镜像凭证列表 (已过滤为 dockerconfigjson 类型)
  loading: boolean;
  namespacesOptions: string[];
  cloudId: string;
  nsValue?: string;
  onNsChange: (v?: string) => void;
  onRefresh: (force?: boolean) => void;
};

/**
 * 解析仓库服务器地址
 * 从 .dockerconfigjson 字段中解析出镜像仓库地址
 */
const getRegistryServer = (secret: any) => {
  try {
    const data = secret?.data?.['.dockerconfigjson'];
    if (!data) return '-';
    const decoded = atob(data); // Base64 解码
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
    
    if (days > 0) return `${days}d${hours}h`;
    if (hours > 0) return `${hours}h${minutes}m`;
    return `${minutes}m`;
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
      title={`镜像凭证详情: ${metadata.name}`}
      placement="right"
      width={600}
      open={visible}
      onClose={onClose}
    >
      <Descriptions column={1} bordered size="small">
        <Descriptions.Item label="名称">{metadata.name}</Descriptions.Item>
        <Descriptions.Item label="命名空间">{metadata.namespace}</Descriptions.Item>
        <Descriptions.Item label="仓库地址">
          <Text code copyable>{registryServer}</Text>
        </Descriptions.Item>
        <Descriptions.Item label="运行时长">{calculateAge(metadata.creationTimestamp)}</Descriptions.Item>
        <Descriptions.Item label="创建时间">{formatTime(metadata.creationTimestamp)}</Descriptions.Item>
        <Descriptions.Item label="标签">
          <Space size={4} wrap>
            {Object.entries(metadata.labels || {}).map(([k, v]) => (
              <Tag key={k}>{k}={String(v)}</Tag>
            ))}
            {Object.keys(metadata.labels || {}).length === 0 && <Text type="secondary">无</Text>}
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
          * 出于安全考虑，凭证内容已脱敏，仅显示键名
        </Text>
      </div>
    </Drawer>
  );
};

/**
 * Registries Section 主组件
 */
const RegistriesSection: React.FC<Props> = ({
  secrets,
  loading,
  namespacesOptions,
  cloudId,
  nsValue,
  onNsChange,
  onRefresh,
}) => {
  const { modal, message } = App.useApp();
  const [keyword, setKeyword] = useState('');
  const [selectedKeys, setSelectedKeys] = useState<React.Key[]>([]);
  const [detailVisible, setDetailVisible] = useState(false);
  const [currentSecret, setCurrentSecret] = useState<any>(null);
  
  // 过滤数据
  const filteredData = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    return secrets.filter((item: any) => {
      const name = item?.metadata?.name || '';
      const ns = item?.metadata?.namespace || '';
      
      // 关键词过滤
      if (kw && !name.toLowerCase().includes(kw) && !ns.toLowerCase().includes(kw)) {
        return false;
      }
      
      // 命名空间过滤
      if (nsValue && ns !== nsValue) {
        return false;
      }
      
      return true;
    });
  }, [secrets, keyword, nsValue]);
  
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
      title: '仓库地址',
      key: 'registryServer',
      width: 280,
      ellipsis: true,
      render: (_: any, record: any) => {
        const server = getRegistryServer(record);
        return <Text code copyable={{ text: server }}>{server}</Text>;
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
                content: `确定要删除镜像凭证 "${record?.metadata?.name}" 吗？`,
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
    'harvester-containers-registries',
  );
  
  return (
    <PageDetailSection
      title="镜像凭证"
      toolbarLeft={
        <Space>
          <Input.Search
            placeholder="搜索名称/命名空间"
            allowClear
            style={{ width: 200 }}
            onSearch={setKeyword}
            onChange={(e) => setKeyword(e.target.value)}
          />
          <Select
            placeholder="筛选命名空间"
            allowClear
            showSearch
            optionFilterProp="label"
            style={{ width: 180 }}
            value={nsValue}
            onChange={onNsChange}
            options={namespacesOptions.map((ns) => ({ label: ns, value: ns }))}
          />
        </Space>
      }
      toolbarRight={
        <Space>
          <Button icon={<ReloadOutlined />} onClick={() => onRefresh()}>
            刷新
          </Button>
          <TableColumnSettingsButton
            allColumns={columns}
            settingsKey="harvester-containers-registries"
          />
        </Space>
      }
    >
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
      
      {/* 镜像凭证详情抽屉 */}
      <RegistryDetailDrawer
        secret={currentSecret}
        visible={detailVisible}
        onClose={() => {
          setDetailVisible(false);
          setCurrentSecret(null);
        }}
      />
    </PageDetailSection>
  );
};

export default RegistriesSection;
