import React, { useMemo, useState, useEffect } from 'react';
import { Table, Badge, Input, Button, Dropdown, message, Space, Popconfirm } from 'antd';
import { ReloadOutlined, SearchOutlined, DeleteOutlined, EllipsisOutlined, SwapRightOutlined, SyncOutlined, CheckCircleOutlined, CloseCircleOutlined } from '@ant-design/icons';
import PageDetailSection from '../../../../components/PageDetailSection';
import { fetchHarvesterMigrations, fetchHarvesterMigrationsDirect, abortHarvesterMigration } from '../../../../services/harvesterApi';
import { useAuth } from '../../../../contexts/AuthContext';
import { hasPermissionForAction } from '../../../../utils/accessMapping';
import HarvesterResourceDrawer from '../components/HarvesterResourceDrawer';
import dayjs from 'dayjs';
import TableColumnSettings from '../../../../components/TableColumnSettings';
import type { ColumnsType } from 'antd/es/table';

const SafeMig = {
  base: (r: any) => r?.rawData ? r.rawData : r,
  phase: (r: any) => {
    const x = SafeMig.base(r);
    return x?.status?.phase || r?.phase || x?.Phase || 'Unknown';
  },
  vmName: (r: any) => {
    const x = SafeMig.base(r);
    return x?.spec?.vmiName || r?.vmiName || x?.VmiName || x?.spec?.vmi || r?.vmName || '-';
  },
  sourceNode: (r: any) => {
    const x = SafeMig.base(r);
    return x?.status?.migrationState?.sourceNode || r?.sourceNode || x?.SourceNode || '-';
  },
  targetNode: (r: any) => {
    const x = SafeMig.base(r);
    return x?.status?.migrationState?.targetNode || r?.targetNode || x?.TargetNode || '自动调度';
  },
  namespace: (r: any) => {
    const x = SafeMig.base(r);
    return x?.metadata?.namespace || r?.namespace || x?.Namespace || '-';
  },
  createdAt: (r: any) => {
    const x = SafeMig.base(r);
    return x?.metadata?.creationTimestamp || r?.createdAt || x?.CreationTimestamp || '';
  },
  uidOrKey: (r: any) => {
    const x = SafeMig.base(r);
    return x?.metadata?.uid || x?.metadata?.name || `${SafeMig.namespace(r)}/${SafeMig.vmName(r)}`;
  },
  taskId: (r: any) => {
    const x = SafeMig.base(r);
    return x?.metadata?.name || r?.name || x?.Name || x?.metadata?.uid || r?.uid || '-';
  }
};

interface Props {
  cloudId: string;
  onRefresh?: () => void;
}

const MigrationsSection: React.FC<Props> = ({ cloudId, onRefresh }) => {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<any[]>([]);
  const [keyword, setKeyword] = useState('');
  const { user } = useAuth();
  const [detailVisible, setDetailVisible] = useState(false);
  const [detailRecord, setDetailRecord] = useState<any>(null);
  const [detailActiveTab, setDetailActiveTab] = useState('detail');

  const loadData = async (force = false) => {
    setLoading(true);
    try {
      const res = await fetchHarvesterMigrations(cloudId, force);
      let list = res?.data?.items || [];
      if (!Array.isArray(list) || list.length === 0) {
        try {
          const direct = await fetchHarvesterMigrationsDirect(cloudId, force);
          list = direct?.data?.items || direct?.items || [];
        } catch (e) {
          // ignore direct fallback error
        }
      }
      setData(list);
    } catch (e: any) {
      message.error(e.message || '加载迁移记录失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [cloudId]);

  const handleOpenDrawer = (record: any, tab: string = 'detail') => {
    const ns = record?.metadata?.namespace;
    const name = record?.metadata?.name;
    const view = (ns && name) ? `/apis/kubevirt.io/v1/namespaces/${encodeURIComponent(ns)}/virtualmachineinstancemigrations/${encodeURIComponent(name)}` : undefined;
    const r = { 
      ...record, 
      kind: 'VirtualMachineInstanceMigration',
      links: { ...(record?.links || {}), ...(view ? { view } : {}) }
    };
    setDetailRecord(r);
    setDetailActiveTab(tab);
    setDetailVisible(true);
  };

  const handleRefresh = () => {
    loadData(true);
    if (onRefresh) onRefresh();
  };

  const handleAbort = async (record: any) => {
    try {
        // Namespace/Name for migration object, but API might need VM name
        // Our backend API `abort-migration` takes `instanceId` which is `namespace/vmName`.
        // The migration object has `spec.vmiName`.
        const vmName = record.spec?.vmiName;
        const namespace = record.metadata?.namespace;
        if (!vmName || !namespace) {
            message.error('无法解析关联的虚拟机信息');
            return;
        }
        await abortHarvesterMigration(cloudId, `${namespace}/${vmName}`);
        message.success('已发送取消请求');
        handleRefresh();
    } catch (e: any) {
        message.error(e.message || '取消失败');
    }
  };

  const filteredData = useMemo(() => {
    if (!keyword) return data;
    const k = keyword.toLowerCase();
    return data.filter((item: any) => 
      item.metadata?.name?.toLowerCase().includes(k) || 
      item.spec?.vmiName?.toLowerCase().includes(k)
    );
  }, [data, keyword]);

  const allColumns: ColumnsType<any> = [
    {
      title: '任务ID',
      key: 'taskId',
      render: (_: any, r: any) => SafeMig.taskId(r)
    },
    {
      title: '状态',
      key: 'status',
      render: (_: any, r: any) => {
        const phase = SafeMig.phase(r);
        const isRunning = phase === 'Running' || phase === 'Scheduled' || phase === 'Scheduling' || phase === 'Preparing';
        let status: 'success' | 'error' | 'processing' | 'default' | 'warning' = 'default';
        if (phase === 'Succeeded') status = 'success';
        else if (phase === 'Failed') status = 'error';
        else if (isRunning) status = 'processing';
        return <Badge status={status} text={phase || 'Unknown'} />;
      }
    },
    {
      title: '虚拟机',
      key: 'vmName',
      render: (_: any, r: any) => <span className="cell-link" onClick={() => handleOpenDrawer(r, 'detail')}><b>{SafeMig.vmName(r)}</b></span>
    },
    {
      title: '源节点',
      key: 'sourceNode',
      render: (_: any, r: any) => SafeMig.sourceNode(r)
    },
    {
      title: '目标节点',
      key: 'targetNode',
      render: (_: any, r: any) => SafeMig.targetNode(r)
    },
    {
      title: '命名空间',
      key: 'namespace',
      render: (_: any, r: any) => SafeMig.namespace(r)
    },
    {
      title: '创建时间',
      key: 'createdAt',
      className: 'std-time',
      render: (_: any, r: any) => {
        const t = SafeMig.createdAt(r);
        return t ? dayjs(t).format('YYYY-MM-DD HH:mm:ss') : '-';
      }
    },
    {
      title: '操作',
      key: 'actions',
      width: 100,
      render: (_: any, r: any) => {
        const phase = r.status?.phase;
        const isRunning = phase === 'Running' || phase === 'Scheduled' || phase === 'Scheduling' || phase === 'Preparing';
        
        const actions: React.ReactNode[] = [];
        actions.push(<Button type="link" size="small" onClick={() => handleOpenDrawer(r, 'detail')}>详情</Button>);
        const canWrite = hasPermissionForAction(user?.permissions || [], 'clouds.console:write');
        if (isRunning && canWrite) {
          actions.push(
            <Popconfirm title="确定要取消此迁移任务吗？" onConfirm={() => handleAbort(r)}>
              <Button type="link" danger size="small">取消</Button>
            </Popconfirm>
          );
        }
        return <Space size="small">{actions}</Space>;
      }
    }
  ];
  const [tableColumns, setTableColumns] = useState<ColumnsType<any>>(allColumns);

  return (
    <PageDetailSection
      title="迁移记录"
      toolbarLeft={(
        <>
          <Input 
            allowClear
            placeholder="关键字"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            className="toolbar-search"
          />
        </>
      )}
      toolbarRight={(
        <div className="toolbar-actions">
          <TableColumnSettings columns={allColumns} onChange={setTableColumns} settingsKey="harvester_migrations_table" />
          <Button icon={<ReloadOutlined />} onClick={handleRefresh} loading={loading} />
        </div>
      )}
    >
      <Table
        className="std-table"
        bordered
        rowKey={(r) => SafeMig.uidOrKey(r)}
        columns={tableColumns}
        dataSource={filteredData}
        loading={loading}
        pagination={{
          size: 'small',
          showSizeChanger: true,
          pageSize: 10,
          pageSizeOptions: ['10', '20', '50', '100'],
          showQuickJumper: false
        }}
      />
      <HarvesterResourceDrawer
        open={detailVisible}
        onClose={() => setDetailVisible(false)}
        resourceType="VirtualMachineInstanceMigration"
        record={detailRecord}
        activeTab={detailActiveTab}
        onTabChange={setDetailActiveTab}
        cloudId={cloudId}
      />
    </PageDetailSection>
  );
};

export default MigrationsSection;
