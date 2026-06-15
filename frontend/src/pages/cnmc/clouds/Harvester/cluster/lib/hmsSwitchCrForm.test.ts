import type { HmsSwitchCr } from 'services/harvester/types/cluster';
import {
  HMS_SWITCH_DEFAULT_DIAL_TIMEOUT,
  HMS_SWITCH_DEFAULT_EXEC_TIMEOUT,
  HMS_SWITCH_DEVICE_PROFILE_GENERIC,
  buildHmsSwitchDialTimeoutSelectOptions,
  buildHmsSwitchExecTimeoutSelectOptions,
  dedupeHmsDeviceProfileOptions,
  inferHmsDeviceProfileFromVendor,
  normalizeHmsDeviceProfileValue,
  normalizeCliCommandLines,
  hmsSwitchCrToFormValues,
  hmsSwitchFormValuesToSpec,
} from './hmsSwitchCrForm';

describe('hmsSwitchCrForm', () => {
  const cr: HmsSwitchCr = {
    metadata: { name: 'sw-a' },
    spec: {
      primaryHost: '10.0.0.1',
      hosts: ['10.0.0.1', '10.0.0.2'],
      user: 'admin',
      port: 2222,
      vendor: '华为',
      infoCommands: ['display version'],
      interfaceCommands: ['display interface brief'],
      corsAllowedOrigins: ['https://tower.local'],
      dialTimeout: 20,
      execTimeout: 25,
      screenLengthCmd: 'screen-length disable',
    },
  };

  it('maps CR spec to form values', () => {
    const form = hmsSwitchCrToFormValues(cr);
    expect(form.name).toBe('sw-a');
    expect(form.primaryHost).toBe('10.0.0.1');
    expect(form.hostsText).toBe('10.0.0.2');
    expect(form.port).toBe(2222);
    expect(form.infoCommandsText).toBe('display version');
    expect(form.corsAllowedOriginsText).toBe('https://tower.local');
    expect(form.password).toBe('');
    expect(form.screenLengthCmd).toBe('screen-length disable');
  });

  it('builds spec from form values; omits password on edit when blank', () => {
    const form = hmsSwitchCrToFormValues(cr);
    const editSpec = hmsSwitchFormValuesToSpec({ ...form, password: '' }, true);
    expect(editSpec.password).toBeUndefined();
    expect(editSpec.primaryHost).toBe('10.0.0.1');
    expect(editSpec.hosts).toEqual(['10.0.0.1', '10.0.0.2']);
  });

  it('includes password on create and defaults timeouts', () => {
    const spec = hmsSwitchFormValuesToSpec(
      {
        name: 'sw-new',
        primaryHost: '192.168.1.1',
        password: 'secret',
      },
      false,
    );
    expect(spec.password).toBe('secret');
    expect(spec.dialTimeout).toBe(HMS_SWITCH_DEFAULT_DIAL_TIMEOUT);
    expect(spec.execTimeout).toBe(HMS_SWITCH_DEFAULT_EXEC_TIMEOUT);
    expect(spec.corsAllowedOrigins).toEqual(['*']);
  });

  it('normalizes default/generit to generic and infers profile from vendor', () => {
    expect(normalizeHmsDeviceProfileValue('default')).toBe(HMS_SWITCH_DEVICE_PROFILE_GENERIC);
    expect(inferHmsDeviceProfileFromVendor('H3C', ['h3c-huawei-like', 'generic'])).toBe(
      'h3c-huawei-like',
    );
    expect(inferHmsDeviceProfileFromVendor('其他', ['h3c-huawei-like'])).toBe(
      HMS_SWITCH_DEVICE_PROFILE_GENERIC,
    );
    const deduped = dedupeHmsDeviceProfileOptions([
      { value: 'default', label: '默认' },
      { value: 'generic', label: 'Generic' },
      { value: 'h3c-huawei-like', label: 'H3C' },
    ]);
    expect(deduped.map((o) => o.value)).toEqual(['generic', 'h3c-huawei-like']);
  });

  it('builds dial timeout select options including non-preset current value', () => {
    const opts = buildHmsSwitchDialTimeoutSelectOptions(25);
    expect(opts.map((o) => o.value)).toContain(25);
    expect(opts.map((o) => o.value)).toContain(15);
  });

  it('builds exec timeout select options including non-preset current value', () => {
    const opts = buildHmsSwitchExecTimeoutSelectOptions(25);
    expect(opts.map((o) => o.value)).toContain(25);
    expect(opts.map((o) => o.value)).toContain(60);
  });

  it('merges piped interface command split across lines or CR array items', () => {
    expect(normalizeCliCommandLines('display interface brief\n| include XGE')).toEqual([
      'display interface brief | include XGE',
    ]);
    expect(
      hmsSwitchFormValuesToSpec(
        {
          name: 'sw',
          primaryHost: '10.0.0.1',
          password: 'x',
          interfaceCommandsText: 'display interface brief\n| include XGE',
        },
        false,
      ).interfaceCommands,
    ).toEqual(['display interface brief | include XGE']);

    const fromCr = hmsSwitchCrToFormValues({
      metadata: { name: 'sw' },
      spec: {
        primaryHost: '10.0.0.1',
        interfaceCommands: ['display interface brief', '| include XGE'],
      },
    });
    expect(fromCr.interfaceCommandsText).toBe('display interface brief | include XGE');
  });

  it('round-trips screenLengthCmd and clears on edit when blank', () => {
    const form = hmsSwitchCrToFormValues(cr);
    const withCmd = hmsSwitchFormValuesToSpec(
      { ...form, password: 'x', screenLengthCmd: 'screen-length 0 temporary' },
      false,
    );
    expect(withCmd.screenLengthCmd).toBe('screen-length 0 temporary');

    const cleared = hmsSwitchFormValuesToSpec({ ...form, password: '', screenLengthCmd: '' }, true);
    expect(cleared.screenLengthCmd).toBe('');
  });
});
