import React, { useState, useMemo, useEffect } from 'react';
import { Table, Button, Space, Modal, Input, Tag, Tooltip, Tabs, Form, Select, message, Switch, Radio } from 'antd';
import { ReloadOutlined, PlusOutlined, MinusCircleOutlined, SearchOutlined, ApartmentOutlined } from '@ant-design/icons';
import { useParams } from 'react-router-dom';
import PageDetailSection from '../../../../../components/PageDetailSection';
import ResourceActionsDropdown from '../../../../../components/ResourceActionsDropdown';
import TableColumnSettingsButton from '../../../../../components/TableColumnSettingsButton';
import { useTableColumnSettings } from '../../../../../hooks/useTableColumnSettings';
import HarvesterResourceDrawer from '../../components/HarvesterOpsinfoDrawer';
import { createHarvesterVpc, fetchHarvesterNamespaces, createKubeOvnSubnet, deleteHarvesterVpc, deleteKubeOvnSubnet, updateKubeOvnSubnet, updateHarvesterVpc, createHarvesterNad } from '../../../../../services/harvesterApi';
import { isSystemNamespace } from '../../../../../utils/harvesterUtils';
import { useAuth } from '../../../../../contexts/AuthContext';
import { hasPermissionForAction } from '../../../../../utils/accessMapping';
import {
  KUBE_OVN_FLAT_VPC,
  KUBE_OVN_PUBLIC_VPC,
  KUBE_OVN_PROVIDER_VPC,
  isBuiltInKubeOvnVpc,
} from '../lib/kubeOvnSubnetConstants';

/**
 * 接口定义
 */
interface KubeOvnVpcsSectionProps {
  cloudId?: string;
  vpcs: any[];
  subnets?: any[];
  namespaces?: any[];
  loading: boolean;
  onRefresh?: (force?: boolean, silent?: boolean) => void;
  bordered?: boolean;
  showYaml?: boolean;
}

/**
 * 数据提取辅助函数 (统一处理 CRD 结构兼容性)
 */
const SafeRead = {
  name: (data: any) => data?.name || data?.metadata?.name || '',
  alias: (data: any) => data?.metadata?.annotations?.['tower.io/alias'] || '',
  displayName: (data: any) => data?.metadata?.annotations?.['tower.io/alias'] || data?.name || data?.metadata?.name || '',
  uid: (data: any) => data?.uid || data?.metadata?.uid || '',
  creationTimestamp: (data: any) => data?.createdAt || data?.metadata?.creationTimestamp,
  
  // VPC 特有字段
  vpcCidr: (data: any) => data?.cidr || data?.spec?.cidr || '-',
  vpcNamespaces: (data: any) => data?.namespaces || data?.spec?.namespaces || [],
  vpcNamespace: (data: any) => {
    // 优先取 metadata.namespace (VPC 自身的 Namespace)
    // 其次尝试从 spec.namespaces 中取第一个 (绑定的 Namespaces)
    // 最后返回 default
    const selfNs = data?.namespace || data?.metadata?.namespace;
    if (selfNs && selfNs !== 'default') return selfNs;
    
    const boundNs = data?.namespaces || data?.spec?.namespaces;
    if (Array.isArray(boundNs) && boundNs.length > 0) return boundNs[0];

    return 'default';
  },
  
  // Subnet 特有字段
  subnetVpc: (data: any) => data?.vpc || data?.spec?.vpc || KUBE_OVN_PUBLIC_VPC,
  subnetCidr: (data: any) => data?.cidr || data?.spec?.cidrBlock || data?.spec?.cidr || '-',
  subnetNamespace: (data: any) => {
    const provider = data?.provider || data?.spec?.provider;
    if (provider) {
       const parts = provider.split('.');
       // 倒数第二个部分通常是 Namespace (处理 Name 中可能包含点的情况)
       if (parts.length >= 2) return parts[parts.length - 2];
    }
    return '-';
  },
  subnetGateway: (data: any) => data?.gateway || data?.spec?.gateway || '-',
  subnetProtocol: (data: any) => data?.protocol || data?.spec?.protocol || 'IPv4',
  subnetPrivate: (data: any) => !!(data?.private || data?.spec?.private),
  subnetNat: (data: any) => !!(data?.nat || data?.spec?.natOutgoing),
  subnetDhcp: (data: any) =>
    data?.allowDhcp ?? data?.spec?.enableDHCP ?? data?.spec?.enableDhcp ?? true,
  subnetExcludeIps: (data: any) => data?.excludeIps || data?.spec?.excludeIps || [],
};

const SUBNET_TYPE_ANNOTATION_KEY = 'tower.io/subnet-type';
const SUBNET_FINALIZER = 'tower.io/managed';

// Helper
const generateResourceId = (prefix: string) => `id-${prefix}-${Math.random().toString(36).substring(2, 13)}`;

/**
 * 组件: KubeOvnVpcsSection
 * 描述: 展示 Kube-OVN VPC 列表及其关联子网。
 *
 * 本页「添加 VPC 子网」创建的是注解 tower.io/subnet-type=vpc 的 Subnet，挂在当前业务 VPC 下；
 * 与 NAD 列表（NadsSection）、扁平/公共子网（UnderlaySubnetsSection，flat/public）区分，参见各文件头注释。
 */
const KubeOvnVpcsSection: React.FC<KubeOvnVpcsSectionProps> = ({ 
  cloudId: propCloudId,
  vpcs = [], 
  subnets = [], 
  namespaces: propNamespaces,
  loading, 
  onRefresh,
  bordered = true,
  showYaml = true,
}) => {
  const { user } = useAuth();
  const perms = useMemo(() => (user?.permissions ?? []) as string[], [user?.permissions]);
  const hasVpcsWrite = useMemo(
    () => hasPermissionForAction(perms, 'clouds.vpcs:write') || hasPermissionForAction(perms, 'clouds:write'),
    [perms],
  );
  // --- State ---
  const { id: paramCloudId } = useParams<{ id: string }>();
  const cloudId = propCloudId || paramCloudId;
  const [searchText, setSearchText] = useState('');
  const [namespaceFilter, setNamespaceFilter] = useState<string>('');
  
  // 命名空间选项（用于筛选下拉框）
  const namespaceOptions = useMemo(() => {
    const nsSet = new Set<string>();
    vpcs.forEach((vpc: any) => {
      const nsList = SafeRead.vpcNamespaces(vpc);
      if (Array.isArray(nsList)) {
        nsList.forEach((ns: string) => {
          if (ns && !isSystemNamespace(ns)) {
            nsSet.add(ns);
          }
        });
      }
    });
    return Array.from(nsSet).sort().map(ns => ({
      label: ns,
      value: ns
    }));
  }, [vpcs]);
  
  // Drawer State
  const [drawerVisible, setDrawerVisible] = useState(false);
  const [currentDrawerRecord, setCurrentDrawerRecord] = useState<any>(null);
  const [drawerTab, setDrawerTab] = useState<string>('detail');
  const [currentDrawerType, setCurrentDrawerType] = useState<string>('Vpc');
  
  // Create Modal State
  const [createModalVisible, setCreateModalVisible] = useState(false);
  const [creating, setCreating] = useState(false);
  const [form] = Form.useForm();
  const [isEditVpc, setIsEditVpc] = useState(false);
  const [currentVpc, setCurrentVpc] = useState<any>(null);

  // Create Subnet State
  const [createSubnetModalVisible, setCreateSubnetModalVisible] = useState(false);
  const [creatingSubnet, setCreatingSubnet] = useState(false);
  const [subnetForm] = Form.useForm();
  const [targetVpc, setTargetVpc] = useState<string>('');
  const [targetNamespace, setTargetNamespace] = useState<string>('default');
  const [isEditSubnet, setIsEditSubnet] = useState(false);
  const [currentSubnet, setCurrentSubnet] = useState<any>(null);
  
  // Namespaces State
  const [namespaces, setNamespaces] = useState<any[]>([]);
  const [nsLoading, setNsLoading] = useState(false);

  useEffect(() => {
    // 优先使用父组件传入的 namespaces
    if (propNamespaces) {
      setNamespaces(propNamespaces);
      return;
    }

    if (cloudId) {
      setNsLoading(true);
      fetchHarvesterNamespaces(cloudId, false, true) // excludeSystem=true
        .then((res: any) => {
          // 兼容不同的返回格式: { data: { items: [...] } } 或 { data: [...] } 或 { items: [...] } 或直接数组
          const items: any[] = Array.isArray(res?.data?.items) 
            ? res.data.items 
            : (Array.isArray(res?.data) 
              ? res.data 
              : (Array.isArray(res?.items) 
                ? res.items 
                : (Array.isArray(res) ? res : [])));
          // 后端已过滤系统命名空间
          setNamespaces(items);
        })
        .catch(() => {
          // silent fail
        })
        .finally(() => {
          setNsLoading(false);
        });
    }
  }, [cloudId, propNamespaces]);

  // --- Logic ---
  
  const handleOpenCreateVpc = () => {
    if (!hasVpcsWrite) {
      message.error('无权限执行该操作');
      return;
    }
    setIsEditVpc(false);
    setCurrentVpc(null);
    form.resetFields();
    setCreateModalVisible(true);
  };

  const handleEditVpc = (record: any) => {
    if (!hasVpcsWrite) {
      message.error('无权限执行该操作');
      return;
    }
    const name = SafeRead.name(record);
    const alias = SafeRead.alias(record) || name;
    const namespaces = SafeRead.vpcNamespaces(record);
    // 取第一个命名空间（单选模式）
    const namespace = Array.isArray(namespaces) && namespaces.length > 0 ? namespaces[0] : '';
    const staticRoutes = record.spec?.staticRoutes?.map((r: any) => ({
      cidr: r.cidr,
      nextHopIP: r.nextHopIP
    })) || [];

    setIsEditVpc(true);
    setCurrentVpc(record);
    form.resetFields();
    form.setFieldsValue({
      name: alias,
      namespaces: namespace,
      staticRoutes
    });
    setCreateModalVisible(true);
  };

  const handleVpcModalSubmit = async () => {
    if (!hasVpcsWrite) {
      message.error('无权限执行该操作');
      return;
    }
    try {
      const values = await form.validateFields();
      if (!cloudId) {
        message.error('缺少云平台 ID');
        return;
      }
      setCreating(true);

      const payload: any = {
        ...values,
        // 将单个命名空间值转换为数组格式（后端 API 需要数组）
        namespaces: values.namespaces ? [values.namespaces] : [],
        staticRoutes: values.staticRoutes || [],
      };

      if (isEditVpc && currentVpc) {
         const name = SafeRead.name(currentVpc);
         
         // Handle alias update
         payload.annotations = {
           'tower.io/alias': values.name,
         };
         delete payload.name; // remove name as it is alias

         await updateHarvesterVpc(cloudId, name, payload);
         message.success('VPC 更新成功');
      } else {
        // Generate ID for metadata.name
        const generatedName = generateResourceId('vpc');
        payload.name = generatedName;
        payload.annotations = {
          'tower.io/alias': values.name, // Store user input as alias
        };
        
        await createHarvesterVpc(cloudId, payload);
        message.success('VPC 创建成功');
      }
      
      setCreateModalVisible(false);
      form.resetFields();
      // 刷新数据列表（创建后已直接入库，使用 force=true 跳过前端缓存，silent=true 跳过后端全量同步）
      onRefresh?.(true, true);
    } catch (error: any) {
      message.error(`${isEditVpc ? '更新' : '创建'} VPC 失败: ${error.message}`);
    } finally {
      setCreating(false);
    }
  };

  const handleOpenCreateSubnet = (record: any) => {
    if (!hasVpcsWrite) {
      message.error('无权限执行该操作');
      return;
    }
    const vpcName = SafeRead.name(record);
    const ns = SafeRead.vpcNamespace(record); // 使用新的提取逻辑
    setTargetVpc(vpcName);
    setTargetNamespace(ns);
    setIsEditSubnet(false);
    setCurrentSubnet(null);
    subnetForm.resetFields();
    subnetForm.setFieldsValue({
      vpc: vpcName,
      namespace: ns,
      protocol: 'IPv4',
      nat: true,
      allowDhcp: true,
      excludeIps: [],
    });
    setCreateSubnetModalVisible(true);
  };

  const handleEditSubnet = (record: any) => {
    if (!hasVpcsWrite) {
      message.error('无权限执行该操作');
      return;
    }
    const name = SafeRead.name(record);
    const alias = SafeRead.alias(record) || name; // Use alias if available, fallback to name
    const vpcName = SafeRead.subnetVpc(record);
    const cidr = SafeRead.subnetCidr(record);
    const gateway = SafeRead.subnetGateway(record);
    const protocol = SafeRead.subnetProtocol(record);
    const nat = SafeRead.subnetNat(record);
    const allowDhcp = SafeRead.subnetDhcp(record);
    const excludeIps = SafeRead.subnetExcludeIps(record);
    const ns = SafeRead.subnetNamespace(record);

    setTargetVpc(vpcName);
    setTargetNamespace(ns);
    setIsEditSubnet(true);
    setCurrentSubnet(record);
    
    subnetForm.resetFields();
    subnetForm.setFieldsValue({
      name: alias,
      vpc: vpcName,
      namespace: ns,
      cidrBlock: cidr,
      gateway,
      protocol,
      nat,
      allowDhcp,
      excludeIps,
    });
    setCreateSubnetModalVisible(true);
  };

  const handleSubnetModalSubmit = async () => {
    if (!hasVpcsWrite) {
      message.error('无权限执行该操作');
      return;
    }
    try {
      const values = await subnetForm.validateFields();
      if (!cloudId) {
        message.error('缺少云平台 ID');
        return;
      }
      setCreatingSubnet(true);
      
      const payload: any = {
        ...values,
        vpc: targetVpc,
        namespace: targetNamespace,
        excludeIps: values.excludeIps?.filter((ip: string) => !!ip) || [],
      };

      if (isEditSubnet && currentSubnet) {
        const name = SafeRead.name(currentSubnet);
        
        // Update mode: Map frontend fields to Kube-OVN Spec fields
        payload.enableDHCP = payload.allowDhcp;
        payload.natOutgoing = payload.nat;
        delete payload.allowDhcp;
        delete payload.nat;

        // Handle alias update
        payload.annotations = {
          'tower.io/alias': values.name,
        };
        // Remove name from payload (since it's now the alias value from form)
        delete payload.name;

        await updateKubeOvnSubnet(cloudId, name, payload);
        message.success('子网更新成功');
      } else {
        // Create mode: Generate ID and set alias
        const generatedName = generateResourceId('sub');
        payload.name = generatedName;
        payload.allowEWTraffic = false;
        payload.annotations = {
          'tower.io/alias': values.name,
          [SUBNET_TYPE_ANNOTATION_KEY]: 'vpc',
        };
        payload.finalizers = Array.from(new Set([...(Array.isArray(payload?.finalizers) ? payload.finalizers : []), SUBNET_FINALIZER]));
        
        // 创建子网前，先创建对应的 NAD（Kube-OVN 要求）
        // NAD 名称必须与子网名称相同
        try {
          const nadPayload = {
            type: 'k8s.cni.cncf.io.networkattachmentdefinition',
            metadata: {
              name: generatedName,
              namespace: targetNamespace,
              annotations: {
                'tower.io/alias': values.name,
              },
            },
            spec: {
              config: JSON.stringify({
                cniVersion: '0.3.1',
                name: generatedName,
                type: 'kube-ovn',
                server_socket: '/run/openvswitch/kube-ovn-daemon.sock',
                provider: `${generatedName}.${targetNamespace}.ovn`,
              }),
            },
          };
          
          try {
            await createHarvesterNad(cloudId, nadPayload);
          } catch (nadError: any) {
            // 如果 NAD 已存在，忽略错误继续创建子网
            if (nadError.message?.includes('already exists') || nadError.message?.includes('AlreadyExists')) {
              // NAD 已存在，继续创建子网
            } else if (nadError.message?.includes('being terminated') || nadError.message?.includes('terminating')) {
              // 命名空间正在终止，无法创建资源
              const errorMsg = `无法在命名空间 ${targetNamespace} 中创建资源：该命名空间正在被终止。请选择其他命名空间或等待命名空间删除完成。`;
              message.error(errorMsg);
              throw new Error(errorMsg);
            } else {
              throw nadError;
            }
          }
        } catch (nadError: any) {
          // 如果错误已经处理过（如命名空间终止），直接抛出
          if (nadError.message?.includes('正在被终止')) {
            throw nadError;
          }
          // 其他错误，显示详细错误信息
          const errorMsg = nadError.message || '未知错误';
          message.error(`创建 NAD 失败: ${errorMsg}`);
          throw nadError;
        }
        
        await createKubeOvnSubnet(cloudId, payload);
        message.success('子网创建成功');
      }

      setCreateSubnetModalVisible(false);
      // 刷新数据列表（创建后已直接入库，使用 force=true 跳过前端缓存，silent=true 跳过后端全量同步）
      onRefresh?.(true, true);
    } catch (error: any) {
      // 如果错误信息已经包含友好的提示（如命名空间终止），直接显示
      if (error.message?.includes('正在被终止')) {
        // 错误已在创建 NAD 时显示，这里不再重复显示
      } else {
        // 其他错误，显示详细错误信息
        const errorMsg = error.message || '未知错误';
        // 检查是否是命名空间终止相关的错误
        if (errorMsg.includes('being terminated') || errorMsg.includes('terminating')) {
          message.error(`创建子网失败: 命名空间 ${targetNamespace} 正在被终止，无法创建资源。请选择其他命名空间。`);
        } else {
          message.error(`${isEditSubnet ? '更新' : '创建'}子网失败: ${errorMsg}`);
        }
      }
    } finally {
      setCreatingSubnet(false);
    }
  };

  const handleDelete = (record: any) => {
    if (!hasVpcsWrite) {
      message.error('无权限执行该操作');
      return;
    }
    const name = SafeRead.name(record);
    if (!cloudId || !name) return;

    Modal.confirm({
      title: `删除 VPC: ${name}`,
      content: '确认要删除此 VPC 吗？此操作不可撤销，且会同时删除关联的子网。',
      okType: 'danger',
      onOk: async () => {
        try {
          await deleteHarvesterVpc(cloudId, name);
          message.success('删除成功');
          onRefresh?.(true);
        } catch (e: any) {
          message.error(`删除失败: ${e.message}`);
        }
      },
    });
  };

  const handleDeleteSubnet = (record: any) => {
    if (!hasVpcsWrite) {
      message.error('无权限执行该操作');
      return;
    }
    const name = SafeRead.name(record);
    if (!cloudId || !name) return;

    Modal.confirm({
      title: `删除子网: ${name}`,
      content: '确认要删除此子网吗？此操作不可撤销。',
      okType: 'danger',
      onOk: async () => {
        try {
          await deleteKubeOvnSubnet(cloudId, name);
          message.success('删除成功');
          onRefresh?.(true);
        } catch (e: any) {
          message.error(`删除失败: ${e.message}`);
        }
      },
    });
  };

  // 过滤逻辑
  const dataSource = useMemo(() => {
    let filtered = vpcs;

    // 过滤内置 VPC（不展示）：与后端 kubeOvnNetworkScope / 前端 lib/kubeOvnSubnetConstants 一致
    filtered = filtered.filter((item) => {
      const name = SafeRead.name(item);
      return !isBuiltInKubeOvnVpc(name);
    });

    // 搜索过滤
    if (searchText) {
      const key = searchText.toLowerCase().trim();
      filtered = filtered.filter(item => {
        const name = SafeRead.name(item).toLowerCase();
        const uid = SafeRead.uid(item).toLowerCase();
        const alias = String(SafeRead.alias(item) || '').toLowerCase();
        return name.includes(key) || uid.includes(key) || alias.includes(key);
      });
    }

    // 命名空间过滤
    if (namespaceFilter) {
      filtered = filtered.filter(item => {
        const nsList = SafeRead.vpcNamespaces(item);
        if (!Array.isArray(nsList)) return false;
        return nsList.includes(namespaceFilter);
      });
    }

    return filtered;
  }, [vpcs, searchText, namespaceFilter]);

  // 详情抽屉
  const handleShowYaml = (record: any, type: string) => {
    setCurrentDrawerRecord(record);
    setCurrentDrawerType(type);
    setDrawerTab(record?.links?.view ? 'view_link' : 'detail');
    setDrawerVisible(true);
  };

  // --- Columns ---

  // 子网列定义
  const subnetColumns = [
    {
      title: '名称',
      key: 'subnetAlias',
      ellipsis: true,
      render: (_: any, r: any) => {
        const alias = String(SafeRead.alias(r) || '').trim();
        const display = alias || '—';
        return (
          <span style={{ display: 'flex', alignItems: 'center', gap: 6, maxWidth: '100%' }}>
            <ApartmentOutlined style={{ color: '#1677ff', fontSize: 16, flexShrink: 0 }} />
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }} title={alias || undefined}>
              {display}
            </span>
          </span>
        );
      },
    },
    {
      title: 'ID',
      key: 'subnetId',
      ellipsis: true,
      render: (_: any, r: any) => {
        const name = SafeRead.name(r);
        return <span className="std-time" title={name}>{name || '—'}</span>;
      },
    },
    {
      title: 'CIDR',
      key: 'cidr',
      render: (_: any, r: any) => <Tag>{SafeRead.subnetCidr(r)}</Tag>,
    },
    {
      title: 'Namespace',
      key: 'namespace',
      render: (_: any, r: any) => <Tag>{SafeRead.subnetNamespace(r)}</Tag>,
    },
    {
      title: '网关',
      key: 'gateway',
      render: (_: any, r: any) => SafeRead.subnetGateway(r),
    },
    {
      title: '协议',
      key: 'protocol',
      render: (_: any, r: any) => SafeRead.subnetProtocol(r),
    },
    {
      title: '类型',
      key: 'type',
      render: (_: any, r: any) => {
        const isPrivate = SafeRead.subnetPrivate(r);
        const isNat = SafeRead.subnetNat(r);
        return (
          <Space size={4}>
            {isPrivate && <Tag color="gold">Private</Tag>}
            {isNat && <Tag color="blue">NAT</Tag>}
            {!isPrivate && !isNat && <Tag>Standard</Tag>}
          </Space>
        );
      },
    },
    {
      title: '操作',
      key: 'actions',
      width: 80,
      fixed: 'right' as const,
      render: (_: any, r: any) => {
        const items = [
          { key: 'edit', label: '编辑子网', disabled: !hasVpcsWrite, onClick: () => handleEditSubnet(r) },
          ...(showYaml ? [{ key: 'view_yaml', label: '查看YAML', onClick: () => handleShowYaml(r, 'Subnet') }] : []),
          { type: 'divider' as const },
          { key: 'delete', label: '删除', danger: true, disabled: !hasVpcsWrite, onClick: () => handleDeleteSubnet(r) },
        ];
        return <ResourceActionsDropdown items={items} buttonProps={{ className: 'row-actions-trigger', disabled: !hasVpcsWrite }} />;
      },
    },
  ];

  // VPC 列定义
  const allColumns = useMemo(() => [
    {
      title: '名称',
      key: 'vpcAlias',
      ellipsis: true,
      render: (_: any, r: any) => {
        const name = SafeRead.name(r);
        const alias = String(SafeRead.alias(r) || '').trim();
        const display = alias || '—';
        let tag = null;
        if (name === KUBE_OVN_PUBLIC_VPC) tag = <Tag color="gold">公共</Tag>;
        if (name === KUBE_OVN_FLAT_VPC) tag = <Tag color="cyan">扁平</Tag>;
        if (name === KUBE_OVN_PROVIDER_VPC) {
          tag = <Tag color="purple">Provider</Tag>;
        }
        return (
          <span style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', maxWidth: '100%' }}>
            <ApartmentOutlined style={{ color: '#1677ff'}} />
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }} title={alias || undefined}>
              {display}
            </span>
            {tag}
          </span>
        );
      },
    },
    {
      title: 'ID',
      key: 'vpcId',
      ellipsis: true,
      render: (_: any, r: any) => {
        const name = SafeRead.name(r);
        return <span className="std-time" title={name}>{name || '—'}</span>;
      },
    },
    {
      title: 'UID',
      key: 'uid',
      render: (_: any, r: any) => {
        const uid = SafeRead.uid(r);
        if (!uid) return '-';
        return <span>{uid}</span>;
      },
    },
    {
      title: 'CIDR',
      key: 'cidr',
      render: (_: any, r: any) => <Tag>{SafeRead.vpcCidr(r)}</Tag>,
    },
    {
      title: '命名空间',
      key: 'namespace',
      render: (_: any, r: any) => {
        const ns = SafeRead.vpcNamespaces(r);
        if (Array.isArray(ns) && ns.length > 0) {
          return <span>{ns.join('、')}</span>;
        }
        return '-';
      },
    },
    {
      title: '创建时间',
      key: 'createdAt',
      render: (_: any, r: any) => {
        const time = SafeRead.creationTimestamp(r);
        return time ? new Date(time).toLocaleString() : '-';
      },
    },
    {
      title: '操作',
      key: 'actions',
      width: 80,
      fixed: 'right' as const,
      render: (_: any, r: any) => {
        const name = SafeRead.name(r);
        const isSystem = isBuiltInKubeOvnVpc(name);
        const items = [
          { key: 'edit', label: '编辑VPC', disabled: !hasVpcsWrite, onClick: () => handleEditVpc(r) },
          { key: 'createSubnet', label: '添加 VPC 子网', disabled: !hasVpcsWrite, onClick: () => handleOpenCreateSubnet(r) },
          ...(showYaml ? [{ key: 'view_yaml', label: '查看YAML', onClick: () => handleShowYaml(r, 'Vpc') }] : []),
          ...(!isSystem ? [
            { type: 'divider' as const },
            { key: 'delete', label: '删除', danger: true, disabled: !hasVpcsWrite, onClick: () => handleDelete(r) }
          ] : []),
        ];
        return <ResourceActionsDropdown items={items} buttonProps={{ className: 'row-actions-trigger', disabled: !hasVpcsWrite }} />;
      },
    },
  ], [cloudId, onRefresh, hasVpcsWrite]);

  // --- Render Helpers ---

  const renderExpandedRow = (record: any) => {
    const vpcName = SafeRead.name(record);
    
    // 核心关联逻辑：筛选出 spec.vpc 等于当前 VPC 名称的子网
    const relatedSubnets = subnets.filter(s => {
      const targetVpc = SafeRead.subnetVpc(s);
      return String(targetVpc).trim() === String(vpcName).trim();
    });

    if (relatedSubnets.length === 0) {
      return <div>暂无关联子网</div>;
    }

    return (
      <div style={{ padding: 12,  background: '#EDF0F7', border: '1px solid #e5e5e5', borderRadius: 8 }}>
        <Table
          columns={subnetColumns}
          dataSource={relatedSubnets}
          pagination={false}
          rowKey={(r) => SafeRead.name(r) || Math.random().toString()}
          size="small"
          bordered={false}
        />
      </div>
    );
  };

  // 列显示设置（需要在 allColumns 定义之后）
  const { displayColumns: tableColumns } = useTableColumnSettings(allColumns, 'harvester_vpcs_table');

  // --- Main Render ---

  return (
    <PageDetailSection
      
      toolbarLeft={(
        <Space>
          <Input 
            className="toolbar-search"
            placeholder="名称/ID" 
            value={searchText} 
            onChange={(e) => setSearchText(e.target.value)} 
            allowClear
            suffix={<SearchOutlined style={{ color: 'rgba(0,0,0,.45)' }} />}
          />
          <Select
            className="toolbar-filter-sm"
            placeholder="选择命名空间"
            allowClear
            showSearch
            value={namespaceFilter || undefined}
            onChange={setNamespaceFilter}
            options={namespaceOptions}
            loading={nsLoading}
          />
          <button
            type="button"
            className="toolbar-reset-btn"
            onClick={() => {
              setSearchText('');
              setNamespaceFilter('');
            }}
          >
            重置
          </button>
        </Space>
      )}
      toolbarRight={(
        <div className="toolbar-actions">
          <Button type="primary" disabled={!hasVpcsWrite} onClick={handleOpenCreateVpc}>创建 VPC</Button>
          <TableColumnSettingsButton 
            allColumns={allColumns} 
            settingsKey="harvester_vpcs_table"
          />
          <Button icon={<ReloadOutlined />} onClick={() => onRefresh?.(true)} loading={loading} />
        </div>
      )}
    >
      <Table
        className="std-table"
        bordered={false}
        rowKey={(r) => SafeRead.name(r) || Math.random().toString()}
        columns={tableColumns}
        dataSource={dataSource}
        loading={loading}
        pagination={{
          size: 'small',
          showTotal: (total) => `共 ${total} 条`,
        }}
        expandable={{
          expandedRowRender: renderExpandedRow,
          rowExpandable: () => true,
        }}
      />

      <HarvesterResourceDrawer
        open={drawerVisible}
        onClose={() => setDrawerVisible(false)}
        resourceType={currentDrawerType}
        record={currentDrawerRecord}
        activeTab={drawerTab}
        onTabChange={setDrawerTab}
        cloudId={cloudId}
      />

      <Modal
        title={`${isEditSubnet ? '编辑 VPC 子网' : '添加 VPC 子网'} (VPC: ${targetVpc})`}
        open={createSubnetModalVisible}
        onOk={handleSubnetModalSubmit}
        onCancel={() => setCreateSubnetModalVisible(false)}
        confirmLoading={creatingSubnet}
        okText={isEditSubnet ? '确定' : '创建'}
        cancelText="取消"
        width={600}
        destroyOnHidden
      >
        <Form form={subnetForm} layout="vertical">
          <Form.Item
            name="name"
            label="名称"
            rules={[
              { required: true, message: '请输入子网名称' },
            ]}
          >
            <Input placeholder="请输入子网名称 (支持中文)" />
          </Form.Item>

          <Form.Item
            name="cidrBlock"
            label="CIDR"
            rules={[
              { required: true, message: '请输入 CIDR' },
              { pattern: /^([0-9]{1,3}\.){3}[0-9]{1,3}\/[0-9]+$/, message: '请输入有效的 CIDR 格式 (e.g. 10.0.1.0/24)' }
            ]}
          >
            <Input placeholder="e.g. 10.0.1.0/24" />
          </Form.Item>

          <Form.Item
            name="gateway"
            label="网关"
            rules={[
              { required: true, message: '请输入网关 IP' },
              { pattern: /^([0-9]{1,3}\.){3}[0-9]{1,3}$/, message: '请输入有效的 IP 地址' }
            ]}
          >
            <Input placeholder="e.g. 10.0.1.1" />
          </Form.Item>

          <Form.Item
            name="protocol"
            label="协议"
            initialValue="IPv4"
          >
            <Radio.Group>
              <Radio.Button value="IPv4">IPv4</Radio.Button>
              <Radio.Button value="IPv6" disabled>IPv6 (暂不支持)</Radio.Button>
            </Radio.Group>
          </Form.Item>

          <Space size={24}>
            <Form.Item
              name="nat"
              label="NAT"
              valuePropName="checked"
              tooltip="是否启用 NAT 转发"
            >
              <Switch />
            </Form.Item>
            
            <Form.Item
              name="allowDhcp"
              label="DHCP"
              valuePropName="checked"
              tooltip="是否启用 DHCP 服务"
            >
              <Switch />
            </Form.Item>
          </Space>

          <Form.Item
            label="排除 IP 范围"
            tooltip="这些 IP 将不会分配给 Pod 或 VM"
            style={{ marginBottom: 0 }}
          >
            <Form.List name="excludeIps">{(fields, { add, remove }) => (
                <>
                  {fields.map(({ key, name, ...restField }) => (
                    <Space key={key} style={{ display: 'flex', marginBottom: 8 }} align="baseline">
                      <Form.Item
                        {...restField}
                        name={name}
                        rules={[{ required: true, message: '请输入 IP 或 IP 范围' }]}
                        style={{ width: 300, marginBottom: 0 }}
                      >
                        <Input placeholder="IP 或 CIDR (e.g. 10.0.1.10..10.0.1.20)" />
                      </Form.Item>
                      <MinusCircleOutlined onClick={() => remove(name)} style={{ color: '#ff4d4f' }} />
                    </Space>
                  ))}
                  <Form.Item style={{ marginTop: 8 }}>
                    <Button type="dashed" onClick={() => add()} block icon={<PlusOutlined />}>
                      添加排除 IP
                    </Button>
                  </Form.Item>
                </>
              )}</Form.List>
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={isEditVpc ? "编辑 VPC" : "创建 VPC"}
        open={createModalVisible}
        onOk={handleVpcModalSubmit}
        onCancel={() => setCreateModalVisible(false)}
        confirmLoading={creating}
        okText={isEditVpc ? '确定' : '创建'}
        cancelText="取消"
        width={600}
        destroyOnHidden
      >
        <Form form={form} layout="vertical">
          <Form.Item
            name="name"
            label="名称"
            rules={[
              { required: true, message: '请输入 VPC 名称' },
            ]}
          >
            <Input placeholder="请输入 VPC 名称 (支持中文)" />
          </Form.Item>
          
          <Form.Item
            name="namespaces"
            label="绑定命名空间"
            tooltip="VPC 将接管该命名空间下的网络流量，实现租户隔离。通常一个 VPC 对应一个命名空间。"
            rules={[{ required: true, message: '请选择命名空间' }]}
          >
            <Select 
              placeholder="选择命名空间" 
              style={{ width: '100%' }}
              loading={nsLoading}
              showSearch
              filterOption={(input, option) =>
                (option?.label ?? '').toLowerCase().includes(input.toLowerCase())
              }
              options={namespaces
                .filter((n: any) => {
                  const name = n?.metadata?.name || n?.name || '';
                  return name && !isSystemNamespace(name);
                })
                .map((n: any) => {
                  const name = n.metadata?.name || n.name || '';
                  return { label: name, value: name };
                })}
            />
          </Form.Item>

          <Form.Item
            label="静态路由"
            tooltip="配置 VPC 内的静态路由规则"
            style={{ marginBottom: 0 }}
          >
            <Form.List name="staticRoutes">{(fields, { add, remove }) => (
                <>
                  {fields.map(({ key, name, ...restField }) => (
                    <Space key={key} style={{ display: 'flex', marginBottom: 8 }} align="baseline">
                      <Form.Item
                        {...restField}
                        name={[name, 'cidr']}
                        rules={[{ required: true, message: '请输入 CIDR' }]}
                        style={{ width: 200, marginBottom: 0 }}
                      >
                        <Input placeholder="CIDR (e.g. 192.168.0.0/24)" />
                      </Form.Item>
                      <Form.Item
                        {...restField}
                        name={[name, 'nextHopIP']}
                        rules={[{ required: true, message: '请输入下一跳 IP' }]}
                        style={{ width: 200, marginBottom: 0 }}
                      >
                        <Input placeholder="Next Hop IP" />
                      </Form.Item>
                      <MinusCircleOutlined onClick={() => remove(name)} style={{ color: '#ff4d4f' }} />
                    </Space>
                  ))}
                  <Form.Item style={{ marginTop: 8 }}>
                    <Button type="dashed" onClick={() => add()} block icon={<PlusOutlined />}>
                      添加静态路由
                    </Button>
                  </Form.Item>
                </>
              )}</Form.List>
          </Form.Item>
        </Form>
      </Modal>
    </PageDetailSection>
  );
};

export default KubeOvnVpcsSection;
