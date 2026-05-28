import {
  formValuesFromEffective,
  formValuesToConfig,
  parseCephStorageNetworkValue,
  validateCephStorageNetworkForm,
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

  it('formValuesFromEffective maps configured vs mgmt', () => {
    expect(
      formValuesFromEffective({
        mode: 'configured',
        settingName: 'ceph-storage-network',
        config: { vlan: 50, clusterNetwork: 'storage', range: '10.1.0.0/24' },
      }).enabled,
    ).toBe(true);
    expect(
      formValuesFromEffective({
        mode: 'mgmt',
        settingName: 'ceph-storage-network',
        config: null,
      }).enabled,
    ).toBe(false);
  });

  it('validateCephStorageNetworkForm requires fields when enabled', () => {
    expect(validateCephStorageNetworkForm({ enabled: false })).toBeNull();
    expect(validateCephStorageNetworkForm({ enabled: true, vlan: 100 })).not.toBeNull();
    expect(
      validateCephStorageNetworkForm({
        enabled: true,
        vlan: 100,
        clusterNetwork: 'cn-a',
        range: '176.11.0.0/24',
      }),
    ).toBeNull();
  });

  it('formValuesToConfig returns null when disabled', () => {
    expect(formValuesToConfig({ enabled: false })).toBeNull();
  });
});
