import {
  encryptCsmWebPassword,
  looksLikeCsmRsaEncryptedPassword,
  normalizeCsmCloudConfig,
  resolveCsmPasswordEncrypted,
} from './csmWebPassword';

describe('csmWebPassword', () => {
  it('encryptCsmWebPassword produces long RSA base64', () => {
    const enc = encryptCsmWebPassword('Admin@123');
    expect(enc.length).toBeGreaterThan(100);
    expect(looksLikeCsmRsaEncryptedPassword(enc)).toBe(true);
  });

  it('resolveCsmPasswordEncrypted encrypts plain config field', () => {
    const enc = resolveCsmPasswordEncrypted({ csmRepairPassword: 'Admin@123' });
    expect(looksLikeCsmRsaEncryptedPassword(enc)).toBe(true);
  });

  it('resolveCsmPasswordEncrypted treats short mistaken plaintext as plain', () => {
    const enc = resolveCsmPasswordEncrypted({ csmRepairPasswordEncrypted: 'Admin@123' });
    expect(looksLikeCsmRsaEncryptedPassword(enc)).toBe(true);
  });

  it('normalizeCsmCloudConfig stores encrypted and removes plain', () => {
    const out = normalizeCsmCloudConfig({ csmRepairPassword: 'Admin@123' });
    expect(out.csmRepairPassword).toBeUndefined();
    expect(looksLikeCsmRsaEncryptedPassword(String(out.csmRepairPasswordEncrypted))).toBe(true);
  });

  it('resolveCsmPasswordEncrypted ignores stale short legacy blob', () => {
    const enc = resolveCsmPasswordEncrypted({
      csmRepairPasswordEncrypted: '+yNpVuicvsiBzpDpeaIq3g==',
    });
    expect(enc).toBe('');
  });
});
