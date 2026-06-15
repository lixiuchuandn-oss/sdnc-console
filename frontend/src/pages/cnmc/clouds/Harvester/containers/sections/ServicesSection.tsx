/**
 * Harvester · Kubernetes Service 列表与管理（容器业务域）
 *
 * 落位：`Harvester/containers/sections/`。Cloudmap 容器面板、控制台等由此引用。
 * 数据为 Kubernetes Service；命名空间筛选排除系统命名空间（与命名空间 Section 口径一致）。
 * 支持 `tower.io/alias` 双轨显示与 JSON Patch 更新别名。
 */
import React, { useMemo, useState, useCallback, useEffect } from 'react';
import { Table, Button, Input, Select, App, Modal, Form, Tooltip, Tag, Space, Switch } from 'antd';
import { ReloadOutlined, SearchOutlined, EditTwoTone } from '@ant-design/icons';
import yaml from 'js-yaml';
import PageDetailSection from '../../../../../../components/PageDetailSection';
import ResourceActionsDropdown from '../../../../../../components/ResourceActionsDropdown';
import WriteGuard from '../../../../../../components/WriteGuard';
import { useTableColumnSettings } from '../../../../../../hooks/useTableColumnSettings';
import TableColumnSettingsButton from '../../../../../../components/TableColumnSettingsButton';
import { useAuth } from '../../../../../../contexts/AuthContext';
import { hasContainerSubWritePermission } from '../../../../../../utils/permissionUtils';
import { filterMenuItemsForReadOnly } from '../../../../../../utils/rbacUi';
import HarvesterResourceDrawer from '../../shared/components/HarvesterOpsinfoDrawer';
import { ResourceLinkYamlDrawer } from '../../shared/components/ResourceLinkYamlDrawer';
import { useHarvesterPublicNamespaces } from '../../shared/context/HarvesterPublicNamespacesContext';
import {
  confirmHighRiskDelete,
  CONTAINER_DELETE_RISK_ITEMS,
} from '../../shared/lib/highRiskConfirm';
import {
  deleteHarvesterService,
  updateHarvesterService,
  patchHarvesterContainerResource,
} from '../../../../../../services/harvesterApi';
import ServiceFormDrawer from '../drawers/ServiceFormDrawer';
import {
  ServiceRelatedPodsDrawer,
  ServicePodDetailDrawer,
  ServicePodLogDrawer,
  ServicePodTerminalBridge,
} from '../drawers/ServicePodDrawers';
import {
  isSystemNamespace,
  isSystemResource,
  getSystemResourceProtectionHint,
} from '../../../../../../utils/harvesterUtils';
import {
  createContainerToolbarRefresh,
  runContainerSectionRefresh,
  type ContainerSectionOnRefresh,
} from '../lib/containerSectionRefresh';
import {
  isLocalRegistryManagedService,
  REGISTRY_MANAGED_SERVICE_HINT,
} from '../lib/registryManagedLocalRegistry';
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

/** Steve `links.view` 或 Core Service API 路径（与 HarvesterOpsinfoDrawer 中 Service 一致） */
function resolveServiceViewLink(row: any): string | undefined {
  const raw = row?.raw ?? row?.originalRecord?.rawData ?? row?.originalRecord;
  if (raw?.links?.view) return String(raw.links.view).trim();
  const ns = row?.namespace ?? raw?.metadata?.namespace;
  const name = row?.name ?? raw?.metadata?.name;
  if (!ns || !name) return undefined;
  return `/api/v1/namespaces/${encodeURIComponent(ns)}/services/${encodeURIComponent(name)}`;
}

/**
 * 组件入参说明
 * - cloudId: 当前云 ID，用于在详情抽屉中进一步读取事件等信息
 * - services: Service 列表，可能为原生对象或带 rawData 的包装对象
 * - loading: 外层传入的加载状态
 * - onRefresh: 手动刷新回调，支持 force=true
 * - namespacesOptions: 命名空间选项列表（组件内会剔除系统命名空间再用于筛选/创建）
 * - pods: Pod 列表，用于查看关联 Pod
 */
interface Props {
  cloudId: string;
  services: any[];
  loading: boolean;
  onRefresh?: ContainerSectionOnRefresh;
  isTenant?: boolean;
  namespacesOptions?: string[];
  nsValue?: string;
  onNsChange?: (v?: string) => void;
  pods?: any[];
  createDefaultNamespace?: string;
  showAllSwitch?: boolean;
  queryAll?: boolean;
  onQueryAllChange?: (checked: boolean) => void;
}

const ServicesSection: React.FC<Props> = ({
  cloudId,
  services,
  loading,
  onRefresh,
  isTenant,
  namespacesOptions,
  nsValue,
  onNsChange,
  pods,
  createDefaultNamespace,
  showAllSwitch,
  queryAll,
  onQueryAllChange,
}) => {
  const { user } = useAuth();
  const { isPublicNamespace } = useHarvesterPublicNamespaces();
  const hasContainersWrite = useMemo(
    () => hasContainerSubWritePermission((user?.permissions ?? []) as string[], 'services'),
    [user?.permissions],
  );

  /** 业务命名空间选项：去掉系统命名空间，供下拉与创建默认命名空间 */
  const namespacesOptionsBiz = useMemo(
    () => (namespacesOptions || []).filter((ns) => !isSystemNamespace(String(ns))),
    [namespacesOptions],
  );

  const formDefaultNs = useMemo(() => {
    const preferred = createDefaultNamespace ?? nsValue ?? 'default';
    if (preferred && !isSystemNamespace(String(preferred))) return preferred;
    return namespacesOptionsBiz[0] ?? 'default';
  }, [createDefaultNamespace, nsValue, namespacesOptionsBiz]);

  /** 当前筛选落在系统命名空间时清空（父级 state 可能来自历史 URL 等） */
  useEffect(() => {
    if (nsValue && isSystemNamespace(String(nsValue))) {
      onNsChange?.(undefined);
    }
  }, [nsValue, onNsChange]);
  const { message } = App.useApp();
  // 工具栏过滤及详情抽屉状态
  const [keyword, setKeyword] = useState<string>('');
  const [typeFilter, setTypeFilter] = useState<string>('');

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [selectedRecord, setSelectedRecord] = useState<any>(null);
  const [drawerActiveTab, setDrawerActiveTab] = useState('detail');

  /** 「查看 Pod」：独立抽屉（容器域 `ServiceRelatedPodsDrawer`），不经运维大抽屉 Tab */
  const [relatedPodsDrawerOpen, setRelatedPodsDrawerOpen] = useState(false);
  const [relatedPodsRow, setRelatedPodsRow] = useState<any>(null);

  // 创建/编辑弹窗状态
  const [serviceFormDrawerOpen, setServiceFormDrawerOpen] = useState(false);
  const [serviceFormDrawerMode, setServiceFormDrawerMode] = useState<'create' | 'edit'>('create');
  const [editingRecord, setEditingRecord] = useState<any>(null);

  /** Service YAML：仅「编辑 YAML」入口（ResourceLinkYamlDrawer） */
  const [serviceYamlDrawerOpen, setServiceYamlDrawerOpen] = useState(false);
  const [serviceYamlDrawerLink, setServiceYamlDrawerLink] = useState<string | undefined>(undefined);
  const [serviceYamlDrawerRecord, setServiceYamlDrawerRecord] = useState<any>(null);
  const [aliasModalVisible, setAliasModalVisible] = useState(false);
  const [aliasRecord, setAliasRecord] = useState<any>(null);
  const [aliasSubmitting, setAliasSubmitting] = useState(false);
  const [aliasForm] = Form.useForm<{ alias?: string }>();

  const apiPath = '/api/v1/services';

  // Pod 详情/日志/终端状态
  const [podDetailVisible, setPodDetailVisible] = useState(false);
  const [currentPod, setCurrentPod] = useState<any>(null);
  const [podLogVisible, setPodLogVisible] = useState(false);
  const [podLogContainers, setPodLogContainers] = useState<string[]>([]);
  const [podTerminalVisible, setPodTerminalVisible] = useState(false);
  const [podTerminalContainers, setPodTerminalContainers] = useState<string[]>([]);

  // 删除 Service
  const handleDelete = useCallback(
    async (record: any) => {
      const rawResource = record?.raw || record;
      if (isLocalRegistryManagedService(rawResource)) {
        message.warning(REGISTRY_MANAGED_SERVICE_HINT);
        return;
      }
      try {
        await deleteHarvesterService(cloudId, record.namespace, record.name);
        message.success('删除成功');
        runContainerSectionRefresh(onRefresh, { force: true });
      } catch (error: any) {
        message.error(`删除失败: ${error?.message || '未知错误'}`);
      }
    },
    [cloudId, message, onRefresh],
  );

  // 创建 / 编辑 Service（抽屉 · `containers/drawers/ServiceFormDrawer`）
  const handleEdit = useCallback(
    (record: any) => {
      const rawResource = record?.raw || record;
      if (isLocalRegistryManagedService(rawResource)) {
        message.warning(REGISTRY_MANAGED_SERVICE_HINT);
        return;
      }
      setServiceFormDrawerMode('edit');
      setEditingRecord(record);
      setServiceFormDrawerOpen(true);
    },
    [message],
  );

  const handleOpenCreateService = () => {
    setServiceFormDrawerMode('create');
    setEditingRecord(null);
    setServiceFormDrawerOpen(true);
  };

  const openServiceYamlDrawer = useCallback(
    (record: any) => {
      const link = resolveServiceViewLink(record);
      if (!link) {
        message.error('无法解析 Service 的 View Link');
        return;
      }
      setServiceYamlDrawerRecord(record);
      setServiceYamlDrawerLink(link);
      setServiceYamlDrawerOpen(true);
    },
    [message],
  );

  const _handleYamlEdit = useCallback(
    (record: any) => {
      openServiceYamlDrawer(record);
    },
    [openServiceYamlDrawer],
  );

  const handleServiceYamlDrawerSave = useCallback(
    async (yamlText: string) => {
      const rec = serviceYamlDrawerRecord;
      if (!rec?.namespace || !rec?.name) {
        throw new Error('未能解析 Service 命名空间或名称');
      }
      const rawResource = rec?.raw || rec;
      if (isLocalRegistryManagedService(rawResource)) {
        throw new Error(REGISTRY_MANAGED_SERVICE_HINT);
      }
      const parsed = yaml.load(yamlText) as Record<string, unknown>;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('无效的 Service 定义');
      }
      const meta = (parsed as { metadata?: Record<string, unknown> }).metadata;
      const clean = {
        ...parsed,
        metadata: meta
          ? {
              ...meta,
              managedFields: undefined,
            }
          : meta,
      };
      await updateHarvesterService(cloudId, rec.namespace, rec.name, clean);
      runContainerSectionRefresh(onRefresh, { force: true });
    },
    [serviceYamlDrawerRecord, cloudId, onRefresh],
  );

  // 打开别名编辑弹窗
  const handleOpenAliasModal = useCallback(
    (record: any) => {
      const currentAlias = record?.raw?.metadata?.annotations?.['tower.io/alias'] || '';
      setAliasRecord(record);
      setAliasModalVisible(true);
      aliasForm.setFieldsValue({ alias: String(currentAlias || '') });
    },
    [aliasForm],
  );

  // 提交别名修改
  const handleSubmitAlias = useCallback(
    async (nextAliasRaw?: string) => {
      if (!aliasRecord) return false;
      const ns = aliasRecord?.namespace;
      const name = aliasRecord?.name;
      if (!ns || !name) {
        message.error('未能解析资源命名空间或名称');
        return false;
      }

      const next = String(nextAliasRaw || '').trim();
      const prev = String(aliasRecord?.raw?.metadata?.annotations?.['tower.io/alias'] || '').trim();
      if (next === prev) {
        setAliasModalVisible(false);
        return true;
      }

      const hasAnnotations = !!aliasRecord?.raw?.metadata?.annotations;
      const hasPrev = !!aliasRecord?.raw?.metadata?.annotations?.['tower.io/alias'];
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

  // 打开别名编辑弹窗
  const handleViewPodDetail = useCallback((pod: any) => {
    setCurrentPod(pod);
    setPodDetailVisible(true);
  }, []);

  // Pod 日志
  const handleViewPodLog = useCallback((pod: any) => {
    const containerStatuses = pod?.status?.containerStatuses || [];
    const specContainers = pod?.spec?.containers || [];
    const containers =
      containerStatuses.length > 0
        ? containerStatuses.map((c: any) => c.name)
        : specContainers.map((c: any) => c.name);
    setCurrentPod(pod);
    setPodLogContainers(containers);
    setPodLogVisible(true);
  }, []);

  // Pod 终端
  const handleOpenPodTerminal = useCallback((pod: any) => {
    const containerStatuses = pod?.status?.containerStatuses || [];
    const specContainers = pod?.spec?.containers || [];
    const containers =
      containerStatuses.length > 0
        ? containerStatuses.map((c: any) => c.name)
        : specContainers.map((c: any) => c.name);
    setCurrentPod(pod);
    setPodTerminalContainers(containers);
    setPodTerminalVisible(true);
  }, []);

  const openRelatedPodsDrawer = useCallback((record: any) => {
    setRelatedPodsRow(record);
    setRelatedPodsDrawerOpen(true);
  }, []);

  /**
   * 将后端返回的 Service 数据统一转换为表格行
   * - 端口字段拼接为 "port:targetPort/protocol"
   * - 外部 IP 从 status.loadBalancer.ingress 提取
   */
  const dataSource = useMemo(() => {
    return (services || [])
      .filter((s: any) => {
        const raw = s.rawData || s;
        const namespace = raw.metadata?.namespace || s.namespace;
        return !isSystemNamespace(String(namespace || ''));
      })
      .map((s: any, index: number) => {
        const raw = s.rawData || s;
        const ports = (raw.spec?.ports || [])
          .map((p: any) => {
            return `${p.port}/${p.protocol}`;
          })
          .join(', ');
        const nodePorts =
          raw.spec?.type === 'NodePort'
            ? (raw.spec?.ports || [])
                .filter((p: any) => p.nodePort)
                .map((p: any) => p.nodePort)
                .join(', ')
            : '';
        const externalIPs = (raw.status?.loadBalancer?.ingress || [])
          .map((i: any) => i.ip || i.hostname)
          .join(', ');
        const name = raw.metadata?.name || s.name;
        const namespace = raw.metadata?.namespace || s.namespace;
        const uid = raw.metadata?.uid || s.id;
        const stableId = uid || (namespace || name ? `${namespace || ''}/${name || ''}` : '');

        return {
          key: stableId || `service_${index}`,
          name,
          namespace,
          type: raw.spec?.type || '-',
          clusterIP: raw.spec?.clusterIP || '-',
          externalIPs: externalIPs || '-',
          ports: ports || '-',
          nodePorts: nodePorts || '-',
          creationTimestamp: raw.metadata?.creationTimestamp || s.createdAt,
          raw,
          originalRecord: s, // 保留原始数据库记录
        };
      });
  }, [services]);

  /**
   * 前端过滤逻辑
   * - 关键字：匹配名称/命名空间
   * - 类型：匹配 Service.spec.type
   */
  const filteredData = useMemo(() => {
    let d = dataSource;
    if (isTenant) {
      d = d.filter((x: any) => !isPublicNamespace(x.namespace));
    }
    if (nsValue) {
      d = d.filter((x: any) => x.namespace === nsValue);
    }
    if (keyword) {
      const k = keyword.toLowerCase();
      d = d.filter(
        (x: any) => x.name.toLowerCase().includes(k) || x.namespace.toLowerCase().includes(k),
      );
    }
    if (typeFilter) {
      d = d.filter((x: any) => x.type === typeFilter);
    }
    return d;
  }, [dataSource, keyword, typeFilter, nsValue, isTenant, isPublicNamespace]);

  // 根据当前数据自动生成类型过滤选项（包含 All）
  const serviceTypes = useMemo(() => {
    const types = new Set(dataSource.map((d: any) => d.type).filter((t: string) => t !== '-'));
    return ['All', ...Array.from(types)];
  }, [dataSource]);

  /**
   * 表格列定义
   * - 名称列：链接按钮打开详情，别名入口
   * - 类型列：Tag 区分 Service 类型
   */
  const allColumns = useMemo(
    () => [
      {
        title: '名称',
        key: 'name',
        ellipsis: true,
        fixed: 'left' as const,
        render: (_: any, record: any) => {
          const alias = record?.raw?.metadata?.annotations?.['tower.io/alias'];
          const id = record?.name || '';
          const hasAlias = !!alias;

          return (
            <Space size={6} align="center">
              <Button
                type="link"
                onClick={() => {
                  setSelectedRecord(record);
                  setDrawerActiveTab('detail');
                  setDrawerOpen(true);
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
            </Space>
          );
        },
      },
      {
        title: 'ID',
        dataIndex: 'name',
        key: 'id',
        ellipsis: true,
      },
      { title: '项目', dataIndex: 'namespace', key: 'namespace' },
      {
        title: '类型',
        dataIndex: 'type',
        key: 'type',
        render: (t: string, record: any) => {
          const colorByType: Record<string, string> = {
            ClusterIP: 'blue',
            NodePort: 'green',
            LoadBalancer: 'orange',
            ExternalName: 'purple',
          };
          const color = colorByType[t];
          const rawResource = record?.raw || record;
          return (
            <Space size={4}>
              {color ? <Tag color={color}>{t}</Tag> : <Tag>{t}</Tag>}
              {isLocalRegistryManagedService(rawResource) && (
                <Tag color="processing">本地仓库托管</Tag>
              )}
            </Space>
          );
        },
      },
      { title: 'Cluster IP', dataIndex: 'clusterIP', key: 'clusterIP' },
      { title: '外部 IP', dataIndex: 'externalIPs', key: 'externalIPs' },
      { title: '端口', dataIndex: 'ports', key: 'ports', ellipsis: true },
      {
        title: 'NodePort',
        dataIndex: 'nodePorts',
        key: 'nodePorts',
        render: (val: string) => (val && val !== '-' ? <Tag color="green">{val}</Tag> : '-'),
      },
      {
        title: '创建时间',
        dataIndex: 'creationTimestamp',
        key: 'creationTimestamp',
        render: formatTime,
        sorter: (a: any, b: any) =>
          new Date(a?.creationTimestamp || 0).getTime() -
          new Date(b?.creationTimestamp || 0).getTime(),
        defaultSortOrder: 'descend' as const,
      },
      {
        title: '操作',
        key: 'action',
        align: 'left' as const,
        fixed: 'right' as const,
        render: (_: any, record: any) => {
          const rawResource = record?.raw || record;
          const isSystem = isSystemResource(rawResource);
          const isRegistryManaged = isLocalRegistryManagedService(rawResource);
          const systemHint = getSystemResourceProtectionHint(rawResource);
          const protectHint = isRegistryManaged ? REGISTRY_MANAGED_SERVICE_HINT : systemHint;
          const editDeleteDisabled = isSystem || isRegistryManaged;
          return (
            <ResourceActionsDropdown
              items={filterMenuItemsForReadOnly(
                [
                  ...(isTenant
                    ? [
                        {
                          key: 'view_pods',
                          label: '查看 Pod',
                          onClick: () => openRelatedPodsDrawer(record),
                        },
                      ]
                    : [
                        {
                          key: 'view_pods',
                          label: '查看 Pod',
                          onClick: () => openRelatedPodsDrawer(record),
                        },
                        {
                          key: 'edit',
                          label: '编辑服务',
                          disabled: editDeleteDisabled,
                          tooltip: protectHint,
                          onClick: () => handleEdit(record),
                        },
                        {
                          key: 'delete',
                          label: '删除',
                          danger: true,
                          disabled: editDeleteDisabled,
                          tooltip: protectHint,
                          onClick: () => {
                            void confirmHighRiskDelete({
                              resourceLabel: '服务',
                              name: record.name,
                              riskItems: CONTAINER_DELETE_RISK_ITEMS,
                              onConfirm: () => handleDelete(record),
                            }).catch(() => {});
                          },
                        },
                      ]),
                ],
                hasContainersWrite,
              )}
              buttonProps={{ className: 'row-actions-trigger' }}
            />
          );
        },
      },
      // eslint-disable-next-line react-hooks/exhaustive-deps
    ],
    [
      isTenant,
      openRelatedPodsDrawer,
      handleEdit,
      handleDelete,
      hasContainersWrite,
      handleOpenAliasModal,
    ],
  );

  // 使用新的 hook 管理列设置
  const { displayColumns: tableColumns } = useTableColumnSettings(
    allColumns,
    'harvester_services_table',
  );
  const [, setPagination] = useState({ current: 1, pageSize: 10 });

  return (
    <PageDetailSection
      asCard={false}
      toolbarLeft={
        <>
          <Input
            allowClear
            placeholder="服务名/项目"
            suffix={<SearchOutlined />}
            value={keyword}
            onChange={(e) => {
              setKeyword(e.target.value);
              setPagination((p) => ({ ...p, current: 1 }));
            }}
            className="toolbar-search"
          />
          <Select
            allowClear
            showSearch
            optionFilterProp="label"
            placeholder="筛选项目"
            value={nsValue || undefined}
            onChange={(v) => {
              onNsChange?.(v);
              setPagination((p) => ({ ...p, current: 1 }));
            }}
            options={namespacesOptionsBiz.map((ns) => ({ label: ns, value: ns }))}
            className="toolbar-filter-sm"
          />
          <Select
            allowClear
            placeholder="服务类型"
            value={typeFilter || undefined}
            onChange={(v) => {
              setTypeFilter(v || '');
              setPagination((p) => ({ ...p, current: 1 }));
            }}
            options={serviceTypes.filter((t) => t !== 'All').map((t) => ({ label: t, value: t }))}
            className="toolbar-filter-sm"
          />
          <button
            type="button"
            className="toolbar-reset-btn"
            onClick={() => {
              setKeyword('');
              setTypeFilter('');
              onNsChange?.(undefined);
              setPagination((p) => ({ ...p, current: 1 }));
            }}
          >
            重置
          </button>
        </>
      }
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
          {!isTenant && (
            <WriteGuard canWrite={hasContainersWrite}>
              <Button type="primary" onClick={handleOpenCreateService}>
                创建服务
              </Button>
            </WriteGuard>
          )}
          <TableColumnSettingsButton
            allColumns={allColumns}
            settingsKey="harvester_services_table"
          />
          <Button
            icon={<ReloadOutlined />}
            onClick={createContainerToolbarRefresh(onRefresh)}
            loading={loading}
          />
        </div>
      }
    >
      <Table
        className={!isTenant ? 'std-table' : 'std-table no-border'}
        bordered={false}
        scroll={{ x: true }}
        dataSource={filteredData}
        columns={tableColumns}
        rowKey={(r) => r?.key || `${r?.namespace || ''}/${r?.name || ''}`}
        loading={loading}
        pagination={{
          showTotal: (total) => `共 ${total} 条`,
        }}
      />

      <HarvesterResourceDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        resourceType="Service"
        record={
          selectedRecord
            ? { ...selectedRecord.originalRecord, kind: 'Service', rawData: selectedRecord.raw }
            : null
        }
        cloudId={cloudId}
        activeTab={drawerActiveTab}
        onTabChange={setDrawerActiveTab}
        pods={pods}
        onViewPodDetail={handleViewPodDetail}
        onViewPodLog={handleViewPodLog}
        onOpenPodTerminal={handleOpenPodTerminal}
      />

      <ServiceRelatedPodsDrawer
        open={relatedPodsDrawerOpen}
        onClose={() => {
          setRelatedPodsDrawerOpen(false);
          setRelatedPodsRow(null);
        }}
        cloudId={cloudId}
        serviceNamespace={relatedPodsRow?.namespace}
        serviceName={relatedPodsRow?.name}
        serviceSelector={relatedPodsRow?.raw?.spec?.selector}
        pods={pods}
        onViewPodDetail={handleViewPodDetail}
        onViewPodLog={handleViewPodLog}
        onOpenPodTerminal={handleOpenPodTerminal}
      />

      <ServiceFormDrawer
        open={serviceFormDrawerOpen}
        mode={serviceFormDrawerMode}
        onClose={() => {
          setServiceFormDrawerOpen(false);
          setEditingRecord(null);
        }}
        cloudId={cloudId}
        namespacesOptions={namespacesOptionsBiz}
        defaultNamespace={formDefaultNs}
        record={serviceFormDrawerMode === 'edit' ? editingRecord : null}
        onCommitted={() => runContainerSectionRefresh(onRefresh, { force: true })}
      />

      <ServicePodDetailDrawer
        open={podDetailVisible}
        onClose={() => {
          setPodDetailVisible(false);
          setCurrentPod(null);
        }}
        pod={currentPod}
        cloudId={cloudId}
        onViewPodLog={handleViewPodLog}
        onOpenPodTerminal={handleOpenPodTerminal}
      />

      <ServicePodLogDrawer
        open={podLogVisible}
        onClose={() => setPodLogVisible(false)}
        pod={currentPod}
        cloudId={cloudId}
        containers={podLogContainers}
      />

      <ServicePodTerminalBridge
        visible={podTerminalVisible}
        onClose={() => setPodTerminalVisible(false)}
        pod={currentPod}
        cloudId={cloudId}
        containers={podTerminalContainers}
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

      <ResourceLinkYamlDrawer
        open={serviceYamlDrawerOpen}
        onClose={() => {
          setServiceYamlDrawerOpen(false);
          setServiceYamlDrawerLink(undefined);
          setServiceYamlDrawerRecord(null);
        }}
        cloudId={cloudId}
        viewLink={serviceYamlDrawerLink}
        title="编辑 YAML"
        editable
        onSave={handleServiceYamlDrawerSave}
      />
    </PageDetailSection>
  );
};

export default ServicesSection;
