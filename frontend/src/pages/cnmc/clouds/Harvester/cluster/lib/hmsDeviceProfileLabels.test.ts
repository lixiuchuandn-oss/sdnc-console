import { formatHmsDeviceProfileLabel } from './hmsSwitchCrForm';

describe('formatHmsDeviceProfileLabel', () => {
  it('maps known profile keys to Chinese labels', () => {
    expect(formatHmsDeviceProfileLabel('h3c-huawei-like')).toBe('H3C/华为');
    expect(formatHmsDeviceProfileLabel('cisco-like')).toBe('思科');
    expect(formatHmsDeviceProfileLabel('winicssec-wos')).toBe('威努特');
    expect(formatHmsDeviceProfileLabel('generic')).toBe('通用');
    expect(formatHmsDeviceProfileLabel('default')).toBe('默认');
  });

  it('is case-insensitive for known keys', () => {
    expect(formatHmsDeviceProfileLabel('CISCO')).toBe('思科');
    expect(formatHmsDeviceProfileLabel('Default')).toBe('默认');
  });

  it('prefers remote label when value is unknown', () => {
    expect(formatHmsDeviceProfileLabel('custom', '自定义模板')).toBe('自定义模板');
  });

  it('falls back to raw value for unknown keys', () => {
    expect(formatHmsDeviceProfileLabel('unknown-profile')).toBe('unknown-profile');
  });

  it('returns dash for empty value', () => {
    expect(formatHmsDeviceProfileLabel('')).toBe('—');
    expect(formatHmsDeviceProfileLabel(null)).toBe('—');
  });
});
