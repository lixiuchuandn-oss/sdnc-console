
export const ipv4ToNum = (ip: string): number => ip.split('.').reduce((acc: number, n: string) => (acc << 8) + (parseInt(n) || 0), 0) >>> 0;

export const parseCidrNum = (cidr: string): { ipNum: number; maskLen: number; start: number; end: number } => {
  const [ip, m] = String(cidr || '').split('/');
  const maskLen = parseInt(m || '0') || 0;
  const ipNum = ipv4ToNum(ip || '0.0.0.0');
  const bits = 32 - maskLen;
  const mask = bits >= 32 ? 0 : ((~0 << bits) >>> 0);
  const start = (ipNum & mask) >>> 0;
  const size = bits >= 31 ? 0 : ((1 << bits) - 1);
  const end = (start + size) >>> 0;
  return { ipNum, maskLen, start, end };
};

export const samePrefix = (a: { ipNum: number; maskLen: number }, b: { ipNum: number; maskLen: number }): boolean => {
  const m = Math.min(a.maskLen, b.maskLen);
  const bits = 32 - m;
  const mask = bits >= 32 ? 0 : ((~0 << bits) >>> 0);
  return ((a.ipNum & mask) >>> 0) === ((b.ipNum & mask) >>> 0);
};

export const rangesOverlap = (a: { start: number; end: number }, b: { start: number; end: number }): boolean => !(a.end < b.start || b.end < a.start);

export const normalizeErr = (e: any, fallback: string): string => {
  const raw = String(e?.message || e?.toString?.() || '').trim();
  if (!raw) return fallback;
  let msg = '';
  try {
    const top = JSON.parse(raw);
    let inner = '';
    const m0 = typeof top?.message === 'string' ? top.message : (top?.error || top?.detail || '');
    if (typeof m0 === 'string' && m0) {
      try {
        const j2 = JSON.parse(m0);
        inner = j2?.NeutronError?.message || j2?.message || '';
      } catch {}
    }
    msg = String(inner || m0 || raw).trim();
  } catch {
    msg = raw;
  }
  if (/name has exist/i.test(msg)) msg = '名称已存在，请更换名称';
  if (/InvalidInput/i.test(msg) && !/参数不合法/.test(msg)) msg = '参数不合法';
  return msg || fallback;
};