import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { App, Badge, Button, Dropdown, Input, Progress, Select, Table, Tag } from 'antd';
import type { MenuProps } from 'antd';
import { EllipsisOutlined, ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import PageDetailSection from '../../../../components/PageDetailSection';
import HarvesterResourceDrawer from '../components/HarvesterOpsinfoDrawer';
import { deleteHarvesterBackup, deleteHarvesterVirtualMachineRestore, fetchHarvesterBackups, fetchHarvesterVirtualMachineRestores } from '../../../../services/harvesterApi';
import { isPublicNamespace, isSystemNamespace } from '../../../../utils/harvesterUtils';

type Props = {
  cloudId: string;
  isTenant?: boolean;
};

const isFailedByConditions = (raw: any) => {
  const conds: any[] = Array.isArray(raw?.status?.conditions) ? raw.status.conditions : [];
  return conds.some((c: any) => {
    const type = String(c?.type || '').toLowerCase();
    const reason = String(c?.reason || '').toLowerCase();
    const status = String(c?.status || '').toLowerCase();
    const msg = String(c?.message || '').toLowerCase();
    if (type.includes('error')) return true;
    if (reason.includes('error')) return true;
    if (status === 'false' && (reason.includes('fail') || msg.includes('fail') || msg.includes('denied'))) return true;
    return false;
  });
};

const getRestoreStatus = (raw: any) => {
  const failed = isFailedByConditions(raw);
  if (failed) return { phase: 'failed', text: '失败' as const, progress: 0 };
  const conds: any[] = Array.isArray(raw?.status?.conditions) ? raw.status.conditions : [];
  const ready = conds.some((c: any) => String(c?.type || '').toLowerCase() === 'ready' && String(c?.status || '').toLowerCase() === 'true');
  const completed = conds.some((c: any) => String(c?.type || '').toLowerCase() === 'completed' && String(c?.status || '').toLowerCase() === 'true');
  if (ready || completed) return { phase: 'ready', text: '完成' as const, progress: 100 };
  
  // 如果任务正在进行中但 progress 为 0 或未定义，显示中间值 70% 而不是 0%
  const rawProgress = typeof raw?.status?.progress === 'number' ? raw.status.progress : undefined;
  const progress = rawProgress !== undefined ? rawProgress : 70; // 默认显示 70% 表示进行中
  return { phase: 'pending', text: '进行中' as const, progress: Math.max(0, Math.min(100, progress)) };
};

const getBackupStatus = (raw: any) => {
  const failed = isFailedByConditions(raw);
  if (failed) return { phase: 'failed', text: '失败' as const };
  const ready = !!raw?.status?.readyToUse;
  if (ready) return { phase: 'ready', text: '就绪' as const };
  return { phase: 'pending', text: '未就绪' as const };
};

const VmRestoreTasksSection: React.FC<Props> = ({ cloudId, isTenant }) => {
  const { modal, message } = App.useApp();
  const [keyword, setKeyword] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [loading, setLoading] = useState(false);
  const [backups, setBackups] = useState<any[]>([]);
  const [restores, setRestores] = useState<any[]>([]);

  const [drawerVisible, setDrawerVisible] = useState(false);
  const [drawerRecord, setDrawerRecord] = useState<any>(null);
  const [drawerActiveTab, setDrawerActiveTab] = useState('detail');

  const timerRef = useRef<any>(null);

  // 过滤出恢复任务（排除克隆任务）
  const normalizeRestores = useMemo(() => {
    const list = Array.isArray(restores) ? restores : [];
    return list
      .map((r: any) => (r?.rawData || r))
      .filter((raw: any) => {
        // 排除克隆任务
        const hasCloneMark = !!raw?.metadata?.annotations?.['tower.io/cloneTask'] || !!raw?.metadata?.annotations?.['tower.io/clone'];
        if (hasCloneMark) return false;
        
        // 包含恢复任务标记
        const hasRestoreMark = !!raw?.metadata?.annotations?.['tower.io/restoreTask'];
        const name = String(raw?.metadata?.name || '');
        const looksLikeRestore = name.startsWith('restore-');
        
        return hasRestoreMark || looksLikeRestore;
      });
  }, [restores]);

  // 获取恢复任务关联的备份/快照
  const backupIndex = useMemo(() => {
    const list = Array.isArray(backups) ? backups : [];
    const index = new Map<string, any>();
    list.forEach((b: any) => {
      const raw = b?.rawData || b;
      const ns = String(raw?.metadata?.namespace || '');
      const name = String(raw?.metadata?.name || '');
      if (ns && name) {
        index.set(`${ns}/${name}`, raw);
      }
    });
    return index;
  }, [backups]);

  const dataSource = useMemo(() => {
    return normalizeRestores.map((r: any) => {
      const ns = String(r?.metadata?.namespace || '');
      const name = String(r?.metadata?.name || '');
      const target = String(r?.spec?.target?.name || '');
      const backupName = String(r?.spec?.virtualMachineBackupName || '');
      const backupNs = String(r?.spec?.virtualMachineBackupNamespace || ns);
      const backup = backupName ? backupIndex.get(`${backupNs}/${backupName}`) : null;
      const sourceVm = String(backup?.spec?.source?.name || '');
      const restoreMode = r?.metadata?.annotations?.['tower.io/restoreMode'] || (r?.spec?.newVM ? 'new' : 'replace');
      const resourceType = backup?.spec?.type || 'backup';
      const restoreStatus = getRestoreStatus(r);

      return {
        key: r?.metadata?.uid || `${ns}/${name}`,
        namespace: ns,
        restoreName: name,
        targetVm: target || '-',
        sourceVm: sourceVm || '-',
        backupName: backupName || '-',
        restoreMode: restoreMode === 'new' ? '新建' : '替换',
        resourceType: resourceType === 'snapshot' ? '快照' : '备份',
        restoreRaw: r,
        backupRaw: backup,
        restoreStatus: restoreStatus,
        creationTimestamp: r?.metadata?.creationTimestamp || '',
      };
    }).sort((a, b) => {
      const parseTs = (t: any) => {
        if (!t) return 0;
        const n = Date.parse(String(t));
        return Number.isFinite(n) ? n : 0;
      };
      return parseTs(b.creationTimestamp) - parseTs(a.creationTimestamp);
    });
  }, [normalizeRestores, backupIndex]);

  const filtered = useMemo(() => {
    let d = dataSource;
    if (isTenant) {
      d = d.filter((x: any) => {
        const ns = String(x?.namespace || '').toLowerCase();
        return !isPublicNamespace(ns) && !isSystemNamespace(ns);
      });
    }
    if (statusFilter !== 'all') {
      d = d.filter((x: any) => {
        const rsSt = x.restoreStatus || { phase: 'pending' };
        if (statusFilter === 'pending') return rsSt.phase === 'pending';
        if (statusFilter === 'failed') return rsSt.phase === 'failed';
        if (statusFilter === 'ready') return rsSt.phase === 'ready';
        return true;
      });
    }
    if (keyword) {
      const k = keyword.toLowerCase();
      d = d.filter((x: any) => {
        return (
          String(x.namespace || '').toLowerCase().includes(k) ||
          String(x.sourceVm || '').toLowerCase().includes(k) ||
          String(x.targetVm || '').toLowerCase().includes(k) ||
          String(x.backupName || '').toLowerCase().includes(k) ||
          String(x.restoreName || '').toLowerCase().includes(k)
        );
      });
    }
    return d;
  }, [dataSource, isTenant, keyword, statusFilter]);

  const refresh = useCallback(async (force = true) => {
    setLoading(true);
    try {
      const [bkRes, rsRes] = await Promise.all([
        fetchHarvesterBackups(cloudId, force, false),
        fetchHarvesterVirtualMachineRestores(cloudId, force),
      ]);
      const bkItems: any[] = Array.isArray((bkRes as any)?.data?.items) ? (bkRes as any).data.items : [];
      const rsItems: any[] = Array.isArray((rsRes as any)?.items) ? (rsRes as any).items : Array.isArray((rsRes as any)?.data?.items) ? (rsRes as any).data.items : [];
      setBackups(bkItems);
      setRestores(rsItems);
    } catch (e: any) {
      message.error(e?.message || '刷新失败');
    } finally {
      setLoading(false);
    }
  }, [cloudId, message]);

  const openDrawer = (record: any, kind: string, viewLink: string, tab: string = 'detail') => {
    const r = { ...(record || {}), kind, links: { ...(record?.links || {}), view: viewLink } };
    setDrawerRecord(r);
    setDrawerActiveTab(tab);
    setDrawerVisible(true);
  };

  const deleteTask = (row: any) => {
    modal.confirm({
      title: '确认删除恢复任务？',
      content: `将删除恢复任务 ${row.restoreName}，该操作不可恢复。`,
      okText: '删除',
      okType: 'danger',
      cancelText: '取消',
      onOk: async () => {
        const hide = message.loading('正在删除...', 0);
        try {
          const ns = String(row.namespace || '');
          if (row.restoreRaw && row.restoreName && row.restoreName !== '-') {
            await deleteHarvesterVirtualMachineRestore(cloudId, ns, row.restoreName);
          }
          message.success('删除成功');
          await refresh(true);
        } catch (e: any) {
          message.error(e?.message || '删除失败');
        } finally {
          hide();
        }
      },
    });
  };

  useEffect(() => {
    refresh(true);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = null;
    };
  }, [refresh]);

  useEffect(() => {
    const hasPending = filtered.some((x: any) => {
      const rsSt = x.restoreStatus || { phase: 'pending' };
      return rsSt.phase === 'pending';
    });
    if (!hasPending) {
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = null;
      return;
    }
    if (!timerRef.current) {
      // 改为 5 秒轮询，与备份快照保持一致
      timerRef.current = setInterval(() => {
        refresh(true);
      }, 5000);
    }
    return () => {};
  }, [filtered, refresh]);

  const columns: any[] = [
    { title: '命名空间', dataIndex: 'namespace', key: 'namespace', ellipsis: true },
    { title: '源虚拟机', dataIndex: 'sourceVm', key: 'sourceVm', ellipsis: true },
    { title: '目标虚拟机', dataIndex: 'targetVm', key: 'targetVm', ellipsis: true },
    { 
      title: '恢复模式', 
      dataIndex: 'restoreMode', 
      key: 'restoreMode',
      render: (mode: string) => {
        return <Tag color={mode === '新建' ? 'blue' : 'orange'}>{mode}</Tag>;
      }
    },
    { 
      title: '资源类型', 
      dataIndex: 'resourceType', 
      key: 'resourceType',
      render: (type: string) => {
        return <Tag color={type === '快照' ? 'purple' : 'cyan'}>{type}</Tag>;
      }
    },
    {
      title: '状态',
      key: 'restoreStatus',
      render: (_: any, r: any) => {
        if (!r.restoreRaw) return <Badge status="default" text="-" />;
        const st = r.restoreStatus || getRestoreStatus(r.restoreRaw);
        if (st.phase === 'ready') return <Badge status="success" text={st.text} />;
        if (st.phase === 'failed') return <Badge status="error" text={st.text} />;
        return <Badge status="processing" text={st.text} />;
      },
    },
    {
      title: '进度',
      key: 'progress',
      width: 150,
      render: (_: any, r: any) => {
        if (!r.restoreRaw) return <Progress percent={0} status="exception" size="small" />;
        const st = r.restoreStatus || getRestoreStatus(r.restoreRaw);
        if (st.phase === 'failed') {
          return <Progress percent={0} status="exception" size="small" />;
        }
        if (st.phase === 'ready') {
          return <Progress percent={100} status="success" size="small" />;
        }
        // 如果进度为 0 但任务正在进行中，显示 70% 而不是 0%
        const displayProgress = st.progress === 0 && st.phase === 'pending' ? 70 : st.progress;
        return <Progress percent={displayProgress} status="active" size="small" />;
      },
    },
    {
      title: '创建时间',
      dataIndex: 'creationTimestamp',
      key: 'creationTimestamp',
      render: (t: any) => {
        const n = Date.parse(String(t || ''));
        return Number.isFinite(n) ? new Date(n).toLocaleString() : '-';
      },
    },
    {
      title: '操作',
      key: 'actions',
      width: 80,
      render: (_: any, r: any) => {
        const ns = String(r.namespace || '');
        const items: MenuProps['items'] = [
          ...(r.backupRaw ? [{
            key: 'backup_detail',
            label: `${r.resourceType}详情`,
            onClick: () => {
              const name = String(r.backupName || '');
              const view = `/apis/harvesterhci.io/v1beta1/namespaces/${encodeURIComponent(ns)}/virtualmachinebackups/${encodeURIComponent(name)}`;
              openDrawer(r.backupRaw, 'VirtualMachineBackup', view, 'detail');
            }
          }] : []),
          ...(r.restoreRaw ? [{
            key: 'restore_detail',
            label: '恢复任务详情',
            onClick: () => {
              const name = String(r.restoreName || '');
              const view = `/apis/harvesterhci.io/v1beta1/namespaces/${encodeURIComponent(ns)}/virtualmachinerestores/${encodeURIComponent(name)}`;
              openDrawer(r.restoreRaw, 'VirtualMachineRestore', view, 'detail');
            }
          }] : []),
          { type: 'divider' },
          { key: 'delete', label: '删除任务', danger: true, onClick: () => deleteTask(r) },
        ];
        return (
          <Dropdown menu={{ items }} trigger={['click']}>
            <Button className="row-actions-trigger" icon={<EllipsisOutlined />} />
          </Dropdown>
        );
      },
    },
  ];

  return (
    <PageDetailSection
      asCard={false}
      toolbarLeft={(
        <>
          <Input
            allowClear
            placeholder="关键字"
            className="toolbar-search"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            suffix={<SearchOutlined style={{ color: 'rgba(0,0,0,.45)' }} />}
          />
          <Select
            placeholder="状态"
            className="toolbar-filter-sm"
            value={statusFilter}
            onChange={setStatusFilter}
            options={[
              { value: 'all', label: '全部' },
              { value: 'pending', label: '进行中' },
              { value: 'ready', label: '完成' },
              { value: 'failed', label: '失败' },
            ]}
          />
          <button
            type="button"
            className="toolbar-reset-btn"
            onClick={() => {
              setKeyword('');
              setStatusFilter('all');
            }}
          >
            重置
          </button>
        </>
      )}
      toolbarRight={
        <>
          <Button icon={<ReloadOutlined />} onClick={() => refresh(true)} loading={loading} />
        </>
      }
    >
      <Table
        className="std-table"
        bordered={false}
        rowKey={(r: any) => r.key}
        columns={columns}
        dataSource={filtered}
        loading={loading}
        pagination={{ size: 'small', showQuickJumper: false }}
      />

      <HarvesterResourceDrawer
        open={drawerVisible}
        onClose={() => setDrawerVisible(false)}
        resourceType="HarvesterResource"
        record={drawerRecord}
        cloudId={cloudId}
        activeTab={drawerActiveTab}
        onTabChange={setDrawerActiveTab}
      />
    </PageDetailSection>
  );
};

export default VmRestoreTasksSection;
