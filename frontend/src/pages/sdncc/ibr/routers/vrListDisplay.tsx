import React from 'react';
import { Skeleton, Tag } from 'antd';
import { ibrVrRowId, ibrVrRowRole } from '../lib/ibrVrCatalog';
import { pickIfaceIpv6FromDevice } from './vrIpv6Utils';

export function getVrHealthStatusKey(raw: unknown): 'running' | 'warning' | 'stopped' | 'unknown' {
  const v = String(raw || '').toLowerCase();
  if (['healthy', 'running', 'ok', 'online', 'active'].includes(v)) return 'running';
  if (['warning', 'degraded'].includes(v)) return 'warning';
  if (['error', 'failed', 'unhealthy', 'offline', 'stopped'].includes(v)) return 'stopped';
  return 'unknown';
}

export function matchVrListRoleFilter(role: string | undefined, filter: string): boolean {
  const r = String(role || '').trim();
  if (filter === '未设置') return !r;
  if (filter === 'PE') return r === 'PE' || r === 'SPOKE_PE' || r === 'HUB_PE';
  return r === filter;
}

export function normalizeVrRoleLabel(role: string): string {
  if (role === 'SPOKE_PE') return 'Spoke PE';
  if (role === 'HUB_PE') return 'Hub PE';
  return role || '未设置';
}

export function vrRoleTagColor(role: string): string | undefined {
  if (role === 'CE') return 'blue';
  if (role === '标准') return 'green';
  if (role === 'SASE') return 'purple';
  if (role === 'PE' || role === 'SPOKE_PE' || role === 'HUB_PE') return 'geekblue';
  return undefined;
}

export const VrRoleTag: React.FC<{ role?: string; loading?: boolean }> = ({ role, loading }) => {
  if (loading && !String(role || '').trim()) {
    return <Skeleton.Button active size="small" style={{ width: 52, height: 22 }} />;
  }
  const r = String(role || '').trim();
  if (!r) return <span style={{ color: 'rgba(0,0,0,0.45)' }}>未设置</span>;
  return <Tag color={vrRoleTagColor(r)}>{normalizeVrRoleLabel(r)}</Tag>;
};

function pushInterfaceArray(target: Array<Record<string, unknown>>, value: unknown): void {
  if (!Array.isArray(value)) return;
  for (const item of value) {
    if (item && typeof item === 'object') target.push(item as Record<string, unknown>);
  }
}

/** 聚合 VR1/VR3 缓存与 interfaces_* 分片中的物理网口 */
export function collectVrPhysicalInterfaces(row: Record<string, unknown>): Array<Record<string, unknown>> {
  const all: Array<Record<string, unknown>> = [];
  pushInterfaceArray(all, row.interfaces);
  for (const [key, value] of Object.entries(row)) {
    if (key.startsWith('interfaces_')) pushInterfaceArray(all, value);
  }
  const vr3 = row.vr3_info;
  if (vr3 && typeof vr3 === 'object' && !Array.isArray(vr3)) {
    const vr3Obj = vr3 as Record<string, unknown>;
    pushInterfaceArray(all, vr3Obj.interfaces);
    for (const [key, value] of Object.entries(vr3Obj)) {
      if (key.startsWith('interfaces_')) pushInterfaceArray(all, value);
    }
  }
  return all
    .filter((iface) => {
      const name = String(iface.name || '').toLowerCase();
      return (
        name.startsWith('gigabitethernet') ||
        name.startsWith('ge') ||
        name.startsWith('ethernet') ||
        name.startsWith('ten-gigabitethernet') ||
        name.startsWith('eth')
      );
    })
    .sort((a, b) =>
      String(a.name || '').localeCompare(String(b.name || ''), undefined, {
        numeric: true,
        sensitivity: 'base',
      }),
    );
}

export function resolveVrWanEndpoint(row: Record<string, unknown>): { ipv4: string; ipv6: string } | null {
  const physical = collectVrPhysicalInterfaces(row);
  if (physical.length === 0) return null;
  const wan = physical[0]!;
  const ipv4 = String(wan.ipv4_static || wan.ip_address || wan.ipAddress || wan.ip || '').trim() || '-';
  const ipv6 = pickIfaceIpv6FromDevice(wan) || '-';
  return { ipv4, ipv6 };
}

export function vrRowMatchesKeyword(row: Record<string, unknown>, keyword: string): boolean {
  const kw = keyword.trim().toLowerCase();
  if (!kw) return true;
  const id = ibrVrRowId(row).toLowerCase();
  const name = String(row.name || '').toLowerCase();
  const role = ibrVrRowRole(row).toLowerCase();
  return name.includes(kw) || id.includes(kw) || role.includes(kw);
}

export function buildVrRolesMapFromRows(rows: Array<Record<string, unknown>>): Record<string, string> {
  const map: Record<string, string> = {};
  for (const row of rows) {
    const id = ibrVrRowId(row);
    const role = ibrVrRowRole(row);
    if (id && role) map[id] = role;
  }
  return map;
}
