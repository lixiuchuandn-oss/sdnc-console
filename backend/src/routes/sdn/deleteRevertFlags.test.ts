import fs from 'fs';
import path from 'path';
import { queryFlagOff } from './deleteRevertFlags';

const readHere = (name: string) => fs.readFileSync(path.join(__dirname, name), 'utf8');
const readRepo = (...parts: string[]) =>
  fs.readFileSync(path.join(__dirname, '..', '..', '..', '..', ...parts), 'utf8');

describe('delete revert flags (R1)', () => {
  it('treats 0/false/no as explicit platform-only (must 400)', () => {
    expect(queryFlagOff('0')).toBe(true);
    expect(queryFlagOff('false')).toBe(true);
    expect(queryFlagOff('no')).toBe(true);
  });

  it('treats omitted or true as allowed (server reverts device)', () => {
    expect(queryFlagOff(undefined)).toBe(false);
    expect(queryFlagOff('')).toBe(false);
    expect(queryFlagOff('1')).toBe(false);
    expect(queryFlagOff('true')).toBe(false);
  });

  it('SRv6 DELETE rejects explicit platform-only flags and always reverts device', () => {
    const route = readHere('srv6.ts');
    expect(route).toMatch(/queryFlagOff\(req\.query\.revertPlatform\)/);
    expect(route).toMatch(/queryFlagOff\(req\.query\.revertDevice\)/);
    expect(route).toMatch(/deleteSrv6TunnelWithRevert\(item\)/);
    expect(route).not.toMatch(/revertDevice\s*[:=]\s*false/);

    const impl = readHere('srv6.delete.ts');
    expect(impl).toMatch(/pushVRConfig/);
    expect(impl.match(/persistPlatform:\s*false/g)?.length).toBe(3);
    expect(impl).not.toMatch(/revertDevice/);
    expect(impl).not.toMatch(/onlyDelete|deleteRowOnly|skipDevice/);

    const api = readRepo('frontend', 'src', 'services', 'api.ts');
    expect(api).toMatch(/export const deleteSrv6Tunnel = async \(id: string\)/);
    expect(api).not.toMatch(/revertDevice=0/);
  });

  it('HA DELETE omits revert as always-on; explicit false is 400', () => {
    const route = readHere('ibrHaGroups.ts');
    expect(route).toMatch(/queryFlagOff\(req\.query\.revertDevice\)/);
    expect(route).toMatch(/ibrHaGroupService\.remove\(String\(req\.params\.id/);
    expect(route).not.toMatch(/revertDevice:\s*false/);

    const svc = readRepo('backend', 'src', 'services', 'vrouter', 'ibrHaGroupService.ts');
    expect(svc).toMatch(/async remove\(id: string\)/);
    expect(svc.match(/persistPlatform:\s*false/g)?.length).toBe(2);
    expect(svc).not.toMatch(/revertDevice/);

    const api = readRepo('frontend', 'src', 'services', 'ibrHaGroupApi.ts');
    expect(api).toMatch(/export async function deleteIbrHaGroup\(id: string\)/);
    expect(api).not.toMatch(/revertDevice/);
  });

  it('instance delete allows never-configured empty VR2; leftover still refuses', () => {
    const svc = readRepo('backend', 'src', 'services', 'vrouter', 'vrInstanceDeleteService.ts');
    expect(svc).toMatch(/reason: 'no_snapshot'/);
    expect(svc).toMatch(/neverConfigured/);
    expect(svc).toMatch(/never_configured/);

    const modal = readRepo('frontend', 'src', 'pages', 'sdncc', 'ibr', 'routers', 'DeleteVrInstanceModal.tsx');
    expect(modal).toMatch(/preview\.neverConfigured/);
    expect(modal).toMatch(/无法删除该 IBR 实例/);
    expect(modal).toMatch(/okText="确定"/);
    expect(modal).not.toMatch(/知道了/);
    expect(modal).not.toMatch(/注销平台/);
  });
});
