import React, { useMemo, useState } from 'react';
import { Card, Button, List, Tag, Tooltip, Space, Dropdown, MenuProps, Modal, message, Empty } from 'antd';
import { 
  PlusOutlined, 
  HistoryOutlined, 
  DatabaseOutlined, 
  ScheduleOutlined, 
  EllipsisOutlined, 
  ReloadOutlined,
  WarningOutlined
} from '@ant-design/icons';
import { deleteHarvesterBackup, deleteHarvesterScheduleVmBackup, updateHarvesterScheduleVmBackup } from '../../../../services/harvesterApi';
import { formatCron } from '../../../../utils/cronFormatter';
import VmBackupCreateModal from '../modals/VmBackupCreateModal';
import VmRestoreModal from '../modals/VmRestoreModal';
import ScheduleVmBackupCreateModal from '../modals/ScheduleVmBackupCreateModal';
import ScheduleVmBackupEditModal from '../modals/ScheduleVmBackupEditModal';
import { useAuth } from '../../../../contexts/AuthContext';
import { hasPermissionForAction } from '../../../../utils/accessMapping';

const formatAge = (timestamp: string) => {
  if (!timestamp) return '-';
  const created = new Date(timestamp).getTime();
  const now = Date.now();
  const diff = now - created;
  
  if (diff < 0) return '刚刚';

  const minutes = Math.floor(diff / 60000);
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  return `${days} 天前`;
};

const formatDate = (timestamp: string) => {
    if (!timestamp) return '-';
    return new Date(timestamp).toLocaleString();
};

interface HarvesterVmBackupTabProps {
  cloudId: string;
  record: any;
  backups: any[];
  schedules: any[];
  backupsLoading: boolean;
  schedulesLoading: boolean;
  onRefresh: (force?: boolean, silent?: boolean) => void;
  namespaces: any[];
}

const HarvesterVmBackupTab: React.FC<HarvesterVmBackupTabProps> = ({
  cloudId,
  record,
  backups,
  schedules,
  backupsLoading,
  schedulesLoading,
  onRefresh,
  namespaces
}) => {
  const { user } = useAuth();
  const perms = useMemo(() => (user?.permissions ?? []) as string[], [user?.permissions]);
  const hasEcsWrite = useMemo(() => {
    return hasPermissionForAction(perms, 'clouds.ecs:write') || hasPermissionForAction(perms, 'clouds:write');
  }, [perms]);

  // 弹窗状态
  const [createBackupVisible, setCreateBackupVisible] = useState(false);
  const [createSnapshotVisible, setCreateSnapshotVisible] = useState(false);
  const [createScheduleVisible, setCreateScheduleVisible] = useState(false);
  const [restoreVisible, setRestoreVisible] = useState(false);
  const [editScheduleVisible, setEditScheduleVisible] = useState(false);
  
  const [currentRestoreItem, setCurrentRestoreItem] = useState<any>(null);
  const [currentRestoreType, setCurrentRestoreType] = useState<'backup' | 'snapshot'>('backup');
  const [currentScheduleItem, setCurrentScheduleItem] = useState<any>(null);

  // 派生数据
  const vmId = record?.metadata?.name;
  const namespace = record?.metadata?.namespace;

  // 过滤备份/快照（仅保留当前虚拟机）
  const { backupList, snapshotList } = useMemo(() => {
    const all = backups || [];
    const vmBackups = all.filter((b: any) => {
      const raw = b.rawData || b;
      const targetName = raw.spec?.source?.name || b.targetVm;
      return targetName === vmId;
    });

    const backupsOnly = vmBackups.filter((b: any) => {
      const raw = b.rawData || b;
      return (raw.spec?.type || 'backup') === 'backup';
    });

    const snapshotsOnly = vmBackups.filter((b: any) => {
      const raw = b.rawData || b;
      return (raw.spec?.type || 'backup') === 'snapshot';
    });

    // 按创建时间倒序
    const sorter = (a: any, b: any) => {
      const ta = new Date(a.rawData?.metadata?.creationTimestamp || a.createdAt).getTime();
      const tb = new Date(b.rawData?.metadata?.creationTimestamp || b.createdAt).getTime();
      return tb - ta;
    };

    return {
      backupList: backupsOnly.sort(sorter),
      snapshotList: snapshotsOnly.sort(sorter)
    };
  }, [backups, vmId]);

  // 过滤定时策略（仅保留当前虚拟机）
  const scheduleList = useMemo(() => {
    const all = schedules || [];
    const vmSchedules = all.filter((s: any) => {
      const raw = s.rawData || s;
      const targetName = raw.spec?.vmbackup?.source?.name || s.vmName;
      return targetName === vmId;
    });
    
    // 按创建时间倒序
    return vmSchedules.sort((a: any, b: any) => {
      const ta = new Date(a.rawData?.metadata?.creationTimestamp || a.createdAt).getTime();
      const tb = new Date(b.rawData?.metadata?.creationTimestamp || b.createdAt).getTime();
      return tb - ta;
    });
  }, [schedules, vmId]);

  // 动作
  const handleDeleteBackup = (item: any, type: 'backup' | 'snapshot') => {
    if (!hasEcsWrite) {
      message.error('当前账号没有云主机操作权限（需要 clouds.ecs:write 或 clouds:write 权限）');
      return;
    }
    const raw = item.rawData || item;
    const name = raw.metadata?.name;
    const alias = raw.metadata?.annotations?.['tower.io/alias'];
    const displayName = alias || name;
    const ns = raw.metadata?.namespace;
    
    Modal.confirm({
      title: `确认删除${type === 'backup' ? '备份' : '快照'}`,
      content: (
        <div>
          <p>确定要删除 {type === 'backup' ? '备份' : '快照'} <b>{displayName}</b> 吗？</p>
          <p style={{ color: '#ff4d4f', fontSize: 12 }}><WarningOutlined /> 此操作不可恢复。</p>
        </div>
      ),
      okText: '删除',
      okType: 'danger',
      cancelText: '取消',
      onOk: async () => {
        try {
          await deleteHarvesterBackup(cloudId, ns, name);
          message.success('删除成功');
          onRefresh(true);
        } catch (e: any) {
          message.error(`删除失败: ${e.message}`);
        }
      },
    });
  };

  const handleRestore = (item: any, type: 'backup' | 'snapshot') => {
    if (!hasEcsWrite) {
      message.error('当前账号没有云主机操作权限（需要 clouds.ecs:write 或 clouds:write 权限）');
      return;
    }
    setCurrentRestoreItem(item.rawData || item);
    setCurrentRestoreType(type);
    setRestoreVisible(true);
  };

  const handleDeleteSchedule = (item: any) => {
    if (!hasEcsWrite) {
      message.error('当前账号没有云主机操作权限（需要 clouds.ecs:write 或 clouds:write 权限）');
      return;
    }
    const raw = item.rawData || item;
    const name = raw.metadata?.name;
    const alias = raw.metadata?.annotations?.['tower.io/alias'];
    const displayName = alias || name;
    const ns = raw.metadata?.namespace;

    Modal.confirm({
      title: '确认删除定时策略',
      content: (
        <div>
          <p>确定要删除定时策略 <b>{displayName}</b> 吗？</p>
          <p style={{ color: '#ff4d4f', fontSize: 12 }}><WarningOutlined /> 此操作不可恢复。</p>
        </div>
      ),
      okText: '删除',
      okType: 'danger',
      cancelText: '取消',
      onOk: async () => {
        try {
          await deleteHarvesterScheduleVmBackup(cloudId, ns, name);
          message.success('删除成功');
          onRefresh(true);
        } catch (e: any) {
          message.error(`删除失败: ${e.message}`);
        }
      }
    });
  };

  const handleSuspendSchedule = async (item: any) => {
    if (!hasEcsWrite) {
      message.error('当前账号没有云主机操作权限（需要 clouds.ecs:write 或 clouds:write 权限）');
      return;
    }
    const raw = item.rawData || item;
    const name = raw.metadata?.name;
    const ns = raw.metadata?.namespace;
    const isSuspended = raw.spec?.suspend === true || item.status === 'Suspended';
    const newSuspend = !isSuspended;

    try {
      await updateHarvesterScheduleVmBackup(cloudId, ns, name, { suspend: newSuspend });
      message.success(`${newSuspend ? '停用' : '启用'}成功`);
      onRefresh(true);
    } catch (e: any) {
      message.error(`操作失败: ${e.message}`);
    }
  };

  const handleEditSchedule = (item: any) => {
    if (!hasEcsWrite) {
      message.error('当前账号没有云主机操作权限（需要 clouds.ecs:write 或 clouds:write 权限）');
      return;
    }
    setCurrentScheduleItem(item.rawData || item);
    setEditScheduleVisible(true);
  };

  // 渲染
  const renderBackupItem = (item: any, type: 'backup' | 'snapshot') => {
    const raw = item.rawData || item;
    const name = raw.metadata?.name;
    const alias = raw.metadata?.annotations?.['tower.io/alias'];
    const displayName = alias || name;
    const readyToUse = raw.status?.readyToUse;
    const createdAt = raw.metadata?.creationTimestamp;
    const timeAgo = formatAge(createdAt);
    
    return (
      <List.Item
        style={{ padding: '16px 24px' }}
        actions={[
          <Tooltip title={undefined}>
            <Button type="link" size="small" disabled={!readyToUse || !hasEcsWrite} onClick={() => handleRestore(item, type)}>恢复</Button>
          </Tooltip>,
          <Tooltip title={undefined}>
            <Button type="link" size="small" danger disabled={!hasEcsWrite} onClick={() => handleDeleteBackup(item, type)}>删除</Button>
          </Tooltip>
        ]}
      >
        <List.Item.Meta
          avatar={
            <div style={{ 
              width: 48, height: 48, borderRadius: 8, background: '#ffffff', border: '1px solid #188fff80',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: '#1890ff', fontSize: 24
            }}>
              {type === 'snapshot' ? <HistoryOutlined style={{ fill: '#1890ff' }} /> : <DatabaseOutlined style={{ fill: '#1890ff' }} />}
            </div>
          }
          title={
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <span style={{ fontWeight: 500 }}>{displayName}</span>
                {readyToUse ? <Tag color="success" style={{ fontSize: 10 }}>READY</Tag> : <Tag color="warning" style={{ fontSize: 10 }}>NOT READY</Tag>}
            </div>
          }
          description={
            <div style={{ fontSize: 12 }}>
                <span>{timeAgo}</span>
                <span style={{ margin: '0 8px', color: '#eee' }}>|</span>
                <span>{formatDate(createdAt)}</span>
            </div>
          }
        />
      </List.Item>
    );
  };

  const renderScheduleItem = (item: any) => {
    const raw = item.rawData || item;
    const name = raw.metadata?.name;
    const alias = raw.metadata?.annotations?.['tower.io/alias'];
    const displayName = alias || name;
    const cron = raw.spec?.cron;
    const suspend = raw.spec?.suspend === true;
    const retain = raw.spec?.retain;
    const type = raw.spec?.vmbackup?.type || 'backup';

    let humanCron = cron;
    try {
      humanCron = formatCron(cron);
    } catch (e) {}

    const menuProps: MenuProps = {
      items: [
        { key: 'edit', label: '编辑策略', disabled: !hasEcsWrite, onClick: () => handleEditSchedule(item) },
        { key: 'suspend', label: suspend ? '启用' : '停用', disabled: !hasEcsWrite, onClick: () => handleSuspendSchedule(item) },
        { type: 'divider' },
        { key: 'delete', label: '删除', danger: true, disabled: !hasEcsWrite, onClick: () => handleDeleteSchedule(item) }
      ]
    };

    return (
      <List.Item
        style={{ padding: '16px 24px' }}
      >
        <List.Item.Meta
          avatar={
            <div style={{ 
              width: 48, height: 48, borderRadius: 8, background: '#ffffff', border: '1px solid #fa8c1680',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: '#fa8c16', fontSize: 24
            }}>
              <ScheduleOutlined style={{ fill: '#fa8c16' }} />
            </div>
          }
          title={
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <span style={{ fontWeight: 500 }}>{displayName}</span>
                {suspend ? <Tag color="default" style={{ fontSize: 10 }}>已暂停</Tag> : <Tag color="processing" style={{ fontSize: 10 }}>运行中</Tag>}
                <Tag style={{ fontSize: 10 }}>{type === 'snapshot' ? '快照' : '备份'}</Tag>
            </div>
          }
          description={
            <div style={{ fontSize: 12 }}>
                <Tooltip title={`Cron: ${cron}`}>
                    <span>计划: {humanCron}</span>
                </Tooltip>
                <span style={{ margin: '0 8px', color: '#eee' }}>|</span>
                <span>保留: {retain} 份</span>
            </div>
          }
        />
        <Tooltip title={undefined}>
          <span>
            <Dropdown menu={menuProps} trigger={['click']}>
              <Button type="text" icon={<EllipsisOutlined />} disabled={!hasEcsWrite} />
            </Dropdown>
          </span>
        </Tooltip>
      </List.Item>
    );
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {/* 1. 快照 */}
      <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <span style={{ color: '#666' }}>快照</span>
              <Space>
                  <Tooltip title="刷新">
                      <Button type="text" size="small" icon={<ReloadOutlined />} onClick={() => onRefresh(true)} loading={backupsLoading} />
                  </Tooltip>
                  <Tooltip title={hasEcsWrite ? '创建快照' : undefined}>
                      <Button type="text" size="small" icon={<PlusOutlined />} disabled={!hasEcsWrite} onClick={() => setCreateSnapshotVisible(true)} />
                  </Tooltip>
              </Space>
          </div>
          <Card variant="borderless" styles={{ body: { padding: 0 } }}>
            <List
              loading={backupsLoading}
              dataSource={snapshotList}
              renderItem={item => renderBackupItem(item, 'snapshot')}
              locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无快照" /> }}
              split={true}
            />
          </Card>
      </div>

      {/* 2. 备份 */}
      <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <span style={{ color: '#666' }}>备份</span>
              <Space>
                  <Tooltip title="刷新">
                      <Button type="text" size="small" icon={<ReloadOutlined />} onClick={() => onRefresh(true)} loading={backupsLoading} />
                  </Tooltip>
                  <Tooltip title={hasEcsWrite ? '创建备份' : undefined}>
                      <Button type="text" size="small" icon={<PlusOutlined />} disabled={!hasEcsWrite} onClick={() => setCreateBackupVisible(true)} />
                  </Tooltip>
              </Space>
          </div>
          <Card variant="borderless" styles={{ body: { padding: 0 } }}>
            <List
              loading={backupsLoading}
              dataSource={backupList}
              renderItem={item => renderBackupItem(item, 'backup')}
              locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无备份" /> }}
              split={true}
            />
          </Card>
      </div>

      {/* 3. 定时策略 */}
      <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <span style={{ color: '#666' }}>定时策略</span>
              <Space>
                  <Tooltip title="刷新">
                      <Button type="text" size="small" icon={<ReloadOutlined />} onClick={() => onRefresh(true)} loading={schedulesLoading} />
                  </Tooltip>
                  <Tooltip title={hasEcsWrite ? '创建定时策略' : undefined}>
                      <Button type="text" size="small" icon={<PlusOutlined />} disabled={!hasEcsWrite} onClick={() => setCreateScheduleVisible(true)} />
                  </Tooltip>
              </Space>
          </div>
          <Card variant="borderless" styles={{ body: { padding: 0 } }}>
            <List
              loading={schedulesLoading}
              dataSource={scheduleList}
              renderItem={renderScheduleItem}
              locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无定时策略" /> }}
              split={true}
            />
          </Card>
      </div>

      {/* 弹窗 */}
      <VmBackupCreateModal
        open={createBackupVisible}
        onCancel={() => setCreateBackupVisible(false)}
        cloudId={cloudId}
        namespaces={namespaces}
        vms={[record]}
        initialType="backup"
        onSuccess={() => {
          setCreateBackupVisible(false);
          message.success('备份创建指令已发送');
          onRefresh(true);
        }}
        initialNamespace={namespace}
        initialVm={record}
      />

      <VmBackupCreateModal
        open={createSnapshotVisible}
        onCancel={() => setCreateSnapshotVisible(false)}
        cloudId={cloudId}
        namespaces={namespaces}
        vms={[record]}
        initialType="snapshot"
        onSuccess={() => {
          setCreateSnapshotVisible(false);
          message.success('快照创建指令已发送');
          // 刷新数据列表：force=true 跳过前端缓存；silent=true 不弹提示
          onRefresh(true, true);
        }}
        initialNamespace={namespace}
        initialVm={record}
      />

      <ScheduleVmBackupCreateModal
        open={createScheduleVisible}
        onCancel={() => setCreateScheduleVisible(false)}
        cloudId={cloudId}
        onSuccess={() => {
          setCreateScheduleVisible(false);
          message.success('定时策略创建成功');
          // 刷新数据列表：force=true 跳过前端缓存；silent=true 不弹提示
          onRefresh(true, true);
        }}
        initialNamespace={namespace}
        initialVmName={vmId}
      />

      {currentRestoreItem && (
        <VmRestoreModal
          open={restoreVisible}
          onCancel={() => { setRestoreVisible(false); setCurrentRestoreItem(null); }}
          cloudId={cloudId}
          resource={currentRestoreItem}
          resourceType={currentRestoreType}
          vms={[record]} // 恢复目标列表：默认仅当前虚拟机
          onSuccess={() => {
            setRestoreVisible(false);
            setCurrentRestoreItem(null);
            message.success('恢复指令已发送');
            onRefresh(true);
          }}
        />
      )}

      {currentScheduleItem && (
        <ScheduleVmBackupEditModal
          open={editScheduleVisible}
          onCancel={() => { setEditScheduleVisible(false); setCurrentScheduleItem(null); }}
          cloudId={cloudId}
          record={currentScheduleItem}
          onSuccess={() => {
            setEditScheduleVisible(false);
            setCurrentScheduleItem(null);
            message.success('策略修改成功');
            onRefresh(true);
          }}
        />
      )}
    </div>
  );
};

export default HarvesterVmBackupTab;
