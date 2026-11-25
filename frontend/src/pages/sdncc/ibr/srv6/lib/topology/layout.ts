/**
 * SRv6 架构拓扑：布局策略（纯函数，输出节点左上角坐标）。
 * - p2p：CE-A ─ PE-A ══ PE-B ─ CE-B 横排
 * - hub ≤3 Spoke：Hub 在上、Spoke 在下横排；Hub CE 在 Hub 上方，Spoke CE 在 Spoke 下方
 * - hub 4–12：环形（按 PE 去重计数），Spoke CE 沿径向外移
 * - hub >12：分层网格（每行 6 个）
 */
import type { Srv6Topology, TopoNode } from './buildTopology';

export type XY = { x: number; y: number };
export type LayoutKind = 'p2p' | 'tiered' | 'radial' | 'grid' | 'multihub';

export const NODE_W = { pe: 192, ce: 132 } as const;
export const NODE_H = { pe: 92, ce: 44 } as const;

const isCe = (n: TopoNode) => n.role === 'ce';
const size = (n: TopoNode) => (isCe(n) ? { w: NODE_W.ce, h: NODE_H.ce } : { w: NODE_W.pe, h: NODE_H.pe });
/** 中心点 → 左上角 */
const tl = (n: TopoNode, cx: number, cy: number): XY => {
  const { w, h } = size(n);
  return { x: cx - w / 2, y: cy - h / 2 };
};

export function pickLayout(topo: Srv6Topology): LayoutKind {
  if (topo.mode === 'p2p') return 'p2p';
  if (topo.nodes.filter((n) => n.role === 'hub').length > 1) return 'multihub';
  const spokes = topo.nodes.filter((n) => n.role === 'spoke').length;
  if (spokes <= 3) return 'tiered';
  if (spokes <= 12) return 'radial';
  return 'grid';
}

export function layoutTopology(topo: Srv6Topology, kind = pickLayout(topo)): Record<string, XY> {
  const pos: Record<string, XY> = {};
  const byId = new Map(topo.nodes.map((n) => [n.id, n]));
  const cesOf = (peId: string) => topo.nodes.filter((n) => isCe(n) && n.attachTo === peId);

  /** 多个 CE 围绕给定中心沿垂直于 (dx,dy) 方向展开 */
  const placeCes = (peId: string, cx: number, cy: number, dx: number, dy: number, dist: number) => {
    const ces = cesOf(peId);
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len;
    const uy = dy / len;
    const px = -uy;
    const py = ux;
    const gap = 150;
    ces.forEach((ce, i) => {
      if (pos[ce.id]) return;
      const off = (i - (ces.length - 1) / 2) * gap;
      pos[ce.id] = tl(ce, cx + ux * dist + px * off, cy + uy * dist + py * off);
    });
  };

  if (kind === 'p2p') {
    const pes = topo.nodes.filter((n) => n.role === 'pe');
    const a = pes.find((n) => n.side === 'a');
    const b = pes.find((n) => n.side === 'b');
    const cy = 200;
    if (a) {
      pos[a.id] = tl(a, 300, cy);
      placeCes(a.id, 300, cy, -1, 0, 220);
    }
    if (b) {
      pos[b.id] = tl(b, 760, cy);
      placeCes(b.id, 760, cy, 1, 0, 220);
    }
    return pos;
  }

  const hub = topo.nodes.find((n) => n.role === 'hub');
  const spokes = topo.nodes.filter((n) => n.role === 'spoke');
  if (!hub) return pos;

  if (kind === 'multihub') {
    // 多 Hub：Hub 顶层横排（CE 在上），Spoke 底层按「挂接 Hub 的平均列位」排序，减少交叉
    const hubs = topo.nodes.filter((n) => n.role === 'hub');
    const hubGap = 420;
    const cx = 520;
    const hubY = 200;
    const hubX = new Map<string, number>();
    hubs.forEach((h, i) => {
      const x = cx + (i - (hubs.length - 1) / 2) * hubGap;
      hubX.set(h.id, x);
      pos[h.id] = tl(h, x, hubY);
      placeCes(h.id, x, hubY, 0, -1, 130);
    });
    const anchor = (sp: TopoNode) => {
      const xs = topo.tunnels.filter((t) => t.target === sp.id).map((t) => hubX.get(t.source) ?? cx);
      return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : cx;
    };
    const sorted = [...spokes].sort((a, b) => anchor(a) - anchor(b));
    const perRow = 6;
    const colGap = 240;
    sorted.forEach((sp, i) => {
      const row = Math.floor(i / perRow);
      const col = i % perRow;
      const inRow = Math.min(perRow, sorted.length - row * perRow);
      const sx = cx + (col - (inRow - 1) / 2) * colGap;
      const sy = hubY + 300 + row * 290;
      pos[sp.id] = tl(sp, sx, sy);
      placeCes(sp.id, sx, sy, 0, 1, 120);
    });
    return pos;
  }

  if (kind === 'radial') {
    const cx = 520;
    const cy = 380;
    pos[hub.id] = tl(hub, cx, cy);
    const r = Math.min(360, 220 + spokes.length * 14);
    spokes.forEach((sp, i) => {
      const ang = (Math.PI * 2 * i) / spokes.length - Math.PI / 2;
      const dx = Math.cos(ang);
      const dy = Math.sin(ang);
      const sx = cx + dx * r;
      const sy = cy + dy * r;
      pos[sp.id] = tl(sp, sx, sy);
      placeCes(sp.id, sx, sy, dx, dy, 150);
    });
    // Hub CE：放在 Hub 正上方偏内（避开第一个 Spoke 的 -90° 方向则略右偏）
    placeCes(hub.id, cx + 150, cy - 10, 0, -1, 0);
    return pos;
  }

  // tiered / grid
  const perRow = kind === 'grid' ? 6 : Math.max(spokes.length, 1);
  const colGap = 260;
  const rowGap = 230;
  const rowW = (Math.min(perRow, spokes.length) - 1) * colGap;
  const cx = 520;
  const hubY = 210;
  pos[hub.id] = tl(hub, cx, hubY);
  placeCes(hub.id, cx, hubY, 0, -1, 130);
  spokes.forEach((sp, i) => {
    const row = Math.floor(i / perRow);
    const col = i % perRow;
    const sx = cx - rowW / 2 + col * colGap;
    const sy = hubY + 230 + row * (rowGap + 60);
    pos[sp.id] = tl(sp, sx, sy);
    placeCes(sp.id, sx, sy, 0, 1, 120);
  });

  // 兜底：遗漏节点
  topo.nodes.forEach((n, i) => {
    if (!pos[n.id] && byId.has(n.id)) pos[n.id] = { x: 40 + i * 20, y: 40 };
  });
  return pos;
}
