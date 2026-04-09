/**
 * Harvester - Ingress 路由列表 Section
 * 用于展示集群中的 Ingress 资源，
 * 将各条规则聚合为可读的“host -> path”描述，并支持关键字过滤与手动刷新。
 * 支持创建和删除 Ingress 资源。
 */
import React, { useMemo, useState, useCallback } from 'react';
import { Table, Tag, Button, message, Input, Modal } from 'antd';
import { ReloadOutlined, SearchOutlined, PlusOutlined } from '@ant-design/icons';
import PageDetailSection from '../../../../components/PageDetailSection';
import ResourceActionsDropdown from '../../../../components/ResourceActionsDropdown';
import { IngressFormModal, YamlEditModal } from '../containers/components';
import { deleteHarvesterIngress, fetchHarvesterIngressDetail, updateHarvesterIngress } from '../../../../services/harvesterApi';

/**
 * 格式化时间 - 将 UTC 时间转换为本地时间显示
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
 * 组件入参说明
 * - cloudId: 当前云 ID（当前实现尚未直接使用，预留后续扩展）
 * - ingresses: Ingress 列表，可能为原始对象或带 rawData 的包装对象
 * - loading: 外部传入的加载状态
 * - onRefresh: 手动刷新回调，支持传入 force=true
 * - namespacesOptions: 命名空间选项列表
 * - secrets: Secret 列表（用于 TLS 配置）
 */
interface Props {
  cloudId: string;
  ingresses: any[];
  loading: boolean;
  onRefresh?: (force?: boolean) => void;
  namespacesOptions?: string[];
  secrets?: any[];
}

const IngressesSection: React.FC<Props> = ({ cloudId, ingresses, loading, onRefresh, namespacesOptions, secrets }) => {
  // 关键字搜索（名称 / 命名空间）
  const [keyword, setKeyword] = useState<string>('');
  
  // 创建/编辑弹窗状态
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editingRecord, setEditingRecord] = useState<any>(null);
  
  // YAML 编辑弹窗状态
  const [yamlModalOpen, setYamlModalOpen] = useState(false);
  const [yamlEditingRecord, setYamlEditingRecord] = useState<any>(null);

  // 删除 Ingress
  const handleDelete = async (record: any) => {
    try {
      await deleteHarvesterIngress(cloudId, record.namespace, record.name);
      message.success('删除成功');
      onRefresh?.(true);
    } catch (error: any) {
      message.error(`删除失败: ${error?.message || '未知错误'}`);
    }
  };
  
  // 编辑 Ingress
  const handleEdit = (record: any) => {
    setEditingRecord(record);
    setEditModalOpen(true);
  };
  
  // YAML 编辑
  const handleYamlEdit = (record: any) => {
    setYamlEditingRecord(record);
    setYamlModalOpen(true);
  };
  
  // 加载 YAML 内容
  const loadIngressYaml = useCallback(async () => {
    if (!yamlEditingRecord) return '';
    const response = await fetchHarvesterIngressDetail(cloudId, yamlEditingRecord.namespace, yamlEditingRecord.name);
    // 只返回 Ingress 对象本身，而不是完整 API 响应
    const ingressData = response?.data || response;
    // 过滤掉 managedFields，避免干扰用户编辑
    const cleanData = {
      ...ingressData,
      metadata: {
        ...ingressData?.metadata,
        managedFields: undefined,
      },
    };
    return JSON.stringify(cleanData, null, 2);
  }, [cloudId, yamlEditingRecord]);
  
  // 保存 YAML 内容
  const saveIngressYaml = useCallback(async (yaml: string) => {
    if (!yamlEditingRecord) return;
    const data = JSON.parse(yaml);
    await updateHarvesterIngress(cloudId, yamlEditingRecord.namespace, yamlEditingRecord.name, data);
  }, [cloudId, yamlEditingRecord]);

  /**
   * 将原始 Ingress 对象转换为表格可直接展示的数据结构
   * - 规则字段会拼接为 “host -> [path1, path2]” 格式的简要描述
   */
  const dataSource = useMemo(() => {
    return (ingresses || []).map((i: any) => {
      const raw = i.rawData || i;
      const rules = raw.spec?.rules || [];
      const ruleDesc = rules.map((r: any) => {
        const host = r.host || '*';
        const paths = (r.http?.paths || []).map((p: any) => p.path).join(', ');
        return `${host} -> [${paths}]`;
      }).join('; ');

      return {
        key: raw.metadata?.uid || i.id,
        name: raw.metadata?.name || i.name,
        namespace: raw.metadata?.namespace || i.namespace,
        rules: ruleDesc,
        creationTimestamp: raw.metadata?.creationTimestamp || i.createdAt,
        raw,
      };
    });
  }, [ingresses]);

  /**
   * 简单关键字过滤逻辑
   * - 按名称或命名空间包含匹配
   */
  const filteredData = useMemo(() => {
    let d = dataSource;
    if (keyword) {
      const k = keyword.toLowerCase();
      d = d.filter((x: any) => x.name.toLowerCase().includes(k) || x.namespace.toLowerCase().includes(k));
    }
    return d;
  }, [dataSource, keyword]);

  /**
   * 表格列定义
   * - 规则列采用 ellipsis 展示，内容较长时不影响整体表格宽度
   * - 操作列当前仅提供删除占位（实际删除能力未开放）
   */
  const columns = [
    { title: '名称', dataIndex: 'name', key: 'name' },
    { title: '命名空间', dataIndex: 'namespace', key: 'namespace' },
    { title: '规则', dataIndex: 'rules', key: 'rules', ellipsis: true },
    { title: '创建时间', dataIndex: 'creationTimestamp', key: 'creationTimestamp', render: formatTime, sorter: (a: any, b: any) => new Date(a?.creationTimestamp || 0).getTime() - new Date(b?.creationTimestamp || 0).getTime(), defaultSortOrder: 'descend' as const },
    {
      title: '操作',
      key: 'action',
      width: 80,
      align: 'left' as const,
      fixed: 'right' as const,
      render: (_: any, record: any) => (
        <ResourceActionsDropdown 
          buttonProps={{ className: 'row-actions-trigger' }}
          items={[
            { 
              key: 'edit', 
              label: '编辑',
              onClick: () => handleEdit(record),
            },
            { 
              key: 'yaml', 
              label: 'YAML 编辑',
              onClick: () => handleYamlEdit(record),
            },
            { 
              key: 'delete', 
              label: '删除', 
              danger: true, 
              onClick: () => {
                Modal.confirm({
                  title: '确认删除',
                  content: `确定要删除 Ingress "${record.name}" 吗？`,
                  okText: '删除',
                  okType: 'danger',
                  cancelText: '取消',
                  onOk: () => handleDelete(record),
                });
              }
            }
          ]}
        />
      ),
    },
  ];

  return (
    <PageDetailSection
      asCard={false}
      toolbarLeft={(
        <>
          <Input
            className="toolbar-search"
            placeholder="关键字"
            suffix={<SearchOutlined style={{ color: 'rgba(0,0,0,.45)' }} />}
            value={keyword}
            onChange={e => setKeyword(e.target.value)}
            allowClear
          />
          <button
            type="button"
            className="toolbar-reset-btn"
            onClick={() => {
              setKeyword('');
            }}
          >
            重置
          </button>
        </>
      )}
      toolbarRight={
        <div className="toolbar-actions">
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => setCreateModalOpen(true)}
          >
            创建
          </Button>
          <Button icon={<ReloadOutlined />} onClick={() => onRefresh?.(true)} loading={loading}>刷新</Button>
        </div>
      }
    >
      <Table
        className="std-table"
        bordered
        dataSource={filteredData}
        columns={columns}
        rowKey="key"
        loading={loading}
        pagination={{
          size: 'small',
          showQuickJumper: false,
        }}
      />
      
      {/* 创建 Ingress 弹窗 */}
      <IngressFormModal
        visible={createModalOpen}
        cloudId={cloudId}
        namespacesOptions={namespacesOptions || []}
        secrets={secrets}
        onSuccess={() => {
          setCreateModalOpen(false);
          onRefresh?.(true);
        }}
        onCancel={() => setCreateModalOpen(false)}
      />
      
      {/* 编辑 Ingress 弹窗 */}
      <IngressFormModal
        visible={editModalOpen}
        cloudId={cloudId}
        namespacesOptions={namespacesOptions || []}
        secrets={secrets}
        editMode={true}
        initialData={editingRecord?.raw}
        onSuccess={() => {
          setEditModalOpen(false);
          setEditingRecord(null);
          onRefresh?.(true);
        }}
        onCancel={() => {
          setEditModalOpen(false);
          setEditingRecord(null);
        }}
      />
      
      {/* YAML 编辑弹窗 */}
      <YamlEditModal
        visible={yamlModalOpen}
        title={`YAML 编辑 - Ingress/${yamlEditingRecord?.namespace}/${yamlEditingRecord?.name}`}
        cloudId={cloudId}
        namespace={yamlEditingRecord?.namespace}
        name={yamlEditingRecord?.name}
        resourceType="ingress"
        onLoadYaml={loadIngressYaml}
        onSaveYaml={saveIngressYaml}
        onCancel={() => {
          setYamlModalOpen(false);
          setYamlEditingRecord(null);
        }}
        onSuccess={() => {
          setYamlModalOpen(false);
          setYamlEditingRecord(null);
          onRefresh?.(true);
        }}
      />
    </PageDetailSection>
  );
};

export default IngressesSection;
