import React from 'react';
import type { ColumnsType } from 'antd/es/table';
import type { MenuProps } from 'antd';
import { Badge, Button, Dropdown, Progress, Tag } from 'antd';
import { CloudServerOutlined, EllipsisOutlined, UndoOutlined } from '@ant-design/icons';
import { isHarvesterCephVmRestore } from '../../../../../../utils/harvesterUtils';
import { resolveHarvesterSteveViewLink } from '../../shared/lib/harvesterSteveViewLink';
import { CbrEllipsisTooltip } from './cbrTableCells';
import { getRestoreStatus, vmLineDisplay, type VmRestoreTaskListRow } from './vmRestoreTasksSectionUtils';

export type VmRestoreTasksTableActions = {
  onOpenYaml: (record: unknown, kind: string, viewLink: string, title: string) => void;
};

export function buildVmRestoreTasksTableColumns(
  actions: VmRestoreTasksTableActions,
): ColumnsType<VmRestoreTaskListRow> {
  const { onOpenYaml } = actions;

  return [
    {
      title: '任务名称',
      dataIndex: 'restoreName',
      key: 'restoreName',
      fixed: 'left',
      render: (_: unknown, r: VmRestoreTaskListRow) => {
        const n = String(r.restoreName || '').trim() || '—';
        return (
          <CbrEllipsisTooltip
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
        <CbrEllipsisTooltip mono text={String(ns || '') || '—'} />
      ),
    },
    {
      title: '源虚拟机',
      key: 'sourceVm',
      render: (_: unknown, r: VmRestoreTaskListRow) => {
        const line = vmLineDisplay(
          r.sourceVmAlias !== '-' ? r.sourceVmAlias : undefined,
          r.sourceVm !== '-' ? r.sourceVm : '-',
        );
        return (
          <CbrEllipsisTooltip
            text={line}
            icon={<CloudServerOutlined style={{ color: '#1677ff', fontSize: 16 }} />}
          />
        );
      },
    },
    {
      title: '目标虚拟机',
      key: 'targetVm',
      render: (_: unknown, r: VmRestoreTaskListRow) => {
        const line = vmLineDisplay(
          r.targetVmAlias !== '-' ? r.targetVmAlias : undefined,
          r.targetVm !== '-' ? r.targetVm : '-',
        );
        return (
          <CbrEllipsisTooltip
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
      align: 'center',
      render: (mode: string) => <Tag color={mode === '新建' ? 'blue' : 'orange'}>{mode}</Tag>,
    },
    {
      title: '资源类型',
      dataIndex: 'resourceType',
      key: 'resourceType',
      align: 'center',
      render: (type: string) => (
        <Tag color={type === '快照' ? 'purple' : 'cyan'}>{type}</Tag>
      ),
    },
    {
      title: '状态',
      key: 'restoreStatus',
      align: 'center',
      render: (_: unknown, r: VmRestoreTaskListRow) => {
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
      render: (_: unknown, r: VmRestoreTaskListRow) => {
        if (!r.restoreRaw) return <Progress percent={0} status="exception" size="small" />;
        const st = r.restoreStatus || getRestoreStatus(r.restoreRaw);
        if (st.phase === 'failed') {
          return <Progress percent={0} status="exception" size="small" />;
        }
        if (st.phase === 'ready') {
          return <Progress percent={100} status="success" size="small" />;
        }
        const displayProgress = st.progress === 0 && st.phase === 'pending' ? 70 : st.progress;
        return <Progress percent={displayProgress} status="active" size="small" />;
      },
    },
    {
      title: '创建时间',
      dataIndex: 'creationTimestamp',
      key: 'creationTimestamp',
      render: (t: unknown) => {
        const n = Date.parse(String(t || ''));
        const show = Number.isFinite(n) ? new Date(n).toLocaleString() : '-';
        if (show === '-') return show;
        return <CbrEllipsisTooltip text={show} />;
      },
    },
    {
      title: '操作',
      key: 'actions',
      fixed: 'right',
      render: (_: unknown, r: VmRestoreTaskListRow) => {
        const ns = String(r.namespace || '');
        const items: MenuProps['items'] = r.restoreRaw
          ? [
              {
                key: 'restore_yaml',
                label: '查看YAML',
                onClick: () => {
                  const name = String(r.restoreName || '');
                  const rawRestore = r.restoreRaw || {};
                  const isCeph =
                    r.restoreBackend === 'ceph' || isHarvesterCephVmRestore(rawRestore);
                  const kind = isCeph ? 'CephVmRestore' : 'VirtualMachineRestore';
                  const view =
                    resolveHarvesterSteveViewLink({ ...(rawRestore as object), kind }) ||
                    (isCeph
                      ? `/apis/hms.rivercloud.com/v1/namespaces/${encodeURIComponent(ns)}/cephvmrestores/${encodeURIComponent(name)}`
                      : `/apis/harvesterhci.io/v1beta1/namespaces/${encodeURIComponent(ns)}/virtualmachinerestores/${encodeURIComponent(name)}`);
                  onOpenYaml(rawRestore, kind, view, '恢复任务 YAML');
                },
              },
            ]
          : [];
        return (
          <Dropdown menu={{ items }} trigger={['click']}>
            <Button className="row-actions-trigger" icon={<EllipsisOutlined />} />
          </Dropdown>
        );
      },
    },
  ];
}
