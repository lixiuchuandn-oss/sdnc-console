import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Button,
  Drawer,
  Empty,
  Form,
  Input,
  Modal,
  Select,
  Table,
  Tooltip,
  Typography,
  message,
} from 'antd';
import type { MenuProps } from 'antd';
import type { SubnetAclFormRow } from './SubnetAclFormItems';
import { PlusOutlined, ReloadOutlined, SafetyOutlined, SearchOutlined } from '@ant-design/icons';
import { useAuth } from '../../../../contexts/AuthContext';
import ResourceActionsDropdown from '../../../../components/ResourceActionsDropdown';
import TableColumnSettingsButton from '../../../../components/TableColumnSettingsButton';
import { useTableColumnSettings } from '../../../../hooks/useTableColumnSettings';
import { hasPermissionForAction } from '../../../../utils/accessMapping';
import { fetchCloudProviderEcs } from '../../../../services/api';
import {
  addKubeOvnSecurityGroupMembers,
  createKubeOvnSecurityGroup,
  deleteKubeOvnSecurityGroup,
  fetchKubeOvnSecurityGroupDetail,
  fetchKubeOvnSecurityGroups,
  fetchKubeOvnSubnets,
  removeKubeOvnSecurityGroupMember,
  replaceKubeOvnSecurityGroupRules,
  updateKubeOvnSecurityGroup,
} from '../../../../services/harvesterApi';
import { normalizeAclRowForForm, normalizeAclsForApi } from './SubnetAclFormItems';
import SecurityGroupAccessControlDrawer, { type SgAclDirection } from './SecurityGroupAclDrawer';

const { Paragraph } = Typography;
const SUBNET_TYPE_KEY = 'tower.io/subnet-type';
const SUBNET_ALIAS_KEY = 'tower.io/alias';
/** 历史误写，与 VM/子网其它处一致 */
const SUBNET_ALIAS_LEGACY_KEY = 'tower.io/alies';
const SECURITY_GROUPS_TABLE_SETTINGS_KEY = 'harvester_kube_ovn_security_groups_table';

function subnetTowerAliasFromCr(item: any): string {
  const ann = item?.metadata?.annotations || {};
  const raw = ann[SUBNET_ALIAS_KEY] ?? ann[SUBNET_ALIAS_LEGACY_KEY];
  return String(raw ?? '').trim();
}

/** 有别名则显示别名，否则显示 metadata.name（不再固定为「别名 / 资源名」） */
function flatSubnetDisplayLabel(metadataName: string, alias: string): string {
  const n = String(metadataName ?? '').trim();
  const a = String(alias ?? '').trim();
  return a || n;
}

function vmNetworkMatchesFlatSubnet(vm: any, subnetName: string): boolean {
  if (!Array.isArray(vm?.networks)) return false;
  const sn = subnetName.toLowerCase();
  return vm.networks.some((n: string) => {
    const s = String(n || '').toLowerCase();
    const base = s.includes('@') ? s.split('@')[0] : s;
    return base === `default/${sn}` || base.endsWith(`/${sn}`);
  });
}

/** K8s VirtualMachine metadata.namespace（与 ECS 列表顶层 namespace 对齐） */
function vmKubernetesNamespace(vm: any): string {
  const ns = String(vm?.metadata?.namespace ?? vm?.namespace ?? '').trim();
  return ns || 'default';
}

/** K8s metadata.name（资源名），与 ECS 列表的 name 同源 */
function vmKubernetesName(vm: any): string {
  return String(vm?.metadata?.name ?? vm?.name ?? '').trim();
}

function vmRowKey(vm: any): string {
  const nm = vmKubernetesName(vm);
  if (!nm) return '';
  return `${vmKubernetesNamespace(vm)}/${nm}`;
}

/**
 * 展示用别名：仅注解 tower.io/alias（及历史误写 tower.io/alies），不含 metadata.name。
 * 与 VmSection 等区分：不把 InstanceName/顶层 name 当作 alias，避免与资源名混淆。
 */
function vmVmAnnotationAlias(vm: any): string {
  const ann = { ...(vm?.metadata?.annotations || {}), ...(vm?.annotations || {}) };
  const raw = ann['tower.io/alias'] ?? ann['tower.io/alies'];
  return String(raw ?? '').trim();
}

/** 按 ns/name 在 ECS 列表中解析 VM（键不一致时回退线性匹配） */
function resolveVmFromEcsList(
  vmNamespace: string,
  vmName: string,
  vmByKey: Map<string, any>,
  vms: any[],
): any | undefined {
  const ns = String(vmNamespace ?? '').trim() || 'default';
  const nm = String(vmName ?? '').trim();
  if (!nm) return undefined;
  const k = `${ns}/${nm}`;
  const hit = vmByKey.get(k);
  if (hit) return hit;
  return vms.find((v) => vmKubernetesNamespace(v) === ns && vmKubernetesName(v) === nm);
}

/** 与 VmSection SafeRead.ip 同源，用于成员列表 IP 徽章 */
function harvesterVmPrimaryIp(vm: any): string {
  if (!vm) return '';
  if (Array.isArray(vm?.ips) && vm.ips.length > 0) {
    return vm.ips.map((x: unknown) => String(x)).filter(Boolean).join(', ');
  }
  try {
    const annot = vm?.metadata?.annotations?.['network.harvesterhci.io/ips'];
    if (annot) {
      const arr = JSON.parse(annot);
      if (Array.isArray(arr) && arr.length > 0) {
        return arr.map((x: unknown) => String(x)).filter(Boolean).join(', ');
      }
    }
    if (vm?.vmi?.status?.interfaces) {
      const ips: string[] = [];
      for (const i of vm.vmi.status.interfaces) {
        if (i?.ipAddress) ips.push(String(i.ipAddress));
        if (Array.isArray(i?.ipAddresses)) ips.push(...i.ipAddresses.map((x: unknown) => String(x)));
      }
      if (ips.length > 0) return [...new Set(ips)].join(', ');
    }
    if (vm?.status?.interfaces) {
      const ips: string[] = [];
      for (const i of vm.status.interfaces) {
        if (i?.ipAddress) ips.push(String(i.ipAddress));
      }
      if (ips.length > 0) return [...new Set(ips)].join(', ');
    }
  } catch {
    /* ignore */
  }
  return '';
}

export type SecurityGroupRow = {
  id: string;
  name: string;
  description?: string;
  subnetName: string;
  ruleCount: number;
  memberCount: number;
  updatedAt?: string;
};

export type SecurityGroupMemberRow = {
  id: string;
  vmNamespace: string;
  vmName: string;
  /** 注解 tower.io/alias（及历史 tower.io/alies）；不含 metadata.name */
  vmAlias: string;
  /** 展示用 IP（多地址逗号分隔） */
  vmIp: string;
  createdAt?: string;
};

export type SecurityGroupVmOptionRow = {
  value: string;
  vmNamespace: string;
  /** metadata.name */
  vmName: string;
  /** 注解 tower.io/alias（及历史 tower.io/alies） */
  alias: string;
  vmIp: string;
};

type Props = {
  cloudId: string;
};

/** 安全组（扁平子网 / Tower 侧） */
const SecurityGroupsSection: React.FC<Props> = ({ cloudId }) => {
  const { user } = useAuth();
  const canWrite =
    hasPermissionForAction(user?.permissions || [], 'clouds.security-groups:write') ||
    hasPermissionForAction(user?.permissions || [], 'clouds.vpcs:write') ||
    hasPermissionForAction(user?.permissions || [], 'clouds:write');

  const [keyword, setKeyword] = useState('');
  const [memberFilter, setMemberFilter] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<SecurityGroupRow[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [createSubmitting, setCreateSubmitting] = useState(false);
  const [flatSubnetOptions, setFlatSubnetOptions] = useState<any[]>([]);
  const [subnetsLoading, setSubnetsLoading] = useState(false);
  /** metadata.name → 列表/抽屉展示用「别名 / 名」 */
  const [subnetDisplayByName, setSubnetDisplayByName] = useState<Record<string, string>>({});
  const [form] = Form.useForm();
  const [editForm] = Form.useForm();
  const [editOpen, setEditOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<SecurityGroupRow | null>(null);
  const [editSubmitting, setEditSubmitting] = useState(false);

  const [rulesDrawerOpen, setRulesDrawerOpen] = useState(false);
  const [rulesDrawerDirection, setRulesDrawerDirection] = useState<SgAclDirection>('inbound');
  const [rulesTarget, setRulesTarget] = useState<SecurityGroupRow | null>(null);
  const [rulesLoading, setRulesLoading] = useState(false);
  const [accessControlSaving, setAccessControlSaving] = useState(false);
  const [rulesForm] = Form.useForm();

  const [membersPanelLoading, setMembersPanelLoading] = useState(false);
  const [membersList, setMembersList] = useState<SecurityGroupMemberRow[]>([]);
  const [membersVmOptions, setMembersVmOptions] = useState<SecurityGroupVmOptionRow[]>([]);
  const [memberTargetKeys, setMemberTargetKeys] = useState<string[]>([]);

  const refresh = useCallback(async () => {
    if (!cloudId) return;
    setLoading(true);
    try {
      const [res, resSub] = await Promise.all([
        fetchKubeOvnSecurityGroups(cloudId),
        fetchKubeOvnSubnets(cloudId, false, true).catch(() => null),
      ]);
      const items = Array.isArray(res?.data?.items) ? res.data.items : [];
      setRows(
        items.map((r: any) => ({
          id: String(r.id),
          name: String(r.name ?? ''),
          description: r.description ? String(r.description) : '',
          subnetName: String(r.subnetName ?? ''),
          ruleCount: Number(r.ruleCount) || 0,
          memberCount: Number(r.memberCount) || 0,
          updatedAt: r.updatedAt ? String(r.updatedAt) : undefined,
        })),
      );
      const subItems = Array.isArray(resSub?.data?.items) ? resSub.data.items : [];
      const displayMap: Record<string, string> = {};
      for (const item of subItems) {
        const t = String(item?.metadata?.annotations?.[SUBNET_TYPE_KEY] || '').trim().toLowerCase();
        if (t !== 'flat') continue;
        const name = String(item?.metadata?.name ?? '').trim();
        if (!name) continue;
        displayMap[name] = flatSubnetDisplayLabel(name, subnetTowerAliasFromCr(item));
      }
      setSubnetDisplayByName(displayMap);
    } catch (e: any) {
      message.error(`加载安全组失败: ${e?.message || '未知错误'}`);
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [cloudId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const loadFlatSubnetsForModal = useCallback(async () => {
    if (!cloudId) return;
    setSubnetsLoading(true);
    try {
      const res = await fetchKubeOvnSubnets(cloudId, false, true);
      const items = Array.isArray(res?.data?.items) ? res.data.items : [];
      const flat = items.filter((item: any) => {
        const t = String(item?.metadata?.annotations?.[SUBNET_TYPE_KEY] || '').trim().toLowerCase();
        return t === 'flat';
      });
      setFlatSubnetOptions(flat);
      const displayMap: Record<string, string> = {};
      for (const item of flat) {
        const name = String(item?.metadata?.name ?? '').trim();
        if (!name) continue;
        displayMap[name] = flatSubnetDisplayLabel(name, subnetTowerAliasFromCr(item));
      }
      setSubnetDisplayByName((prev) => ({ ...prev, ...displayMap }));
    } catch (e: any) {
      message.error(`加载扁平子网失败: ${e?.message || '未知错误'}`);
      setFlatSubnetOptions([]);
    } finally {
      setSubnetsLoading(false);
    }
  }, [cloudId]);

  const openCreateModal = () => {
    form.resetFields();
    setCreateOpen(true);
    loadFlatSubnetsForModal();
  };

  const submitCreate = async () => {
    if (!cloudId) return;
    try {
      const values = await form.validateFields();
      setCreateSubmitting(true);
      await createKubeOvnSecurityGroup(cloudId, {
        name: String(values.name).trim(),
        subnetName: String(values.subnetName).trim(),
        description: values.description != null && String(values.description).trim()
          ? String(values.description).trim()
          : undefined,
      });
      message.success('安全组已创建');
      setCreateOpen(false);
      form.resetFields();
      await refresh();
    } catch (e: any) {
      if (e?.errorFields) return;
      message.error(`创建失败: ${e?.message || '未知错误'}`);
    } finally {
      setCreateSubmitting(false);
    }
  };

  const loadRulesIntoForm = useCallback(
    async (record: SecurityGroupRow) => {
      if (!cloudId) return;
      setRulesLoading(true);
      try {
        const res = await fetchKubeOvnSecurityGroupDetail(cloudId, record.id);
        const rules = Array.isArray(res?.data?.rules) ? res.data.rules : [];
        const inboundRules: SubnetAclFormRow[] = [];
        const outboundRules: SubnetAclFormRow[] = [];
        for (const r of rules) {
          const row = normalizeAclRowForForm({
            action: r.action,
            direction: r.direction,
            match: r.match,
            priority: r.priority,
          }) as SubnetAclFormRow;
          delete row.direction;
          if (String(r.direction) === 'to-lport') {
            row.matchSrcIp = '';
            outboundRules.push(row);
          } else {
            row.matchDstIp = '';
            inboundRules.push(row);
          }
        }
        rulesForm.setFieldsValue({ inboundRules, outboundRules });
      } catch (e: any) {
        message.error(`加载规则失败: ${e?.message || '未知错误'}`);
        rulesForm.setFieldsValue({ inboundRules: [], outboundRules: [] });
      } finally {
        setRulesLoading(false);
      }
    },
    [cloudId, rulesForm],
  );

  const openEditModal = (record: SecurityGroupRow) => {
    setEditTarget(record);
    editForm.setFieldsValue({
      name: record.name,
      description: record.description || '',
      subnetName: record.subnetName,
    });
    setEditOpen(true);
  };

  const submitEdit = async () => {
    if (!cloudId || !editTarget) return;
    try {
      const values = await editForm.validateFields();
      setEditSubmitting(true);
      await updateKubeOvnSecurityGroup(cloudId, editTarget.id, {
        name: String(values.name).trim(),
        description:
          values.description != null && String(values.description).trim()
            ? String(values.description).trim()
            : null,
      });
      message.success('安全组已更新');
      setEditOpen(false);
      setEditTarget(null);
      editForm.resetFields();
      await refresh();
      if (rulesDrawerOpen && rulesTarget?.id === editTarget.id) {
        setRulesTarget((prev) =>
          prev
            ? {
                ...prev,
                name: String(values.name).trim(),
                description:
                  values.description != null && String(values.description).trim()
                    ? String(values.description).trim()
                    : '',
              }
            : null,
        );
      }
    } catch (e: any) {
      if (e?.errorFields) return;
      message.error(`更新失败: ${e?.message || '未知错误'}`);
    } finally {
      setEditSubmitting(false);
    }
  };

  const confirmDeleteSecurityGroup = (record: SecurityGroupRow) => {
    Modal.confirm({
      title: '删除安全组',
      content: `确定删除安全组「${record.name}」吗？其访问规则将一并删除，且不可恢复。`,
      okText: '删除',
      okType: 'danger',
      cancelText: '取消',
      onOk: async () => {
        try {
          await deleteKubeOvnSecurityGroup(cloudId, record.id);
          message.success('已删除');
          if (rulesDrawerOpen && rulesTarget?.id === record.id) {
            closeRulesDrawer();
          }
          if (editOpen && editTarget?.id === record.id) {
            setEditOpen(false);
            setEditTarget(null);
            editForm.resetFields();
          }
          await refresh();
        } catch (e: any) {
          message.error(`删除失败: ${e?.message || '未知错误'}`);
          throw e;
        }
      },
    });
  };

  const reloadMembersPanelData = useCallback(
    async (sg: SecurityGroupRow) => {
      if (!cloudId) return;
      setMembersPanelLoading(true);
      try {
        const [detailRes, ecsRes] = await Promise.all([
          fetchKubeOvnSecurityGroupDetail(cloudId, sg.id),
          fetchCloudProviderEcs(cloudId, true),
        ]);
        const rawMembers = Array.isArray(detailRes?.data?.members) ? detailRes.data.members : [];
        const vms: any[] = ecsRes?.data || ecsRes || [];
        const vmByKey = new Map<string, any>();
        for (const vm of vms) {
          const k = vmRowKey(vm);
          if (k.includes('/')) vmByKey.set(k, vm);
        }
        type RawMember = { id: string; vmNamespace: string; vmName: string; createdAt?: string };
        const mapped: SecurityGroupMemberRow[] = rawMembers
          .map((m: any) => ({
            id: String(m?.id ?? ''),
            vmNamespace: String(m?.vmNamespace ?? '').trim() || 'default',
            vmName: String(m?.vmName ?? '').trim(),
            createdAt: m?.createdAt ? String(m.createdAt) : undefined,
          }))
          .filter((m: RawMember) => Boolean(m.id && m.vmNamespace && m.vmName))
          .map((m: RawMember) => {
            const vm = resolveVmFromEcsList(m.vmNamespace, m.vmName, vmByKey, vms);
            return {
              ...m,
              vmAlias: vm ? vmVmAnnotationAlias(vm) : '',
              vmIp: vm ? harvesterVmPrimaryIp(vm) : '',
            };
          });
        setMembersList(mapped);
        setMemberTargetKeys(mapped.map((m) => `${m.vmNamespace}/${m.vmName}`));
        setRulesTarget((prev) =>
          prev && prev.id === sg.id ? { ...prev, memberCount: mapped.length } : prev,
        );
        const existing = new Set(mapped.map((m) => `${m.vmNamespace}/${m.vmName}`));
        const opts: SecurityGroupVmOptionRow[] = vms
          .filter((vm) => vmNetworkMatchesFlatSubnet(vm, sg.subnetName))
          .map((vm) => ({ vm, key: vmRowKey(vm) }))
          .filter(({ key }) => key.includes('/') && !existing.has(key))
          .map(({ vm, key }) => {
            const ns = vmKubernetesNamespace(vm);
            const nm = vmKubernetesName(vm);
            return {
              value: key,
              vmNamespace: ns,
              vmName: nm,
              alias: vmVmAnnotationAlias(vm),
              vmIp: harvesterVmPrimaryIp(vm),
            };
          })
          .sort((a, b) => `${a.vmNamespace}/${a.vmName}`.localeCompare(`${b.vmNamespace}/${b.vmName}`));
        setMembersVmOptions(opts);
      } catch (e: any) {
        message.error(`加载成员与云主机列表失败: ${e?.message || '未知错误'}`);
        setMembersList([]);
        setMembersVmOptions([]);
        setMemberTargetKeys([]);
      } finally {
        setMembersPanelLoading(false);
      }
    },
    [cloudId],
  );

  const openRulesDrawer = useCallback(
    (record: SecurityGroupRow) => {
      setRulesTarget(record);
      setRulesDrawerDirection('inbound');
      rulesForm.resetFields();
      setMembersList([]);
      setMembersVmOptions([]);
      setMemberTargetKeys([]);
      setRulesDrawerOpen(true);
      loadRulesIntoForm(record);
      void reloadMembersPanelData(record);
    },
    [loadRulesIntoForm, reloadMembersPanelData, rulesForm],
  );

  const showAclPushWarning = (res: any) => {
    const ap = res?.data?.aclPush;
    if (ap && !ap.ok) {
      message.warning(`子网 ACL 未同步：${ap.message || '未知原因'}`);
    }
  };

  const applyAccessControl = async () => {
    if (!cloudId || !rulesTarget || !canWrite) return;
    if (rulesLoading || membersPanelLoading) {
      message.warning('请等待入/出方向规则与关联云主机列表加载完成后再保存');
      return;
    }
    setAccessControlSaving(true);
    try {
      const values = await rulesForm.validateFields();
      const inboundRows = (values.inboundRules || []).map((r: SubnetAclFormRow) => ({
        ...r,
        direction: 'from-lport',
        matchDstIp: '',
      }));
      const outboundRows = (values.outboundRules || []).map((r: SubnetAclFormRow) => ({
        ...r,
        direction: 'to-lport',
        matchSrcIp: '',
      }));
      const rules = [...normalizeAclsForApi(inboundRows), ...normalizeAclsForApi(outboundRows)];
      const saveRes: any = await replaceKubeOvnSecurityGroupRules(cloudId, rulesTarget.id, { rules });
      showAclPushWarning(saveRes);

      const targetSet = new Set(memberTargetKeys);
      const currentByKey = new Map<string, SecurityGroupMemberRow>(
        membersList.map((m) => [`${m.vmNamespace}/${m.vmName}`, m]),
      );
      const toAdd = memberTargetKeys.filter((k) => !currentByKey.has(k));
      const toRemove = membersList.filter((m) => !targetSet.has(`${m.vmNamespace}/${m.vmName}`));

      if (toAdd.length > 0) {
        const items = toAdd.map((k) => {
          const i = k.indexOf('/');
          return { vmNamespace: k.slice(0, i), vmName: k.slice(i + 1) };
        });
        const addRes: any = await addKubeOvnSecurityGroupMembers(cloudId, rulesTarget.id, { items });
        showAclPushWarning(addRes);
      }
      for (const m of toRemove) {
        const delRes: any = await removeKubeOvnSecurityGroupMember(cloudId, rulesTarget.id, m.id);
        showAclPushWarning(delRes);
      }

      message.success('访问控制已保存');
      await reloadMembersPanelData(rulesTarget);
      await refresh();
    } catch (e: any) {
      if (e?.errorFields) return;
      message.error(`保存失败: ${e?.message || '未知错误'}`);
    } finally {
      setAccessControlSaving(false);
    }
  };

  const closeRulesDrawer = () => {
    setRulesDrawerOpen(false);
    setRulesDrawerDirection('inbound');
    setRulesTarget(null);
    rulesForm.resetFields();
    setMembersList([]);
    setMembersVmOptions([]);
    setMemberTargetKeys([]);
  };

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (memberFilter === 'has_members' && (r.memberCount || 0) <= 0) return false;
      if (memberFilter === 'no_members' && (r.memberCount || 0) > 0) return false;
      if (!keyword.trim()) return true;
      const k = keyword.trim().toLowerCase();
      const subShown = subnetDisplayByName[r.subnetName] ?? r.subnetName;
      return (
        r.name.toLowerCase().includes(k) ||
        r.subnetName.toLowerCase().includes(k) ||
        subShown.toLowerCase().includes(k)
      );
    });
  }, [rows, keyword, memberFilter, subnetDisplayByName]);

  const allColumns = useMemo(
    () => [
      {
        title: '名称',
        dataIndex: 'name',
        key: 'name',
        ellipsis: true,
        render: (_: string, record: SecurityGroupRow) => (
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <SafetyOutlined style={{ color: '#1677ff', fontSize: 16, flexShrink: 0 }} />
            <span className="cell-link" onClick={() => openRulesDrawer(record)}>
              {record.name}
            </span>
          </span>
        ),
      },

      {
        title: '子网',
        dataIndex: 'subnetName',
        key: 'subnetName',
        ellipsis: true,
        render: (_: string, record: SecurityGroupRow) => {
          const label = subnetDisplayByName[record.subnetName] ?? record.subnetName;
          return (
            <span title={label !== record.subnetName ? record.subnetName : undefined}>
              {label}
            </span>
          );
        },
      },
      { title: '规则数', dataIndex: 'ruleCount', key: 'ruleCount' },
      { title: '应用到云主机', dataIndex: 'memberCount', key: 'memberCount' },
      {
        title: '描述',
        dataIndex: 'description',
        key: 'description',
        ellipsis: true,
        render: (t?: string) => t || '未设置描述',
      },
      {
        title: '更新时间',
        dataIndex: 'updatedAt',
        key: 'updatedAt',
        width: 176,
        render: (t?: string) => (t ? new Date(t).toLocaleString() : '—'),
      },
      {
        title: '操作',
        key: 'actions',
        width: 80,
        fixed: 'right' as const,
        render: (_: unknown, record: SecurityGroupRow) => {
          if (!canWrite) return '—';
          const menuItems: MenuProps['items'] = [
            { key: 'edit', label: '编辑安全组', onClick: () => openEditModal(record) },
            { key: 'rules', label: '访问控制', onClick: () => openRulesDrawer(record) },
            { type: 'divider' },
            { key: 'delete', label: '删除', danger: true, onClick: () => confirmDeleteSecurityGroup(record) },
          ];
          return (
            <ResourceActionsDropdown
              items={menuItems}
              buttonProps={{ className: 'row-actions-trigger' }}
            />
          );
        },
      },
    ],
    [canWrite, openRulesDrawer, subnetDisplayByName],
  );

  const { displayColumns: tableColumns } = useTableColumnSettings(
    allColumns,
    SECURITY_GROUPS_TABLE_SETTINGS_KEY,
  );

  return (
    <div>
      <div className="page-toolbar">
        <div className="toolbar-container">
          <Input
            allowClear
            placeholder="名称/子网"
            suffix={<SearchOutlined style={{ color: 'rgba(0,0,0,.45)' }} />}
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            className="toolbar-search"
          />
          <Select
            allowClear
            placeholder="是否有成员"
            className="toolbar-filter-sm"
            value={memberFilter || undefined}
            onChange={(v) => setMemberFilter(String(v || ''))}
            options={[
              { label: '有成员', value: 'has_members' },
              { label: '无成员', value: 'no_members' },
            ]}
          />
          <a
            className="toolbar-reset-btn"
            onClick={() => {
              setKeyword('');
              setMemberFilter('');
              refresh();
            }}
          >
            重置
          </a>
        </div>
        <div className="toolbar-actions">
          {canWrite && (
            <Button type="primary" onClick={openCreateModal}>
              新建安全组
            </Button>
          )}
          <TableColumnSettingsButton
            allColumns={allColumns}
            settingsKey={SECURITY_GROUPS_TABLE_SETTINGS_KEY}
          />
          <Tooltip title="刷新列表">
            <Button icon={<ReloadOutlined />} onClick={() => refresh()} loading={loading} aria-label="刷新" />
          </Tooltip>
        </div>
      </div>

      <Table<SecurityGroupRow>
        className="std-table"
        bordered={false}
        rowKey="id"
        loading={loading}
        columns={tableColumns}
        dataSource={filtered}
        locale={{
          emptyText: (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无安全组，可点击「新建安全组」创建" />
          ),
        }}
        pagination={{ size: 'small', showTotal: (total) => `共 ${total} 条` }}
      />

      <Modal
        title="新建安全组"
        open={createOpen}
        centered
        onOk={submitCreate}
        onCancel={() => {
          setCreateOpen(false);
          form.resetFields();
        }}
        confirmLoading={createSubmitting}
        destroyOnHidden
        okText="创建"
      >
        <Form form={form} layout="vertical" className="std-form">
          <Form.Item
            name="name"
            label="名称"
            rules={[
              { required: true, message: '请输入名称' },
              { max: 128, message: '最长 128 字符' },
            ]}
          >
            <Input placeholder="安全组显示名称" autoComplete="off" />
          </Form.Item>
          <Form.Item name="subnetName" label="扁平子网" rules={[{ required: true, message: '请选择子网' }]}>
            <Select
              showSearch
              placeholder="选择 tower.io/subnet-type=flat 的子网"
              loading={subnetsLoading}
              optionFilterProp="label"
              options={flatSubnetOptions.map((s: any) => {
                const name = s?.metadata?.name ?? '';
                return {
                  value: name,
                  label: flatSubnetDisplayLabel(name, subnetTowerAliasFromCr(s)),
                };
              })}
            />
          </Form.Item>
          <Form.Item name="description" label="描述">
            <Input.TextArea rows={2} placeholder="可选" />
          </Form.Item>
          {flatSubnetOptions.length === 0 && !subnetsLoading && (
            <Paragraph type="warning" style={{ marginTop: -8 }}>
              暂无扁平子网，请创建并等待同步。
            </Paragraph>
          )}
        </Form>
      </Modal>

      <Modal
        title="编辑安全组"
        open={editOpen}
        onOk={submitEdit}
        onCancel={() => {
          setEditOpen(false);
          setEditTarget(null);
          editForm.resetFields();
        }}
        confirmLoading={editSubmitting}
        destroyOnHidden
        okText="保存"
      >
        <Form form={editForm} layout="vertical" className="std-form">
          <Form.Item
            name="name"
            label="名称"
            rules={[
              { required: true, message: '请输入名称' },
              { max: 128, message: '最长 128 字符' },
            ]}
          >
            <Input placeholder="名称" autoComplete="off" />
          </Form.Item>
          <Form.Item name="description" label="描述">
            <Input.TextArea rows={2} placeholder="可选，留空则清空描述" />
          </Form.Item>
          <Form.Item label="扁平子网" shouldUpdate>
            {() => {
              const sn = String(editForm.getFieldValue('subnetName') ?? '').trim();
              const shown = sn ? subnetDisplayByName[sn] ?? sn : '';
              return <Input disabled value={shown} readOnly />;
            }}
          </Form.Item>
        </Form>
      </Modal>

      <SecurityGroupAccessControlDrawer
        AntDrawer={Drawer}
        open={rulesDrawerOpen}
        onClose={closeRulesDrawer}
        target={
          rulesTarget
            ? {
                name: rulesTarget.name,
                subnetName: rulesTarget.subnetName,
                subnetDisplayLabel:
                  subnetDisplayByName[rulesTarget.subnetName] ?? rulesTarget.subnetName,
              }
            : null
        }
        loading={rulesLoading || membersPanelLoading}
        saving={accessControlSaving}
        onSave={applyAccessControl}
        form={rulesForm}
        readOnly={!canWrite}
        tab={rulesDrawerDirection}
        onTabChange={setRulesDrawerDirection}
        serverMemberCount={rulesTarget?.memberCount ?? 0}
        memberKeys={memberTargetKeys}
        onMemberKeysChange={setMemberTargetKeys}
        members={{ list: membersList, vmOptions: membersVmOptions }}
      />
    </div>
  );
};

export default SecurityGroupsSection;
