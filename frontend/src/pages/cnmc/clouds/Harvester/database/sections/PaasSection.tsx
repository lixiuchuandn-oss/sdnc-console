/**
 * Harvester 上 **虚拟机** 形态的 PaaS 托管实例列表（通用壳子）。
 * 关系型数据库（RDS）实例：`tower.io/paas-category=database` 或旧 `tower.io/rds`；可选再按 `tower.io/paas-type` 收窄；创建/控制台等同目录 Rds*。
 */
import React, { useCallback, useMemo, useState } from 'react';
import { Table, Button, Tag, Badge, Input, Select, Typography, Tooltip } from 'antd';
import { ReloadOutlined, DatabaseOutlined, SearchOutlined } from '@ant-design/icons';
import PageDetailSection from '../../../../../../components/PageDetailSection';
import ResourceActionsDropdown from '../../../../../../components/ResourceActionsDropdown';
import { useAuth } from '../../../../../../contexts/AuthContext';
import { hasPermissionForAction } from '../../../../../../utils/accessMapping';
import RdsCreateModal from '../modals/RdsCreateModal';
import RdsInstanceLabelEditModal from '../modals/RdsInstanceLabelEditModal';
import RdsDatabaseConsoleModal from '../modals/RdsDatabaseConsoleModal';
import { isTowerPaasDatabaseVm } from '../../shared/harvesterTowerPaas';
import {
  type HarvesterSectionOnRefresh,
  createHarvesterToolbarRefresh,
  runHarvesterSectionRefresh,
} from '../../shared/lib/harvesterSectionRefresh';
import VmDetailDrawer from '../../ecs/drawers/vm-detail';
import { cnVmStatus } from '../../../../../../utils/harvesterUtils';

type Props = {
  vms: any[];
  loading: boolean;
  cloudId: string;
  onRefresh?: HarvesterSectionOnRefresh;
  images?: any[];
  storageClasses?: any[];
  kubeSubnets?: any[];
  harvesterNads?: any[];
  onReloadImages?: () => void | Promise<void>;
  onReloadSubnets?: () => void | Promise<void>;
  onReloadNads?: () => void | Promise<void>;
  onReloadStorageClasses?: () => void | Promise<void>;
  /** @deprecated 与 `onRefresh({ force: true })` 等价；Cloudmap 池请只传 `paasDatabasesTabOnRefresh.rds` */
  onForceRefresh?: () => void | Promise<void>;
  isTenant?: boolean;
  /** 与镜像 `tower.io/paas-type` 一致；不传则展示全部 RDS 托管实例（新 `paas-category` 或旧 `rds`） */
  paasType?: string;
  /** 列表区标题，默认随 paasType 或「云RDS」 */
  sectionTitle?: string;
  /** 用于创建实例时解析租户允许的业务命名空间（与 VM 向导一致） */
  namespacesOptions?: string[];
  namespaceRecords?: any[];
  /** Harvester 集群能力（`capabilities` 接口 data），与资源池/控制台一致时传入可少一次请求；不传则创建弹窗内自拉 */
  clusterCapabilities?: any;
};

/** 与镜像标签 `tower.io/paas-type`、创建弹窗展示一致 */
const PAAS_TYPE_LABELS: Record<string, string> = {
  mysql: 'MySQL',
  postgresql: 'PostgreSQL',
  mongodb: 'MongoDB',
  rocketmq: 'RocketMQ',
  kafka: 'Kafka',
};

const SafeRead = {
  name: (r: any) => r?.metadata?.annotations?.['tower.io/alias'] || r?.name || r?.metadata?.name || '',
  status: (r: any) => {
    const vmi = r?.vmi || r?.vmiRaw;
    const migrationState = vmi?.status?.migrationState;
    const migrationAnnotation = vmi?.metadata?.annotations?.['harvesterhci.io/migrationState'];
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
  /** 无标签时与列表筛选逻辑一致，按 MySQL 兼容 */
  paasTypeKey: (r: any) => {
    const t = String(r?.metadata?.labels?.['tower.io/paas-type'] || '').trim().toLowerCase();
    return t || 'mysql';
  },
  paasTypeLabel: (r: any) => {
    const key = SafeRead.paasTypeKey(r);
    return PAAS_TYPE_LABELS[key] || key.replace(/^\w/, (c) => c.toUpperCase());
  },
  /** 创建时从镜像写入的 tower.io/paas-ver，如 5.7、8.0 */
  paasVer: (r: any) => String(r?.metadata?.labels?.['tower.io/paas-ver'] || '').trim(),
  /** 与 `VmSection` SafeRead.ip 一致：Agent 上报 / vmi.status.interfaces 等；列表行含 `status.interfaces` 时补读 */
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

const PaasSection: React.FC<Props> = ({
  vms,
  loading,
  cloudId,
  onRefresh,
  images = [],
  storageClasses = [],
  kubeSubnets = [],
  harvesterNads = [],
  onReloadImages,
  onReloadSubnets,
  onReloadNads,
  onReloadStorageClasses,
  onForceRefresh,
  isTenant = false,
  paasType,
  sectionTitle,
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
  const [createModalVisible, setCreateModalVisible] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [labelEditOpen, setLabelEditOpen] = useState(false);
  const [labelEditRecord, setLabelEditRecord] = useState<any>(null);
  const [dbConsoleVm, setDbConsoleVm] = useState<any | null>(null);
  const [vmDetailDrawerOpen, setVmDetailDrawerOpen] = useState(false);
  const [vmDetailRecordSnapshot, setVmDetailRecordSnapshot] = useState<any>(null);
  const [vmDetailActiveTab, setVmDetailActiveTab] = useState('detail');

  const resolvedSectionTitle =
    sectionTitle ||
    (paasType ? `云RDS · ${String(paasType).toUpperCase()}` : '云RDS');

  /** RDS 线：新 `paas-category=database` 或旧 `rds`；可选再按 `paas-type`（MySQL 兼容无 paas-type 的旧实例） */
  const paasVmInstances = useMemo(() => {
    const base = vms.filter((vm) => isTowerPaasDatabaseVm(vm));
    if (!paasType) return base;
    const want = String(paasType).trim().toLowerCase();
    return base.filter((vm) => {
      const t = String(vm?.metadata?.labels?.['tower.io/paas-type'] || '').trim().toLowerCase();
      if (t === want) return true;
      if (want === 'mysql' && !t) return true;
      return false;
    });
  }, [vms, paasType]);

  const nodesOptions = useMemo(() => {
    const s = new Set<string>();
    paasVmInstances.forEach((r: any) => {
      const n = SafeRead.node(r);
      if (n) s.add(n);
    });
    return Array.from(s).sort();
  }, [paasVmInstances]);

  const filteredInstances = useMemo(() => {
    return paasVmInstances
      .filter((r) => {
        const name = SafeRead.name(r).toLowerCase();
        const status = SafeRead.status(r).toLowerCase();
        const node = SafeRead.node(r).toLowerCase();

        if (keyword && !name.includes(keyword.toLowerCase())) return false;
        if (statusFilter && status !== statusFilter.toLowerCase()) return false;
        if (nodeFilter && node !== nodeFilter.toLowerCase()) return false;

        return true;
      })
      .sort((a, b) => {
        const timeA = SafeRead.creationTimestamp(a);
        const timeB = SafeRead.creationTimestamp(b);
        return new Date(timeB).getTime() - new Date(timeA).getTime();
      });
  }, [paasVmInstances, keyword, statusFilter, nodeFilter]);

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
              <DatabaseOutlined style={{ color: '#1677ff' }} />
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
        title: '引擎类型',
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

          return <Badge status={statusColor as any} text={cnVmStatus(s)} />;
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
        width: 128,
        render: (_: any, r: any) => {
          const items = [
            {
              key: 'dbConsole',
              label: '数据库管理',
              onClick: () => setDbConsoleVm(r),
            },
            {
              key: 'vmDetail',
              label: '云主机详情',
              onClick: () => openVmDetailDrawer(r),
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
    [canEditPaasVmLabels, openVmDetailDrawer],
  );

  const handleOpenCreateModal = () => {
    Promise.resolve(onReloadImages?.()).catch(() => undefined);
    Promise.resolve(onReloadSubnets?.()).catch(() => undefined);
    Promise.resolve(onReloadNads?.()).catch(() => undefined);
    Promise.resolve(onReloadStorageClasses?.()).catch(() => undefined);
    setCreateModalVisible(true);
  };

  const sectionOnRefresh = useMemo((): HarvesterSectionOnRefresh | undefined => {
    if (!onForceRefresh) return onRefresh;
    return (force?: boolean, silent?: boolean) => {
      if (force === false) {
        return onRefresh?.(false, silent);
      }
      return Promise.resolve(onForceRefresh());
    };
  }, [onForceRefresh, onRefresh]);

  const handleToolbarRefresh = useMemo(
    () =>
      createHarvesterToolbarRefresh(sectionOnRefresh, {
        before: () => setRefreshing(true),
        after: () => setRefreshing(false),
      }),
    [sectionOnRefresh],
  );

  const reloadListAfterWrite = useCallback(() => {
    void runHarvesterSectionRefresh(sectionOnRefresh, { force: true });
  }, [sectionOnRefresh]);

  return (
    <PageDetailSection
      title={resolvedSectionTitle}
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
          <Button icon={<ReloadOutlined />} loading={refreshing} onClick={handleToolbarRefresh} />
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

      <RdsCreateModal
        open={createModalVisible}
        onClose={() => setCreateModalVisible(false)}
        onCreated={reloadListAfterWrite}
        cloudId={cloudId}
        images={images}
        storageClasses={storageClasses}
        kubeSubnets={kubeSubnets}
        harvesterNads={harvesterNads}
        paasType={paasType || 'mysql'}
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
        onSuccess={reloadListAfterWrite}
      />
      <RdsDatabaseConsoleModal
        open={!!dbConsoleVm}
        vm={dbConsoleVm}
        onClose={() => setDbConsoleVm(null)}
      />

      {vmDetailDrawerOpen && vmDetailRecord ? (
        <VmDetailDrawer
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
          onRefresh={(force) => {
            void runHarvesterSectionRefresh(sectionOnRefresh, {
              force: force !== false,
            });
          }}
        />
      ) : null}
    </PageDetailSection>
  );
};

export default PaasSection;
