import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  ConfigProvider,
  Descriptions,
  Drawer,
  Empty,
  Form,
  Input,
  List,
  message,
  Modal,
  Select,
  Space,
  Spin,
  Tabs,
  Tag,
  Typography,
  theme,
} from 'antd';
import { CodeOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import {
  createKubeOvnVlan,
  deleteKubeOvnVlan,
  deleteKubeOvnSubnet,
  fetchKubeOvnProviderNetworks,
  fetchKubeOvnSubnets,
  fetchKubeOvnVlans,
  updateKubeOvnSubnet,
} from '../../../../../../../services/harvesterApi';
import { clearCache } from '../../../../../../../utils/requestManager';
import { useAuth } from '../../../../../../../contexts/AuthContext';
import { hasPermissionForAction } from '../../../../../../../utils/accessMapping';
import { CLOUD_SUBNETS_FLAT_WRITE, CLOUD_SUBNETS_PUBLIC_WRITE } from '../../../../../../../constants/cloudPermissions';
import { TOWER_IO_ALIES_ANNOTATION, generateKubeOvnTwelveCharName } from '../../../../../../../utils/towerKubeOvnNames';
import CreateFlatSubnetModal from '../../modals/CreateFlatSubnetModal';
import CreatePublicSubnetModal from '../../modals/CreatePublicSubnetModal';
import { SUBNET_TYPE_ANNOTATION_KEY, TOWER_ALIAS_ANNOTATION } from '../../lib/kubeOvnSubnetConstants';
import UnderlaySubnetFormFields from '../../lib/UnderlaySubnetFormFields';
import { getFlatSubnetDeleteBlockedByNatMessage } from '../../lib/flatSubnetNatDeleteGuard';
import { formatOriginNicsDetailLines, parseProviderNetworkOriginNics } from '../../lib/providerNetworkOriginNics';
import { ViewLinkTab } from '../../../shared/components/ViewLinkTab';

/**
 * 主抽屉 Tab 分段。`yaml` 仅作入口兼容：打开时会切到默认 Tab 并弹出 YAML 子抽屉。
 * 网络拓扑图仅在 Cloudmap「资源总览」中提供，本抽屉不再包含拓扑 Tab。
 */
export type ProviderNetworkDetailDrawerSegment = 'network' | 'vlan' | 'yaml';

export type ProviderNetworkDetailDrawerProps = {
  open: boolean;
  onClose: () => void;
  cloudId: string;
  /** 创建成功后回调（刷新外层列表等） */
  onSuccess?: () => void | Promise<void>;
  /** 从某条物理网络打开时锁定 Provider，列表仅展示该物理网络下的 VLAN */
  lockProviderName?: string | null;
  /** 打开时选中的分段（默认网络规划） */
  initialSegment?: ProviderNetworkDetailDrawerSegment;
};

/** 每个 Tab 面板根节点：仅上下留白（左右由 Tab 默认对齐；外层 .provider-network-detail-drawer-scroll 不设 padding） */
const TAB_PANEL_PADDING: React.CSSProperties = { padding: '4px 0 16px' };

const networkDescLabelStyle: React.CSSProperties = {
  width: 120,
  background: 'rgba(0,0,0,0.02)',
};

const TAB_BAR_STYLE: React.CSSProperties = { marginBottom: 8, fontWeight: 500 };

/** Tab 整段（含 Tab 栏 + 内容）的外层：占抽屉剩余高度，可纵向滚动；padding 为 0 */
const DRAWER_SCROLL_BODY: React.CSSProperties = {
  flex: 1,
  minHeight: 0,
  overflow: 'auto',
  padding: '0 22px',
};

const TAB_PANEL_NETWORK: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 0,
  ...TAB_PANEL_PADDING,
};

const TAB_PANEL_PLAN: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 16,
  ...TAB_PANEL_PADDING,
};

const PROVIDER_SELECT_BLOCK: React.CSSProperties = { marginBottom: 12 };

const NO_PN_EMPTY_WRAP: React.CSSProperties = {
  flex: 1,
  minHeight: 200,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
};

/** YAML 子抽屉内 ViewLink 区域高度 */
const YAML_SUB_DRAWER_VIEW_LINK_BOX: React.CSSProperties = {
  width: '100%',
  flex: 1,
  minHeight: 360,
  display: 'flex',
  flexDirection: 'column',
};

/** 与 PhysicalSwitchDetailDrawer / 物理交换机详情抽屉-壳层与实现规范 对齐 */
const UI = {
  shell: '#0f1419',
  shellMuted: '#1a222d',
  text: '#e6edf3',
  textMuted: '#8b949e',
  bodyBg: '#f0f2f5',
  accent: '#58a6ff',
  border: 'rgba(230, 237, 243, 0.12)',
};

const HERO_KPI_DIVIDER: React.CSSProperties = {
  width: 1,
  alignSelf: 'stretch',
  minHeight: 40,
  background: UI.border,
  flexShrink: 0,
};

const HERO_TAG_BASE: React.CSSProperties = {
  margin: 0,
  fontSize: 12,
  lineHeight: '20px',
  borderRadius: 6,
};
const heroTagSuccess: React.CSSProperties = {
  ...HERO_TAG_BASE,
  background: 'rgba(63, 185, 80, 0.14)',
  border: '1px solid rgba(63, 185, 80, 0.38)',
  color: '#7ee787',
};
const heroTagWarning: React.CSSProperties = {
  ...HERO_TAG_BASE,
  background: 'rgba(210, 153, 34, 0.14)',
  border: '1px solid rgba(210, 153, 34, 0.4)',
  color: '#e3b341',
};
const heroNeutralTagWrap: React.CSSProperties = {
  ...HERO_TAG_BASE,
  background: 'rgba(255, 255, 255, 0.07)',
  border: '1px solid rgba(230, 237, 243, 0.18)',
  color: UI.textMuted,
};

const heroActionTextPrimary: React.CSSProperties = { fontSize: 12, color: UI.accent, height: 'auto', paddingInline: 0 };
const heroActionTextSecondary: React.CSSProperties = { fontSize: 12, color: UI.textMuted, height: 'auto', paddingInline: 0 };

type KpiTone = 'ok' | 'warn' | 'err' | 'muted';

type PulseStatProps = {
  label: string;
  children: React.ReactNode;
  tone?: KpiTone;
};

const KPI_VALUE_COLOR: Record<KpiTone, string> = {
  ok: '#7ee787',
  err: '#ff7b72',
  warn: '#e3b341',
  muted: UI.text,
};

const PulseStat: React.FC<PulseStatProps> = ({ label, children, tone = 'muted' }) => (
  <div style={{ flex: '1 1 auto', minWidth: 88, maxWidth: '100%', padding: '2px 14px 0' }}>
    <Typography.Text style={{ fontSize: 12, color: UI.textMuted, display: 'block', marginBottom: 4 }}>
      {label}
    </Typography.Text>
    <div style={{ fontSize: 14, fontWeight: 600, color: KPI_VALUE_COLOR[tone], lineHeight: 1.35 }}>
      {children}
    </div>
  </div>
);

const ProviderNetworkDetailDrawer: React.FC<ProviderNetworkDetailDrawerProps> = ({
  open,
  onClose,
  cloudId,
  onSuccess,
  lockProviderName,
  initialSegment = 'vlan',
}) => {
  const { user } = useAuth();
  const canWriteVlan = hasPermissionForAction(user?.permissions || [], 'clouds.vlans:write');
  const isTenantUser = user?.role === 'tenant' || !!user?.tenantId;
  const canWriteFlatSubnet = useMemo(() => {
    const perms = (user?.permissions ?? []) as string[];
    const hasWrite =
      hasPermissionForAction(perms, CLOUD_SUBNETS_FLAT_WRITE) ||
      hasPermissionForAction(perms, 'clouds.subnets:write') ||
      hasPermissionForAction(perms, 'clouds.vpcs:write') ||
      hasPermissionForAction(perms, 'clouds:write');
    return hasWrite && !isTenantUser;
  }, [user?.permissions, isTenantUser]);

  const canWritePublicSubnet = useMemo(() => {
    const perms = (user?.permissions ?? []) as string[];
    const hasWrite =
      hasPermissionForAction(perms, CLOUD_SUBNETS_PUBLIC_WRITE) ||
      hasPermissionForAction(perms, 'clouds.subnets:write') ||
      hasPermissionForAction(perms, 'clouds.vpcs:write') ||
      hasPermissionForAction(perms, 'clouds:write');
    return hasWrite && !isTenantUser;
  }, [user?.permissions, isTenantUser]);

  const [form] = Form.useForm();
  const [providers, setProviders] = useState<any[]>([]);
  const [userSelectedPn, setUserSelectedPn] = useState<string | undefined>();
  const [vlanItems, setVlanItems] = useState<any[]>([]);
  const [vlanLoading, setVlanLoading] = useState(false);
  const [subnetItems, setSubnetItems] = useState<any[]>([]);
  const [subnetLoading, setSubnetLoading] = useState(false);
  const [providersLoading, setProvidersLoading] = useState(false);
  const [submitLoading, setSubmitLoading] = useState(false);
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [editSubnetModalOpen, setEditSubnetModalOpen] = useState(false);
  const [editingSubnet, setEditingSubnet] = useState<any>(null);
  const [editSubnetForm] = Form.useForm();
  const [editSubnetLoading, setEditSubnetLoading] = useState(false);
  const [deletingName, setDeletingName] = useState<string | null>(null);
  const [flatSubnetModalOpen, setFlatSubnetModalOpen] = useState(false);
  const [deletingFlatSubnetName, setDeletingFlatSubnetName] = useState<string | null>(null);
  const [publicSubnetModalOpen, setPublicSubnetModalOpen] = useState(false);
  const [deletingPublicSubnetName, setDeletingPublicSubnetName] = useState<string | null>(null);
  const [drawerSegment, setDrawerSegment] = useState<ProviderNetworkDetailDrawerSegment>('vlan');
  const [yamlSubDrawerOpen, setYamlSubDrawerOpen] = useState(false);

  useEffect(() => {
    if (!open) {
      setYamlSubDrawerOpen(false);
      return;
    }
    const raw = String(initialSegment ?? 'vlan').trim();
    if (raw === 'yaml') {
      setDrawerSegment('vlan');
      setYamlSubDrawerOpen(true);
    } else if (raw === 'network') {
      setDrawerSegment('network');
    } else if (raw === 'topology') {
      /* 旧入口兼容：拓扑已迁至资源总览 */
      setDrawerSegment('vlan');
    } else {
      setDrawerSegment('vlan');
    }
  }, [open, initialSegment]);

  const loadVlans = useCallback(
    async (force = true) => {
      if (!cloudId) return;
      setVlanLoading(true);
      try {
        const res = await fetchKubeOvnVlans(cloudId, force, false);
        const items = Array.isArray(res?.data?.items) ? res.data.items : [];
        setVlanItems(items);
        if (force && cloudId) {
          clearCache(`/api/clouds/${cloudId}/resources/vlans`, 'GET');
        }
      } catch (e: any) {
        message.error(e?.message || '加载 VLAN 列表失败');
        setVlanItems([]);
      } finally {
        setVlanLoading(false);
      }
    },
    [cloudId],
  );

  const loadProviders = useCallback(async () => {
    if (!cloudId) return;
    setProvidersLoading(true);
    try {
      const res = await fetchKubeOvnProviderNetworks(cloudId);
      setProviders(Array.isArray(res?.data?.items) ? res.data.items : []);
    } catch {
      setProviders([]);
    } finally {
      setProvidersLoading(false);
    }
  }, [cloudId]);

  const loadSubnets = useCallback(async () => {
    if (!cloudId) return;
    setSubnetLoading(true);
    try {
      const res = await fetchKubeOvnSubnets(cloudId, true, true);
      setSubnetItems(Array.isArray(res?.data?.items) ? res.data.items : []);
      clearCache(`/api/clouds/${cloudId}/resources/subnets`, 'GET');
    } catch {
      setSubnetItems([]);
    } finally {
      setSubnetLoading(false);
    }
  }, [cloudId]);

  useEffect(() => {
    if (!open || !cloudId) return;
    void loadVlans(true);
    void loadProviders();
    void loadSubnets();
  }, [open, cloudId, loadVlans, loadProviders, loadSubnets]);

  useEffect(() => {
    if (!open || lockProviderName || providers.length === 0) return;
    setUserSelectedPn((prev) => prev ?? providers[0]?.metadata?.name);
  }, [open, lockProviderName, providers]);

  const effectiveProviderName = useMemo(() => {
    if (lockProviderName) return lockProviderName;
    return userSelectedPn ?? providers[0]?.metadata?.name ?? '';
  }, [lockProviderName, userSelectedPn, providers]);

  const effectivePn = useMemo(
    () => providers.find((p) => String(p?.metadata?.name || '').trim() === String(effectiveProviderName).trim()),
    [providers, effectiveProviderName],
  );

  /** 一次遍历生成下拉选项，避免对 providers 重复扫描 */
  const providerOptions = useMemo(() => {
    const options: { label: string; value: string }[] = [];
    (providers || []).forEach((p) => {
      const name = String(p?.metadata?.name ?? '').trim();
      if (!name) return;
      const ann = p?.metadata?.annotations || {};
      const alias = String(ann[TOWER_IO_ALIES_ANNOTATION] || '').trim();
      const display = alias || name;
      const label = alias && alias !== name ? `${alias} (${name})` : display;
      options.push({ label, value: name });
    });
    return options;
  }, [providers]);

  const lockProviderOption = useMemo(() => {
    if (!lockProviderName) return null;
    const hit = providerOptions.find((o) => o.value === lockProviderName);
    return { label: hit?.label || lockProviderName, value: lockProviderName };
  }, [lockProviderName, providerOptions]);

  useEffect(() => {
    if (!addModalOpen) return;
    form.resetFields();
    form.setFieldsValue({
      provider: lockProviderName ?? effectiveProviderName ?? undefined,
    });
  }, [addModalOpen, lockProviderName, effectiveProviderName, form]);

  const displayedVlans = useMemo(() => {
    if (!effectiveProviderName) return [];
    return vlanItems.filter(
      (v) => String(v?.spec?.provider || '').trim() === String(effectiveProviderName).trim(),
    );
  }, [vlanItems, effectiveProviderName]);

  const { publicSubnetsForPn, flatSubnetsForPn } = useMemo(() => {
    const providerName = String(effectiveProviderName || '').trim();
    const vlanByName = new Map<string, any>();
    const vlanById = new Map<string, any>();
    for (const v of vlanItems || []) {
      const vn = String(v?.metadata?.name || '').trim();
      if (vn) vlanByName.set(vn, v);
      const vid = v?.spec?.id;
      if (vid !== undefined && vid !== null && String(vid).trim() !== '') {
        vlanById.set(String(vid).trim(), v);
      }
    }
    const related = (subnetItems || [])
      .filter((sn: any) => {
        /** 内置 external 不在物理网络规划里展示 */
        if (String(sn?.metadata?.name || '').trim() === 'external') return false;
        const snVlan = String(sn?.spec?.vlan ?? '').trim();
        if (!snVlan) return false;
        const vlanItem = vlanByName.get(snVlan) || vlanById.get(snVlan);
        if (!vlanItem) return false;
        const vlanProvider = String(vlanItem?.spec?.provider || '').trim();
        return !!providerName && vlanProvider === providerName;
      })
      .map((sn: any) => {
        const snAnn = sn?.metadata?.annotations || {};
        const vlanName = String(sn?.spec?.vlan || '').trim();
        const vlanItem = vlanByName.get(vlanName) || vlanById.get(vlanName);
        const vlanMetaName = String(vlanItem?.metadata?.name || '').trim();
        const vlanId = vlanItem?.spec?.id;

        return {
          name: String(sn?.metadata?.name || '-'),
          alias: String(snAnn[TOWER_ALIAS_ANNOTATION] || '').trim(),
          vlan: vlanMetaName || vlanName || '-',
          vlanId: vlanId !== undefined && vlanId !== null ? String(vlanId) : null,
          cidr: String(sn?.spec?.cidrBlock || sn?.spec?.cidr || '-'),
          gateway: String(sn?.spec?.gateway || '-'),
          excludeIps: Array.isArray(sn?.spec?.excludeIps) ? sn.spec.excludeIps : [],
          type: String(snAnn[SUBNET_TYPE_ANNOTATION_KEY] || '').trim().toLowerCase(),
        };
      });
    return {
      publicSubnetsForPn: related.filter((s) => s.type === 'public'),
      flatSubnetsForPn: related.filter((s) => s.type === 'flat'),
    };
  }, [effectiveProviderName, subnetItems, vlanItems]);

  const flatSubnetRecordsForForm = useMemo(
    () =>
      (subnetItems || []).filter(
        (sn: any) =>
          String(sn?.metadata?.annotations?.[SUBNET_TYPE_ANNOTATION_KEY] ?? '').trim().toLowerCase() === 'flat',
      ),
    [subnetItems],
  );

  const publicSubnetRecordsForForm = useMemo(
    () =>
      (subnetItems || []).filter(
        (sn: any) =>
          String(sn?.metadata?.annotations?.[SUBNET_TYPE_ANNOTATION_KEY] ?? '').trim().toLowerCase() === 'public' &&
          String(sn?.metadata?.name || '').trim() !== 'external',
      ),
    [subnetItems],
  );

  const handleDeleteFlatSubnet = useCallback(
    (resourceName: string, displayLabel: string, cidrForNatGuard: string) => {
      if (!canWriteFlatSubnet) {
        message.error('当前账号没有扁平子网操作权限');
        return;
      }
      void (async () => {
        const block = await getFlatSubnetDeleteBlockedByNatMessage(cloudId, resourceName, cidrForNatGuard);
        if (block) {
          message.warning(block);
          return;
        }
        Modal.confirm({
          title: '确认删除',
          content: `确定删除扁平子网「${displayLabel}」吗？若仍有资源引用，集群可能拒绝删除。`,
          okText: '删除',
          okType: 'danger',
          cancelText: '取消',
          onOk: async () => {
            setDeletingFlatSubnetName(resourceName);
            try {
              await deleteKubeOvnSubnet(cloudId, resourceName);
              message.success('已删除');
              await loadSubnets();
              await onSuccess?.();
            } catch (e: any) {
              message.error(e?.message || '删除失败');
            } finally {
              setDeletingFlatSubnetName(null);
            }
          },
        });
      })();
    },
    [canWriteFlatSubnet, cloudId, loadSubnets, onSuccess],
  );

  const openEditSubnet = useCallback((sn: any) => {
    setEditingSubnet(sn);
    if (String(sn?.type || '').trim().toLowerCase() === 'public') {
      editSubnetForm.setFieldsValue({
        alias: sn.alias || '',
      });
    } else {
      editSubnetForm.setFieldsValue({
        alias: sn.alias || '',
        cidrBlock: sn.cidr || '',
        gateway: sn.gateway || '',
        vlan: sn.vlan || '',
        excludeIps: Array.isArray(sn.excludeIps) ? sn.excludeIps.join('\n') : '',
      });
    }
    setEditSubnetModalOpen(true);
  }, [editSubnetForm]);

  const handleEditSubnet = async (values: any) => {
    const name = editingSubnet?.name;
    if (!name) return;
    try {
      setEditSubnetLoading(true);
      const aliasTrim = String(values.alias ?? '').trim();

      if (String(editingSubnet?.type || '').trim().toLowerCase() === 'public') {
        const full = (subnetItems || []).find((s: any) => String(s?.metadata?.name ?? '').trim() === name);
        const mergedAnn = {
          ...(full?.metadata?.annotations || {}),
          [TOWER_ALIAS_ANNOTATION]: aliasTrim,
        };
        await updateKubeOvnSubnet(cloudId, name, { annotations: mergedAnn });
        message.success('更新子网成功');
        setEditSubnetModalOpen(false);
        setEditingSubnet(null);
        editSubnetForm.resetFields();
        await loadSubnets();
        await onSuccess?.();
        return;
      }

      const { alias, ...rest } = values;
      const excludeIps = String(values.excludeIps || '')
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean);

      const payload = {
        ...rest,
        excludeIps,
        annotations: {
          [TOWER_ALIAS_ANNOTATION]: alias,
        },
      };

      await updateKubeOvnSubnet(cloudId, name, payload);
      message.success('更新子网成功');
      setEditSubnetModalOpen(false);
      setEditingSubnet(null);
      editSubnetForm.resetFields();
      await loadSubnets();
      await onSuccess?.();
    } catch (error: any) {
      message.error(`更新失败: ${error?.message || '未知错误'}`);
    } finally {
      setEditSubnetLoading(false);
    }
  };

  const handleDeletePublicSubnet = useCallback(
    (resourceName: string, displayLabel: string) => {
      if (!canWritePublicSubnet) {
        message.error('当前账号没有公共子网操作权限');
        return;
      }
      Modal.confirm({
        title: '确认删除',
        content: `确定删除公共子网「${displayLabel}」吗？若仍有资源引用，集群可能拒绝删除。`,
        okText: '删除',
        okType: 'danger',
        cancelText: '取消',
        onOk: async () => {
          setDeletingPublicSubnetName(resourceName);
          try {
            await deleteKubeOvnSubnet(cloudId, resourceName);
            message.success('已删除');
            await loadSubnets();
            await onSuccess?.();
          } catch (e: any) {
            message.error(e?.message || '删除失败');
          } finally {
            setDeletingPublicSubnetName(null);
          }
        },
      });
    },
    [canWritePublicSubnet, cloudId, loadSubnets, onSuccess],
  );

  const openAddModal = () => {
    if (!effectiveProviderName) {
      message.warning('请先选择物理网络');
      return;
    }
    setAddModalOpen(true);
  };

  const handleSubmit = async (values: any) => {
    if (!canWriteVlan) return;
    const providerName = lockProviderName ?? values.provider ?? effectiveProviderName;
    if (!providerName) {
      message.warning('请选择物理网络');
      return;
    }
    setSubmitLoading(true);
    try {
      const towerAlies = String(values.towerAlies ?? '').trim();
      if (!towerAlies) {
        message.warning('请输入名称');
        return;
      }
      const vlanTag = values.id;
      if (vlanTag === undefined || vlanTag === null || vlanTag === '') {
        message.warning('请输入 VLAN ID');
        return;
      }
      const idNum = Number(vlanTag);
      if (Number.isNaN(idNum)) {
        message.error('VLAN ID 无效');
        return;
      }

      const vlansSameProvider = vlanItems.filter(
        (v) => String(v?.spec?.provider || '').trim() === String(providerName).trim(),
      );
      const dupName = vlansSameProvider.some((v) => {
        const ann = v?.metadata?.annotations || {};
        const al = String(ann[TOWER_IO_ALIES_ANNOTATION] || '').trim();
        return al === towerAlies;
      });
      if (dupName) {
        message.warning('当前物理网络下已存在相同名称的 VLAN，请修改名称');
        return;
      }
      const dupId = vlansSameProvider.some((v) => Number(v?.spec?.id) === idNum);
      if (dupId) {
        message.warning('当前物理网络下已存在相同的 VLAN ID，请修改');
        return;
      }

      const payload = {
        name: generateKubeOvnTwelveCharName(),
        annotations: { [TOWER_IO_ALIES_ANNOTATION]: towerAlies },
        id: idNum,
        provider: providerName,
      };
      await createKubeOvnVlan(cloudId, payload);
      message.success('VLAN 已添加');
      setAddModalOpen(false);
      form.resetFields();
      await loadVlans(true);
      void loadSubnets();
      await onSuccess?.();
    } catch (e: any) {
      message.error(e?.message || '创建失败');
    } finally {
      setSubmitLoading(false);
    }
  };

  const handleDelete = (item: any) => {
    if (!canWriteVlan) return;
    const metaName = String(item?.metadata?.name || '').trim();
    if (!metaName) return;
    const ann = item?.metadata?.annotations || {};
    const displayAlias = String(ann[TOWER_IO_ALIES_ANNOTATION] || '').trim();
    const label = displayAlias || metaName;
    Modal.confirm({
      title: '确认删除',
      content: `确定删除 VLAN「${label}」吗？若仍有子网引用，集群可能拒绝删除。`,
      okText: '删除',
      okType: 'danger',
      cancelText: '取消',
      onOk: async () => {
        setDeletingName(metaName);
        try {
          await deleteKubeOvnVlan(cloudId, metaName);
          message.success('已删除');
          await loadVlans(true);
          void loadSubnets();
          await onSuccess?.();
        } catch (e: any) {
          message.error(e?.message || '删除失败');
        } finally {
          setDeletingName(null);
        }
      },
    });
  };

  const pnAnn = effectivePn?.metadata?.annotations || {};
  const pnDisplayName = String(pnAnn[TOWER_IO_ALIES_ANNOTATION] || '').trim();
  const pnMetaName = String(effectivePn?.metadata?.name || '').trim();
  const pnReady = !!effectivePn?.status?.ready;
  const pnReadyNodes = useMemo(
    () => (Array.isArray(effectivePn?.status?.readyNodes) ? effectivePn.status.readyNodes : []),
    [effectivePn],
  );
  const pnCustom = Array.isArray(effectivePn?.spec?.customInterfaces) ? effectivePn.spec.customInterfaces : [];

  /** 头部：主标题为资源展示名/资源名；副标题为集群 ID 或场景说明 */
  const headerTitle = useMemo(() => {
    if (pnMetaName) return pnDisplayName || pnMetaName;
    if (lockProviderName) return lockProviderName;
    return '网络规划';
  }, [pnDisplayName, pnMetaName, lockProviderName]);

  const headerSubtitle = useMemo(() => {
    if (pnMetaName) {
      if (pnDisplayName && pnDisplayName !== pnMetaName) return `${pnMetaName}`;
      return 'Kube-OVN · Provider Network';
    }
    if (lockProviderName) return `ID: ${lockProviderName}`;
    return '请选择物理网络或从列表进入';
  }, [pnMetaName, pnDisplayName, lockProviderName]);

  const pnOriginNics = useMemo(() => {
    const ann = effectivePn?.metadata?.annotations as Record<string, string> | undefined;
    return parseProviderNetworkOriginNics(ann);
  }, [effectivePn]);

  const pnOriginNicsDescriptionText = useMemo(
    () => (pnOriginNics?.bondFromAnnotation ? formatOriginNicsDetailLines(pnOriginNics, undefined) : null),
    [pnOriginNics],
  );

  /** 优先用对象上的 links.view；列表接口常不带该字段，按 Kube-OVN 约定补全（与集群内 YAML 视图同源） */
  const pnViewLink = useMemo(() => {
    const raw = effectivePn?.links?.view;
    if (raw != null && String(raw).trim()) return String(raw).trim();
    const name =
      String(effectivePn?.metadata?.name || '').trim() || String(effectiveProviderName || '').trim();
    if (!name) return '';
    return `/apis/kubeovn.io/v1/provider-networks/${encodeURIComponent(name)}`;
  }, [effectivePn, effectiveProviderName]);

  const pnStatusVlanIds = useMemo(() => {
    const raw = effectivePn?.status?.vlans;
    if (!Array.isArray(raw)) return [] as string[];
    return raw.map((x: unknown) => String(x ?? '').trim()).filter(Boolean);
  }, [effectivePn]);

  const subnetTotal = publicSubnetsForPn.length + flatSubnetsForPn.length;
  const kpiVlanTone: KpiTone = !effectivePn ? 'muted' : displayedVlans.length > 0 ? 'ok' : 'muted';
  const kpiSubnetTone: KpiTone = !effectivePn ? 'muted' : subnetTotal > 0 ? 'ok' : 'muted';
  const kpiReadyTone: KpiTone = !effectivePn ? 'muted' : pnReady ? 'ok' : 'err';
  const kpiNodeTone: KpiTone = !effectivePn ? 'muted' : pnReadyNodes.length > 0 ? 'ok' : 'muted';

  const yamlSubDrawerTitle = (
    <Space style={{ color: UI.text }}>
      <CodeOutlined style={{ color: UI.textMuted }} />
      <span>运维信息（集群 View Link）</span>
      {headerTitle ? (
        <Typography.Text style={{ fontSize: 13, color: UI.textMuted }}>{headerTitle}</Typography.Text>
      ) : null}
    </Space>
  );

  return (
    <>
    <Drawer
      title={null}
      placement="right"
      width="min(1000px, 96vw)"
      open={open}
      onClose={onClose}
      closable={false}
      destroyOnHidden
      styles={{
        body: {
          padding: 0,
          display: 'flex',
          flexDirection: 'column',
          height: '100%',
          maxHeight: '100vh',
          overflow: 'hidden',
          background: UI.bodyBg,
        },
      }}
    >
      <style>{`
        .provider-network-detail-drawer-scroll::-webkit-scrollbar { width: 6px; height: 6px; }
        .provider-network-detail-drawer-scroll::-webkit-scrollbar-track { background: transparent; }
        .provider-network-detail-drawer-scroll::-webkit-scrollbar-thumb { background: #e0e0e0; border-radius: 3px; }
        .provider-network-detail-drawer-scroll::-webkit-scrollbar-thumb:hover { background: #ccc; }
        .provider-network-detail-drawer-scroll .ant-tabs-content-holder { padding: 0; }
      `}</style>

      <div
        style={{
          flexShrink: 0,
          background: `linear-gradient(145deg, ${UI.shell} 0%, ${UI.shellMuted} 100%)`,
          color: UI.text,
          padding: '20px 22px 18px',
          borderBottom: `1px solid ${UI.border}`,
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            flexWrap: 'wrap',
          }}
        >
          <Typography.Text
            style={{
              fontSize: 12,
              letterSpacing: '0.14em',
              textTransform: 'uppercase',
              color: UI.textMuted,
              flexShrink: 0,
            }}
          >
            Kube-OVN · 物理网络
          </Typography.Text>
          <div
            style={{
              flexShrink: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'flex-end',
              flexWrap: 'wrap',
              gap: 8,
              marginLeft: 'auto',
            }}
          >
            <Button
              type="text"
              size="small"
              loading={vlanLoading || subnetLoading}
              onClick={() => {
                void loadVlans(true);
                void loadSubnets();
              }}
              style={heroActionTextPrimary}
            >
              刷新
            </Button>
            <Button
              type="text"
              size="small"
              disabled={!effectivePn}
              onClick={() => {
                if (!effectivePn) return;
                setYamlSubDrawerOpen(true);
              }}
              style={heroActionTextSecondary}
            >
              运维信息
            </Button>
            <Button
              type="text"
              size="small"
              aria-label="关闭"
              onClick={onClose}
              style={{ color: UI.textMuted, fontSize: 12, paddingInline: 0, height: 'auto' }}
            >
              关闭
            </Button>
          </div>
        </div>
        <Typography.Title
          level={4}
          style={{
            color: UI.text,
            margin: '6px 0 0',
            fontWeight: 600,
            lineHeight: 1.35,
            wordBreak: 'break-word',
          }}
        >
          {headerTitle}
        </Typography.Title>
        <Typography.Text style={{ fontSize: 13, color: UI.textMuted, display: 'block', marginTop: 6 }}>
          {headerSubtitle}
        </Typography.Text>

        <div
          style={{
            marginTop: 14,
            paddingTop: 14,
            borderTop: `1px solid ${UI.border}`,
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            gap: '10px 14px',
          }}
        >
          <Typography.Text style={{ color: UI.textMuted, fontSize: 13, marginRight: 4 }}>
            资源 ID
            {pnMetaName || effectiveProviderName ? (
              <>
                {' '}
                <Typography.Text
                  copyable={{ text: pnMetaName || effectiveProviderName }}
                  style={{ color: UI.accent, fontSize: 13 }}
                >
                  {pnMetaName || effectiveProviderName}
                </Typography.Text>
              </>
            ) : (
              ' —'
            )}
          </Typography.Text>
          <Space size={[8, 8]} wrap style={{ flex: '1 1 200px', minWidth: 0 }}>
            {effectivePn ? (
              pnReady ? (
                <Tag style={heroTagSuccess}>已就绪</Tag>
              ) : (
                <Tag style={heroTagWarning}>未就绪</Tag>
              )
            ) : (
              <Tag style={heroNeutralTagWrap}>未选择</Tag>
            )}
          </Space>
        </div>

        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'stretch',
            marginTop: 14,
            paddingTop: 14,
            borderTop: `1px solid ${UI.border}`,
          }}
        >
          <PulseStat label="网络规划" tone={kpiVlanTone}>
            {!effectivePn ? '—' : `${displayedVlans.length} 条`}
          </PulseStat>
          <div aria-hidden style={HERO_KPI_DIVIDER} />
          <PulseStat label="关联子网" tone={kpiSubnetTone}>
            {!effectivePn ? '—' : `${subnetTotal} 条`}
          </PulseStat>
          <div aria-hidden style={HERO_KPI_DIVIDER} />
          <PulseStat label="就绪状态" tone={kpiReadyTone}>
            {!effectivePn ? '—' : pnReady ? '已就绪' : '未就绪'}
          </PulseStat>
          <div aria-hidden style={HERO_KPI_DIVIDER} />
          <PulseStat label="就绪节点" tone={kpiNodeTone}>
            {!effectivePn ? '—' : pnReadyNodes.length ? `${pnReadyNodes.length} 台` : '—'}
          </PulseStat>
        </div>
      </div>

      <div className="provider-network-detail-drawer-scroll" style={DRAWER_SCROLL_BODY}>
        <Tabs
          activeKey={drawerSegment === 'yaml' ? 'vlan' : drawerSegment}
          onChange={(k) => setDrawerSegment(k as 'network' | 'vlan')}
          tabBarStyle={TAB_BAR_STYLE}
          items={[
            {
              key: 'network',
              label: '网络信息',
              children: (
                <div style={TAB_PANEL_NETWORK}>
        {!lockProviderName && (
          <div style={PROVIDER_SELECT_BLOCK}>
            <div style={{ fontSize: 12, color: '#888', marginBottom: 6 }}>当前物理网络</div>
            <Select
              style={{ width: '100%' }}
              placeholder="选择物理网络"
              showSearch
              optionFilterProp="label"
              value={effectiveProviderName || undefined}
              onChange={(v) => setUserSelectedPn(v)}
              options={providerOptions}
            />
          </div>
        )}
        {providersLoading && providers.length === 0 ? (
          <div style={{ padding: 24, textAlign: 'center' }}>
            <Spin tip="加载物理网络…" />
          </div>
        ) : !effectivePn ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无物理网络数据或未选择物理网络" />
        ) : (
            <Descriptions bordered size="small" column={1} labelStyle={networkDescLabelStyle}>
              <Descriptions.Item label="显示名称">{pnDisplayName || '—'}</Descriptions.Item>
              <Descriptions.Item label="资源 ID">
                {pnMetaName ? (
                  <Typography.Text copyable={{ text: pnMetaName }} code style={{ fontSize: 13 }}>
                    {pnMetaName}
                  </Typography.Text>
                ) : (
                  '—'
                )}
              </Descriptions.Item>
              <Descriptions.Item label="UID">
                {effectivePn?.metadata?.uid ? (
                  <Typography.Text
                    copyable={{ text: String(effectivePn.metadata.uid) }}
                    code
                    style={{ fontSize: 13 }}
                  >
                    {String(effectivePn.metadata.uid)}
                  </Typography.Text>
                ) : (
                  '—'
                )}
              </Descriptions.Item>
              <Descriptions.Item label="默认接口">
                <Space size={4} wrap align="start">
                  {String(effectivePn?.spec?.defaultInterface || '').trim() ? (
                    <Tag>{String(effectivePn?.spec?.defaultInterface || '').trim()}</Tag>
                  ) : (
                    <span style={{ color: '#999' }}>—</span>
                  )}
                  {pnOriginNics?.bondFromAnnotation ? (
                    <Tag color="processing">Bond</Tag>
                  ) : null}
                </Space>
              </Descriptions.Item>
              <Descriptions.Item label="网卡 Bond">
                {pnOriginNics?.bondFromAnnotation ? (
                  pnOriginNicsDescriptionText ? (
                    <div
                      style={{ whiteSpace: 'pre-wrap', fontSize: 13, lineHeight: 1.6, color: 'rgba(0,0,0,0.85)' }}
                    >
                      {pnOriginNicsDescriptionText}
                    </div>
                  ) : (
                    '—'
                  )
                ) : (
                  <span style={{ color: '#999' }}>未在注解中声明</span>
                )}
              </Descriptions.Item>
              <Descriptions.Item label="自定义映射">
                {pnCustom.length ? (
                  <span style={{ wordBreak: 'break-word' }}>
                    {pnCustom.map((ci: any, i: number) => {
                      const iface = String(ci?.interface ?? ci?.name ?? '').trim();
                      const nodes = Array.isArray(ci?.nodes) ? ci.nodes : [];
                      return (
                        <span key={`${iface}-${i}`} style={{ display: 'block', marginBottom: 4 }}>
                          <Typography.Text code>{iface || '—'}</Typography.Text>
                          {nodes.length ? (
                            <Typography.Text type="secondary" style={{ marginLeft: 8, fontSize: 12 }}>
                              → {nodes.join(', ')}
                            </Typography.Text>
                          ) : null}
                        </span>
                      );
                    })}
                  </span>
                ) : (
                  '—'
                )}
              </Descriptions.Item>
              <Descriptions.Item label="关联 VLAN">
                {pnStatusVlanIds.length ? (
                  <span>
                    {pnStatusVlanIds.map((v) => (
                      <Tag key={v} color="blue" style={{ marginBottom: 4 }}>
                        {v}
                      </Tag>
                    ))}
                  </span>
                ) : (
                  <span style={{ color: '#999' }}>无</span>
                )}
              </Descriptions.Item>
              <Descriptions.Item label="创建时间">
                {effectivePn?.metadata?.creationTimestamp
                  ? dayjs(effectivePn.metadata.creationTimestamp).format('YYYY-MM-DD HH:mm:ss')
                  : '—'}
              </Descriptions.Item>
            </Descriptions>
        )}
                </div>
              ),
            },
            {
              key: 'vlan',
              label: '网络规划',
              children: (
                <div style={TAB_PANEL_PLAN}>
        {!lockProviderName && (
          <div style={PROVIDER_SELECT_BLOCK}>
            <div style={{ fontSize: 12, color: '#888', marginBottom: 6 }}>当前物理网络</div>
            <Select
              style={{ width: '100%' }}
              placeholder="选择物理网络"
              showSearch
              optionFilterProp="label"
              value={effectiveProviderName || undefined}
              onChange={(v) => setUserSelectedPn(v)}
              options={providerOptions}
            />
          </div>
        )}
        {providersLoading && providers.length === 0 ? (
          <div style={{ padding: 24, textAlign: 'center' }}>
            <Spin tip="加载物理网络…" />
          </div>
        ) : !effectivePn ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无物理网络数据或未选择物理网络" />
        ) : (
        <>
        <Card variant="borderless" styles={{ body: { padding: 16 } }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: 8,
              marginBottom: 12,
            }}
          >
            <div style={{ fontSize: 14, fontWeight: 500 }}>网络规划 ({displayedVlans.length})</div>
            {canWriteVlan && (
              <Button type="primary"  onClick={openAddModal}>
                添加 VLAN
              </Button>
            )}
          </div>

          {vlanLoading && vlanItems.length === 0 ? (
            <div style={{ padding: 48, textAlign: 'center' }}>
              <Spin tip="加载 VLAN 列表…" />
            </div>
          ) : displayedVlans.length === 0 ? (
            <div style={{ padding: 24 }}>
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={effectiveProviderName ? '该物理网络下暂无网络规划' : '请选择物理网络'}
              />
            </div>
          ) : (
            <List
              size="small"
              split
              dataSource={displayedVlans}
              renderItem={(item) => {
                const ann = item?.metadata?.annotations || {};
                const displayAlias = String(ann[TOWER_IO_ALIES_ANNOTATION] || '').trim();
                const metaName = String(item?.metadata?.name || '').trim();
                const title = displayAlias || metaName || '—';
                const vlanId = item?.spec?.id;
                const busy = deletingName === metaName;
                return (
                  <List.Item
                    key={item?.metadata?.uid || metaName}
                    style={{ padding: '12px 0px' }}
                    actions={
                      canWriteVlan
                        ? [
                            <Button
                              key="del"
                              type="link"
                              danger
                              size="small"
                              loading={busy}
                              disabled={!!deletingName && !busy}
                              onClick={() => handleDelete(item)}
                            >
                              删除
                            </Button>,
                          ]
                        : []
                    }
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%' }}>
                      <div
                        style={{
                          minWidth: 48,
                          height: 36,
                          background: '#f0f5ff',
                          border: '1px solid #adc6ff',
                          borderRadius: 4,
                          display: 'flex',
                          flexDirection: 'column',
                          alignItems: 'center',
                          justifyContent: 'center',
                          flexShrink: 0,
                        }}
                      >
                        <div style={{ fontSize: 10, color: '#2f54eb', lineHeight: 1 }}>VLAN ID</div>
                        <div style={{ fontSize: 16, fontWeight: 600, color: '#1d39c4', lineHeight: 1.2 }}>
                          {vlanId !== undefined && vlanId !== null ? vlanId : '—'}
                        </div>
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 500, fontSize: 14, color: '#262626', marginBottom: 2 }}>{title}</div>
                        <div style={{ fontSize: 12, color: '#999', fontFamily: 'ui-monospace, monospace' }}>
                          {metaName}
                        </div>
                      </div>
                    </div>
                  </List.Item>
                );
              }}
            />
          )}
        </Card>

        {effectivePn ? (
          subnetLoading && subnetItems.length === 0 ? (
            <div style={{ padding: 24, textAlign: 'center' }}>
              <Spin tip="加载子网…" />
            </div>
          ) : (
            <>
              <Card variant="borderless" styles={{ body: { padding: 16 } }}>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    flexWrap: 'wrap',
                    gap: 8,
                    marginBottom: 12,
                  }}
                >
                  <div style={{ fontSize: 14, fontWeight: 500 }}>公共子网 ({publicSubnetsForPn.length})</div>
                  {canWritePublicSubnet ? (
                    <Button type="primary"  onClick={() => setPublicSubnetModalOpen(true)}>
                      添加公共子网
                    </Button>
                  ) : null}
                </div>
                <List
                  size="small"
                  split
                  dataSource={publicSubnetsForPn}
                  locale={{ emptyText: '暂无关联公共子网' }}
                  renderItem={(item: any) => {
                    const alias = String(item?.alias || '').trim();
                    const name = String(item?.name || '-').trim();
                    const cidr = String(item?.cidr || '-').trim();
                    const busy = deletingPublicSubnetName === name;
                    return (
                      <List.Item
                        key={name}
                        style={{ padding: '12px 0px' }}
                        actions={
                          canWritePublicSubnet
                            ? [
                                <Button
                                  key="edit"
                                  type="link"
                                  size="small"
                                  onClick={() => openEditSubnet(item)}
                                >
                                  编辑
                                </Button>,
                                <Button
                                  key="del"
                                  type="link"
                                  danger
                                  size="small"
                                  loading={busy}
                                  disabled={!!deletingPublicSubnetName && !busy}
                                  onClick={() => handleDeletePublicSubnet(name, alias || name)}
                                >
                                  删除
                                </Button>,
                              ]
                            : []
                        }
                      >
                        <div style={{ width: '100%', minWidth: 0 }}>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                            {alias || name}
                          </span>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span>{cidr}</span>
                            <span style={{color: '#aaa'}}>运行在VLAN {item?.vlanId ?? item?.vlan ?? '-'}</span>
                          </div> 
                        </div>
                      </List.Item>
                    );
                  }}
                />
              </Card>
              <Card variant="borderless" styles={{ body: { padding: 16 } }}>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    flexWrap: 'wrap',
                    gap: 8,
                    marginBottom: 12,
                  }}
                >
                  <div style={{ fontSize: 14, fontWeight: 500 }}>扁平子网 ({flatSubnetsForPn.length})</div>
                  {canWriteFlatSubnet ? (
                    <Button type="primary" onClick={() => setFlatSubnetModalOpen(true)}>
                      添加扁平子网
                    </Button>
                  ) : null}
                </div>
                <List
                  size="small"
                  split
                  dataSource={flatSubnetsForPn}
                  locale={{ emptyText: '暂无关联扁平子网' }}
                  renderItem={(item: any) => {
                    const alias = String(item?.alias || '').trim();
                    const name = String(item?.name || '-').trim();
                    const cidr = String(item?.cidr || '-').trim();
                    const busy = deletingFlatSubnetName === name;
                    return (
                      <List.Item
                        key={name}
                        style={{ padding: '12px 0px' }}
                        actions={
                          canWriteFlatSubnet
                            ? [
                                <Button
                                  key="edit"
                                  type="link"
                                  size="small"
                                  onClick={() => openEditSubnet(item)}
                                >
                                  编辑
                                </Button>,
                                <Button
                                  key="del"
                                  type="link"
                                  danger
                                  size="small"
                                  loading={busy}
                                  disabled={!!deletingFlatSubnetName && !busy}
                                  onClick={() =>
                                    handleDeleteFlatSubnet(
                                      name,
                                      alias || name,
                                      cidr === '-' ? '' : cidr,
                                    )
                                  }
                                >
                                  删除
                                </Button>,
                              ]
                            : []
                        }
                      >
                        <div style={{ width: '100%', minWidth: 0 }}>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                            {alias || name}
                          </span>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span>{cidr}</span>
                            <span style={{color: '#aaa'}}>运行在VLAN {item?.vlanId ?? item?.vlan ?? '-'}</span>
                          </div> 
                        </div>
                      </List.Item>
                    );
                  }}
                />
              </Card>
            </>
          )
        ) : null}
        </>
        )}
                </div>
              ),
            },
          ]}
        />
      </div>

      <Modal
        title={`编辑${editingSubnet?.type === 'flat' ? '扁平' : '公共'}子网`}
        open={editSubnetModalOpen}
        centered
        onOk={editSubnetForm.submit}
        onCancel={() => {
          setEditSubnetModalOpen(false);
          setEditingSubnet(null);
          editSubnetForm.resetFields();
        }}
        confirmLoading={editSubnetLoading}
        width={600}
        destroyOnHidden
      >
        <Form form={editSubnetForm} layout="vertical" onFinish={handleEditSubnet} className="std-form">
          <UnderlaySubnetFormFields
            form={editSubnetForm}
            isFlatMode={editingSubnet?.type === 'flat'}
            vlans={vlanItems}
            providers={providers}
            aliasDupCheckItems={
              editingSubnet?.type === 'flat' ? flatSubnetRecordsForForm : publicSubnetRecordsForForm
            }
            editingSubnetResourceName={editingSubnet?.name}
            publicEditNameOnly={String(editingSubnet?.type || '').trim().toLowerCase() === 'public'}
          />
        </Form>
      </Modal>

      <CreateFlatSubnetModal
        open={flatSubnetModalOpen}
        onClose={() => setFlatSubnetModalOpen(false)}
        cloudId={cloudId}
        vlans={displayedVlans}
        providers={providers}
        hideNamespace
        aliasDupCheckItems={flatSubnetRecordsForForm}
        onSuccess={async () => {
          await loadSubnets();
          await onSuccess?.();
        }}
      />

      <CreatePublicSubnetModal
        open={publicSubnetModalOpen}
        onClose={() => setPublicSubnetModalOpen(false)}
        cloudId={cloudId}
        vlans={displayedVlans}
        providers={providers}
        aliasDupCheckItems={publicSubnetRecordsForForm}
        onSuccess={async () => {
          await loadSubnets();
          await onSuccess?.();
        }}
      />

      <Modal
        title="添加 VLAN"
        open={addModalOpen}
        centered
        onCancel={() => setAddModalOpen(false)}
        footer={null}
        destroyOnHidden
        width={600}
      >
        <Form form={form} layout="vertical" onFinish={handleSubmit} className="std-form">
          <Form.Item name="towerAlies" label="名称" rules={[{ required: true, message: '请输入名称' }]}>
            <Input placeholder="支持中文，如：生产网 VLAN" allowClear />
          </Form.Item>
          <Form.Item name="id" label="VLAN ID" rules={[{ required: true, message: '请输入 VLAN ID' }]}>
            <Input type="number" placeholder="0 表示 Flat Network (无 Tag), 1-4095 为 VLAN Tag" />
          </Form.Item>
          <Form.Item name="provider" label="物理网络 (Provider Network)" rules={[{ required: true }]}>
            {lockProviderName ? (
              <Select
                disabled
                options={[lockProviderOption || { label: lockProviderName, value: lockProviderName }]}
              />
            ) : (
              <Select placeholder="选择物理网络" showSearch optionFilterProp="label" options={providerOptions} />
            )}
          </Form.Item>
          <Form.Item style={{ marginBottom: 0, textAlign: 'right' }}>
            <Button onClick={() => setAddModalOpen(false)} style={{ marginRight: 8 }}>
              取消
            </Button>
            <Button type="primary" htmlType="submit" loading={submitLoading}>
              确定
            </Button>
          </Form.Item>
        </Form>
      </Modal>
    </Drawer>

    <ConfigProvider
      theme={{
        algorithm: theme.darkAlgorithm,
        token: {
          colorBgElevated: UI.shell,
          colorBgContainer: UI.shellMuted,
          colorSplit: UI.border,
          colorText: UI.text,
          colorTextSecondary: UI.textMuted,
        },
      }}
    >
      <Drawer
        title={yamlSubDrawerTitle}
        placement="right"
        width="min(920px, 96vw)"
        open={yamlSubDrawerOpen && open}
        onClose={() => setYamlSubDrawerOpen(false)}
        destroyOnHidden
        zIndex={1100}
        styles={{
          content: { background: UI.shell },
          header: {
            background: UI.shell,
            borderBottom: `1px solid ${UI.border}`,
          },
          body: {
            padding: 0,
            display: 'flex',
            flexDirection: 'column',
            height: '100%',
            maxHeight: '100vh',
            overflow: 'hidden',
            background: UI.shell,
          },
        }}
      >
        {!effectivePn ? (
          <div
            style={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: 24,
              minHeight: 200,
            }}
          >
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无物理网络数据或未选择物理网络" />
          </div>
        ) : pnViewLink ? (
          <div style={YAML_SUB_DRAWER_VIEW_LINK_BOX}>
            <ViewLinkTab cloudId={cloudId} viewLink={pnViewLink} active={yamlSubDrawerOpen && open} />
          </div>
        ) : (
          <div style={{ padding: 16, flex: 1, minHeight: 0 }}>
            <Alert
              type="warning"
              showIcon
              message="无法解析查看路径"
              description="缺少资源名称，无法构造 ProviderNetwork 的集群查看 URL。请从物理网络列表进入或先选择物理网络。"
            />
          </div>
        )}
      </Drawer>
    </ConfigProvider>
    </>
  );
};

export default ProviderNetworkDetailDrawer;
