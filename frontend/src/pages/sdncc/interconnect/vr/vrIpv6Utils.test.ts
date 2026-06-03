import { filterLinkLocalIpv6, splitIpv6AddressTokens } from './vrIpv6Utils';

describe('vrIpv6Utils', () => {
  it('splits jammed dual CIDR without separator', () => {
    expect(splitIpv6AddressTokens('fe80::2090:b4ff:fe63:3f16/64203::22/64')).toEqual([
      'fe80::2090:b4ff:fe63:3f16/64',
      '203::22/64',
    ]);
  });

  it('picks global IPv6 and drops fe80', () => {
    expect(filterLinkLocalIpv6('fe80::2090:b4ff:fe63:3f16/64\n203::22/64')).toBe('203::22/64');
    expect(filterLinkLocalIpv6('fe80::2090:b4ff:fe63:3f16/64203::22/64')).toBe('203::22/64');
  });

  it('splits global-first then fe80 jammed (list page style)', () => {
    expect(splitIpv6AddressTokens('203::33/64fe80::883:50ff:fea8:1217/64')).toEqual([
      '203::33/64',
      'fe80::883:50ff:fea8:1217/64',
    ]);
    expect(filterLinkLocalIpv6('203::33/64fe80::883:50ff:fea8:1217/64')).toBe('203::33/64');
  });
});
