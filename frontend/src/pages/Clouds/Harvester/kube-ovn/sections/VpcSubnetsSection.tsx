import React, { useCallback, useMemo, useState } from 'react';
import { Button, Form, Input, message, Modal, Select, Table, Tag, Typography } from 'antd';
import { ApartmentOutlined, ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import { useParams } from 'react-router-dom';
import PageDetailSection from '../../../../../components/PageDetailSection';
import ResourceActionsDropdown from '../../../../../components/ResourceActionsDropdown';
import TableColumnSettingsButton from '../../../../../components/TableColumnSettingsButton';
import { useTableColumnSettings } from '../../../../../hooks/useTableColumnSettings';
import { fetchCloudProviderEcs } from '../../../../../services/api';
import { deleteKubeOvnSubnet, fetchKubeOvnSubnets, updateKubeOvnSubnet } from '../../../../../services/harvesterApi';
import { useAuth } from '../../../../../contexts/AuthContext';
import { CLOUD_SUBNETS_VPC_WRITE } from '../../../../../constants/cloudPermissions';
import { hasPermissionForAction } from '../../../../../utils/accessMapping';
import HarvesterResourceDrawer from '../../components/HarvesterOpsinfoDrawer';
import SubnetAclFormItems, { normalizeAclRowForForm, validateAclsFormRowsForSubmit } from '../lib/SubnetAclFormItems';
import SubnetDetailDrawer from '../drawers/subnet-detail-drawer';
import { buildBusinessVpcPickerRows, vpcDisplayMapFromVpcs } from '../lib/kubeOvnUiHelpers';
import {
  KUBE_OVN_PUBLIC_VPC,
  SUBNET_TYPE_ANNOTATION_KEY,
  TOWER_ALIAS_ANNOTATION,
  isBuiltInKubeOvnVpc,
} from '../lib/kubeOvnSubnetConstants';
import CreateVpcSubnetModal from '../modals/CreateVpcSubnetModal';

/**
 * =============================================================================
 * VPC 子网（Kube-OVN Subnet + tower.io/subnet-type=vpc）
 * =============================================================================
 *
 * 与 NAD、扁平/公共子网的区别：
 *
 * - 【NAD】Multus 网络定义，描述「网卡怎么接」（见 NadsSection）。Kube-OVN 子网创建流程里会建同名 NAD。
 * - 【扁平子网 / 公共子网】见 UnderlaySubnetsSection（flat→ovn-internal，public→ovn-cluster）。
 * - 【VPC 子网】本页：挂在业务 VPC 下的隔离网段，须选择非内置 VPC；用于租户内虚拟机网络。
 *
 * 列表仅展示 subnet-type=vpc，避免与扁平/公共子网列表混淆。
 *
 * 交互与 UnderlaySubnetsSection 对齐：业务 VPC 下拉、表格列、详情抽屉；协议固定 IPv4。
 * ACL 单独弹窗编辑（与「新建/编辑 VPC 子网」网段弹窗分离），见 openAclEditor。
 * =============================================================================
 */

type Props = {
  subnets: any[];
  vpcList?: any[];
  loading: boolean;
  onRefresh?: (force?: boolean) => void;
  onRefreshNads?: (force?: boolean, silent?: boolean) => void;
  showYaml?: boolean;
  /** 与 UnderlaySubnetsSection 一致：标准视图隐藏 ACL 列与「编辑 ACL」入口 */
  displayMode?: 'standard' | 'ops';
};

const TOWER_VM_ALIAS = TOWER_ALIAS_ANNOTATION;

function isVpcSubnetRecord(r: any): boolean {
  const t = String(r?.metadata?.annotations?.[SUBNET_TYPE_ANNOTATION_KEY] || '')
    .trim()
    .toLowerCase();
  return t === 'vpc';
}

/** 根据 networks 引用匹配占用某子网 CR 名的虚拟机展示名列表 */
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
        vm?.metadata?.annotations?.[TOWER_VM_ALIAS] ||
        vm.InstanceName ||
        vm.name ||
        vm.metadata?.name,
    )
    .filter(Boolean) as string[];
}

const VpcSubnetsSection: React.FC<Props> = ({
  subnets,
  vpcList = [],
  loading,
  onRefresh,
  onRefreshNads,
  showYaml = true,
  displayMode = 'ops',
}) => {
  const { user } = useAuth();
  const perms = useMemo(() => (user?.permissions ?? []) as string[], [user?.permissions]);
  const hasVpcsWrite = useMemo(
    () =>
      hasPermissionForAction(perms, CLOUD_SUBNETS_VPC_WRITE) ||
      hasPermissionForAction(perms, 'clouds.subnets:write') ||
      hasPermissionForAction(perms, 'clouds.vpcs:write') ||
      hasPermissionForAction(perms, 'clouds:write'),
    [perms],
  );
  const { id: cloudId } = useParams<{ id: string }>();
  const isStandardView = displayMode === 'standard';

  const [keyword, setKeyword] = useState('');
  const [vpc, setVpc] = useState<string | undefined>(undefined);
  const [nat, setNat] = useState<string | undefined>(undefined);
  const [dhcp, setDhcp] = useState<string | undefined>(undefined);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isEditMode, setIsEditMode] = useState(false);
  const [currentSubnet, setCurrentSubnet] = useState<any>(null);

  const [aclModalVisible, setAclModalVisible] = useState(false);
  const [aclSubnetName, setAclSubnetName] = useState<string | null>(null);
  const [aclSubmitting, setAclSubmitting] = useState(false);
  const [aclForm] = Form.useForm();

  const [drawerVisible, setDrawerVisible] = useState(false);
  const [currentDrawerResource, setCurrentDrawerResource] = useState<any>(null);
  const [drawerTab, setDrawerTab] = useState('detail');
  const [detailDrawerOpen, setDetailDrawerOpen] = useState(false);
  const [detailSubnetRecord, setDetailSubnetRecord] = useState<any>(null);

  const vpcPickerRows = useMemo(() => buildBusinessVpcPickerRows(vpcList), [vpcList]);
  const vpcDisplayMap = useMemo(() => vpcDisplayMapFromVpcs(vpcList), [vpcList]);
  const vpcNsById = useMemo(() => {
    const m: Record<string, string> = {};
    for (const r of vpcPickerRows) {
      m[r.id] = r.namespacesDisplay;
    }
    return m;
  }, [vpcPickerRows]);

  const vpcToolbarOptions = useMemo(() => {
    const set = new Set<string>();
    for (const s of subnets || []) {
      const v = String(s?.vpc || s?.spec?.vpc || KUBE_OVN_PUBLIC_VPC).trim();
      if (v && !isBuiltInKubeOvnVpc(v)) set.add(v);
    }
    return Array.from(set).map((id) => ({
      label: vpcDisplayMap.get(id) || id,
      value: id,
    }));
  }, [subnets, vpcDisplayMap]);

  const filtered = useMemo(() => {
    const kw = String(keyword || '')
      .toLowerCase()
      .trim();
    return (subnets || []).filter((r: any) => {
      if (!isVpcSubnetRecord(r)) return false;
      const vpcVal = String(r?.vpc || r?.spec?.vpc || KUBE_OVN_PUBLIC_VPC);
      const name = String(r?.name || r?.metadata?.name || '').toLowerCase();
      const cidr = String(r?.cidr || r?.cidrBlock || r?.spec?.cidrBlock || r?.spec?.cidr || '').toLowerCase();
      const alias = String(r?.metadata?.annotations?.[TOWER_ALIAS_ANNOTATION] || '').toLowerCase();
      if (kw && !name.includes(kw) && !cidr.includes(kw) && !vpcVal.toLowerCase().includes(kw) && !alias.includes(kw)) {
        return false;
      }
      if (vpc && vpcVal !== vpc) return false;
      if (nat) {
        const isNat = r?.nat ?? r?.spec?.natOutgoing ?? false;
        if ((isNat ? 'on' : 'off') !== nat) return false;
      }
      if (dhcp) {
        const isDhcp = r?.allowDhcp ?? r?.spec?.enableDHCP ?? r?.spec?.enableDhcp ?? true;
        if ((isDhcp ? 'on' : 'off') !== dhcp) return false;
      }
      return true;
    });
  }, [subnets, keyword, vpc, nat, dhcp]);

  const openCreateVpcSubnetModal = useCallback(() => {
    if (!hasVpcsWrite) return;
    setIsEditMode(false);
    setCurrentSubnet(null);
    setIsModalOpen(true);
  }, [hasVpcsWrite]);

  const openDetailDrawer = useCallback((record: any) => {
    setDetailSubnetRecord(record);
    setDetailDrawerOpen(true);
  }, []);

  const resyncAclFormFromCluster = useCallback(
    async (subnetName: string) => {
      if (!cloudId) return;
      try {
        const res = await fetchKubeOvnSubnets(cloudId, true, false);
        const items: any[] = (res as any)?.data?.items || [];
        const rec = items.find((x: any) => String(x?.metadata?.name || x?.name || '').trim() === subnetName);
        if (!rec) return;
        const spec = rec.spec || {};
        aclForm.setFieldsValue({
          acls: Array.isArray(spec.acls) ? spec.acls.map((a: any) => normalizeAclRowForForm({ ...a })) : [],
        });
      } catch {
        /* ignore */
      }
    },
    [aclForm, cloudId],
  );

  const openAclEditor = useCallback(
    (record: any) => {
      const name = String(record?.metadata?.name || record?.name || '').trim();
      if (!name) return;
      const spec = record?.spec || {};
      setAclSubnetName(name);
      aclForm.setFieldsValue({
        acls: Array.isArray(spec.acls) ? spec.acls.map((a: any) => normalizeAclRowForForm({ ...a })) : [],
      });
      setAclModalVisible(true);
    },
    [aclForm],
  );

  const handleAclFinish = useCallback(
    async (values: any) => {
      if (!hasVpcsWrite) {
        message.error('无权限执行该操作');
        return;
      }
      if (!aclSubnetName || !cloudId) return;

      const patchBody: Record<string, unknown> = {};
      if (Array.isArray(values.acls)) {
        const aclCheck = validateAclsFormRowsForSubmit(values.acls);
        if (!aclCheck.ok) {
          message.error(aclCheck.message);
          return;
        }
        patchBody.acls = aclCheck.normalized;
      }

      try {
        setAclSubmitting(true);
        await updateKubeOvnSubnet(cloudId, aclSubnetName, patchBody);
        message.success('ACL 已更新');
        setAclModalVisible(false);
        setAclSubnetName(null);
        aclForm.resetFields();
        onRefresh?.(true);
        onRefreshNads?.(true, true);
      } catch (e: any) {
        console.error(e);
        if (e?.errorFields) throw e;
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
    },
    [aclForm, aclSubnetName, cloudId, hasVpcsWrite, onRefresh, onRefreshNads, resyncAclFormFromCluster],
  );

  const handleShowYaml = useCallback((record: any) => {
    setCurrentDrawerResource(record);
    setDrawerTab(record?.links?.view ? 'view_link' : 'detail');
    setDrawerVisible(true);
  }, []);

  const handleEdit = useCallback(
    (record: any) => {
      if (!hasVpcsWrite) {
        message.error('无权限执行该操作');
        return;
      }
      const vpcVal = record.vpc || record.spec?.vpc;
      if (isBuiltInKubeOvnVpc(vpcVal)) {
        message.error('该子网属于扁平或公共内置 VPC，请在「扁平子网 / 公共子网」入口编辑');
        return;
      }
      setIsEditMode(true);
      setCurrentSubnet(record);
      setIsModalOpen(true);
    },
    [hasVpcsWrite],
  );

  const handleDelete = useCallback(
    async (name: string) => {
      if (!hasVpcsWrite) {
        message.error('无权限执行该操作');
        return;
      }
      let usingVms: string[] = [];
      try {
        const ecsRes = await fetchCloudProviderEcs(cloudId!, true);
        const vms: any[] = ecsRes?.data || ecsRes || [];
        usingVms = collectVmDisplayNamesUsingSubnet(name, vms);
      } catch {
        /* 占用检测失败时不阻塞删除确认框 */
      }

      const blocked = usingVms.length > 0;

      Modal.confirm({
        title: '确认删除',
        content: (
          <>
            <div>{`确定要删除子网 ${name} 吗？此操作不可恢复。`}</div>
            {blocked && (
              <div style={{ color: '#ff4d4f', marginTop: 8 }}>
                {`无法删除子网，此子网正在被虚拟机使用 ${usingVms.slice(0, 5).join('、')}${usingVms.length > 5 ? ' 等' : ''}`}
              </div>
            )}
          </>
        ),
        okType: 'danger',
        okButtonProps: { disabled: blocked },
        onOk: blocked
          ? undefined
          : async () => {
              try {
                await deleteKubeOvnSubnet(cloudId!, name);
                message.success('删除成功');
                onRefresh?.(true);
                onRefreshNads?.(true, true);
              } catch (e: any) {
                const msg = e?.response?.data || e?.message || '未知错误';
                message.error(`删除失败: ${typeof msg === 'object' ? (msg.message || JSON.stringify(msg)) : msg}`);
              }
            },
      });
    },
    [cloudId, hasVpcsWrite, onRefresh, onRefreshNads],
  );

  const allColumns = useMemo(
    () => [
      {
        title: '名称',
        key: 'subnetAlias',
        ellipsis: true,
        render: (_: any, r: any) => {
          const id = String(r?.name || r?.metadata?.name || '').trim();
          const alias = String(r?.metadata?.annotations?.[TOWER_ALIAS_ANNOTATION] ?? '').trim();
          const display = alias || id || '—';
          const nameInner = (
            <>
              <ApartmentOutlined style={{ color: '#1677ff' }} />
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>{display}</span>
            </>
          );
          return (
            <span
              title={alias || id || undefined}
              style={{ display: 'flex', alignItems: 'center', maxWidth: '100%', minWidth: 0, gap: 6 }}
            >
              <Typography.Link
                onClick={(e) => {
                  e.preventDefault();
                  openDetailDrawer(r);
                }}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6, maxWidth: '100%', minWidth: 0 }}
              >
                {nameInner}
              </Typography.Link>
            </span>
          );
        },
      },
      {
        title: 'ID',
        key: 'subnetResourceId',
        ellipsis: true,
        render: (_: any, r: any) => {
          const id = String(r?.name || r?.metadata?.name || '').trim() || '—';
          return <span title={id}>{id}</span>;
        },
      },
      {
        title: 'CIDR',
        key: 'cidr',
        render: (_: any, r: any) => (
          <span>{r?.cidr || r?.cidrBlock || r?.spec?.cidrBlock || r?.spec?.cidr || '-'}</span>
        ),
      },
      {
        title: 'VPC',
        key: 'vpc',
        ellipsis: true,
        render: (_: any, r: any) => {
          const id = String(r?.vpc || r?.spec?.vpc || KUBE_OVN_PUBLIC_VPC).trim();
          const shown = vpcDisplayMap.get(id) || id || KUBE_OVN_PUBLIC_VPC;
          return <span title={shown}>{shown}</span>;
        },
      },
      {
        title: '命名空间',
        key: 'namespace',
        ellipsis: true,
        render: (_: any, r: any) => {
          const vpcName = String(r?.vpc || r?.spec?.vpc || '').trim();
          const nsFromVpc = vpcNsById[vpcName];
          const nsFromSubnet = String(r?.metadata?.namespace ?? '').trim();
          const shown = nsFromVpc && nsFromVpc !== '-' ? nsFromVpc : nsFromSubnet || '—';
          return <span title={shown}>{shown}</span>;
        },
      },
      {
        title: '网关',
        key: 'gateway',
        render: (_: any, r: any) => <span>{r?.gateway || r?.spec?.gateway || '-'}</span>,
      },
      {
        title: 'NAT',
        key: 'nat',
        render: (_: any, r: any) => {
          const isOpen = r?.nat ?? r?.spec?.natOutgoing ?? false;
          return isOpen ? <Tag color="green">开启</Tag> : <Tag>关闭</Tag>;
        },
      },
      {
        title: 'DHCP',
        key: 'dhcp',
        render: (_: any, r: any) => {
          const isOpen = r?.allowDhcp ?? r?.spec?.enableDHCP ?? r?.spec?.enableDhcp ?? true;
          return isOpen ? <Tag color="green">启用</Tag> : <Tag>关闭</Tag>;
        },
      },
      {
        title: '已用 / 总数',
        key: 'usage',
        render: (_: any, record: any) => {
          const st = record.status || {};
          const available =
            Number(
              st.v4AvailableIPs ?? st.v4availableIPs ?? st.availableIPs ?? st.availableIps ?? 0,
            ) || 0;
          const used = Number(st.v4UsingIPs ?? st.v4usingIPs ?? st.usingIPs ?? st.usingIps ?? 0) || 0;
          const total = Math.max(available + used, 0);
          return (
            <span title={`已用 ${used}（总数 ${total}，可用 ${available}）`}>
              {used} / {total}
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
                if (!hasVpcsWrite) return <span>{n} 条</span>;
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
        key: 'actions',
        fixed: 'right' as const,
        width: 80,
        render: (_: any, r: any) => {
          const name = r?.name || r?.metadata?.name;
          return (
            <ResourceActionsDropdown
              items={[
                ...(showYaml ? [{ key: 'view_yaml', label: '查看YAML', onClick: () => handleShowYaml(r) }] : []),
                {
                  key: 'edit',
                  label: '编辑',
                  disabled: !hasVpcsWrite,
                  onClick: () => handleEdit(r),
                },
                ...(!isStandardView
                  ? [
                      {
                        key: 'edit_acl',
                        label: '编辑 ACL',
                        disabled: !hasVpcsWrite,
                        onClick: () => openAclEditor(r),
                      },
                    ]
                  : []),
                { type: 'divider' },
                {
                  key: 'delete',
                  label: '删除',
                  danger: true,
                  disabled: !hasVpcsWrite,
                  onClick: () => void handleDelete(name),
                },
              ]}
              buttonProps={{ className: 'row-actions-trigger', disabled: !hasVpcsWrite }}
            />
          );
        },
      },
    ],
    [
      showYaml,
      hasVpcsWrite,
      isStandardView,
      vpcDisplayMap,
      vpcNsById,
      openDetailDrawer,
      openAclEditor,
      handleDelete,
      handleEdit,
      handleShowYaml,
    ],
  );

  const { displayColumns: tableColumns } = useTableColumnSettings(allColumns, 'harvester_subnets_table');

  return (
    <PageDetailSection
      toolbarLeft={
        <>
          <Input
            allowClear
            placeholder="名称/ID"
            value={keyword}
            suffix={<SearchOutlined style={{ color: 'rgba(0,0,0,.45)' }} />}
            onChange={(e) => setKeyword(e.target.value)}
            className="toolbar-search"
          />
          <Select
            allowClear
            placeholder="VPC"
            options={vpcToolbarOptions}
            value={vpc}
            onChange={(v) => setVpc(v)}
            className="toolbar-filter-sm"
          />
          <Select
            allowClear
            placeholder="NAT"
            options={[
              { label: '启用', value: 'on' },
              { label: '关闭', value: 'off' },
            ]}
            value={nat}
            onChange={(v) => setNat(v)}
            className="toolbar-filter-sm"
          />
          <Select
            allowClear
            placeholder="DHCP"
            options={[
              { label: '启用', value: 'on' },
              { label: '关闭', value: 'off' },
            ]}
            value={dhcp}
            onChange={(v) => setDhcp(v)}
            className="toolbar-filter-sm"
          />
          <button
            type="button"
            className="toolbar-reset-btn"
            onClick={() => {
              setKeyword('');
              setVpc(undefined);
              setNat(undefined);
              setDhcp(undefined);
            }}
          >
            重置
          </button>
        </>
      }
      toolbarRight={
        <>
          <Button type="primary" disabled={!hasVpcsWrite} onClick={openCreateVpcSubnetModal}>
            新建 VPC 子网
          </Button>
          <TableColumnSettingsButton allColumns={allColumns} settingsKey="harvester_subnets_table" />
          <Button icon={<ReloadOutlined />} onClick={() => onRefresh?.(true)} />
        </>
      }
    >
      <Table
        className="std-table"
        bordered={false}
        rowKey={(r: any) => r?.name || r?.metadata?.name || String(r?.metadata?.uid || '')}
        columns={tableColumns}
        dataSource={filtered}
        loading={loading}
        scroll={{ x: 'max-content' }}
        pagination={{
          size: 'small',
          showTotal: (total) => `共 ${total} 条`,
        }}
      />

      <HarvesterResourceDrawer
        resourceType="Subnet"
        record={currentDrawerResource}
        open={drawerVisible}
        onClose={() => setDrawerVisible(false)}
        activeTab={drawerTab}
        onTabChange={setDrawerTab}
        cloudId={cloudId}
      />

      {cloudId ? (
        <SubnetDetailDrawer
          open={detailDrawerOpen}
          onClose={() => {
            setDetailDrawerOpen(false);
            setDetailSubnetRecord(null);
          }}
          cloudId={cloudId}
          subnet={detailSubnetRecord}
          kindLabel="VPC 子网"
          onSubnetAclSaved={() => {
            onRefresh?.(true);
            onRefreshNads?.(true, true);
          }}
        />
      ) : null}

      <CreateVpcSubnetModal
        open={isModalOpen}
        onClose={() => {
          setIsModalOpen(false);
          setIsEditMode(false);
          setCurrentSubnet(null);
        }}
        isEditMode={isEditMode}
        editingRecord={currentSubnet}
        cloudId={cloudId}
        hasVpcsWrite={hasVpcsWrite}
        vpcPickerRows={vpcPickerRows}
        subnets={subnets}
        onRefresh={onRefresh}
        onRefreshNads={onRefreshNads}
      />

      <Modal
        title="编辑 ACL规则"
        open={aclModalVisible}
        centered
        width={1100}
        onOk={() => aclForm.submit()}
        onCancel={() => {
          setAclModalVisible(false);
          setAclSubnetName(null);
          aclForm.resetFields();
        }}
        confirmLoading={aclSubmitting}
        destroyOnHidden
        okButtonProps={{ disabled: !hasVpcsWrite }}
      >
        <Form form={aclForm} layout="vertical" onFinish={handleAclFinish} className="std-form">
          <SubnetAclFormItems />
        </Form>
      </Modal>
    </PageDetailSection>
  );
};

export default VpcSubnetsSection;
