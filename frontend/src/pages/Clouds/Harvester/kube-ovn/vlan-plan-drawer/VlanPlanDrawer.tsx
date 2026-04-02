import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Drawer,
  Button,
  Card,
  Form,
  Input,
  Select,
  List,
  Tag,
  message,
  Empty,
  Spin,
  Modal,
  Descriptions,
  Row,
  Col,
  Segmented,
} from 'antd';
import {
  LayoutOutlined,
  PlusOutlined,
  CloseOutlined,
  DeleteOutlined,
  EditOutlined,
  SyncOutlined,
  FileTextOutlined,
  NodeIndexOutlined,
} from '@ant-design/icons';
import {
  createKubeOvnVlan,
  deleteKubeOvnVlan,
  deleteKubeOvnSubnet,
  fetchKubeOvnProviderNetworks,
  fetchKubeOvnSubnets,
  fetchKubeOvnVlans,
  updateKubeOvnSubnet,
} from '../../../../../services/harvesterApi';
import { clearCache } from '../../../../../utils/requestManager';
import { useAuth } from '../../../../../contexts/AuthContext';
import { hasPermissionForAction } from '../../../../../utils/accessMapping';
import { CLOUD_SUBNETS_FLAT_WRITE, CLOUD_SUBNETS_PUBLIC_WRITE } from '../../../../../constants/cloudPermissions';
import { TOWER_IO_ALIES_ANNOTATION, generateKubeOvnTwelveCharName } from '../../../../../utils/towerKubeOvnNames';
import {
  CreateFlatSubnetModal,
  CreatePublicSubnetModal,
  SUBNET_TYPE_ANNOTATION_KEY,
  TOWER_ALIAS_ANNOTATION,
  UnderlaySubnetFormFields,
} from '../underlay-subnet';
import ProviderNetworkTopologyGraph from './ProviderNetworkTopologyGraph';

export type VlanPlanDrawerProps = {
  open: boolean;
  onClose: () => void;
  cloudId: string;
  /** 创建成功后回调（刷新外层列表等） */
  onSuccess?: () => void | Promise<void>;
  /** 从某条物理网络打开时锁定 Provider，列表仅展示该物理网络下的 VLAN */
  lockProviderName?: string | null;
};

type DrawerSegment = 'detail' | 'topology';

const VlanPlanDrawer: React.FC<VlanPlanDrawerProps> = ({
  open,
  onClose,
  cloudId,
  onSuccess,
  lockProviderName,
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
  const [drawerSegment, setDrawerSegment] = useState<DrawerSegment>('detail');

  useEffect(() => {
    if (!open) setDrawerSegment('detail');
  }, [open]);

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
    (resourceName: string, displayLabel: string) => {
      if (!canWriteFlatSubnet) {
        message.error('当前账号没有扁平子网操作权限');
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
    return 'VLAN 规划';
  }, [pnDisplayName, pnMetaName, lockProviderName]);

  const headerSubtitle = useMemo(() => {
    if (pnMetaName) {
      if (pnDisplayName && pnDisplayName !== pnMetaName) return `${pnMetaName}`;
      return 'Kube-OVN · Provider Network';
    }
    if (lockProviderName) return `ID: ${lockProviderName}`;
    return '请选择物理网络或从列表进入';
  }, [pnMetaName, pnDisplayName, lockProviderName]);

  /** 拓扑：物理网卡 ← ProviderNetwork.spec（默认口 + customInterfaces 节点映射） */
  const pnNicTopology = useMemo(() => {
    if (!effectivePn) return null;
    const spec = effectivePn.spec || {};
    const defaultIf = String(spec.defaultInterface || '').trim();
    const customList = Array.isArray(spec.customInterfaces) ? spec.customInterfaces : [];
    const nodesInCustom = new Set<string>();
    customList.forEach((c: any) => {
      (Array.isArray(c?.nodes) ? c.nodes : []).forEach((n: unknown) => {
        const s = String(n ?? '').trim();
        if (s) nodesInCustom.add(s);
      });
    });
    const nodesOnDefault = pnReadyNodes.filter((n: string) => !nodesInCustom.has(String(n).trim()));
    return { defaultIf, customList, nodesOnDefault };
  }, [effectivePn, pnReadyNodes]);

  return (
    <Drawer
      open={open}
      onClose={onClose}
      width={900}
      placement="right"
      closable={false}
      destroyOnHidden
      styles={{
        content: {
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        },
        body: {
          padding: 0,
          background: '#f5f7fa',
          display: 'flex',
          flexDirection: 'column',
          flex: 1,
          minHeight: 0,
          overflow: 'hidden',
        },
      }}
    >
      <style>{`
        .vlan-plan-drawer-scroll::-webkit-scrollbar { width: 6px; height: 6px; }
        .vlan-plan-drawer-scroll::-webkit-scrollbar-track { background: transparent; }
        .vlan-plan-drawer-scroll::-webkit-scrollbar-thumb { background: #e0e0e0; border-radius: 3px; }
        .vlan-plan-drawer-scroll::-webkit-scrollbar-thumb:hover { background: #ccc; }
      `}</style>

      <div
        style={{
          background: '#f5f7fa',
          padding: '16px 24px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexShrink: 0,
          borderBottom: '1px solid #f0f0f0',
          gap: 12,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0 }}>
          <div className="harvester-drawer-title-icon-wrap">
            <LayoutOutlined/>
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 18, fontWeight: 500, lineHeight: 1.2, wordBreak: 'break-word' }}>{headerTitle}</div>
            <div style={{ fontSize: 12, color: '#999' }}>{headerSubtitle}</div>
          </div>
          {effectivePn ? (
            <Tag color={pnReady ? 'success' : 'default'} style={{ margin: 0, flexShrink: 0 }}>
              {pnReady ? '已就绪' : '未就绪'}
            </Tag>
          ) : null}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
          <Button
            type="text"
            icon={<SyncOutlined spin={vlanLoading || subnetLoading} />}
            onClick={() => {
              void loadVlans(true);
              void loadSubnets();
            }}
            style={{
              width: 32,
              height: 32,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: 4,
              padding: 0,
              color: '#666',
            }}
            title="从集群重新同步"
          />
          <Button
            type="text"
            onClick={onClose}
            style={{
              width: 32,
              height: 32,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: 4,
              fontSize: 16,
              padding: 0,
              color: '#666',
            }}
          >
            <CloseOutlined />
          </Button>
        </div>
      </div>

      {/*
        Tab 导航：样式对齐 HarvesterVmDetailDrawer（白底描边容器 + Segmented）
      */}
      <div style={{ background: '#f5f7fa', padding: '0 24px', flexShrink: 0 }}>
        <div style={{ padding: '0 0 24px 0' }}>
          <div style={{ padding: 4, background: '#fff', borderRadius: 8, border: '1px solid #e0e0e0' }}>
            <Segmented<DrawerSegment>
              size="small"
              value={drawerSegment}
              onChange={(val) => setDrawerSegment(val)}
              options={[
                { label: '详情', value: 'detail', icon: <FileTextOutlined /> },
                { label: '网络拓扑', value: 'topology', icon: <NodeIndexOutlined /> },
              ]}
            />
          </div>
        </div>
      </div>

      {drawerSegment === 'detail' ? (
      <div
        className="vlan-plan-drawer-scroll"
        style={{
          padding: '0 24px 24px',
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: 24,
        }}
      >
        {/* 卡片样式对齐 HarvesterNodeDetailDrawer */}
        <Card variant="borderless" styles={{ body: { padding: 16 } }}>
          <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 12 }}>物理网络信息</div>
          {!lockProviderName && (
            <div style={{ marginBottom: 16 }}>
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
            <Row gutter={[24, 16]}>
              <Col xs={24} lg={12}>
                <Descriptions size="small" column={1} styles={{ label: { width: 96, color: '#888' } }}>
                  <Descriptions.Item label="展示名称">
                    {pnDisplayName || <span style={{ color: '#ccc' }}>—</span>}
                  </Descriptions.Item>
                  <Descriptions.Item label="资源 ID">
                    <span>{pnMetaName || '—'}</span>
                  </Descriptions.Item>
                  <Descriptions.Item label="默认接口">
                    {String(effectivePn?.spec?.defaultInterface || '').trim() || '—'}
                  </Descriptions.Item>
                </Descriptions>
              </Col>
              <Col xs={24} lg={12}>
                <Descriptions size="small" column={1} styles={{ label: { width: 96, color: '#888' } }}>
                  <Descriptions.Item label="就绪">
                    <Tag color={pnReady ? 'success' : 'default'}>{pnReady ? '就绪' : '未就绪'}</Tag>
                  </Descriptions.Item>
                  <Descriptions.Item label="就绪节点">
                    {pnReadyNodes.length ? `${pnReadyNodes.length} 个` : '—'}
                  </Descriptions.Item>
                  <Descriptions.Item label="自定义接口">
                    {pnCustom.length ? (
                      <span>
                        {pnCustom.map((c: any, i: number) => (
                          <Tag key={i} color="orange" style={{ marginBottom: 4 }}>
                            {c?.interface ?? '—'}
                          </Tag>
                        ))}
                      </span>
                    ) : (
                      <span style={{ color: '#999' }}>无</span>
                    )}
                  </Descriptions.Item>
                </Descriptions>
              </Col>
            </Row>
          )}
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
            <div style={{ fontSize: 14, fontWeight: 500 }}>VLAN 规划 ({displayedVlans.length})</div>
            {canWriteVlan && (
              <Button type="primary" icon={<PlusOutlined />} onClick={openAddModal}>
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
                description={effectiveProviderName ? '该物理网络下暂无 VLAN 规划' : '请选择物理网络'}
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
                              icon={<DeleteOutlined />}
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
                    <Button type="primary" icon={<PlusOutlined />} onClick={() => setPublicSubnetModalOpen(true)}>
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
                                  icon={<EditOutlined />}
                                  onClick={() => openEditSubnet(item)}
                                >
                                  编辑
                                </Button>,
                                <Button
                                  key="del"
                                  type="link"
                                  danger
                                  size="small"
                                  icon={<DeleteOutlined />}
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
                    <Button type="primary" icon={<PlusOutlined />} onClick={() => setFlatSubnetModalOpen(true)}>
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
                                  icon={<EditOutlined />}
                                  onClick={() => openEditSubnet(item)}
                                >
                                  编辑
                                </Button>,
                                <Button
                                  key="del"
                                  type="link"
                                  danger
                                  size="small"
                                  icon={<DeleteOutlined />}
                                  loading={busy}
                                  disabled={!!deletingFlatSubnetName && !busy}
                                  onClick={() => handleDeleteFlatSubnet(name, alias || name)}
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
      </div>
      ) : (
      <div
        className="vlan-plan-drawer-scroll"
        style={{
          padding: '0 24px 24px',
          flex: 1,
          minHeight: 0,
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          gap: 0,
        }}
      >
        {!effectivePn ? (
          <div style={{ flex: 1, minHeight: 200, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无物理网络数据或未选择物理网络" />
          </div>
        ) : (
          <>

            <ProviderNetworkTopologyGraph
              pnDisplayTitle={headerTitle}
              pnMetaName={pnMetaName}
              pnReady={pnReady}
              pnNicTopology={pnNicTopology}
              pnReadyNodes={pnReadyNodes}
              displayedVlans={displayedVlans}
              publicSubnetsForPn={publicSubnetsForPn}
              flatSubnetsForPn={flatSubnetsForPn}
              vlanLoading={vlanLoading}
            />
          </>
        )}
      </div>
      )}

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
        destroyOnClose
      >
        <Form form={editSubnetForm} layout="vertical" onFinish={handleEditSubnet} className="std-form">
          <UnderlaySubnetFormFields
            form={editSubnetForm}
            isFlatMode={editingSubnet?.type === 'flat'}
            vlans={vlanItems}
            providers={providers}
            aliasDupCheckItems={subnetItems}
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
  );
};

export default VlanPlanDrawer;
