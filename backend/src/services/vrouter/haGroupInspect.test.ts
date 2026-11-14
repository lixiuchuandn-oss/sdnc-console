import {
  evaluateHaLiveSteps,
  ownedVrrpIdsForMember,
  snapshotFromVrrpPayload,
  type HaLiveMemberSnapshot,
} from './haGroupInspect';
import type { HaGroupVrrpIntent } from './haGroupVrrpIntent';

const INSTANCES_MASTER = `
VRRP Instance = 1
  Sync group = 1
  State = MASTER
  Using src_ip = 12.1.1.1
  Virtual Router ID = 1
  Priority = 200
    12.1.1.254/24 dev GigabitEthernet0/8/0 scope global set
`;

const INSTANCES_BACKUP = `
VRRP Instance = 1
  Sync group = 1
  State = BACKUP
  Using src_ip = 12.1.1.2
  Virtual Router ID = 1
  Priority = 100
    12.1.1.254/24
`;

const GROUPS_GOOD = `
VRRP Sync Group = 1, MASTER
  VRRP member instances = 1
    1
  Using smtp notification = no
  VRRP Script = gateway_chk1-34113
  Command = '/usr/bin/ping' '-i' '0.2' '-c' '1' '34.1.1.3'
  Status = GOOD
`;

const GROUPS_FAULT = GROUPS_GOOD.replace('Status = GOOD', 'Status = FAULT');

const vrids = new Set([1]);
const groupIds = new Set([1]);

function member(
  role: 'primary' | 'backup',
  patch: Partial<HaLiveMemberSnapshot>,
): HaLiveMemberSnapshot {
  return {
    role,
    vrUuid: role === 'primary' ? 'vr-a' : 'vr-b',
    name: role === 'primary' ? 'CE3' : 'CE4',
    reachable: true,
    state: null,
    vrid: 1,
    memberVrids: [1],
    groupIds: [1],
    virtualIps: [],
    vipInstalled: false,
    anyVipInstalled: false,
    trackStatus: null,
    trackCommand: null,
    trackGateway: null,
    groupsReadable: true,
    trackIncomplete: false,
    instances: [],
    groups: [],
    ...patch,
  };
}

describe('haGroupInspect', () => {
  it('parses live payload for owned vrid', () => {
    const snap = snapshotFromVrrpPayload({
      role: 'primary',
      vrUuid: 'vr-a',
      name: 'CE3',
      data: { instancesRaw: INSTANCES_MASTER, groupsRaw: GROUPS_GOOD },
      vrids,
      groupIds,
    });
    expect(snap.reachable).toBe(true);
    expect(snap.state).toBe('MASTER');
    expect(snap.vipInstalled).toBe(true);
    expect(snap.virtualIps).toEqual(['12.1.1.254/24']);
    expect(snap.trackStatus).toBe('GOOD');
    expect(snap.trackGateway).toBe('34.1.1.3');
    expect(snap.memberVrids).toEqual([1]);
    expect(snap.groupIds).toEqual([1]);
    expect(snap.groupsReadable).toBe(true);
    expect(snap.anyVipInstalled).toBe(true);
    expect(snap.trackIncomplete).toBe(false);
  });

  it('filters owned ids per member instead of merging peer intent', () => {
    const intent: HaGroupVrrpIntent = {
      scheme: 'srv6-segment-list-vrrp',
      side: 'local',
      members: [
        {
          role: 'primary',
          vr_uuid: 'vr-a',
          instances: [
            {
              interface: 'GigabitEthernet0/8/0',
              vrid: 1,
              virtual_ip: '12.1.1.254/24',
              priority: 200,
              preempt: true,
              advert_interval: 1,
              advert_mode: 'multicast',
            },
          ],
          groups: [{ group_id: 1, vrrp_instance: 1, track_interval: 1 }],
        },
        {
          role: 'backup',
          vr_uuid: 'vr-b',
          instances: [
            {
              interface: 'GigabitEthernet0/8/0',
              vrid: 2,
              virtual_ip: '12.1.1.254/24',
              priority: 100,
              preempt: true,
              advert_interval: 1,
              advert_mode: 'multicast',
            },
          ],
          groups: [{ group_id: 2, vrrp_instance: 2, track_interval: 1 }],
        },
      ],
    };
    const primaryOwned = ownedVrrpIdsForMember(intent.members[0]);
    const backupOwned = ownedVrrpIdsForMember(intent.members[1]);
    expect([...primaryOwned.vrids]).toEqual([1]);
    expect([...primaryOwned.groupIds]).toEqual([1]);
    expect([...backupOwned.vrids]).toEqual([2]);
    expect([...backupOwned.groupIds]).toEqual([2]);

    const snap = snapshotFromVrrpPayload({
      role: 'primary',
      vrUuid: 'vr-a',
      name: 'CE3',
      data: {
        instancesRaw: `
VRRP Instance = 1
  State = MASTER
  Virtual Router ID = 1
    12.1.1.254/24 scope global set
VRRP Instance = 2
  State = BACKUP
  Virtual Router ID = 2
    12.1.1.253/24
`,
        groupsRaw: `
VRRP Sync Group = 1, MASTER
  Status = GOOD
VRRP Sync Group = 2, BACKUP
  Status = FAULT
`,
      },
      vrids: primaryOwned.vrids,
      groupIds: primaryOwned.groupIds,
    });
    expect(snap.memberVrids).toEqual([1]);
    expect(snap.groupIds).toEqual([1]);
    expect(snap.trackStatus).toBe('GOOD');
    expect(snap.state).toBe('MASTER');
  });

  it('uses Virtual Router ID for memberVrids, not keepalived instance number', () => {
    const snap = snapshotFromVrrpPayload({
      role: 'primary',
      vrUuid: 'vr-a',
      name: 'CE3',
      data: {
        instancesRaw: `
VRRP Instance = 1
  State = MASTER
  Virtual Router ID = 10
    10.1.1.254/24 dev GigabitEthernet0/8/0 scope global set
`,
        groupsRaw: `
VRRP Sync Group = 1, MASTER
  VRRP member instances = 1
    1
  Status = GOOD
`,
      },
      vrids: new Set([10]),
      groupIds: new Set([1]),
    });
    expect(snap.vrid).toBe(10);
    expect(snap.memberVrids).toEqual([10]);
    expect(snap.groupIds).toEqual([1]);
  });

  it('does not treat groups clish error as no-track skip', () => {
    const snap = snapshotFromVrrpPayload({
      role: 'primary',
      vrUuid: 'vr-a',
      name: 'CE3',
      data: { instancesRaw: INSTANCES_MASTER, groupsRaw: 'Unknown command' },
      vrids,
      groupIds,
    });
    expect(snap.reachable).toBe(true);
    expect(snap.groupsReadable).toBe(false);
    expect(snap.trackIncomplete).toBe(true);
    const steps = evaluateHaLiveSteps([
      snap,
      member('backup', { state: 'BACKUP', groupsReadable: true, trackStatus: 'GOOD' }),
    ]);
    expect(steps.find((s) => s.key === 'track')?.status).toBe('fail');
    expect(steps.find((s) => s.key === 'track')?.message).toMatch(/show vrrp groups/);
  });

  it('fails VIP when MASTER has only a subset of addresses installed', () => {
    const steps = evaluateHaLiveSteps([
      member('primary', {
        state: 'MASTER',
        virtualIps: ['12.1.1.254/24', '12.1.1.253/24'],
        vipInstalled: false,
        anyVipInstalled: true,
        trackStatus: 'GOOD',
      }),
      member('backup', { state: 'BACKUP', vipInstalled: false, trackStatus: 'GOOD' }),
    ]);
    expect(steps.find((s) => s.key === 'vip')?.status).toBe('fail');
  });

  it('fails VIP when BACKUP has any address installed', () => {
    const steps = evaluateHaLiveSteps([
      member('primary', {
        state: 'MASTER',
        virtualIps: ['12.1.1.254/24'],
        vipInstalled: true,
        anyVipInstalled: true,
        trackStatus: 'GOOD',
      }),
      member('backup', {
        state: 'BACKUP',
        virtualIps: ['12.1.1.254/24'],
        vipInstalled: false,
        anyVipInstalled: true,
        trackStatus: 'GOOD',
      }),
    ]);
    expect(steps.find((s) => s.key === 'vip')?.status).toBe('fail');
  });

  it('passes role + track + vip when one MASTER has VIP set and both tracks GOOD', () => {
    const members = [
      member('primary', {
        state: 'MASTER',
        virtualIps: ['12.1.1.254/24'],
        vipInstalled: true,
        trackStatus: 'GOOD',
      }),
      member('backup', {
        state: 'BACKUP',
        virtualIps: ['12.1.1.254/24'],
        vipInstalled: false,
        trackStatus: 'GOOD',
      }),
    ];
    const steps = evaluateHaLiveSteps(members);
    expect(steps.map((s) => s.status)).toEqual(['pass', 'pass', 'pass']);
  });

  it('accepts failover: intent backup is live MASTER', () => {
    const steps = evaluateHaLiveSteps([
      member('primary', { state: 'BACKUP', trackStatus: 'GOOD', vipInstalled: false }),
      member('backup', {
        state: 'MASTER',
        virtualIps: ['12.1.1.254/24'],
        vipInstalled: true,
        trackStatus: 'GOOD',
      }),
    ]);
    expect(steps.find((s) => s.key === 'role')?.status).toBe('pass');
    expect(steps.find((s) => s.key === 'vip')?.status).toBe('pass');
    expect(steps.find((s) => s.key === 'vip')?.message).toMatch(/意图备 CE4/);
  });

  it('fails split-brain two MASTER', () => {
    const steps = evaluateHaLiveSteps([
      member('primary', { state: 'MASTER', vipInstalled: true, virtualIps: ['12.1.1.254/24'], trackStatus: 'GOOD' }),
      member('backup', { state: 'MASTER', vipInstalled: true, virtualIps: ['12.1.1.254/24'], trackStatus: 'GOOD' }),
    ]);
    expect(steps.find((s) => s.key === 'role')?.status).toBe('fail');
    expect(steps.find((s) => s.key === 'vip')?.status).toBe('fail');
  });

  it('fails track FAULT and missing VIP on MASTER', () => {
    const steps = evaluateHaLiveSteps([
      member('primary', { state: 'MASTER', vipInstalled: false, virtualIps: ['12.1.1.254/24'], trackStatus: 'FAULT' }),
      member('backup', { state: 'BACKUP', vipInstalled: false, trackStatus: 'GOOD' }),
    ]);
    expect(steps.find((s) => s.key === 'track')?.status).toBe('fail');
    expect(steps.find((s) => s.key === 'vip')?.status).toBe('fail');
  });

  it('skips track when neither member reports script Status', () => {
    const steps = evaluateHaLiveSteps([
      member('primary', { state: 'MASTER', vipInstalled: true, virtualIps: ['12.1.1.254/24'] }),
      member('backup', { state: 'BACKUP', vipInstalled: false }),
    ]);
    expect(steps.find((s) => s.key === 'track')?.status).toBe('skip');
  });

  it('marks device without show vrrp as unreachable', () => {
    const snap = snapshotFromVrrpPayload({
      role: 'backup',
      vrUuid: 'vr-b',
      name: 'CE4',
      data: { raw: 'vrrp 1\ntrack gateway 1.1.1.1' },
      vrids,
      groupIds,
    });
    expect(snap.reachable).toBe(false);
    expect(snap.error).toMatch(/do show vrrp/);
  });

  it('still parses when payload carries a soft error plus live show', () => {
    const snap = snapshotFromVrrpPayload({
      role: 'backup',
      vrUuid: 'vr-b',
      name: 'CE4',
      data: { error: 'clish warn', instancesRaw: INSTANCES_BACKUP, groupsRaw: GROUPS_FAULT },
      error: 'clish warn',
      vrids,
      groupIds,
    });
    expect(snap.reachable).toBe(true);
    expect(snap.state).toBe('BACKUP');
    expect(snap.vipInstalled).toBe(false);
    expect(snap.trackStatus).toBe('FAULT');
  });
});
