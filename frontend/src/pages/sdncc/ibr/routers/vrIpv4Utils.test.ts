import { pickPrimaryIpv4Cidr, splitIpv4AddressTokens } from './vrIpv4Utils';

describe('vrIpv4Utils', () => {
  it('splits newline-separated primary + VRRP VIPs', () => {
    expect(
      splitIpv4AddressTokens('34.1.1.3/24\n34.1.1.254/24\n34.1.1.253/24'),
    ).toEqual(['34.1.1.3/24', '34.1.1.254/24', '34.1.1.253/24']);
    expect(pickPrimaryIpv4Cidr('34.1.1.3/24\n34.1.1.254/24\n34.1.1.253/24')).toBe(
      '34.1.1.3/24',
    );
  });

  it('splits jammed CIDRs without separator (Input display style)', () => {
    expect(splitIpv4AddressTokens('34.1.1.3/2434.1.1.254/2434.1.1.253/24')).toEqual([
      '34.1.1.3/24',
      '34.1.1.254/24',
      '34.1.1.253/24',
    ]);
    expect(pickPrimaryIpv4Cidr('34.1.1.3/2434.1.1.254/2434.1.1.253/24')).toBe('34.1.1.3/24');
  });

  it('keeps a single CIDR unchanged', () => {
    expect(pickPrimaryIpv4Cidr('34.1.1.3/24')).toBe('34.1.1.3/24');
    expect(splitIpv4AddressTokens('34.1.1.3/24')).toEqual(['34.1.1.3/24']);
  });
});
