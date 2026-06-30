import {
  collectIfaceNamesForSelect,
  looksLikeIfaceName,
} from './vrMergedHelpers';

describe('vrMergedHelpers', () => {
  it('looksLikeIfaceName rejects status tokens and punctuation variants', () => {
    expect(looksLikeIfaceName('enabled')).toBe(false);
    expect(looksLikeIfaceName('enabled.')).toBe(false);
    expect(looksLikeIfaceName('is')).toBe(false);
    expect(looksLikeIfaceName('not')).toBe(false);
    expect(looksLikeIfaceName('tap')).toBe(false);
    expect(looksLikeIfaceName('tap-inject')).toBe(false);
    expect(looksLikeIfaceName('enabled is not tap-inject')).toBe(false);
  });

  it('looksLikeIfaceName accepts real interface names', () => {
    expect(looksLikeIfaceName('GigabitEthernet 2/3/0')).toBe(true);
    expect(looksLikeIfaceName('GigabitEthernet 2/2/0')).toBe(true);
    expect(looksLikeIfaceName('eth0')).toBe(true);
    expect(looksLikeIfaceName('lo')).toBe(true);
    expect(looksLikeIfaceName('TapEthernet0')).toBe(true);
  });

  it('collectIfaceNamesForSelect merges vr2 when vr3 has junk tokens', () => {
    const merged = {
      vr3_info: {
        interfaces: [
          { name: 'enabled.' },
          { name: 'is' },
          { name: 'not' },
          { name: 'tap-inject' },
          { name: 'tap' },
        ],
      },
      vr2_info: {
        interfaces_GigabitEthernet: [
          { name: 'GigabitEthernet 2/3/0', ipv6_static: '2001::1/64' },
          { name: 'GigabitEthernet 2/2/0', ipv6_static: '2001::2/64' },
        ],
      },
    };
    const names = collectIfaceNamesForSelect(merged);
    expect(names).toEqual(['GigabitEthernet 2/3/0', 'GigabitEthernet 2/2/0']);
  });

  it('collectIfaceNamesForSelect includes baseline and extraNames', () => {
    const merged = { vr3_info: {}, vr2_info: {} };
    const names = collectIfaceNamesForSelect(merged, {
      baseline: {
        interfaces_GigabitEthernet: [{ name: 'GigabitEthernet 0/0/1' }],
      },
      extraNames: ['GigabitEthernet 2/2/0'],
    });
    expect(names).toContain('GigabitEthernet 0/0/1');
    expect(names).toContain('GigabitEthernet 2/2/0');
  });
});
