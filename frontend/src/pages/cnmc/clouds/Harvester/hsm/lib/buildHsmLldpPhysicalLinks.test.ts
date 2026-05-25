import { buildHsmLldpPhysicalLinks } from './buildHsmLldpPhysicalLinks';

const HUAWEI_IF_STDOUT = [
  'Interface                         PHY   Protocol',
  'GE0/0/1                           up    up',
  'Vlanif100                         down  down',
].join('\n');

describe('buildHsmLldpPhysicalLinks', () => {
  const clusterNodes = [
    {
      metadata: { name: 'node-a' },
      hardware: {
        switch: [
          {
            Interface: 'eth0',
            'Management Address_IPv4': '192.168.1.10',
            'Port Description': 'GigabitEthernet0/0/1',
          },
        ],
      },
    },
  ];

  const switchItems = [
    {
      info: { host: '192.168.1.10', lines: [{ stdout: 'Hostname: core-sw-01\n' }] },
      interfaces: {
        lines: [{ stdout: HUAWEI_IF_STDOUT }],
      },
    },
  ];

  it('builds links for physical ports with LLDP hits', () => {
    const links = buildHsmLldpPhysicalLinks(clusterNodes, switchItems);
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({
      switchHost: '192.168.1.10',
      port: 'GE0/0/1',
      nodeName: 'node-a',
      localIf: 'eth0',
      switchPortStatus: 'up / up',
    });
    expect(links[0]?.switchTitle).toBe('core-sw-01');
  });

  it('skips logical interfaces and switches without management host', () => {
    expect(buildHsmLldpPhysicalLinks(clusterNodes, [{ info: {} }])).toEqual([]);
    expect(buildHsmLldpPhysicalLinks(clusterNodes, null)).toEqual([]);
  });
});
