import { SWITCH_EMBEDDED_PORT_VISUAL } from './embeddedSwitchPortTileVisual';

describe('embeddedSwitchPortTileVisual', () => {
  it('defines label for each port status kind', () => {
    expect(SWITCH_EMBEDDED_PORT_VISUAL.up.label).toBe('Up');
    expect(SWITCH_EMBEDDED_PORT_VISUAL.down.label).toBe('Down');
    expect(SWITCH_EMBEDDED_PORT_VISUAL.admin.label).toBe('Admin');
    expect(SWITCH_EMBEDDED_PORT_VISUAL.unknown.label).toBe('未知');
  });
});
