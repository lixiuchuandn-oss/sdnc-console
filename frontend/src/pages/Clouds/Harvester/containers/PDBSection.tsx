/**
 * ==============================================================================
 * 模块名称: PodDisruptionBudget 管理视图 (PDBSection)
 * 文件路径: src/pages/Clouds/Harvester/containers/PDBSection.tsx
 * ==============================================================================
 * 
 * [功能描述]
 * 该组件负责展示和管理 Kubernetes PodDisruptionBudget 资源，包括：
 * 1. PDB 列表展示
 * 2. PDB 创建
 * 3. PDB 删除
 * 4. 命名空间筛选
 * 
 * [核心逻辑]
 * PodDisruptionBudget 用于限制自愿中断（如节点维护、集群升级）时的 Pod 数量，
 * 确保服务的高可用性。
 */

import React, { useState, useMemo, useCallback } from 'react';
import {
  Table,
  Select,
  Button,
  Tag,
  Space,
  App,
  Drawer,
  Descriptions,
  Modal,
  Tooltip,
  Alert,
} from 'antd';
import {
  ReloadOutlined,
  DeleteOutlined,
  PlusOutlined,
  SafetyOutlined,
  EyeOutlined,
} from '@ant-design/icons';
import PageDetailSection from '../../../../components/PageDetailSection';
import ResourceActionsDropdown from '../../../../components/ResourceActionsDropdown';
import { useTableColumnSettings } from '../../../../hooks/useTableColumnSettings';
import TableColumnSettingsButton from '../../../../components/TableColumnSettingsButton';
import {
  fetchHarvesterPDBDetail,
  deleteHarvesterPDB,
} from '../../../../services/harvesterApi';
import { PDBForm } from './components';

type Props = {
  pdbs: any[];
  loading: boolean;
  namespacesOptions: string[];
  cloudId: string;
  nsValue?: string;
  onNsChange: (v?: string) => void;
  onRefresh: (force?: boolean) => void;
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
 * 格式化 IntOrString 类型的值
 * Kubernetes 的 IntOrString 可以是整数或百分比字符串
 */
const formatIntOrString = (value: any): string => {
  if (value === undefined || value === null) return '-';
  return String(value);
};

/**
 * 格式化选择器
 */
const formatSelector = (selector: any): string => {
  if (!selector) return '-';
  
  const matchLabels = selector.matchLabels || {};
  const labels = Object.entries(matchLabels)
    .map(([k, v]) => `${k}=${v}`)
    .join(', ');
  
  return labels || '-';
};

/**
 * PDB 条件类型中英文映射（中文和英文分开存储）
 */
const PDB_CONDITION_TYPE_MAP: Record<string, { zh: string; en: string }> = {
  'DisruptionAllowed': { zh: '允许中断', en: 'DisruptionAllowed' },
  'InsufficientPods': { zh: 'Pod不足', en: 'InsufficientPods' },
};

/**
 * PDB 条件原因中英文映射（中文和英文分开存储）
 */
const PDB_CONDITION_REASON_MAP: Record<string, { zh: string; en: string }> = {
  'SyncFailed': { zh: '同步失败', en: 'SyncFailed' },
  'SufficientPods': { zh: 'Pod数量充足', en: 'SufficientPods' },
  'InsufficientPods': { zh: 'Pod数量不足', en: 'InsufficientPods' },
};

/**
 * 格式化条件类型（两行显示：中文 + 英文）
 */
const formatConditionType = (type: string): React.ReactNode => {
  const mapping = PDB_CONDITION_TYPE_MAP[type];
  if (mapping) {
    return (
      <div>
        <div>{mapping.zh}</div>
        <div style={{ color: '#999', fontSize: 12 }}>({mapping.en})</div>
      </div>
    );
  }
  return type;
};

/**
 * 格式化条件原因（两行显示：中文 + 英文）
 */
const formatConditionReason = (reason: string): React.ReactNode => {
  const mapping = PDB_CONDITION_REASON_MAP[reason];
  if (mapping) {
    return (
      <div>
        <div>{mapping.zh}</div>
        <div style={{ color: '#999', fontSize: 12 }}>({mapping.en})</div>
      </div>
    );
  }
  return reason;
};

/**
 * 渲染 PDB 状态
 */
const renderPDBStatus = (pdb: any) => {
  const status = pdb?.status || {};
  const conditions = status?.conditions || [];
  
  // 检查是否有 DisruptionAllowed 条件
  const disruptionCondition = conditions.find(
    (c: any) => c.type === 'DisruptionAllowed' || c.type === 'DisruptionAllowed'
  );
  
  if (disruptionCondition) {
    if (disruptionCondition.status === 'True') {
      return <Tag color="green">允许中断</Tag>;
    } else {
      return (
        <Tooltip title={disruptionCondition.message || '当前不允许中断'}>
          <Tag color="orange">不允许中断</Tag>
        </Tooltip>
      );
    }
  }
  
  // 默认状态
  const healthy = status?.currentHealthy || 0;
  const desired = status?.desiredHealthy || 0;
  
  if (healthy >= desired && desired > 0) {
    return <Tag color="green">健康</Tag>;
  } else if (healthy > 0) {
    return <Tag color="orange">部分健康</Tag>;
  } else {
    return <Tag color="red">不健康</Tag>;
  }
};

/**
 * PDB 详情抽屉组件
 */
const PDBDetailDrawer: React.FC<{
  pdb: any;
  visible: boolean;
  cloudId: string;
  onClose: () => void;
}> = ({ pdb, visible, cloudId, onClose }) => {
  const [detail, setDetail] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  React.useEffect(() => {
    if (visible && pdb) {
      setLoading(true);
      fetchHarvesterPDBDetail(cloudId, pdb.metadata.namespace, pdb.metadata.name)
        .then((res) => {
          setDetail(res?.data || pdb);
        })
        .catch((e) => {
          console.error('获取 PDB 详情失败:', e);
          setDetail(pdb);
        })
        .finally(() => {
          setLoading(false);
        });
    }
  }, [visible, pdb, cloudId]);

  if (!pdb && !detail) return null;

  const data = detail || pdb;
  const metadata = data?.metadata || {};
  const spec = data?.spec || {};
  const status = data?.status || {};

  return (
    <Drawer
      title={
        <Space>
          <SafetyOutlined />
          Pod 中断保护详情: {metadata.name}
        </Space>
      }
      placement="right"
      width={840}
      open={visible}
      onClose={onClose}
      loading={loading}
    >
      <Alert
        message="Pod 中断保护 (PDB) 用于限制自愿中断（如节点维护、集群升级）时的 Pod 数量，确保服务可用性。"
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
      />
      
      <Descriptions column={2} bordered size="small">
        <Descriptions.Item label="名称">{metadata.name}</Descriptions.Item>
        <Descriptions.Item label="命名空间">{metadata.namespace}</Descriptions.Item>
        <Descriptions.Item label="状态">{renderPDBStatus(data)}</Descriptions.Item>
        <Descriptions.Item label="运行时长">{calculateAge(metadata.creationTimestamp)}</Descriptions.Item>
        
        <Descriptions.Item label="最小可用数">
          <Tag color="blue">{formatIntOrString(spec.minAvailable)}</Tag>
        </Descriptions.Item>
        <Descriptions.Item label="最大不可用数">
          <Tag color="orange">{formatIntOrString(spec.maxUnavailable)}</Tag>
        </Descriptions.Item>
        
        <Descriptions.Item label="选择器" span={2}>
          <Space size={4} wrap>
            {Object.entries(spec?.selector?.matchLabels || {}).map(([k, v]) => (
              <Tag key={k}>{k}={String(v)}</Tag>
            ))}
            {!spec?.selector?.matchLabels && '-'}
          </Space>
        </Descriptions.Item>
        
        <Descriptions.Item label="当前健康数">{status.currentHealthy || 0}</Descriptions.Item>
        <Descriptions.Item label="期望健康数">{status.desiredHealthy || 0}</Descriptions.Item>
        <Descriptions.Item label="预期副本数">{status.expectedPods || 0}</Descriptions.Item>
        <Descriptions.Item label="允许中断数">{status.disruptionsAllowed ?? '-'}</Descriptions.Item>
        
        <Descriptions.Item label="创建时间" span={2}>
          {formatTime(metadata.creationTimestamp)}
        </Descriptions.Item>
        
        {Object.keys(metadata.labels || {}).length > 0 && (
          <Descriptions.Item label="标签" span={2}>
            <Space size={4} wrap>
              {Object.entries(metadata.labels || {}).map(([k, v]) => (
                <Tag key={k}>{k}={String(v)}</Tag>
              ))}
            </Space>
          </Descriptions.Item>
        )}
      </Descriptions>
      
      {status.conditions && status.conditions.length > 0 && (
        <>
          <div style={{ marginTop: 16, marginBottom: 8, fontWeight: 500 }}>条件</div>
          <Table
            size="small"
            dataSource={status.conditions.map((c: any, i: number) => ({ ...c, key: i }))}
            pagination={false}
            columns={[
              { 
                title: '类型', 
                dataIndex: 'type', 
                width: 150,
                render: (v: string) => formatConditionType(v),
              },
              { 
                title: '状态', 
                dataIndex: 'status', 
                width: 70,
                render: (v: string) => (
                  <Tag color={v === 'True' ? 'green' : 'red'}>{v}</Tag>
                )
              },
              { 
                title: '原因', 
                dataIndex: 'reason', 
                width: 150,
                render: (v: string) => formatConditionReason(v),
              },
              { 
                title: '消息', 
                dataIndex: 'message',
                ellipsis: true,
              },
              { 
                title: '最后更新', 
                dataIndex: 'lastTransitionTime', 
                width: 150,
                render: formatTime,
              },
            ]}
          />
        </>
      )}
    </Drawer>
  );
};

/**
 * 主组件
 */
const PDBSection: React.FC<Props> = ({
  pdbs,
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
  const [currentPDB, setCurrentPDB] = useState<any>(null);
  const [createModalVisible, setCreateModalVisible] = useState(false);

  // 删除处理
  const handleDelete = useCallback((record: any) => {
    const name = record?.metadata?.name;
    const namespace = record?.metadata?.namespace;
    
    modal.confirm({
      title: '确认删除',
      content: (
        <div>
          <p>确定要删除此 Pod 中断保护规则吗？</p>
          <p>
            <strong>名称:</strong> {name}
          </p>
          <p>
            <strong>命名空间:</strong> {namespace}
          </p>
          <Alert
            message="删除 PDB 可能影响服务在节点维护期间的可用性"
            type="warning"
            showIcon
            style={{ marginTop: 8 }}
          />
        </div>
      ),
      okText: '删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => {
        try {
          await deleteHarvesterPDB(cloudId, namespace, name);
          message.success('删除成功');
          onRefresh(true);
        } catch (e: any) {
          message.error(e?.message || '删除失败');
        }
      },
    });
  }, [cloudId, modal, message, onRefresh]);

  // 批量删除
  const handleBatchDelete = useCallback(() => {
    if (selectedKeys.length === 0) {
      message.warning('请先选择要删除的 PDB');
      return;
    }

    modal.confirm({
      title: '批量删除确认',
      content: (
        <div>
          <p>确定要删除选中的 {selectedKeys.length} 个 Pod 中断保护规则吗？</p>
          <Alert
            message="删除 PDB 可能影响服务在节点维护期间的可用性"
            type="warning"
            showIcon
            style={{ marginTop: 8 }}
          />
        </div>
      ),
      okText: '删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => {
        const promises = selectedKeys.map((key) => {
          const [ns, name] = String(key).split('/');
          return deleteHarvesterPDB(cloudId, ns, name);
        });

        try {
          await Promise.all(promises);
          message.success('批量删除成功');
          setSelectedKeys([]);
          onRefresh(true);
        } catch (e: any) {
          message.error(e?.message || '批量删除失败');
        }
      },
    });
  }, [selectedKeys, cloudId, modal, message, onRefresh]);

  // 表格列定义
  const allColumns = useMemo(() => [
    {
      title: '名称',
      dataIndex: ['metadata', 'name'],
      key: 'name',
      fixed: 'left' as const,
      width: 200,
      render: (name: string, record: any) => (
        <Button
          type="link"
          size="small"
          onClick={() => {
            setCurrentPDB(record);
            setDetailVisible(true);
          }}
        >
          {name}
        </Button>
      ),
    },
    {
      title: '命名空间',
      dataIndex: ['metadata', 'namespace'],
      key: 'namespace',
      width: 120,
    },
    {
      title: '选择器',
      key: 'selector',
      width: 180,
      render: (_: any, record: any) => {
        const matchLabels = record?.spec?.selector?.matchLabels || {};
        const entries = Object.entries(matchLabels);
        
        if (entries.length === 0) return <span style={{ color: '#999' }}>-</span>;
        
        // 渲染带样式的标签内容（用于 Tooltip）
        const renderStyledLabel = (k: string, v: string) => (
          <span>
            <span style={{ fontWeight: 600, color: '#1890ff' }}>{k}</span>
            <span style={{ color: '#bfbfbf', margin: '0 2px' }}>=</span>
            <span style={{ color: '#52c41a' }}>{v}</span>
          </span>
        );
        
        // 单个标签：直接显示，过长时截断
        if (entries.length === 1) {
          const [k, v] = entries[0];
          const text = `${k}=${v}`;
          return (
            <Tooltip title={renderStyledLabel(k, String(v))}>
              <Tag
                style={{
                  maxWidth: 160,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {text}
              </Tag>
            </Tooltip>
          );
        }
        
        // 多个标签：分行显示，最多显示2个，超出显示 +N
        const displayCount = 2;
        const displayEntries = entries.slice(0, displayCount);
        const remaining = entries.length - displayCount;
        
        const content = (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {displayEntries.map(([k, v]) => {
              const text = `${k}=${v}`;
              return (
                <Tag
                  key={k}
                  style={{
                    maxWidth: 160,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {text}
                </Tag>
              );
            })}
            {remaining > 0 && (
              <Tag style={{ color: '#666' }}>+{remaining}</Tag>
            )}
          </div>
        );
        
        // Tooltip 显示完整列表，带样式区分 key 和 value
        const fullContent = (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {entries.map(([k, v]) => (
              <div key={k}>{renderStyledLabel(k, String(v))}</div>
            ))}
          </div>
        );
        
        return (
          <Tooltip title={fullContent}>
            {content}
          </Tooltip>
        );
      },
    },
    {
      title: '最小可用',
      key: 'minAvailable',
      width: 100,
      render: (_: any, record: any) => (
        <Tag color="blue">{formatIntOrString(record?.spec?.minAvailable)}</Tag>
      ),
    },
    {
      title: '最大不可用',
      key: 'maxUnavailable',
      width: 110,
      render: (_: any, record: any) => (
        <Tag color="orange">{formatIntOrString(record?.spec?.maxUnavailable)}</Tag>
      ),
    },
    {
      title: '状态',
      key: 'status',
      width: 100,
      render: (_: any, record: any) => renderPDBStatus(record),
    },
    {
      title: '健康状态',
      key: 'healthy',
      width: 120,
      render: (_: any, record: any) => {
        const status = record?.status || {};
        const healthy = status.currentHealthy || 0;
        const desired = status.desiredHealthy || 0;
        return (
          <span>
            <Tag color={healthy >= desired ? 'green' : 'orange'}>{healthy}</Tag>
            / {desired}
          </span>
        );
      },
    },
    {
      title: '创建时间',
      dataIndex: ['metadata', 'creationTimestamp'],
      key: 'created',
      width: 160,
      render: (v: string) => (
        <Tooltip title={formatTime(v)}>
          {calculateAge(v)}
        </Tooltip>
      ),
    },
    {
      title: '操作',
      key: 'actions',
      fixed: 'right' as const,
      width: 80,
      render: (_: any, record: any) => (
        <ResourceActionsDropdown
          items={[
            {
              key: 'detail',
              label: '查看详情',
              icon: <EyeOutlined />,
              onClick: () => {
                setCurrentPDB(record);
                setDetailVisible(true);
              },
            },
            {
              key: 'delete',
              label: '删除',
              icon: <DeleteOutlined />,
              danger: true,
              onClick: () => handleDelete(record),
            },
          ]}
        />
      ),
    },
  ], [handleDelete]);

  // 使用 hook 管理列设置
  const { displayColumns: tableColumns } = useTableColumnSettings(allColumns, 'harvester_pdb_table');

  // 过滤数据
  const filteredData = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    return (pdbs || [])
      .filter((item: any) => {
        if (!kw) return true;
        const name = item?.metadata?.name || '';
        const ns = item?.metadata?.namespace || '';
        return name.toLowerCase().includes(kw) || ns.toLowerCase().includes(kw);
      })
      .sort((a: any, b: any) => {
        const timeA = new Date(a?.metadata?.creationTimestamp || 0).getTime();
        const timeB = new Date(b?.metadata?.creationTimestamp || 0).getTime();
        return timeB - timeA;
      });
  }, [pdbs, keyword]);

  return (
    <>
      <PageDetailSection
        title="Pod中断保护 (PDB)"
        toolbarLeft={
          <Space>
            <Select
              allowClear
              placeholder="命名空间"
              value={nsValue}
              onChange={onNsChange}
              style={{ width: 150 }}
              showSearch
              optionFilterProp="label"
              options={namespacesOptions.map((ns) => ({ label: ns, value: ns }))}
            />
          </Space>
        }
        toolbarRight={
          <Space>
            {selectedKeys.length > 0 && (
              <Button
                danger
                icon={<DeleteOutlined />}
                onClick={handleBatchDelete}
              >
                批量删除 ({selectedKeys.length})
              </Button>
            )}
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => setCreateModalVisible(true)}
            >
              创建保护规则
            </Button>
            <Button
              icon={<ReloadOutlined />}
              onClick={() => onRefresh(true)}
              loading={loading}
            >
              刷新
            </Button>
            <TableColumnSettingsButton
              allColumns={allColumns}
              settingsKey="harvester_pdb_table"
            />
          </Space>
        }
      >
        <Table
          rowKey={(record) => `${record.metadata.namespace}/${record.metadata.name}`}
          columns={tableColumns}
          dataSource={filteredData}
          loading={loading}
          pagination={{
            showSizeChanger: true,
            showQuickJumper: true,
            showTotal: (total) => `共 ${total} 条`,
            defaultPageSize: 20,
          }}
          scroll={{ x: 1200 }}
          size="small"
          rowSelection={{
            selectedRowKeys: selectedKeys,
            onChange: (keys) => setSelectedKeys(keys),
          }}
        />
      </PageDetailSection>

      {/* PDB 详情抽屉 */}
      <PDBDetailDrawer
        pdb={currentPDB}
        visible={detailVisible}
        cloudId={cloudId}
        onClose={() => {
          setDetailVisible(false);
          setCurrentPDB(null);
        }}
      />

      {/* 创建 PDB 模态框 */}
      <Modal
        title={
          <Space>
            <SafetyOutlined />
            创建 Pod 中断保护规则
          </Space>
        }
        open={createModalVisible}
        onCancel={() => setCreateModalVisible(false)}
        footer={null}
        width={720}
        destroyOnClose
      >
        <PDBForm
          cloudId={cloudId}
          namespacesOptions={namespacesOptions}
          onSuccess={() => {
            setCreateModalVisible(false);
            onRefresh(true);
          }}
          onCancel={() => setCreateModalVisible(false)}
          defaultNamespace={nsValue}
        />
      </Modal>
    </>
  );
};

export default PDBSection;
