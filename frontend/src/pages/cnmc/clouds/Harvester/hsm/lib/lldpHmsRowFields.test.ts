import {
  buildLldpSimpleLines,
  extractHmsLldpRows,
  formatLldpBriefForPort,
  pickLldpManagementIpv4,
  pickLldpPeerPort,
  pickLldpSystemName,
} from './lldpHmsRowFields';

describe('lldpHmsRowFields', () => {
  const row = {
    Interface: 'eth0',
    'System Name': 'core-sw-01',
    'Port Description': 'GigabitEthernet0/0/1',
    'Management Address_IPv4': '192.168.1.10',
  };

  it('extractHmsLldpRows reads hardware.switch array', () => {
    expect(extractHmsLldpRows({ switch: [row] })).toHaveLength(1);
    expect(extractHmsLldpRows(null)).toEqual([]);
  });

  it('pickLldp* helpers read standard TLV keys', () => {
    expect(pickLldpSystemName(row)).toBe('core-sw-01');
    expect(pickLldpPeerPort(row)).toBe('GigabitEthernet0/0/1');
    expect(pickLldpManagementIpv4(row)).toBe('192.168.1.10');
  });

  it('buildLldpSimpleLines deduplicates values', () => {
    const lines = buildLldpSimpleLines(row);
    expect(lines.some((l) => l.label === '对端名称' && l.value === 'core-sw-01')).toBe(true);
    expect(lines.some((l) => l.label === '本机接口' && l.value === 'eth0')).toBe(true);
  });

  it('formatLldpBriefForPort joins system and port', () => {
    expect(formatLldpBriefForPort(row)).toBe('core-sw-01 · GigabitEthernet0/0/1');
  });
});
