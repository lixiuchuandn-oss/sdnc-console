import {
  SRV6_SID_PREFIX_PLEN_MAX,
  SRV6_SID_PREFIX_PLEN_MIN,
  validateSrv6SidPrefixPhase1,
} from './srv6SidPrefix';

describe('validateSrv6SidPrefixPhase1', () => {
  it('accepts empty and bare IPv6', () => {
    expect(validateSrv6SidPrefixPhase1('').ok).toBe(true);
    expect(validateSrv6SidPrefixPhase1('2400:1234::1')).toEqual({
      ok: true,
      host: '2400:1234::1',
    });
  });

  it('accepts plen in [40,88]', () => {
    expect(validateSrv6SidPrefixPhase1('2400::/40')).toEqual({
      ok: true,
      host: '2400::',
      plen: 40,
    });
    expect(validateSrv6SidPrefixPhase1('2400:1234::100/64')).toEqual({
      ok: true,
      host: '2400:1234::100',
      plen: 64,
    });
    expect(validateSrv6SidPrefixPhase1('2400::/88')).toEqual({
      ok: true,
      host: '2400::',
      plen: 88,
    });
  });

  it('rejects plen outside phase-1 range', () => {
    const low = validateSrv6SidPrefixPhase1('2400::/32');
    expect(low.ok).toBe(false);
    if (!low.ok) {
      expect(low.message).toContain(String(SRV6_SID_PREFIX_PLEN_MIN));
      expect(low.message).toContain(String(SRV6_SID_PREFIX_PLEN_MAX));
    }
    const high = validateSrv6SidPrefixPhase1('2400::/96');
    expect(high.ok).toBe(false);
  });

  it('rejects spaces / advanced CLI tokens', () => {
    const r = validateSrv6SidPrefixPhase1('2400::/64 block-len 32');
    expect(r.ok).toBe(false);
  });
});
