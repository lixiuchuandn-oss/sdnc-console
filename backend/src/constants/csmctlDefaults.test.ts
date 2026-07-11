import { SDNC_DEFAULT_CSMCTL_ADDRESS } from './csmctlDefaults';

const mockGetSystemSetting = jest.fn((_key: string) => '');

jest.mock('../config/systemSettings', () => ({
  getSystemSetting: (key: string) => mockGetSystemSetting(key),
}));

describe('csmctlDefaults', () => {
  it('SDNC default points to local compose port', () => {
    expect(SDNC_DEFAULT_CSMCTL_ADDRESS).toBe('https://127.0.0.1:8016');
  });
});

describe('resolveCsmctlAddressRaw', () => {
  const prevFlavor = process.env.PRODUCT_FLAVOR;
  const prevEnv = process.env.CSMCTL_ADDRESS;

  beforeEach(() => {
    mockGetSystemSetting.mockImplementation((key: string) =>
      key === 'CSMCTL_ADDRESS' ? '' : '',
    );
  });

  afterEach(() => {
    if (prevFlavor === undefined) delete process.env.PRODUCT_FLAVOR;
    else process.env.PRODUCT_FLAVOR = prevFlavor;
    if (prevEnv === undefined) delete process.env.CSMCTL_ADDRESS;
    else process.env.CSMCTL_ADDRESS = prevEnv;
    jest.resetModules();
    mockGetSystemSetting.mockReset();
  });

  it('falls back to SDNC default when unset', () => {
    process.env.PRODUCT_FLAVOR = 'sdnc';
    delete process.env.CSMCTL_ADDRESS;
    jest.resetModules();
    const { resolveCsmctlAddressRaw } = require('../services/vrouter/csmctlEndpoint');
    expect(resolveCsmctlAddressRaw()).toBe('https://127.0.0.1:8016');
  });

  it('prefers system setting over env', () => {
    process.env.PRODUCT_FLAVOR = 'sdnc';
    process.env.CSMCTL_ADDRESS = 'https://csm.example:8443';
    mockGetSystemSetting.mockImplementation((key: string) =>
      key === 'CSMCTL_ADDRESS' ? 'https://settings.example:9443' : '',
    );
    jest.resetModules();
    const { resolveCsmctlAddressRaw } = require('../services/vrouter/csmctlEndpoint');
    expect(resolveCsmctlAddressRaw()).toBe('https://settings.example:9443');
  });

  it('uses CSMCTL_ADDRESS env when system setting empty', () => {
    process.env.PRODUCT_FLAVOR = 'sdnc';
    process.env.CSMCTL_ADDRESS = 'https://csm.example:8443';
    jest.resetModules();
    const { resolveCsmctlAddressRaw } = require('../services/vrouter/csmctlEndpoint');
    expect(resolveCsmctlAddressRaw()).toBe('https://csm.example:8443');
  });

  it('returns empty for tower without config', () => {
    process.env.PRODUCT_FLAVOR = 'tower';
    delete process.env.CSMCTL_ADDRESS;
    jest.resetModules();
    const { resolveCsmctlAddressRaw } = require('../services/vrouter/csmctlEndpoint');
    expect(resolveCsmctlAddressRaw()).toBe('');
  });
});
