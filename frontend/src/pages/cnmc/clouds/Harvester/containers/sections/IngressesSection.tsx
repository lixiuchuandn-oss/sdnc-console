/**
 * Harvester - Ingress 路由列表 Section
 * 用于展示集群中的 Ingress 资源，
 * 将各条规则聚合为可读的“host -> path”描述，并支持关键字过滤与手动刷新。
 * 支持创建和删除 Ingress 资源。
 */
import React, { useMemo, useState, useCallback } from 'react';
import { Table, Tag, Button, message, Input, Modal, Select, App, Form, Tooltip, Switch } from 'antd';
import { ReloadOutlined, SearchOutlined, PlusOutlined, EditTwoTone } from '@ant-design/icons';
import yaml from 'js-yaml';
import PageDetailSection from '../../../../../../components/PageDetailSection';
import ResourceActionsDropdown from '../../../../../../components/ResourceActionsDropdown';
import YamlEditor from '../../../../../../components/YamlEditor';
import { IngressFormModal, YamlEditModal } from '../components';
import { deleteHarvesterIngress, fetchHarvesterIngressDetail, updateHarvesterIngress, patchHarvesterContainerResource } from '../../../../../../services/harvesterApi';
import { isSystemResource, getSystemResourceProtectionHint } from '../../../../../../utils/harvesterUtils';

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
  nsValue?: string;
  onNsChange?: (v?: string) => void;
  secrets?: any[];
  services?: any[];
  createDefaultNamespace?: string;
  showAllSwitch?: boolean;
  queryAll?: boolean;
  onQueryAllChange?: (checked: boolean) => void;
}

const IngressesSection: React.FC<Props> = ({
  cloudId,
  ingresses,
  loading,
  onRefresh,
  namespacesOptions,
  nsValue,
  onNsChange,
  secrets,
  services,
  createDefaultNamespace,
  showAllSwitch,
  queryAll,
  onQueryAllChange,
}) => {
  const { message: antMessage } = App.useApp();
  const [aliasForm] = Form.useForm<{ alias?: string }>();
  const formDefaultNs = createDefaultNamespace ?? nsValue ?? 'default';
  // 关键字搜索（名称 / 命名空间）
  const [keyword, setKeyword] = useState<string>('');

  // 别名编辑相关状态
  const [aliasModalVisible, setAliasModalVisible] = useState(false);
  const [aliasRecord, setAliasRecord] = useState<any>(null);
  const [aliasSubmitting, setAliasSubmitting] = useState(false);

  // YAML 查看相关状态
  const [yamlViewModalVisible, setYamlViewModalVisible] = useState(false);
  const [yamlViewContent, setYamlViewContent] = useState('');

  const apiPath = '/apis/networking.k8s.io/v1/ingresses';

  // 别名编辑 - 打开弹窗
  const handleOpenAliasModal = useCallback((record: any) => {
    const currentAlias = record?.metadata?.annotations?.['tower.io/alias'] || '';
    setAliasRecord(record);
    setAliasModalVisible(true);
    aliasForm.setFieldsValue({ alias: String(currentAlias || '') });
  }, [aliasForm]);

  // 别名编辑 - 提交
  const handleSubmitAlias = useCallback(async (nextAliasRaw?: string) => {
    if (!aliasRecord) return false;
    const ns = aliasRecord?.metadata?.namespace;
    const name = aliasRecord?.metadata?.name;
    if (!ns || !name) {
      antMessage.error('未能解析资源命名空间或名称');
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
      antMessage.success(next ? '名称修改成功' : '已清空别名');
      setAliasModalVisible(false);
      setAliasRecord(null);
      aliasForm.resetFields();
      onRefresh?.(true);
      return true;
    } catch (e: any) {
      console.error(e);
      antMessage.error(e?.message || '名称修改失败');
      return false;
    } finally {
      setAliasSubmitting(false);
    }
  }, [aliasRecord, apiPath, cloudId, antMessage, onRefresh, aliasForm]);

  // 查看 YAML
  const handleViewYaml = useCallback((record: any) => {
    try {
      const yamlStr = yaml.dump(record, { indent: 2, lineWidth: -1, noRefs: true });
      setYamlViewContent(yamlStr);
      setYamlViewModalVisible(true);
    } catch (e: any) {
      antMessage.error('生成 YAML 失败: ' + e.message);
    }
  }, [antMessage]);
  
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
   * - 规则字段会拼接为 "host -> [path1, path2]" 格式的简要描述
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
        metadata: raw.metadata,
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
    if (nsValue) {
      d = d.filter((x: any) => x.namespace === nsValue);
    }
    if (keyword) {
      const k = keyword.toLowerCase();
      d = d.filter((x: any) => x.name.toLowerCase().includes(k) || x.namespace.toLowerCase().includes(k));
    }
    return d;
  }, [dataSource, keyword, nsValue]);

  /**
   * 表格列定义
   * - 规则列采用 ellipsis 展示，内容较长时不影响整体表格宽度
   * - 操作列当前仅提供删除占位（实际删除能力未开放）
   */
  const columns = [
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
    { title: '项目', dataIndex: 'namespace', key: 'namespace', ellipsis: true, render: (ns: string) => <Tag>{ns}</Tag> },
    { title: '规则', dataIndex: 'rules', key: 'rules', ellipsis: true },
    { title: '创建时间', dataIndex: 'creationTimestamp', key: 'creationTimestamp', render: formatTime, sorter: (a: any, b: any) => new Date(a?.creationTimestamp || 0).getTime() - new Date(b?.creationTimestamp || 0).getTime(), defaultSortOrder: 'descend' as const },
    {
      title: '操作',
      key: 'action',
      align: 'left' as const,
      fixed: 'right' as const,
      render: (_: any, record: any) => {
        const isSystem = isSystemResource(record.raw);
        const systemHint = getSystemResourceProtectionHint(record.raw);
        return (
          <ResourceActionsDropdown
            buttonProps={{ className: 'row-actions-trigger' }}
            items={[
              {
                key: 'edit',
                label: '编辑',
                disabled: isSystem,
                tooltip: systemHint,
                onClick: () => handleEdit(record),
              },
              {
                key: 'yaml',
                label: '查看 YAML',
                onClick: () => handleViewYaml(record.raw),
              },
              {
                key: 'delete',
                label: '删除',
                danger: true,
                disabled: isSystem,
                tooltip: systemHint,
                onClick: () => {
                  const alias = record?.metadata?.annotations?.['tower.io/alias'];
                  const id = record?.metadata?.name || '';
                  const displayName = alias ? `${alias}(${id})` : id;
                  Modal.confirm({
                    title: '确认删除',
                    content: `确定要删除 Ingress "${displayName}" 吗？`,
                    okText: '删除',
                    okType: 'danger',
                    cancelText: '取消',
                    onOk: () => handleDelete(record),
                  });
                }
              }
            ]}
          />
        );
      },
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
          <Select
            allowClear
            showSearch
            optionFilterProp="label"
            placeholder="筛选项目"
            value={nsValue || undefined}
            onChange={(v) => onNsChange?.(v)}
            options={(namespacesOptions || []).map((ns) => ({ label: ns, value: ns }))}
            className="toolbar-filter-sm"
          />
          <button
            type="button"
            className="toolbar-reset-btn"
            onClick={() => {
              setKeyword('');
              onNsChange?.(undefined);
            }}
          >
            重置
          </button>
        </>
      )}
      toolbarRight={
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
        scroll={{ x: true }}
        bordered={false}
        dataSource={filteredData}
        columns={columns}
        rowKey="key"
        loading={loading}
        pagination={{
          showQuickJumper: false,
        }}
      />
      
      {/* 创建 Ingress 弹窗 */}
      <IngressFormModal
        visible={createModalOpen}
        cloudId={cloudId}
        namespacesOptions={namespacesOptions || []}
        secrets={secrets}
        services={services}
        defaultNamespace={formDefaultNs}
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
        services={services}
        defaultNamespace={formDefaultNs}
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
        open={yamlViewModalVisible}
        onCancel={() => setYamlViewModalVisible(false)}
        footer={null}
        width={800}
      >
        <YamlEditor
          value={yamlViewContent}
          onChange={() => {}}
          maxHeight={500}
          readOnly
        />
      </Modal>
    </PageDetailSection>
  );
};

export default IngressesSection;
