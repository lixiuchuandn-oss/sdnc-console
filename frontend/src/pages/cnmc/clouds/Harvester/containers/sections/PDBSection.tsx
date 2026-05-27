/**
 * ==============================================================================
 * 模块名称: PodDisruptionBudget 管理视图 (PDBSection)
 * 文件路径: frontend/src/pages/cnmc/clouds/Harvester/containers/sections/PDBSection.tsx
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
  Input,
  Dropdown,
  Form,
  Switch,
} from 'antd';
import { SafetyOutlined, SearchOutlined, EllipsisOutlined, ReloadOutlined, EditTwoTone, EyeOutlined } from '@ant-design/icons';
import yaml from 'js-yaml';
import PageDetailSection from '../../../../../../components/PageDetailSection';
import ResourceActionsDropdown from '../../../../../../components/ResourceActionsDropdown';
import { useTableColumnSettings } from '../../../../../../hooks/useTableColumnSettings';
import TableColumnSettingsButton from '../../../../../../components/TableColumnSettingsButton';
import YamlEditor from '../../../../../../components/YamlEditor';
import {
  fetchHarvesterPDBDetail,
  deleteHarvesterPDB,
  patchHarvesterContainerResource,
} from '../../../../../../services/harvesterApi';
import { isSystemResource, getSystemResourceProtectionHint } from '../../../../../../utils/harvesterUtils';
import { PDBForm } from '../components';

type Props = {
  pdbs: any[];
  loading: boolean;
  namespacesOptions: string[];
  cloudId: string;
  nsValue?: string;
  onNsChange: (v?: string) => void;
  onRefresh: (force?: boolean) => void;
  createDefaultNamespace?: string;
  showAllSwitch?: boolean;
  queryAll?: boolean;
  onQueryAllChange?: (checked: boolean) => void;
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
        <Descriptions.Item label="项目">{metadata.namespace}</Descriptions.Item>
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
            dataSource={status.conditions.map((c: any, i: number) => ({ ...c, key: i }))}
            pagination={false}
            columns={[
              { 
                title: '类型', 
                dataIndex: 'type', 
                render: (v: string) => formatConditionType(v),
              },
              { 
                title: '状态', 
                dataIndex: 'status', 
                render: (v: string) => (
                  <Tag color={v === 'True' ? 'green' : 'red'}>{v}</Tag>
                )
              },
              { 
                title: '原因', 
                dataIndex: 'reason', 
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
  createDefaultNamespace,
  showAllSwitch,
  queryAll,
  onQueryAllChange,
}) => {
  const formDefaultNs = createDefaultNamespace ?? nsValue ?? 'default';
  const { modal, message } = App.useApp();
  const [keyword, setKeyword] = useState('');
  const [selectedKeys, setSelectedKeys] = useState<React.Key[]>([]);
  const [detailVisible, setDetailVisible] = useState(false);
  const [currentPDB, setCurrentPDB] = useState<any>(null);
  const [createModalVisible, setCreateModalVisible] = useState(false);
  
  // 双轨制：别名编辑相关状态
  const [aliasModalVisible, setAliasModalVisible] = useState(false);
  const [aliasRecord, setAliasRecord] = useState<any>(null);
  const [aliasSubmitting, setAliasSubmitting] = useState(false);
  const [aliasForm] = Form.useForm<{ alias?: string }>();
  
  // YAML 查看相关状态
  const [yamlModalVisible, setYamlModalVisible] = useState(false);
  const [yamlContent, setYamlContent] = useState('');
  
  // apiPath 用于 PATCH 请求
  const apiPath = '/apis/policy/v1/poddisruptionbudgets';
  
  // 别名编辑 Modal 打开
  const handleOpenAliasModal = useCallback((record: any) => {
    const currentAlias = record?.metadata?.annotations?.['tower.io/alias'] || '';
    setAliasRecord(record);
    setAliasModalVisible(true);
    aliasForm.setFieldsValue({ alias: String(currentAlias || '') });
  }, [aliasForm]);
  
  // 别名提交
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
      await patchHarvesterContainerResource(cloudId, apiPath, ns, name, patchBody);
      message.success(next ? '名称修改成功' : '已清空别名');
      setAliasModalVisible(false);
      setAliasRecord(null);
      aliasForm.resetFields();
      onRefresh(true);
      return true;
    } catch (e: any) {
      console.error(e);
      message.error(e?.message || '名称修改失败');
      return false;
    } finally {
      setAliasSubmitting(false);
    }
  }, [aliasRecord, apiPath, cloudId, message, onRefresh, aliasForm]);
  
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

  // 删除处理
  const handleDelete = useCallback((record: any) => {
    const name = record?.metadata?.name;
    const namespace = record?.metadata?.namespace;
    const alias = record?.metadata?.annotations?.['tower.io/alias'];
    const displayName = alias ? `${alias} (${name})` : name;
    
    modal.confirm({
      title: '确认删除',
      content: (
        <div>
          <p>确定要删除 Pod 中断保护规则 "{displayName}" 吗？</p>
          <p>
            <strong>项目:</strong> {namespace}
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
      key: 'name',
      fixed: 'left' as const,
      ellipsis: true,
      render: (_: any, record: any) => {
        const alias = record?.metadata?.annotations?.['tower.io/alias'];
        const id = record?.metadata?.name || '';
        const hasAlias = !!alias;
        
        return (
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Button
              type="link"
              size="small"
              onClick={() => {
                setCurrentPDB(record);
                setDetailVisible(true);
              }}
            >
              {hasAlias ? alias : id}
            </Button>
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
    },
    {
      title: '选择器',
      key: 'selector',
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
      render: (_: any, record: any) => (
        <Tag color="blue">{formatIntOrString(record?.spec?.minAvailable)}</Tag>
      ),
    },
    {
      title: '最大不可用',
      key: 'maxUnavailable',
      render: (_: any, record: any) => (
        <Tag color="orange">{formatIntOrString(record?.spec?.maxUnavailable)}</Tag>
      ),
    },
    {
      title: '状态',
      key: 'status',
      render: (_: any, record: any) => renderPDBStatus(record),
    },
    {
      title: '健康状态',
      key: 'healthy',
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
      width: 180,
      render: formatTime,
    },
    {
      title: '操作',
      key: 'actions',
      fixed: 'right' as const,
      render: (_: any, record: any) => (
        <ResourceActionsDropdown
          items={[
            {
              key: 'detail',
              label: '查看详情',
              onClick: () => {
                setCurrentPDB(record);
                setDetailVisible(true);
              },
            },
            {
              key: 'yaml',
              label: '查看 YAML',
              onClick: () => handleViewYaml(record),
            },
            {
              key: 'delete',
              label: '删除',
              danger: true,
              disabled: isSystemResource(record),
              tooltip: getSystemResourceProtectionHint(record),
              onClick: () => handleDelete(record),
            },
          ]}
          buttonProps={{ className: 'row-actions-trigger' }}
        />
      ),
    },
  ], [handleDelete, handleViewYaml]);

  // 使用 hook 管理列设置
  const { displayColumns: tableColumns } = useTableColumnSettings(allColumns, 'harvester_pdb_table');

  // 过滤数据
  const filteredData = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    return (pdbs || [])
      .filter((item: any) => {
        if (nsValue && item?.metadata?.namespace !== nsValue) return false;
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
  }, [pdbs, keyword, nsValue]);

  /**
   * 与 VmSection（云主机）/ SnapshotsSection（云盘快照）一致：含 fixed 列时不用 x: true；
   * 使用足够大的 scroll.x 像素下限，在租户控制台侧栏展开后主区域变窄时仍由表身横向滚动，避免裁切右侧列。
   */
  const pdbTableScroll = useMemo(
    () => (filteredData.length > 0 ? ({ x: 2400 } as const) : undefined),
    [filteredData.length],
  );

  return (
    <>
      <PageDetailSection asCard={false}>
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
              allowClear
              placeholder="筛选项目"
              value={nsValue || undefined}
              onChange={onNsChange}
              showSearch
              optionFilterProp="label"
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
            <Button type="primary" onClick={() => setCreateModalVisible(true)}>
              创建保护规则
            </Button>
            <Dropdown
              menu={{
                items: [
                  {
                    key: 'batchDelete',
                    label:
                      selectedKeys.length > 0
                        ? `批量删除 (${selectedKeys.length})`
                        : '批量删除',
                    danger: true,
                    disabled: selectedKeys.length === 0,
                  },
                ],
                onClick: ({ key }) => {
                  if (key === 'batchDelete') handleBatchDelete();
                },
              }}
              trigger={['click']}
              disabled={selectedKeys.length === 0}
            >
              <Button icon={<EllipsisOutlined />} disabled={selectedKeys.length === 0} />
            </Dropdown>
            <TableColumnSettingsButton
              allColumns={allColumns}
              settingsKey="harvester_pdb_table"
            />
            <Tooltip title="刷新">
              <Button
                type="default"
                icon={<ReloadOutlined />}
                onClick={() => onRefresh(true)}
                loading={loading}
              />
            </Tooltip>
          </div>
        </div>
        <Table
          className="std-table"
          bordered={false}
          rowKey={(record) => `${record.metadata.namespace}/${record.metadata.name}`}
          columns={tableColumns}
          dataSource={filteredData}
          loading={loading}
          pagination={{
            showTotal: (total) => `共 ${total} 条`,
          }}
          scroll={pdbTableScroll}
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
          defaultNamespace={formDefaultNs}
        />
      </Modal>

      {/* 别名编辑 Modal */}
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

      {/* YAML 查看 Modal */}
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
    </>
  );
};

export default PDBSection;
