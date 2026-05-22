import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { App, Badge, Button, Dropdown, Input, Progress, Select, Table, Tag, Tooltip } from 'antd';
import type { MenuProps } from 'antd';
import { CloudServerOutlined, EllipsisOutlined, ReloadOutlined, SearchOutlined, UndoOutlined } from '@ant-design/icons';
import PageDetailSection from '../../../../../../components/PageDetailSection';
import { ResourceLinkYamlDrawer } from '../../shared/components/ResourceLinkYamlDrawer';
import { useHarvesterResourceLinkYamlDrawer } from '../../shared/lib/useHarvesterResourceLinkYamlDrawer';
import { deleteHarvesterBackup, deleteHarvesterVirtualMachineRestore, fetchHarvesterBackups, fetchHarvesterVirtualMachineRestores } from '../../../../../../services/harvesterApi';
import { isSystemNamespace } from '../../../../../../utils/harvesterUtils';
import { useHarvesterPublicNamespaces } from '../../context/HarvesterPublicNamespacesContext';

type Props = {
  cloudId: string;
  isTenant?: boolean;
  vms?: any[]; // 虚拟机列表，用于查找别名
};

/** 列表展示：别名中已含技术名/ID 时不再重复追加括注 */
function vmLineDisplay(alias: string | undefined, technical: string): string {
  const id = String(technical || '').trim();
  const a = String(alias || '').trim();
  if (!id || id === '-') return a || '-';
  if (!a || a === '-') return id;
  if (a === id) return id;
  if (a.includes(id)) return a;
  return `${a} (${id})`;
}

const EllipsisTooltip: React.FC<{
  text: string;
  mono?: boolean;
  icon?: React.ReactNode;
}> = ({ text, mono, icon }) => (
  <span style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, width: '100%' }}>
    {icon ? <span style={{ flexShrink: 0 }}>{icon}</span> : null}
    <Tooltip placement="topLeft" title={text}>
      <span
        className={mono ? 'table-mono-uuid' : undefined}
        style={{
          flex: 1,
          minWidth: 0,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {text}
      </span>
    </Tooltip>
  </span>
);

/**
 * 是否已终态失败。恢复/替换 VM 过程中源机关机、磁盘替换、目标机再启动等阶段
 * Ready 经常为 false，消息里也可能出现 error 子串（如 “no error”），不能据此判失败。
 * 仅在 phase 明确失败，或存在 type=Failed/Error 且 status=True 的条件时判失败。
 */
const isFailedByConditions = (raw: any) => {
  const phase = String(raw?.status?.phase || '').toLowerCase();
  if (phase === 'failed' || phase === 'error') return true;
  const conds: any[] = Array.isArray(raw?.status?.conditions) ? raw.status.conditions : [];
  return conds.some((c: any) => {
    const type = String(c?.type || '').toLowerCase();
    const status = String(c?.status || '').toLowerCase();
    if (status === 'true' && (type === 'failed' || type === 'error')) return true;
    // Ready=false 仅表示尚未完成，不等价于失败（与列表“进行中”语义一致）
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

const VmRestoreTasksSection: React.FC<Props> = ({ cloudId, isTenant, vms = [] }) => {
  const { isPublicNamespace } = useHarvesterPublicNamespaces();
  const { modal, message } = App.useApp();
  const [keyword, setKeyword] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [namespaceFilter, setNamespaceFilter] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [backups, setBackups] = useState<any[]>([]);
  const [restores, setRestores] = useState<any[]>([]);

  const { yamlDrawerOpen, yamlViewLink, yamlDrawerTitle, openYamlDrawer, closeYamlDrawer } =
    useHarvesterResourceLinkYamlDrawer(cloudId);

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
      const ann = (r?.metadata?.annotations || {}) as Record<string, string>;
      const annSourceAlias = String(ann['tower.io/restoreSourceVmAlias'] || '').trim();
      const annTargetDisp = String(ann['tower.io/restoreTargetDisplayName'] || '').trim();

      // 获取源虚拟机别名
      let sourceVmAlias = '-';
      if (annSourceAlias) {
        sourceVmAlias = annSourceAlias;
      } else if (sourceVm && sourceVm !== '-') {
        try {
          const vm = (vms || []).find((vm: any) => {
            const vmNs = vm?.metadata?.namespace || vm?.namespace;
            const vmName = vm?.metadata?.name || vm?.name;
            return vmNs === ns && vmName === sourceVm;
          });
          if (vm) {
            sourceVmAlias = vm?.metadata?.annotations?.['tower.io/alias'] || vm?.alias || sourceVm || '-';
          } else {
            sourceVmAlias = sourceVm;
          }
        } catch {}
      }

      // 获取目标虚拟机别名
      let targetVmAlias = '-';
      if (annTargetDisp) {
        targetVmAlias = annTargetDisp;
      } else if (target && target !== '-') {
        try {
          const vm = (vms || []).find((vm: any) => {
            const vmNs = vm?.metadata?.namespace || vm?.namespace;
            const vmName = vm?.metadata?.name || vm?.name;
            return vmNs === ns && vmName === target;
          });
          if (vm) {
            targetVmAlias = vm?.metadata?.annotations?.['tower.io/alias'] || vm?.alias || target || '-';
          } else {
            targetVmAlias = target;
          }
        } catch {}
      }

      return {
        key: r?.metadata?.uid || `${ns}/${name}`,
        namespace: ns,
        restoreName: name,
        targetVm: target || '-',
        targetVmAlias: targetVmAlias,
        sourceVm: sourceVm || '-',
        sourceVmAlias: sourceVmAlias,
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
  }, [normalizeRestores, backupIndex, vms]);

  const filtered = useMemo(() => {
    let d = dataSource;
    if (isTenant) {
      d = d.filter((x: any) => {
        const ns = String(x?.namespace || '').toLowerCase();
        return !isPublicNamespace(ns) && !isSystemNamespace(ns);
      });
    }
    if (statusFilter) {
      d = d.filter((x: any) => {
        const rsSt = x.restoreStatus || { phase: 'pending' };
        if (statusFilter === 'pending') return rsSt.phase === 'pending';
        if (statusFilter === 'failed') return rsSt.phase === 'failed';
        if (statusFilter === 'ready') return rsSt.phase === 'ready';
        return true;
      });
    }
    if (namespaceFilter) {
      d = d.filter((x: any) => String(x.namespace || '') === namespaceFilter);
    }
    if (keyword) {
      const k = keyword.toLowerCase();
      d = d.filter((x: any) => {
        return (
          String(x.namespace || '').toLowerCase().includes(k) ||
          String(x.sourceVm || '').toLowerCase().includes(k) ||
          String(x.sourceVmAlias || '').toLowerCase().includes(k) ||
          String(x.targetVm || '').toLowerCase().includes(k) ||
          String(x.targetVmAlias || '').toLowerCase().includes(k) ||
          String(x.backupName || '').toLowerCase().includes(k) ||
          String(x.restoreName || '').toLowerCase().includes(k)
        );
      });
    }
    return d;
  }, [dataSource, isTenant, keyword, statusFilter, namespaceFilter, isPublicNamespace]);

  const namespaceOptions = useMemo(() => {
    const set = new Set<string>();
    dataSource.forEach((x: any) => {
      const ns = String(x?.namespace || '').trim();
      if (!ns) return;
      if (isSystemNamespace(ns)) return;
      if (isTenant && isPublicNamespace(ns)) return;
      set.add(ns);
    });
    return Array.from(set).sort().map((v) => ({ value: v, label: v }));
  }, [dataSource, isTenant, isPublicNamespace]);

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

  const openYamlFromTask = useCallback(
    (record: any, kind: string, viewLink: string, title: string) => {
      openYamlDrawer(
        { ...(record || {}), kind, links: { ...(record?.links || {}), view: viewLink } },
        { title, resolveLink: () => viewLink },
      );
    },
    [openYamlDrawer],
  );

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

  // 监听恢复任务创建事件，创建后立即刷新
  useEffect(() => {
    const handleRestoreCreated = () => {
      // 延迟一小段时间，确保后端数据已更新
      setTimeout(() => {
        refresh(true);
      }, 1000);
    };
    window.addEventListener('harvester:restore-created', handleRestoreCreated);
    return () => {
      window.removeEventListener('harvester:restore-created', handleRestoreCreated);
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
    {
      title: '任务名称',
      dataIndex: 'restoreName',
      key: 'restoreName',
      render: (_: any, r: any) => {
        const n = String(r?.restoreName || r?.restoreRaw?.metadata?.name || '').trim() || '—';
        return (
          <EllipsisTooltip
            text={n}
            icon={<UndoOutlined style={{ color: '#1677ff', fontSize: 16 }} />}
          />
        );
      },
    },
    {
      title: '项目',
      dataIndex: 'namespace',
      key: 'namespace',
      render: (ns: string) => (
        <EllipsisTooltip mono text={String(ns || '') || '—'} />
      ),
    },
    {
      title: '源虚拟机',
      key: 'sourceVm',
      render: (_: any, r: any) => {
        const line = vmLineDisplay(
          r.sourceVmAlias !== '-' ? r.sourceVmAlias : undefined,
          r.sourceVm !== '-' ? r.sourceVm : '-',
        );
        return (
          <EllipsisTooltip
            text={line}
            icon={<CloudServerOutlined style={{ color: '#1677ff', fontSize: 16 }} />}
          />
        );
      },
    },
    {
      title: '目标虚拟机',
      key: 'targetVm',
      render: (_: any, r: any) => {
        const line = vmLineDisplay(
          r.targetVmAlias !== '-' ? r.targetVmAlias : undefined,
          r.targetVm !== '-' ? r.targetVm : '-',
        );
        return (
          <EllipsisTooltip
            text={line}
            icon={<CloudServerOutlined style={{ color: '#1677ff', fontSize: 16 }} />}
          />
        );
      },
    },
    { 
      title: '恢复模式', 
      dataIndex: 'restoreMode', 
      key: 'restoreMode',
      align: 'center' as const,
      render: (mode: string) => {
        return <Tag color={mode === '新建' ? 'blue' : 'orange'}>{mode}</Tag>;
      }
    },
    { 
      title: '资源类型', 
      dataIndex: 'resourceType', 
      key: 'resourceType',
      align: 'center' as const,
      render: (type: string) => {
        return <Tag color={type === '快照' ? 'purple' : 'cyan'}>{type}</Tag>;
      }
    },
    {
      title: '状态',
      key: 'restoreStatus',
      align: 'center' as const,
      render: (_: any, r: any) => {
        const inner = (() => {
          if (!r.restoreRaw) return <Badge status="default" text="-" />;
          const st = r.restoreStatus || getRestoreStatus(r.restoreRaw);
          if (st.phase === 'ready') return <Badge status="success" text={st.text} />;
          if (st.phase === 'failed') return <Badge status="error" text={st.text} />;
          return <Badge status="processing" text={st.text} />;
        })();
        return <span style={{ whiteSpace: 'nowrap' }}>{inner}</span>;
      },
    },
    {
      title: '进度',
      key: 'progress',
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
        const show = Number.isFinite(n) ? new Date(n).toLocaleString() : '-';
        if (show === '-') return show;
        return <EllipsisTooltip text={show} />;
      },
    },
    {
      title: '操作',
      key: 'actions',
      render: (_: any, r: any) => {
        const ns = String(r.namespace || '');
        const items: MenuProps['items'] = [
          ...(r.backupRaw ? [{
            key: 'backup_yaml',
            label: '查看YAML',
            onClick: () => {
              const name = String(r.backupName || '');
              const view = `/apis/harvesterhci.io/v1beta1/namespaces/${encodeURIComponent(ns)}/virtualmachinebackups/${encodeURIComponent(name)}`;
              openYamlFromTask(r.backupRaw, 'VirtualMachineBackup', view, '备份 YAML');
            },
          }] : []),
          ...(r.restoreRaw ? [{
            key: 'restore_yaml',
            label: '查看YAML',
            onClick: () => {
              const name = String(r.restoreName || '');
              const view = `/apis/harvesterhci.io/v1beta1/namespaces/${encodeURIComponent(ns)}/virtualmachinerestores/${encodeURIComponent(name)}`;
              openYamlFromTask(r.restoreRaw, 'VirtualMachineRestore', view, '恢复任务 YAML');
            },
          }] : []),
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
            placeholder="名称/ID"
            className="toolbar-search"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            suffix={<SearchOutlined style={{ color: 'rgba(0,0,0,.45)' }} />}
          />
          {!isTenant && (
            <Select
              allowClear
              showSearch
              placeholder="项目"
              className="toolbar-filter-sm"
              value={namespaceFilter || undefined}
              onChange={(v) => setNamespaceFilter((v as string) || '')}
              options={namespaceOptions}
            />
          )}
          <Select
            allowClear
            placeholder="状态"
            className="toolbar-filter-sm"
            value={statusFilter || undefined}
            onChange={(v) => setStatusFilter((v as string) || '')}
            options={[
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
              setStatusFilter('');
              setNamespaceFilter('');
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
        scroll={{ x: true }}
        bordered={false}
        rowKey={(r: any) => r.key}
        columns={columns}
        dataSource={filtered}
        loading={loading}
        tableLayout="fixed"
        pagination={{
          showTotal: (total) => `共 ${total} 条`,
        }}
      />

      <ResourceLinkYamlDrawer
        open={yamlDrawerOpen}
        onClose={closeYamlDrawer}
        cloudId={cloudId}
        viewLink={yamlViewLink}
        title={yamlDrawerTitle}
      />
    </PageDetailSection>
  );
};

export default VmRestoreTasksSection;
