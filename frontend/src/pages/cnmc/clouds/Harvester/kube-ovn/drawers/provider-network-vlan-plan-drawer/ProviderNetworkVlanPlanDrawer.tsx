import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Button,
  Card,
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
  Tag,
} from 'antd';
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
import {
  hasKubeOvnFlatSubnetWrite,
  hasKubeOvnPublicSubnetWrite,
} from '../../../../../../../constants/cloudPermissions';
import { TOWER_IO_ALIES_ANNOTATION, generateKubeOvnTwelveCharName } from '../../../../../../../utils/towerKubeOvnNames';
import CreateFlatSubnetModal from '../../modals/CreateFlatSubnetModal';
import CreatePublicSubnetModal from '../../modals/CreatePublicSubnetModal';
import { SUBNET_TYPE_ANNOTATION_KEY, TOWER_ALIAS_ANNOTATION } from '../../lib/kubeOvnSubnetConstants';
import UnderlaySubnetFormFields from '../../lib/UnderlaySubnetFormFields';
import { getFlatSubnetDeleteBlockedByNatMessage } from '../../lib/flatSubnetNatDeleteGuard';
import { validateFlatSubnetExcludeIpsLocal } from '../../lib/flatSubnetExcludeIpValidation';
import { getHarvesterDrawerSectionCardProps } from '../../../shared/drawerSectionCard';
import {
  confirmHighRiskDelete,
  DELETE_NETWORK_RISK_ITEMS,
} from '../../../shared/lib/highRiskConfirm';

/**
 * 物理网络「网络规划」抽屉：在当前 Provider 下的 VLAN / 公共子网 / 扁平子网管理。
 */
export type ProviderNetworkVlanPlanDrawerProps = {
  open: boolean;
  onClose: () => void;
  cloudId: string;
  /** 创建成功后回调（刷新外层列表等） */
  onSuccess?: () => void | Promise<void>;
  /** 从某条物理网络打开时锁定 Provider，列表仅展示该物理网络下的 VLAN */
  lockProviderName?: string | null;
};

const TAB_PANEL_PLAN: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 16,
};

const PLAN_SECTION_CARD = getHarvesterDrawerSectionCardProps();
const PLAN_SECTION_CARD_STYLES = { body: { padding: 16 } } satisfies NonNullable<
  React.ComponentProps<typeof Card>['styles']
>;

/** 区块 Card 为浅灰底时，列表放在白底内衬层，分隔线与文字对比更清晰 */
const PLAN_LIST_SURFACE: React.CSSProperties = {
  background: '#fff',
  borderRadius: 8,
  padding: '4px 12px',
  border: '1px solid rgba(0, 0, 0, 0.06)',
};

const PLAN_LIST_ITEM_PADDING: React.CSSProperties = {
  padding: '10px 0',
};

const PLAN_LIST_ROW_TITLE: React.CSSProperties = {
  fontSize: 14,
  fontWeight: 500,
  color: 'rgba(0, 0, 0, 0.88)',
  lineHeight: 1.5,
};

const PLAN_LIST_ROW_META: React.CSSProperties = {
  fontSize: 14,
  fontWeight: 400,
  color: 'rgba(0, 0, 0, 0.88)',
  lineHeight: 1.5,
  marginTop: 2,
};

const PLAN_LIST_ROW_BODY: React.CSSProperties = {
  width: '100%',
  minWidth: 0,
};

const ProviderNetworkVlanPlanDrawer: React.FC<ProviderNetworkVlanPlanDrawerProps> = ({
  open,
  onClose,
  cloudId,
  onSuccess,
  lockProviderName,
}) => {
  const { user } = useAuth();
  const canWriteVlan = hasPermissionForAction(user?.permissions || [], 'clouds.vlans:write');
  const isTenantUser = user?.role === 'tenant';
  const canWriteFlatSubnet = useMemo(() => {
    const perms = (user?.permissions ?? []) as string[];
    return hasKubeOvnFlatSubnetWrite(perms) && !isTenantUser;
  }, [user?.permissions, isTenantUser]);

  const canWritePublicSubnet = useMemo(() => {
    const perms = (user?.permissions ?? []) as string[];
    return hasKubeOvnPublicSubnetWrite(perms) && !isTenantUser;
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
        void confirmHighRiskDelete({
          resourceLabel: '扁平子网',
          name: displayLabel,
          description: `确定删除扁平子网「${displayLabel}」吗？若仍有资源引用，集群可能拒绝删除。`,
          riskItems: DELETE_NETWORK_RISK_ITEMS,
          onConfirm: async () => {
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
        }).catch(() => {});
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
      const cidrForExclude = String(rest.cidrBlock ?? editingSubnet?.cidr ?? '').trim();
      const excludeLocal = validateFlatSubnetExcludeIpsLocal(cidrForExclude, excludeIps);
      if (!excludeLocal.ok) {
        message.error(`更新失败：${excludeLocal.message}`);
        return;
      }

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
      void confirmHighRiskDelete({
        resourceLabel: '公共子网',
        name: displayLabel,
        description: `确定删除公共子网「${displayLabel}」吗？若仍有资源引用，集群可能拒绝删除。`,
        riskItems: DELETE_NETWORK_RISK_ITEMS,
        onConfirm: async () => {
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
      }).catch(() => {});
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
    void confirmHighRiskDelete({
      resourceLabel: 'VLAN',
      name: label,
      description: `确定删除 VLAN「${label}」吗？若仍有子网引用，集群可能拒绝删除。`,
      riskItems: DELETE_NETWORK_RISK_ITEMS,
      onConfirm: async () => {
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
    }).catch(() => {});
  };

  const drawerExtra = (
    <Space>
      <Button
        size="small"
        loading={vlanLoading || subnetLoading}
        onClick={() => {
          void loadVlans(true);
          void loadSubnets();
        }}
      >
        刷新
      </Button>
    </Space>
  );

  return (
    <Drawer
      title="网络规划"
      extra={drawerExtra}
      placement="right"
      width="min(1000px, 96vw)"
      open={open}
      onClose={onClose}
      destroyOnHidden
    >
      <div style={TAB_PANEL_PLAN}>
        {!lockProviderName && (
          <Card {...PLAN_SECTION_CARD} styles={PLAN_SECTION_CARD_STYLES}>
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
          </Card>
        )}
        {providersLoading && providers.length === 0 ? (
          <div style={{ padding: 24, textAlign: 'center' }}>
            <Spin tip="加载物理网络…" />
          </div>
        ) : !effectivePn ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无物理网络数据或未选择物理网络" />
        ) : (
        <>
        <Card {...PLAN_SECTION_CARD} styles={PLAN_SECTION_CARD_STYLES}>
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
            <Space size={8} align="center">
              <span style={{ fontSize: 14, fontWeight: 500 }}>VLAN规划</span>
              <Tag color="blue">{displayedVlans.length}</Tag>
            </Space>
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
            <div style={PLAN_LIST_SURFACE}>
            <List
              size="small"
              split
              dataSource={displayedVlans}
              renderItem={(item) => {
                const ann = item?.metadata?.annotations || {};
                const metaName = String(item?.metadata?.name || '').trim();
                const displayAlias = String(ann[TOWER_IO_ALIES_ANNOTATION] || '').trim();
                const mainTitle = displayAlias || metaName || '—';
                const vlanId = item?.spec?.id;
                const vlanIdTxt =
                  vlanId !== undefined && vlanId !== null ? String(vlanId) : '—';
                const busy = deletingName === metaName;
                return (
                  <List.Item
                    key={item?.metadata?.uid || metaName}
                    style={PLAN_LIST_ITEM_PADDING}
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
                    <div style={PLAN_LIST_ROW_BODY}>
                      <div style={PLAN_LIST_ROW_TITLE}>{mainTitle}</div>
                      <div style={PLAN_LIST_ROW_META}>
                        VLAN ID {vlanIdTxt} | {metaName || '—'}
                      </div>
                    </div>
                  </List.Item>
                );
              }}
            />
            </div>
          )}
        </Card>

        {subnetLoading && subnetItems.length === 0 ? (
          <div style={{ padding: 24, textAlign: 'center' }}>
            <Spin tip="加载子网…" />
          </div>
        ) : (
          <>
            <Card {...PLAN_SECTION_CARD} styles={PLAN_SECTION_CARD_STYLES}>
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
                  <Space size={8} align="center">
                    <span style={{ fontSize: 14, fontWeight: 500 }}>公共子网</span>
                    <Tag color="blue">{publicSubnetsForPn.length}</Tag>
                  </Space>
                  {canWritePublicSubnet ? (
                    <Button type="primary"  onClick={() => setPublicSubnetModalOpen(true)}>
                      添加公共子网
                    </Button>
                  ) : null}
                </div>
                <div style={PLAN_LIST_SURFACE}>
                <List
                  size="small"
                  split
                  dataSource={publicSubnetsForPn}
                  locale={{ emptyText: '暂无关联公共子网' }}
                  renderItem={(item: any) => {
                    const alias = String(item?.alias || '').trim();
                    const name = String(item?.name || '-').trim();
                    const cidr = String(item?.cidr || '-').trim();
                    const cidrDisp = cidr && cidr !== '-' ? cidr : '—';
                    const vlanDisp = item?.vlanId ?? item?.vlan ?? '—';
                    const busy = deletingPublicSubnetName === name;
                    return (
                      <List.Item
                        key={name}
                        style={PLAN_LIST_ITEM_PADDING}
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
                        <div style={PLAN_LIST_ROW_BODY}>
                          <div style={PLAN_LIST_ROW_TITLE}>{alias || name || '—'}</div>
                          <div style={PLAN_LIST_ROW_META}>
                            {cidrDisp} | 运行在 VLAN {vlanDisp}
                          </div>
                        </div>
                      </List.Item>
                    );
                  }}
                />
                </div>
              </Card>
              <Card {...PLAN_SECTION_CARD} styles={PLAN_SECTION_CARD_STYLES}>
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
                  <Space size={8} align="center">
                    <span style={{ fontSize: 14, fontWeight: 500 }}>扁平子网</span>
                    <Tag color="blue">{flatSubnetsForPn.length}</Tag>
                  </Space>
                  {canWriteFlatSubnet ? (
                    <Button type="primary" onClick={() => setFlatSubnetModalOpen(true)}>
                      添加扁平子网
                    </Button>
                  ) : null}
                </div>
                <div style={PLAN_LIST_SURFACE}>
                <List
                  size="small"
                  split
                  dataSource={flatSubnetsForPn}
                  locale={{ emptyText: '暂无关联扁平子网' }}
                  renderItem={(item: any) => {
                    const alias = String(item?.alias || '').trim();
                    const name = String(item?.name || '-').trim();
                    const cidr = String(item?.cidr || '-').trim();
                    const cidrDisp = cidr && cidr !== '-' ? cidr : '—';
                    const vlanDisp = item?.vlanId ?? item?.vlan ?? '—';
                    const busy = deletingFlatSubnetName === name;
                    return (
                      <List.Item
                        key={name}
                        style={PLAN_LIST_ITEM_PADDING}
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
                        <div style={PLAN_LIST_ROW_BODY}>
                          <div style={PLAN_LIST_ROW_TITLE}>{alias || name || '—'}</div>
                          <div style={PLAN_LIST_ROW_META}>
                            {cidrDisp} | 运行在 VLAN {vlanDisp}
                          </div>
                        </div>
                      </List.Item>
                    );
                  }}
                />
                </div>
              </Card>
            </>
          )}
        </>
        )}
      </div>

      <Modal
        title="编辑名称"
        open={editSubnetModalOpen}
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

export default ProviderNetworkVlanPlanDrawer;
