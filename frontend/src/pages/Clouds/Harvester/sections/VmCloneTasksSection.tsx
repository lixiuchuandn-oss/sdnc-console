import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { App, Badge, Button, Dropdown, Input, Select, Table, Tag } from 'antd';
import type { MenuProps } from 'antd';
import { EllipsisOutlined, ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import PageDetailSection from '../../../../components/PageDetailSection';
import HarvesterResourceDrawer from '../components/HarvesterOpsinfoDrawer';
import { deleteHarvesterBackup, deleteHarvesterVirtualMachineRestore, fetchHarvesterBackups, fetchHarvesterVirtualMachineRestores } from '../../../../services/harvesterApi';
import { apiRequest } from '../../../../services/api';
import { isPublicNamespace, isSystemNamespace, getVmCloneTaskStatus } from '../../../../utils/harvesterUtils';

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
  if (failed) return { phase: 'failed', text: '失败' as const };
  const conds: any[] = Array.isArray(raw?.status?.conditions) ? raw.status.conditions : [];
  const ready = conds.some((c: any) => String(c?.type || '').toLowerCase() === 'ready' && String(c?.status || '').toLowerCase() === 'true');
  const completed = conds.some((c: any) => String(c?.type || '').toLowerCase() === 'completed' && String(c?.status || '').toLowerCase() === 'true');
  if (ready || completed) return { phase: 'ready', text: '完成' as const };
  return { phase: 'pending', text: '进行中' as const };
};

const getSnapshotStatus = (raw: any) => {
  const failed = isFailedByConditions(raw);
  if (failed) return { phase: 'failed', text: '失败' as const };
  const ready = !!raw?.status?.readyToUse;
  if (ready) return { phase: 'ready', text: '就绪' as const };
  return { phase: 'pending', text: '未就绪' as const };
};

const VmCloneTasksSection: React.FC<Props> = ({ cloudId, isTenant }) => {
  const { modal, message } = App.useApp();
  const [keyword, setKeyword] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [loading, setLoading] = useState(false);
  const [backups, setBackups] = useState<any[]>([]);
  const [restores, setRestores] = useState<any[]>([]);
  const [vms, setVms] = useState<any[]>([]);

  const [drawerVisible, setDrawerVisible] = useState(false);
  const [drawerRecord, setDrawerRecord] = useState<any>(null);
  const [drawerActiveTab, setDrawerActiveTab] = useState('detail');

  const timerRef = useRef<any>(null);

  const normalizeBackups = useMemo(() => {
    const list = Array.isArray(backups) ? backups : [];
    return list
      .map((b: any) => {
        const raw = b?.rawData || b;
        return raw;
      })
      .filter((raw: any) => {
        const type = raw?.spec?.type || 'backup';
        if (type !== 'snapshot') return false;
        const name = String(raw?.metadata?.name || '');
        const hasCloneMark = !!raw?.metadata?.annotations?.['tower.io/cloneTask'] || !!raw?.metadata?.annotations?.['tower.io/clone'];
        const looksLikeClone = name.startsWith('clone-');
        return hasCloneMark || looksLikeClone;
      });
  }, [backups]);

  const normalizeRestores = useMemo(() => {
    const list = Array.isArray(restores) ? restores : [];
    return list
      .map((r: any) => (r?.rawData || r))
      .filter((raw: any) => {
        const name = String(raw?.metadata?.name || '');
        const hasCloneMark = !!raw?.metadata?.annotations?.['tower.io/cloneTask'] || !!raw?.metadata?.annotations?.['tower.io/clone'];
        const looksLikeClone = name.startsWith('clone-') || name.includes('clone');
        return hasCloneMark || looksLikeClone;
      });
  }, [restores]);

  // 识别标准克隆方式的 VM
  const normalizeStandardCloneVms = useMemo(() => {
    const list = Array.isArray(vms) ? vms : [];
    return list
      .map((v: any) => {
        const raw = v?.rawData || v?.metadata ? v : null;
        if (!raw) return null;
        const cloneTaskAnno = raw?.metadata?.annotations?.['tower.io/cloneTask'];
        if (!cloneTaskAnno) return null;
        
        try {
          const cloneInfo = JSON.parse(cloneTaskAnno);
          if (cloneInfo.cloneType === 'standard') {
            return {
              vm: raw,
              cloneInfo,
              namespace: raw?.metadata?.namespace || '',
              name: raw?.metadata?.name || '',
              targetVm: raw?.metadata?.name || '',
              sourceVm: cloneInfo.sourceVmName || cloneInfo.sourceVm?.split('/')?.[1] || '-',
              sourceVmNamespace: cloneInfo.sourceVmNamespace || cloneInfo.sourceVm?.split('/')?.[0] || '',
            };
          }
        } catch (e) {
          // 忽略解析错误
        }
        return null;
      })
      .filter((x: any) => x !== null);
  }, [vms]);

  const dataSource = useMemo(() => {
    const rows: any[] = [];
    const backupIndex = new Map<string, any>();
    normalizeBackups.forEach((b: any) => {
      const ns = String(b?.metadata?.namespace || '');
      const name = String(b?.metadata?.name || '');
      if (ns && name) backupIndex.set(`${ns}/${name}`, b);
    });

    // 添加旧的快照+恢复方式的克隆任务
    normalizeRestores.forEach((r: any) => {
      const ns = String(r?.metadata?.namespace || '');
      const name = String(r?.metadata?.name || '');
      const target = String(r?.spec?.target?.name || '');
      const backupName = String(r?.spec?.virtualMachineBackupName || '');
      const backupNs = String(r?.spec?.virtualMachineBackupNamespace || ns);
      const backup = backupName ? backupIndex.get(`${backupNs}/${backupName}`) : null;
      const sourceVm = String(backup?.spec?.source?.name || '');

      rows.push({
        key: r?.metadata?.uid || `${ns}/${name}`,
        namespace: ns,
        restoreName: name,
        targetVm: target || '-',
        backupName: backupName || '-',
        sourceVm: sourceVm || '-',
        restoreRaw: r,
        backupRaw: backup,
        cloneType: 'snapshot-restore',
        creationTimestamp: r?.metadata?.creationTimestamp || backup?.metadata?.creationTimestamp || '',
      });
    });

    normalizeBackups.forEach((b: any) => {
      const ns = String(b?.metadata?.namespace || '');
      const name = String(b?.metadata?.name || '');
      const hasRestore = normalizeRestores.some((r: any) => {
        const backupName = String(r?.spec?.virtualMachineBackupName || '');
        const backupNs = String(r?.spec?.virtualMachineBackupNamespace || r?.metadata?.namespace || '');
        return backupName === name && backupNs === ns;
      });
      if (hasRestore) return;
      rows.push({
        key: b?.metadata?.uid || `${ns}/${name}`,
        namespace: ns,
        restoreName: '-',
        targetVm: '-',
        backupName: name,
        sourceVm: String(b?.spec?.source?.name || '-') || '-',
        restoreRaw: null,
        backupRaw: b,
        cloneType: 'snapshot-restore',
        creationTimestamp: b?.metadata?.creationTimestamp || '',
      });
    });

    // 添加标准克隆方式的 VM（仅根据 VM 状态判断任务是否结束）
    normalizeStandardCloneVms.forEach((item: any) => {
      const vm = item.vm;
      const ns = item.namespace;
      const name = item.name;
      const taskStatus = getVmCloneTaskStatus(vm);

      rows.push({
        key: vm?.metadata?.uid || `${ns}/${name}`,
        namespace: ns,
        restoreName: '-',
        targetVm: item.targetVm,
        backupName: '-',
        sourceVm: item.sourceVm,
        restoreRaw: null,
        backupRaw: null,
        vmRaw: vm,
        cloneType: 'standard',
        cloneInfo: item.cloneInfo,
        progressPhase: taskStatus.phase,
        progressText: taskStatus.text,
        creationTimestamp: vm?.metadata?.creationTimestamp || item.cloneInfo?.createdAt || '',
      });
    });

    const parseTs = (t: any) => {
      if (!t) return 0;
      const n = Date.parse(String(t));
      return Number.isFinite(n) ? n : 0;
    };
    return rows.sort((a, b) => parseTs(b.creationTimestamp) - parseTs(a.creationTimestamp));
  }, [normalizeBackups, normalizeRestores, normalizeStandardCloneVms]);

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
        if (x.cloneType === 'standard') {
          const phase = x.progressPhase || 'pending';
          if (statusFilter === 'pending') return phase === 'pending';
          if (statusFilter === 'failed') return phase === 'failed';
          if (statusFilter === 'ready') return phase === 'ready';
          return true;
        } else {
          const bk = x.backupRaw;
          const rs = x.restoreRaw;
          const bkSt = bk ? getSnapshotStatus(bk) : { phase: 'pending' };
          const rsSt = rs ? getRestoreStatus(rs) : { phase: 'pending' };
          if (statusFilter === 'pending') return bkSt.phase === 'pending' || rsSt.phase === 'pending';
          if (statusFilter === 'failed') return bkSt.phase === 'failed' || rsSt.phase === 'failed';
          if (statusFilter === 'ready') return (bkSt.phase === 'ready' && (rs ? rsSt.phase === 'ready' : true));
          return true;
        }
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
      const [bkRes, rsRes, vmsRes] = await Promise.all([
        fetchHarvesterBackups(cloudId, force, false),
        fetchHarvesterVirtualMachineRestores(cloudId, force),
        apiRequest(`/api/clouds/${cloudId}/resources/ecs${force ? '?force=true' : ''}`),
      ]);
      const bkItems: any[] = Array.isArray((bkRes as any)?.data?.items) ? (bkRes as any).data.items : [];
      const rsItems: any[] = Array.isArray((rsRes as any)?.items) ? (rsRes as any).items : Array.isArray((rsRes as any)?.data?.items) ? (rsRes as any).data.items : [];
      const vmsItems: any[] = Array.isArray((vmsRes as any)?.data) ? (vmsRes as any).data : [];
      
      setBackups(bkItems);
      setRestores(rsItems);
      setVms(vmsItems);
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
      title: '确认删除克隆任务？',
      content: `将删除恢复任务 ${row.restoreName !== '-' ? row.restoreName : '-'} 与快照 ${row.backupName}，该操作不可恢复。`,
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
          if (row.backupRaw && row.backupName && row.backupName !== '-') {
            await deleteHarvesterBackup(cloudId, ns, row.backupName);
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
      if (x.cloneType === 'standard') {
        const phase = x.progressPhase || 'pending';
        return phase === 'pending';
      }
      const bk = x.backupRaw;
      const rs = x.restoreRaw;
      const bkSt = bk ? getSnapshotStatus(bk) : { phase: 'pending' };
      const rsSt = rs ? getRestoreStatus(rs) : { phase: 'pending' };
      return bkSt.phase === 'pending' || rsSt.phase === 'pending';
    });
    if (!hasPending) {
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = null;
      return;
    }
    if (!timerRef.current) {
      timerRef.current = setInterval(() => {
        refresh(true);
      }, 10000);
    }
    return () => {};
  }, [filtered, refresh]);

  const columns: any[] = [
    { title: '命名空间', dataIndex: 'namespace', key: 'namespace', ellipsis: true },
    { title: '源虚拟机', dataIndex: 'sourceVm', key: 'sourceVm', ellipsis: true },
    { title: '目标虚拟机', dataIndex: 'targetVm', key: 'targetVm', ellipsis: true },
    {
      title: '克隆点',
      key: 'backupStatus',
      render: (_: any, r: any) => {
        if (r.cloneType === 'standard') return <Badge status="default" text="标准克隆" />;
        if (!r.backupRaw) return <Badge status="default" text="-" />;
        const st = getSnapshotStatus(r.backupRaw);
        if (st.phase === 'ready') return <Badge status="success" text={st.text} />;
        if (st.phase === 'failed') return <Badge status="error" text={st.text} />;
        return <Badge status="warning" text={st.text} />;
      },
    },
    {
      title: '恢复/状态',
      key: 'restoreStatus',
      render: (_: any, r: any) => {
        if (r.cloneType === 'standard') {
          const phase = r.progressPhase || 'pending';
          const text = r.progressText || '进行中';
          if (phase === 'ready') {
            return <Badge status="success" text={text} />;
          }
          if (phase === 'failed') {
            return <Badge status="error" text="失败" />;
          }
          return <Badge status="processing" text={text} />;
        }
        if (!r.restoreRaw) return <Badge status="default" text="-" />;
        const st = getRestoreStatus(r.restoreRaw);
        if (st.phase === 'ready') return <Badge status="success" text={st.text} />;
        if (st.phase === 'failed') return <Badge status="error" text={st.text} />;
        return <Badge status="processing" text={st.text} />;
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
          ...(r.cloneType === 'standard' && r.vmRaw ? [{
            key: 'vm_detail',
            label: '虚拟机详情',
            onClick: () => {
              const name = String(r.targetVm || '');
              const view = `/apis/kubevirt.io/v1/namespaces/${encodeURIComponent(ns)}/virtualmachines/${encodeURIComponent(name)}`;
              openDrawer(r.vmRaw, 'VirtualMachine', view, 'detail');
            }
          }] : []),
          ...(r.backupRaw ? [{
            key: 'backup_detail',
            label: '克隆点详情',
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
          ...(r.cloneType === 'standard' ? [] : [{ key: 'delete', label: '删除任务', danger: true, onClick: () => deleteTask(r) }]),
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

export default VmCloneTasksSection;
