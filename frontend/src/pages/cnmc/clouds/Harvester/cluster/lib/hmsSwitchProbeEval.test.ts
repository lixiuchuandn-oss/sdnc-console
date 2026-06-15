import type { AswCtlSwitchProbeRecord } from 'services/harvester/types/aswProbe';
import {
  evaluateHmsProbeDimState,
  isInfoProbeContentSufficient,
  isInterfacesProbeContentSufficient,
} from './hmsSwitchProbeEval';

const h3cIfStdout = `<H3C-CORE-SW>display interface brief | include XGE
XGE1/0/1             UP   10G(a)  F(a)   A    11   to 58_enp175s0f1
XGE1/0/2             UP   10G(a)  F(a)   A    11   to 59_enp175s0f0
`;

describe('hmsSwitchProbeEval', () => {
  it('treats interfaces as ok when XGE lines parse despite interfacesError', () => {
    const record: AswCtlSwitchProbeRecord = {
      interfacesError: 'ssh command timeout after 15s',
      interfaces: {
        host: '10.21.0.1',
        ok: false,
        lines: [{ command: 'display interface brief | include XGE', stdout: h3cIfStdout }],
      },
    };
    expect(isInterfacesProbeContentSufficient(record)).toBe(true);
    expect(
      evaluateHmsProbeDimState(record, {
        errorKey: 'interfacesError',
        dataKey: 'interfaces',
      }),
    ).toBe('ok');
  });

  it('treats info as ok when H3C version stdout present despite infoError', () => {
    const record: AswCtlSwitchProbeRecord = {
      infoError: 'ssh command timeout after 15s',
      info: {
        host: '10.21.0.1',
        ok: false,
        lines: [
          {
            command: 'display version',
            stdout:
              'H3C Comware Software, Version 7.1.070\nBOARD TYPE: LS-6520X-48XS-6Q-EI\n',
          },
        ],
      },
    };
    expect(isInfoProbeContentSufficient(record, 'H3C')).toBe(true);
    expect(
      evaluateHmsProbeDimState(record, {
        errorKey: 'infoError',
        dataKey: 'info',
        vendor: 'H3C',
      }),
    ).toBe('ok');
  });

  it('fails when no parseable interface stdout', () => {
    const record: AswCtlSwitchProbeRecord = {
      interfacesError: 'connection refused',
      interfaces: { ok: false, lines: [{ stdout: '<H3C>display interface brief\n' }] },
    };
    expect(isInterfacesProbeContentSufficient(record)).toBe(false);
    expect(
      evaluateHmsProbeDimState(record, {
        errorKey: 'interfacesError',
        dataKey: 'interfaces',
      }),
    ).toBe('err');
  });
});
