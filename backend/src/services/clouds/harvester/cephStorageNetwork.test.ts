import {
  isCephStorageNetworkConfigured,
  parseCephStorageNetworkValue,
  serializeCephStorageNetworkValue,
  validateCephStorageNetworkConfig,
} from './cephStorageNetwork';

describe('cephStorageNetwork', () => {
  it('parseCephStorageNetworkValue accepts harvester setting JSON', () => {
    const cfg = parseCephStorageNetworkValue(
      '{"vlan":100,"clusterNetwork":"cuncu","range":"176.11.0.0/24"}',
    );
    expect(cfg).toEqual({
      vlan: 100,
      clusterNetwork: 'cuncu',
      range: '176.11.0.0/24',
    });
  });

  it('rejects invalid vlan or missing fields', () => {
    expect(
      parseCephStorageNetworkValue('{"vlan":0,"clusterNetwork":"a","range":"1.2.3.4/24"}'),
    ).toBeNull();
    expect(parseCephStorageNetworkValue('{}')).toBeNull();
  });

  it('serialize round-trips core fields', () => {
    const raw = serializeCephStorageNetworkValue({
      vlan: 50,
      clusterNetwork: 'storage',
      range: '10.0.0.0/24',
    });
    expect(parseCephStorageNetworkValue(raw)).toEqual({
      vlan: 50,
      clusterNetwork: 'storage',
      range: '10.0.0.0/24',
    });
  });

  it('validateCephStorageNetworkConfig checks CIDR', () => {
    expect(
      validateCephStorageNetworkConfig({
        vlan: 100,
        clusterNetwork: 'cn-a',
        range: 'not-a-cidr',
      }),
    ).not.toBeNull();
    expect(
      validateCephStorageNetworkConfig({
        vlan: 100,
        clusterNetwork: 'cn-a',
        range: '176.11.0.0/24',
      }),
    ).toBeNull();
  });

  it('isCephStorageNetworkConfigured requires all fields', () => {
    expect(isCephStorageNetworkConfigured(null)).toBe(false);
    expect(
      isCephStorageNetworkConfigured({
        vlan: 1,
        clusterNetwork: 'x',
        range: '1.1.1.0/24',
      }),
    ).toBe(true);
  });
});
