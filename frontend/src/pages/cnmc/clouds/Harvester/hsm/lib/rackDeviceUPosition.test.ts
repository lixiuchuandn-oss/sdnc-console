import {
  compareRackDeviceSlotOrder,
  findRackDeviceByUPosition,
  formatRackDeviceULabel,
  nextDefaultUPositionForRack,
  normalizeRackDeviceUPosition,
  rackDeviceUPositionKey,
} from './rackDeviceUPosition';

describe('rackDeviceUPosition', () => {
  it('formats U label without duplicating prefix', () => {
    expect(formatRackDeviceULabel('12')).toBe('U12');
    expect(formatRackDeviceULabel('U12')).toBe('U12');
    expect(formatRackDeviceULabel('12-14')).toBe('U12-14');
    expect(formatRackDeviceULabel('')).toBe('U0');
  });

  it('suggests next numeric U for new device', () => {
    expect(nextDefaultUPositionForRack([{ slotOrder: '3' }, { slotOrder: '10' }])).toBe('11');
    expect(nextDefaultUPositionForRack([{ slotOrder: 'U5' }, { slotOrder: 'top' }])).toBe('1');
  });

  it('sorts numeric U first then localeCompare', () => {
    expect(compareRackDeviceSlotOrder('2', '10')).toBeLessThan(0);
    expect(compareRackDeviceSlotOrder('12-14', 'U5')).not.toBe(0);
  });

  it('normalizes trim', () => {
    expect(normalizeRackDeviceUPosition('  12  ')).toBe('12');
  });

  it('treats U12 and 12 as same key for duplicate check', () => {
    expect(rackDeviceUPositionKey('U12')).toBe(rackDeviceUPositionKey('12'));
    const devices = [{ id: 'a', slotOrder: '12' }];
    expect(findRackDeviceByUPosition(devices, 'U12')).toEqual(devices[0]);
    expect(findRackDeviceByUPosition(devices, 'U12', 'a')).toBeUndefined();
  });
});
