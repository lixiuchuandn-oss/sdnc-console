/**
 * Harvester - 网络 (NetworkAttachmentDefinition / NAD) 列表 Section
 * 
 * [功能概述]
 * 展示和管理 Harvester / Kube-OVN 中的网络附加定义（NAD），提供完整的网络资源管理能力。
 * 
 * [核心功能]
 * 1. 列表展示：支持关键字、命名空间、IP分配方式等多维度过滤
 * 2. 资源创建：通过 NadCreateModal 创建新的网络定义
 * 3. 资源查看：通过 ResourceLinkYamlDrawer（Steve links.view）查看 NAD YAML
 * 4. 资源删除：
 *    - 单个删除：检查 VM 占用和 Subnet 依赖；CNI 为 kube-ovn 时，仅当仍存在配套 Kube-OVN 子网时禁止删除（否则允许清理孤立 NAD）
 *    - 批量删除：支持多选批量删除，自动过滤不可删除的资源
 * 5. 权限控制：
 *    - 列表展示全部 NAD（含系统命名空间、kube-ovn 等），便于排障
 *    - 租户模式下，公共命名空间资源不可删除且不可选择
 * 
 * [数据流程]
 * 1. 接收原始 NAD 数据（可能为 K8s 原始对象或后端包装对象）
 * 2. 预处理：解析 config、提取 name/namespace、标准化 IP分配方式等
 * 3. 过滤：根据关键字、命名空间、IP分配方式、是否孤立 NAD 过滤，租户模式下过滤公共命名空间
 * 4. 渲染：表格展示，支持列设置、分页等功能
 * 
 * [依赖检查]
 * 删除前会检查：
 * - VM 占用：检查是否有虚拟机正在使用该网络
 * - Subnet 依赖：检查是否有 Kube-OVN 子网依赖该 NAD（名称匹配）
 *
 * -----------------------------------------------------------------------------
 * 与「子网」类概念的区分（详见 kube-ovn/UnderlaySubnetsSection、VpcSubnetsSection）
 * -----------------------------------------------------------------------------
 *
 * 【NAD】本 Section：K8s Multus 的 NetworkAttachmentDefinition，定义附加网卡使用的 CNI（bridge、kube-ovn 等）。
 *       VM 创建/编排时选「网络」常指 NAD。
 *
 * 【扁平子网 / 公共子网 / VPC 子网】均为 kubeovn.io/v1 Subnet CR，靠注解 tower.io/subnet-type 区分：
 *       flat=扁平子网，public=公共子网，vpc=VPC 子网（业务 VPC 内网段）。
 *
 * Kube-OVN 流程下，子网与同名 NAD 配套：NAD 的 CNI config 指向 Subnet 对应的逻辑 provider（name.ns.ovn）。
 * -----------------------------------------------------------------------------
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Table, Input, Select, Tag, Button, Modal, message, Dropdown, Tooltip } from 'antd';
import { ReloadOutlined, SearchOutlined, EllipsisOutlined } from '@ant-design/icons';
import PageDetailSection from '../../../../../../components/PageDetailSection';
import ResourceActionsDropdown from '../../../../../../components/ResourceActionsDropdown';
import { deleteHarvesterNad, fetchKubeOvnSubnets } from '../../../../../../services/harvesterApi';
import { fetchCloudProviderEcs } from '../../../../../../services/api';
import TableColumnSettingsButton from '../../../../../../components/TableColumnSettingsButton';
import { useTableColumnSettings } from '../../../../../../hooks/useTableColumnSettings';
import { ResourceLinkYamlDrawer } from '../../shared/components/ResourceLinkYamlDrawer';
import NadCreateModal from '../../nad/modals/NadCreateModal';
import { useHarvesterPublicNamespaces } from '../../context/HarvesterPublicNamespacesContext';
import { useAuth } from '../../../../../../contexts/AuthContext';
import { hasPermissionForAction } from '../../../../../../utils/accessMapping';
import {
  SUBNET_TYPE_ANNOTATION_KEY,
  TOWER_ALIAS_ANNOTATION,
} from '../../kube-ovn/lib/kubeOvnSubnetConstants';

/** 从 NAD 解析可能对应的 Kube-OVN Subnet 名称候选（同名 + provider 首段） */
function collectKubeOvnSubnetNameCandidates(record: { _name?: string; _config?: any }): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (s: string) => {
    const x = String(s || '').trim().toLowerCase();
    if (x && !seen.has(x)) {
      seen.add(x);
      out.push(x);
    }
  };
  push(String(record._name || ''));
  const cfg = record._config || {};
  const fromProvider = (p: string) => {
    const v = String(p || '').trim();
    if (!v.includes('.ovn')) return;
    const first = v.split('.')[0];
    if (first) push(first);
  };
  fromProvider(cfg.provider);
  const plugins = Array.isArray(cfg.plugins) ? cfg.plugins : [];
  for (const pl of plugins) {
    if (String(pl?.type || '').toLowerCase() === 'kube-ovn' && pl?.provider) {
      fromProvider(pl.provider);
    }
  }
  return out;
}

/**
 * 与 Multus/kube-ovn 常见写法一致：部分 NAD 仅在 plugins[].type 声明 kube-ovn，顶层无 config.type。
 * 若不解析，_type 为空会导致「OVN 子网」列与筛选永远匹配不到。
 */
function inferCniTypeFromConfig(config: any): string {
  if (!config || typeof config !== 'object') return '';
  const top = String(config.type ?? '').trim();
  if (top) return top;
  const plugins = Array.isArray(config.plugins) ? config.plugins : [];
  for (const p of plugins) {
    const t = String(p?.type ?? '').trim();
    if (t.toLowerCase() === 'kube-ovn') return 'kube-ovn';
  }
  if (plugins[0]?.type) return String(plugins[0].type).trim();
  return '';
}

/** CNI 为 kube-ovn 的 NAD（OVN 逻辑网）；仍配套 Subnet 时宜从子网删除，孤立 NAD 可在本列表删除 */
function isKubeOvnCniNad(record: { _type?: string; _config?: any }): boolean {
  const t = String(record?._type ?? inferCniTypeFromConfig(record?._config) ?? '')
    .trim()
    .toLowerCase();
  return t === 'kube-ovn';
}

/**
 * 仍存在与 NAD 配套的 Kube-OVN Subnet 时，NAD 列表侧应引导用户先删子网（或走子网级联删除）。
 * 匹配规则与 OVN 子网列 / collectKubeOvnSubnetNameCandidates 一致；非 kube-ovn 仍按「子网名 === NAD 名」保守检查。
 */
function findDependentSubnetsForNad(record: any, subnets: any[]): string[] {
  if (!Array.isArray(subnets) || subnets.length === 0) return [];
  if (isKubeOvnCniNad(record)) {
    const candidates = new Set(
      collectKubeOvnSubnetNameCandidates(record).map((s) => s.toLowerCase()).filter(Boolean),
    );
    if (candidates.size === 0) return [];
    return subnets
      .filter((subnet: any) => {
        const subnetName = String(subnet?.metadata?.name || subnet?.name || '').toLowerCase();
        return subnetName && candidates.has(subnetName);
      })
      .map((subnet: any) => subnet?.metadata?.name || subnet?.name)
      .filter(Boolean);
  }
  const nadName = String(record?._name ?? '').toLowerCase();
  if (!nadName) return [];
  return subnets
    .filter((subnet: any) => {
      const subnetName = String(subnet?.metadata?.name || subnet?.name || '').toLowerCase();
      return subnetName === nadName;
    })
    .map((subnet: any) => subnet?.metadata?.name || subnet?.name)
    .filter(Boolean);
}

function subnetTypeToShortLabel(t: string): string {
  const s = String(t || '').trim().toLowerCase();
  if (s === 'vpc') return 'VPC 子网';
  if (s === 'flat') return '扁平子网';
  if (s === 'public') return '公共子网';
  if (s === 'external') return '外部子网';
  return s ? `类型:${s}` : '';
}

/** 工具栏「孤立 NAD」筛选的哨兵值（CNI kube-ovn 且当前子网列表中无配套 Subnet） */
const OVN_NAD_ORPHAN_ONLY = '__tower_ovn_nad_orphan_only__';

const ORPHAN_OVN_NAD_FILTER_OPTIONS: { value: string; label: string }[] = [
  { value: OVN_NAD_ORPHAN_ONLY, label: '孤立 NAD' },
];

/** kube-ovn NAD 在子网 Map 中解析到的 Subnet 对象；非 kube-ovn 或未匹配返回 null */
function resolveLinkedKubeOvnSubnet(
  record: { _name?: string; _config?: any; _type?: string },
  subnetByNameLc: Map<string, any>,
): any | null {
  const tp = String(record._type ?? inferCniTypeFromConfig(record._config) ?? '')
    .trim()
    .toLowerCase();
  if (tp !== 'kube-ovn') return null;
  for (const cand of collectKubeOvnSubnetNameCandidates(record)) {
    const hit = subnetByNameLc.get(cand);
    if (hit) return hit;
  }
  return null;
}

/** 当前缓存的子网列表中是否仍存在配套子网（用于操作入口是否展示；最终以删除前拉取的子网校验为准）。 */
function hasLinkedKubeOvnSubnetInMap(record: any, subnetByNameLc: Map<string, any>): boolean {
  return resolveLinkedKubeOvnSubnet(record, subnetByNameLc) != null;
}

/** 根据 VM networks 字段解析正在使用该 NAD 的虚拟机展示名列表（与单删 / 批量删同源） */
function collectVmDisplayNamesUsingNad(
  vms: any[],
  record: { _namespace?: string; _name?: string },
): string[] {
  const targetNs = String(record._namespace ?? '').toLowerCase();
  const targetName = String(record._name ?? '').toLowerCase();
  if (!targetName) return [];
  const targetRef = `${targetNs}/${targetName}`;
  return vms
    .filter((vm: any) => Array.isArray(vm.networks))
    .filter((vm: any) => {
      const vmNs = (vm.namespace || vm.metadata?.namespace || '').toLowerCase();
      return vm.networks.some((n: string) => {
        if (!n) return false;
        const s = String(n).toLowerCase();
        const base = s.includes('@') ? s.split('@')[0] : s;
        if (base === 'pod' || base === 'default') return false;
        if (base === targetRef) return true;
        if (base.endsWith(`/${targetName}`)) return true;
        if (base === targetName && vmNs === targetNs) return true;
        return false;
      });
    })
    .map(
      (vm: any) =>
        vm?.metadata?.annotations?.['tower.io/alias'] ||
        vm.InstanceName ||
        vm.name ||
        vm.metadata?.name,
    )
    .filter(Boolean);
}

/**
 * 组件入参类型定义
 */
type Props = {
  /** NAD 列表数据，可能为 Harvester/K8s 原始对象或平台包装后的对象 */
  nads: any[];
  /** 加载状态，控制表格 loading 显示 */
  loading: boolean;
  /** 刷新回调函数
   * @param force - 是否强制刷新（跳过缓存）
   * @param silent - 是否静默刷新（不显示加载状态）
   */
  onRefresh?: (force?: boolean, silent?: boolean) => void;
  /** 当前云 ID，用于调用删除、创建等 API */
  cloudId?: string;
  /** 是否为租户模式，影响权限控制和资源过滤 */
  isTenant?: boolean;
  /**
   * 为 true 时仅保留 CNI `type=bridge` 的 NAD（会隐藏子网配套的 `kube-ovn` 类 NAD）。
   * 默认 false：展示全部（含公共/扁平/VPC 子网关联创建的 kube-ovn NAD），便于与 Kube-OVN 子网对照排障。
   */
  onlyBridge?: boolean;
};

const NadsSection: React.FC<Props> = ({ nads = [], loading, onRefresh, cloudId, isTenant, onlyBridge = false }) => {
  const { isPublicNamespace } = useHarvesterPublicNamespaces();
  const { user } = useAuth();
  const perms = useMemo(() => (user?.permissions ?? []) as string[], [user?.permissions]);
  const hasNadsWrite = useMemo(
    () => hasPermissionForAction(perms, 'clouds.nads:write') || hasPermissionForAction(perms, 'clouds:write'),
    [perms],
  );
  const ensureNadsWrite = useCallback(() => {
    if (hasNadsWrite) return true;
    message.error('当前账号没有附加网络操作权限（需要 clouds.nads:write 或 clouds:write 权限）');
    return false;
  }, [hasNadsWrite]);

  /** Kube-OVN Subnet 列表：用于表格「OVN 子网」关联列（与删除校验同源：通常 Subnet 名与 NAD 名一致） */
  const [ovnSubnets, setOvnSubnets] = useState<any[]>([]);
  const [ovnSubnetsLoading, setOvnSubnetsLoading] = useState(false);

  const loadOvnSubnets = useCallback(async (force = false): Promise<any[]> => {
    if (!cloudId) {
      setOvnSubnets([]);
      return [];
    }
    setOvnSubnetsLoading(true);
    try {
      const res = await fetchKubeOvnSubnets(cloudId, force);
      const items = res?.data?.items || res?.items || [];
      const list = Array.isArray(items) ? items : [];
      setOvnSubnets(list);
      return list;
    } catch {
      setOvnSubnets([]);
      return [];
    } finally {
      setOvnSubnetsLoading(false);
    }
  }, [cloudId]);

  useEffect(() => {
    loadOvnSubnets(false);
  }, [loadOvnSubnets]);

  const subnetByNameLc = useMemo(() => {
    const m = new Map<string, any>();
    for (const s of ovnSubnets) {
      const n = String(s?.metadata?.name || s?.name || '').toLowerCase();
      if (n) m.set(n, s);
    }
    return m;
  }, [ovnSubnets]);

  // ==================== 状态管理 ====================
  
  /** 过滤条件：关键字搜索（匹配网络名称或命名空间） */
  const [keyword, setKeyword] = useState<string>('');
  /** 过滤条件：命名空间筛选（仅管理员可见） */
  const [nsFilter, setNsFilter] = useState<string>('');
  /** 过滤条件：IP分配方式筛选（dhcp/static/host-local） */
  const [ipamFilter, setIpamFilter] = useState<string>('');
  /** 过滤条件：仅显示孤立 NAD（kube-ovn、无配套 Kube-OVN 子网） */
  const [orphanOvnNadFilter, setOrphanOvnNadFilter] = useState<string>('');

  useEffect(() => {
    setOrphanOvnNadFilter('');
  }, [cloudId]);
  
  /** 批量选择：选中的行 key 列表 */
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);

  const [nadYamlDrawerOpen, setNadYamlDrawerOpen] = useState(false);
  const [nadYamlViewLink, setNadYamlViewLink] = useState<string | undefined>();

  /** 创建网络弹窗：是否显示 */
  const [createVisible, setCreateVisible] = useState(false);

  /** 打开 ResourceLinkYamlDrawer，经 Steve `links.view` 拉取 NetworkAttachmentDefinition YAML */
  const openNadYamlDrawer = useCallback(
    (record: any) => {
      if (!cloudId) {
        message.warning('缺少云实例上下文，无法拉取 YAML');
        return;
      }
      const existing = record?.links?.view;
      const ns = String(record?._namespace ?? record?.metadata?.namespace ?? '').trim();
      const name = String(record?._name ?? record?.metadata?.name ?? '').trim();
      const link = existing
        ? String(existing).trim()
        : ns && name
          ? `/apis/k8s.cni.cncf.io/v1/namespaces/${encodeURIComponent(ns)}/network-attachment-definitions/${encodeURIComponent(name)}`
          : undefined;
      if (!link) {
        message.warning('当前行缺少 View Link，无法拉取 YAML');
        return;
      }
      setNadYamlViewLink(link);
      setNadYamlDrawerOpen(true);
    },
    [cloudId],
  );

  const closeNadYamlDrawer = useCallback(() => {
    setNadYamlDrawerOpen(false);
    setNadYamlViewLink(undefined);
  }, []);

  /**
   * 检查网络是否被虚拟机使用
   * 
   * [匹配规则]
   * 1. 完整格式：`namespace/name` 精确匹配
   * 2. 后缀匹配：以 `/name` 结尾的网络引用
   * 3. 短格式：仅名称匹配，且 VM 命名空间与 NAD 命名空间相同
   * 
   * [处理逻辑]
   * - 处理 @ 符号：如 "namespace/name@vlan" 只取 @ 之前的部分
   * - 跳过 Pod 网络和默认网络（不使用 NAD）
   * 
   * @param record - NAD 记录对象，需包含 _namespace 和 _name 字段
   * @returns 使用该网络的虚拟机名称列表，如果检查失败返回空数组
   */
  const checkNetworkUsage = useCallback(async (record: any): Promise<string[]> => {
    try {
      const ecsRes = await fetchCloudProviderEcs(cloudId || '', true);
      const vms: any[] = ecsRes?.data || ecsRes || [];
      return collectVmDisplayNamesUsingNad(vms, record);
    } catch {
      return [];
    }
  }, [cloudId]);

  /**
   * 检查 NAD 是否被 Kube-OVN Subnet 依赖
   * 
   * [依赖关系]
   * 在 Kube-OVN 架构中，Subnet 名称通常与对应的 NAD 名称相同。
   * 如果 Subnet 依赖某个 NAD，删除 NAD 前必须先删除 Subnet，
   * 或者删除 Subnet 时会自动级联删除对应的 NAD。
   * 
   * [匹配规则]
   * - 精确匹配：Subnet 名称 === NAD 名称（不区分大小写）
   * 
   * @param record - NAD 记录对象，需包含 _name 字段
   * @returns 依赖该 NAD 的子网名称列表，如果检查失败返回空数组
   */
  const checkSubnetDependency = useCallback(
    async (record: any): Promise<string[]> => {
      try {
        const subnets = await loadOvnSubnets(true);
        return findDependentSubnetsForNad(record, subnets);
      } catch {
        return [];
      }
    },
    [loadOvnSubnets],
  );

  /**
   * 删除单个网络
   * 
   * [权限检查]
   * 公共命名空间：租户模式下直接返回，不允许删除
   * 
   * [依赖检查]
   * 1. VM 占用检查：并行检查是否有虚拟机使用该网络
   * 2. Subnet 依赖检查：并行检查是否有子网依赖该 NAD
   * 
   * [用户交互]
   * - 如果被占用或依赖，显示详细原因并禁用删除按钮
   * - 确认删除后调用 API 执行删除，成功后刷新列表
   * 
   * @param record - NAD 记录对象
   */
  const handleDelete = useCallback(async (record: any) => {
    if (!ensureNadsWrite()) return;

    // 租户不能删除公共命名空间的资源
    const isPublic = isPublicNamespace(record._namespace);
    if (isTenant && isPublic) {
      message.warning('租户不能删除公共命名空间的资源');
      return;
    }

    const [usingVms, dependentSubnets] = await Promise.all([
      checkNetworkUsage(record),
      checkSubnetDependency(record),
    ]);
    
    const blockedByVm = usingVms.length > 0;
    const blockedBySubnet = dependentSubnets.length > 0;
    const blocked = blockedByVm || blockedBySubnet;
    
    Modal.confirm({
      title: '确认删除',
      content: (
        <>
          <div>{`确定要删除网络 ${record._name} 吗？此操作不可恢复。`}</div>
          {blockedByVm && (
            <div style={{ color: '#ff4d4f', marginTop: 8 }}>
              {`不能删除此虚拟网络，因为正在被虚拟机使用：${usingVms
                .slice(0, 5)
                .join('，')}${usingVms.length > 5 ? ' 等' : ''}`}
            </div>
          )}
          {blockedBySubnet && (
            <div style={{ color: '#ff4d4f', marginTop: 8 }}>
              {`不能删除此虚拟网络，因为正在被 Kube-OVN 子网依赖：${dependentSubnets
                .slice(0, 5)
                .join('，')}${dependentSubnets.length > 5 ? ' 等' : ''}`}
              <div style={{ fontSize: 12, color: '#999', marginTop: 4 }}>
                提示：请先删除依赖的子网，或删除子网时会自动级联删除对应的 NAD。
              </div>
            </div>
          )}
        </>
      ),
      okText: '删除',
      okType: 'danger',
      okButtonProps: { disabled: blocked },
      cancelText: '取消',
      onOk: blocked
        ? undefined
        : async () => {
            try {
              await deleteHarvesterNad(cloudId || '', record._namespace, record._name);
              message.success('删除成功');
              onRefresh && onRefresh(true);
            } catch (e: any) {
              message.error(e.message || '删除失败');
            }
          },
    });
  }, [
    ensureNadsWrite,
    isTenant,
    checkNetworkUsage,
    checkSubnetDependency,
    cloudId,
    onRefresh,
    isPublicNamespace,
  ]);

  /**
   * 批量删除选中的网络
   * 
   * [处理流程]
   * 1. 从过滤后的数据中获取选中的记录
   * 2. 过滤不可删除的资源：公共命名空间的网络（租户）
   * 3. 并行检查所有可删除网络的占用情况：
   *    - VM 占用：遍历所有 VM，匹配网络引用
   *    - Subnet 依赖：遍历所有 Subnet，匹配名称
   * 4. 构建确认对话框，显示：
   *    - 将被跳过的系统/公共命名空间资源数量
   *    - 被 VM 占用的网络列表
   *    - 被 Subnet 依赖的网络列表
   *    - 实际可删除的网络数量
   * 5. 并发执行删除：使用 Promise.allSettled 并发删除所有可删除的网络
   * 6. 统计结果：显示成功/失败数量，清空选中状态，刷新列表
   * 
   * [错误处理]
   * - 检查失败不影响删除流程（忽略错误继续执行）
   * - 删除失败时显示错误信息，但不影响其他网络的删除
   */
  const handleBatchDelete = async () => {
    if (!ensureNadsWrite()) return;
    if (selectedRowKeys.length === 0) return;

    // 从过滤后的数据中获取选中的记录
    const targets = filteredData.filter((item: any) => {
      const key = item?.metadata?.uid || `${item?._namespace}/${item?._name}`;
      return selectedRowKeys.includes(key);
    });

    if (targets.length === 0) {
      message.warning('未找到可删除的网络');
      return;
    }

    const deletableTargets = targets.filter((item: any) => {
      if (isTenant && isPublicNamespace(item._namespace)) return false;
      return true;
    });
    const publicTargets = isTenant ? targets.filter((item: any) => isPublicNamespace(item._namespace)) : [];

    if (deletableTargets.length === 0) {
      if (publicTargets.length > 0) {
        message.warning(`选中的网络无法删除：${publicTargets.length} 个公共命名空间（租户不能删除）`);
      } else {
        message.warning('选中的网络无法删除');
      }
      setSelectedRowKeys([]);
      return;
    }

    // 检查占用情况（VM 和 Subnet）
    const usageMap = new Map<string, string[]>();
    const subnetDependencyMap = new Map<string, string[]>();
    
    try {
      const [ecsRes, subnets] = await Promise.all([
        fetchCloudProviderEcs(cloudId || '', true),
        loadOvnSubnets(true),
      ]);

      const vms: any[] = ecsRes?.data || ecsRes || [];

      for (const target of deletableTargets) {
        const usingVms = collectVmDisplayNamesUsingNad(vms, target);

        if (usingVms.length > 0) {
          usageMap.set(`${target._namespace}/${target._name}`, usingVms);
        }

        const dependentSubnets = findDependentSubnetsForNad(target, subnets);

        if (dependentSubnets.length > 0) {
          subnetDependencyMap.set(`${target._namespace}/${target._name}`, dependentSubnets);
        }
      }
    } catch {
      // 忽略占用检查错误，继续执行删除
    }

    // 构建确认对话框内容
    const blockedByVm = Array.from(usageMap.entries());
    const blockedBySubnet = Array.from(subnetDependencyMap.entries());
    const canDelete = deletableTargets.filter(
      (t: any) => 
        !usageMap.has(`${t._namespace}/${t._name}`) &&
        !subnetDependencyMap.has(`${t._namespace}/${t._name}`)
    );

    let content = (
      <>
        <div>{`确定要删除选中的 ${deletableTargets.length} 个网络吗？此操作不可恢复。`}</div>
        {publicTargets.length > 0 && (
          <div style={{ color: '#faad14', marginTop: 8 }}>
            {`注意：${publicTargets.length} 个公共命名空间的网络将被跳过（租户不能删除公共命名空间的资源）。`}
          </div>
        )}
        {blockedByVm.length > 0 && (
          <div style={{ color: '#ff4d4f', marginTop: 8 }}>
            <div>以下网络正在被虚拟机使用，无法删除：</div>
            {blockedByVm.slice(0, 5).map(([net, vms]) => (
              <div key={net} style={{ marginLeft: 16, marginTop: 4 }}>
                {net}: {vms.slice(0, 3).join('，')}{vms.length > 3 ? ' 等' : ''}
              </div>
            ))}
            {blockedByVm.length > 5 && (
              <div style={{ marginLeft: 16, marginTop: 4 }}>
                等共 {blockedByVm.length} 个网络
              </div>
            )}
          </div>
        )}
        {blockedBySubnet.length > 0 && (
          <div style={{ color: '#ff4d4f', marginTop: 8 }}>
            <div>以下网络正在被 Kube-OVN 子网依赖，无法删除：</div>
            {blockedBySubnet.slice(0, 5).map(([net, subnets]) => (
              <div key={net} style={{ marginLeft: 16, marginTop: 4 }}>
                {net}: {subnets.slice(0, 3).join('，')}{subnets.length > 3 ? ' 等' : ''}
              </div>
            ))}
            {blockedBySubnet.length > 5 && (
              <div style={{ marginLeft: 16, marginTop: 4 }}>
                等共 {blockedBySubnet.length} 个网络
              </div>
            )}
            <div style={{ fontSize: 12, color: '#999', marginTop: 4, marginLeft: 16 }}>
              提示：请先删除依赖的子网，或删除子网时会自动级联删除对应的 NAD。
            </div>
          </div>
        )}
        {canDelete.length > 0 && (
          <div style={{ color: '#52c41a', marginTop: 8 }}>
            {`将删除 ${canDelete.length} 个网络。`}
          </div>
        )}
      </>
    );

    const hasDeletable = canDelete.length > 0;

    Modal.confirm({
      title: '批量删除确认',
      content,
      okText: '删除',
      okType: 'danger',
      okButtonProps: { disabled: !hasDeletable },
      cancelText: '取消',
      onOk: hasDeletable
        ? async () => {
            try {
              const results = await Promise.allSettled(
                canDelete.map((target: any) =>
                  deleteHarvesterNad(cloudId || '', target._namespace, target._name)
                )
              );

              const ok = results.filter((r) => r.status === 'fulfilled').length;
              const fail = results.filter((r) => r.status === 'rejected').length;

              if (ok > 0) {
                message.success(`成功删除 ${ok} 个网络`);
              }
              if (fail > 0) {
                const errors = results
                  .filter((r) => r.status === 'rejected')
                  .map((r: any) => r.reason?.message || String(r.reason))
                  .filter(Boolean);
                message.error(`删除失败 ${fail} 个网络${errors.length > 0 ? `: ${errors[0]}` : ''}`);
              }

              setSelectedRowKeys([]);
              onRefresh && onRefresh(true);
            } catch (e: any) {
              message.error(e?.message || '批量删除失败');
            }
          }
        : undefined,
    });
  };

  /**
   * 预处理 NAD 数据
   * 
   * [处理目标]
   * 将后端返回的 NAD 数据（可能是 K8s 原始对象或后端包装对象）标准化为统一的内部格式，
   * 方便后续的过滤、渲染和操作。
   * 
   * [处理步骤]
   * 1. 提取 name 和 namespace：兼容 metadata.name/name 和 metadata.namespace/namespace
   * 2. 解析 config：支持字符串 JSON 和对象格式，解析失败时使用空对象
   * 3. 标准化 IP分配方式：
   *    - 优先使用 config.ipam.type
   *    - 如果未设置但存在 config.ipam.subnet，推断为 'host-local'
   * 4. 提取关键字段：vlan、promiscMode、bridge、type、cniVersion
   * 5. 挂载到内部字段：使用 _ 前缀避免与原始数据冲突
   * 
   * [返回格式]
   * 原始对象 + 内部字段（_name, _namespace, _config, _vlan, _ipamType 等）
   */
  const processedData = useMemo(() => {
    return (Array.isArray(nads) ? nads : []).map(item => {
        // Robust extraction of name and namespace
        // Handle both flattened backend response and raw K8s/Harvester object
        const name = item?.metadata?.name || item?.name || '';
        const namespace = item?.metadata?.namespace || item?.namespace || '';

        // Robust extraction of config
        // Check spec.config (K8s standard), item.config (Backend flattened), or direct properties
        let config: any = {};
        let rawConfig = item?.spec?.config || item?.config;

        try {
            if (rawConfig) {
                if (typeof rawConfig === 'string') {
                    config = JSON.parse(rawConfig);
                } else if (typeof rawConfig === 'object') {
                    config = rawConfig;
                }
            }
        } catch (e) {
            console.warn('Failed to parse NAD config for', name, e);
        }

        // Normalize IPAM Type
        let ipamType = config?.ipam?.type;
        if (!ipamType && typeof config?.ipam?.subnet === 'string') {
             ipamType = 'host-local';
        }

        // 提取别名：优先使用 tower.io/alias 注解
        const alias = item?.metadata?.annotations?.['tower.io/alias'] || '';
        
        // 提取集群网络名称并映射：mgmt -> 管理网
        // 优先从 labels 中获取，如果没有则从 annotations 中获取
        const clusterNetwork = item?.metadata?.labels?.['network.harvesterhci.io/clusternetwork'] 
          || item?.metadata?.annotations?.['network.harvesterhci.io/route-cluster-network'] 
          || '';
        const clusterNetworkDisplay = clusterNetwork === 'mgmt' ? '管理网' : clusterNetwork;

        return {
            ...item,
            _config: config,
            _name: name,
            _namespace: namespace,
            _alias: alias,
            _clusterNetwork: clusterNetwork,
            _clusterNetworkDisplay: clusterNetworkDisplay,
            _vlan: config?.vlan,
            _ipamType: ipamType,
            _promisc: config?.promiscMode,
            _bridge: config?.bridge,
            _type: inferCniTypeFromConfig(config),
            _cniVersion: config?.cniVersion,
            _creationTimestamp: item?.metadata?.creationTimestamp || item?.createdAt || ''
        };
    })
    .filter((x: any) => !onlyBridge || String(x?._type || '').toLowerCase().trim() === 'bridge')
    // 按 UID 或 namespace/name 去重，避免删除后接口/缓存返回重复项导致同一 key 两条记录（如 mgmt 出现两条）
    .filter((x: any, idx: number, arr: any[]) => {
      const key = x?.metadata?.uid || `${x?._namespace || ''}/${x?._name || ''}`;
      const firstIdx = arr.findIndex((y: any) => (y?.metadata?.uid || `${y?._namespace || ''}/${y?._name || ''}`) === key);
      return firstIdx === idx;
    })
    // 按创建时间倒序排列（最新的在前）
    .sort((a: any, b: any) => {
      return new Date(b._creationTimestamp || 0).getTime() - new Date(a._creationTimestamp || 0).getTime();
    });
  }, [nads, onlyBridge]);

  /**
   * 过滤逻辑
   * 
   * [过滤顺序]
   * 1. 关键字过滤：匹配网络名称或命名空间（不区分大小写）
   * 2. 命名空间过滤：精确匹配（不区分大小写）
   * 3. IP分配方式过滤：精确匹配（不区分大小写）
   * 4. 孤立 OVN NAD：选中后仅保留 CNI kube-ovn 且无配套 Kube-OVN 子网的行（子网列表加载完成后生效）
   * - 所有过滤条件都是 AND 关系（必须同时满足）
   * - 空字符串表示不过滤该维度
   * - 关键字支持部分匹配，命名空间和 IP分配方式必须精确匹配
   * 
   * [权限说明]
   * - 租户可以看到公共命名空间（default、cloud-public、harvester-public）的 NAD，但不能删除它们
   * - 删除权限控制已在 handleDelete 函数中实现
   */
  const filteredData = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    const ns = nsFilter.trim().toLowerCase();
    const ipt = ipamFilter.trim().toLowerCase();
    return processedData.filter(item => {
      const name = String(item._name || '').toLowerCase();
      const nspace = String(item._namespace || '').toLowerCase();
      const ipam = String(item._ipamType || '').toLowerCase();

      // Keyword Filter: 匹配名称、别名或命名空间
      const alias = String(item._alias || '').toLowerCase();
      const matchesKeyword = !kw || name.includes(kw) || alias.includes(kw) || nspace.includes(kw);
      if (!matchesKeyword) return false;

      // Namespace Filter
      if (ns && nspace !== ns) return false;

      // IP分配方式过滤
      if (ipt && ipam !== ipt) return false;

      if (
        orphanOvnNadFilter === OVN_NAD_ORPHAN_ONLY &&
        !ovnSubnetsLoading
      ) {
        if (!isKubeOvnCniNad(item)) return false;
        if (resolveLinkedKubeOvnSubnet(item, subnetByNameLc)) return false;
      }

      return true;
    }).sort((a: any, b: any) => {
      return new Date(b._creationTimestamp || 0).getTime() - new Date(a._creationTimestamp || 0).getTime();
    });
  }, [
    processedData,
    keyword,
    nsFilter,
    ipamFilter,
    orphanOvnNadFilter,
    subnetByNameLc,
    ovnSubnetsLoading,
  ]);

  // ==================== 过滤选项 ====================
  
  /** 命名空间过滤下拉选项：从处理后的数据中提取唯一命名空间并排序 */
  const nsOptions = useMemo(
    () => Array.from(new Set(processedData.map((r) => r._namespace).filter(Boolean))).sort(),
    [processedData],
  );

  /** IP分配方式过滤下拉选项：从处理后的数据中提取唯一 IP分配方式并排序 */
  const ipamOptions = useMemo(() => 
    Array.from(new Set(processedData.map(r => r._ipamType).filter(Boolean))).sort(),
  [processedData]);

  
  const rowSelection = useMemo(
    () => ({
      selectedRowKeys,
      onChange: (keys: React.Key[]) => setSelectedRowKeys(keys),
      getCheckboxProps: (record: any) => ({
        disabled:
          !hasNadsWrite ||
          (isKubeOvnCniNad(record) && hasLinkedKubeOvnSubnetInMap(record, subnetByNameLc)) ||
          (isTenant && isPublicNamespace(record._namespace)),
      }),
    }),
    [selectedRowKeys, hasNadsWrite, subnetByNameLc, isTenant, isPublicNamespace],
  );

  /**
   * 表格列定义
   * 
   * [列说明]
   * - 网络名称：显示别名（tower.io/alias），如果没有别名则显示 ID
   * - 网络ID：显示 NAD 的 metadata.name（K8s 资源名称）
   * - 命名空间：显示所属命名空间
   * - VLAN：如果配置了 VLAN，显示为蓝色标签
   * - IP分配方式：antd Tag（dhcp/static/host-local）；未配置为 Tag
   * - 混杂模式：Tag
   * - CNI 类型：完整显示 spec.config 解析出的 type（如 kube-ovn、macvlan）；bridge 时为 `bridge/网桥名` 单行
   * - CNI版本：显示 CNI 版本号
   * - UID：显示 K8s UID
   * - 操作：操作菜单
   *   - 管理员模式：显示「查看YAML」和「删除」
   *   - 租户模式：仅显示"删除"
   *   - 公共命名空间（租户）：删除按钮禁用
   */
  const allColumns = useMemo(() => [
    {
      fixed: 'left' as const,
      title: '网络名称',
      key: 'name',
      render: (_: any, r: any) => {
        let displayName = r._alias || r._name || '-';
        if (!r._alias && displayName === 'mgmt') {
          displayName = '管理网';
        }
        return displayName;
      },
    },
    {
      title: '网络ID',
      key: 'id',
      render: (_: any, r: any) => r._name || '-',
    },
    {
      title: '项目',
      key: 'ns',
      render: (_: any, r: any) => r._namespace || '-',
    },
    {
      title: 'VLAN',
      key: 'vlan',
      render: (_: any, r: any) =>
        r._vlan ? <Tag color="blue">{r._vlan}</Tag> : <Tag>未配置</Tag>,
    },
    {
      title: 'IP分配方式',
      key: 'ipamType',
      render: (_: any, r: any) => {
        const t = String(r._ipamType || '').toLowerCase();
        if (!t) return <Tag>未配置</Tag>;
        let color: React.ComponentProps<typeof Tag>['color'];
        if (t === 'dhcp') color = 'success';
        else if (t === 'static') color = 'blue';
        else if (t === 'host-local') color = 'orange';
        else color = 'default';
        return <Tag color={color}>{t}</Tag>;
      },
    },
    {
      title: '混杂模式',
      key: 'promisc',
      render: (_: any, r: any) =>
        r._promisc ? <Tag color="blue">开启</Tag> : <Tag>未配置</Tag>,
    },
    {
      title: 'CNI 类型',
      key: 'cniPluginType',
      ellipsis: true,
      render: (_: any, r: any) => {
        const tp = String(r._type ?? '').trim();
        if (!tp) return '—';
        const isBridge = tp.toLowerCase() === 'bridge';
        const br = String(r._bridge ?? '').trim();
        if (isBridge && br) return `${tp}/${br}`;
        return tp;
      },
    },
    {
      title: 'OVN 子网',
      key: 'ovnSubnet',
      ellipsis: true,
      render: (_: any, r: any) => {
        const tp = String(r._type ?? '').trim().toLowerCase();
        const isKubeOvn = tp === 'kube-ovn';
        if (!isKubeOvn) {
          return (
            <Tooltip title="当前 CNI 不是 kube-ovn（如 bridge、macvlan），不会与集群里的 Kube-OVN Subnet 做同名配套。">
              无子网绑定
            </Tooltip>
          );
        }
        if (ovnSubnetsLoading) return '加载中…';
        const linked = resolveLinkedKubeOvnSubnet(r, subnetByNameLc);
        if (!linked) {
          return (
            <Tooltip title="已为 kube-ovn，但在当前子网列表中未找到同名或 provider 指向的 Subnet；若刚创建请点击工具栏刷新。">
              暂无同名子网
            </Tooltip>
          );
        }
        const ann = linked?.metadata?.annotations || {};
        const alias = String(ann[TOWER_ALIAS_ANNOTATION] || '').trim();
        const st = String(ann[SUBNET_TYPE_ANNOTATION_KEY] || '').trim().toLowerCase();
        const typeLabel = subnetTypeToShortLabel(st);
        const cidr = String(linked?.spec?.cidrBlock ?? linked?.spec?.cidr ?? '').trim();
        const resName = linked?.metadata?.name || linked?.name || '';
        const line1 = alias || resName || '（无显示名）';
        const tip = [`子网名: ${line1}`, `类型: ${typeLabel || '—'}`, `网段: ${cidr || '—'}`].join('\n');
        const text = [line1, typeLabel || '—', cidr || '—'].join(' / ');
        return (
          <Tooltip title={tip}>
            {text}
          </Tooltip>
        );
      },
    },
    {
      title: 'CNI版本',
      key: 'cni',
      render: (_: any, r: any) => r._cniVersion || '-',
    },
    {
      title: 'UID',
      key: 'uid',
      render: (_: any, r: any) => r?.metadata?.uid || '-',
    },
    {
      title: '创建时间',
      key: 'createdAt',
      ellipsis: true,
      render: (_: any, r: any) => {
        const t = String(r._creationTimestamp || '').trim();
        if (!t) return '-';
        return new Date(t).toLocaleString();
      },
    },
    {
      title: '操作',
      key: 'actions',
      fixed: 'right' as const,
      render: (_: any, r: any) => {
        const isPublic = isPublicNamespace(r._namespace);
        const deleteDisabled = isTenant && isPublic;
        const showDelete = !(isKubeOvnCniNad(r) && hasLinkedKubeOvnSubnetInMap(r, subnetByNameLc));
        const items: any[] = [];
        items.push({ key: 'opsinfo', label: '查看YAML', onClick: () => openNadYamlDrawer(r) });
        if (showDelete) items.push({ type: 'divider' });
        if (showDelete) {
          items.push({
            key: 'delete',
            label: '删除',
            danger: true,
            disabled: deleteDisabled,
            onClick: () => handleDelete(r),
          });
        }
        if (items.length === 0) {
          return '—';
        }
        return <ResourceActionsDropdown items={items} buttonProps={{ disabled: !hasNadsWrite }} />;
      },
    },
  ], [hasNadsWrite, isTenant, subnetByNameLc, ovnSubnetsLoading, handleDelete, openNadYamlDrawer, isPublicNamespace]);

  // 列显示设置（需要在 allColumns 定义之后）
  const { displayColumns: tableColumns } = useTableColumnSettings(allColumns, 'harvester_nads_table');

  return (
    <PageDetailSection
      asCard={false}
      toolbarLeft={(
        <>
          <Input 
            allowClear 
            placeholder="名称/ID" 
            suffix={<SearchOutlined style={{ color: 'rgba(0,0,0,.45)' }} />}
            value={keyword} 
            onChange={(e) => setKeyword(e.target.value)} 
            className="toolbar-search"
          />
          {!isTenant && (
            <Select 
              allowClear 
              placeholder="项目" 
              value={nsFilter || undefined} 
              onChange={(v) => setNsFilter(v || '')} 
              className="toolbar-filter-sm"
              options={[{ value: '', label: '全部项目' }, ...nsOptions.map(s => ({ value: s.toLowerCase(), label: s }))]} 
            />
          )}
          <Select 
            allowClear 
            placeholder="IP分配方式" 
            value={ipamFilter || undefined} 
            onChange={(v) => setIpamFilter(v || '')} 
            className="toolbar-filter-sm"
            options={[{ value: '', label: '全部IP分配方式' }, ...ipamOptions.map(s => ({ value: s.toLowerCase(), label: s }))]} 
          />
          <Select
            allowClear
            placeholder="孤立 NAD"
            loading={ovnSubnetsLoading}
            disabled={!cloudId}
            value={orphanOvnNadFilter || undefined}
            onChange={(v) => setOrphanOvnNadFilter((v as string) ?? '')}
            className="toolbar-filter-sm"
            options={ORPHAN_OVN_NAD_FILTER_OPTIONS}
          />
          <button
            type="button"
            className="toolbar-reset-btn"
            onClick={() => {
              setKeyword('');
              setNsFilter('');
              setIpamFilter('');
              setOrphanOvnNadFilter('');
            }}
          >
            重置
          </button>
        </>
      )}
      toolbarRight={(
        <>
          <Button
            type="primary"
            disabled={!hasNadsWrite}
            onClick={() => {
              if (!ensureNadsWrite()) return;
              setCreateVisible(true);
            }}
          >
            创建网络
          </Button>
          <Dropdown
            menu={{
              items: [
                { 
                  key: 'batchDelete', 
                  label: '批量删除', 
                  disabled: !hasNadsWrite || selectedRowKeys.length === 0 
                },
              ],
              onClick: ({ key }) => {
                if (key === 'batchDelete') handleBatchDelete();
              },
            }}
          >
            <Button icon={<EllipsisOutlined />} disabled={!hasNadsWrite || selectedRowKeys.length === 0} />
          </Dropdown>
          <TableColumnSettingsButton 
            allColumns={allColumns} 
            settingsKey="harvester_nads_table"
          />
          <Button
            icon={<ReloadOutlined />}
            onClick={() => {
              loadOvnSubnets(true);
              onRefresh && onRefresh(true);
            }}
            loading={loading || ovnSubnetsLoading}
          />
        </>
      )}
    >
      <Table
        className="std-table"
        scroll={{ x: true }}
        bordered={false}
        rowKey={(r: any) => r?.metadata?.uid || `${r?._namespace ?? ''}/${r?._name ?? ''}` || 'unknown'}
        rowSelection={rowSelection}
        columns={tableColumns}
        dataSource={filteredData}
        loading={loading}
        pagination={{
          showTotal: (total) => `共 ${total} 条`,
        }}
      />

      {cloudId ? (
        <ResourceLinkYamlDrawer
          open={nadYamlDrawerOpen}
          onClose={closeNadYamlDrawer}
          cloudId={cloudId}
          viewLink={nadYamlViewLink}
          title="查看 YAML"
        />
      ) : null}

      <NadCreateModal 
        open={createVisible} 
        onCancel={() => setCreateVisible(false)} 
        onSuccess={() => {
          setCreateVisible(false);
          onRefresh && onRefresh(true, true);
        }}
        cloudId={cloudId || ''} 
      />
    </PageDetailSection>
  );
};

export default NadsSection;
