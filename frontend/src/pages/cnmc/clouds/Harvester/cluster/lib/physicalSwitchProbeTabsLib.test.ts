import {
  buildSwitchProbeDrawerModel,
  probeStateText,
} from './physicalSwitchProbeTabsLib';

describe('physicalSwitchProbeTabsLib', () => {
  const healthy: Parameters<typeof buildSwitchProbeDrawerModel>[0] = {
    name: 'sw-1',
    baseUrl: 'http://10.0.0.1:8080',
    info: { ok: true, host: '10.0.0.2', lines: [{ stdout: 'Model: X', command: 'show version' }] },
    interfaces: { ok: true, host: '10.0.0.2' },
    health: 'ok',
  };

  it('probeStateText returns 正常 when section data exists', () => {
    expect(probeStateText(healthy, { errorKey: 'infoError', dataKey: 'info' })).toBe('正常');
  });

  it('probeStateText returns 失败 on error flag', () => {
    expect(
      probeStateText({ ...healthy, infoError: 'timeout' }, { errorKey: 'infoError', dataKey: 'info' }),
    ).toBe('失败');
  });

  it('buildSwitchProbeDrawerModel reads host and KPI values', () => {
    const model = buildSwitchProbeDrawerModel(healthy);
    expect(model.host).toBe('10.0.0.2');
    expect(model.kpiInfoVal).toBe('正常');
    expect(model.kpiInfoTone).toBe('ok');
  });

  it('marks performance as warn when not applicable', () => {
    const model = buildSwitchProbeDrawerModel({
      ...healthy,
      performanceNotApplicable: true,
      performance: undefined,
    });
    expect(model.kpiPerfVal).toBe('未配置');
    expect(model.kpiPerfTone).toBe('warn');
  });
});
