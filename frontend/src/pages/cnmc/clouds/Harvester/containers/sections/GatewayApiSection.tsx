import React, { useState, useMemo, useCallback } from 'react';
import { Alert, Button, message, Tag, Table, Select, Input, Modal, Tooltip, Form, Segmented } from 'antd';
import { ExclamationCircleOutlined, SearchOutlined, ReloadOutlined, PlusOutlined, EditTwoTone } from '@ant-design/icons';
import PageDetailSection from '../../../../../../components/PageDetailSection';
import ResourceActionsDropdown from '../../../../../../components/ResourceActionsDropdown';
import WriteGuard from '../../../../../../components/WriteGuard';
import { useAuth } from '../../../../../../contexts/AuthContext';
import { hasContainerSubWritePermission } from '../../../../../../utils/permissionUtils';
import { filterMenuItemsForReadOnly } from '../../../../../../utils/rbacUi';
import { isSystemResource, getSystemResourceProtectionHint } from '../../../../../../utils/harvesterUtils';
import {
  deleteGateway,
  deleteHttpRoute,
  deleteGrpcRoute,
  deleteGatewayClass,
  createGatewayClass,
  patchHarvesterContainerResource,
  fetchGatewayDetail,
  fetchHttpRouteDetail,
  fetchGrpcRouteDetail,
  updateGateway,
  updateHttpRoute,
  updateGrpcRoute,
} from '../../../../../../services/harvesterApi';
import { GatewayFormModal, HTTPRouteFormModal, GRPCRouteFormModal, YamlEditModal } from '../components';

interface GatewayApiSectionProps {
  cloudId: string;
  gatewayApiStatus: { installed: boolean; resources: { gatewayClass: boolean; gateway: boolean; httpRoute: boolean; grpcRoute: boolean } } | null;
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
  const [aliasResourceType, setAliasResourceType] = useState<'gateway' | 'httproute' | 'grpcroute' | null>(null);
  
  // 创建弹窗状态
  const [gatewayModalOpen, setGatewayModalOpen] = useState(false);
  const [httpRouteModalOpen, setHttpRouteModalOpen] = useState(false);
  const [grpcRouteModalOpen, setGrpcRouteModalOpen] = useState(false);
  const [gatewayClassModalOpen, setGatewayClassModalOpen] = useState(false);
  const [gatewayClassForm] = Form.useForm<{ name: string; controllerName: string; description?: string }>();
  const [gatewayClassSubmitting, setGatewayClassSubmitting] = useState(false);

  // YAML 编辑状态
  const [yamlEditingRecord, setYamlEditingRecord] = useState<any>(null);
  const [yamlEditingType, setYamlEditingType] = useState<'gateway' | 'httproute' | 'grpcroute' | null>(null);

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
  const handleOpenAliasModal = useCallback((record: any, resourceType: 'gateway' | 'httproute' | 'grpcroute') => {
    const currentAlias = record?.metadata?.annotations?.['tower.io/alias'] || '';
    setAliasRecord(record);
    setAliasResourceType(resourceType);
    setAliasModalVisible(true);
    aliasForm.setFieldsValue({ alias: String(currentAlias || '') });
  }, [aliasForm]);

  // 别名编辑 - 提交
  const handleSubmitAlias = useCallback(async (nextAliasRaw?: string) => {
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
        patchBody.push({ op: 'add', path: '/metadata/annotations', value: { 'tower.io/alias': next } });
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
      onRefresh(true);
      return true;
    } catch (e: any) {
      console.error(e);
      message.error(e?.message || '名称修改失败');
      return false;
    } finally {
      setAliasSubmitting(false);
    }
  }, [aliasRecord, aliasResourceType, getApiPath, cloudId, onRefresh, aliasForm]);

  // YAML 编辑 - 加载 YAML
  const handleLoadYaml = useCallback(async () => {
    if (!yamlEditingRecord || !yamlEditingType) return '';
    const ns = yamlEditingRecord?.metadata?.namespace;
    const name = yamlEditingRecord?.metadata?.name;
    
    let response: any;
    switch (yamlEditingType) {
      case 'gateway':
        response = await fetchGatewayDetail(cloudId, ns, name);
        break;
      case 'httproute':
        response = await fetchHttpRouteDetail(cloudId, ns, name);
        break;
      case 'grpcroute':
        response = await fetchGrpcRouteDetail(cloudId, ns, name);
        break;
    }
    
    return response?.data ? JSON.stringify(response.data, null, 2) : '';
  }, [cloudId, yamlEditingRecord, yamlEditingType]);

  // YAML 编辑 - 保存 YAML
  const handleSaveYaml = useCallback(async (yaml: string) => {
    if (!yamlEditingRecord || !yamlEditingType) return;
    const ns = yamlEditingRecord?.metadata?.namespace;
    const name = yamlEditingRecord?.metadata?.name;
    
    let data: any;
    try {
      data = JSON.parse(yaml);
    } catch (e) {
      message.error('YAML 格式错误');
      return;
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
  }, [cloudId, yamlEditingRecord, yamlEditingType]);

  // 打开 YAML 编辑弹窗
  const handleOpenYamlEdit = useCallback((record: any, type: 'gateway' | 'httproute' | 'grpcroute') => {
    setYamlEditingRecord(record);
    setYamlEditingType(type);
  }, []);

  // 关闭 YAML 编辑弹窗
  const handleCloseYamlEdit = useCallback(() => {
    setYamlEditingRecord(null);
    setYamlEditingType(null);
  }, []);

  // YAML 编辑成功回调
  const handleYamlEditSuccess = useCallback(() => {
    setYamlEditingRecord(null);
    setYamlEditingType(null);
    onRefresh(true);
  }, [onRefresh]);

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
      render: (text: string) => text ? new Date(text).toLocaleString() : '-',
      sorter: (a: any, b: any) => new Date(a?.metadata?.creationTimestamp || 0).getTime() - new Date(b?.metadata?.creationTimestamp || 0).getTime(),
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
            items={filterMenuItemsForReadOnly([
              {
                key: 'delete',
                label: '删除',
                danger: true,
                disabled: isSystem,
                tooltip: systemHint,
                onClick: () => {
                  Modal.confirm({
                    title: '确认删除',
                    content: `确定要删除 GatewayClass "${record?.metadata?.name}" 吗？`,
                    okText: '删除',
                    okType: 'danger',
                    cancelText: '取消',
                    onOk: () => handleDeleteGatewayClass(record),
                  });
                }
              }
            ], hasContainersWrite)}
          />
        );
      },
    },
  ];

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
            <span>{hasAlias ? alias : id}</span>
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
      dataIndex: ['status', 'conditions'],
      key: 'status',
      render: (conditions: any[]) => {
        const ready = conditions?.find(c => c.type === 'Ready');
        return ready?.status === 'True' 
          ? <Tag color="green">Ready</Tag>
          : <Tag color="orange">Not Ready</Tag>;
      },
    },
    {
      title: '创建时间',
      dataIndex: ['metadata', 'creationTimestamp'],
      key: 'createdAt',
      render: (text: string) => text ? new Date(text).toLocaleString() : '-',
      sorter: (a: any, b: any) => new Date(a?.metadata?.creationTimestamp || 0).getTime() - new Date(b?.metadata?.creationTimestamp || 0).getTime(),
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
            items={filterMenuItemsForReadOnly([
              {
                key: 'yaml',
                label: 'YAML 编辑',
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
                  Modal.confirm({
                    title: '确认删除',
                    content: `确定要删除 Gateway "${displayName}" 吗？`,
                    okText: '删除',
                    okType: 'danger',
                    cancelText: '取消',
                    onOk: () => handleDeleteGateway(record),
                  });
                }
              }
            ], hasContainersWrite)}
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
      render: (text: string) => text ? new Date(text).toLocaleString() : '-',
      sorter: (a: any, b: any) => new Date(a?.metadata?.creationTimestamp || 0).getTime() - new Date(b?.metadata?.creationTimestamp || 0).getTime(),
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
            items={filterMenuItemsForReadOnly([
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
                  Modal.confirm({
                    title: '确认删除',
                    content: `确定要删除 HTTPRoute "${displayName}" 吗？`,
                    okText: '删除',
                    okType: 'danger',
                    cancelText: '取消',
                    onOk: () => handleDeleteHttpRoute(record),
                  });
                }
              }
            ], hasContainersWrite)}
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
      render: (text: string) => text ? new Date(text).toLocaleString() : '-',
      sorter: (a: any, b: any) => new Date(a?.metadata?.creationTimestamp || 0).getTime() - new Date(b?.metadata?.creationTimestamp || 0).getTime(),
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
            items={filterMenuItemsForReadOnly([
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
                  Modal.confirm({
                    title: '确认删除',
                    content: `确定要删除 GRPCRoute "${displayName}" 吗？`,
                    okText: '删除',
                    okType: 'danger',
                    cancelText: '取消',
                    onOk: () => handleDeleteGrpcRoute(record),
                  });
                }
              }
            ], hasContainersWrite)}
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
      onRefresh(true);
    } catch (error: any) {
      message.error(`删除失败: ${error?.message || '未知错误'}`);
    }
  };

  // 删除 HTTPRoute
  const handleDeleteHttpRoute = async (record: any) => {
    try {
      await deleteHttpRoute(cloudId, record.metadata.namespace, record.metadata.name);
      message.success('HTTPRoute 删除成功');
      onRefresh(true);
    } catch (error: any) {
      message.error(`删除失败: ${error?.message || '未知错误'}`);
    }
  };

  // 删除 GRPCRoute
  const handleDeleteGrpcRoute = async (record: any) => {
    try {
      await deleteGrpcRoute(cloudId, record.metadata.namespace, record.metadata.name);
      message.success('GRPCRoute 删除成功');
      onRefresh(true);
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
      d = d.filter((g: any) => 
        (g?.metadata?.name || '').toLowerCase().includes(k) ||
        (g?.metadata?.namespace || '').toLowerCase().includes(k)
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
      d = d.filter((r: any) => 
        (r?.metadata?.name || '').toLowerCase().includes(k) ||
        (r?.metadata?.namespace || '').toLowerCase().includes(k)
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
      d = d.filter((r: any) => 
        (r?.metadata?.name || '').toLowerCase().includes(k) ||
        (r?.metadata?.namespace || '').toLowerCase().includes(k)
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
      onRefresh(true);
    } catch (e: any) {
      message.error(e?.message || '创建失败');
    } finally {
      setGatewayClassSubmitting(false);
    }
  }, [cloudId, gatewayClassForm, onRefresh]);

  // 删除 GatewayClass
  const handleDeleteGatewayClass = useCallback(async (record: any) => {
    try {
      await deleteGatewayClass(cloudId, record.metadata.name);
      message.success('GatewayClass 删除成功');
      onRefresh(true);
    } catch (error: any) {
      message.error(`删除失败: ${error?.message || '未知错误'}`);
    }
  }, [cloudId, onRefresh]);

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
            <p>当前集群未安装 Gateway API CRD。Gateway API 是 Kubernetes 下一代流量管理 API，将逐步取代 Ingress。</p>
            <p>请安装 Gateway API CRD 后刷新页面。安装方法：</p>
            <pre style={{ background: '#f5f5f5', padding: 8, borderRadius: 4 }}>
              kubectl apply -f https://github.com/kubernetes-sigs/gateway-api/releases/download/v1.1.0/standard-install.yaml
            </pre>
            <Button type="primary" onClick={() => onRefresh(true)} style={{ marginTop: 8 }}>
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
          <WriteGuard canWrite={hasContainersWrite}>
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => setGatewayClassModalOpen(true)}
            >
              创建
            </Button>
          </WriteGuard>
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
        <button
          type="button"
          className="toolbar-reset-btn"
          onClick={handleReset}
        >
          重置
        </button>
      </div>
      <div className="toolbar-actions">
        {showCreate && renderCreateButton()}
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
            rowKey={(record) => record.metadata.uid || `${record.metadata.namespace}/${record.metadata.name}`}
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
            rowKey={(record) => record.metadata.uid || `${record.metadata.namespace}/${record.metadata.name}`}
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
            rowKey={(record) => record.metadata.uid || `${record.metadata.namespace}/${record.metadata.name}`}
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
          onRefresh(true);
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
          onRefresh(true);
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
          onRefresh(true);
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
              { pattern: /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/, message: '名称只能包含小写字母、数字和连字符' },
            ]}
          >
            <Input placeholder="如: nginx" autoFocus />
          </Form.Item>
          <Form.Item
            name="controllerName"
            label="控制器名称"
            rules={[{ required: true, message: '请输入控制器名称' }]}
            initialValue="nginx.org/gateway-controller"
          >
            <Input placeholder="如: nginx.org/gateway-controller" />
          </Form.Item>
          <Form.Item
            name="description"
            label="描述"
          >
            <Input placeholder="可选描述" />
          </Form.Item>
        </Form>
        <Alert
          type="info"
          showIcon
          message="GatewayClass 定义了 Gateway 的控制器实现。常见控制器包括："
          description={
            <ul style={{ margin: '8px 0 0', paddingLeft: 20 }}>
              <li><code>nginx.org/gateway-controller</code> - NGINX Gateway Fabric</li>
              <li><code>istio.io/gateway-controller</code> - Istio</li>
              <li><code>envoyproxy.io/gateway-controller</code> - Envoy Gateway</li>
            </ul>
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

      {/* YAML 编辑弹窗 */}
      {yamlEditingRecord && yamlEditingType && (
        <YamlEditModal
          visible={true}
          title={`YAML 编辑 - ${yamlEditingType === 'gateway' ? 'Gateway' : yamlEditingType === 'httproute' ? 'HTTPRoute' : 'GRPCRoute'}/${yamlEditingRecord?.metadata?.namespace}/${yamlEditingRecord?.metadata?.name}`}
          cloudId={cloudId}
          namespace={yamlEditingRecord?.metadata?.namespace}
          name={yamlEditingRecord?.metadata?.name}
          resourceType={yamlEditingType}
          onLoadYaml={handleLoadYaml}
          onSaveYaml={handleSaveYaml}
          onCancel={handleCloseYamlEdit}
          onSuccess={handleYamlEditSuccess}
        />
      )}
    </PageDetailSection>
  );
};

export default GatewayApiSection;