import {
  parseSwitchPortSlotTriplet,
  type ParsedSwitchPort,
} from '../../cluster/lib/parseAswCtlInterfaceStdout';

/** 单槽第四行：尽量从 CLI 行或解析字段中取出利用率/速率等「流量向」信息 */
export function formatSwitchPortTrafficLine(p: ParsedSwitchPort): string | null {
  const raw = p.rawLine || '';
  const inM = raw.match(/\bInUti\s*[:=]?\s*(\S+)/i);
  const outM = raw.match(/\bOutUti\s*[:=]?\s*(\S+)/i);
  if (inM || outM) {
    const a: string[] = [];
    if (inM) a.push(`入 ${inM[1]}`);
    if (outM) a.push(`出 ${outM[1]}`);
    return a.join(' ');
  }
  if (p.speed?.trim()) return p.speed.trim();
  if (p.detectedSpeedMbps) return `检测 ${p.detectedSpeedMbps} Mbps`;
  return null;
}

export function portSortKey(name: string): [number, number, number] {
  const t = parseSwitchPortSlotTriplet(name);
  return t ?? [9999, 9999, 9999];
}

export function splitIntoTwoRows(ports: ParsedSwitchPort[]): [ParsedSwitchPort[], ParsedSwitchPort[]] {
  if (ports.length === 0) return [[], []];

  const sortByKey = (a: ParsedSwitchPort, b: ParsedSwitchPort) => {
    const ka = portSortKey(a.name);
    const kb = portSortKey(b.name);
    for (let j = 0; j < 3; j++) {
      if (ka[j] !== kb[j]) return ka[j] - kb[j];
    }
    return 0;
  };

  const top: ParsedSwitchPort[] = [];
  const bottom: ParsedSwitchPort[] = [];
  const noSlotPort: ParsedSwitchPort[] = [];

  for (const p of ports) {
    const tri = parseSwitchPortSlotTriplet(p.name);
    if (!tri) {
      noSlotPort.push(p);
      continue;
    }
    const n = tri[2];
    if (n % 2 === 1) top.push(p);
    else bottom.push(p);
  }

  top.sort(sortByKey);
  bottom.sort(sortByKey);

  if (noSlotPort.length > 0) {
    const mid = Math.ceil(noSlotPort.length / 2);
    top.push(...noSlotPort.slice(0, mid));
    bottom.push(...noSlotPort.slice(mid));
  }

  return [top, bottom];
}
