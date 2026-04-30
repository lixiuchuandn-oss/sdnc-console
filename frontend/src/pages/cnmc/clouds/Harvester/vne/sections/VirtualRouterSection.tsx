/**
 * 虚拟网元 — 虚拟路由器实例列表（布局与 `cloud-database/sections/PaasSection` 对齐：工具栏 + 表格）。
 * 成员 VM：`tower.io/paas-category=vne` 或旧 `tower.io/vne-router=true`（与云数据库列表同一套 `paas-*` 键名）。
 */
import React, { useCallback, useMemo, useState } from 'react';
import { Table, Button, Tag, Badge, Input, Select, message, Typography, Tooltip } from 'antd';
import Icon, { ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import { ReactComponent as VirtualRouterSvg } from '../../../../../../assets/OS/virtual-router.svg';
import PageDetailSection from '../../../../../../components/PageDetailSection';
import ResourceActionsDropdown from '../../../../../../components/ResourceActionsDropdown';
import { useAuth } from '../../../../../../contexts/AuthContext';
import { hasPermissionForAction } from '../../../../../../utils/accessMapping';
import VirtualRouterCreateModal from '../modals/VirtualRouterCreateModal';
import RdsInstanceLabelEditModal from '../../cloud-database/modals/RdsInstanceLabelEditModal';
import RdsDatabaseConsoleModal, {
  buildRdsDatabaseConsoleUrl,
} from '../../cloud-database/modals/RdsDatabaseConsoleModal';
import { isTowerPaasVneVm } from '../../shared/harvesterTowerPaas';
import HarvesterCrdMetadataDrawer from '../../shared/components/HarvesterCrdMetadataDrawer';
import HarvesterVmDetailDrawer from '../../shared/components/HarvesterVmDetailDrawer';

type Props = {
  vms: any[];
  loading: boolean;
  cloudId: string;
  onRefresh: (force?: boolean) => void;
  onForceRefresh?: () => void | Promise<void>;
  isTenant?: boolean;
  images?: any[];
  storageClasses?: any[];
  kubeSubnets?: any[];
  harvesterNads?: any[];
  onReloadImages?: () => void | Promise<void>;
  onReloadSubnets?: () => void | Promise<void>;
  onReloadNads?: () => void | Promise<void>;
  onReloadStorageClasses?: () => void | Promise<void>;
  namespacesOptions?: string[];
  namespaceRecords?: any[];
  clusterCapabilities?: any;
};

/** 与镜像标签 `tower.io/paas-type`、旧 `tower.io/vne-type` 展示一致 */
const VNE_PAAS_TYPE_LABELS: Record<string, string> = {
  router: '虚拟路由器',
};

/** 与 `PaasSection` / `VmSection` 一致；Harvester 实例详情为 `namespace/name` */
function getVmInstancePathId(r: any): string {
  if (r?.metadata?.name && r?.metadata?.namespace) {
    return `${r.metadata.namespace}/${r.metadata.name}`;
  }
  return String(r?.InstanceId || r?.id || '');
}

const SafeRead = {
  name: (r: any) => r?.metadata?.annotations?.['tower.io/alias'] || r?.name || r?.metadata?.name || '',
  status: (r: any) => {
    const vmi = r?.vmi || r?.vmiRaw;
    const migrationState = vmi?.status?.migrationState;
    const migrationAnnotation =
      r?.vmi?.metadata?.annotations?.['harvesterhci.io/migrationState'] ||
      r?.metadata?.annotations?.['harvesterhci.io/migrationState'];
    if (migrationState) {
      const isCompleted = migrationState.completed === true || migrationState.Completed === true;
      if (!isCompleted) return 'Migrating';
    } else if (migrationAnnotation) {
      return 'Migrating';
    }
    if (typeof r?.status === 'string') return r.status;
    return r?.status?.printableStatus || r?.status?.phase || r?.Status || 'Unknown';
  },
  node: (r: any) => r?.nodeName || r?.vmi?.status?.nodeName || r?.status?.nodeName || '',
  cpu: (r: any) => {
    const cpu = r?.spec?.template?.spec?.domain?.cpu;
    if (cpu?.sockets !== undefined && cpu?.cores !== undefined && cpu?.threads !== undefined) {
      return Number(cpu.sockets) * Number(cpu.cores) * Number(cpu.threads);
    }
    if (cpu?.sockets !== undefined && cpu?.cores !== undefined) {
      return Number(cpu.sockets) * Number(cpu.cores) * (cpu?.threads || 1);
    }
    if (r?.cpu !== undefined && r?.cpu !== null) return Number(r.cpu);
    return cpu?.cores || cpu?.sockets || r?.vmi?.spec?.domain?.cpu?.cores || r?.spec?.template?.spec?.domain?.resources?.requests?.cpu || '';
  },
  memory: (r: any) =>
    r?.spec?.template?.spec?.domain?.memory?.guest ||
    r?.spec?.template?.spec?.domain?.resources?.limits?.memory ||
    r?.spec?.template?.spec?.domain?.resources?.requests?.memory ||
    r?.memoryGb ||
    r?.vmi?.spec?.domain?.memory?.guest ||
    '',
  creationTimestamp: (r: any) => r?.metadata?.creationTimestamp || '',
  /** 新 `paas-type` 或旧 `vne-type`；无则与列表约定一致按 router 兼容 */
  paasTypeKey: (r: any) => {
    const t = String(r?.metadata?.labels?.['tower.io/paas-type'] || '').trim().toLowerCase();
    const legacy = String(r?.metadata?.labels?.['tower.io/vne-type'] || '').trim().toLowerCase();
    return t || legacy || 'router';
  },
  paasTypeLabel: (r: any) => {
    const key = SafeRead.paasTypeKey(r);
    return VNE_PAAS_TYPE_LABELS[key] || key.replace(/^\w/, (c) => c.toUpperCase());
  },
  paasVer: (r: any) => String(r?.metadata?.labels?.['tower.io/paas-ver'] || '').trim(),
  ip: (r: any) => {
    if (Array.isArray(r?.ips) && r.ips.length > 0) return r.ips.join(', ');
    try {
      const annot = r?.metadata?.annotations?.['network.harvesterhci.io/ips'];
      if (annot) {
        const arr = JSON.parse(annot);
        if (Array.isArray(arr) && arr.length > 0) return arr.join(', ');
      }
      if (r?.vmi?.status?.interfaces) {
        const ips = r.vmi.status.interfaces
          .flatMap((i: any) => i.ipAddress || i.ipAddresses || [])
          .filter(Boolean);
        if (ips.length > 0) return ips.join(', ');
      }
      if (r?.status?.interfaces && r.status.interfaces.length > 0) {
        const ips = r.status.interfaces
          .flatMap((i: any) => i.ipAddress || i.ipAddresses || [])
          .filter(Boolean);
        if (ips.length > 0) return ips.join(', ');
      }
    } catch {
      /* ignore */
    }
    return '';
  },
};

/** 与 RDS 管理台一致：`http://{主网卡IP}:3000/`；无 VMI 主网卡时退化为列表「IP地址」列首段 */
const VROUTER_CONSOLE_PORT = 3000;
function buildVrouterConsoleUrl(r: any): string {
  const primary = buildRdsDatabaseConsoleUrl(r, VROUTER_CONSOLE_PORT);
  if (primary) return primary;
  const first = String(SafeRead.ip(r) || '')
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .find(Boolean);
  if (!first) return '';
  return `http://${first}:${VROUTER_CONSOLE_PORT}/`;
}

const SECTION_TITLE = '虚拟路由器';

const VirtualRouterSection: React.FC<Props> = ({
  vms,
  loading,
  cloudId,
  onRefresh,
  onForceRefresh,
  isTenant = false,
  images = [],
  storageClasses = [],
  kubeSubnets = [],
  harvesterNads = [],
  onReloadImages,
  onReloadSubnets,
  onReloadNads,
  onReloadStorageClasses,
  namespacesOptions = [],
  namespaceRecords = [],
  clusterCapabilities,
}) => {
  const { user } = useAuth();
  const canEditPaasVmLabels = useMemo(() => {
    const perms = (user?.permissions ?? []) as string[];
    return (
      hasPermissionForAction(perms, 'clouds.ecs:write') ||
      hasPermissionForAction(perms, 'clouds:write') ||
      hasPermissionForAction(perms, 'clouds.console:write')
    );
  }, [user?.permissions]);

  const [keyword, setKeyword] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [nodeFilter, setNodeFilter] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [createModalVisible, setCreateModalVisible] = useState(false);
  const [labelEditOpen, setLabelEditOpen] = useState(false);
  const [labelEditRecord, setLabelEditRecord] = useState<any>(null);
  const [vrConsoleVm, setVrConsoleVm] = useState<any | null>(null);
  const [vmDetailDrawerOpen, setVmDetailDrawerOpen] = useState(false);
  const [vmDetailRecordSnapshot, setVmDetailRecordSnapshot] = useState<any>(null);
  const [vmDetailActiveTab, setVmDetailActiveTab] = useState('detail');
  const [yamlDrawerVisible, setYamlDrawerVisible] = useState(false);
  const [yamlDrawerRecordSnapshot, setYamlDrawerRecordSnapshot] = useState<any>(null);

  const routerInstances = useMemo(
    () => (vms || []).filter((vm) => isTowerPaasVneVm(vm)),
    [vms],
  );

  const nodesOptions = useMemo(() => {
    const s = new Set<string>();
    routerInstances.forEach((r: any) => {
      const n = SafeRead.node(r);
      if (n) s.add(n);
    });
    return Array.from(s).sort();
  }, [routerInstances]);

  const filteredInstances = useMemo(() => {
    return routerInstances.filter((r) => {
      const name = SafeRead.name(r).toLowerCase();
      const status = SafeRead.status(r).toLowerCase();
      const node = SafeRead.node(r).toLowerCase();
      if (keyword && !name.includes(keyword.toLowerCase())) return false;
      if (statusFilter && status !== statusFilter.toLowerCase()) return false;
      if (nodeFilter && node !== nodeFilter.toLowerCase()) return false;
      return true;
    });
  }, [routerInstances, keyword, statusFilter, nodeFilter]);

  /** 抽屉内与列表刷新后对齐同一条 VM（与 RecycleBinSection 一致） */
  const yamlDrawerRecord = useMemo(() => {
    if (!yamlDrawerRecordSnapshot) return null;
    const uid = yamlDrawerRecordSnapshot?.metadata?.uid;
    if (uid) {
      const found = filteredInstances.find((v: any) => v?.metadata?.uid === uid);
      return found || yamlDrawerRecordSnapshot;
    }
    return yamlDrawerRecordSnapshot;
  }, [filteredInstances, yamlDrawerRecordSnapshot]);

  const vmDetailRecord = useMemo(() => {
    if (!vmDetailRecordSnapshot) return null;
    const uid = vmDetailRecordSnapshot?.metadata?.uid;
    if (uid) {
      const found = filteredInstances.find((v: any) => v?.metadata?.uid === uid);
      return found || vmDetailRecordSnapshot;
    }
    return vmDetailRecordSnapshot;
  }, [filteredInstances, vmDetailRecordSnapshot]);

  const openVmDetailDrawer = useCallback((record: any) => {
    setVmDetailRecordSnapshot(record);
    setVmDetailActiveTab('detail');
    setVmDetailDrawerOpen(true);
  }, []);

  const openYamlDrawer = useCallback((record: any) => {
    setYamlDrawerRecordSnapshot(record);
    setYamlDrawerVisible(true);
  }, []);

  const columns = useMemo(
    () => [
      {
        title: '实例名称',
        key: 'name',
        fixed: 'left' as const,
        render: (_: any, r: any) => {
          const text = SafeRead.name(r) || '-';
          return (
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <Icon component={VirtualRouterSvg} style={{ color: '#1677ff', fontSize: 16 }} />
              {text === '-' ? (
                <span>{text}</span>
              ) : (
                <Typography.Link
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    openVmDetailDrawer(r);
                  }}
                >
                  {text}
                </Typography.Link>
              )}
            </span>
          );
        },
      },
      {
        title: '网元类型',
        key: 'paasType',
        render: (_: any, r: any) => {
          const label = SafeRead.paasTypeLabel(r);
          return <Tag color="processing">{label}</Tag>;
        },
      },
      {
        title: '版本',
        key: 'paasVer',
        render: (_: any, r: any) => {
          const v = SafeRead.paasVer(r);
          return v ? <Tag color="default">{v}</Tag> : '-';
        },
      },
      {
        title: '状态',
        key: 'status',
        render: (_: any, r: any) => {
          const s = String(SafeRead.status(r));
          const k = s.toLowerCase();
          let statusColor = 'default';
          if (k === 'running') statusColor = 'success';
          else if (k === 'starting' || k === 'migrating') statusColor = 'processing';
          else if (k === 'stopping' || k === 'terminating') statusColor = 'warning';
          else if (k === 'error' || k === 'errorunschedulable') statusColor = 'error';
          return <Badge status={statusColor as any} text={s} />;
        },
      },
      {
        title: 'IP地址',
        key: 'ip',
        ellipsis: true,
        render: (_: any, r: any) => {
          const ip = SafeRead.ip(r);
          return ip ? (
            <Tooltip title={ip}>
              <div
                style={{
                  maxWidth: 210,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {ip}
              </div>
            </Tooltip>
          ) : (
            '-'
          );
        },
      },
      {
        title: '管理地址',
        key: 'consoleUrl',
        ellipsis: true,
        render: (_: any, r: any) => {
          const url = buildVrouterConsoleUrl(r);
          return url ? (
            <Tooltip title={url}>
              <Typography.Link href={url} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}>
                <span
                  style={{
                    maxWidth: 260,
                    display: 'inline-block',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    verticalAlign: 'bottom',
                  }}
                >
                  {url}
                </span>
              </Typography.Link>
            </Tooltip>
          ) : (
            '-'
          );
        },
      },
      {
        title: '节点',
        key: 'node',
        render: (_: any, r: any) => {
          const node = String(SafeRead.node(r)).trim();
          return node ? <Tag color="blue">{node}</Tag> : '-';
        },
      },
      {
        title: 'CPU',
        key: 'cpu',
        render: (_: any, r: any) => {
          const v = SafeRead.cpu(r);
          return v ? `${v} C` : '-';
        },
      },
      {
        title: '内存',
        key: 'memory',
        render: (_: any, r: any) => SafeRead.memory(r) || '-',
      },
      {
        title: '创建时间',
        key: 'created',
        render: (_: any, r: any) => {
          const t = SafeRead.creationTimestamp(r);
          return t ? new Date(t).toLocaleString() : '-';
        },
      },
      {
        title: '操作',
        key: 'actions',
        fixed: 'right' as const,
        render: (_: any, r: any) => {
          const iid = getVmInstancePathId(r);
          const href =
            cloudId && iid && iid.includes('/')
              ? `/admin/clouds/${encodeURIComponent(cloudId)}/instances/${encodeURIComponent(iid)}`
              : '';
          const items = [
            {
              key: 'vrConsole',
              label: '管理台',
              disabled: !buildVrouterConsoleUrl(r),
              onClick: () => setVrConsoleVm(r),
            },
            {
              key: 'openInstance',
              label: '云主机详情',
              disabled: !href,
              onClick: () => {
                if (href) window.open(href, '_blank', 'noopener,noreferrer');
              },
            },
            {
              key: 'editLabels',
              label: '编辑标签',
              disabled: !canEditPaasVmLabels,
              onClick: () => {
                setLabelEditRecord(r);
                setLabelEditOpen(true);
              },
            },
            { type: 'divider' as const, key: 'div-yaml' },
            {
              key: 'yamlManifest',
              label: '查看YAML',
              onClick: () => openYamlDrawer(r),
            },
          ];
          return (
            <ResourceActionsDropdown
              items={items}
              buttonProps={{ className: 'row-actions-trigger', style: { margin: 0 } }}
            />
          );
        },
      },
    ],
    [canEditPaasVmLabels, cloudId, openVmDetailDrawer, openYamlDrawer],
  );

  const handleOpenCreateModal = () => {
    Promise.resolve(onReloadImages?.()).catch(() => undefined);
    Promise.resolve(onReloadSubnets?.()).catch(() => undefined);
    Promise.resolve(onReloadNads?.()).catch(() => undefined);
    Promise.resolve(onReloadStorageClasses?.()).catch(() => undefined);
    setCreateModalVisible(true);
  };

  const handleRefresh = async () => {
    const msgKey = `vne-vr-refresh-${cloudId}`;
    setRefreshing(true);
    message.loading({ content: '正在同步虚拟路由器实例...', key: msgKey, duration: 0 });
    try {
      if (onForceRefresh) {
        await Promise.resolve(onForceRefresh());
      } else {
        await Promise.resolve(onRefresh(true));
      }
      message.success({ content: '虚拟路由器列表已刷新', key: msgKey });
    } catch (e: any) {
      message.error({ content: e?.message || '刷新失败', key: msgKey });
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <PageDetailSection
      title={SECTION_TITLE}
      toolbarLeft={
        <>
          <Input
            allowClear
            placeholder="实例名称"
            suffix={<SearchOutlined style={{ color: 'rgba(0,0,0,.45)' }} />}
            className="toolbar-search"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
          />
          <Select
            allowClear
            placeholder="状态"
            value={statusFilter || undefined}
            className="toolbar-filter-sm"
            options={[
              { value: 'running', label: '运行中' },
              { value: 'starting', label: '启动中' },
              { value: 'stopping', label: '停止中' },
              { value: 'stopped', label: '已停止' },
              { value: 'error', label: '异常/错误' },
            ]}
            onChange={(v) => setStatusFilter(v || '')}
          />
          <Select
            allowClear
            placeholder="节点"
            value={nodeFilter || undefined}
            className="toolbar-filter-sm"
            options={nodesOptions.map((n) => ({ value: n, label: n }))}
            onChange={(v) => setNodeFilter(v || '')}
          />
          <button
            type="button"
            className="toolbar-reset-btn"
            onClick={() => {
              setKeyword('');
              setStatusFilter('');
              setNodeFilter('');
            }}
          >
            重置
          </button>
        </>
      }
      toolbarRight={
        <>
          <Button type="primary" onClick={handleOpenCreateModal}>
            创建实例
          </Button>
          <Button icon={<ReloadOutlined />} loading={refreshing} onClick={handleRefresh} />
        </>
      }
    >
      <Table
        className={!isTenant ? 'std-table' : 'std-table no-border'}
        bordered={false}
        rowKey={(r: any) => r?.metadata?.uid || r?.id}
        columns={columns}
        dataSource={filteredInstances}
        loading={loading}
        scroll={{ x: true }}
        pagination={{
          showTotal: (total) => `共 ${total} 条`,
        }}
      />

      <VirtualRouterCreateModal
        open={createModalVisible}
        onClose={() => setCreateModalVisible(false)}
        cloudId={cloudId}
        images={images}
        storageClasses={storageClasses}
        kubeSubnets={kubeSubnets}
        harvesterNads={harvesterNads}
        onCreated={() => onRefresh(true)}
        namespacesOptions={namespacesOptions}
        namespaceRecords={namespaceRecords}
        isTenant={isTenant}
        clusterCapabilities={clusterCapabilities}
      />

      <RdsInstanceLabelEditModal
        open={labelEditOpen}
        onClose={() => {
          setLabelEditOpen(false);
          setLabelEditRecord(null);
        }}
        cloudId={cloudId}
        resource={labelEditRecord}
        onSuccess={() => onRefresh(true)}
        hintVariant="vne"
      />

      <RdsDatabaseConsoleModal
        open={!!vrConsoleVm}
        vm={vrConsoleVm}
        onClose={() => setVrConsoleVm(null)}
        port={VROUTER_CONSOLE_PORT}
        iframeTitle="虚拟路由器管理"
      />

      {vmDetailDrawerOpen && vmDetailRecord ? (
        <HarvesterVmDetailDrawer
          open
          onClose={() => {
            setVmDetailDrawerOpen(false);
            setVmDetailRecordSnapshot(null);
          }}
          record={vmDetailRecord}
          cloudId={cloudId}
          namespaces={namespaceRecords || []}
          images={images || []}
          activeTab={vmDetailActiveTab}
          onTabChange={setVmDetailActiveTab}
          onRefresh={onRefresh}
        />
      ) : null}

      {yamlDrawerRecord ? (
        <HarvesterCrdMetadataDrawer
          open={yamlDrawerVisible}
          onClose={() => {
            setYamlDrawerVisible(false);
            setYamlDrawerRecordSnapshot(null);
          }}
          cloudId={cloudId}
          record={yamlDrawerRecord}
          onSuccess={() => void onRefresh(true)}
        />
      ) : null}
    </PageDetailSection>
  );
};

export default VirtualRouterSection;
