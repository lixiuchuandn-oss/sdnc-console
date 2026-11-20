import { routerIdFromIpv4 } from './vrWizardFormUtils';

describe('routerIdFromIpv4', () => {
  it('uses the IPv4 host address without its CIDR prefix', () => {
    expect(routerIdFromIpv4('11.1.1.11/24')).toBe('11.1.1.11');
  });

  it('leaves an empty address unset', () => {
    expect(routerIdFromIpv4('')).toBeUndefined();
    expect(routerIdFromIpv4(undefined)).toBeUndefined();
  });
});
