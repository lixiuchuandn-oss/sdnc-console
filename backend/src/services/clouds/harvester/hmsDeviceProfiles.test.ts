import { parseHmsDeviceProfilesPayload } from './hmsDeviceProfiles';

describe('parseHmsDeviceProfilesPayload', () => {
  it('parses string array', () => {
    expect(parseHmsDeviceProfilesPayload(['huawei', 'h3c'])).toEqual([
      { value: 'huawei', label: 'huawei' },
      { value: 'h3c', label: 'h3c' },
    ]);
  });

  it('parses profiles object map', () => {
    expect(
      parseHmsDeviceProfilesPayload({
        api_version: 'v1',
        profiles: {
          华为: {},
          H3C: {},
        },
      }),
    ).toEqual([
      { value: '华为', label: '华为' },
      { value: 'H3C', label: 'H3C' },
    ]);
  });

  it('parses object items with name/label', () => {
    expect(
      parseHmsDeviceProfilesPayload({
        items: [
          { name: 'winics', label: '威努特' },
          { id: 'vrp', display_name: '华为 VRP' },
        ],
      }),
    ).toEqual([
      { value: 'winics', label: '威努特' },
      { value: 'vrp', label: '华为 VRP' },
    ]);
  });
});
