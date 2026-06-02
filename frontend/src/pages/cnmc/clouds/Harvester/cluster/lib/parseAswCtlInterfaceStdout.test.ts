import {
  classifyPortStatus,
  formatSwitchInterfaceStdoutParseHint,
  getSwitchInterfaceStdoutParseHint,
  isHuaweiStyleLogicalInterfaceName,
  isH3cStyleLogicalInterfaceName,
  isSwitchInterfaceStdoutLikelyTruncated,
  parseInterfaceStatusStdout,
} from './parseAswCtlInterfaceStdout';

const H3C_ROUTE_BRIEF_SAMPLE = `
Brief information on interfaces in route mode:
Link: ADM - administratively down; Stby - standby
Protocol: (s) - spoofing
Interface            Link Protocol Primary IP        Description
GE1/0/1              UP   UP       10.1.1.2         Link to CoreRouter
GE1/0/2              DOWN DOWN     --
XGE1/0/49            UP   UP       --
Loop0                UP   UP(s)    2.2.2.2
NULL0                UP   UP(s)    --
Vlan1                UP   DOWN     --
`;

const H3C_BRIDGE_BRIEF_SAMPLE = `
The brief information of interfaces in bridge mode:
Link: ADM - administratively down; Stby - standby
Interface            Link Speed   Duplex Type PVID Description
GE1/0/1              UP   1000M    F      A    1    Uplink
GE1/0/2              DOWN auto     A      A    1
`;

describe('parseAswCtlInterfaceStdout helpers', () => {
  describe('classifyPortStatus', () => {
    it('classifies link up/down and admin down', () => {
      expect(classifyPortStatus('up')).toBe('up');
      expect(classifyPortStatus('down')).toBe('down');
      expect(classifyPortStatus('admin down')).toBe('admin');
      expect(classifyPortStatus('')).toBe('unknown');
    });
  });

  describe('isHuaweiStyleLogicalInterfaceName', () => {
    it('treats Vlanif and NULL as logical', () => {
      expect(isHuaweiStyleLogicalInterfaceName('Vlanif100')).toBe(true);
      expect(isHuaweiStyleLogicalInterfaceName('NULL0')).toBe(true);
      expect(isHuaweiStyleLogicalInterfaceName('GE1/0/1')).toBe(false);
    });
  });

  describe('isH3cStyleLogicalInterfaceName', () => {
    it('treats Vlan and Loop as logical', () => {
      expect(isH3cStyleLogicalInterfaceName('Vlan1')).toBe(true);
      expect(isH3cStyleLogicalInterfaceName('Loop0')).toBe(true);
      expect(isH3cStyleLogicalInterfaceName('NULL0')).toBe(true);
      expect(isH3cStyleLogicalInterfaceName('XGE1/0/49')).toBe(false);
    });
  });

  describe('parseInterfaceStatusStdout · H3C Comware brief', () => {
    it('parses route mode Interface/Link/Protocol table', () => {
      const ports = parseInterfaceStatusStdout(H3C_ROUTE_BRIEF_SAMPLE);
      expect(ports.map((p) => p.name)).toEqual(['GE1/0/1', 'GE1/0/2', 'XGE1/0/49']);
      expect(ports[0]?.status).toBe('UP / UP');
      expect(ports[1]?.status).toBe('DOWN / DOWN');
    });

    it('parses bridge mode Interface/Link/Speed table', () => {
      const ports = parseInterfaceStatusStdout(H3C_BRIDGE_BRIEF_SAMPLE);
      expect(ports.map((p) => p.name)).toEqual(['GE1/0/1', 'GE1/0/2']);
      expect(ports[0]?.speed).toContain('1000M');
    });
  });

  describe('isSwitchInterfaceStdoutLikelyTruncated', () => {
    it('detects probe sample truncated at header', () => {
      const truncated = `
<H3C-CORE-SW>display interface brief
Brief information on interfaces in route mode:
Link: ADM - administratively down; Stby - standby
Protocol: (s) - spoofing
Interface            Link 
`;
      expect(isSwitchInterfaceStdoutLikelyTruncated(truncated)).toBe(true);
      expect(getSwitchInterfaceStdoutParseHint(truncated)).toBe('truncated-table');
    });

    it('returns false when H3C table has data rows', () => {
      expect(isSwitchInterfaceStdoutLikelyTruncated(H3C_ROUTE_BRIEF_SAMPLE)).toBe(false);
      expect(getSwitchInterfaceStdoutParseHint(H3C_ROUTE_BRIEF_SAMPLE)).toBe('ok');
    });

    it('detects ---- More ---- pagination marker', () => {
      expect(isSwitchInterfaceStdoutLikelyTruncated('---- More ----')).toBe(true);
    });

    it('detects sync sample: screen-length failed and empty interface brief', () => {
      const syncStdout =
        '<H3C-CORE-SW>screen-length 0 temporary\r\n % Unrecognized command found at \'^\' position.\r\n<H3C-CORE-SW>display interface brief\r\n';
      expect(getSwitchInterfaceStdoutParseHint(syncStdout)).toBe('h3c-screen-length');
      expect(isSwitchInterfaceStdoutLikelyTruncated(syncStdout)).toBe(true);
    });
  });

  describe('formatSwitchInterfaceStdoutParseHint', () => {
    it('returns actionable text for h3c-screen-length', () => {
      expect(formatSwitchInterfaceStdoutParseHint('h3c-screen-length')).toContain('screen-length disable');
    });
  });
});
