import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Form, Input, Modal, Select, Table, Tag, Tooltip, Typography, message } from 'antd';
import { ApartmentOutlined, EditTwoTone, ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import ResourceActionsDropdown from '../../../../../../components/ResourceActionsDropdown';
import TableColumnSettingsButton from '../../../../../../components/TableColumnSettingsButton';
import WriteGuard from '../../../../../../components/WriteGuard';
import { useTableColumnSettings } from '../../../../../../hooks/useTableColumnSettings';
import {
  deleteKubeOvnSubnet,
  fetchCloudProviderOvnEips,
  fetchKubeOvnProviderNetworks,
  fetchKubeOvnSubnets,
  fetchKubeOvnVlans,
  updateKubeOvnSubnet,
} from '../../../../../../services/harvesterApi';
import { fetchCloudProviderEcs } from '../../../../../../services/api';
import { clearCache } from '../../../../../../utils/requestManager';
import SubnetDetailDrawer from '../drawers/subnet-detail-drawer';
import SubnetAclEditDrawer from '../drawers/subnet-acl-drawer';
import ResourceLinkYamlDrawer from '../../shared/components/ResourceLinkYamlDrawer';
import { useAuth } from '../../../../../../contexts/AuthContext';
import {
  hasKubeOvnFlatSubnetWrite,
  hasKubeOvnPublicSubnetWrite,
} from '../../../../../../constants/cloudPermissions';
import CreateFlatSubnetModal from '../modals/CreateFlatSubnetModal';
import CreatePublicSubnetModal from '../modals/CreatePublicSubnetModal';
import {
  SUBNET_TYPE_ANNOTATION_KEY,
  SUBNET_TYPE_FLAT_OVERLAY_ANNOTATION_KEY,
  SUBNET_TYPE_FLAT_UNDERLAY_ANNOTATION_KEY,
  TOWER_ALIAS_ANNOTATION,
  OVN_INTERNAL_ROUTE_CIDR_ANNOTATION,
  resolveTowerUnderlaySubnetCategory,
  KUBE_OVN_PUBLIC_VPC,
  TOWER_IO_NAMESPACES_ANNOTATION,
} from '../lib/kubeOvnSubnetConstants';
import { TOWER_IO_ALIES_ANNOTATION } from '../../../../../../utils/towerKubeOvnNames';
import { formatKubeOvnFriendlyError } from '../../../../../../utils/kubeOvnFriendlyError';
import UnderlaySubnetFormFields, {
  findVlanRecordBySubnetRef,
  providerDisplayName,
  vlanRecordLabelForSelect,
  vlanRecordSearchBlob,
} from '../lib/UnderlaySubnetFormFields';
import {
  findExcludeIpUsedByAnyVm,
  validateFlatSubnetExcludeIpsLocal,
} from '../lib/flatSubnetExcludeIpValidation';
import { getFlatSubnetDeleteBlockedByNatMessage } from '../lib/flatSubnetNatDeleteGuard';
import {
  createHarvesterToolbarRefresh,
  runHarvesterSectionRefresh,
  type HarvesterSectionOnRefresh,
} from '../lib/kubeOvnSectionRefresh';
import { compactActionMenuItems, writeMenuItemIf } from '../../../../../../utils/rbacUi';

/** subnet 注解：曾绑 VLAN/物理网下由集群或控制台写入；无 VLAN overlay 应与新建扁平子网一致并清除 */
const TOWER_PROVIDER_NETWORK_ANNOTATION = 'tower.io/provider-network';

const { Option } = Select;

/**
 * =============================================================================
 * 网络概念区分（与 NAD、其它子网页对照）
 * =============================================================================
 *
 * 【NAD 网络】NetworkAttachmentDefinition（见 sections/NadsSection）
 *   - Multus 侧「多网卡接哪条网络」：bridge / kube-ovn / macvlan 等由 spec.config 决定。
 *   - VM 选附加网络时常选 NAD。旧式扁平多为 bridge；Kube-OVN 子网会配套同名 NAD（type=kube-ovn）。
 *
 * 【扁平子网】本组件 mode=flat，注解 tower.io/subnet-type=flat
 *   - 挂在内置 VPC ovn-internal 下的 Kube-OVN 子网（兼容历史 ovn-cluster）；可选绑定 VLAN（spec.vlan）。
 *   - 不选 VLAN：纯 OVN overlay，与同 VPC 内其它资源互通，不经物理 VLAN 上行（适合不需开通 VPC 高级能力的租户隔离网段）。
 *   - 选择 VLAN：与物理线路打标签对接，二层直通类场景；创建默认 natOutgoing=true（与公共/VPC 子网一致）。
 *
 * 【公共子网】本组件 mode=public，注解 tower.io/subnet-type=public
 *   - 挂在内置 VPC ovn-cluster，产品侧用于 EIP/NAT/浮动 IP 等南北向能力常用网段；创建默认 natOutgoing=true。
 *
 * 【VPC 子网】见 VpcSubnetsSection / VpcsSection，注解 tower.io/subnet-type=vpc
 *   - 挂在用户业务 VPC（非 ovn-cluster / ovn-internal）内，租户隔离网段。
 *
 * =============================================================================
 */
type Props = {
  cloudId: string;
  mode?: 'flat' | 'public';
  displayMode?: 'standard' | 'ops';
  /** 是否显示「查看YAML」并接入 ResourceLinkYamlDrawer（Steve links.view） */
  showYaml?: boolean;
  /** 外部持有的子网列表（如 EIP/SNAT/DNAT 依赖）需要联动刷新时使用 */
  onSubnetsChanged?: () => void | Promise<void>;
};

function subnetRecordToFormValues(record: any, _isFlatMode: boolean): Record<string, unknown> {
  const spec = record?.spec || {};
  const ann = record?.metadata?.annotations || {};
  const excludeRaw = spec.excludeIps;
  const excludeIps = Array.isArray(excludeRaw)
    ? excludeRaw.map((x: unknown) => String(x)).join('\n')
    : '';
  const base: Record<string, unknown> = {
    alias: String(ann[TOWER_ALIAS_ANNOTATION] ?? '').trim() || undefined,
    cidrBlock: spec.cidrBlock ?? spec.cidr ?? '',
    gateway: spec.gateway ?? '',
    vlan: spec.vlan ?? undefined,
    excludeIps,
  };
  return base;
}

const UnderlaySubnetsSection: React.FC<Props> = ({
  cloudId,
  mode = 'flat',
  displayMode: displayModeProp,
  showYaml = true,
  onSubnetsChanged,
}) => {
  const { user } = useAuth();
  const perms = useMemo(() => (user?.permissions ?? []) as string[], [user?.permissions]);
  const isTenantUser = useMemo(() => user?.role === 'tenant', [user?.role]);
  const resolvedDisplayMode = displayModeProp ?? (isTenantUser ? 'standard' : 'ops');
  const effectiveShowYaml = showYaml !== false;
  const isFlatMode = mode === 'flat';
  const hasUnderlayWrite = useMemo(() => {
    const hasWrite = isFlatMode ? hasKubeOvnFlatSubnetWrite(perms) : hasKubeOvnPublicSubnetWrite(perms);
    // 租户角色禁止扁平/公共子网写操作（与镜像写权限收敛策略一致）
    return hasWrite && !isTenantUser;
  }, [isFlatMode, perms, isTenantUser]);
  const ensureUnderlayWrite = useCallback(() => {
    if (hasUnderlayWrite) return true;
    message.error('当前账号没有子网操作权限（租户角色仅允许查看）');
    return false;
  }, [hasUnderlayWrite]);

  const notifySubnetsChanged = useCallback(async () => {
    try {
      await onSubnetsChanged?.();
    } catch {
      /* ignore */
    }
  }, [onSubnetsChanged]);

  /** 标准视图：隐藏 ACL 等运维列 */
  const isStandardView = resolvedDisplayMode === 'standard';
  const subnetKindLabel = isFlatMode ? '扁平子网' : '公共子网';
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  
  const [isModalVisible, setIsModalVisible] = useState(false);
  const [aclDrawerOpen, setAclDrawerOpen] = useState(false);
  const [aclSubnetRecord, setAclSubnetRecord] = useState<any | null>(null);
  const [detailDrawerOpen, setDetailDrawerOpen] = useState(false);
  const [detailSubnetRecord, setDetailSubnetRecord] = useState<any>(null);
  const [subnetYamlDrawerOpen, setSubnetYamlDrawerOpen] = useState(false);
  const [subnetYamlViewLink, setSubnetYamlViewLink] = useState<string | undefined>();
  const [editForm] = Form.useForm();
  const [editModalVisible, setEditModalVisible] = useState(false);
  const [editRecord, setEditRecord] = useState<any>(null);
  const [editSubmitting, setEditSubmitting] = useState(false);
  const [vlans, setVlans] = useState<any[]>([]);
  const [providers, setProviders] = useState<any[]>([]);
  const [keyword, setKeyword] = useState('');
  const [vlanFilter, setVlanFilter] = useState<string | undefined>(undefined);

  const filteredData = useMemo(() => {
    const k = keyword.trim().toLowerCase();
    const filtered = data.filter((item: any) => {
      const idName = String(item?.metadata?.name ?? '').toLowerCase();
      const alias = String(item?.metadata?.annotations?.[TOWER_ALIAS_ANNOTATION] ?? '').toLowerCase();
      const cidr = String(item?.spec?.cidrBlock ?? '').toLowerCase();
      if (k && !idName.includes(k) && !alias.includes(k) && !cidr.includes(k)) return false;
      if (vlanFilter !== undefined && vlanFilter !== null && String(vlanFilter) !== '') {
        const v = item?.spec?.vlan;
        if (v !== vlanFilter) return false;
      }
      return true;
    });
    
    // 按创建时间倒序排序
    return filtered.sort((a: any, b: any) => {
      const timeA = a?.metadata?.creationTimestamp || a?.createdAt || '';
      const timeB = b?.metadata?.creationTimestamp || b?.createdAt || '';
      return timeB.localeCompare(timeA);
    });
  }, [data, keyword, vlanFilter]);

  const loadTypedSubnets = useCallback(
    async (force = false, skipSync = false) => {
      const res = await fetchKubeOvnSubnets(
        cloudId,
        force,
        skipSync,
        'all',
        isTenantUser ? (isFlatMode ? true : false) : undefined,
      );
      const items = Array.isArray(res?.data?.items) ? res.data.items : [];
      const expectType = isFlatMode ? 'flat' : 'public';
      return items.filter((item: any) => {
        const t = String(item?.metadata?.annotations?.[SUBNET_TYPE_ANNOTATION_KEY] || '').trim().toLowerCase();
        if (t !== expectType) return false;
        /** 内置子网 external 由底层维护，不在本列表展示（注解将改为 tower.io/subnet-type=external） */
        if (String(item?.metadata?.name || '').trim() === 'external') return false;
        return true;
      });
    },
    [cloudId, isFlatMode, isTenantUser],
  );

  const reloadSubnetRecordForAcl = useCallback(
    async (subnetName: string) => {
      try {
        const typed = await loadTypedSubnets(true, false);
        setData(typed);
        if (cloudId) {
          clearCache(`/api/clouds/${cloudId}/resources/subnets`, 'GET');
        }
        return typed.find((x: any) => x?.metadata?.name === subnetName) ?? null;
      } catch {
        return null;
      }
    },
    [cloudId, loadTypedSubnets],
  );

  const closeAclDrawer = useCallback(() => {
    setAclDrawerOpen(false);
    setAclSubnetRecord(null);
  }, []);

  /** 安全组规则的优先级范围 */
  const TOWER_SG_ACL_PRIORITY_MIN = 31000;
  const TOWER_SG_ACL_PRIORITY_MAX = 39999;

  /** 检查ACL规则是否来自安全组同步 */
  const isRuleFromSecurityGroup = (acl: any): boolean => {
    // 通过优先级范围判断是否来自安全组（安全组规则使用 31000-39999 范围）
    const priority = Number(acl.priority);
    return Number.isFinite(priority) && 
           priority >= TOWER_SG_ACL_PRIORITY_MIN && 
           priority <= TOWER_SG_ACL_PRIORITY_MAX;
  };

  const fetchData = useCallback(
    async (force = false, skipSync = false) => {
      setLoading(true);
      try {
        const typed = await loadTypedSubnets(force, skipSync);
        setData(typed);
        if (force && cloudId) {
          clearCache(`/api/clouds/${cloudId}/resources/subnets`, 'GET');
        }
      } catch (error: any) {
        message.error(`获取${subnetKindLabel}列表失败: ${error.message}`);
      } finally {
        setLoading(false);
      }
    },
    [cloudId, loadTypedSubnets, subnetKindLabel],
  );

  const fetchVlanOptions = useCallback(async (force = false, skipSync = false) => {
    try {
      const res = await fetchKubeOvnVlans(cloudId, force, skipSync);
      setVlans(Array.isArray(res?.data?.items) ? res.data.items : []);
    } catch {
      /* ignore */
    }
  }, [cloudId]);

  const fetchProviderOptions = useCallback(async () => {
    try {
      const res = await fetchKubeOvnProviderNetworks(cloudId);
      setProviders(Array.isArray(res?.data?.items) ? res.data.items : []);
    } catch {
      /* ignore */
    }
  }, [cloudId]);

  useEffect(() => {
    if (!cloudId) return;
    void fetchData();
    void fetchVlanOptions();
    void fetchProviderOptions();
  }, [cloudId, fetchData, fetchVlanOptions, fetchProviderOptions]);

  useEffect(() => {
    if ((!isModalVisible && !editModalVisible) || !cloudId) return;
    void fetchVlanOptions(true, true);
  }, [isModalVisible, editModalVisible, cloudId, fetchVlanOptions]);

  /** 打开详情时同步 VLAN / 物理网络列表，避免详情里解析不到 spec.vlan */
  useEffect(() => {
    if (!detailDrawerOpen || !cloudId) return;
    void fetchVlanOptions(true, false);
    void fetchProviderOptions();
  }, [detailDrawerOpen, cloudId, fetchVlanOptions, fetchProviderOptions]);

  const reloadAuxiliaryOptions = useCallback(async () => {
    await Promise.all([fetchVlanOptions(), fetchProviderOptions()]);
  }, [fetchVlanOptions, fetchProviderOptions]);

  const sectionRefresh: HarvesterSectionOnRefresh = useCallback(
    async (force = true, silent?: boolean) => {
      await fetchData(force, !!silent);
      await reloadAuxiliaryOptions();
      await notifySubnetsChanged();
    },
    [fetchData, reloadAuxiliaryOptions, notifySubnetsChanged],
  );

  const handleToolbarRefresh = useMemo(
    () => createHarvesterToolbarRefresh(sectionRefresh),
    [sectionRefresh],
  );

  const refreshAfterWrite = useCallback(
    () => runHarvesterSectionRefresh(sectionRefresh, { force: true, silent: true }),
    [sectionRefresh],
  );

  const openEditNetwork = useCallback(
    (record: any) => {
      setEditRecord(record);
      if (!isFlatMode) {
        editForm.setFieldsValue({
          alias: String(record?.metadata?.annotations?.[TOWER_ALIAS_ANNOTATION] ?? '').trim() || undefined,
        });
      } else {
        editForm.setFieldsValue(subnetRecordToFormValues(record, isFlatMode));
      }
      setEditModalVisible(true);
    },
    [editForm, isFlatMode],
  );

  const handleEdit = async (values: any) => {
    if (!ensureUnderlayWrite()) return;
    const name = editRecord?.metadata?.name;
    if (!name) return;
    try {
      setEditSubmitting(true);

      if (!isFlatMode) {
        const aliasTrim = String(values.alias ?? '').trim();
        const annotations: Record<string, string> = {
          ...(editRecord?.metadata?.annotations || {}),
          [TOWER_ALIAS_ANNOTATION]: aliasTrim,
        };
        await updateKubeOvnSubnet(cloudId, name, { annotations });
        message.success(`更新${subnetKindLabel}成功`);
        setEditModalVisible(false);
        setEditRecord(null);
        editForm.resetFields();
        await refreshAfterWrite();
        return;
      }

      // 校验 EIP 占用（扁平子网改网段等）
      try {
        const eipsRes = await fetchCloudProviderOvnEips(cloudId, true, 'flat');
        const eips = Array.isArray(eipsRes?.data?.items) ? eipsRes.data.items : [];
        const blocking = eips.filter((eip: any) => {
          const sub = eip?.spec?.externalSubnet || eip?.externalSubnet;
          if (String(sub || '').trim() !== name) return false;
          const t = String(eip?.spec?.type ?? eip?.type ?? '').trim().toLowerCase();
          return t !== 'lrp';
        });
        if (blocking.length > 0) {
          const labels = blocking
            .map((e: any) => {
              const alias = String(e?.metadata?.annotations?.[TOWER_ALIAS_ANNOTATION] ?? '').trim();
              const name = String(e?.metadata?.name ?? e?.name ?? '').trim();
              return alias || name;
            })
            .filter(Boolean);
          message.error(`子网正被公网 IP ${labels.join('、')} 使用，无法修改或清空其网段信息。`);
          setEditSubmitting(false);
          return;
        }
      } catch (e) {
        console.warn('[UpdateSubnet] EIP usage check failed:', e);
      }

      const { alias: aliasFlat, ...rest } = values;
      const aliasTrim = String(aliasFlat ?? '').trim();
      const excludeIps = rest.excludeIps
        ? String(rest.excludeIps).split('\n').map((s: string) => s.trim()).filter((s: string) => s)
        : [];
      const cidrForExcludeCheck = String(
        rest.cidrBlock ?? editRecord?.spec?.cidrBlock ?? editRecord?.spec?.cidr ?? '',
      ).trim();
      const excludeLocal = validateFlatSubnetExcludeIpsLocal(cidrForExcludeCheck, excludeIps);
      if (!excludeLocal.ok) {
        message.error(`更新失败：${excludeLocal.message}`);
        setEditSubmitting(false);
        return;
      }
      try {
        const ecsRes: any = await fetchCloudProviderEcs(cloudId, true);
        const vmList: any[] = Array.isArray(ecsRes?.data)
          ? ecsRes.data
          : Array.isArray(ecsRes)
            ? ecsRes
            : [];
        const conflict = findExcludeIpUsedByAnyVm(excludeIps, vmList);
        if (conflict) {
          message.error(
            `更新失败：排除 IP「${conflict.ip}」已被虚拟机「${conflict.vmLabel}」占用，无法加入排除列表。`,
          );
          setEditSubmitting(false);
          return;
        }
      } catch {
        /* 列表拉取失败时仍提交，由后端校验 */
      }
      const vlanRaw = rest.vlan;
      const hasVlan =
        vlanRaw !== undefined && vlanRaw !== null && String(vlanRaw).trim() !== '';
      const annotations: Record<string, string | null> = {
        ...(editRecord?.metadata?.annotations || {}),
        [TOWER_ALIAS_ANNOTATION]: aliasTrim,
      };
      if (isFlatMode) {
        annotations[SUBNET_TYPE_ANNOTATION_KEY] = 'flat';
        annotations[SUBNET_TYPE_FLAT_UNDERLAY_ANNOTATION_KEY] = hasVlan ? 'true' : null;
        annotations[SUBNET_TYPE_FLAT_OVERLAY_ANNOTATION_KEY] = hasVlan ? null : 'true';
        if (!hasVlan) {
          annotations[TOWER_PROVIDER_NETWORK_ANNOTATION] = null;
          if (!String(annotations[TOWER_IO_NAMESPACES_ANNOTATION] ?? '').trim()) {
            annotations[TOWER_IO_NAMESPACES_ANNOTATION] = 'default';
          }
        }
      }
      const payload: Record<string, unknown> = {
        cidrBlock: String(rest.cidrBlock ?? '').trim(),
        gateway: String(rest.gateway ?? '').trim(),
        excludeIps,
        annotations,
      };
      if (hasVlan) {
        payload.vlan = vlanRaw;
        payload.vpc = KUBE_OVN_PUBLIC_VPC;
      } else {
        // 仅清 VLAN：不要在同一 PATCH 里强改 vpc/provider，Kube-OVN admission 常驳回
        payload.vlan = null;
      }
      await updateKubeOvnSubnet(cloudId, name, payload);
      message.success(`更新${subnetKindLabel}成功`);
      setEditModalVisible(false);
      setEditRecord(null);
      editForm.resetFields();
      await refreshAfterWrite();
    } catch (error: any) {
      const raw =
        error?.response?.data?.message ??
        error?.response?.data?.error ??
        error?.response?.data ??
        error?.data?.message ??
        error?.message ??
        '未知错误';
      const detail = typeof raw === 'string' ? raw : JSON.stringify(raw);
      message.error(`更新${subnetKindLabel}失败：${formatKubeOvnFriendlyError(detail)}`);
    } finally {
      setEditSubmitting(false);
    }
  };

  const openAclEditor = useCallback((record: any) => {
    const name = record?.metadata?.name;
    if (!name) return;
    setAclSubnetRecord(record);
    setAclDrawerOpen(true);
  }, []);

  const openOpsDrawer = useCallback((record: any) => {
    setDetailSubnetRecord(record);
    setDetailDrawerOpen(true);
  }, []);

  const openSubnetYamlDrawer = useCallback((record: any) => {
    const link = String(record?.links?.view ?? '').trim();
    if (!link) {
      message.warning('当前子网缺少 View Link，无法加载 YAML');
      return;
    }
    setSubnetYamlViewLink(link);
    setSubnetYamlDrawerOpen(true);
  }, []);

  const closeSubnetYamlDrawer = useCallback(() => {
    setSubnetYamlDrawerOpen(false);
    setSubnetYamlViewLink(undefined);
  }, []);

  const handleDelete = useCallback(
    async (name: string) => {
      if (!ensureUnderlayWrite()) return;
      try {
        await deleteKubeOvnSubnet(cloudId, name);
        message.success('删除成功');
        await refreshAfterWrite();
      } catch (error: any) {
        const raw =
          error?.response?.data?.message ??
          error?.response?.data?.error ??
          error?.response?.data ??
          error?.data?.message ??
          error?.data ??
          error?.message ??
          '未知错误';
        const detail = typeof raw === 'string' ? raw : JSON.stringify(raw);
        message.error(`删除失败：${formatKubeOvnFriendlyError(detail)}`);
      }
    },
    [cloudId, ensureUnderlayWrite, refreshAfterWrite],
  );

  const allColumns = useMemo(
    () => [
      {
        title: '名称',
        key: 'displayName',
        fixed: 'left' as const,
        ellipsis: isFlatMode ? ({ showTitle: false } as const) : true,
        render: (_: any, record: any) => {
          const alias = String(record?.metadata?.annotations?.[TOWER_ALIAS_ANNOTATION] ?? '').trim();
          const idName = String(record?.metadata?.name ?? '').trim();
          const display = alias || idName || '—';
          const editAriaLabel = isFlatMode
            ? '编辑子网'
            : alias
              ? '修改网络名称'
              : '设置网络名称';

          if (!isFlatMode) {
            return (
              <>
                <Typography.Link
                  onClick={(e) => {
                    e.preventDefault();
                    openOpsDrawer(record);
                  }}
                >
                  {display}
                </Typography.Link>
                {hasUnderlayWrite ? (
                  <Button
                    type="text"
                    size="small"
                    icon={<EditTwoTone />}
                    aria-label={editAriaLabel}
                    onClick={(e) => {
                      e.stopPropagation();
                      openEditNetwork(record);
                    }}
                  />
                ) : null}
              </>
            );
          }

          const NameIcon = ApartmentOutlined;
          const nameInner = (
            <>
              <NameIcon style={{ color: '#1677ff' }} />
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>{display}</span>
            </>
          );
          return (
            <span style={{ display: 'flex', alignItems: 'center', maxWidth: '100%', minWidth: 0 }}>
              <span
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  maxWidth: '100%',
                  minWidth: 0,
                }}
              >
                <Typography.Link
                  onClick={(e) => {
                    e.preventDefault();
                    openOpsDrawer(record);
                  }}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    maxWidth: '100%',
                    minWidth: 0,
                    flex: 1,
                  }}
                >
                  {nameInner}
                </Typography.Link>
                {hasUnderlayWrite ? (
                  <Button
                    type="text"
                    size="small"
                    icon={<EditTwoTone />}
                    aria-label={editAriaLabel}
                    onClick={(e) => {
                      e.stopPropagation();
                      openEditNetwork(record);
                    }}
                  />
                ) : null}
              </span>
            </span>
          );
        },
      },
      {
        title: 'ID',
        key: 'resourceId',
        ellipsis: true,
        render: (_: any, record: any) => {
          const id = String(record?.metadata?.name ?? '').trim() || '—';
          return <span title={id}>{id}</span>;
        },
      },
      {
        title: '子网分类',
        key: 'towerUnderlayCategory',
        render: (_: any, record: any) => {
          const { category, label } = resolveTowerUnderlaySubnetCategory(record, isFlatMode ? 'flat' : 'public');
          const color =
            category === 'public'
              ? 'geekblue'
              : category === 'flat-underlay'
                ? 'blue'
                : category === 'flat-overlay'
                  ? 'cyan'
                  : 'default';
          return <Tag color={color}>{label}</Tag>;
        },
      },
      { title: 'CIDR', dataIndex: ['spec', 'cidrBlock'], key: 'cidr' },
      ...(!isFlatMode
        ? [
            {
              title: '可访问范围',
              key: 'ovnInternalRouteCidr',
              ellipsis: true,
              render: (_: any, record: any) => {
                const v = String(
                  record?.metadata?.annotations?.[OVN_INTERNAL_ROUTE_CIDR_ANNOTATION] ?? '',
                ).trim();
                return <span title={v || undefined}>{v || '—'}</span>;
              },
            },
          ]
        : []),
      { title: '网关', dataIndex: ['spec', 'gateway'], key: 'gateway' },
      {
        title: 'DHCP',
        key: 'dhcp',
        render: (_: any, record: any) => {
          const allowDhcp =
            record?.allowDhcp ??
            record?.spec?.enableDHCP ??
            record?.spec?.enableDhcp ??
            true;
          return allowDhcp ? <Tag color="green">启用</Tag> : <Tag color="default">关闭</Tag>;
        },
      },
      {
        title: 'VLAN',
        dataIndex: ['spec', 'vlan'],
        key: 'vlan',
        render: (v: string) => {
          const vlanName = String(v ?? '').trim();
          if (!vlanName) {
            return isFlatMode ? (
              <span title="未绑定 VLAN，纯 OVN overlay">overlay</span>
            ) : (
              <span>未打标签 (Untagged)</span>
            );
          }
          const vlanObj = findVlanRecordBySubnetRef(vlanName, vlans);
          if (!vlanObj) {
            return <span>{vlanName}</span>;
          }
          const ann = vlanObj?.metadata?.annotations || {};
          const alias = String(ann[TOWER_IO_ALIES_ANNOTATION] ?? '').trim();
          const tag = vlanObj?.spec?.id;
          const tagStr = tag !== undefined && tag !== null ? String(tag) : '—';
          const cr = String(vlanObj?.metadata?.name ?? '').trim();
          if (alias) {
            return (
              <span title={cr ? `VLAN 资源名：${cr}` : undefined}>
                {`${alias}（VLAN ${tagStr}）`}
              </span>
            );
          }
          return <span title={cr ? `VLAN 资源名：${cr}` : undefined}>{`VLAN ${tagStr}`}</span>;
        },
      },
      ...(isFlatMode
        ? []
        : [
            {
              title: '物理网络',
              key: 'provider',
              render: (_: any, record: any) => {
                const vlanRef = String(record?.spec?.vlan ?? '').trim();
                const vlanObj = vlanRef ? findVlanRecordBySubnetRef(vlanRef, vlans) : undefined;
                const byVlan = String(vlanObj?.spec?.provider ?? '').trim();
                const hint = record?.metadata?.annotations?.['tower.io/provider-network'];
                const providerName = byVlan || String(hint ?? '').trim();
                if (!providerName) return '-';
                const display = providerDisplayName(providerName, providers);
                return display !== providerName ? (
                  <Tooltip title={`资源名: ${providerName}`}>
                    <span>{display}</span>
                  </Tooltip>
                ) : (
                  <span>{display}</span>
                );
              },
            },
          ]),
      {
        title: '已用 / 总数',
        key: 'usage',
        render: (_: any, record: any) => {
          const st = record.status || {};
          const available = Number(
            st.v4AvailableIPs ??
              st.v4availableIPs ??
              st.availableIPs ??
              st.availableIps ??
              0,
          ) || 0;
          const used = Number(
            st.v4UsingIPs ?? st.v4usingIPs ?? st.usingIPs ?? st.usingIps ?? 0,
          ) || 0;
          const total = Math.max(available + used, 0);
          return (
            <span title={`已用 ${used}（总数 ${total}，可用 ${available}）`}>
              {used} / {total}
            </span>
          );
        },
      },
      {
        title: '创建时间',
        key: 'createdAt',
        render: (_: any, r: any) => {
          const c = r?.metadata?.creationTimestamp || r?.createdAt || '';
          try {
            if (!c) return '-';
            const d = new Date(c);
            if (!isNaN(d.getTime())) {
              const txt = d.toLocaleString('zh-CN', { hour12: false });
              return txt;
            }
          } catch { }
          return c || '-';
        },
      },

      ...(isStandardView
        ? []
        : [
            {
              title: 'ACL',
              key: 'acls',
              render: (_: any, record: any) => {
                const acls = record?.spec?.acls;
                const n = Array.isArray(acls) 
                  ? acls
                      .filter((a: any) => !isRuleFromSecurityGroup(a))
                      .length 
                  : 0;
                if (!hasUnderlayWrite) return <span>{n} 条</span>;
                return (
                  <Typography.Link
                    onClick={(e) => {
                      e.preventDefault();
                      openAclEditor(record);
                    }}
                  >
                    {n} 条
                  </Typography.Link>
                );
              },
            },
          ]),
      ...(isFlatMode
        ? [
            {
              title: '排除 IP',
              key: 'excludeIps',
              ellipsis: true,
              render: (_: any, record: any) => {
                const ex = record?.spec?.excludeIps;
                let parts: string[] = [];
                if (ex == null || ex === '') {
                  parts = [];
                } else if (Array.isArray(ex)) {
                  parts = ex.map((x: unknown) => String(x || '').trim()).filter(Boolean);
                } else {
                  parts = String(ex)
                    .split(/[\n,]/)
                    .map((s) => s.trim())
                    .filter(Boolean);
                }
                if (!parts.length) {
                  return <span style={{ color: '#ccc' }}>—</span>;
                }
                const allText = parts.join('\n');
                const first = parts[0];
                return <span title={allText}>{first}</span>;
              },
            },
          ]
        : []),
      {
        title: '操作',
        key: 'action',
        align: 'left' as const,
        fixed: 'right' as const,
        render: (_: any, record: any) => {
          const name = record?.metadata?.name;
          const actionItems = compactActionMenuItems([
            ...(effectiveShowYaml
              ? [{ key: 'view_yaml', label: '查看YAML', onClick: () => openSubnetYamlDrawer(record) }]
              : []),
            {
              key: 'detail',
              label: '查看详情',
              onClick: () => openOpsDrawer(record),
            },
            ...(!isStandardView
              ? writeMenuItemIf(hasUnderlayWrite, {
                  key: 'edit_acl',
                  label: '编辑 ACL',
                  onClick: () => openAclEditor(record),
                })
              : []),
            ...(hasUnderlayWrite
              ? [
                  { type: 'divider' as const },
                  {
                    key: 'delete',
                    label: '删除',
                    danger: true,
                    onClick: () => {
                      void (async () => {
                        if (!name) return;
                        if (isFlatMode) {
                          const subnetName = String(record?.metadata?.name ?? '').trim();
                          const cidr = String(record?.spec?.cidrBlock ?? record?.spec?.cidr ?? '').trim();
                          const block = await getFlatSubnetDeleteBlockedByNatMessage(
                            cloudId,
                            subnetName,
                            cidr,
                          );
                          if (block) {
                            message.warning(block);
                            return;
                          }
                        }
                        const disp =
                          String(record?.metadata?.annotations?.[TOWER_ALIAS_ANNOTATION] ?? '').trim() ||
                          name;
                        Modal.confirm({
                          title: '确认删除',
                          okType: 'danger',
                          content: `确定删除该${subnetKindLabel}「${disp}」吗？`,
                          onOk: () => handleDelete(name),
                        });
                      })();
                    },
                  },
                ]
              : []),
          ]);
          return (
            <ResourceActionsDropdown
              items={actionItems}
              buttonProps={{ className: 'row-actions-trigger' }}
            />
          );
        },
      },
    ],
    [
      subnetKindLabel,
      openOpsDrawer,
      openSubnetYamlDrawer,
      openEditNetwork,
      isFlatMode,
      isStandardView,
      vlans,
      providers,
      effectiveShowYaml,
      hasUnderlayWrite,
      handleDelete,
      openAclEditor,
      cloudId,
    ],
  );

  const underlaySubnetTableSettingsKey = `harvester_underlay_subnets_${mode}`;
  /** 扁平子网列表：ACL 列默认隐藏，可在「列设置」中勾选展示 */
  const underlaySubnetDefaultHiddenColumns = useMemo(
    () => (isFlatMode ? (['acls'] as const) : []),
    [isFlatMode],
  );
  const { displayColumns: columns } = useTableColumnSettings(
    allColumns,
    underlaySubnetTableSettingsKey,
    [...underlaySubnetDefaultHiddenColumns],
  );

  return (
    <div>
      <div className="page-toolbar">
        <div className="toolbar-container">
          <Input
            allowClear
            placeholder={isFlatMode ? '名称/CIDR/ID' : '名称/网段/ID'}
            suffix={<SearchOutlined style={{ color: 'rgba(0,0,0,.45)' }} />}
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            className="toolbar-search"
          />
          <Select
            allowClear
            placeholder="筛选 VLAN"
            className="toolbar-filter"
            value={vlanFilter}
            onChange={setVlanFilter}
            showSearch
            optionFilterProp="label"
          >
            {vlans.map((v) => (
              <Option key={v.metadata.name} value={v.metadata.name} label={vlanRecordSearchBlob(v, providers)}>
                {vlanRecordLabelForSelect(v, providers)}
              </Option>
            ))}
          </Select>
          <Button
            type="link"
            className="toolbar-reset-btn"
            onClick={() => {
              setKeyword('');
              setVlanFilter(undefined);
              void handleToolbarRefresh();
            }}
          >
            重置
          </Button>
        </div>
        <div className="toolbar-actions">
          <WriteGuard canWrite={hasUnderlayWrite}>
            <Button
              type="primary"
              onClick={() => {
                if (!ensureUnderlayWrite()) return;
                setIsModalVisible(true);
              }}
            >
              {`创建${subnetKindLabel}`}
            </Button>
          </WriteGuard>
          <TableColumnSettingsButton
            allColumns={allColumns}
            settingsKey={underlaySubnetTableSettingsKey}
            defaultHiddenColumns={[...underlaySubnetDefaultHiddenColumns]}
          />
          <Tooltip title="从集群重新同步子网列表，并刷新本地缓存">
            <Button icon={<ReloadOutlined />} onClick={handleToolbarRefresh} loading={loading} aria-label="刷新" />
          </Tooltip>
        </div>
      </div>

      <Table
        className="std-table"
        bordered={false}
        columns={columns}
        dataSource={filteredData}
        rowKey={(r) => r.metadata.name}
        loading={loading}
        scroll={{ x: true }}
        pagination={{ showTotal: (total) => `共 ${total} 条` }}
      />

      <SubnetDetailDrawer
        open={detailDrawerOpen}
        onClose={() => {
          setDetailDrawerOpen(false);
          setDetailSubnetRecord(null);
        }}
        subnet={detailSubnetRecord}
        kindLabel={subnetKindLabel}
        vlans={vlans}
        providers={providers}
      />

      <ResourceLinkYamlDrawer
        open={subnetYamlDrawerOpen}
        onClose={closeSubnetYamlDrawer}
        cloudId={cloudId}
        viewLink={subnetYamlViewLink}
        title="查看 YAML"
      />

      {isFlatMode ? (
        <CreateFlatSubnetModal
          open={isModalVisible}
          onClose={() => setIsModalVisible(false)}
          cloudId={cloudId}
          vlans={vlans}
          providers={providers}
          aliasDupCheckItems={data}
          onSuccess={async () => {
            await refreshAfterWrite();
          }}
        />
      ) : (
        <CreatePublicSubnetModal
          open={isModalVisible}
          onClose={() => setIsModalVisible(false)}
          cloudId={cloudId}
          vlans={vlans}
          providers={providers}
          aliasDupCheckItems={data}
          title={`创建${subnetKindLabel}`}
          onSuccess={async () => {
            await refreshAfterWrite();
          }}
        />
      )}

      <Modal
        title="编辑名称"
        open={editModalVisible}
        onOk={editForm.submit}
        onCancel={() => {
          setEditModalVisible(false);
          setEditRecord(null);
          editForm.resetFields();
        }}
        confirmLoading={editSubmitting}
        width={600}
        destroyOnHidden
      >
        <Form form={editForm} layout="vertical" onFinish={handleEdit} className="std-form">
          <UnderlaySubnetFormFields
            form={editForm}
            isFlatMode={isFlatMode}
            vlans={vlans}
            providers={providers}
            aliasDupCheckItems={data}
            editingSubnetResourceName={editRecord?.metadata?.name}
            publicEditNameOnly={!isFlatMode}
          />
        </Form>
      </Modal>

      <SubnetAclEditDrawer
        open={aclDrawerOpen}
        onClose={closeAclDrawer}
        cloudId={cloudId}
        subnet={aclSubnetRecord}
        canSubmit={hasUnderlayWrite}
        reloadSubnetRecord={reloadSubnetRecordForAcl}
        onSuccess={async () => {
          await refreshAfterWrite();
        }}
      />
    </div>
  );
};

export default UnderlaySubnetsSection;
