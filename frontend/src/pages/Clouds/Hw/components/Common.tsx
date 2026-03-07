import React from 'react';
import { Card, Tag, Tooltip, Divider } from 'antd';

export const statusTag = (s?: string) => {
  const x = String(s || '').trim().toUpperCase();
  let txt = '-';
  let color: string | undefined = undefined;
  if (x === 'ACTIVE' || x === 'AVAILABLE' || x === 'ONLINE' || x === 'RUNNING' || x === 'INUSE' || x === 'IN-USE' || x === 'OK') { txt = '运行中'; color = 'blue'; }
  else if (x === 'PENDING_CREATE' || x === 'CREATING' || x === 'BUILDING' || x === 'PROVISIONING') { txt = '创建中'; color = 'blue'; }
  else if (x === 'REBOOTING') { txt = '重启中'; color = 'blue'; }
  else if (x === 'PENDING_DELETE' || x === 'DELETING') { txt = '删除中'; color = 'orange'; }
  else if (x === 'ERROR' || x === 'FAILED') { txt = '异常'; color = 'red'; }
  else if (x === 'SHUTOFF' || x === 'DOWN' || x === 'STOPPED' || x === 'OFFLINE') { txt = '已停止'; color = undefined; }
  else if (x) { txt = s as string; color = 'blue'; }
  return color ? <Tag color={color}>{txt}</Tag> : <Tag>{txt}</Tag>;
};

export const EllipsisText: React.FC<{ value?: any }> = ({ value }) => {
  const v = String(value || '');
  if (!v) return <>-</>;
  return (
    <Tooltip title={v}>
      <span style={{ display: 'inline-block', maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v}</span>
    </Tooltip>
  );
};

export const SubResourceCard: React.FC<{ title: React.ReactNode; extra?: React.ReactNode; actions?: React.ReactNode[]; children: React.ReactNode }> = ({ title, extra, actions, children }) => (
  <Card
    size="small"
    hoverable
    variant="outlined"
    title={title}
    extra={extra}
    actions={actions && actions.length ? [
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-start', flexWrap: 'wrap', width: '100%', padding: '0 12px', margin: 0 }}>
        {actions.map((node, i) => (
          <React.Fragment key={i}>
            {i > 0 && <Divider type="vertical" style={{ height: 22, margin: '0 8px' }} />}
            {node}
          </React.Fragment>
        ))}
      </div>
    ] : undefined}
    headStyle={{ background: '#f5f9ff' }}
    styles={{ body: { padding: 14 } }}
    style={{ borderRadius: 10 }}
  >
    {children}
  </Card>
);

export const tagsToText = (tags: any): string => {
  const pairs: string[] = [];
  if (Array.isArray(tags)) {
    for (const t of tags) {
      const k = (t as any)?.key ?? (t as any)?.Key;
      const v = (t as any)?.value ?? (t as any)?.Value;
      if (k != null && v != null) pairs.push(`${k}=${v}`);
    }
  } else if (tags && typeof tags === 'object') {
    for (const k of Object.keys(tags)) {
      const v = (tags as any)[k];
      if (v != null) pairs.push(`${k}=${v}`);
    }
  }
  return pairs.length ? pairs.join('；') : '-';
};

const flattenAddrs = (addrs: any): any[] => {
  const out: any[] = [];
  const stack: any[] = [addrs];
  const seen = new Set<any>();
  while (stack.length) {
    const node = stack.pop();
    if (!node || seen.has(node)) continue;
    if (Array.isArray(node)) { seen.add(node); for (const it of node) stack.push(it); continue; }
    if (typeof node === 'object') {
      seen.add(node);
      out.push(node);
      for (const v of Object.values(node)) stack.push(v);
      continue;
    }
  }
  return out;
};

export const collectIpv4FromAddresses = (addrs: any): { fixed: string[]; floating: string[] } => {
  const nodes = flattenAddrs(addrs);
  const fixed: string[] = [];
  const floating: string[] = [];
  for (const n of nodes) {
    const t = String((n && (n['OS-EXT-IPS:type'] || (n as any).type)) || '').toLowerCase();
    const addr = (n as any)?.addr;
    const v4 = String((n as any)?.version || '').toLowerCase() === '4' || (n as any)?.version === 4 || String((n as any)?.ip_version || '').toLowerCase() === '4' || (n as any)?.ip_version === 4 || /\./.test(String(addr || ''));
    if (!addr || !v4) continue;
    if (t === 'floating') floating.push(String(addr));
    else fixed.push(String(addr));
  }
  return { fixed: Array.from(new Set(fixed)), floating: Array.from(new Set(floating)) };
};

export const collectInstanceIpv4 = (addrs: any): string[] => {
  if (Array.isArray(addrs) && addrs.every((x) => typeof x === 'string')) {
    const ips = addrs.filter((x) => /\./.test(String(x || ''))).map((x) => String(x));
    return Array.from(new Set(ips));
  }
  if (typeof addrs === 'string') {
    return /\./.test(addrs) ? [addrs] : [];
  }
  const nodes = flattenAddrs(addrs);
  const acc: string[] = [];
  for (const n of nodes) {
    const t = String((n && (n['OS-EXT-IPS:type'] || (n as any).type)) || '').toLowerCase();
    const addr = (n as any)?.addr;
    const v4 = String((n as any)?.version || '').toLowerCase() === '4' || (n as any)?.version === 4 || String((n as any)?.ip_version || '').toLowerCase() === '4' || (n as any)?.ip_version === 4 || /\./.test(String(addr || ''));
    if (addr && (t === 'fixed' || (!t && v4))) acc.push(String(addr));
  }
  return Array.from(new Set(acc));
};

export default {};
