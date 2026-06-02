import React, { useState, useMemo, useCallback } from 'react';
import {
  Alert,
  Button,
  message,
  Tag,
  Table,
  Select,
  Input,
  Modal,
  Tooltip,
  Form,
  Segmented,
  Popover,
  Descriptions,
  Space,
} from 'antd';
import {
  ExclamationCircleOutlined,
  SearchOutlined,
  ReloadOutlined,
  PlusOutlined,
  EditTwoTone,
  InfoCircleOutlined,
  DownloadOutlined,
} from '@ant-design/icons';
import yaml from 'js-yaml';
import PageDetailSection from '../../../../../../components/PageDetailSection';
import ResourceActionsDropdown from '../../../../../../components/ResourceActionsDropdown';
import WriteGuard from '../../../../../../components/WriteGuard';
import { useAuth } from '../../../../../../contexts/AuthContext';
import { hasContainerSubWritePermission } from '../../../../../../utils/permissionUtils';
import { filterMenuItemsForReadOnly } from '../../../../../../utils/rbacUi';
import {
  isSystemResource,
  getSystemResourceProtectionHint,
} from '../../../../../../utils/harvesterUtils';
import {
  deleteGateway,
  deleteHttpRoute,
  deleteGrpcRoute,
  deleteGatewayClass,
  createGatewayClass,
  patchHarvesterContainerResource,
  updateGateway,
  updateHttpRoute,
  updateGrpcRoute,
  installNginxGatewayFabric,
} from '../../../../../../services/harvesterApi';
import { GatewayFormModal, HTTPRouteFormModal, GRPCRouteFormModal } from '../components';
import { ResourceLinkYamlDrawer } from '../../shared/components/ResourceLinkYamlDrawer';
import { GatewayDetailDrawer } from '../drawers/GatewayDetailDrawer';
import {
  createContainerToolbarRefresh,
  runContainerSectionRefresh,
} from '../lib/containerSectionRefresh';
import {
  confirmHighRiskDelete,
  confirmHighRiskOperation,
  CONTAINER_DELETE_RISK_ITEMS,
  CLUSTER_COMPONENT_INSTALL_RISK_ITEMS,
} from '../../shared/lib/highRiskConfirm';

function resolveGatewayApiViewLink(
  record: any,
  type: 'gateway' | 'httproute' | 'grpcroute',
): string | undefined {
  const ns = record?.metadata?.namespace;
  const name = record?.metadata?.name;
  if (!ns || !name) return undefined;
  const resource =
    type === 'gateway' ? 'gateways' : type === 'httproute' ? 'httproutes' : 'grpcroutes';
  return `/apis/gateway.networking.k8s.io/v1/namespaces/${encodeURIComponent(ns)}/${resource}/${encodeURIComponent(name)}`;
}

interface GatewayApiSectionProps {
  cloudId: string;
  gatewayApiStatus: {
    installed: boolean;
    resources: { gatewayClass: boolean; gateway: boolean; httpRoute: boolean; grpcRoute: boolean };
  } | null;
  gatewayClasses: any[];
  gateways: any[];
  httpRoutes: any[];
  grpcRoutes: any[];
  loading: boolean;
  namespacesOptions: string[];
  nsValue?: string;
  onNsChange?: (v?: string) => void;
  services?: any[];
  onRefresh: (force?: boolean) => void;
  createDefaultNamespace?: string;
}

/**
 * Gateway API 管理组件
 *
 * 支持 Kubernetes Gateway API (下一代 Ingress)
 * 包含 GatewayClass, Gateway, HTTPRoute, GRPCRoute 四种资源
 */
const GatewayApiSection: React.FC<GatewayApiSectionProps> = ({
  cloudId,
  gatewayApiStatus,
  gatewayClasses,
  gateways,
  httpRoutes,
  grpcRoutes,
  loading,
  namespacesOptions,
  nsValue,
  onNsChange,
  services,
  onRefresh,
  createDefaultNamespace,
}) => {
  const { user } = useAuth();
  const formDefaultNs = createDefaultNamespace ?? nsValue ?? 'default';
  const hasContainersWrite = useMemo(
    () => hasContainerSubWritePermission((user?.permissions ?? []) as string[], 'gateway_api'),
    [user?.permissions],
  );
  const [activeSubTab, setActiveSubTab] = useState('gatewayclasses');
  const [keyword, setKeyword] = useState<string>('');

  // 别名编辑相关状态
  const [aliasForm] = Form.useForm<{ alias?: string }>();
  const [aliasModalVisible, setAliasModalVisible] = useState(false);
  const [aliasRecord, setAliasRecord] = useState<any>(null);
  const [aliasSubmitting, setAliasSubmitting] = useState(false);
  const [aliasResourceType, setAliasResourceType] = useState<
    'gateway' | 'httproute' | 'grpcroute' | null
  >(null);

  // 创建弹窗状态
  const [gatewayModalOpen, setGatewayModalOpen] = useState(false);
  const [httpRouteModalOpen, setHttpRouteModalOpen] = useState(false);
  const [grpcRouteModalOpen, setGrpcRouteModalOpen] = useState(false);
  const [gatewayClassModalOpen, setGatewayClassModalOpen] = useState(false);
  const [gatewayClassForm] = Form.useForm<{
    name: string;
    controllerName: string;
    description?: string;
  }>();
  const [gatewayClassSubmitting, setGatewayClassSubmitting] = useState(false);

  // YAML 抽屉状态
  const [yamlDrawerOpen, setYamlDrawerOpen] = useState(false);
  const [yamlViewLink, setYamlViewLink] = useState<string | undefined>();
  const [yamlEditingRecord, setYamlEditingRecord] = useState<any>(null);
  const [yamlEditingType, setYamlEditingType] = useState<
    'gateway' | 'httproute' | 'grpcroute' | null
  >(null);

  // Gateway 详情抽屉状态
  const [gatewayDetailOpen, setGatewayDetailOpen] = useState(false);
  const [gatewayDetailRecord, setGatewayDetailRecord] = useState<any>(null);

  // 安装 NGINX Gateway 状态
  const [installNginxLoading, setInstallNginxLoading] = useState(false);

  const handleToolbarRefresh = useMemo(() => createContainerToolbarRefresh(onRefresh), [onRefresh]);

  // 安装 NGINX Gateway Fabric
  const handleInstallNginxGateway = useCallback(() => {
    void confirmHighRiskOperation({
      title: '安装 NGINX Gateway Fabric',
      description:
        '将安装 NGINX Gateway Fabric 控制器到集群，包括命名空间、部署和默认 GatewayClass。',
      riskItems: CLUSTER_COMPONENT_INSTALL_RISK_ITEMS,
      requireTypeConfirm: false,
      operationSummary: '安装 NGINX Gateway Fabric 控制器',
      confirmText: '安装',
      onConfirm: async () => {
        setInstallNginxLoading(true);
        try {
          const result = await installNginxGatewayFabric(cloudId);
          console.log('[安装 NGINX Gateway] 结果:', result);

          const steps = result?.results || [];

          // 显示详细结果
          const resultText = steps
            .map((s: any) => {
              const statusIcon = s.status === 'success' ? '✅' : s.status === 'error' ? '❌' : '⏭️';
              return `${statusIcon} ${s.step}: ${s.message || s.status}`;
            })
            .join('\n');

          const hasError = steps.some((s: any) => s.status === 'error');

          Modal[hasError ? 'warning' : 'info']({
            title: '安装结果',
            content: <pre style={{ whiteSpace: 'pre-wrap', fontSize: 12 }}>{resultText}</pre>,
          });

          if (!hasError) {
            void runContainerSectionRefresh(onRefresh, { force: true });
          }
        } catch (error: any) {
          console.error('[安装 NGINX Gateway] 失败:', error);
          message.error(error?.response?.data?.message || error?.message || '安装失败');
        } finally {
          setInstallNginxLoading(false);
        }
      },
    }).catch(() => {});
  }, [cloudId, onRefresh]);

  // 检查 Gateway API 是否已安装
  const isInstalled = gatewayApiStatus?.installed ?? false;

  // 获取 API 路径
  const getApiPath = useCallback((type: 'gateway' | 'httproute' | 'grpcroute') => {
    switch (type) {
      case 'gateway':
        return '/apis/gateway.networking.k8s.io/v1/gateways';
      case 'httproute':
        return '/apis/gateway.networking.k8s.io/v1/httproutes';
      case 'grpcroute':
        return '/apis/gateway.networking.k8s.io/v1/grpcroutes';
    }
  }, []);

  // 别名编辑 - 打开弹窗
  const handleOpenAliasModal = useCallback(
    (record: any, resourceType: 'gateway' | 'httproute' | 'grpcroute') => {
      const currentAlias = record?.metadata?.annotations?.['tower.io/alias'] || '';
      setAliasRecord(record);
      setAliasResourceType(resourceType);
      setAliasModalVisible(true);
      aliasForm.setFieldsValue({ alias: String(currentAlias || '') });
    },
    [aliasForm],
  );

  // 别名编辑 - 提交
  const handleSubmitAlias = useCallback(
    async (nextAliasRaw?: string) => {
      if (!aliasRecord || !aliasResourceType) return false;
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

      const apiPath = getApiPath(aliasResourceType);
      setAliasSubmitting(true);
      try {
        await patchHarvesterContainerResource(cloudId, apiPath, ns, name, patchBody);
        message.success(next ? '名称修改成功' : '已清空别名');
        setAliasModalVisible(false);
        setAliasRecord(null);
        setAliasResourceType(null);
        aliasForm.resetFields();
        void runContainerSectionRefresh(onRefresh, { force: true });
        return true;
      } catch (e: any) {
        console.error(e);
        message.error(e?.message || '名称修改失败');
        return false;
      } finally {
        setAliasSubmitting(false);
      }
    },
    [aliasRecord, aliasResourceType, getApiPath, cloudId, onRefresh, aliasForm],
  );

  // YAML 编辑 - 保存 YAML
  const handleSaveYaml = useCallback(
    async (yamlText: string) => {
      if (!yamlEditingRecord || !yamlEditingType) return;
      const ns = yamlEditingRecord?.metadata?.namespace;
      const name = yamlEditingRecord?.metadata?.name;

      let data: unknown;
      try {
        data = yaml.load(yamlText);
      } catch {
        message.error('YAML 格式错误');
        throw new Error('YAML 格式错误');
      }

      switch (yamlEditingType) {
        case 'gateway':
          await updateGateway(cloudId, ns, name, data);
          break;
        case 'httproute':
          await updateHttpRoute(cloudId, ns, name, data);
          break;
        case 'grpcroute':
          await updateGrpcRoute(cloudId, ns, name, data);
          break;
      }
      void runContainerSectionRefresh(onRefresh, { force: true });
    },
    [cloudId, yamlEditingRecord, yamlEditingType, onRefresh],
  );

  // 打开 YAML 抽屉
  const handleOpenYamlEdit = useCallback(
    (record: any, type: 'gateway' | 'httproute' | 'grpcroute') => {
      const link = resolveGatewayApiViewLink(record, type);
      if (!link) {
        message.warning('当前行缺少 View Link，无法拉取 YAML');
        return;
      }
      setYamlEditingRecord(record);
      setYamlEditingType(type);
      setYamlViewLink(link);
      setYamlDrawerOpen(true);
    },
    [],
  );

  // 关闭 YAML 抽屉
  const handleCloseYamlEdit = useCallback(() => {
    setYamlDrawerOpen(false);
    setYamlViewLink(undefined);
    setYamlEditingRecord(null);
    setYamlEditingType(null);
  }, []);

  // GatewayClass 表格列
  const gatewayClassColumns = [
    {
      title: '名称',
      dataIndex: ['metadata', 'name'],
      key: 'name',
      fixed: 'left' as const,
      ellipsis: true,
    },
    {
      title: '控制器',
      dataIndex: ['spec', 'controllerName'],
      key: 'controller',
      render: (text: string) => <Tag color="blue">{text}</Tag>,
    },
    {
      title: '描述',
      dataIndex: ['spec', 'description'],
      key: 'description',
      ellipsis: true,
    },
    {
      title: '创建时间',
      dataIndex: ['metadata', 'creationTimestamp'],
      key: 'createdAt',
      render: (text: string) => (text ? new Date(text).toLocaleString() : '-'),
      sorter: (a: any, b: any) =>
        new Date(a?.metadata?.creationTimestamp || 0).getTime() -
        new Date(b?.metadata?.creationTimestamp || 0).getTime(),
      defaultSortOrder: 'descend' as const,
    },
    {
      title: '操作',
      key: 'action',
      fixed: 'right' as const,
      render: (_: any, record: any) => {
        const rawResource = record?.metadata ? record : record?.raw;
        const isSystem = isSystemResource(rawResource);
        const systemHint = getSystemResourceProtectionHint(rawResource);
        return (
          <ResourceActionsDropdown
            buttonProps={{ className: 'row-actions-trigger' }}
            items={filterMenuItemsForReadOnly(
              [
                {
                  key: 'delete',
                  label: '删除',
                  danger: true,
                  disabled: isSystem,
                  tooltip: systemHint,
                  onClick: () => {
                    void confirmHighRiskDelete({
                      resourceLabel: 'GatewayClass',
                      name: record?.metadata?.name || '',
                      riskItems: CONTAINER_DELETE_RISK_ITEMS,
                      onConfirm: () => handleDeleteGatewayClass(record),
                    }).catch(() => {});
                  },
                },
              ],
              hasContainersWrite,
            )}
          />
        );
      },
    },
  ];

  // 打开 Gateway 详情抽屉
  const handleOpenGatewayDetail = useCallback((record: any) => {
    setGatewayDetailRecord(record);
    setGatewayDetailOpen(true);
  }, []);

  // Gateway 表格列
  const gatewayColumns = [
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
            <a onClick={() => handleOpenGatewayDetail(record)} style={{ cursor: 'pointer' }}>
              {hasAlias ? alias : id}
            </a>
            <Tooltip title={hasAlias ? '修改别名' : '设置别名'}>
              <Button
                type="text"
                size="small"
                icon={<EditTwoTone />}
                onClick={(e) => {
                  e.stopPropagation();
                  handleOpenAliasModal(record, 'gateway');
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
      render: (ns: string) => <Tag>{ns}</Tag>,
    },
    {
      title: 'GatewayClass',
      dataIndex: ['spec', 'gatewayClassName'],
      key: 'gatewayClassName',
    },
    {
      title: '监听器',
      dataIndex: ['spec', 'listeners'],
      key: 'listeners',
      render: (listeners: any[]) => listeners?.length || 0,
    },
    {
      title: '状态',
      dataIndex: ['status'],
      key: 'status',
      render: (status: any) => {
        const conditions = status?.conditions || [];
        // Gateway API 使用 Programmed condition 表示就绪状态
        const programmed = conditions?.find((c: any) => c.type === 'Programmed');
        const accepted = conditions?.find((c: any) => c.type === 'Accepted');
        const isReady = programmed?.status === 'True' && accepted?.status === 'True';

        // 收集所有 condition 信息
        const conditionDetails =
          conditions?.map((c: any) => ({
            type: c.type,
            status: c.status,
            reason: c.reason,
            message: c.message,
          })) || [];

        // 获取失败原因
        const notReadyCondition =
          programmed?.status !== 'True'
            ? programmed
            : accepted?.status !== 'True'
              ? accepted
              : null;
        const notReadyReason =
          !isReady && notReadyCondition
            ? notReadyCondition.reason || notReadyCondition.message || '未知原因'
            : null;

        const content = (
          <div style={{ maxWidth: 400 }}>
            <Descriptions column={1} size="small">
              {conditionDetails.map((c: any, idx: number) => (
                <Descriptions.Item key={idx} label={c.type}>
                  <Tag color={c.status === 'True' ? 'green' : 'orange'}>{c.status}</Tag>
                  {c.reason && <span style={{ marginLeft: 8, color: '#666' }}>{c.reason}</span>}
                </Descriptions.Item>
              ))}
            </Descriptions>
          </div>
        );

        return (
          <Popover content={content} title="条件详情" trigger="hover">
            <span style={{ cursor: 'pointer' }}>
              {isReady ? (
                <Tag color="green">就绪</Tag>
              ) : (
                <Tag color="orange">
                  未就绪
                  {notReadyReason && (
                    <Tooltip title={notReadyReason}>
                      <InfoCircleOutlined style={{ marginLeft: 4 }} />
                    </Tooltip>
                  )}
                </Tag>
              )}
            </span>
          </Popover>
        );
      },
    },
    {
      title: '创建时间',
      dataIndex: ['metadata', 'creationTimestamp'],
      key: 'createdAt',
      render: (text: string) => (text ? new Date(text).toLocaleString() : '-'),
      sorter: (a: any, b: any) =>
        new Date(a?.metadata?.creationTimestamp || 0).getTime() -
        new Date(b?.metadata?.creationTimestamp || 0).getTime(),
      defaultSortOrder: 'descend' as const,
    },
    {
      title: '操作',
      key: 'action',
      fixed: 'right' as const,
      render: (_: any, record: any) => {
        const rawResource = record?.metadata ? record : record?.raw;
        const isSystem = isSystemResource(rawResource);
        const systemHint = getSystemResourceProtectionHint(rawResource);
        return (
          <ResourceActionsDropdown
            buttonProps={{ className: 'row-actions-trigger' }}
            items={filterMenuItemsForReadOnly(
              [
                {
                  key: 'view-detail',
                  label: '查看详情',
                  onClick: () => handleOpenGatewayDetail(record),
                },
                {
                  key: 'view-yaml',
                  label: '查看 YAML',
                  onClick: () => handleOpenYamlEdit(record, 'gateway'),
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
                    void confirmHighRiskDelete({
                      resourceLabel: 'Gateway',
                      name: displayName,
                      riskItems: CONTAINER_DELETE_RISK_ITEMS,
                      onConfirm: () => handleDeleteGateway(record),
                    }).catch(() => {});
                  },
                },
              ],
              hasContainersWrite,
            )}
          />
        );
      },
    },
  ];

  // HTTPRoute 表格列
  const httpRouteColumns = [
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
            <span>{hasAlias ? alias : id}</span>
            <Tooltip title={hasAlias ? '修改别名' : '设置别名'}>
              <Button
                type="text"
                size="small"
                icon={<EditTwoTone />}
                onClick={(e) => {
                  e.stopPropagation();
                  handleOpenAliasModal(record, 'httproute');
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
      render: (ns: string) => <Tag>{ns}</Tag>,
    },
    {
      title: '主机名',
      dataIndex: ['spec', 'hostnames'],
      key: 'hostnames',
      ellipsis: true,
      render: (hostnames: string[]) => hostnames?.join(', ') || '*',
    },
    {
      title: '规则数',
      dataIndex: ['spec', 'rules'],
      key: 'rules',
      render: (rules: any[]) => rules?.length || 0,
    },
    {
      title: '创建时间',
      dataIndex: ['metadata', 'creationTimestamp'],
      key: 'createdAt',
      render: (text: string) => (text ? new Date(text).toLocaleString() : '-'),
      sorter: (a: any, b: any) =>
        new Date(a?.metadata?.creationTimestamp || 0).getTime() -
        new Date(b?.metadata?.creationTimestamp || 0).getTime(),
      defaultSortOrder: 'descend' as const,
    },
    {
      title: '操作',
      key: 'action',
      fixed: 'right' as const,
      render: (_: any, record: any) => {
        const rawResource = record?.metadata ? record : record?.raw;
        const isSystem = isSystemResource(rawResource);
        const systemHint = getSystemResourceProtectionHint(rawResource);
        return (
          <ResourceActionsDropdown
            buttonProps={{ className: 'row-actions-trigger' }}
            items={filterMenuItemsForReadOnly(
              [
                {
                  key: 'yaml',
                  label: 'YAML 编辑',
                  onClick: () => handleOpenYamlEdit(record, 'httproute'),
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
                    void confirmHighRiskDelete({
                      resourceLabel: 'HTTPRoute',
                      name: displayName,
                      riskItems: CONTAINER_DELETE_RISK_ITEMS,
                      onConfirm: () => handleDeleteHttpRoute(record),
                    }).catch(() => {});
                  },
                },
              ],
              hasContainersWrite,
            )}
          />
        );
      },
    },
  ];

  // GRPCRoute 表格列
  const grpcRouteColumns = [
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
            <span>{hasAlias ? alias : id}</span>
            <Tooltip title={hasAlias ? '修改别名' : '设置别名'}>
              <Button
                type="text"
                size="small"
                icon={<EditTwoTone />}
                onClick={(e) => {
                  e.stopPropagation();
                  handleOpenAliasModal(record, 'grpcroute');
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
      render: (ns: string) => <Tag>{ns}</Tag>,
    },
    {
      title: '主机名',
      dataIndex: ['spec', 'hostnames'],
      key: 'hostnames',
      ellipsis: true,
      render: (hostnames: string[]) => hostnames?.join(', ') || '*',
    },
    {
      title: '规则数',
      dataIndex: ['spec', 'rules'],
      key: 'rules',
      render: (rules: any[]) => rules?.length || 0,
    },
    {
      title: '创建时间',
      dataIndex: ['metadata', 'creationTimestamp'],
      key: 'createdAt',
      render: (text: string) => (text ? new Date(text).toLocaleString() : '-'),
      sorter: (a: any, b: any) =>
        new Date(a?.metadata?.creationTimestamp || 0).getTime() -
        new Date(b?.metadata?.creationTimestamp || 0).getTime(),
      defaultSortOrder: 'descend' as const,
    },
    {
      title: '操作',
      key: 'action',
      fixed: 'right' as const,
      render: (_: any, record: any) => {
        const rawResource = record?.metadata ? record : record?.raw;
        const isSystem = isSystemResource(rawResource);
        const systemHint = getSystemResourceProtectionHint(rawResource);
        return (
          <ResourceActionsDropdown
            buttonProps={{ className: 'row-actions-trigger' }}
            items={filterMenuItemsForReadOnly(
              [
                {
                  key: 'yaml',
                  label: 'YAML 编辑',
                  onClick: () => handleOpenYamlEdit(record, 'grpcroute'),
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
                    void confirmHighRiskDelete({
                      resourceLabel: 'GRPCRoute',
                      name: displayName,
                      riskItems: CONTAINER_DELETE_RISK_ITEMS,
                      onConfirm: () => handleDeleteGrpcRoute(record),
                    }).catch(() => {});
                  },
                },
              ],
              hasContainersWrite,
            )}
          />
        );
      },
    },
  ];

  // 删除 Gateway
  const handleDeleteGateway = async (record: any) => {
    try {
      await deleteGateway(cloudId, record.metadata.namespace, record.metadata.name);
      message.success('Gateway 删除成功');
      void runContainerSectionRefresh(onRefresh, { force: true });
    } catch (error: any) {
      message.error(`删除失败: ${error?.message || '未知错误'}`);
    }
  };

  // 删除 HTTPRoute
  const handleDeleteHttpRoute = async (record: any) => {
    try {
      await deleteHttpRoute(cloudId, record.metadata.namespace, record.metadata.name);
      message.success('HTTPRoute 删除成功');
      void runContainerSectionRefresh(onRefresh, { force: true });
    } catch (error: any) {
      message.error(`删除失败: ${error?.message || '未知错误'}`);
    }
  };

  // 删除 GRPCRoute
  const handleDeleteGrpcRoute = async (record: any) => {
    try {
      await deleteGrpcRoute(cloudId, record.metadata.namespace, record.metadata.name);
      message.success('GRPCRoute 删除成功');
      void runContainerSectionRefresh(onRefresh, { force: true });
    } catch (error: any) {
      message.error(`删除失败: ${error?.message || '未知错误'}`);
    }
  };

  const filteredGateways = useMemo(() => {
    let d = gateways;
    if (nsValue) {
      d = d.filter((g: any) => g?.metadata?.namespace === nsValue);
    }
    if (keyword) {
      const k = keyword.toLowerCase();
      d = d.filter(
        (g: any) =>
          (g?.metadata?.name || '').toLowerCase().includes(k) ||
          (g?.metadata?.namespace || '').toLowerCase().includes(k),
      );
    }
    return d;
  }, [gateways, nsValue, keyword]);

  const filteredHttpRoutes = useMemo(() => {
    let d = httpRoutes;
    if (nsValue) {
      d = d.filter((r: any) => r?.metadata?.namespace === nsValue);
    }
    if (keyword) {
      const k = keyword.toLowerCase();
      d = d.filter(
        (r: any) =>
          (r?.metadata?.name || '').toLowerCase().includes(k) ||
          (r?.metadata?.namespace || '').toLowerCase().includes(k),
      );
    }
    return d;
  }, [httpRoutes, nsValue, keyword]);

  const filteredGrpcRoutes = useMemo(() => {
    let d = grpcRoutes;
    if (nsValue) {
      d = d.filter((r: any) => r?.metadata?.namespace === nsValue);
    }
    if (keyword) {
      const k = keyword.toLowerCase();
      d = d.filter(
        (r: any) =>
          (r?.metadata?.name || '').toLowerCase().includes(k) ||
          (r?.metadata?.namespace || '').toLowerCase().includes(k),
      );
    }
    return d;
  }, [grpcRoutes, nsValue, keyword]);

  // 重置筛选
  const handleReset = useCallback(() => {
    setKeyword('');
    onNsChange?.(undefined);
  }, [onNsChange]);

  // 创建 GatewayClass
  const handleCreateGatewayClass = useCallback(async () => {
    try {
      const values = await gatewayClassForm.validateFields();
      setGatewayClassSubmitting(true);
      await createGatewayClass(cloudId, {
        metadata: { name: values.name },
        spec: {
          controllerName: values.controllerName,
          description: values.description,
        },
      });
      message.success('GatewayClass 创建成功');
      setGatewayClassModalOpen(false);
      gatewayClassForm.resetFields();
      void runContainerSectionRefresh(onRefresh, { force: true });
    } catch (e: any) {
      message.error(e?.message || '创建失败');
    } finally {
      setGatewayClassSubmitting(false);
    }
  }, [cloudId, gatewayClassForm, onRefresh]);

  // 删除 GatewayClass
  const handleDeleteGatewayClass = useCallback(
    async (record: any) => {
      try {
        await deleteGatewayClass(cloudId, record.metadata.name);
        message.success('GatewayClass 删除成功');
        void runContainerSectionRefresh(onRefresh, { force: true });
      } catch (error: any) {
        message.error(`删除失败: ${error?.message || '未知错误'}`);
      }
    },
    [cloudId, onRefresh],
  );

  // 如果 Gateway API 未安装，显示提示
  if (!loading && !isInstalled) {
    return (
      <Alert
        type="warning"
        showIcon
        icon={<ExclamationCircleOutlined />}
        message="Gateway API 未安装"
        description={
          <div>
            <p>
              当前集群未安装 Gateway API CRD。Gateway API 是 Kubernetes 下一代流量管理
              API，将逐步取代 Ingress。
            </p>
            <p>请安装 Gateway API CRD 后刷新页面。安装方法：</p>
            <pre style={{ background: '#f5f5f5', padding: 8, borderRadius: 4 }}>
              kubectl apply -f
              https://github.com/kubernetes-sigs/gateway-api/releases/download/v1.1.0/standard-install.yaml
            </pre>
            <Button type="primary" onClick={handleToolbarRefresh} style={{ marginTop: 8 }}>
              刷新检测
            </Button>
          </div>
        }
      />
    );
  }

  // 根据当前 Tab 决定显示哪个创建按钮
  const renderCreateButton = () => {
    switch (activeSubTab) {
      case 'gateways':
        return (
          <WriteGuard canWrite={hasContainersWrite}>
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => setGatewayModalOpen(true)}
            >
              创建
            </Button>
          </WriteGuard>
        );
      case 'httproutes':
        return (
          <WriteGuard canWrite={hasContainersWrite}>
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => setHttpRouteModalOpen(true)}
            >
              创建
            </Button>
          </WriteGuard>
        );
      case 'grpcroutes':
        return (
          <WriteGuard canWrite={hasContainersWrite}>
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => setGrpcRouteModalOpen(true)}
            >
              创建
            </Button>
          </WriteGuard>
        );
      case 'gatewayclasses':
        return (
          <Space>
            <WriteGuard canWrite={hasContainersWrite}>
              <Button
                type="primary"
                icon={<PlusOutlined />}
                onClick={() => setGatewayClassModalOpen(true)}
              >
                创建
              </Button>
            </WriteGuard>
            <WriteGuard canWrite={hasContainersWrite}>
              <Button
                icon={<DownloadOutlined />}
                onClick={handleInstallNginxGateway}
                loading={installNginxLoading}
              >
                安装 NGINX Gateway
              </Button>
            </WriteGuard>
          </Space>
        );
      default:
        return null;
    }
  };

  // 渲染工具栏
  const renderToolbar = (showCreate: boolean = true) => (
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
        <button type="button" className="toolbar-reset-btn" onClick={handleReset}>
          重置
        </button>
      </div>
      <div className="toolbar-actions">
        {showCreate && renderCreateButton()}
        <Tooltip title="刷新">
          <Button
            type="default"
            icon={<ReloadOutlined />}
            onClick={handleToolbarRefresh}
            loading={loading}
          />
        </Tooltip>
      </div>
    </div>
  );

  // 根据当前 Tab 渲染表格
  const renderTable = () => {
    switch (activeSubTab) {
      case 'gateways':
        return (
          <Table
            className="std-table"
            scroll={{ x: true }}
            bordered={false}
            columns={gatewayColumns}
            dataSource={filteredGateways}
            rowKey={(record) =>
              record.metadata.uid || `${record.metadata.namespace}/${record.metadata.name}`
            }
            loading={loading}
            pagination={{
              size: 'small' as const,
              showTotal: (total) => `共 ${total} 条`,
            }}
          />
        );
      case 'httproutes':
        return (
          <Table
            className="std-table"
            scroll={{ x: true }}
            bordered={false}
            columns={httpRouteColumns}
            dataSource={filteredHttpRoutes}
            rowKey={(record) =>
              record.metadata.uid || `${record.metadata.namespace}/${record.metadata.name}`
            }
            loading={loading}
            pagination={{
              size: 'small' as const,
              showTotal: (total) => `共 ${total} 条`,
            }}
          />
        );
      case 'grpcroutes':
        return (
          <Table
            className="std-table"
            scroll={{ x: true }}
            bordered={false}
            columns={grpcRouteColumns}
            dataSource={filteredGrpcRoutes}
            rowKey={(record) =>
              record.metadata.uid || `${record.metadata.namespace}/${record.metadata.name}`
            }
            loading={loading}
            pagination={{
              size: 'small' as const,
              showTotal: (total) => `共 ${total} 条`,
            }}
          />
        );
      case 'gatewayclasses':
        return (
          <Table
            className="std-table"
            scroll={{ x: true }}
            bordered={false}
            columns={gatewayClassColumns}
            dataSource={gatewayClasses}
            rowKey={(record) => record.metadata.uid || record.metadata.name}
            loading={loading}
            pagination={{
              size: 'small' as const,
              showTotal: (total) => `共 ${total} 条`,
            }}
          />
        );
      default:
        return null;
    }
  };

  const showCreate = true; // 所有 Tab 都可以创建

  return (
    <PageDetailSection asCard={false}>
      <Segmented
        style={{ marginBottom: 12 }}
        value={activeSubTab}
        onChange={(v) => setActiveSubTab(v as string)}
        options={[
          { label: `GatewayClass (${gatewayClasses.length})`, value: 'gatewayclasses' },
          { label: `Gateway (${filteredGateways.length})`, value: 'gateways' },
          { label: `HTTP路由 (${filteredHttpRoutes.length})`, value: 'httproutes' },
          { label: `gRPC路由 (${filteredGrpcRoutes.length})`, value: 'grpcroutes' },
        ]}
      />
      {renderToolbar(showCreate)}
      {renderTable()}

      {/* Gateway 创建弹窗 */}
      <GatewayFormModal
        visible={gatewayModalOpen}
        cloudId={cloudId}
        namespacesOptions={namespacesOptions}
        gatewayClasses={gatewayClasses}
        defaultNamespace={formDefaultNs}
        onSuccess={() => {
          setGatewayModalOpen(false);
          void runContainerSectionRefresh(onRefresh, { force: true });
        }}
        onCancel={() => setGatewayModalOpen(false)}
      />

      {/* HTTPRoute 创建弹窗 */}
      <HTTPRouteFormModal
        visible={httpRouteModalOpen}
        cloudId={cloudId}
        namespacesOptions={namespacesOptions}
        gateways={gateways}
        services={services}
        defaultNamespace={formDefaultNs}
        onSuccess={() => {
          setHttpRouteModalOpen(false);
          void runContainerSectionRefresh(onRefresh, { force: true });
        }}
        onCancel={() => setHttpRouteModalOpen(false)}
      />

      {/* GRPCRoute 创建弹窗 */}
      <GRPCRouteFormModal
        visible={grpcRouteModalOpen}
        cloudId={cloudId}
        namespacesOptions={namespacesOptions}
        gateways={gateways}
        services={services}
        defaultNamespace={formDefaultNs}
        onSuccess={() => {
          setGrpcRouteModalOpen(false);
          void runContainerSectionRefresh(onRefresh, { force: true });
        }}
        onCancel={() => setGrpcRouteModalOpen(false)}
      />

      {/* GatewayClass 创建弹窗 */}
      <Modal
        title="创建 GatewayClass"
        open={gatewayClassModalOpen}
        centered
        okText="创建"
        cancelText="取消"
        confirmLoading={gatewayClassSubmitting}
        onOk={handleCreateGatewayClass}
        onCancel={() => {
          if (gatewayClassSubmitting) return;
          setGatewayClassModalOpen(false);
          gatewayClassForm.resetFields();
        }}
        width={500}
      >
        <Form form={gatewayClassForm} layout="vertical">
          <Form.Item
            name="name"
            label="名称"
            rules={[
              { required: true, message: '请输入名称' },
              {
                pattern: /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/,
                message: '名称只能包含小写字母、数字和连字符',
              },
            ]}
          >
            <Input placeholder="如: nginx" autoFocus />
          </Form.Item>
          <Form.Item
            name="controllerName"
            label="控制器名称"
            rules={[{ required: true, message: '请选择或输入控制器名称' }]}
            initialValue="nginx.org/gateway-controller"
          >
            <Select
              placeholder="选择控制器"
              showSearch
              style={{ width: '100%' }}
              popupMatchSelectWidth={400}
              options={[
                {
                  label: 'NGINX Gateway Fabric (nginx.org/gateway-controller)',
                  value: 'nginx.org/gateway-controller',
                },
                {
                  label: 'Istio (istio.io/gateway-controller)',
                  value: 'istio.io/gateway-controller',
                },
                {
                  label: 'Envoy Gateway (envoyproxy.io/gateway-controller)',
                  value: 'envoyproxy.io/gateway-controller',
                },
              ]}
            />
          </Form.Item>
          <Form.Item name="description" label="描述">
            <Input placeholder="可选描述" />
          </Form.Item>
        </Form>
        <Alert
          type="warning"
          showIcon
          message="使用前需先安装 Gateway 控制器"
          description={
            <div>
              <p style={{ margin: '0 0 8px' }}>
                GatewayClass 需要对应的控制器才能工作。常见控制器：
              </p>
              <ul style={{ margin: '0 0 8px', paddingLeft: 20 }}>
                <li>
                  <b>NGINX Gateway Fabric</b> - <code>nginx.org/gateway-controller</code>
                </li>
                <li>
                  <b>Istio</b> - <code>istio.io/gateway-controller</code>
                </li>
                <li>
                  <b>Envoy Gateway</b> - <code>envoyproxy.io/gateway-controller</code>
                </li>
              </ul>
              <p style={{ margin: 0, color: '#666' }}>
                提示：Harvester 默认使用 Ingress-nginx（Ingress 控制器），如需使用 Gateway API
                请先安装对应控制器。
              </p>
            </div>
          }
          style={{ marginTop: 16 }}
        />
      </Modal>

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
          setAliasResourceType(null);
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
        open={yamlDrawerOpen}
        onClose={handleCloseYamlEdit}
        cloudId={cloudId}
        viewLink={yamlViewLink}
        title={
          yamlEditingType === 'gateway'
            ? 'Gateway YAML'
            : yamlEditingType === 'httproute'
              ? 'HTTPRoute YAML'
              : yamlEditingType === 'grpcroute'
                ? 'GRPCRoute YAML'
                : '资源 YAML'
        }
        editable={yamlEditingType === 'httproute' || yamlEditingType === 'grpcroute'}
        onSave={
          yamlEditingType === 'httproute' || yamlEditingType === 'grpcroute'
            ? handleSaveYaml
            : undefined
        }
      />

      {/* Gateway 详情抽屉 */}
      <GatewayDetailDrawer
        open={gatewayDetailOpen}
        onClose={() => {
          setGatewayDetailOpen(false);
          setGatewayDetailRecord(null);
        }}
        gateway={gatewayDetailRecord}
        cloudId={cloudId}
      />
    </PageDetailSection>
  );
};

export default GatewayApiSection;
