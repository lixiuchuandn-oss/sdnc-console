/**
 * 机架条内嵌：计算节点前面板。样式由 `../hsm.css` 提供（pchrome-*、tp-* 等）。
 * 指标与架构：同目录 `physicalNodeRackUtils`；顶栏双灯：`BladePowerLeds`。
 */
import React, { useMemo } from 'react';
import { DatabaseFilled } from '@ant-design/icons';
import { Button, Tooltip, Typography } from 'antd';
import type { PortStatusKind } from '../../cluster/lib/parseAswCtlInterfaceStdout';
import { BladePowerLeds } from './BladePowerLeds';
import { SWITCH_EMBEDDED_PORT_VISUAL } from './embeddedSwitchPortTileVisual';
import {
  buildLldpSimpleLines,
  extractHmsLldpRows,
  formatLldpBriefForPort,
} from './lldpHmsRowFields';
import { LldpCornerBadge } from './LldpCornerBadge';
import { SlotPaneFourRows } from './slotPaneFourRows';
import {
  nodeCpuArchitecture,
  nodeManagementIp,
  nodeReadyLedClass,
  nodeTempHint,
  nodeTempShort,
  nodeUsagePercents,
  type NodeLiveMetrics,
} from './physicalNodeRackUtils';

const NON_PHYSICAL_DISK_TYPES = new Set([
  'part',
  'partition',
  'lvm',
  'crypt',
  'loop',
  'rom',
  'dm',
  'md',
  'mdmember',
  'mpath',
]);

/** 超过 `maxChars` 时截为 `maxChars-1` 字符 +「…」，与原先 `length > 11 ? slice(0,10)+…` 一致 */
function ellip(maxChars: number, text: string): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars - 1)}…`;
}

function isPhysicalRootDisk(d: any): boolean {
  if (!d || typeof d !== 'object') return false;
  const t = String(d.type ?? d.Type ?? '')
    .toLowerCase()
    .trim();
  return !t || !NON_PHYSICAL_DISK_TYPES.has(t);
}

function isHmsVirtualDiskEntry(d: any): boolean {
  const model = String(d?.model ?? d?.Model ?? '')
    .trim()
    .toLowerCase();
  if (model) {
    if (
      model.includes('virtual-disk') ||
      model.includes('virtual disk') ||
      model.includes('virtio') ||
      model.includes('qemu') ||
      (model.includes('vmware') && model.includes('virtual'))
    ) {
      return true;
    }
  }
  const name = String(d?.name ?? d?.Name ?? '')
    .trim()
    .toLowerCase();
  return /^vd[a-z]+$/.test(name);
}

function physicalHardDisksOnly(hardware: any): any[] {
  const list = hardware && Array.isArray(hardware.disk) ? hardware.disk : [];
  return list.filter((d: any) => isPhysicalRootDisk(d) && !isHmsVirtualDiskEntry(d));
}

function nicStateToPortKind(n: any): PortStatusKind {
  if (n?.placeholder) return 'unknown';
  const s = String(n?.state || '').toLowerCase();
  if (s === 'up') return 'up';
  if (s === 'down') return 'down';
  if (s.includes('admin')) return 'admin';
  return 'unknown';
}

/** 前面板类型角标（TYPE=disk 不能单独判 HDD，见 lsblk/HMS 约定） */
function diskTypeChip(d: any): string {
  const name = String(d?.name ?? d?.Name ?? '')
    .trim()
    .toLowerCase();
  const model = String(d?.model ?? d?.Model ?? '')
    .trim()
    .toLowerCase();
  const typ = String(d?.type ?? d?.Type ?? '')
    .trim()
    .toLowerCase();

  if (name.startsWith('nvme')) return 'SSD';

  const rota = d?.rota ?? d?.rotational ?? d?.Rota ?? d?.ROTATIONAL;
  if (rota === 0 || rota === '0' || rota === false) return 'SSD';
  if (rota === 1 || rota === '1' || rota === true) return 'HDD';

  const tran = String(d?.tran ?? d?.Tran ?? d?.transport ?? '')
    .trim()
    .toLowerCase();
  if (tran === 'nvme') return 'SSD';

  if (
    model.includes('ssd') ||
    model.includes('nvme') ||
    model.includes('nvm express') ||
    model.includes('solid state') ||
    model.includes('solid-state')
  ) {
    return 'SSD';
  }
  if (model.includes('hdd') || model.includes('hard disk') || /\b\d{4,5}\s*rpm\b/.test(model)) {
    return 'HDD';
  }

  if (typ.includes('ssd') || typ.includes('nvme')) return 'SSD';
  if (typ.includes('hdd') || typ === 'rot' || typ === 'rom') return 'HDD';

  return 'DISK';
}

function diskCapacityDisplay(d: any): string {
  return String(d?.size ?? d?.Size ?? '').trim();
}

function DriveBayPlate({
  displayName,
  meta,
  cap,
  capClassName = 'cloudmap-dc-tp-slot-cap',
  led1Class,
  led2Class,
}: {
  displayName: string;
  meta: string;
  cap: string | null;
  /** 默认 `cloudmap-dc-tp-slot-cap`；网口 LLDP 可叠 `cloudmap-dc-tp-slot-cap--lldp` */
  capClassName?: string;
  led1Class: string;
  led2Class: string;
}) {
  return (
    <>
      <div className="cloudmap-dc-tp-slot-handle" aria-hidden />
      <div className="cloudmap-dc-tp-groove">
        <span className="cloudmap-dc-tp-slot-name">{displayName}</span>
        <span className="cloudmap-dc-tp-slot-meta">{meta}</span>
        {cap ? <span className={capClassName}>{cap}</span> : null}
      </div>
      <div className="cloudmap-dc-tp-slot-leds" aria-hidden>
        <span className={`cloudmap-dc-tp-slot-led ${led1Class}`} />
        <span className={`cloudmap-dc-tp-slot-led ${led2Class}`} />
      </div>
    </>
  );
}

function DriveFrontBay({ disk, idx }: { disk: any; idx: number }) {
  const name = String(disk?.name ?? disk?.Name ?? `disk-${idx}`);
  const displayName = ellip(11, name);
  const typ = String(disk?.type ?? disk?.Type ?? '');
  const size = String(disk?.size ?? disk?.Size ?? '');
  const model = String(disk?.model ?? disk?.Model ?? '');
  const typeChip = diskTypeChip(disk);
  const capRaw = diskCapacityDisplay(disk);
  const capShort = capRaw ? ellip(11, capRaw) : '';

  return (
    <Tooltip
      title={
        <>
          <div>{name}</div>
          {typ ? <div>类型：{typ}</div> : null}
          {size ? <div>容量：{size}</div> : null}
          {model ? <div>型号：{model}</div> : null}
        </>
      }
    >
      <div className="cloudmap-dc-tp-slot">
        <DriveBayPlate
          displayName={displayName}
          meta={typeChip}
          cap={capShort || null}
          led1Class="cloudmap-dc-tp-slot-led--pwr"
          led2Class="cloudmap-dc-tp-slot-led--act"
        />
      </div>
    </Tooltip>
  );
}

/** 第三行外若有 HMS 单口统计字段则展示为第四行；当前模型多为无流量字段。 */
function pickPhysicalNicTrafficLine(nic: any): string | null {
  if (!nic || nic.placeholder) return null;
  const tryKeys = [
    'inUtil',
    'outUtil',
    'inUti',
    'outUti',
    'rxBytes',
    'txBytes',
    'rxBps',
    'txBps',
    'rx_bps',
    'tx_bps',
    'throughput',
  ];
  for (const k of tryKeys) {
    const v = nic[k];
    if (v != null && String(v).trim()) return String(v).trim();
  }
  return null;
}

/** 判断列名是否像「本机接口名」一侧（非对端 system/port id 等列） */
function isLikelyLocalIfaceColumnKey(key: string): boolean {
  const k = key.trim();
  if (!k) return false;
  if (/remote|neighbor|peer|对端|远端/i.test(k) && !/local|本地/i.test(k)) {
    return false;
  }
  const kl = k.toLowerCase();
  if (kl === 'port id' || kl === 'portid' || /port description/i.test(k) || kl === 'system name' || /sysname/i.test(kl)) {
    return false;
  }
  if (/^(interface|iface|ifname|device|name|本地|local|网口)/i.test(k)) return true;
  if (kl === 'port') return true;
  if (/^local\s*port/i.test(k) || (k.includes('本地') && /口|port/i.test(k))) return true;
  return false;
}

function normalizeHwToken(s: string): string {
  return String(s || '')
    .trim()
    .toLowerCase()
    .replace(/0x/g, '');
}

function lldpRowMatchesDevice(row: Record<string, string>, device: string): boolean {
  const d = normalizeHwToken(device);
  if (!d) return false;
  for (const [key, val] of Object.entries(row)) {
    if (val == null || !String(val).trim()) continue;
    if (isLikelyLocalIfaceColumnKey(key)) {
      const v = normalizeHwToken(String(val));
      const tail = v.includes('/') ? v.replace(/^.*\//, '') : v;
      if (tail === d || v === d || v.endsWith(d) || d.endsWith(v)) return true;
    }
  }
  for (const val of Object.values(row)) {
    const v = normalizeHwToken(String(val ?? ''));
    if (v && v === d) return true;
  }
  return false;
}

function lldpRowMatchesMac(row: Record<string, string>, mac: string): boolean {
  const raw = String(mac || '').trim();
  if (!raw) return false;
  const compact = raw.replace(/[:-]/g, '').toLowerCase();
  if (compact.length < 8) return false;
  for (const val of Object.values(row)) {
    const s = String(val ?? '').trim();
    if (!s) continue;
    const c = s.replace(/[:-]/g, '').toLowerCase();
    if (c && (c === compact || c.includes(compact) || compact.includes(c))) return true;
  }
  return false;
}

/**
 * 将 HMS hardware.switch（LLDP）行归属到各网口：先按接口名，再按 MAC，最后单网口单条时兜底。
 */
function mapLldpRowsToNicIndices(nics: any[], hardware: any): Map<number, Record<string, string>> {
  const rows = extractHmsLldpRows(hardware);
  const out = new Map<number, Record<string, string>>();
  if (!rows.length) return out;

  const usedRow = new Set<number>();
  const nicCount = nics.length;

  for (let i = 0; i < nicCount; i++) {
    if (nics[i]?.placeholder) continue;
    const dev = String(nics[i]?.device ?? '').trim();
    for (let ri = 0; ri < rows.length; ri++) {
      if (usedRow.has(ri)) continue;
      if (lldpRowMatchesDevice(rows[ri], dev)) {
        usedRow.add(ri);
        out.set(i, rows[ri]);
        break;
      }
    }
  }
  for (let i = 0; i < nicCount; i++) {
    if (out.has(i) || nics[i]?.placeholder) continue;
    const mac = String(nics[i]?.mac ?? '').trim();
    for (let ri = 0; ri < rows.length; ri++) {
      if (usedRow.has(ri)) continue;
      if (lldpRowMatchesMac(rows[ri], mac)) {
        usedRow.add(ri);
        out.set(i, rows[ri]);
        break;
      }
    }
  }

  const realIdx = nics.map((_, i) => i).filter((i) => !nics[i]?.placeholder);
  if (rows.length === 1 && realIdx.length === 1 && !out.has(realIdx[0])) {
    out.set(realIdx[0], rows[0]);
  }

  return out;
}

function NicFrontBay({
  nic,
  idx,
  lldpRow,
}: {
  nic: any;
  idx: number;
  lldpRow?: Record<string, string> | null;
}) {
  const muted = Boolean(nic?.placeholder);
  const kind = nicStateToPortKind(nic);
  const vis = SWITCH_EMBEDDED_PORT_VISUAL[kind];
  const dev = String(nic?.device ?? '').trim() || `nic-${idx}`;
  const lldpLine3 = lldpRow && Object.keys(lldpRow).length > 0 ? formatLldpBriefForPort(lldpRow) : '';
  const line4Traffic = pickPhysicalNicTrafficLine(nic);
  const stateRaw = nic?.state != null && String(nic.state).trim() ? String(nic.state).trim() : '';
  const line2Status = muted
    ? '无 HMS 状态'
    : stateRaw || vis.label || '未知';
  const hasLldp = Boolean(
    lldpRow && typeof lldpRow === 'object' && Object.keys(lldpRow).length > 0,
  );

  const bayClass = [
    'cloudmap-dc-tp-slot',
    'cloudmap-dc-tp-slot--nic',
    `cloudmap-dc-tp-slot--nic-${kind}`,
    muted ? 'cloudmap-dc-tp-slot--muted' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <Tooltip
      title={
        <>
          <div>{dev}</div>
          {hasLldp ? <div>已接物理交换机</div> : null}
          {muted ? <div>仅集群接口名，无 HMS 链路状态</div> : null}
          {nic?.mac ? <div>MAC：{nic.mac}</div> : null}
          {stateRaw || vis.label ? <div>状态：{stateRaw || vis.label}</div> : null}
          {line4Traffic ? <div>流量：{line4Traffic}</div> : null}
          {nic?.usedByHarvester ? <div>已被 Harvester 占用</div> : null}
          {lldpRow && Object.keys(lldpRow).length > 0 ? (
            <>
              <div>LLDP</div>
              {buildLldpSimpleLines(lldpRow).map((line) => (
                <div key={`${line.label}:${line.value}`}>
                  {line.label}：{line.value}
                </div>
              ))}
            </>
          ) : null}
        </>
      }
    >
      <div
        className={bayClass}
        aria-label={hasLldp ? `${dev}，已接物理交换机（LLDP）` : undefined}
      >
        <SlotPaneFourRows
          line1={dev}
          line2={line2Status}
          line3={lldpLine3 || null}
          line4={line4Traffic}
          line2UsesNicTone
          topLeftBadge={hasLldp ? <LldpCornerBadge title="已接物理交换机" /> : null}
          led1Class="cloudmap-dc-tp-slot-led--nic-link"
          led2Class="cloudmap-dc-tp-slot-led--nic-act"
        />
      </div>
    </Tooltip>
  );
}

function DriveCageBlock({
  hasItems,
  emptyText,
  spreadSlots,
  children,
}: {
  hasItems: boolean;
  emptyText: string;
  /** 为 true 时槽位在父容器内均分拉满宽度（硬盘 / 网卡行） */
  spreadSlots?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="cloudmap-dc-embedded-node-graph-block">
      {hasItems ? (
        <div className="cloudmap-dc-node-hw-rail">
          <div
            className={['cloudmap-dc-tp-bay', spreadSlots ? 'cloudmap-dc-tp-bay--spread-slots' : ''].filter(Boolean).join(' ')}
          >
            <div className="cloudmap-dc-tp-bay-slots">{children}</div>
          </div>
        </div>
      ) : (
        <Typography.Text type="secondary" className="cloudmap-dc-embedded-node-graph-empty">
          {emptyText}
        </Typography.Text>
      )}
    </div>
  );
}

function EmbeddedPhysicalNodeHardwareGraphics({ node }: { node: any }) {
  const disks = useMemo(() => physicalHardDisksOnly(node?.hardware), [node]);

  const nics = useMemo(() => {
    const arr = node?.nics;
    if (Array.isArray(arr) && arr.length) return arr;
    const pi = node?.physicalInterfaces;
    if (Array.isArray(pi) && pi.length) {
      return pi.map((dev: string) => ({
        device: String(dev || ''),
        state: '',
        mac: '',
        placeholder: true,
      }));
    }
    return [];
  }, [node]);

  const lldpByNicIndex = useMemo(
    () => mapLldpRowsToNicIndices(nics, node?.hardware),
    [nics, node?.hardware],
  );

  return (
    <div className="cloudmap-dc-embedded-node-graph-wrap">
      <DriveCageBlock hasItems={disks.length > 0} emptyText="暂无 HMS 物理硬盘数据" spreadSlots>
        {disks.map((d: any, i: number) => {
          const name = String(d?.name ?? d?.Name ?? `disk-${i}`);
          return (
            <div key={`d-${name}-${i}`} className="cloudmap-dc-tp-bay-slot">
              <DriveFrontBay disk={d} idx={i} />
            </div>
          );
        })}
      </DriveCageBlock>
      <DriveCageBlock hasItems={nics.length > 0} emptyText="暂无网卡数据" spreadSlots>
        {nics.map((n: any, i: number) => (
          <div key={`n-${String(n?.device ?? i)}-${i}`} className="cloudmap-dc-tp-bay-slot">
            <NicFrontBay nic={n} idx={i} lldpRow={lldpByNicIndex.get(i) ?? null} />
          </div>
        ))}
      </DriveCageBlock>
    </div>
  );
}

export function PhysicalNodeLeadBadge({ node }: { node: any | null | undefined }) {
  const arch = node ? nodeCpuArchitecture(node) : '';
  const archLine = arch ? `${arch}服务器` : '服务器';
  return (
    <div
      className="cloudmap-dc-pchrome-icon cloudmap-dc-pchrome-icon--node"
      title={arch ? `架构 ${arch}` : '计算节点'}
    >
      <DatabaseFilled className="cloudmap-dc-pchrome-icon__glyph" aria-hidden />
      <span className="cloudmap-dc-pchrome-icon__caption">{archLine}</span>
    </div>
  );
}

type MetricStripItem = { label: string; value: string; hint?: string };

function NodeK8sMetricsStrip({ items }: { items: MetricStripItem[] }) {
  if (!items.length) return null;
  return (
    <div className="cloudmap-dc-pchrome-kpi">
      {items.map((it) => (
        <div key={it.label} className="cloudmap-dc-pchrome-kpi__item">
          <Typography.Text className="cloudmap-dc-pchrome-kpi__label">
            {it.label}
          </Typography.Text>
          <Typography.Text title={it.hint} className="cloudmap-dc-pchrome-kpi__value">
            {it.value}
          </Typography.Text>
        </div>
      ))}
    </div>
  );
}

export type EmbeddedPhysicalNodeBladeBodyProps = {
  nodeRefKey: string;
  node: any;
  title: string;
  nodeMetricsMap: Record<string, NodeLiveMetrics>;
  bladeBodyWrap?: boolean;
  /** 无集群节点数据时不展示「详情」 */
  onOpenDetail?: () => void;
};

export function EmbeddedPhysicalNodeBladeBody({
  nodeRefKey,
  node,
  title,
  nodeMetricsMap,
  bladeBodyWrap,
  onOpenDetail,
}: EmbeddedPhysicalNodeBladeBodyProps) {
  const healthLed = nodeReadyLedClass(node);
  const { cpuPct, memPct, storagePct } = nodeUsagePercents(nodeRefKey, node, nodeMetricsMap);
  const nt = nodeTempShort(node);
  const mgmt = nodeManagementIp(node)?.trim() || '';

  const stripItems = useMemo((): MetricStripItem[] => {
    const items: MetricStripItem[] = [];
    if (mgmt) items.push({ label: '管理 IP', value: mgmt });
    if (nodeMetricsMap[nodeRefKey]) {
      items.push(
        { label: 'CPU', value: `${Math.round(cpuPct)}%` },
        { label: '内存', value: `${Math.round(memPct)}%` },
        { label: '存储', value: `${Math.round(storagePct)}%` },
      );
    }
    if (nt) items.push({ label: '温度', value: nt, hint: nodeTempHint(node) });
    return items;
  }, [cpuPct, memPct, mgmt, node, nodeMetricsMap, nodeRefKey, nt, storagePct]);

  const rootClass = [
    'cloudmap-dc-embedded-panel-root',
    'cloudmap-dc-embedded-node-panel-root',
    bladeBodyWrap ? 'cloudmap-dc-blade-body-wrap' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={rootClass} onClick={(e) => e.stopPropagation()}>
      <div className="cloudmap-dc-embedded-node-chassis">
        <div className="cloudmap-dc-pchrome-inset">
          <div className="cloudmap-dc-pchrome-bar">
            <div className="cloudmap-dc-pchrome-slot--lead">
              <PhysicalNodeLeadBadge node={node} />
            </div>
            <div className="cloudmap-dc-pchrome-slot--title cloudmap-dc-pchrome-bar__title">
              <Typography.Text strong className="cloudmap-dc-pchrome-bar__title-text">
                {title}
              </Typography.Text>
            </div>
            <div className="cloudmap-dc-pchrome-bar__main">
              {stripItems.length > 0 ? <NodeK8sMetricsStrip items={stripItems} /> : null}
              {onOpenDetail ? (
                <Button
                  type="link"
                  size="small"
                  className="cloudmap-dc-pchrome-detail"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    onOpenDetail();
                  }}
                >
                  详情
                </Button>
              ) : null}
            </div>
            <div className="cloudmap-dc-pchrome-bar__tail">
              <BladePowerLeds state={healthLed} />
              <div className="cloudmap-dc-pchrome-vent" aria-hidden />
            </div>
          </div>
        </div>
        <EmbeddedPhysicalNodeHardwareGraphics node={node} />
      </div>
    </div>
  );
}
