/**
 * SRv6 SID / Locator 前缀（一阶段）：
 * - 无掩码：设备侧默认 /64
 * - 带掩码：仅允许 plen ∈ [40, 88]（设备可省略 block-len/node-len，走 FRR 默认 node-len=24）
 * 特殊拆分（block/node/func、plen∉[40,88]）二阶段再开。
 */

export const SRV6_SID_PREFIX_PLEN_MIN = 40;
export const SRV6_SID_PREFIX_PLEN_MAX = 88;

const IPV6_HOST_RE = /^[0-9a-fA-F:]+$/;
const IPV6_CIDR_RE = /^([0-9a-fA-F:]+)\/([0-9]|[1-9]\d|1[01]\d|12[0-8])$/;

export type Srv6SidPrefixPhase1Ok = {
  ok: true;
  host: string;
  /** 无掩码时为 undefined（设备默认 64） */
  plen?: number;
};

export type Srv6SidPrefixPhase1Err = {
  ok: false;
  message: string;
};

export type Srv6SidPrefixPhase1Result = Srv6SidPrefixPhase1Ok | Srv6SidPrefixPhase1Err;

/** 空串视为未填（由表单 required / 业务层决定是否必填） */
export function validateSrv6SidPrefixPhase1(raw: unknown): Srv6SidPrefixPhase1Result {
  const s = String(raw ?? '').trim();
  if (!s) {
    return { ok: true, host: '' };
  }
  if (s.includes(' ')) {
    return { ok: false, message: 'SID 前缀请勿包含空格或附加参数（block-len 等暂不支持）' };
  }

  const cidr = s.match(IPV6_CIDR_RE);
  if (cidr) {
    const host = cidr[1];
    const plen = Number(cidr[2]);
    if (!host.includes(':')) {
      return { ok: false, message: '请填写合法的 IPv6 前缀' };
    }
    if (plen < SRV6_SID_PREFIX_PLEN_MIN || plen > SRV6_SID_PREFIX_PLEN_MAX) {
      return {
        ok: false,
        message: `带掩码时前缀长度须为 ${SRV6_SID_PREFIX_PLEN_MIN}–${SRV6_SID_PREFIX_PLEN_MAX}（当前 ${plen}）；其它长度需 block-len/node-len，一阶段暂不支持`,
      };
    }
    return { ok: true, host, plen };
  }

  if (IPV6_HOST_RE.test(s) && s.includes(':') && !s.includes('/')) {
    return { ok: true, host: s };
  }

  return {
    ok: false,
    message: `格式示例：2400:1234::1（无掩码，设备默认 /64）或 2400:1234::/64（掩码 ${SRV6_SID_PREFIX_PLEN_MIN}–${SRV6_SID_PREFIX_PLEN_MAX}）`,
  };
}

export function srv6SidPrefixPhase1Extra(): string {
  return `一阶段：无掩码（设备默认 /64），或带 /${SRV6_SID_PREFIX_PLEN_MIN}–/${SRV6_SID_PREFIX_PLEN_MAX}；自定义 block-len/node-len/func-bits 暂不开放`;
}
