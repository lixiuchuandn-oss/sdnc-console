/**
 * Harvester - 定时备份/快照策略列表 Section
 * 展示 Harvester 中的 ScheduleVmBackup 资源，
 * 支持：
 * - 过滤系统命名空间，只展示业务命名空间策略
 * - 按关键字、类型过滤（备份 / 快照）
 * - 查看、修改、启用/停用以及删除策略
 * - 打开资源详情抽屉查看原始对象
 */
import React, { useMemo, useState } from 'react';
import { Table, Button, Input, Badge, Tooltip, Dropdown, Menu, message, Modal, Select } from 'antd';
import { ReloadOutlined, EllipsisOutlined } from '@ant-design/icons';
import { formatCron } from '../../../../utils/cronFormatter';
import { isSystemNamespace } from '../../../../utils/harvesterUtils';
import { deleteHarvesterScheduleVmBackup, updateHarvesterScheduleVmBackup } from '../../../../services/harvesterApi';
import PageDetailSection from '../../../../components/PageDetailSection';
import { TableColumnSettings } from '../../../../components/TableColumnSettings';
import HarvesterResourceDrawer from '../components/HarvesterResourceDrawer';
import ScheduleVmBackupCreateModal from '../modals/ScheduleVmBackupCreateModal';
import ScheduleVmBackupEditModal from '../modals/ScheduleVmBackupEditModal';

/**
 * 组件入参说明
 * - cloudId: 当前云 ID，用于调用定时备份相关 API
 * - data: 后端返回的定时策略列表（可能带 rawData 包装）
 * - loading: 外层加载状态
 * - onRefresh: 刷新回调，支持 force=true
 */
interface Props {
  cloudId: string;
  data: any[];
  loading: boolean;
  onRefresh?: (force?: boolean) => void;
  vmId?: string;
  defaultHiddenColumns?: string[];
  bordered?: boolean;
}

/**
 * 将创建时间转换为“存活时间”人类可读文案
 * 如：5 分钟 / 3 小时 / 2 天
 */
const formatAge = (timestamp: string) => {
  if (!timestamp) return '-';
  const created = new Date(timestamp).getTime();
  const now = Date.now();
  const diff = now - created;
  
  if (diff < 0) return '0 分钟';

  const minutes = Math.floor(diff / 60000);
  if (minutes < 60) return `${minutes} 分钟`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时`;
  const days = Math.floor(hours / 24);
  return `${days} 天`;
};

const ScheduleVmBackupsSection: React.FC<Props> = ({ cloudId, data, loading, onRefresh, vmId, defaultHiddenColumns, bordered = true }) => {
  // 工具栏过滤与抽屉/弹窗的本地状态
  const [keyword, setKeyword] = useState<string>('');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [drawerVisible, setDrawerVisible] = useState(false);
  const [createModalVisible, setCreateModalVisible] = useState(false);
  const [editModalVisible, setEditModalVisible] = useState(false);
  const [currentRecord, setCurrentRecord] = useState<any>(null);
  
  // 列设置状态
  const [visibleColumns, setVisibleColumns] = useState<any>();

  const handleSuspend = async (record: any) => {
    try {
      const newSuspend = !record.suspended;
      await updateHarvesterScheduleVmBackup(cloudId, record.namespace, record.id, { suspend: newSuspend });
      message.success(`${newSuspend ? '停用' : '启用'}成功`);
      onRefresh?.(true);
    } catch (e: any) {
      message.error(`操作失败: ${e.message}`);
    }
  };

  const handleDelete = (record: any) => {
    Modal.confirm({
      title: '确认删除',
      content: `确定要删除定时备份策略 ${record.name} (${record.id}) 吗？此操作不可恢复。`,
      okText: '删除',
      okType: 'danger',
      cancelText: '取消',
      onOk: async () => {
        try {
          await deleteHarvesterScheduleVmBackup(cloudId, record.namespace, record.id);
          message.success('删除成功');
          onRefresh?.(true);
        } catch (e: any) {
          message.error(`删除失败: ${e.message}`);
        }
      }
    });
  };

  const dataSource = useMemo(() => {
    return (data || [])
      .filter((b: any) => {
        const raw = b.rawData || b;
        const ns = raw.metadata?.namespace || b.namespace;
        return !isSystemNamespace(ns);
      })
      .map((b: any) => {
      const raw = b.rawData || b;
      
      // Parse retention count
      let retentionCount = '-';
      if (raw.spec?.retain !== undefined) {
        retentionCount = raw.spec.retain;
      } else if (b.retention) {
        retentionCount = b.retention;
      }

      // Determine suspended status
      // Priority: raw.spec.suspend -> b.status (string)
      const isSuspended = raw.spec?.suspend === true || b.status === 'Suspended';

      // Resolve Name/Alias
      const id = raw.metadata?.name || b.name;
      const alias = raw.metadata?.annotations?.['tower.io/alias'];
      const displayName = alias || id;

      return {
        key: raw.metadata?.uid || b.id,
        name: displayName,
        id: id,
        namespace: raw.metadata?.namespace || b.namespace,
        vmName: raw.spec?.vmbackup?.source?.name || b.vmName || '-',
        retention: retentionCount,
        maxFailure: raw.spec?.maxFailure || b.maxFailure || '-',
        type: raw.spec?.vmbackup?.type || 'backup',
        cron: raw.spec?.cron || b.cron || '-',
        suspended: isSuspended,
        creationTimestamp: raw.metadata?.creationTimestamp || b.createdAt,
        age: formatAge(raw.metadata?.creationTimestamp || b.createdAt),
        raw,
        links: b.links || {},
      };
    });
  }, [data]);

  const filteredData = useMemo(() => {
    let d = dataSource;
    if (typeFilter && typeFilter !== 'all') {
      d = d.filter((x: any) => x.type === typeFilter);
    }
    if (keyword) {
      const k = keyword.toLowerCase();
      d = d.filter((x: any) => x.name.toLowerCase().includes(k) || x.namespace.toLowerCase().includes(k));
    }
    if (vmId) {
      d = d.filter((x: any) => x.vmName === vmId);
    }
    return d;
  }, [dataSource, keyword, typeFilter, vmId]);

  const columns = [
    { 
      title: '策略名称 (别名)', 
      dataIndex: 'name', 
      key: 'name', 
      render: (t: string, r: any) => (
        <span
          className="cell-link"
          onClick={() => { setCurrentRecord(r.raw); setDrawerVisible(true); }}
        >
          {t}
        </span>
      )
    },
    {
      title: '策略 ID',
      dataIndex: 'id',
      key: 'id', 
      render: (t: string) => <span style={{ color: '#666', fontSize: 13 }}>{t}</span>
    },
    { 
      title: '状态', 
      dataIndex: 'suspended', 
      key: 'suspended', 
      render: (suspended: boolean) => (
        <Badge status={!suspended ? 'success' : 'warning'} text={!suspended ? '活跃' : '暂停'} />
      )
    },
    { title: '命名空间', dataIndex: 'namespace', key: 'namespace' },
    { title: '源虚拟机', dataIndex: 'vmName', key: 'vmName' },
    { title: '策略类型', dataIndex: 'type', key: 'type' },
    { 
      title: '计划任务', 
      dataIndex: 'cron', 
      key: 'cron', 
      render: (cron: string) => {
        if (!cron || cron === '-') return '-';
        try {
          const human = formatCron(cron);
          return (
            <Tooltip title={cron}>
              <span>{human}</span>
            </Tooltip>
          );
        } catch (e) {
          return cron;
        }
      }
    },
    { title: '保存数量', dataIndex: 'retention', key: 'retention' },
    { title: '最大故障数', dataIndex: 'maxFailure', key: 'maxFailure' },
    { title: '存活时间', dataIndex: 'age', key: 'age' },
    { 
      title: '操作', 
      key: 'action', 
      width: 80,
      fixed: 'right' as const,
      render: (_: any, r: any) => (
         <Dropdown 
           overlay={
             <Menu>
               <Menu.Item key="view" onClick={() => { setCurrentRecord(r.raw); setDrawerVisible(true); }}>
                 查看详情
               </Menu.Item>
               <Menu.Item key="edit" onClick={() => { setCurrentRecord(r); setEditModalVisible(true); }}>
                 策略修改
               </Menu.Item>
               <Menu.Item key="suspend" onClick={() => handleSuspend(r)}>
                 {r.suspended ? '启用' : '停用'}
               </Menu.Item>
               <Menu.Divider />
               <Menu.Item key="delete" danger onClick={() => handleDelete(r)}>
                 删除
               </Menu.Item>
             </Menu>
           } 
           trigger={['click']}
         >
           <Button icon={<EllipsisOutlined />} className="row-actions-trigger" type="text" />
         </Dropdown>
      )
    }
  ];

  return (
    <>
      <PageDetailSection
        asCard={false}
        toolbarLeft={(
          <>
            <Input
              className="toolbar-search"
              placeholder="搜索名称或命名空间"
              value={keyword}
              onChange={e => setKeyword(e.target.value)}
              allowClear
            />
            <Select
              className="toolbar-filter"
              value={typeFilter}
              onChange={setTypeFilter}
              options={[
                { label: '全部类型', value: 'all' },
                { label: '备份', value: 'backup' },
                { label: '快照', value: 'snapshot' },
              ]}
            />
          </>
        )}
        toolbarRight={(
           <div className="toolbar-actions">
             <Button type="primary" onClick={() => setCreateModalVisible(true)}>创建定时策略</Button>
             <TableColumnSettings
               columns={columns}
               onChange={setVisibleColumns}
               settingsKey="harvester_schedule_backups_list"
               defaultHiddenColumns={defaultHiddenColumns}
             />
             <Button icon={<ReloadOutlined />} onClick={() => onRefresh?.(true)} loading={loading} />
           </div>
        )}
      >
        <Table
          className="std-table"
          bordered={bordered}
          dataSource={filteredData}
          columns={visibleColumns || columns}
          loading={loading}
          pagination={{
            size: 'small',
            showQuickJumper: false,
          }}
        />
      </PageDetailSection>

      <HarvesterResourceDrawer
        open={drawerVisible}
        onClose={() => setDrawerVisible(false)}
        resourceType="ScheduleVmBackup"
        record={currentRecord}
        cloudId={cloudId}
      />

      <ScheduleVmBackupCreateModal
        visible={createModalVisible}
        cloudId={cloudId}
        onCancel={() => setCreateModalVisible(false)}
        onSuccess={() => {
          setCreateModalVisible(false);
          onRefresh?.(true);
        }}
      />

      <ScheduleVmBackupEditModal
        visible={editModalVisible}
        cloudId={cloudId}
        record={currentRecord}
        onCancel={() => setEditModalVisible(false)}
        onSuccess={() => {
          setEditModalVisible(false);
          onRefresh?.(true);
        }}
      />
    </>
  );
};

export default ScheduleVmBackupsSection;
