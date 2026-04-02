/**
 * Harvester - 网络 (NetworkAttachmentDefinition / NAD) 列表 Section
 * 
 * [功能概述]
 * 展示和管理 Harvester / Kube-OVN 中的网络附加定义（NAD），提供完整的网络资源管理能力。
 * 
 * [核心功能]
 * 1. 列表展示：支持关键字、命名空间、IP分配方式等多维度过滤
 * 2. 资源创建：通过 NadCreateModal 创建新的网络定义
 * 3. 资源查看：通过 HarvesterResourceDrawer 查看网络详情、事件等信息
 * 4. 资源删除：
 *    - 单个删除：检查 VM 占用和 Subnet 依赖，防止误删
 *    - 批量删除：支持多选批量删除，自动过滤不可删除的资源
 * 5. 权限控制：
 *    - 列表展示全部 NAD（含系统命名空间、kube-ovn 等），便于排障
 *    - 租户模式下，公共命名空间资源不可删除且不可选择
 * 
 * [数据流程]
 * 1. 接收原始 NAD 数据（可能为 K8s 原始对象或后端包装对象）
 * 2. 预处理：解析 config、提取 name/namespace、标准化 IP分配方式等
 * 3. 过滤：根据关键字、命名空间、IP分配方式、关联 OVN 子网过滤，租户模式下过滤公共命名空间
 * 4. 渲染：表格展示，支持列设置、分页等功能
 * 
 * [依赖检查]
 * 删除前会检查：
 * - VM 占用：检查是否有虚拟机正在使用该网络
 * - Subnet 依赖：检查是否有 Kube-OVN 子网依赖该 NAD（名称匹配）
 *
 * -----------------------------------------------------------------------------
 * 与「子网」类概念的区分（详见 kube-ovn/UnderlaySubnetsSection、SubnetsSection）
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
import { ReloadOutlined, ApiTwoTone , SearchOutlined, EllipsisOutlined } from '@ant-design/icons';
import PageDetailSection from '../../../../components/PageDetailSection';
import ResourceActionsDropdown from '../../../../components/ResourceActionsDropdown';
import { deleteHarvesterNad, fetchKubeOvnSubnets } from '../../../../services/harvesterApi';
import { fetchCloudProviderEcs } from '../../../../services/api';
import TableColumnSettingsButton from '../../../../components/TableColumnSettingsButton';
import { useTableColumnSettings } from '../../../../hooks/useTableColumnSettings';
import HarvesterResourceDrawer from '../components/HarvesterOpsinfoDrawer';
import NadCreateModal from '../modals/NadCreateModal';
import { isPublicNamespace } from '../../../../utils/harvesterUtils';
import { useAuth } from '../../../../contexts/AuthContext';
import { hasPermissionForAction } from '../../../../utils/accessMapping';
import {
  SUBNET_TYPE_ANNOTATION_KEY,
  TOWER_ALIAS_ANNOTATION,
} from '../kube-ovn/underlay-subnet/constants';

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

function subnetTypeToShortLabel(t: string): string {
  const s = String(t || '').trim().toLowerCase();
  if (s === 'vpc') return 'VPC 子网';
  if (s === 'flat') return '扁平子网';
  if (s === 'public') return '公共子网';
  if (s === 'external') return '外部子网';
  return s ? `类型:${s}` : '';
}

/** OVN 子网筛选下拉：与真实 Subnet metadata.name 不会冲突的哨兵值 */
const OVN_SUBNET_FILTER_NO_BINDING = '__tower_ovn_filter_no_binding__';
const OVN_SUBNET_FILTER_UNMATCHED = '__tower_ovn_filter_unmatched_subnet__';

/** kube-ovn NAD 在子网 Map 中解析到的 Subnet 对象；非 kube-ovn 或未匹配返回 null */
function resolveLinkedKubeOvnSubnet(
  record: { _name?: string; _config?: any; _type?: string },
  subnetByNameLc: Map<string, any>,
): any | null {
  const tp = String(record._type ?? '').trim().toLowerCase();
  if (tp !== 'kube-ovn') return null;
  for (const cand of collectKubeOvnSubnetNameCandidates(record)) {
    const hit = subnetByNameLc.get(cand);
    if (hit) return hit;
  }
  return null;
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
  /** 是否显示表格边框，默认 true */
  bordered?: boolean;
  /**
   * 为 true 时仅保留 CNI `type=bridge` 的 NAD（会隐藏子网配套的 `kube-ovn` 类 NAD）。
   * 默认 false：展示全部（含公共/扁平/VPC 子网关联创建的 kube-ovn NAD），便于与 Kube-OVN 子网对照排障。
   */
  onlyBridge?: boolean;
  mode?: 'standard' | 'ops';
};

const NadsSection: React.FC<Props> = ({ nads = [], loading, onRefresh, cloudId, isTenant, bordered = true, onlyBridge = false, mode = 'ops' }) => {
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
  const isStandardView = mode === 'standard';

  /** Kube-OVN Subnet 列表：用于表格「OVN 子网」关联列（与删除校验同源：通常 Subnet 名与 NAD 名一致） */
  const [ovnSubnets, setOvnSubnets] = useState<any[]>([]);
  const [ovnSubnetsLoading, setOvnSubnetsLoading] = useState(false);

  const loadOvnSubnets = useCallback(
    async (force = false) => {
      if (!cloudId) {
        setOvnSubnets([]);
        return;
      }
      setOvnSubnetsLoading(true);
      try {
        const res = await fetchKubeOvnSubnets(cloudId, force);
        const items = res?.data?.items || res?.items || [];
        setOvnSubnets(Array.isArray(items) ? items : []);
      } catch {
        setOvnSubnets([]);
      } finally {
        setOvnSubnetsLoading(false);
      }
    },
    [cloudId],
  );

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
  /** 过滤条件：按关联的 Kube-OVN Subnet 资源名（metadata.name）筛选 */
  const [ovnSubnetFilter, setOvnSubnetFilter] = useState<string>('');

  useEffect(() => {
    setOvnSubnetFilter('');
  }, [cloudId]);
  
  /** 批量选择：选中的行 key 列表 */
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);

  /** 详情抽屉：是否显示 */
  const [detailVisible, setDetailVisible] = useState(false);
  /** 详情抽屉：当前查看的记录 */
  const [detailRecord, setDetailRecord] = useState<any>(null);
  /** 详情抽屉：当前激活的标签页 */
  const [detailActiveTab, setDetailActiveTab] = useState('detail');

  /** 创建网络弹窗：是否显示 */
  const [createVisible, setCreateVisible] = useState(false);

  /**
   * 打开 HarvesterResourceDrawer，查看 NAD 详情
   * kind 固定为 NetworkAttachmentDefinition 以兼容事件等功能
   */
  const handleOpenOpsinfo = useCallback(async (record: any, tab: string = 'detail') => {
    setDetailRecord({ ...record, kind: 'NetworkAttachmentDefinition' });
    setDetailActiveTab(tab);
    setDetailVisible(true);
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
      const targetNs = record._namespace.toLowerCase();
      const targetName = record._name.toLowerCase();
      const targetRef = `${targetNs}/${targetName}`;
      
      return vms
        .filter((vm: any) => Array.isArray(vm.networks))
        .filter((vm: any) => {
          const vmNs = (vm.namespace || vm.metadata?.namespace || '').toLowerCase();
          
          return vm.networks.some((n: string) => {
            if (!n) return false;
            
            // 处理 @ 符号（如 "namespace/name@vlan"）
            const s = String(n).toLowerCase();
            const base = s.includes('@') ? s.split('@')[0] : s;
            
            // 跳过 Pod 网络和默认网络
            if (base === 'pod' || base === 'default') return false;
            
            // 情况1：完整格式精确匹配 "namespace/name"
            if (base === targetRef) return true;
            
            // 情况2：后缀匹配 "/name"
            if (base.endsWith(`/${targetName}`)) return true;
            
            // 情况3：短格式匹配（仅名称，且 VM 命名空间与 NAD 命名空间相同）
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
    } catch (e) {
      // 忽略占用检查错误，返回空数组
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
  const checkSubnetDependency = useCallback(async (record: any): Promise<string[]> => {
    try {
      const subnetsRes = await fetchKubeOvnSubnets(cloudId || '', true);
      const subnets: any[] = subnetsRes?.data?.items || subnetsRes?.items || [];
      const nadName = record._name.toLowerCase();
      
      // 检查是否有子网名称与 NAD 名称相同
      return subnets
        .filter((subnet: any) => {
          const subnetName = (subnet?.metadata?.name || subnet?.name || '').toLowerCase();
          return subnetName === nadName;
        })
        .map((subnet: any) => subnet?.metadata?.name || subnet?.name)
        .filter(Boolean);
    } catch (e) {
      // 忽略检查错误，返回空数组
      return [];
    }
  }, [cloudId]);

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
  }, [ensureNadsWrite, isTenant, checkNetworkUsage, checkSubnetDependency, cloudId, onRefresh]);

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
      const [ecsRes, subnetsRes] = await Promise.all([
        fetchCloudProviderEcs(cloudId || '', true),
        fetchKubeOvnSubnets(cloudId || '', true),
      ]);
      
      const vms: any[] = ecsRes?.data || ecsRes || [];
      const subnets: any[] = subnetsRes?.data?.items || subnetsRes?.items || [];
      
      for (const target of deletableTargets) {
        const targetNs = target._namespace.toLowerCase();
        const targetName = target._name.toLowerCase();
        const targetRef = `${targetNs}/${targetName}`;
        
        // 检查 VM 占用
        const usingVms = vms
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
        
        if (usingVms.length > 0) {
          usageMap.set(`${target._namespace}/${target._name}`, usingVms);
        }
        
        // 检查 Subnet 依赖
        const dependentSubnets = subnets
          .filter((subnet: any) => {
            const subnetName = (subnet?.metadata?.name || subnet?.name || '').toLowerCase();
            return subnetName === targetName;
          })
          .map((subnet: any) => subnet?.metadata?.name || subnet?.name)
          .filter(Boolean);
        
        if (dependentSubnets.length > 0) {
          subnetDependencyMap.set(`${target._namespace}/${target._name}`, dependentSubnets);
        }
      }
    } catch (e) {
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
            _cniVersion: config?.cniVersion
        };
    })
    .filter((x: any) => !onlyBridge || String(x?._type || '').toLowerCase().trim() === 'bridge')
    // 按 UID 或 namespace/name 去重，避免删除后接口/缓存返回重复项导致同一 key 两条记录（如 mgmt 出现两条）
    .filter((x: any, idx: number, arr: any[]) => {
      const key = x?.metadata?.uid || `${x?._namespace || ''}/${x?._name || ''}`;
      const firstIdx = arr.findIndex((y: any) => (y?.metadata?.uid || `${y?._namespace || ''}/${y?._name || ''}`) === key);
      return firstIdx === idx;
    });
  }, [nads, onlyBridge]);

  /**
   * 过滤逻辑
   * 
   * [过滤顺序]
   * 1. 关键字过滤：匹配网络名称或命名空间（不区分大小写）
   * 2. 命名空间过滤：精确匹配（不区分大小写）
   * 3. IP分配方式过滤：精确匹配（不区分大小写）
   * 
   * [过滤规则]
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

      const ovnRaw = ovnSubnetFilter.trim();
      if (ovnRaw === OVN_SUBNET_FILTER_NO_BINDING) {
        const tp = String(item._type ?? '').trim().toLowerCase();
        if (tp === 'kube-ovn') return false;
      } else if (ovnRaw && !ovnSubnetsLoading) {
        if (ovnRaw === OVN_SUBNET_FILTER_UNMATCHED) {
          const tp = String(item._type ?? '').trim().toLowerCase();
          if (tp !== 'kube-ovn') return false;
          if (resolveLinkedKubeOvnSubnet(item, subnetByNameLc)) return false;
        } else {
          const linked = resolveLinkedKubeOvnSubnet(item, subnetByNameLc);
          const linkedName = String(linked?.metadata?.name || linked?.name || '').toLowerCase();
          if (linkedName !== ovnRaw.toLowerCase()) return false;
        }
      }

      return true;
    });
  }, [
    processedData,
    keyword,
    nsFilter,
    ipamFilter,
    ovnSubnetFilter,
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

  /** OVN 子网筛选：固定项（无绑定 / 未匹配）+ 集群 Subnet 列表「别名（资源名）」 */
  const ovnSubnetSelectOptions = useMemo(() => {
    const special: { value: string; label: string }[] = [
      { value: OVN_SUBNET_FILTER_NO_BINDING, label: '无子网绑定' },
      { value: OVN_SUBNET_FILTER_UNMATCHED, label: '暂无同名子网' },
    ];
    const rows = (ovnSubnets || [])
      .map((s: any) => {
        const name = String(s?.metadata?.name || s?.name || '').trim();
        if (!name) return null;
        const ann = s?.metadata?.annotations || {};
        const alias = String(ann[TOWER_ALIAS_ANNOTATION] || '').trim();
        const label = alias ? `${alias}（${name}）` : name;
        return { value: name, label };
      })
      .filter(Boolean) as { value: string; label: string }[];
    rows.sort((a, b) => a.label.localeCompare(b.label, 'zh-CN'));
    return [...special, ...rows];
  }, [ovnSubnets]);

  // ==================== 表格配置 ====================
  
  /** 表格行选择配置：租户不可选公共命名空间；管理员全可选（含系统命名空间，便于排障批量操作） */
  const rowSelection = {
    selectedRowKeys,
    onChange: (keys: React.Key[]) => setSelectedRowKeys(keys),
    getCheckboxProps: (record: any) => ({
      disabled: !hasNadsWrite || (isTenant && isPublicNamespace(record._namespace)),
    }),
  };

  /**
   * 表格列定义
   * 
   * [列说明]
   * - 网络名称：显示别名（tower.io/alias），如果没有别名则显示 ID
   * - 网络ID：显示 NAD 的 metadata.name（K8s 资源名称）
   * - 命名空间：显示所属命名空间
   * - VLAN：如果配置了 VLAN，显示为蓝色标签
   * - IP分配方式：使用不同颜色的标签区分类型
   *   - dhcp: 绿色 (std-badge-success)
   *   - static: 蓝色 (std-badge-info)
   *   - host-local: 橙色 (std-badge-warning)
   *   - 未配置: 灰色 (std-badge-default)
   * - 混杂模式：如果开启，显示橙色标签
   * - CNI 类型：完整显示 spec.config 解析出的 type（如 kube-ovn、macvlan）；bridge 时为 `bridge/网桥名` 单行
   * - CNI版本：显示 CNI 版本号
   * - UID：显示 K8s UID
   * - 操作：操作菜单
   *   - 管理员模式：显示"运维信息"和"删除"
   *   - 租户模式：仅显示"删除"
   *   - 公共命名空间（租户）：删除按钮禁用
   */
  const allColumns = useMemo(() => [
    { 
      title: '网络名称', 
      key: 'name', 
      render: (_: any, r: any) => {
        // 优先显示别名，如果没有别名则显示 ID
        let displayName = r._alias || r._name || '-';
        // 如果名称是 mgmt，映射为管理网
        if (!r._alias && displayName === 'mgmt') {
          displayName = '管理网';
        }
        return (
          <span style={{ display: 'flex', alignItems: 'center', gap: 6, maxWidth: '100%' }}>
            <ApiTwoTone style={{ color: '#1677ff' }} />
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>{displayName}</span>
          </span>
        );
      }
    },
    { 
      title: '网络ID', 
      key: 'id', 
      render: (_: any, r: any) => (
        <span className="text-secondary">{r._name || '-'}</span>
      )
    },
    { 
      title: '命名空间', 
      key: 'ns', 
      render: (_: any, r: any) => r._namespace || '-' 
    },
    { 
      title: 'VLAN', 
      key: 'vlan', 
      render: (_: any, r: any) => r._vlan ? <Tag color="blue">{r._vlan}</Tag> : <Tag>未配置</Tag> 
    },
    { 
      title: 'IP分配方式', 
      key: 'ipamType', 
      render: (_: any, r: any) => {
          const t = String(r._ipamType || '').toLowerCase();
          if (!t) return <Tag>未配置</Tag>;
          
          let badgeClass = 'std-badge-default';
          if (t === 'dhcp') badgeClass = 'std-badge-success';
          else if (t === 'static') badgeClass = 'std-badge-info';
          else if (t === 'host-local') badgeClass = 'std-badge-warning';
          
          return <span className={`std-badge ${badgeClass}`}>{t}</span>;
      }
    },
    { 
      title: '混杂模式', 
      key: 'promisc', 
      render: (_: any, r: any) => r._promisc ? <Tag color="blue">开启</Tag> : <Tag>未配置</Tag> 
    },
    {
      title: 'CNI 类型',
      key: 'cniPluginType',
      ellipsis: true,
      render: (_: any, r: any) => {
        const tp = String(r._type ?? '').trim();
        if (!tp) return <span className="text-secondary">—</span>;
        const isBridge = tp.toLowerCase() === 'bridge';
        const br = String(r._bridge ?? '').trim();
        if (isBridge && br) {
          return (
            <span>
              <span>{tp}</span>
              <span>/{br}</span>
            </span>
          );
        }
        return (
          <span>{tp}</span>
        );
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
              <span className="text-secondary">无子网绑定</span>
            </Tooltip>
          );
        }
        if (ovnSubnetsLoading) {
          return <span className="text-secondary">加载中…</span>;
        }
        const linked = resolveLinkedKubeOvnSubnet(r, subnetByNameLc);
        if (!linked) {
          return (
            <Tooltip title="已为 kube-ovn，但在当前子网列表中未找到同名或 provider 指向的 Subnet；若刚创建请点击工具栏刷新。">
              <span className="text-secondary">暂无同名子网</span>
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
        const tip = [`名称: ${line1}`, `类型: ${typeLabel || '—'}`, `网段: ${cidr || '—'}`].join('\n');
        return (
          <Tooltip title={tip}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
              <span style={{ fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis' }}>{line1}</span>
              <span className="text-secondary" style={{ fontSize: 12, lineHeight: 1.2 }}>
                {[typeLabel || '—', cidr || '—'].join(' / ')}
              </span>
            </div>
          </Tooltip>
        );
      },
    },
    { 
      title: 'CNI版本', 
      key: 'cni', 
      render: (_: any, r: any) => r._cniVersion || '-' 
    },
    { 
      title: 'UID', 
      key: 'uid', 
      render: (_: any, r: any) => <span>{r?.metadata?.uid || '-'}</span> 
    },
    { 
      title: '操作', 
      key: 'actions', 
      width: 80,
      align: 'left' as const,
      fixed: 'right' as const,
      render: (_: any, r: any) => {
          const isPublic = isPublicNamespace(r._namespace);
          const deleteDisabled = isTenant && isPublic;
          const items: any[] = [];
          if (!isTenant && !isStandardView) {
            items.push({ key: 'opsinfo', label: '查看YAML', onClick: () => handleOpenOpsinfo(r, 'detail') });
            items.push({ type: 'divider' });
          }
          items.push({ 
            key: 'delete', 
            label: '删除', 
            danger: true, 
            disabled: deleteDisabled,
            onClick: () => handleDelete(r) 
          });
          return <ResourceActionsDropdown items={items} buttonProps={{ className: 'row-actions-trigger', disabled: !hasNadsWrite }} />;
      } 
    },
  ], [hasNadsWrite, isTenant, isStandardView, subnetByNameLc, ovnSubnetsLoading, handleDelete, handleOpenOpsinfo]);

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
              placeholder="命名空间" 
              value={nsFilter || undefined} 
              onChange={(v) => setNsFilter(v || '')} 
              className="toolbar-filter-sm"
              options={[{ value: '', label: '全部命名空间' }, ...nsOptions.map(s => ({ value: s.toLowerCase(), label: s }))]} 
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
            showSearch
            placeholder="OVN 子网"
            loading={ovnSubnetsLoading}
            disabled={!cloudId}
            value={ovnSubnetFilter || undefined}
            onChange={(v) => setOvnSubnetFilter((v as string) ?? '')}
            className="toolbar-filter-sm"
            options={ovnSubnetSelectOptions}
            optionFilterProp="label"
            notFoundContent={ovnSubnetsLoading ? '加载中…' : '暂无子网'}
          />
          <button
            type="button"
            className="toolbar-reset-btn"
            onClick={() => {
              setKeyword('');
              setNsFilter('');
              setIpamFilter('');
              setOvnSubnetFilter('');
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
        bordered={false}
        rowKey={(r: any) => r?.metadata?.uid || `${r?._namespace ?? ''}/${r?._name ?? ''}` || 'unknown'}
        rowSelection={rowSelection}
        columns={tableColumns}
        dataSource={filteredData}
        loading={loading}
        pagination={{
          size: 'small',
          showTotal: (total) => `共 ${total} 条`,
        }}
      />

      <HarvesterResourceDrawer
        open={detailVisible}
        onClose={() => setDetailVisible(false)}
        resourceType="NetworkAttachmentDefinition"
        record={detailRecord}
        activeTab={detailActiveTab}
        onTabChange={setDetailActiveTab}
        cloudId={cloudId}
      />

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
