import { lockedWanFieldChanges } from './peWizardReferencedPatch';
import {
  isHubPublicAsnLocked,
  isLanVrfBgpLocked,
  lockedIpv4Fill,
  normalizeIfaceNameLoose,
  shouldClearIpOnMissingIface,
  wanRowsForLockCheck,
} from './wizardLockRules';

const spokeSavedCfg = {
  role: 'SPOKE_PE',
  pe: {
    publicConfig: { wanName: 'GigabitEthernet 0/7/0', wanIpv4: '30.1.1.100/24', wanIpv6: '2300::100/64' },
    lanConfig: [{ vrf: 10002, lanName: 'GigabitEthernet 0/8/0', ipv4: '32.1.1.3/24' }],
  },
};

describe('wizardLockRules', () => {
  describe('Spoke 放行：未改 WAN 不应报“不可删除”', () => {
    it('Spoke 用 wanDev 组 WAN 行，未改动时无锁定冲突', () => {
      const rows = wanRowsForLockCheck(false, undefined, 'GigabitEthernet 0/7/0');
      expect(rows).toEqual([{ ifName: 'GigabitEthernet 0/7/0' }]);
      expect(lockedWanFieldChanges(spokeSavedCfg, rows as any)).toEqual([]);
    });

    it('Spoke 口名仅空格差异也放行', () => {
      const rows = wanRowsForLockCheck(false, undefined, 'GigabitEthernet0/7/0');
      expect(lockedWanFieldChanges(spokeSavedCfg, rows as any)).toEqual([]);
    });

    it('回归：旧逻辑读 hubWanInventory（Spoke 为空）会误报', () => {
      expect(lockedWanFieldChanges(spokeSavedCfg, [] as any)).toEqual([
        'WAN GigabitEthernet 0/7/0：不可删除（已被隧道引用）',
      ]);
    });

    it('Spoke wanDev 为空时返回空行（交由锁定校验拦截）', () => {
      expect(wanRowsForLockCheck(false, [{ ifName: 'x' }], '')).toEqual([]);
    });

    it('Hub 仍使用多 WAN inventory', () => {
      expect(wanRowsForLockCheck(true, [{ ifName: ' ge0 ' }, { ifName: 'ge1' }], 'ignored')).toEqual([
        { ifName: 'ge0' },
        { ifName: 'ge1' },
      ]);
    });
  });

  describe('Hub 公网 ASN 锁定', () => {
    it('被隧道引用即锁定，未引用不锁', () => {
      expect(isHubPublicAsnLocked(true)).toBe(true);
      expect(isHubPublicAsnLocked(false)).toBe(false);
    });
  });

  describe('同 VRF 锁 BGP', () => {
    const locked = new Set(['10002']);
    it('Hub：与被引用 LAN 同 VRF 的 LAN #2 也锁 BGP 字段', () => {
      expect(isLanVrfBgpLocked(true, true, 10002, locked)).toBe(true);
      expect(isLanVrfBgpLocked(true, true, '10002', locked)).toBe(true);
    });
    it('Hub：其它 VRF / 新行（空 VRF）不锁', () => {
      expect(isLanVrfBgpLocked(true, true, 10003, locked)).toBe(false);
      expect(isLanVrfBgpLocked(true, true, '', locked)).toBe(false);
      expect(isLanVrfBgpLocked(true, true, undefined, locked)).toBe(false);
    });
    it('Spoke 被引用时全锁；未被引用都不锁', () => {
      expect(isLanVrfBgpLocked(true, false, 99999, locked)).toBe(true);
      expect(isLanVrfBgpLocked(false, true, 10002, locked)).toBe(false);
      expect(isLanVrfBgpLocked(false, false, 10002, locked)).toBe(false);
    });
  });

  describe('回填不清空', () => {
    it('设备回读找不到口：锁定字段不清空，未锁定才清空', () => {
      expect(shouldClearIpOnMissingIface(true, true)).toBe(false);
      expect(shouldClearIpOnMissingIface(true, false)).toBe(true);
      expect(shouldClearIpOnMissingIface(false, false)).toBe(false);
    });
    it('锁定 IPv4：已有值不覆盖，空值用设备主地址补', () => {
      expect(lockedIpv4Fill('23.1.1.3/24', '9.9.9.9/24')).toBeUndefined();
      expect(lockedIpv4Fill('', '23.1.1.3/24')).toBe('23.1.1.3/24');
      expect(lockedIpv4Fill(undefined, ' 34.1.1.3/24 ')).toBe('34.1.1.3/24');
      expect(lockedIpv4Fill('', '')).toBeUndefined();
    });
    it('接口名忽略空格匹配（避免找不到口而清空）', () => {
      expect(normalizeIfaceNameLoose('GigabitEthernet 0/7/0')).toBe(normalizeIfaceNameLoose('gigabitethernet0/7/0'));
    });
  });
});
