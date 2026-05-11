import React, { useState, useMemo, useEffect } from 'react';
import { Table, Button, Space, Modal, Input, Tag, Tabs, Form, Select, message, Switch, Radio, Row, Col, Checkbox } from 'antd';
import { ReloadOutlined, PlusOutlined, MinusCircleOutlined, SearchOutlined, ApartmentOutlined } from '@ant-design/icons';
import { useParams } from 'react-router-dom';
import PageDetailSection from '../../../../../../components/PageDetailSection';
import ResourceActionsDropdown from '../../../../../../components/ResourceActionsDropdown';
import TableColumnSettingsButton from '../../../../../../components/TableColumnSettingsButton';
import { useTableColumnSettings } from '../../../../../../hooks/useTableColumnSettings';
import HarvesterResourceDrawer from '../../shared/components/HarvesterOpsinfoDrawer';
import { fetchCloudProviderEcs } from '../../../../../../services/api';
import { createHarvesterVpc, fetchHarvesterNamespaces, createKubeOvnSubnet, deleteHarvesterVpc, deleteKubeOvnSubnet, updateKubeOvnSubnet, updateHarvesterVpc } from '../../../../../../services/harvesterApi';
import { isSystemNamespace } from '../../../../../../utils/harvesterUtils';
import { useAuth } from '../../../../../../contexts/AuthContext';
import { hasPermissionForAction } from '../../../../../../utils/accessMapping';
import {
  KUBE_OVN_FLAT_VPC,
  KUBE_OVN_PUBLIC_VPC,
  KUBE_OVN_PROVIDER_VPC,
  isBuiltInKubeOvnVpc,
  isVpcOvnSubnetTableRow,
  TOWER_ALIAS_ANNOTATION,
} from '../lib/kubeOvnSubnetConstants';
import {
  findExcludeIpUsedByAnyVm,
  friendlyMessageIfKubeOvnGatewayNotInCidr,
  isIpv4GatewayInCidr,
  validateFlatSubnetExcludeIpsLocal,
} from '../lib/flatSubnetExcludeIpValidation';
import { useCloudmapOpsViewWrite } from '../../hooks/useCloudmapOpsViewWrite';
import { translateKnownApiErrorMessage } from '../../../../../../utils/k8sErrorMessages';
import { getVpcSubnetDeleteBlockedByNatMessage } from '../lib/flatSubnetNatDeleteGuard';
import { validateIpv4CidrNotation, validateIpv4HostAddress } from '../lib/ipv4CidrValidate';

function normalizeSubnetCidr(c: unknown): string {
  return String(c ?? '')
    .trim()
    .replace(/\s+/g, '');
}

function collectVmDisplayNamesUsingSubnet(subnetName: string, vms: any[]): string[] {
  const sn = String(subnetName || '').trim();
  if (!sn) return [];
  const targetRef = `default/${sn}`.toLowerCase();
  const tail = `/${sn.toLowerCase()}`;
  return vms
    .filter((vm: any) => Array.isArray(vm.networks))
    .filter((vm: any) =>
      vm.networks.some((n: string) => {
        const s = String(n || '').toLowerCase();
        const base = s.includes('@') ? s.split('@')[0] : s;
        return base === targetRef || base.endsWith(tail);
      }),
    )
    .map(
      (vm: any) =>
        vm?.metadata?.annotations?.[TOWER_ALIAS_ANNOTATION] ||
        vm.InstanceName ||
        vm.name ||
        vm.metadata?.name,
    )
    .filter(Boolean) as string[];
}

/**
 * 接口定义
 */
interface KubeOvnVpcsSectionProps {
  cloudId?: string;
  vpcs: any[];
  subnets?: any[];
  namespaces?: any[];
  loading: boolean;
  /** 第三项 opts.vpcsAll 为 true 时请求 GET /vpcs?all=true（运维模式开关） */
  onRefresh?: (
    force?: boolean,
    silent?: boolean,
    opts?: { vpcsAll?: boolean },
  ) => void;
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
    const metaNs = data?.namespace || data?.metadata?.namespace;
    if (metaNs && String(metaNs).trim()) return String(metaNs).trim();
    const provider = data?.provider || data?.spec?.provider;
    if (provider) {
      const parts = String(provider).split('.');
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

/** API / K8s 对象创建时间 → 毫秒（无或无法解析者为 0），用于列表按创建时间倒序 */
function kubeResourceCreatedMs(record: any): number {
  const raw = SafeRead.creationTimestamp(record);
  if (raw == null || raw === '') return 0;
  const t = new Date(String(raw)).getTime();
  return Number.isFinite(t) ? t : 0;
}

const SUBNET_TYPE_ANNOTATION_KEY = 'tower.io/subnet-type';
const SUBNET_FINALIZER = 'tower.io/managed';

/** 创建/编辑 VPC「绑定命名空间」下拉里隐藏的平台命名空间（编辑时若已是当前绑定则仍展示，避免无法回显） */
const VPC_BIND_NAMESPACE_EXCLUDE = new Set(['cloud-public', 'hci-manager-system']);
function isVpcBindNamespaceExcluded(name: string): boolean {
  const n = String(name || '').trim().toLowerCase();
  return Boolean(n) && VPC_BIND_NAMESPACE_EXCLUDE.has(n);
}

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
  const hasOpsView = useCloudmapOpsViewWrite();
  const effectiveShowYaml = showYaml !== false && hasOpsView;
  /** 具备运维视图权限时：是否请求 all=true（含内置/无注解 VPC） */
  const [vpcsQueryAll, setVpcsQueryAll] = useState(false);

  useEffect(() => {
    if (!effectiveShowYaml) setVpcsQueryAll(false);
  }, [effectiveShowYaml]);

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

  const editVpcBoundNamespace = useMemo(() => {
    if (!isEditVpc || !currentVpc) return '';
    const arr = SafeRead.vpcNamespaces(currentVpc);
    return Array.isArray(arr) && arr.length > 0 ? String(arr[0] ?? '').trim() : '';
  }, [isEditVpc, currentVpc]);

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
      onRefresh?.(true, true, { vpcsAll: vpcsQueryAll });
    } catch (error: any) {
      // 表单校验失败时不弹全局错误（字段下已有提示）
      if (Array.isArray(error?.errorFields) && error.errorFields.length > 0) {
        return;
      }
      const label = isEditVpc ? '更新' : '创建';
      const rawFull = String(error?.message ?? error ?? '').trim();
      let detail = rawFull;
      let prev = '';
      while (prev !== detail) {
        prev = detail;
        detail = detail.replace(/^((创建|更新)\s+VPC\s*失败\s*[:：]?\s*)+/i, '').trim();
      }
      detail = translateKnownApiErrorMessage(detail) || detail;
      if (!detail) detail = '未知错误';
      // 占位或非法静态路由常见于 400，给可读说明并避免重复的「xxx 失败: xxx 失败」
      const looksBare400 =
        /^(HTTP\s*400)$/i.test(detail) ||
        /^request failed with status code 400$/i.test(detail) ||
        /^(400)(\s|$)/.test(detail);
      if (looksBare400) {
        detail =
          '请求参数不合法（400）。请检查静态路由：目的网段须为 IPv4 CIDR（例如 192.168.0.0/24），下一跳须为合法 IPv4 地址（例如 10.0.0.1）。';
      }
      message.error(`${label} VPC 失败：${detail}`);
    } finally {
      setCreating(false);
    }
  };

  const handleOpenCreateSubnet = (record: any) => {
    if (!hasVpcsWrite) {
      message.error('无权限执行该操作');
      return;
    }
    const vpcId = SafeRead.name(record);
    const vpcAlias = SafeRead.alias(record) || vpcId;
    const ns = SafeRead.vpcNamespace(record); // 使用新的提取逻辑
    setTargetVpc(vpcAlias);
    setTargetNamespace(ns);
    setIsEditSubnet(false);
    setCurrentSubnet(null);
    subnetForm.resetFields();
    subnetForm.setFieldsValue({
      vpc: vpcId,
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
      excludeIps: Array.isArray(excludeIps) ? excludeIps.join(', ') : excludeIps,
    });
    setCreateSubnetModalVisible(true);
  };

  const handleSubnetModalSubmit = async () => {
    if (!hasVpcsWrite) {
      message.error('无权限执行该操作');
      return;
    }
    try {
      const values = await subnetForm.validateFields().catch(() => {
        // 表单验证失败，不显示顶部错误消息，由表单自动显示验证提示
        return null;
      });
      if (!values) {
        return;
      }
      if (!cloudId) {
        message.error('缺少云平台 ID');
        return;
      }
      const cidrBlock = String(values.cidrBlock || '').trim();
      const excludeIps: string[] =
        values.excludeIps && typeof values.excludeIps === 'string'
          ? String(values.excludeIps)
              .split(/[\n,]/)
              .map((s: string) => s.trim())
              .filter(Boolean)
          : Array.isArray(values.excludeIps)
            ? values.excludeIps.map((ip: unknown) => String(ip || '').trim()).filter(Boolean)
            : [];

      const cidrForExclude =
        isEditSubnet && currentSubnet ? String(SafeRead.subnetCidr(currentSubnet) || '').trim() : cidrBlock;

      const excludeLocal = validateFlatSubnetExcludeIpsLocal(cidrForExclude, excludeIps);
      if (!excludeLocal.ok) {
        message.error(excludeLocal.message);
        return;
      }

      if (!isEditSubnet) {
        const gwTrim = String(values.gateway ?? '').trim();
        const gwInCidr = isIpv4GatewayInCidr(gwTrim, cidrBlock);
        if (gwInCidr === false) {
          message.error('创建VPC子网失败：网关不在CIDR 范围内');
          return;
        }
      }

      let vmList: any[] = [];
      try {
        const ecsRes: any = await fetchCloudProviderEcs(cloudId, true);
        vmList = Array.isArray(ecsRes?.data)
          ? ecsRes.data
          : Array.isArray(ecsRes)
            ? ecsRes
            : [];
      } catch {
        /* ignore */
      }
      const busy = findExcludeIpUsedByAnyVm(excludeIps, vmList);
      if (busy) {
        message.error(
          `${isEditSubnet ? '更新' : '创建'}失败：排除 IP「${busy.ip}」已被虚拟机「${busy.vmLabel}」占用，无法加入排除列表。`,
        );
        return;
      }

      if (isEditSubnet && currentSubnet) {
        const subnetCrName = SafeRead.name(currentSubnet);
        const usingVms =
          vmList.length > 0 ? collectVmDisplayNamesUsingSubnet(String(subnetCrName), vmList) : [];
        if (usingVms.length > 0) {
          const prevCidr = normalizeSubnetCidr(SafeRead.subnetCidr(currentSubnet));
          const nextCidr = normalizeSubnetCidr(cidrBlock);
          if (nextCidr !== prevCidr) {
            message.error(
              `当前子网 ${subnetCrName} 正在被 ${usingVms.slice(0, 5).join('、')}${usingVms.length > 5 ? ' 等 VM 使用' : ''}，不能修改 CIDR 网段。可先改虚拟机网络或释放占用后再调整网段。`,
            );
            return;
          }
        }
      }

      setCreatingSubnet(true);

      // 须使用 Kube-OVN VPC CR 的 metadata.name（spec.vpc），不能用 tower.io/alias。
      // targetVpc 仅用于弹窗标题展示，此前写入 payload 会导致与「子网」页新建不一致并报集群错误。
      const vpcCrName = String(values.vpc ?? '').trim();
      if (!vpcCrName) {
        message.error('缺少所属 VPC，请关闭弹窗后从 VPC 列表重新打开');
        setCreatingSubnet(false);
        return;
      }

      const payload: any = {
        ...values,
        vpc: vpcCrName,
        namespace: targetNamespace,
        excludeIps,
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

        // NAD 由后端 POST /resources/subnets（harvesterSubnetDirectCreateHandler）与子网一并创建，避免与 Harvester webhook 对 provider 的校验分叉。

        await createKubeOvnSubnet(cloudId, payload);
        message.success('子网创建成功');
      }

      setCreateSubnetModalVisible(false);
      // 刷新数据列表（创建后已直接入库，使用 force=true 跳过前端缓存，silent=true 跳过后端全量同步）
      onRefresh?.(true, true, { vpcsAll: vpcsQueryAll });
    } catch (error: any) {
      // 如果错误信息已经包含友好的提示（如命名空间终止），直接显示
      if (error.message?.includes('正在被终止')) {
        // 错误已在创建 NAD 时显示，这里不再重复显示
      } else {
        const friendlyGw = friendlyMessageIfKubeOvnGatewayNotInCidr(error, 'vpc');
        if (friendlyGw) {
          message.error(friendlyGw);
        } else {
        // 其他错误，显示详细错误信息
        const errorMsg = error.message || '未知错误';
        // 检查是否是命名空间终止相关的错误
        if (errorMsg.includes('being terminated') || errorMsg.includes('terminating')) {
          message.error(`创建子网失败: 命名空间 ${targetNamespace} 正在被终止，无法创建资源。请选择其他命名空间。`);
        } else {
          message.error(
            `${isEditSubnet ? '更新' : '创建'}子网失败: ${translateKnownApiErrorMessage(errorMsg)}`,
          );
        }
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
    const displayName = SafeRead.displayName(record);
    if (!cloudId || !name) return;

    const relatedSubnets = (subnets || []).filter((s) => {
      const v = String(s?.spec?.vpc ?? '').trim();
      return v === String(name).trim();
    });
    if (relatedSubnets.length > 0) {
      const subnetNames = relatedSubnets
        .slice(0, 5)
        .map((s) => SafeRead.displayName(s))
        .join('、');
      const moreText = relatedSubnets.length > 5 ? ` 等` : '';
      Modal.error({
        title: '无法删除 VPC',
        content: `请先删除该 VPC（${displayName}）下的子网，然后再删除 VPC。当前关联示例：${subnetNames}${moreText}。`,
      });
      return;
    }

    Modal.confirm({
      title: `删除 VPC: ${displayName}`,
      content: `确认要删除 VPC ${displayName} 吗？此操作不可撤销。`,
      okType: 'danger',
      onOk: async () => {
        try {
          await deleteHarvesterVpc(cloudId, name);
          message.success('删除成功');
          onRefresh?.(true, false, { vpcsAll: vpcsQueryAll });
        } catch (e: any) {
          message.error(`删除失败: ${e.message}`);
        }
      },
    });
  };

  const handleDeleteSubnet = async (record: any) => {
    if (!hasVpcsWrite) {
      message.error('无权限执行该操作');
      return;
    }
    const name = SafeRead.name(record);
    const displayName = SafeRead.displayName(record);
    if (!cloudId || !name) return;

    const cidrRaw = String(SafeRead.subnetCidr(record) === '-' ? '' : SafeRead.subnetCidr(record)).trim();
    let natBlockMsg: string | null = null;
    try {
      natBlockMsg = await getVpcSubnetDeleteBlockedByNatMessage(cloudId, name, cidrRaw);
    } catch {
      natBlockMsg = '无法校验 SNAT/DNAT 是否引用该 VPC 子网，请检查网络后重试。';
    }
    const blocked = !!natBlockMsg;

    Modal.confirm({
      title: `删除子网: ${displayName}`,
      content: (
        <>
          <div>{`确认要删除子网 ${displayName} 吗？此操作不可撤销。`}</div>
          {natBlockMsg && (
            <div style={{ color: '#ff4d4f', marginTop: 8 }}>{natBlockMsg}</div>
          )}
        </>
      ),
      okType: 'danger',
      okButtonProps: { disabled: blocked },
      onOk: blocked
        ? undefined
        : async () => {
            try {
              await deleteKubeOvnSubnet(cloudId, name);
              message.success('删除成功');
              onRefresh?.(true, false, { vpcsAll: vpcsQueryAll });
            } catch (e: any) {
              message.error(`删除失败: ${e.message}`);
            }
          },
    });
  };

  // 过滤逻辑
  const dataSource = useMemo(() => {
    let filtered = vpcs;

    // 默认列表由 GET /vpcs 只返回 tower.io/ovn-network-scope=vpc；此处不再按内置名过滤

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

    return [...filtered].sort((a, b) => kubeResourceCreatedMs(b) - kubeResourceCreatedMs(a));
  }, [vpcs, searchText, namespaceFilter]);

  // 详情抽屉
  const handleShowYaml = (record: any, type: string) => {
    setCurrentDrawerRecord(record);
    setCurrentDrawerType(type);
    setDrawerTab(record?.links?.view ? 'view_link' : 'detail');
    setDrawerVisible(true);
  };

  // --- Columns ---

  /** 展开行内子网表：固定列宽 + 横向滚动，避免「命名空间」与「网关」等列挤压重叠 */
  const cellEllipsis = (text: string) => (
    <span
      style={{
        display: 'block',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      }}
      title={text || undefined}
    >
      {text || '—'}
    </span>
  );

  // 子网列定义
  const subnetColumns = [
    {
      title: '名称',
      key: 'subnetAlias',
      fixed: 'left' as const,
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
      title: '命名空间',
      key: 'namespace',
      render: (_: any, r: any) => cellEllipsis(SafeRead.subnetNamespace(r)),
    },
    {
      title: '网关',
      key: 'gateway',
      render: (_: any, r: any) => cellEllipsis(String(SafeRead.subnetGateway(r) || '-')),
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
      title: '已用 / 总数',
      key: 'usage',
      render: (_: any, record: any) => {
        const st = record.status || {};
        const available =
          Number(st.v4AvailableIPs ?? st.v4availableIPs ?? st.availableIPs ?? st.availableIps ?? 0) ||
          0;
        const used = Number(st.v4UsingIPs ?? st.v4usingIPs ?? st.usingIPs ?? st.usingIps ?? 0) || 0;
        const total = Math.max(available + used, 0);
        return (
          <span title={`已用 ${used}（总数 ${total}，可用 ${available}）`}>
            {used} / {total}
          </span>
        );
      },
    },
    {
      title: '操作',
      key: 'actions',
      fixed: 'right' as const,
      render: (_: any, r: any) => {
        const items = [
          { key: 'edit', label: '编辑子网', disabled: !hasVpcsWrite, onClick: () => handleEditSubnet(r) },
          ...(effectiveShowYaml ? [{ key: 'view_yaml', label: '查看YAML', onClick: () => handleShowYaml(r, 'Subnet') }] : []),
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
      fixed: 'left' as const,
      ellipsis: true,
      render: (_: any, r: any) => {
        const name = SafeRead.name(r);
        const alias = String(SafeRead.alias(r) || '').trim();
        const display = alias || name || '—';
        let tag = null;
        if (name === KUBE_OVN_PUBLIC_VPC) tag = <Tag color="blue">公共</Tag>;
        if (name === KUBE_OVN_FLAT_VPC) tag = <Tag color="blue">扁平</Tag>;
        if (name === KUBE_OVN_PROVIDER_VPC) {
          tag = <Tag color="blue">Provider</Tag>;
        }
        return (
          <span style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', maxWidth: '100%' }}>
            <ApartmentOutlined style={{ color: '#1677ff'}} />
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }} title={display !== '—' ? display : undefined}>
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
      fixed: 'right' as const,
      render: (_: any, r: any) => {
        const name = SafeRead.name(r);
        const isSystem = isBuiltInKubeOvnVpc(name);
        const items = [
          { key: 'edit', label: '编辑VPC', disabled: !hasVpcsWrite, onClick: () => handleEditVpc(r) },
          { key: 'createSubnet', label: '添加 VPC 子网', disabled: !hasVpcsWrite, onClick: () => handleOpenCreateSubnet(r) },
          ...(effectiveShowYaml ? [{ key: 'view_yaml', label: '查看YAML', onClick: () => handleShowYaml(r, 'Vpc') }] : []),
          ...(!isSystem ? [
            { type: 'divider' as const },
            { key: 'delete', label: '删除', danger: true, disabled: !hasVpcsWrite, onClick: () => handleDelete(r) }
          ] : []),
        ];
        return <ResourceActionsDropdown items={items} buttonProps={{ className: 'row-actions-trigger', disabled: !hasVpcsWrite }} />;
      },
    },
  ], [cloudId, onRefresh, hasVpcsWrite, effectiveShowYaml]);

  // --- Render Helpers ---

  const renderExpandedRow = (record: any) => {
    const vpcName = SafeRead.name(record);
    
    // 关联子网：同 VPC + tower.io/ovn-network-scope=vpc（无注解时兼容 subnet-type=vpc），避免展开行混入扁平域子网
    const relatedSubnets = subnets
      .filter((s) => {
        if (!isVpcOvnSubnetTableRow(s)) return false;
        const targetVpc = SafeRead.subnetVpc(s);
        return String(targetVpc).trim() === String(vpcName).trim();
      })
      .sort((a, b) => kubeResourceCreatedMs(b) - kubeResourceCreatedMs(a));

    if (relatedSubnets.length === 0) {
      return <div>暂无关联子网</div>;
    }

    return (
      <div style={{ padding: 12,  background: '#EDF0F7', border: '1px solid #e5e5e5', borderRadius: 8 }}>
        <Table
          className="std-table vpc-expanded-subnet-table"
          tableLayout="fixed"
          scroll={{ x: true }}
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
          {effectiveShowYaml && (
            <Switch
              checkedChildren="全部"
              unCheckedChildren="默认"
              checked={vpcsQueryAll}
              onChange={(checked) => {
                setVpcsQueryAll(checked);
                onRefresh?.(true, false, { vpcsAll: checked });
              }}
            />
          )}
          <Button type="primary" disabled={!hasVpcsWrite} onClick={handleOpenCreateVpc}>创建 VPC</Button>
          <TableColumnSettingsButton 
            allColumns={allColumns} 
            settingsKey="harvester_vpcs_table"
          />
          <Button
            icon={<ReloadOutlined />}
            onClick={() => onRefresh?.(true, false, { vpcsAll: vpcsQueryAll })}
            loading={loading}
          />
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
        scroll={{ x: true }}
        pagination={{
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
        title={`${isEditSubnet ? '编辑 VPC 子网' : '新建 VPC 子网'} (所属VPC: ${targetVpc})`}
        open={createSubnetModalVisible}
        onOk={handleSubnetModalSubmit}
        onCancel={() => setCreateSubnetModalVisible(false)}
        confirmLoading={creatingSubnet}
        okText={isEditSubnet ? '确定' : '确定'}
        cancelText="取消"
        width={600}
        centered
        destroyOnHidden
      >
        <Form form={subnetForm} layout="vertical" className="std-form">
          <Form.Item name="vpc" hidden rules={[{ required: true, message: '缺少所属 VPC' }]}>
            <Input type="hidden" />
          </Form.Item>
          <Form.Item
            name="name"
            label="名称"
            rules={[
              { required: true, message: '请输入子网名称' },
            ]}
          >
            <Input placeholder="例如 subnet-a3f2-k2z9" style={{ width: '100%' }} />
          </Form.Item>

          <Row gutter={16}>
            <Col span={12}>
              <Form.Item
                name="cidrBlock"
                label="CIDR"
                rules={[
                  { required: true, message: '请输入 CIDR' },
                  { pattern: /^([0-9]{1,3}\.){3}[0-9]{1,3}\/[0-9]{1,2}$/, message: '格式错误' },
                ]}
              >
                <Input placeholder="10.0.1.0/24" style={{ width: '100%' }} disabled={isEditSubnet} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item
                name="gateway"
                label="网关"
                rules={[
                  { required: true, message: '请输入网关地址' },
                  { pattern: /^([0-9]{1,3}\.){3}[0-9]{1,3}$/, message: '格式错误' },
                ]}
              >
                <Input placeholder="10.0.1.1" style={{ width: '100%' }} disabled={isEditSubnet} />
              </Form.Item>
            </Col>
          </Row>

          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="nat" valuePropName="checked" initialValue={true}>
                <Checkbox>启用 NAT 出网</Checkbox>
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="allowDhcp" valuePropName="checked" initialValue={true}>
                <Checkbox>启用 DHCP 服务</Checkbox>
              </Form.Item>
            </Col>
          </Row>

          <Form.Item name="excludeIps" label="排除 IP 范围">
            <Input.TextArea
              placeholder="填写需要排除的IP地址或IP范围，虚拟机自动分配IP时将跳过这些地址。支持单IP(如10.0.1.1)或IP范围(如10.0.1.10..10.0.1.20)，用逗号分隔。"
              rows={3}
            />
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
                  if (!name || isSystemNamespace(name)) return false;
                  if (isVpcBindNamespaceExcluded(name)) {
                    return isEditVpc && editVpcBoundNamespace === name;
                  }
                  return true;
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
                        rules={[
                          { required: true, message: '请输入目的网段 CIDR', whitespace: true },
                          {
                            validator: async (_: unknown, value: unknown) => {
                              const err = validateIpv4CidrNotation(String(value ?? ''));
                              if (err) throw new Error(err);
                            },
                          },
                        ]}
                        style={{ width: 200, marginBottom: 0 }}
                      >
                        <Input placeholder="例如 192.168.0.0/24" />
                      </Form.Item>
                      <Form.Item
                        {...restField}
                        name={[name, 'nextHopIP']}
                        rules={[
                          { required: true, message: '请输入下一跳 IP', whitespace: true },
                          {
                            validator: async (_: unknown, value: unknown) => {
                              const err = validateIpv4HostAddress(String(value ?? ''));
                              if (err) throw new Error(err);
                            },
                          },
                        ]}
                        style={{ width: 200, marginBottom: 0 }}
                      >
                        <Input placeholder="例如 10.0.0.1" />
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
