import React, { useMemo } from 'react';
import type { MenuProps } from 'antd';
import { Badge, Progress, Tooltip, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { message } from 'antd';
import { LinkOutlined } from '@ant-design/icons';
import ResourceActionsDropdown from '../../../../components/ResourceActionsDropdown';
import { commonBadgeStyles, commonTableStyles } from '../../../../utils/tableStyles';
import { buildIbrLocalWebUrl, openIbrConsole } from '../lib/ibrLocalWebUrl';
import { ibrVrRowId } from '../lib/ibrVrCatalog';
import {
  VrRoleTag,
  collectVrPhysicalInterfaces,
  getVrHealthStatusKey,
  resolveVrWanEndpoint,
} from './vrListDisplay';
import { pickIfaceIpv6FromDevice } from './vrIpv6Utils';

export type VrListRow = Record<string, unknown> & {
  id?: string;
  vm_id?: string;
  name?: string;
  status?: string;
  uuid?: string;
  vr_unique_id?: string;
  role?: string;
  tenant_id?: string;
  org_id?: string;
  bind_status?: string;
  management_ip?: string;
  managementIp?: string;
  mac?: string;
  version?: string;
  type?: string;
  health_status?: unknown;
  healthStatus?: unknown;
  resourceIndicators?: unknown;
  interfaces?: unknown;
};

function parseJsonField(val: unknown): unknown {
  if (typeof val === 'string') {
    try {
      return JSON.parse(val);
    } catch {
      return null;
    }
  }
  return val;
}

function formatTrafficRateBps(bps: number): string {
  if (!bps) return '0 bps';
  if (bps >= 1000 * 1000) return `${(bps / 1000 / 1000).toFixed(2)} Mbps`;
  if (bps >= 1000) return `${(bps / 1000).toFixed(2)} Kbps`;
  return `${bps.toFixed(0)} bps`;
}

function renderVrStatus(raw: unknown): React.ReactNode {
  const key = getVrHealthStatusKey(raw);
  if (key === 'running') {
    return (
      <Badge
        status={commonBadgeStyles.statusMap.success.status}
        text={<span style={commonBadgeStyles.text}>运行中</span>}
      />
    );
  }
  if (key === 'warning') {
    return (
      <Badge
        status={commonBadgeStyles.statusMap.warning.status}
        text={<span style={commonBadgeStyles.text}>警告</span>}
      />
    );
  }
  if (key === 'stopped') {
    return (
      <Badge
        status={commonBadgeStyles.statusMap.error.status}
        text={<span style={commonBadgeStyles.text}>已停止</span>}
      />
    );
  }
  return (
    <Badge
      status={commonBadgeStyles.statusMap.default.status}
      text={<span style={commonBadgeStyles.text}>未知</span>}
    />
  );
}

type UseVrListColumnsParams = {
  rolesLoading: boolean;
  getActionMenu: (row: VrListRow) => MenuProps['items'];
  onRowAction: (row: VrListRow) => MenuProps['onClick'];
};

export function useVrListColumns(params: UseVrListColumnsParams): ColumnsType<VrListRow> {
  const { rolesLoading, getActionMenu, onRowAction } = params;

  return useMemo((): ColumnsType<VrListRow> => {
    return [
      {
        title: '名称',
        dataIndex: 'name',
        key: 'name',
        fixed: 'left',
        ellipsis: true,
        render: (text: unknown, row: VrListRow) => {
          const label = text != null && String(text).trim() !== '' ? String(text) : '—';
          const vrUuid = ibrVrRowId(row);
          if (!vrUuid) return label;
          return (
            <Typography.Link
              onClick={(e) => {
                e.stopPropagation();
                if (!openIbrConsole(vrUuid)) {
                  message.error('无法打开运维控制台');
                }
              }}
            >
              {label}
            </Typography.Link>
          );
        },
      },
      {
        title: 'UUID',
        key: 'uuid',
        ellipsis: { showTitle: false },
        render: (_v, row) => {
          const id = ibrVrRowId(row);
          if (!id) return '—';
          return <Typography.Text copyable={{ text: id }}>{id}</Typography.Text>;
        },
      },
      {
        title: '状态',
        key: 'status',
        render: (_v, row) => renderVrStatus(row.health_status ?? row.healthStatus ?? row.status),
      },
      {
        title: '角色',
        key: 'role',
        render: (_v, row) => <VrRoleTag role={row.role} loading={rolesLoading} />,
      },
      {
        title: '管理 IP',
        key: 'management_ip',
        render: (_v, row) => {
          const ip = String(row.management_ip ?? row.managementIp ?? '').trim();
          const localWebUrl = buildIbrLocalWebUrl(row);
          if (!ip) return '—';
          if (!localWebUrl) return ip;
          return (
            <Tooltip title={`新窗口打开本机 Console：${localWebUrl}`}>
              <Typography.Link
                href={localWebUrl}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
              >
                <LinkOutlined /> {ip}
              </Typography.Link>
            </Tooltip>
          );
        },
      },
      {
        title: 'WAN IP',
        key: 'wan_ip',
        render: (_v, row) => {
          const endpoint = resolveVrWanEndpoint(row);
          if (endpoint) {
            return (
              <div style={commonTableStyles.cellMultiLineStack}>
                IPv4: {endpoint.ipv4}
                <br />
                IPv6: {endpoint.ipv6}
              </div>
            );
          }
          const legacy = parseJsonField(row.interfaces);
          if (Array.isArray(legacy) && legacy.length > 0) {
            const wan = legacy[0] as Record<string, unknown>;
            const ipv4 = String(wan.ipv4_static || wan.ip || '-');
            const ipv6 = pickIfaceIpv6FromDevice(wan) || '-';
            return (
              <div style={commonTableStyles.cellMultiLineStack}>
                IPv4: {ipv4}
                <br />
                IPv6: {ipv6}
              </div>
            );
          }
          return '—';
        },
      },
      {
        title: 'CPU',
        key: 'cpu',
        render: (_v, row) => {
          const resourceIndicators = parseJsonField(row.resourceIndicators) as Record<string, unknown> | null;
          if (!resourceIndicators) return '—';
          const total = Number(resourceIndicators.cpuTotal ?? 0);
          const pctRaw = Number(resourceIndicators.cpuUsed ?? 0);
          const pct = Math.max(0, Math.min(100, Number.isFinite(pctRaw) ? pctRaw : 0));
          const used = total > 0 ? (total * pct) / 100 : 0;
          if (!Number.isFinite(total) || total <= 0) {
            return <span style={{ color: 'rgba(0,0,0,0.45)', fontSize: 12 }}>—</span>;
          }
          const highUtil = pct > 80;
          return (
            <div style={{ maxWidth: 200, lineHeight: '20px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <Progress
                    percent={pct}
                    size="small"
                    showInfo={false}
                    strokeColor={highUtil ? '#ff4d4f' : '#1890ff'}
                  />
                </div>
                <span style={{ flexShrink: 0, color: highUtil ? '#ff4d4f' : undefined }}>
                  {pct.toFixed(1)}%
                </span>
              </div>
              <div style={{ color: 'rgba(0,0,0,0.45)', fontSize: 12 }}>
                {used.toFixed(2)} core / {total.toFixed(2)} core
              </div>
            </div>
          );
        },
      },
      {
        title: '内存',
        key: 'memory',
        render: (_v, row) => {
          const resourceIndicators = parseJsonField(row.resourceIndicators) as Record<string, unknown> | null;
          if (!resourceIndicators) return '—';
          const total = Number(resourceIndicators.memoryTotal ?? 0);
          const pctRaw = Number(resourceIndicators.memoryUsed ?? 0);
          const pct = Math.max(0, Math.min(100, Number.isFinite(pctRaw) ? pctRaw : 0));
          const used = total > 0 ? (total * pct) / 100 : 0;
          if (!Number.isFinite(total) || total <= 0) {
            return <span style={{ color: 'rgba(0,0,0,0.45)', fontSize: 12 }}>—</span>;
          }
          const highUtil = pct > 80;
          return (
            <div style={{ maxWidth: 200, lineHeight: '20px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <Progress
                    percent={pct}
                    size="small"
                    showInfo={false}
                    strokeColor={highUtil ? '#ff4d4f' : '#1890ff'}
                  />
                </div>
                <span style={{ flexShrink: 0, color: highUtil ? '#ff4d4f' : undefined }}>
                  {pct.toFixed(1)}%
                </span>
              </div>
              <div style={{ color: 'rgba(0,0,0,0.45)', fontSize: 12 }}>
                {used.toFixed(2)} GiB / {total.toFixed(2)} GiB
              </div>
            </div>
          );
        },
      },
      {
        title: '接收（总）',
        key: 'rx_total',
        render: (_v, row) => {
          const interfaces = collectVrPhysicalInterfaces(row);
          let rx_pps = 0;
          let rx_bps = 0;
          const details: string[] = [];
          for (const iface of interfaces) {
            const name = String(iface.name || '').trim();
            const pps = Number(iface.receivePacketsPerSecond || 0);
            const bps = Number(iface.receiveRateBps || 0);
            rx_pps += pps;
            rx_bps += bps;
            if (bps > 0 || pps > 0) {
              details.push(`${name}: ${formatTrafficRateBps(bps)} / ${pps} pps`);
            }
          }
          return (
            <Tooltip
              title={
                details.length > 0 ? (
                  <div style={{ fontSize: 12 }}>
                    {details.map((d) => (
                      <div key={d}>{d}</div>
                    ))}
                  </div>
                ) : (
                  '无流量或无物理接口数据'
                )
              }
            >
              <div style={commonTableStyles.cellMultiLineStack}>
                <div>{rx_pps} pps</div>
                <div>{formatTrafficRateBps(rx_bps)}</div>
              </div>
            </Tooltip>
          );
        },
      },
      {
        title: '发送（总）',
        key: 'tx_total',
        render: (_v, row) => {
          const interfaces = collectVrPhysicalInterfaces(row);
          let tx_pps = 0;
          let tx_bps = 0;
          const details: string[] = [];
          for (const iface of interfaces) {
            const name = String(iface.name || '').trim();
            const pps = Number(iface.transmitPacketsPerSecond || 0);
            const bps = Number(iface.transmitRateBps || 0);
            tx_pps += pps;
            tx_bps += bps;
            if (bps > 0 || pps > 0) {
              details.push(`${name}: ${formatTrafficRateBps(bps)} / ${pps} pps`);
            }
          }
          return (
            <Tooltip
              title={
                details.length > 0 ? (
                  <div style={{ fontSize: 12 }}>
                    {details.map((d) => (
                      <div key={d}>{d}</div>
                    ))}
                  </div>
                ) : (
                  '无流量或无物理接口数据'
                )
              }
            >
              <div style={commonTableStyles.cellMultiLineStack}>
                <div>{tx_pps} pps</div>
                <div>{formatTrafficRateBps(tx_bps)}</div>
              </div>
            </Tooltip>
          );
        },
      },
      { title: 'MAC', dataIndex: 'mac', key: 'mac' },
      { title: '版本', dataIndex: 'version', key: 'version' },
      { title: '类型', dataIndex: 'type', key: 'type' },
      {
        title: '操作',
        key: 'actions',
        fixed: 'right',
        render: (_v, row) => (
          <ResourceActionsDropdown
            items={getActionMenu(row)}
            onClick={onRowAction(row) as MenuProps['onClick']}
            buttonProps={{ className: 'row-actions-trigger', style: { margin: 0 } }}
          />
        ),
      },
    ];
  }, [rolesLoading, getActionMenu, onRowAction]);
}
