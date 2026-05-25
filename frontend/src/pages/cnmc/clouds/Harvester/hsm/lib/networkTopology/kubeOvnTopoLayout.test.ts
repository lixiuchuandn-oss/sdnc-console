import {
  formatNicUplinkStatusInGrayBar,
  formatSwitchUplinkStatusInGrayBar,
  harvesterNodeManagementAddressText,
  safeNodeId,
  topoGridTopYForRowGroup,
  topoNodeLeftX,
  TOPO_COL_CENTER_PITCH,
  TOPO_ROW_CENTER_PITCH,
} from './kubeOvnTopoPrimitives';

describe('kubeOvnTopoLayout', () => {
  describe('topoNodeLeftX', () => {
    it('centers columns on pitch grid', () => {
      const w = 200;
      expect(topoNodeLeftX(0, 0, w)).toBe(-w / 2);
      expect(topoNodeLeftX(1, 0, w, TOPO_COL_CENTER_PITCH)).toBe(TOPO_COL_CENTER_PITCH - w / 2);
    });
  });

  describe('topoGridTopYForRowGroup', () => {
    it('aligns hub row to median grid index', () => {
      const start = 40;
      const yTops = [start, start + TOPO_ROW_CENTER_PITCH, start + 2 * TOPO_ROW_CENTER_PITCH];
      expect(topoGridTopYForRowGroup(start, yTops)).toBe(start + TOPO_ROW_CENTER_PITCH);
    });
  });

  describe('safeNodeId', () => {
    it('sanitizes raw id', () => {
      expect(safeNodeId('pn', 'eth0/1')).toBe('pn_eth0_1');
      expect(safeNodeId('x', '')).toBe('x_x');
    });
  });

  describe('formatNicUplinkStatusInGrayBar', () => {
    it('reads nic state from node', () => {
      const node = { nics: [{ device: 'eth0', state: 'up' }] };
      expect(formatNicUplinkStatusInGrayBar(node, 'eth0')).toBe('状态：up');
      expect(formatNicUplinkStatusInGrayBar(node, 'eth1')).toContain('无此设备名');
    });
  });

  describe('harvesterNodeManagementAddressText', () => {
    it('prefers internalIP then status address', () => {
      expect(harvesterNodeManagementAddressText({ internalIP: '10.0.0.1' })).toBe('10.0.0.1');
      expect(
        harvesterNodeManagementAddressText({
          status: { addresses: [{ type: 'InternalIP', address: '10.0.0.2' }] },
        }),
      ).toBe('10.0.0.2');
      expect(harvesterNodeManagementAddressText(null)).toBe('未上报');
    });
  });

  describe('formatSwitchUplinkStatusInGrayBar', () => {
    it('reflects LLDP match and port status', () => {
      expect(formatSwitchUplinkStatusInGrayBar('up', true)).toBe('状态：up');
      expect(formatSwitchUplinkStatusInGrayBar('', false)).toBe('状态：无 LLDP 匹配');
    });
  });
});
