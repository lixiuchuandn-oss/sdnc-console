/**
 * ==============================================================================
 * 模块名称: NetworkPolicy 网络策略管理视图 (NetworkPoliciesSection)
 * 文件路径: frontend/src/pages/cnmc/clouds/Harvester/containers/sections/NetworkPoliciesSection.tsx
 * ==============================================================================
 * 
 * [功能描述]
 * 该组件负责展示和管理 Kubernetes NetworkPolicy 资源，包括：
 * 1. NetworkPolicy 列表展示
 * 2. NetworkPolicy 详情查看
 * 3. NetworkPolicy 删除
 * 4. 命名空间筛选
 * 
 * [核心逻辑]
 * NetworkPolicy 用于控制 Pod 之间的网络流量，定义入站和出站规则。
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
} from 'antd';
import { SafetyCertificateOutlined, SearchOutlined, EllipsisOutlined, ReloadOutlined, EditTwoTone, EyeOutlined } from '@ant-design/icons';
import yaml from 'js-yaml';
import PageDetailSection from '../../../../../../components/PageDetailSection';
import ResourceActionsDropdown from '../../../../../../components/ResourceActionsDropdown';
import { useTableColumnSettings } from '../../../../../../hooks/useTableColumnSettings';
import TableColumnSettingsButton from '../../../../../../components/TableColumnSettingsButton';
import YamlEditor from '../../../../../../components/YamlEditor';
import {
  fetchNetworkPolicyDetail,
  deleteNetworkPolicy,
  patchHarvesterContainerResource,
} from '../../../../../../services/harvesterApi';
import { isSystemResource, getSystemResourceProtectionHint } from '../../../../../../utils/harvesterUtils';
import NetworkPolicyFormModal from '../components/NetworkPolicyFormModal';

type Props = {
  networkPolicies: any[];
  loading: boolean;
  namespacesOptions: string[];
  cloudId: string;
  nsValue?: string;
  onNsChange: (v?: string) => void;
  onRefresh: (force?: boolean) => void;
  createDefaultNamespace?: string;
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
 * 格式化 Pod 选择器
 */
const formatPodSelector = (selector: any): React.ReactNode => {
  if (!selector) return <span style={{ color: '#999' }}>-</span>;
  
  const matchLabels = selector.matchLabels || {};
  const entries = Object.entries(matchLabels);
  
  if (entries.length === 0) {
    // 空选择器表示选择所有 Pod
    if (Object.keys(selector).length === 0 || (selector.matchLabels && entries.length === 0)) {
      return <Tag color="blue">所有 Pod</Tag>;
    }
    return <span style={{ color: '#999' }}>-</span>;
  }
  
  // 渲染带样式的标签内容（用于 Tooltip）
  const renderStyledLabel = (k: string, v: string) => (
    <span>
      <span style={{ fontWeight: 600, color: '#1890ff' }}>{k}</span>
      <span style={{ color: '#bfbfbf', margin: '0 2px' }}>=</span>
      <span style={{ color: '#52c41a' }}>{v}</span>
    </span>
  );
  
  // 单个标签
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
  
  // 多个标签
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
};

/**
 * 格式化策略类型
 */
const formatPolicyTypes = (policyTypes?: string[]): React.ReactNode => {
  if (!policyTypes || policyTypes.length === 0) {
    return <span style={{ color: '#999' }}>-</span>;
  }
  
  return (
    <Space size={4} wrap>
      {policyTypes.map((type) => {
        const isEgress = type === 'Egress';
        const isIngress = type === 'Ingress';
        const color = isEgress ? 'green' : isIngress ? 'blue' : 'default';
        return (
          <Tag key={type} color={color}>
            {isEgress ? '出站' : isIngress ? '入站' : type}
          </Tag>
        );
      })}
    </Space>
  );
};

/**
 * NetworkPolicy 详情抽屉组件
 */
const NetworkPolicyDetailDrawer: React.FC<{
  networkPolicy: any;
  visible: boolean;
  cloudId: string;
  onClose: () => void;
}> = ({ networkPolicy, visible, cloudId, onClose }) => {
  const [detail, setDetail] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  React.useEffect(() => {
    if (visible && networkPolicy) {
      setLoading(true);
      fetchNetworkPolicyDetail(cloudId, networkPolicy.metadata.namespace, networkPolicy.metadata.name, true)
        .then((res) => {
          setDetail(res?.data || networkPolicy);
        })
        .catch((e) => {
          console.error('获取 NetworkPolicy 详情失败:', e);
          setDetail(networkPolicy);
        })
        .finally(() => {
          setLoading(false);
        });
    }
  }, [visible, networkPolicy, cloudId]);

  if (!networkPolicy && !detail) return null;

  const data = detail || networkPolicy;
  const metadata = data?.metadata || {};
  const spec = data?.spec || {};

  // 统计规则数量
  const ingressRules = spec.ingress || [];
  const egressRules = spec.egress || [];

  return (
    <Drawer
      title={
        <Space>
          <SafetyCertificateOutlined />
          网络策略详情: {metadata.name}
        </Space>
      }
      placement="right"
      width={840}
      open={visible}
      onClose={onClose}
      loading={loading}
    >
      <Alert
        message="NetworkPolicy 用于控制 Pod 之间的网络流量，可以定义入站和出站规则来限制网络访问。"
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
      />
      
      <Descriptions column={2} bordered size="small">
        <Descriptions.Item label="名称">{metadata.name}</Descriptions.Item>
        <Descriptions.Item label="命名空间">{metadata.namespace}</Descriptions.Item>
        <Descriptions.Item label="运行时长">{calculateAge(metadata.creationTimestamp)}</Descriptions.Item>
        <Descriptions.Item label="策略类型">{formatPolicyTypes(spec.policyTypes)}</Descriptions.Item>
        
        <Descriptions.Item label="Pod 选择器" span={2}>
          {formatPodSelector(spec.podSelector)}
        </Descriptions.Item>
        
        <Descriptions.Item label="入站规则数">
          <Tag color="blue">{ingressRules.length}</Tag>
        </Descriptions.Item>
        <Descriptions.Item label="出站规则数">
          <Tag color="green">{egressRules.length}</Tag>
        </Descriptions.Item>
        
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
      
      {/* 入站规则详情 */}
      {ingressRules.length > 0 && (
        <>
          <div style={{ marginTop: 16, marginBottom: 8, fontWeight: 500 }}>入站规则 (Ingress)</div>
          <Table
            dataSource={ingressRules.flatMap((rule: any, ruleIdx: number) => {
              const from = rule.from || [];
              const ports = rule.ports || [];
              const portStr = ports.length === 0 
                ? '所有端口' 
                : ports.map((p: any) => `${p.protocol}/${p.port || 'all'}`).join(', ');
              
              if (from.length === 0) {
                return [{
                  key: `${ruleIdx}-all`,
                  type: '所有来源',
                  source: '-',
                  ports: portStr,
                }];
              }
              
              return from.map((peer: any, peerIdx: number) => {
                if (peer.podSelector) {
                  const labels = peer.podSelector.matchLabels || {};
                  const entries = Object.entries(labels);
                  return {
                    key: `${ruleIdx}-${peerIdx}`,
                    type: 'Pod 选择器',
                    typeColor: 'blue',
                    source: entries.length === 0 
                      ? '所有 Pod' 
                      : entries.map(([k, v]) => `${k}=${v}`).join(', '),
                    ports: portStr,
                  };
                }
                if (peer.namespaceSelector) {
                  const labels = peer.namespaceSelector.matchLabels || {};
                  const entries = Object.entries(labels);
                  return {
                    key: `${ruleIdx}-${peerIdx}`,
                    type: '命名空间选择器',
                    typeColor: 'green',
                    source: entries.length === 0 
                      ? '所有命名空间' 
                      : entries.map(([k, v]) => `${k}=${v}`).join(', '),
                    ports: portStr,
                  };
                }
                if (peer.ipBlock) {
                  return {
                    key: `${ruleIdx}-${peerIdx}`,
                    type: 'IP 地址块',
                    typeColor: 'orange',
                    source: peer.ipBlock.except 
                      ? `${peer.ipBlock.cidr} (排除: ${peer.ipBlock.except.join(', ')})`
                      : peer.ipBlock.cidr,
                    ports: portStr,
                  };
                }
                return {
                  key: `${ruleIdx}-${peerIdx}`,
                  type: '未知',
                  source: '-',
                  ports: portStr,
                };
              });
            })}
            pagination={false}
            columns={[
              {
                title: '类型',
                width: 140,
                render: (_: any, record: any) => (
                  <Tag color={record.typeColor}>{record.type}</Tag>
                ),
              },
              {
                title: '来源',
                width: 300,
                render: (_: any, record: any) => (
                  <span style={{ color: record.source === '所有 Pod' || record.source === '所有命名空间' ? '#999' : undefined }}>
                    {record.source}
                  </span>
                ),
              },
              {
                title: '端口',
                width: 150,
                dataIndex: 'ports',
              },
            ]}
          />
        </>
      )}
      
      {/* 出站规则详情 */}
      {egressRules.length > 0 && (
        <>
          <div style={{ marginTop: 16, marginBottom: 8, fontWeight: 500 }}>出站规则 (Egress)</div>
          <Table
            dataSource={egressRules.flatMap((rule: any, ruleIdx: number) => {
              const to = rule.to || [];
              const ports = rule.ports || [];
              const portStr = ports.length === 0 
                ? '所有端口' 
                : ports.map((p: any) => `${p.protocol}/${p.port || 'all'}`).join(', ');
              
              if (to.length === 0) {
                return [{
                  key: `${ruleIdx}-all`,
                  type: '所有目标',
                  target: '-',
                  ports: portStr,
                }];
              }
              
              return to.map((peer: any, peerIdx: number) => {
                if (peer.podSelector) {
                  const labels = peer.podSelector.matchLabels || {};
                  const entries = Object.entries(labels);
                  return {
                    key: `${ruleIdx}-${peerIdx}`,
                    type: 'Pod 选择器',
                    typeColor: 'blue',
                    target: entries.length === 0 
                      ? '所有 Pod' 
                      : entries.map(([k, v]) => `${k}=${v}`).join(', '),
                    ports: portStr,
                  };
                }
                if (peer.namespaceSelector) {
                  const labels = peer.namespaceSelector.matchLabels || {};
                  const entries = Object.entries(labels);
                  return {
                    key: `${ruleIdx}-${peerIdx}`,
                    type: '命名空间选择器',
                    typeColor: 'green',
                    target: entries.length === 0 
                      ? '所有命名空间' 
                      : entries.map(([k, v]) => `${k}=${v}`).join(', '),
                    ports: portStr,
                  };
                }
                if (peer.ipBlock) {
                  return {
                    key: `${ruleIdx}-${peerIdx}`,
                    type: 'IP 地址块',
                    typeColor: 'orange',
                    target: peer.ipBlock.except 
                      ? `${peer.ipBlock.cidr} (排除: ${peer.ipBlock.except.join(', ')})`
                      : peer.ipBlock.cidr,
                    ports: portStr,
                  };
                }
                return {
                  key: `${ruleIdx}-${peerIdx}`,
                  type: '未知',
                  target: '-',
                  ports: portStr,
                };
              });
            })}
            pagination={false}
            columns={[
              {
                title: '类型',
                width: 140,
                render: (_: any, record: any) => (
                  <Tag color={record.typeColor}>{record.type}</Tag>
                ),
              },
              {
                title: '目标',
                width: 300,
                render: (_: any, record: any) => (
                  <span style={{ color: record.target === '所有 Pod' || record.target === '所有命名空间' ? '#999' : undefined }}>
                    {record.target}
                  </span>
                ),
              },
              {
                title: '端口',
                width: 150,
                dataIndex: 'ports',
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
const NetworkPoliciesSection: React.FC<Props> = ({
  networkPolicies,
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
  const [keyword, setKeyword] = useState('');
  const [selectedKeys, setSelectedKeys] = useState<React.Key[]>([]);
  const [detailVisible, setDetailVisible] = useState(false);
  const [currentNetworkPolicy, setCurrentNetworkPolicy] = useState<any>(null);
  const [createModalVisible, setCreateModalVisible] = useState(false);
  const [editModalVisible, setEditModalVisible] = useState(false);
  const [editingRecord, setEditingRecord] = useState<any>(null);
  
  // 双轨制：别名编辑相关状态
  const [aliasModalVisible, setAliasModalVisible] = useState(false);
  const [aliasRecord, setAliasRecord] = useState<any>(null);
  const [aliasSubmitting, setAliasSubmitting] = useState(false);
  const [aliasForm] = Form.useForm<{ alias?: string }>();
  
  // YAML 查看相关状态
  const [yamlModalVisible, setYamlModalVisible] = useState(false);
  const [yamlContent, setYamlContent] = useState('');
  
  // apiPath 用于 PATCH 请求
  const apiPath = '/apis/networking.k8s.io/v1/networkpolicies';
  
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
    
    modal.confirm({
      title: '确认删除',
      content: (
        <div>
          <p>确定要删除此网络策略吗？</p>
          <p>
            <strong>名称:</strong> {name}
          </p>
          <p>
            <strong>命名空间:</strong> {namespace}
          </p>
          <Alert
            message="删除网络策略可能会影响 Pod 之间的网络访问控制"
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
          await deleteNetworkPolicy(cloudId, namespace, name);
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
      message.warning('请先选择要删除的网络策略');
      return;
    }

    modal.confirm({
      title: '批量删除确认',
      content: (
        <div>
          <p>确定要删除选中的 {selectedKeys.length} 个网络策略吗？</p>
          <Alert
            message="删除网络策略可能会影响 Pod 之间的网络访问控制"
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
          return deleteNetworkPolicy(cloudId, ns, name);
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
      width: 180,
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
                setCurrentNetworkPolicy(record);
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
      width: 200,
      ellipsis: true,
      render: (id: string) => <span style={{ color: '#888', fontSize: 12 }}>{id}</span>,
    },
    {
      title: '命名空间',
      dataIndex: ['metadata', 'namespace'],
      key: 'namespace',
      width: 120,
    },
    {
      title: 'Pod 选择器',
      key: 'podSelector',
      width: 180,
      render: (_: any, record: any) => formatPodSelector(record?.spec?.podSelector),
    },
    {
      title: '入站规则',
      key: 'ingressCount',
      width: 100,
      render: (_: any, record: any) => {
        const count = record?.spec?.ingress?.length || 0;
        return <Tag color="blue">{count}</Tag>;
      },
    },
    {
      title: '出站规则',
      key: 'egressCount',
      width: 100,
      render: (_: any, record: any) => {
        const count = record?.spec?.egress?.length || 0;
        return <Tag color="green">{count}</Tag>;
      },
    },
    {
      title: '策略类型',
      key: 'policyTypes',
      width: 140,
      render: (_: any, record: any) => formatPolicyTypes(record?.spec?.policyTypes),
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
      render: (_: any, record: any) => {
        const isSystem = isSystemResource(record);
        const systemHint = getSystemResourceProtectionHint(record);
        return (
          <ResourceActionsDropdown
            items={[
              {
                key: 'detail',
                label: '查看详情',
                onClick: () => {
                  setCurrentNetworkPolicy(record);
                  setDetailVisible(true);
                },
              },
              {
                key: 'edit',
                label: '编辑',
                disabled: isSystem,
                tooltip: systemHint,
                onClick: () => {
                  setEditingRecord(record);
                  setEditModalVisible(true);
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
                disabled: isSystem,
                tooltip: systemHint,
                onClick: () => handleDelete(record),
              },
            ]}
            buttonProps={{ className: 'row-actions-trigger' }}
          />
        );
      },
    },
  ], [handleDelete, handleViewYaml]);

  // 使用 hook 管理列设置
  const { displayColumns: tableColumns } = useTableColumnSettings(allColumns, 'harvester_networkpolicy_table');

  // 过滤数据
  const filteredData = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    return (networkPolicies || [])
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
  }, [networkPolicies, keyword, nsValue]);

  /**
   * 与 VmSection（云主机）/ SnapshotsSection（云盘快照）一致：含 fixed 列时不用 x: true；
   * 使用足够大的 scroll.x 像素下限，在租户控制台侧栏展开后主区域变窄时仍由表身横向滚动，避免裁切右侧列。
   */
  const networkPolicyTableScroll = useMemo(
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
              placeholder="名称/命名空间"
              suffix={<SearchOutlined style={{ color: 'rgba(0,0,0,.45)' }} />}
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
            />
            <Select
              className="toolbar-filter-sm"
              allowClear
              placeholder="筛选命名空间"
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
            <Button type="primary" onClick={() => setCreateModalVisible(true)}>
              创建策略
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
              settingsKey="harvester_networkpolicy_table"
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
            size: 'small',
            showTotal: (total) => `共 ${total} 条`,
          }}
          scroll={networkPolicyTableScroll}
          rowSelection={{
            selectedRowKeys: selectedKeys,
            onChange: (keys) => setSelectedKeys(keys),
          }}
        />
      </PageDetailSection>

      {/* NetworkPolicy 详情抽屉 */}
      <NetworkPolicyDetailDrawer
        networkPolicy={currentNetworkPolicy}
        visible={detailVisible}
        cloudId={cloudId}
        onClose={() => {
          setDetailVisible(false);
          setCurrentNetworkPolicy(null);
        }}
      />

      {/* 创建 NetworkPolicy 弹窗 */}
      <NetworkPolicyFormModal
        visible={createModalVisible}
        cloudId={cloudId}
        namespacesOptions={namespacesOptions}
        defaultNamespace={formDefaultNs}
        onSuccess={() => onRefresh(true)}
        onCancel={() => setCreateModalVisible(false)}
      />

      {/* 编辑 NetworkPolicy 弹窗 */}
      <NetworkPolicyFormModal
        visible={editModalVisible}
        mode="edit"
        initialData={editingRecord}
        cloudId={cloudId}
        namespacesOptions={namespacesOptions}
        defaultNamespace={formDefaultNs}
        onSuccess={() => {
          setEditModalVisible(false);
          setEditingRecord(null);
          onRefresh(true);
        }}
        onCancel={() => {
          setEditModalVisible(false);
          setEditingRecord(null);
        }}
      />

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

export default NetworkPoliciesSection;
