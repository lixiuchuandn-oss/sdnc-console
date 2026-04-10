import React, { useMemo, useState } from 'react';
import { Table, Button, Tag, Badge, Input, Select, message } from 'antd';
import { ReloadOutlined, DatabaseOutlined, SearchOutlined, PlusOutlined } from '@ant-design/icons';
import PageDetailSection from '../../../../components/PageDetailSection';
import ResourceActionsDropdown from '../../../../components/ResourceActionsDropdown';
import RdsCreateModal from './RdsCreateModal';
import RdsManageDrawer from './RdsManageDrawer';

type Props = {
  vms: any[];
  loading: boolean;
  cloudId: string;
  onRefresh: (force?: boolean) => void;
  images?: any[];
  storageClasses?: any[];
  kubeSubnets?: any[];
  harvesterNads?: any[];
  onReloadImages?: () => void | Promise<void>;
  onReloadSubnets?: () => void | Promise<void>;
  onReloadNads?: () => void | Promise<void>;
  onReloadStorageClasses?: () => void | Promise<void>;
  onForceRefresh?: () => void | Promise<void>;
  isTenant?: boolean;
  mode?: 'standard' | 'ops';
  /** 与镜像 `tower.io/paas-type` 一致；不传则展示全部带 tower.io/rds 的实例 */
  paasType?: string;
  /** 列表区标题，默认随 paasType 或「云数据库」 */
  sectionTitle?: string;
  /** 用于创建实例时解析租户允许的业务命名空间（与 VM 向导一致） */
  namespacesOptions?: string[];
  namespaceRecords?: any[];
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
};

const RdsSection: React.FC<Props> = ({
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
  mode = 'standard',
  paasType,
  sectionTitle,
  namespacesOptions = [],
  namespaceRecords = [],
}) => {
  const [keyword, setKeyword] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [nodeFilter, setNodeFilter] = useState('');
  const [createModalVisible, setCreateModalVisible] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [manageVisible, setManageVisible] = useState(false);
  const [currentRds, setCurrentRds] = useState<any>(null);

  const resolvedSectionTitle =
    sectionTitle ||
    (paasType ? `云数据库 · ${String(paasType).toUpperCase()}` : '云数据库 (RDS)');

  // Filter VMs that are labeled as RDS；可选按 tower.io/paas-type 细分（MySQL 兼容无该标签的旧实例）
  const rdsInstances = useMemo(() => {
    const base = vms.filter((vm) => vm?.metadata?.labels?.['tower.io/rds'] === 'true');
    if (!paasType) return base;
    const want = String(paasType).trim().toLowerCase();
    return base.filter((vm) => {
      const t = String(vm?.metadata?.labels?.['tower.io/paas-type'] || '').trim().toLowerCase();
      if (t === want) return true;
      if (want === 'mysql' && !t) return true;
      return false;
    });
  }, [vms, paasType]);

  // Derived options
  const nodesOptions = useMemo(() => {
    const s = new Set<string>();
    rdsInstances.forEach((r:any) => {
      const n = SafeRead.node(r);
      if (n) s.add(n);
    });
    return Array.from(s).sort();
  }, [rdsInstances]);

  const filteredInstances = useMemo(() => {
    return rdsInstances.filter((r) => {
      const name = SafeRead.name(r).toLowerCase();
      const status = SafeRead.status(r).toLowerCase();
      const node = SafeRead.node(r).toLowerCase();

      if (keyword && !name.includes(keyword.toLowerCase())) return false;
      if (statusFilter && status !== statusFilter.toLowerCase()) return false;
      if (nodeFilter && node !== nodeFilter.toLowerCase()) return false;
      
      return true;
    });
  }, [rdsInstances, keyword, statusFilter, nodeFilter]);

  const columns = useMemo(() => [
    {
      title: '实例名称',
      key: 'name',
      render: (_: any, r: any) => {
        const text = SafeRead.name(r) || '-';
        return (
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <DatabaseOutlined style={{ color: '#1677ff' }} />
            <span>{text}</span>
          </span>
        );
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
      width: 100,
      render: (_: any, r: any) => {
        const items = [
          {
            key: 'manage',
            label: '管理',
            onClick: () => {
              setCurrentRds(r);
              setManageVisible(true);
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
  ], []);

  const handleOpenCreateModal = () => {
    Promise.resolve(onReloadImages?.()).catch(() => undefined);
    Promise.resolve(onReloadSubnets?.()).catch(() => undefined);
    Promise.resolve(onReloadNads?.()).catch(() => undefined);
    Promise.resolve(onReloadStorageClasses?.()).catch(() => undefined);
    setCreateModalVisible(true);
  };

  const handleRefresh = async () => {
    const msgKey = `rds-refresh-${cloudId}`;
    setRefreshing(true);
    message.loading({ content: '正在同步云数据库实例...', key: msgKey, duration: 0 });
    try {
      if (onForceRefresh) {
        await Promise.resolve(onForceRefresh());
      } else {
        await Promise.resolve(onRefresh(true));
      }
      message.success({ content: '云数据库实例已刷新', key: msgKey });
    } catch (e: any) {
      message.error({ content: e?.message || '刷新失败', key: msgKey });
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <PageDetailSection
      title={resolvedSectionTitle}
      toolbarLeft={(
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
              { value: 'error', label: '异常/错误' }
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
      )}
      toolbarRight={(
        <>
          <Button type="primary" onClick={handleOpenCreateModal}>
            创建实例
          </Button>
          <Button icon={<ReloadOutlined />} loading={refreshing} onClick={handleRefresh} />
        </>
      )}
    >
      <Table
        className={!isTenant ? "std-table" : "std-table no-border"}
        bordered={false}
        rowKey={(r: any) => r?.metadata?.uid || r?.id}
        columns={columns}
        dataSource={filteredInstances}
        loading={loading}
        pagination={{
          size: 'small',
          showTotal: (total) => `共 ${total} 条`,
        }}
      />
      
      <RdsCreateModal
        open={createModalVisible}
        onClose={() => setCreateModalVisible(false)}
        onCreated={() => onRefresh(true)}
        cloudId={cloudId}
        images={images}
        storageClasses={storageClasses}
        kubeSubnets={kubeSubnets}
        harvesterNads={harvesterNads}
        paasType={paasType || 'mysql'}
        namespacesOptions={namespacesOptions}
        namespaceRecords={namespaceRecords}
        isTenant={isTenant}
      />
      <RdsManageDrawer
        open={manageVisible}
        onClose={() => {
          setManageVisible(false);
          setCurrentRds(null);
        }}
        record={currentRds}
      />
    </PageDetailSection>
  );
};

export default RdsSection;
