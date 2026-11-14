import { parseVrrpGroupsShow, parseVrrpInstancesShow } from './parseVrrpShow';

const INSTANCES_SAMPLE = `
VRRP Instance = 1
  Sync group = 1
  State = MASTER
  Using src_ip = 12.1.1.1
  Virtual Router ID = 1
  Priority = 200
  Preempt = enabled
  Virtual IP = 1
    12.1.1.254/24 dev GigabitEthernet0/8/0 scope global set
`;

const GROUPS_SAMPLE = `
VRRP Sync Group = 1, MASTER
  VRRP member instances = 1
    1
  Using smtp notification = no
  Tracked scripts = 1
    gateway_chk1-34113 weight -253
-------< VRRP Scripts >------
  VRRP Script = gateway_chk1-34113
  Command = '/usr/bin/ping' '-i' '0.2' '-c' '1' '34.1.1.3'
  Interval = 1 sec
  Timeout = 0 sec
  Weight = 0
  Rise = 1
  Fall = 3
  Insecure = no
  Status = GOOD
  Script uid:gid = 0:0
  VRRP instances = 1
    1, weight -253
    State = idle
`;

describe('parseVrrpShow', () => {
  it('parses instance MASTER + VIP installed', () => {
    const rows = parseVrrpInstancesShow(INSTANCES_SAMPLE);
    expect(rows).toHaveLength(1);
    expect(rows[0].vrid).toBe(1);
    expect(rows[0].state).toBe('MASTER');
    expect(rows[0].priority).toBe(200);
    expect(rows[0].virtualIps).toEqual(['12.1.1.254/24']);
    expect(rows[0].vipInstalled).toBe(true);
    expect(rows[0].interface).toMatch(/GigabitEthernet/);
  });

  it('parses sync group track Status = GOOD', () => {
    const rows = parseVrrpGroupsShow(GROUPS_SAMPLE);
    expect(rows).toHaveLength(1);
    expect(rows[0].groupId).toBe(1);
    expect(rows[0].state).toBe('MASTER');
    expect(rows[0].scriptStatus).toBe('GOOD');
    expect(rows[0].scriptName).toMatch(/gateway_chk/);
    expect(rows[0].memberInstances).toEqual([1]);
    expect(rows[0].trackGateway).toBe('34.1.1.3');
  });

  it('parses multiple member instances without treating count as vrid', () => {
    const rows = parseVrrpGroupsShow(`
VRRP Sync Group = 2, BACKUP
  VRRP member instances = 2
    1
    3
  Using smtp notification = no
  VRRP Script = gw2
  Command = '/usr/bin/ping' '-c' '1' '10.0.0.1'
  Status = GOOD
`);
    expect(rows[0].memberInstances).toEqual([1, 3]);
    expect(rows[0].trackGateway).toBe('10.0.0.1');
  });

  it('treats VIP without set as not installed', () => {
    const rows = parseVrrpInstancesShow(`
VRRP Instance = 1
  State = BACKUP
  Virtual Router ID = 1
  Virtual IP = 1
    12.1.1.254/24
`);
    expect(rows[0].state).toBe('BACKUP');
    expect(rows[0].vipInstalled).toBe(false);
    expect(rows[0].anyVipInstalled).toBe(false);
  });

  it('does not fall back vrid to keepalived instance number', () => {
    const rows = parseVrrpInstancesShow(`
VRRP Instance = 1
  State = MASTER
  Virtual Router ID = 10
    10.1.1.254/24 dev GigabitEthernet0/8/0 scope global set
`);
    expect(rows[0].instance).toBe(1);
    expect(rows[0].vrid).toBe(10);
  });

  it('keeps vrid null when Virtual Router ID line is missing', () => {
    const rows = parseVrrpInstancesShow(`
VRRP Instance = 1
  State = MASTER
    10.1.1.254/24 dev GigabitEthernet0/8/0 scope global set
`);
    expect(rows[0].instance).toBe(1);
    expect(rows[0].vrid).toBeNull();
  });

  it('requires every VIP line to be set before vipInstalled', () => {
    const rows = parseVrrpInstancesShow(`
VRRP Instance = 1
  State = MASTER
  Virtual Router ID = 1
  Virtual IP = 2
    12.1.1.254/24 dev GigabitEthernet0/8/0 scope global set
    12.1.1.253/24
`);
    expect(rows[0].virtualIps).toEqual(['12.1.1.254/24', '12.1.1.253/24']);
    expect(rows[0].vipInstalled).toBe(false);
    expect(rows[0].anyVipInstalled).toBe(true);
  });

  it('binds global VRRP Scripts to each group by tracked name', () => {
    const rows = parseVrrpGroupsShow(`
VRRP Sync Group = 1, MASTER
  VRRP member instances = 1
    1
  Tracked scripts = 1
    gw1 weight -253
VRRP Sync Group = 2, BACKUP
  VRRP member instances = 1
    2
  Tracked scripts = 1
    gw2 weight -253
-------< VRRP Scripts >------
  VRRP Script = gw1
  Command = '/usr/bin/ping' '-c' '1' '12.1.1.1'
  Status = GOOD
  VRRP Script = gw2
  Command = '/usr/bin/ping' '-c' '1' '12.1.1.2'
  Status = FAULT
`);
    expect(rows).toHaveLength(2);
    expect(rows[0].groupId).toBe(1);
    expect(rows[0].scriptStatus).toBe('GOOD');
    expect(rows[0].trackGateway).toBe('12.1.1.1');
    expect(rows[0].trackedScripts).toEqual(['gw1']);
    expect(rows[1].groupId).toBe(2);
    expect(rows[1].scriptStatus).toBe('FAULT');
    expect(rows[1].trackGateway).toBe('12.1.1.2');
  });

  it('fails a group when any tracked script is not GOOD', () => {
    const rows = parseVrrpGroupsShow(`
VRRP Sync Group = 1, MASTER
  Tracked scripts = 2
    gw1 weight -253
    gw2 weight -253
-------< VRRP Scripts >------
  VRRP Script = gw1
  Status = GOOD
  VRRP Script = gw2
  Status = FAULT
`);
    expect(rows[0].scriptStatus).toBe('FAULT');
    expect(rows[0].trackedScripts).toEqual(['gw1', 'gw2']);
  });
});
