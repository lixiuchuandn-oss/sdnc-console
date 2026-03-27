import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type { FormInstance } from 'antd/es/form';
import { Button, Form, Input, Modal, Select, Table, Tag, Tooltip, Typography, message } from 'antd';
import { ApartmentOutlined, GlobalOutlined, ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import ResourceActionsDropdown from '../../../../components/ResourceActionsDropdown';
import TableColumnSettingsButton from '../../../../components/TableColumnSettingsButton';
import { useTableColumnSettings } from '../../../../hooks/useTableColumnSettings';
import {
  createKubeOvnSubnet,
  deleteKubeOvnSubnet,
  fetchKubeOvnProviderNetworks,
  fetchKubeOvnSubnets,
  fetchKubeOvnVlans,
  updateKubeOvnSubnet,
} from '../../../../services/harvesterApi';
import { clearCache } from '../../../../utils/requestManager';
import SubnetAclFormItems, {
  normalizeAclRowForForm,
  validateAclsFormRowsForSubmit,
} from './SubnetAclFormItems';
import UnderlaySubnetDetailDrawer from './UnderlaySubnetDetailDrawer';
import HarvesterResourceDrawer from '../components/HarvesterOpsinfoDrawer';
import { generateHarvesterEntityId } from '../../../../utils/harvesterUtils';
import { TOWER_IO_ALIES_ANNOTATION } from '../../../../utils/towerKubeOvnNames';
import { useAuth } from '../../../../contexts/AuthContext';
import { hasPermissionForAction } from '../../../../utils/accessMapping';
import {
  CLOUD_SUBNETS_FLAT_WRITE,
  CLOUD_SUBNETS_PUBLIC_WRITE,
} from '../../../../constants/cloudPermissions';

const { Option } = Select;

const TOWER_ALIAS_ANNOTATION = 'tower.io/alias';

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
 *   - 挂在默认 VPC（如 ovn-cluster）下的 Kube-OVN 子网；可选绑定 VLAN（spec.vlan）。
 *   - 不选 VLAN：纯 OVN overlay，与同 VPC 内其它资源互通，不经物理 VLAN 上行（适合不需开通 VPC 高级能力的租户隔离网段）。
 *   - 选择 VLAN：与物理线路打标签对接，二层直通类场景；一般 natOutgoing=false。
 *
 * 【公共子网】本组件 mode=public，注解 tower.io/subnet-type=public
 *   - 仍在默认 VPC 下，产品侧用于 EIP/NAT/浮动 IP 等南北向能力常用网段，一般 natOutgoing=true。
 *
 * 【VPC 子网】见 SubnetsSection / VpcsSection，注解 tower.io/subnet-type=vpc
 *   - 挂在用户业务 VPC（非 ovn-cluster）内，租户隔离网段。
 *
 * =============================================================================
 */
type Props = {
  cloudId: string;
  mode?: 'flat' | 'public';
  displayMode?: 'standard' | 'ops';
  /** 是否显示「查看YAML」并接入 HarvesterOpsinfoDrawer（与 VPC 子网列表一致） */
  showYaml?: boolean;
};

const SUBNET_TYPE_ANNOTATION_KEY = 'tower.io/subnet-type';
const SUBNET_FINALIZER = 'tower.io/managed';
const PROVIDER_NETWORK_ANNOTATION = 'tower.io/provider-network';

/** 默认选中 VLAN：按 spec.id 数值最小（部署侧通常预置 id=0 等） */
function defaultVlanCrNameByMinVlanId(vlans: any[]): string | undefined {
  if (!Array.isArray(vlans) || vlans.length === 0) return undefined;
  const scored = vlans
    .map((v) => ({
      name: String(v?.metadata?.name ?? '').trim(),
      id: Number(v?.spec?.id),
    }))
    .filter((x) => x.name);
  if (scored.length === 0) return undefined;
  scored.sort((a, b) => {
    const ai = Number.isFinite(a.id) ? a.id : Number.POSITIVE_INFINITY;
    const bi = Number.isFinite(b.id) ? b.id : Number.POSITIVE_INFINITY;
    if (ai !== bi) return ai - bi;
    return a.name.localeCompare(b.name);
  });
  return scored[0].name;
}

function providerDisplayName(providerName: string, providers: any[]): string {
  const pn = String(providerName ?? '').trim();
  if (!pn) return '未指定';
  const hit = Array.isArray(providers)
    ? providers.find((p) => String(p?.metadata?.name ?? '').trim() === pn)
    : undefined;
  if (!hit) return pn;
  const ann = hit?.metadata?.annotations || {};
  const alias = String(ann[TOWER_IO_ALIES_ANNOTATION] ?? '').trim();
  return alias || pn;
}

/** 下拉框仅展示：VLAN 标签 · 物理网络(别名优先) */
function vlanRecordLabelForSelect(v: any, providers: any[]): string {
  const tag = v?.spec?.id;
  const tagStr = tag !== undefined && tag !== null ? String(tag) : '—';
  const prov = providerDisplayName(String(v?.spec?.provider ?? '').trim(), providers);
  return `VLAN ${tagStr} - ${prov}`;
}

/** 供搜索：集群资源名、标签号、物理网络（界面不展示资源名） */
function vlanRecordSearchBlob(v: any, providers: any[]): string {
  const metaName = String(v?.metadata?.name ?? '').trim();
  const tag = v?.spec?.id;
  const providerName = String(v?.spec?.provider ?? '').trim();
  const providerAlias = providerDisplayName(providerName, providers);
  return [metaName, tag !== undefined && tag !== null ? String(tag) : '', providerName, providerAlias]
    .filter(Boolean)
    .join(' ');
}

type UnderlaySubnetFormFieldsProps = {
  form: FormInstance;
  isFlatMode: boolean;
  vlans: any[];
  /** 仅公共子网使用（扁平子网不展示物理网络） */
  providers?: any[];
  aliasDupCheckItems: any[];
  /** 创建流程可传入更详细的「自动生成 metadata.name」说明 */
  aliasFieldTooltip?: string;
  /** 编辑时传入当前子网 metadata.name，别名重复校验时排除自身 */
  editingSubnetResourceName?: string | null;
};

const UnderlaySubnetFormFields: React.FC<UnderlaySubnetFormFieldsProps> = ({
  form,
  isFlatMode,
  vlans,
  providers,
  aliasDupCheckItems,
  aliasFieldTooltip,
  editingSubnetResourceName,
}) => (
  <>
    <Form.Item
      name="alias"
      label={isFlatMode ? '名称' : '别名'}
      tooltip={
        aliasFieldTooltip ||
        '展示名称，支持中文；写入注解 tower.io/alias。子网在集群中的资源名（metadata.name）创建后不可改。'
      }
      rules={[
        { required: true, message: isFlatMode ? '请输入名称' : '请输入别名' },
        { max: 200, message: isFlatMode ? '名称不超过 200 字' : '别名不超过 200 字' },
        {
          validator: async (_, value) => {
            const s = String(value ?? '').trim();
            if (!s) return Promise.resolve();
            const dup = aliasDupCheckItems.some((item: any) => {
              if (editingSubnetResourceName && item?.metadata?.name === editingSubnetResourceName) return false;
              const a = String(item?.metadata?.annotations?.[TOWER_ALIAS_ANNOTATION] ?? '').trim();
              return a.length > 0 && a === s;
            });
            if (dup) {
              return Promise.reject(new Error(isFlatMode ? '名称已存在，请修改' : '别名已存在，请修改'));
            }
            return Promise.resolve();
          },
        },
      ]}
    >
      <Input placeholder="显示名称（支持中文）" />
    </Form.Item>
    <Form.Item name="cidrBlock" label="CIDR" rules={[{ required: true }]}><Input placeholder="192.168.1.0/24" /></Form.Item>
    <Form.Item name="gateway" label="网关" rules={[{ required: true }]}><Input placeholder="192.168.1.1" /></Form.Item>
    <Form.Item
      name="vlan"
      label="VLAN"
      tooltip={
        isFlatMode
          ? '需要与物理网络对接时选择集群已有 VLAN；不选则仅为 OVN 虚拟二层（overlay），不绑定物理 VLAN。'
          : '若需要给流量打 VLAN 标签，请从集群已有 VLAN 中选择；不选表示不打标签。'
      }
    >
      <Select
        placeholder={isFlatMode ? '可选（不选 = 纯 overlay）' : '可选'}
        allowClear
        showSearch={isFlatMode}
        optionFilterProp="label"
        dropdownStyle={{ minWidth: 280 }}
      >
        {vlans.map((v) => (
          <Option key={v.metadata.name} value={v.metadata.name} label={vlanRecordSearchBlob(v, providers || [])}>
            {vlanRecordLabelForSelect(v, providers || [])}
          </Option>
        ))}
      </Select>
    </Form.Item>
    {!isFlatMode && Array.isArray(providers) ? (
      <Form.Item
        name="provider"
        label="物理网络"
        tooltip="指明子网主要关联哪条物理上行（选集群里预先建好的物理网络即可）。可选；需与运维在集群中的网络规划一致。"
      >
        <Select placeholder="可选" allowClear>
          {providers.map((p) => (
            <Option key={p.metadata.name} value={p.metadata.name}>
              {p.metadata.name}
            </Option>
          ))}
        </Select>
      </Form.Item>
    ) : null}
    <Form.Item name="excludeIps" label="排除 IP (可选)">
      <Input.TextArea rows={3} placeholder="每行一个 IP 或 IP 范围 (e.g. 192.168.1.1..192.168.1.10)" />
    </Form.Item>
  </>
);

function subnetRecordToFormValues(record: any, isFlatMode: boolean): Record<string, unknown> {
  const spec = record?.spec || {};
  const ann = record?.metadata?.annotations || {};
  const excludeRaw = spec.excludeIps;
  const excludeIps = Array.isArray(excludeRaw)
    ? excludeRaw.map((x: unknown) => String(x)).join('\n')
    : '';
  const physicalProvider = String(ann[PROVIDER_NETWORK_ANNOTATION] ?? '').trim() || undefined;
  const base: Record<string, unknown> = {
    alias: String(ann[TOWER_ALIAS_ANNOTATION] ?? '').trim() || undefined,
    cidrBlock: spec.cidrBlock ?? spec.cidr ?? '',
    gateway: spec.gateway ?? '',
    vlan: spec.vlan ?? undefined,
    excludeIps,
  };
  if (!isFlatMode) {
    base.provider = physicalProvider;
  }
  return base;
}

const UnderlaySubnetsSection: React.FC<Props> = ({ cloudId, mode = 'flat', displayMode = 'ops', showYaml = true }) => {
  const { user } = useAuth();
  const perms = useMemo(() => (user?.permissions ?? []) as string[], [user?.permissions]);
  const isTenantUser = useMemo(() => user?.role === 'tenant' || !!user?.tenantId, [user]);
  const isFlatMode = mode === 'flat';
  const hasUnderlayWrite = useMemo(() => {
    const scopedWrite = isFlatMode ? CLOUD_SUBNETS_FLAT_WRITE : CLOUD_SUBNETS_PUBLIC_WRITE;
    const hasWrite =
      hasPermissionForAction(perms, scopedWrite) ||
      hasPermissionForAction(perms, 'clouds.subnets:write') ||
      hasPermissionForAction(perms, 'clouds.vpcs:write') ||
      hasPermissionForAction(perms, 'clouds:write');
    // 租户角色禁止扁平/公共子网写操作（与镜像写权限收敛策略一致）
    return hasWrite && !isTenantUser;
  }, [isFlatMode, perms, isTenantUser]);
  const ensureUnderlayWrite = useCallback(() => {
    if (hasUnderlayWrite) return true;
    message.error('当前账号没有子网操作权限（租户角色仅允许查看）');
    return false;
  }, [hasUnderlayWrite]);

  /** 标准视图：隐藏 ACL 等运维列 */
  const isStandardView = displayMode === 'standard';
  const subnetKindLabel = isFlatMode ? '扁平子网' : '公共子网';
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [isModalVisible, setIsModalVisible] = useState(false);
  const [aclModalVisible, setAclModalVisible] = useState(false);
  const [aclSubnetName, setAclSubnetName] = useState<string | null>(null);
  const [aclSubmitting, setAclSubmitting] = useState(false);
  const [detailDrawerOpen, setDetailDrawerOpen] = useState(false);
  const [detailSubnetRecord, setDetailSubnetRecord] = useState<any>(null);
  const [harvesterOpsOpen, setHarvesterOpsOpen] = useState(false);
  const [harvesterOpsRecord, setHarvesterOpsRecord] = useState<any>(null);
  const [harvesterOpsTab, setHarvesterOpsTab] = useState('detail');
  const [form] = Form.useForm();
  const [editForm] = Form.useForm();
  const [editModalVisible, setEditModalVisible] = useState(false);
  const [editRecord, setEditRecord] = useState<any>(null);
  const [editSubmitting, setEditSubmitting] = useState(false);
  const [aclForm] = Form.useForm();
  const [vlans, setVlans] = useState<any[]>([]);
  const [providers, setProviders] = useState<any[]>([]);
  const [keyword, setKeyword] = useState('');
  const [vlanFilter, setVlanFilter] = useState<string | undefined>(undefined);

  const filteredData = useMemo(() => {
    const k = keyword.trim().toLowerCase();
    return data.filter((item: any) => {
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
  }, [data, keyword, vlanFilter]);

  const loadTypedSubnets = useCallback(
    async (force = false, skipSync = false) => {
      const res = await fetchKubeOvnSubnets(cloudId, force, skipSync);
      const items = Array.isArray(res?.data?.items) ? res.data.items : [];
      const expectType = isFlatMode ? 'flat' : 'public';
      return items.filter((item: any) => {
        const t = String(item?.metadata?.annotations?.[SUBNET_TYPE_ANNOTATION_KEY] || '').trim().toLowerCase();
        return t === expectType;
      });
    },
    [cloudId, isFlatMode],
  );

  /** 接口保存失败后，用集群当前 Subnet 覆盖 ACL 表单，避免「未写入」的规则仍回显在弹窗里 */
  const resyncAclFormFromCluster = async (subnetName: string) => {
    try {
      const typed = await loadTypedSubnets(true, false);
      setData(typed);
      const rec = typed.find((x: any) => x?.metadata?.name === subnetName);
      if (!rec) return;
      const spec = rec.spec || {};
      aclForm.setFieldsValue({
        allowEWTraffic: spec.allowEWTraffic ?? false,
        acls: Array.isArray(spec.acls) ? spec.acls.map((a: any) => normalizeAclRowForForm({ ...a })) : [],
      });
    } catch {
      // 静默：拉取失败时不打断用户，表单仍保留（与集群可能不一致）
    }
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

  const fetchVlanOptions = useCallback(async () => {
    try {
      const res = await fetchKubeOvnVlans(cloudId);
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

  const handleForceRefresh = async () => {
    await Promise.all([
      fetchData(true, false),
      fetchVlanOptions(),
      fetchProviderOptions(),
    ]);
  };

  const handleCreate = async (values: any) => {
    if (!ensureUnderlayWrite()) return;
    try {
      const { alias, provider: _provider, ...rest } = values;
      const aliasTrim = String(alias ?? '').trim();
      const subnetId = generateHarvesterEntityId('sn');
      const excludeIps = rest.excludeIps
        ? String(rest.excludeIps).split('\n').map((s: string) => s.trim()).filter((s: string) => s)
        : [];
      /** 扁平子网：与集群/产品约定一致的固定 spec；vlan 可选（不填则纯 overlay） */
      const vlanTrim = String(rest.vlan ?? '').trim();
      const flatSubnetHardcoded = {
        natOutgoing: false,
        private: false,
        gatewayType: 'distributed',
        disableGatewayCheck: true,
        allowDhcp: true,
        ...(vlanTrim ? { vlan: vlanTrim } : {}),
      };

      const payload: Record<string, unknown> = {
        ...rest,
        name: subnetId,
        excludeIps,
        protocol: 'IPv4',
        allowEWTraffic: false,
        vpc: rest.vpc || 'ovn-cluster',
        ...(isFlatMode
          ? flatSubnetHardcoded
          : {
              gatewayType: rest.gatewayType || 'distributed',
              private: rest.private ?? false,
              natOutgoing: true,
            }),
        annotations: {
          ...(rest?.annotations || {}),
          [SUBNET_TYPE_ANNOTATION_KEY]: isFlatMode ? 'flat' : 'public',
          ...(aliasTrim ? { [TOWER_ALIAS_ANNOTATION]: aliasTrim } : {}),
        },
        finalizers: Array.from(new Set([...(Array.isArray(rest?.finalizers) ? rest.finalizers : []), SUBNET_FINALIZER])),
      };
      const createRes = await createKubeOvnSubnet(cloudId, payload);
      const createdSubnet = createRes?.data || createRes;
      const createdType = String(createdSubnet?.metadata?.annotations?.[SUBNET_TYPE_ANNOTATION_KEY] || '').trim().toLowerCase();
      const expectType = isFlatMode ? 'flat' : 'public';
      if (createdSubnet?.metadata?.name && createdType === expectType) {
        setData((prev) => {
          const next = prev.filter((i: any) => i?.metadata?.name !== createdSubnet.metadata.name);
          return [createdSubnet, ...next];
        });
      }
      message.success(`创建${subnetKindLabel}成功`);
      setIsModalVisible(false);
      form.resetFields();
      await fetchData(true, false);
    } catch (error: any) {
      const rd = error?.responseData;
      let detail = String(error?.message || '').trim() || '未知错误';
      if (rd?.details != null) {
        const ds = typeof rd.details === 'string' ? rd.details : JSON.stringify(rd.details);
        const head = ds.slice(0, 48);
        if (head && !detail.includes(head)) {
          const more = ds.length > 400 ? `${ds.slice(0, 400)}…` : ds;
          detail = `${detail} | ${more}`;
        }
      }
      message.error(`创建${subnetKindLabel}失败: ${detail}`);
    }
  };

  const openEditNetwork = useCallback(
    (record: any) => {
      setEditRecord(record);
      editForm.setFieldsValue(subnetRecordToFormValues(record, isFlatMode));
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
      const { alias, ...rest } = values;
      const aliasTrim = String(alias ?? '').trim();
      const excludeIps = rest.excludeIps
        ? String(rest.excludeIps).split('\n').map((s: string) => s.trim()).filter((s: string) => s)
        : [];
      const providerTrim = String(rest.provider ?? '').trim();
      const annotations: Record<string, string> = {
        [TOWER_ALIAS_ANNOTATION]: aliasTrim,
        ...(isFlatMode ? {} : { [PROVIDER_NETWORK_ANNOTATION]: providerTrim }),
      };
      const payload: Record<string, unknown> = {
        cidrBlock: String(rest.cidrBlock ?? '').trim(),
        gateway: String(rest.gateway ?? '').trim(),
        excludeIps,
        annotations,
      };
      const vlanRaw = rest.vlan;
      if (vlanRaw !== undefined && vlanRaw !== null && String(vlanRaw) !== '') {
        payload.vlan = vlanRaw;
      } else {
        payload.vlan = null;
      }
      await updateKubeOvnSubnet(cloudId, name, payload);
      message.success(`更新${subnetKindLabel}成功`);
      setEditModalVisible(false);
      setEditRecord(null);
      editForm.resetFields();
      await fetchData(true, false);
    } catch (error: any) {
      const raw =
        error?.response?.data?.message ??
        error?.response?.data?.error ??
        error?.response?.data ??
        error?.data?.message ??
        error?.message ??
        '未知错误';
      const detail = typeof raw === 'string' ? raw : JSON.stringify(raw);
      message.error(`更新${subnetKindLabel}失败: ${detail}`);
    } finally {
      setEditSubmitting(false);
    }
  };

  const openAclEditor = useCallback((record: any) => {
    const name = record?.metadata?.name;
    if (!name) return;
    const spec = record?.spec || {};
    setAclSubnetName(name);
    aclForm.setFieldsValue({
      acls: Array.isArray(spec.acls) ? spec.acls.map((a: any) => normalizeAclRowForForm({ ...a })) : [],
    });
    setAclModalVisible(true);
  }, [aclForm]);

  const handleAclSubmit = async () => {
    if (!ensureUnderlayWrite()) return;
    if (!aclSubnetName) return;
    try {
      const values = await aclForm.validateFields();
      const patchBody: Record<string, unknown> = {};
      if (Array.isArray(values.acls)) {
        const aclCheck = validateAclsFormRowsForSubmit(values.acls);
        if (!aclCheck.ok) {
          message.error(aclCheck.message);
          const err = new Error(aclCheck.message) as Error & { aclFormValidated?: boolean };
          err.aclFormValidated = true;
          throw err;
        }
        patchBody.acls = aclCheck.normalized;
      }
      setAclSubmitting(true);
      await updateKubeOvnSubnet(cloudId, aclSubnetName, patchBody);
      message.success('ACL 已更新');
      setAclModalVisible(false);
      setAclSubnetName(null);
      aclForm.resetFields();
      await fetchData(true, false);
    } catch (e: any) {
      if (e?.errorFields) throw e;
      if (e?.aclFormValidated) throw e;
      const rd = e?.responseData;
      let detail = String(e?.message || '').trim() || '未知错误';
      if (rd?.details != null) {
        const ds = typeof rd.details === 'string' ? rd.details : JSON.stringify(rd.details);
        const head = ds.slice(0, 48);
        if (head && !detail.includes(head)) {
          const more = ds.length > 400 ? `${ds.slice(0, 400)}…` : ds;
          detail = `${detail} | ${more}`;
        }
      }
      message.error(`更新 ACL 失败: ${detail}`);
      if (aclSubnetName) {
        await resyncAclFormFromCluster(aclSubnetName);
      }
      throw e;
    } finally {
      setAclSubmitting(false);
    }
  };

  const openOpsDrawer = useCallback((record: any) => {
    setDetailSubnetRecord(record);
    setDetailDrawerOpen(true);
  }, []);

  const openHarvesterOpsDrawer = useCallback((record: any) => {
    setHarvesterOpsRecord(record);
    setHarvesterOpsTab(record?.links?.view ? 'view_link' : 'detail');
    setHarvesterOpsOpen(true);
  }, []);

  const handleDelete = useCallback(
    async (name: string) => {
      if (!ensureUnderlayWrite()) return;
      try {
        await deleteKubeOvnSubnet(cloudId, name);
        message.success('删除成功');
        await fetchData(true, false);
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
        message.error(`删除失败: ${detail}`);
      }
    },
    [cloudId, ensureUnderlayWrite, fetchData],
  );

  const allColumns = useMemo(
    () => [
      {
        title: '名称',
        key: 'displayName',
        ellipsis: true,
        render: (_: any, record: any) => {
          const alias = String(record?.metadata?.annotations?.[TOWER_ALIAS_ANNOTATION] ?? '').trim();
          const display = alias || '—';
          const NameIcon = isFlatMode ? ApartmentOutlined : GlobalOutlined;
          const nameInner = (
            <>
              <NameIcon style={{ color: '#1677ff', fontSize: 16, flexShrink: 0 }} />
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>{display}</span>
            </>
          );
          return (
            <span title={alias || undefined} style={{ display: 'flex', alignItems: 'center', maxWidth: '100%', minWidth: 0 }}>
              {isFlatMode ? (
                <Typography.Link
                  onClick={(e) => {
                    e.preventDefault();
                    openOpsDrawer(record);
                  }}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 6, maxWidth: '100%', minWidth: 0 }}
                >
                  {nameInner}
                </Typography.Link>
              ) : (
                <span style={{ display: 'flex', alignItems: 'center', gap: 6, maxWidth: '100%', minWidth: 0 }}>
                  {nameInner}
                </span>
              )}
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
      { title: 'CIDR', dataIndex: ['spec', 'cidrBlock'], key: 'cidr' },
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
              <Tag title="未绑定 VLAN，纯 OVN overlay">overlay</Tag>
            ) : (
              <Tag>未打标签 (Untagged)</Tag>
            );
          }
          const vlanObj = vlans.find((item) => String(item?.metadata?.name ?? '').trim() === vlanName);
          if (!vlanObj) {
            return <Tag color="blue">{vlanName}</Tag>;
          }
          return <Tag color="blue">{vlanRecordLabelForSelect(vlanObj, providers)}</Tag>;
        },
      },
      ...(isFlatMode
        ? []
        : [
            {
              title: '物理网络',
              key: 'provider',
              render: (_: any, record: any) => {
                const hint = record?.metadata?.annotations?.['tower.io/provider-network'];
                const specP = record?.spec?.provider;
                const val = hint || specP;
                return val ? <Tag color="geekblue">{val}</Tag> : '-';
              },
            },
          ]),
      {
        title: '已用 / 总数',
        key: 'usage',
        render: (_: any, record: any) => {
          const st = record.status || {};
          // 集群 JSON 常为 v4availableIPs / v4usingIPs（小写 available），与文档 v4AvailableIPs 并存
          const available = Number(
            st.v4AvailableIPs ??
              st.v4availableIPs ??
              st.availableIPs ??
              st.availableIps ??
              0,
          ) || 0;
          const using = Number(
            st.v4UsingIPs ?? st.v4usingIPs ?? st.usingIPs ?? st.usingIps ?? 0,
          ) || 0;
          // 与 Kube-OVN status：已用 + 可用 = 控制器统计的分配池规模（如 0/253 表示未占用、池内共 253）
          return (
            <span title={`可用 ${available}（已用 ${using}）`}>
              {using} / {available + using}
            </span>
          );
        },
      },

      ...(isStandardView
        ? []
        : [
            {
              title: 'ACL',
              key: 'acls',
              width: 72,
              render: (_: any, record: any) => {
                const acls = record?.spec?.acls;
                const n = Array.isArray(acls) ? acls.length : 0;
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
      {
        title: '操作',
        key: 'action',
        width: 80,
        align: 'left' as const,
        fixed: 'right' as const,
        render: (_: any, record: any) => {
          const name = record?.metadata?.name;
          const actionItems = [
            ...(showYaml
              ? [{ key: 'view_yaml', label: '查看YAML', onClick: () => openHarvesterOpsDrawer(record) }]
              : []),
            {
              key: 'detail',
              label: '查看详情',
              onClick: () => openOpsDrawer(record),
            },
            {
              key: 'edit_network',
              label: '编辑网络',
              disabled: !hasUnderlayWrite,
              onClick: () => openEditNetwork(record),
            },
            ...(!isStandardView
              ? [
                  {
                    key: 'edit_acl',
                    label: '编辑 ACL',
                    disabled: !hasUnderlayWrite,
                    onClick: () => openAclEditor(record),
                  },
                ]
              : []),
            { type: 'divider' as const },
            {
              key: 'delete',
              label: '删除',
              danger: true,
              disabled: !hasUnderlayWrite,
              onClick: () => {
                if (!name) return;
                const disp =
                  String(record?.metadata?.annotations?.[TOWER_ALIAS_ANNOTATION] ?? '').trim() || name;
                Modal.confirm({
                  title: '确认删除',
                  okType: 'danger',
                  content: `确定删除该${subnetKindLabel}「${disp}」吗？将同时删除关联的网络附加定义（NAD）。`,
                  onOk: () => handleDelete(name),
                });
              },
            },
          ];
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
      openHarvesterOpsDrawer,
      openEditNetwork,
      isFlatMode,
      isStandardView,
      vlans,
      providers,
      showYaml,
      hasUnderlayWrite,
      handleDelete,
      openAclEditor,
    ],
  );

  const underlaySubnetTableSettingsKey = `harvester_underlay_subnets_${mode}`;
  const { displayColumns: columns } = useTableColumnSettings(allColumns, underlaySubnetTableSettingsKey);

  return (
    <div>
      <div className="page-toolbar">
        <div className="toolbar-container">
          <Input
            allowClear
            placeholder="名称/网段/ID"
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
              void handleForceRefresh();
            }}
          >
            重置
          </Button>
        </div>
        <div className="toolbar-actions">
          <Button
            type="primary"
            disabled={!hasUnderlayWrite}
            onClick={() => {
              if (!ensureUnderlayWrite()) return;
              form.resetFields();
              setIsModalVisible(true);
              // 公共子网仍可默认选最小 VLAN；扁平子网默认不选 VLAN，便于纯 overlay 场景
              if (!isFlatMode) {
                const defVlan = defaultVlanCrNameByMinVlanId(vlans);
                if (defVlan) {
                  form.setFieldsValue({ vlan: defVlan });
                }
              }
            }}
          >
            {`创建${subnetKindLabel}`}
          </Button>
          <TableColumnSettingsButton allColumns={allColumns} settingsKey={underlaySubnetTableSettingsKey} />
          <Tooltip title="从集群重新同步子网列表，并刷新本地缓存">
            <Button icon={<ReloadOutlined />} onClick={handleForceRefresh} loading={loading} aria-label="刷新" />
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
        scroll={{ x: 'max-content' }}
        pagination={{ size: 'small', showTotal: (total) => `共 ${total} 条` }}
      />

      <UnderlaySubnetDetailDrawer
        open={detailDrawerOpen}
        onClose={() => {
          setDetailDrawerOpen(false);
          setDetailSubnetRecord(null);
        }}
        cloudId={cloudId}
        subnet={detailSubnetRecord}
        kindLabel={subnetKindLabel}
      />

      <HarvesterResourceDrawer
        resourceType="Subnet"
        record={harvesterOpsRecord}
        open={harvesterOpsOpen}
        onClose={() => {
          setHarvesterOpsOpen(false);
          setHarvesterOpsRecord(null);
        }}
        activeTab={harvesterOpsTab}
        onTabChange={setHarvesterOpsTab}
        cloudId={cloudId}
      />

      <Modal
        title={`创建${subnetKindLabel}`}
        open={isModalVisible}
        centered
        onOk={form.submit}
        onCancel={() => {
          setIsModalVisible(false);
          form.resetFields();
        }}
        width={600}
      >
        <Form form={form} layout="vertical" onFinish={handleCreate} className="std-form">
          <UnderlaySubnetFormFields
            form={form}
            isFlatMode={isFlatMode}
            vlans={vlans}
            providers={providers}
            aliasDupCheckItems={data}
            aliasFieldTooltip="展示名称，支持中文；写入注解 tower.io/alias。子网在集群中的资源名（metadata.name）为自动生成，格式 id-sn- 加 11 位随机字符。"
          />
        </Form>
      </Modal>

      <Modal
        title={`编辑${subnetKindLabel}`}
        open={editModalVisible}
        centered
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
          />
        </Form>
      </Modal>

      <Modal
        title={'编辑 ACL规则'}
        open={aclModalVisible}
        centered
        onOk={handleAclSubmit}
        onCancel={() => {
          setAclModalVisible(false);
          setAclSubnetName(null);
          aclForm.resetFields();
        }}
        confirmLoading={aclSubmitting}
        width={1100}
        destroyOnHidden
      >
        <Form form={aclForm} layout="vertical" className="std-form">
          <SubnetAclFormItems showAllowEW={false} />
        </Form>
      </Modal>
    </div>
  );
};

export default UnderlaySubnetsSection;

