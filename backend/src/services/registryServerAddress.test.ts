import {
  normalizeRegistryServerAddress,
  registryServerAddressesEqual,
} from './registryServerAddress';

describe('registryServerAddress', () => {
  it('strips protocol and path', () => {
    expect(normalizeRegistryServerAddress('https://10.20.5.20:30500/v2/')).toBe('10.20.5.20:30500');
    expect(normalizeRegistryServerAddress('http://harbor.example.com')).toBe('harbor.example.com');
  });

  it('compares addresses case-insensitively', () => {
    expect(registryServerAddressesEqual('HTTPS://Harbor.Example.COM', 'harbor.example.com')).toBe(
      true,
    );
    expect(registryServerAddressesEqual('10.20.5.20:30500', '10.20.5.20:30501')).toBe(false);
  });
});
