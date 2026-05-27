import type { HmsSwitchCr } from 'services/harvester/types/cluster';
import {
  HMS_SWITCH_DEFAULT_DIAL_TIMEOUT,
  HMS_SWITCH_DEFAULT_EXEC_TIMEOUT,
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
});
