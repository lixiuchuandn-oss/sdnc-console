import React, { useEffect, useMemo, useState } from 'react';
import { Button, Form, Input, Space, message, Divider, Collapse, Switch, Steps, Card, Row, Col } from 'antd';
import { SaveOutlined, SendOutlined, ArrowLeftOutlined, CopyOutlined, SettingOutlined } from '@ant-design/icons';
import { useNavigate, useParams } from 'react-router-dom';
import PageContainer from '../../../components/PageContainer';
 
import { getVRConfig, saveVRConfig } from '../../../services/vrConfigApi';
import { vrApi } from '../../../services/vrApi';
import LinedTextArea from '../../../components/LinedTextArea';

const EditVRConfig: React.FC = () => {
  const navigate = useNavigate();
  const { uuid } = useParams();
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [cleanedResponseText, setCleanedResponseText] = useState('');
  const [currentStep, setCurrentStep] = useState(0);

  const stepTitle = useMemo(() => {
    if (currentStep === 0) return '查询现有配置';
    if (currentStep === 1) return 'VR 配置模板';
    return '合并预览与下发';
  }, [currentStep]);

  // PRD: 按配置点拆分的模板文本框（每个键一个文本框，内容为该键对应的JSON片段）
  type SectionKey =
    | 'role'
    | 'ce'
    | 'pe'
    | 'ipsec_preset'
    | 'vrf'
    | 'acl'
    | 'ipsec'
    | 'nat_address_group'
    | 'interfaces_BondEthernet'
    | 'subinterfaces_BondEthernet'
    | 'interfaces_TapEthernet'
    | 'subinterfaces_TapEthernet'
    | 'interfaces_memif'
    | 'subinterfaces_memif'
    | 'interfaces_GigabitEthernet'
    | 'subinterfaces_GigabitEthernet'
    | 'interfaces_lo'
    | 'interfaces_Tunnel'
    | 'subinterfaces_Tunnel'
    | 'ipv4_route'
    | 'ipv6_route'
    | 'segment_routing_srv6'
    | 'bgp'
    | 'vrrp';

  const SECTION_DEFS: { key: SectionKey; label: string }[] = [
    { key: 'role', label: 'role' },
    { key: 'ce', label: 'ce' },
    { key: 'pe', label: 'pe' },
    { key: 'ipsec_preset', label: 'ipsec_preset' },
    { key: 'vrf', label: 'vrf' },
    { key: 'acl', label: 'acl' },
    { key: 'ipsec', label: 'ipsec' },
    { key: 'nat_address_group', label: 'nat_address_group' },
    { key: 'interfaces_BondEthernet', label: 'interfaces_BondEthernet' },
    { key: 'subinterfaces_BondEthernet', label: 'subinterfaces_BondEthernet' },
    { key: 'interfaces_TapEthernet', label: 'interfaces_TapEthernet' },
    { key: 'subinterfaces_TapEthernet', label: 'subinterfaces_TapEthernet' },
    { key: 'interfaces_memif', label: 'interfaces_memif' },
    { key: 'subinterfaces_memif', label: 'subinterfaces_memif' },
    { key: 'interfaces_GigabitEthernet', label: 'interfaces_GigabitEthernet' },
    { key: 'subinterfaces_GigabitEthernet', label: 'subinterfaces_GigabitEthernet' },
    { key: 'interfaces_lo', label: 'interfaces_lo' },
    { key: 'interfaces_Tunnel', label: 'interfaces_Tunnel' },
    { key: 'subinterfaces_Tunnel', label: 'subinterfaces_Tunnel' },
    { key: 'ipv4_route', label: 'ipv4_route' },
    { key: 'ipv6_route', label: 'ipv6_route' },
    { key: 'segment_routing_srv6', label: 'segment_routing_srv6' },
    { key: 'bgp', label: 'bgp' },
    { key: 'vrrp', label: 'vrrp' },
  ];

  // 每个标识符的作用说明（副标题）
  const SECTION_DESC: Record<SectionKey, string> = {
    role: 'VR 角色标识 (CE/PE)',
    ce: 'CE 模式向导元数据',
    pe: 'PE 模式向导元数据',
    ipsec_preset: '标准模式向导元数据',
    vrf: 'VRF 实例定义与路由隔离',
    acl: '访问控制列表规则、匹配条件与方向',
    ipsec: 'IPsec/IKE 隧道与安全关联配置',
    nat_address_group: 'NAT 地址组与端口映射规则',
    interfaces_BondEthernet: '聚合以太网接口参数（VRF/MTU/IP/ACL等）',
    subinterfaces_BondEthernet: '聚合以太网子接口（VLAN 等）参数',
    interfaces_TapEthernet: 'Tap 虚拟接口参数（VRF/MTU/IP/ACL等）',
    subinterfaces_TapEthernet: 'Tap 子接口（VLAN 等）参数',
    interfaces_memif: 'memif 接口参数（VRF/MTU/IP/ACL等）',
    subinterfaces_memif: 'memif 子接口（VLAN 等）参数',
    interfaces_GigabitEthernet: '千兆以太网接口参数（VRF/MTU/IP/ACL等）',
    subinterfaces_GigabitEthernet: '千兆以太网子接口（VLAN 等）参数',
    interfaces_lo: '环回接口参数（地址、VRF 等）',
    interfaces_Tunnel: '隧道接口参数（VRF/IP/ACL 等）',
    subinterfaces_Tunnel: '隧道子接口（VLAN 等）参数',
    ipv4_route: 'IPv4 静态路由与下一跳',
    ipv6_route: 'IPv6 静态路由与下一跳',
    segment_routing_srv6: 'SRv6 定位器与 SID 前缀',
    bgp: 'BGP 邻居、地址族与策略',
    vrrp: 'VRRP 虚拟网关与优先级',
  };

  // 仅包含标识符和结构，不包含具体值的默认模板
  const DEFAULT_TEMPLATE: Record<SectionKey, any> = {
    role: 'CE',
    ce: {},
    pe: {},
    ipsec_preset: {},
    vrf: [0],
    acl: [
      {
        acl_id: 0,
        rule: [
          {
            rule_id: 0,
            match: '',
            proto: '',
            source: '',
            sport: '',
            destination: '',
            dport: '',
          },
        ],
      },
    ],
    ipsec: [
      {
        ID: '',
        ike_local_ip: '',
        ike_remote_ip: '',
        ike_dpd_delay: 0,
        ike_dpd_timeout: 0,
        ike_mode: '',
        ike_proposal_local: '',
        ike_proposal_remote: {
          remote_id: '',
          pre_shared_key: '',
          pubkey: '',
        },
        traffic_selectors_local: '',
        traffic_selectors_remote: '',
        vrf_id: '',
        sa_dpd_action: '',
        sa_esp_proposals: '',
      },
    ],
    nat_address_group: [
      {
        group_id: 0,
        range: [''],
        static_mapping: [
          {
            proto: '',
            inside: '',
            local_port: 0,
            vrf: '',
            outside: '',
            external_port: 0,
            twice_nat: '',
          },
        ],
      },
    ],
    interfaces_BondEthernet: [
      {
        name: '',
        acl: [
          { acl_id: 0, direction: '' },
          { acl_id: 0, direction: '' },
        ],
        vrf: 0,
        mtu: 0,
        ipv4_dhcp: '',
        ipv4_static: '',
        ipv6_static: '',
        vrrp: [
          {
            vrid: 0,
            advert_interval: 0,
            auth_pass: '',
            priority: 0,
            virtual_ipaddress: [''],
          },
        ],
        pppoe_user_name: '',
        pppoe_passwd: '',
        pppoe_client: '',
        nat: { type: '', acl_id: 0, address_group: '', 'track-vrrp': '' },
        status: '',
      },
    ],
    subinterfaces_BondEthernet: [
      {
        name: '',
        vlan: 0,
        acl: [
          { acl_id: 0, direction: '' },
          { acl_id: 0, direction: '' },
        ],
        vrf: 0,
        mtu: 0,
        ipv4_dhcp: '',
        ipv4_static: '',
        ipv6_static: '',
        vrrp: [
          {
            vrid: 0,
            advert_interval: 0,
            auth_pass: '',
            priority: 0,
            virtual_ipaddress: [''],
          },
        ],
        pppoe_user_name: '',
        pppoe_passwd: '',
        pppoe_client: '',
        nat: { type: '', acl_id: 0, address_group: '', 'track-vrrp': '' },
        status: '',
      },
    ],
    interfaces_TapEthernet: [
      {
        name: '',
        acl: [
          { acl_id: 0, direction: '' },
          { acl_id: 0, direction: '' },
        ],
        vrf: 0,
        bond: '',
        mtu: 0,
        ipv4_dhcp: '',
        ipv4_static: '',
        ipv6_static: '',
        vrrp: [
          {
            vrid: 0,
            advert_interval: 0,
            auth_pass: '',
            priority: 0,
            virtual_ipaddress: [''],
          },
        ],
        pppoe_user_name: '',
        pppoe_passwd: '',
        pppoe_client: '',
        nat: { type: '', acl_id: 0, address_group: '', 'track-vrrp': '' },
        status: '',
      },
    ],
    subinterfaces_TapEthernet: [
      {
        name: '',
        vlan: 0,
        acl: [
          { acl_id: 0, direction: '' },
          { acl_id: 0, direction: '' },
        ],
        vrf: 0,
        mtu: 0,
        ipv4_dhcp: '',
        ipv4_static: '',
        ipv6_static: '',
        vrrp: [
          {
            vrid: 0,
            advert_interval: 0,
            auth_pass: '',
            priority: 0,
            virtual_ipaddress: [''],
          },
        ],
        pppoe_user_name: '',
        pppoe_passwd: '',
        pppoe_client: '',
        nat: { type: '', acl_id: 0, address_group: '', 'track-vrrp': '' },
        status: '',
      },
    ],
    interfaces_memif: [
      {
        name: '',
        acl: [
          { acl_id: 0, direction: '' },
          { acl_id: 0, direction: '' },
        ],
        vrf: 0,
        bond: '',
        mtu: 0,
        ipv4_dhcp: '',
        ipv4_static: '',
        ipv6_static: '',
        vrrp: [
          {
            vrid: 0,
            advert_interval: 0,
            auth_pass: '',
            priority: 0,
            virtual_ipaddress: [''],
          },
        ],
        pppoe_user_name: '',
        pppoe_passwd: '',
        pppoe_client: '',
        nat: { type: '', acl_id: 0, address_group: '', 'track-vrrp': '' },
        status: '',
      },
    ],
    subinterfaces_memif: [
      {
        name: '',
        vlan: 0,
        acl: [
          { acl_id: 0, direction: '' },
          { acl_id: 0, direction: '' },
        ],
        vrf: 0,
        mtu: 0,
        ipv4_dhcp: '',
        ipv4_static: '',
        ipv6_static: '',
        vrrp: [
          {
            vrid: 0,
            advert_interval: 0,
            auth_pass: '',
            priority: 0,
            virtual_ipaddress: [''],
          },
        ],
        pppoe_user_name: '',
        pppoe_passwd: '',
        pppoe_client: '',
        nat: { type: '', acl_id: 0, address_group: '', 'track-vrrp': '' },
        status: '',
      },
    ],
    interfaces_GigabitEthernet: [
      {
        name: '',
        acl: [
          { acl_id: 0, direction: '' },
          { acl_id: 0, direction: '' },
        ],
        vrf: 0,
        bond: '',
        mtu: 0,
        ipv4_dhcp: '',
        ipv4_static: '',
        ipv6_static: '',
        vrrp: [
          {
            vrid: 0,
            advert_interval: 0,
            auth_pass: '',
            priority: 0,
            virtual_ipaddress: [''],
          },
        ],
        pppoe_user_name: '',
        pppoe_passwd: '',
        pppoe_client: '',
        nat: { type: '', acl_id: 0, address_group: '', 'track-vrrp': '' },
        status: '',
      },
    ],
    subinterfaces_GigabitEthernet: [
      {
        name: '',
        vlan: 0,
        acl: [
          { acl_id: 0, direction: '' },
          { acl_id: 0, direction: '' },
        ],
        vrf: 0,
        mtu: 0,
        ipv4_dhcp: '',
        ipv4_static: '',
        ipv6_static: '',
        vrrp: [
          {
            vrid: 0,
            advert_interval: 0,
            auth_pass: '',
            priority: 0,
            virtual_ipaddress: [''],
          },
        ],
        pppoe_user_name: '',
        pppoe_passwd: '',
        pppoe_client: '',
        nat: { type: '', acl_id: 0, address_group: '', 'track-vrrp': '' },
        status: '',
      },
    ],
    interfaces_lo: [
      {
        name: '',
        acl: [
          { acl_id: 0, direction: '' },
          { acl_id: 0, direction: '' },
        ],
        vrf: 0,
        bond: '',
        mtu: 0,
        ipv4_dhcp: '',
        ipv4_static: '',
        ipv6_static: '',
        vrrp: [
          {
            vrid: 0,
            advert_interval: 0,
            auth_pass: '',
            priority: 0,
            virtual_ipaddress: [''],
          },
        ],
        pppoe_user_name: '',
        pppoe_passwd: '',
        pppoe_client: '',
        nat: { type: '', acl_id: 0, address_group: '', 'track-vrrp': '' },
        status: '',
      },
    ],
    interfaces_Tunnel: [
      {
        name: '',
        acl: [
          { acl_id: 0, direction: '' },
          { acl_id: 0, direction: '' },
        ],
        vrf: 0,
        bond: '',
        mtu: 0,
        ipv4_dhcp: '',
        ipv4_static: '',
        ipv6_static: '',
        vrrp: [
          {
            vrid: 0,
            advert_interval: 0,
            auth_pass: '',
            priority: 0,
            virtual_ipaddress: [''],
          },
        ],
        pppoe_user_name: '',
        pppoe_passwd: '',
        pppoe_client: '',
        nat: { type: '', acl_id: 0, address_group: '', 'track-vrrp': '' },
        status: '',
      },
    ],
    subinterfaces_Tunnel: [
      {
        name: '',
        vlan: 0,
        acl: [
          { acl_id: 0, direction: '' },
          { acl_id: 0, direction: '' },
        ],
        vrf: 0,
        mtu: 0,
        ipv4_dhcp: '',
        ipv4_static: '',
        ipv6_static: '',
        vrrp: [
          {
            vrid: 0,
            advert_interval: 0,
            auth_pass: '',
            priority: 0,
            virtual_ipaddress: [''],
          },
        ],
        pppoe_user_name: '',
        pppoe_passwd: '',
        pppoe_client: '',
        nat: { type: '', acl_id: 0, address_group: '', 'track-vrrp': '' },
        status: '',
      },
    ],
    ipv4_route: [
      { vrf: 0, destination: '', blackhole: '', via: '', priority: '' },
    ],
    ipv6_route: [
      { vrf: 0, destination: '', blackhole: '', via: '', priority: '' },
    ],
    segment_routing_srv6: { locator: '', prefix: '' },
    bgp: [
      {
        asn: 0,
        vrf: 0,
        bgp_router_id: '',
        bgp_ebgp_requires_policy: '',
        neighbor: [{ remote_ip: '', remote_as: 0 }],
        address_family: [
          {
            address_family: '',
            modifier: '',
            activate_address_family: [''],
            export_route: '',
            import_route: '',
            route_distinguisher: '',
            route_target: '',
            network: [''],
            auto_assign_sid: '',
          },
        ],
        segment_routing_srv6: { locator: '' },
      },
    ],
    vrrp: [
      {
        group_id: 0,
        track_gateway: [''],
        vrrp_instance: [0],
      },
    ],
  };

  const [sections, setSections] = useState<Record<SectionKey, string>>(() => {
    const initial: Record<SectionKey, string> = {} as any;
    (Object.keys(DEFAULT_TEMPLATE) as SectionKey[]).forEach((k) => {
      initial[k] = JSON.stringify(DEFAULT_TEMPLATE[k], null, 2);
    });
    return initial;
  });

  const [enabledSections, setEnabledSections] = useState<Record<SectionKey, boolean>>(() => {
    const initial: Record<SectionKey, boolean> = {} as any;
    (Object.keys(DEFAULT_TEMPLATE) as SectionKey[]).forEach((k) => {
      initial[k] = true; // 默认全部启用
    });
    return initial;
  });

  const setSectionText = (key: SectionKey, val: string) => {
    setSections((prev) => ({ ...prev, [key]: val }));
  };

  const parseSection = (key: SectionKey): any | null => {
    try {
      const text = sections[key] ?? '';
      if (!text) return undefined;
      return JSON.parse(text);
    } catch (e: any) {
      message.error(`${key} 片段不是有效的 JSON`);
      return null;
    }
  };

  const mergedConfig = useMemo(() => {
    const out: any = {};
    (SECTION_DEFS.map((d) => d.key) as SectionKey[]).forEach((key) => {
      if (!enabledSections[key]) return; // 未启用则不参与合并
      try {
        const v = sections[key];
        if (v && v.trim().length > 0) {
          out[key] = JSON.parse(v);
        }
      } catch {
        // 有错误时，合并预览保持已解析部分，错误在保存时提示
      }
    });
    if (uuid) out.uuid = uuid;
    return out;
  }, [sections, enabledSections, uuid]);

  // 折叠分组定义
  const GROUPS: { title: string; keys: SectionKey[] }[] = [
    { title: '元数据与角色', keys: ['role', 'ce', 'pe', 'ipsec_preset'] },
    { title: '基础配置', keys: ['vrf', 'segment_routing_srv6'] },
    { title: '安全与NAT', keys: ['acl', 'ipsec', 'nat_address_group'] },
    {
      title: '接口与子接口',
      keys: [
        'interfaces_BondEthernet',
        'subinterfaces_BondEthernet',
        'interfaces_TapEthernet',
        'subinterfaces_TapEthernet',
        'interfaces_memif',
        'subinterfaces_memif',
        'interfaces_GigabitEthernet',
        'subinterfaces_GigabitEthernet',
        'interfaces_lo',
        'interfaces_Tunnel',
        'subinterfaces_Tunnel',
      ],
    },
    { title: '路由配置', keys: ['ipv4_route', 'ipv6_route'] },
    { title: 'BGP/SRv6', keys: ['bgp'] },
    { title: '高可用', keys: ['vrrp'] },
  ];

  const [activePanels, setActivePanels] = useState<string[]>(GROUPS.map((g) => g.title));
  const expandAll = () => setActivePanels(GROUPS.map((g) => g.title));
  const collapseAll = () => setActivePanels([]);

  // 复制工具
  const copyText = async (text: string, tip: string) => {
    try {
      await navigator.clipboard.writeText(text);
      message.success(`${tip} 已复制`);
    } catch (e: any) {
      message.error(`复制失败: ${e?.message || '未知错误'}`);
    }
  };

  useEffect(() => {
    const init = async () => {
      if (!uuid) {
        message.error('缺少UUID参数');
        return;
      }
      try {
        // 优先加载平台已保存的配置；如果没有则初始化为模板结构
        const existing = await getVRConfig(uuid);
        if (existing && typeof existing === 'object') {
          const next: Record<SectionKey, string> = { ...sections } as any;
          const nextEnabled: Record<SectionKey, boolean> = { ...enabledSections } as any;
          (Object.keys(DEFAULT_TEMPLATE) as SectionKey[]).forEach((k) => {
            const hasValue = typeof (existing as any)[k] !== 'undefined';
            const value = hasValue ? (existing as any)[k] : DEFAULT_TEMPLATE[k];
            next[k] = JSON.stringify(value, null, 2);
            // 根据已保存的配置中是否存在该标识符，恢复启用/停用状态
            nextEnabled[k] = !!hasValue;
          });
          setSections(next);
          setEnabledSections(nextEnabled);
        }
      } catch (err: any) {
        message.error(`加载配置失败: ${err.message}`);
      }

      // 进入页面后默认执行一次设备“查询现有配置”，以填充过滤后的VR配置JSON
      try {
        await handleQueryExisting();
      } catch {
        // 查询失败时保持页面可用，用户可手动重试
      }
    };
    init();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uuid]);

  const buildMergedJson = (): any | null => {
    const obj: any = {};
    for (const def of SECTION_DEFS) {
      if (!enabledSections[def.key]) continue; // 未启用则跳过
      const part = parseSection(def.key);
      if (part === null) return null; // 有错误直接中断
      if (typeof part !== 'undefined') obj[def.key] = part;
    }
    if (uuid) obj.uuid = uuid;
    return obj;
  };

  const handleSave = async () => {
    if (!uuid) return;
    const obj = buildMergedJson();
    if (!obj) return;
    setLoading(true);
    try {
      await saveVRConfig(uuid, obj);
      message.success('配置已保存到平台');
    } catch (err: any) {
      message.error(`保存失败: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleSaveAndDispatch = async () => {
    if (!uuid) return;
    const obj = buildMergedJson();
    if (!obj) return;
    setLoading(true);
    try {
      // 改为复用 AuthDirect 的直接认证与请求方式进行下发
      const accesskey = 'Cloudmap%23123';
      const secretkey = 'Cloudmap%23123';
      const path = '/V2/ctcontrol/VR2/VRConfig';
      const method = 'POST';
      // POST 的签名 other 为空；签名服务以 body 原文参与计算
      const other = '';

      const authUrl = `/api-proxy/api/sign?` +
        `url=${encodeURIComponent(path)}&` +
        `method=${method}&` +
        `other=${encodeURIComponent(other)}&` +
        `accessKey=${accesskey}&` +
        `secretKey=${secretkey}`;

      const signResp = await fetch(authUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // 保证签名体与实际下发体一致（包含 uuid）
        body: JSON.stringify({ uuid, ...obj })
      });
      const signJson = await signResp.json();
      const info = (signJson && signJson.data) ? signJson.data : signJson;
      if (!info || !info.Authorization || !info.tonce) {
        throw new Error('认证响应数据缺少 Authorization 或 tonce');
      }

      const postUrl = `/api-proxy${path}`;
      const resp = await fetch(postUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': info.Authorization,
          // 仅使用小写 tonce 与 Postman 一致，避免重复头导致后端解析异常
          'tonce': String(info.tonce)
        },
        // 按模板合并后的 JSON 进行下发
        body: JSON.stringify({ uuid, ...obj })
      });

      const data = await resp.json().catch(async () => ({ raw: await resp.text() }));
      if (resp.ok) {
        message.success(data?.msg || '配置已下发');
      } else {
        throw new Error(data?.msg || `设备返回错误: ${resp.status}`);
      }
    } catch (err: any) {
      message.error(`下发失败: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleQueryExisting = async () => {
    if (!uuid) return;
    setLoading(true);
    try {
      // 直接复用 AuthDirect 的认证与请求方式
      const accesskey = 'Cloudmap%23123';
      const secretkey = 'Cloudmap%23123';
      const path = '/V2/ctcontrol/VR2/VRConfig';
      const method = 'GET';
      const other = `uuid=${uuid}`;

      const authUrl = `/api-proxy/api/sign?` +
        `url=${encodeURIComponent(path)}&` +
        `method=${method}&` +
        `other=${encodeURIComponent(other)}&` +
        `accessKey=${accesskey}&` +
        `secretKey=${secretkey}`;

      const signResp = await fetch(authUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: ''
      });
      const signJson = await signResp.json();
      const info = (signJson && signJson.data) ? signJson.data : signJson;
      if (!info || !info.Authorization || !info.tonce) {
        throw new Error('认证响应数据缺少 Authorization 或 tonce');
      }

      const queryUrl = `/api-proxy${path}?${other}`;
      const resp = await fetch(queryUrl, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': info.Authorization,
          'tonce': String(info.tonce)
        }
      });
      const raw = await resp.json().catch(async () => ({ raw: await resp.text() }));
      // 将原始接口返回显示到查询页签的只读框中
      if (!raw) {
        message.info('未查询到远端配置');
        return;
      }
      // 递归剥离多层 data 包裹
      const unwrapData = (obj: any) => {
        let cur = obj;
        while (cur && typeof cur === 'object' && 'data' in cur) {
          cur = (cur as any).data;
        }
        return cur;
      };
      // 去除响应中的元数据，仅保留配置主体
      const stripMeta = (obj: any) => {
        if (!obj || typeof obj !== 'object') return obj;
        const { msg, code, report_config_status, updateDate, createDate, _id, requestId, ...rest } = obj as any;
        return rest;
      };
      
      // 辅助：对 CE 元数据进行特定排序，对整体键进行排序
      const sortJsonKeys = (obj: any): any => {
        if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return obj;
        
        // 如果包含 ce 对象，先对其内部进行排序
        const copy = { ...obj };
        if (copy.ce && typeof copy.ce === 'object') {
          const ceOrder = ['wanName', 'wanIpv4', 'wanIpv6', 'bgpAsn', 'bgpRouterId', 'lanName', 'lanIpv4', 'lanIpv6'];
          const newCe: any = {};
          // 先按顺序放入已知字段
          ceOrder.forEach(k => {
            if (k in copy.ce) newCe[k] = copy.ce[k];
          });
          // 放入剩余字段
          Object.keys(copy.ce).forEach(k => {
            if (!ceOrder.includes(k)) newCe[k] = copy.ce[k];
          });
          copy.ce = newCe;
        }

        // 如果包含 pe 对象，先对其内部进行排序
        if (copy.pe && typeof copy.pe === 'object') {
          const peOrder = [
            'locatorName', 'sidPrefix', 
            'wanName', 'wanIpv4', 'wanIpv6', 'wanRouteDest', 'wanRoutePriority', 
            'ipv6Dest', 'ipv6Via', 
            'lanConfigs'
          ];
          const newPe: any = {};
          peOrder.forEach(k => {
            if (k in copy.pe) newPe[k] = copy.pe[k];
          });
          Object.keys(copy.pe).forEach(k => {
            if (!peOrder.includes(k)) newPe[k] = copy.pe[k];
          });
          copy.pe = newPe;
        }

        // 对最外层进行排序：role, ce, pe, uuid 放最后，interfaces_ 放中间
        const keys = Object.keys(copy).sort((a, b) => {
           // role, ce, pe 优先
           const prio = (k: string) => {
              if (k === 'uuid') return -1;
              if (k === 'role') return 0;
              if (k === 'ce') return 1;
              if (k === 'pe') return 2;
              if (k === 'ipsec_preset') return 3;
              if (k.startsWith('interfaces_')) return 10;
             if (k.startsWith('subinterfaces_')) return 11;
             if (k === 'bgp') return 20;
             return 50;
           };
           const pa = prio(a);
           const pb = prio(b);
           if (pa !== pb) return pa - pb;
           return a.localeCompare(b);
        });
        
        const sorted: any = {};
        keys.forEach(k => sorted[k] = copy[k]);
        return sorted;
      };

      const unwrapped = unwrapData(raw);
      const cleaned = stripMeta(unwrapped);

      // 标准化：把查询返回的统一 interfaces 数组拆分到模板使用的各个接口键
      const expanded = (() => {
        const e: any = { ...(cleaned ?? {}) };
        const ifaces: any[] = Array.isArray(e.interfaces) ? e.interfaces : [];
        if (ifaces.length > 0) {
          const buckets: Record<SectionKey, any[]> = {
            vrf: [],
            acl: [],
            ipsec: [],
            nat_address_group: [],
            interfaces_BondEthernet: [],
            subinterfaces_BondEthernet: [],
            interfaces_TapEthernet: [],
            subinterfaces_TapEthernet: [],
            interfaces_memif: [],
            subinterfaces_memif: [],
            interfaces_GigabitEthernet: [],
            subinterfaces_GigabitEthernet: [],
            interfaces_lo: [],
            interfaces_Tunnel: [],
            subinterfaces_Tunnel: [],
            ipv4_route: [],
            ipv6_route: [],
            segment_routing_srv6: [],
            bgp: [],
            vrrp: [],
          } as any;

          ifaces.forEach((item: any) => {
            const name = String(item?.name || '');
            const typePart = name.split(' ')[0];
            const isSub = name.includes('.');
            const push = (key: SectionKey) => {
              (buckets as any)[key].push(item);
            };
            switch (typePart) {
              case 'BondEthernet':
                push(isSub ? 'subinterfaces_BondEthernet' : 'interfaces_BondEthernet');
                break;
              case 'TapEthernet':
                push(isSub ? 'subinterfaces_TapEthernet' : 'interfaces_TapEthernet');
                break;
              case 'memif':
                push(isSub ? 'subinterfaces_memif' : 'interfaces_memif');
                break;
              case 'GigabitEthernet':
                push(isSub ? 'subinterfaces_GigabitEthernet' : 'interfaces_GigabitEthernet');
                break;
              case 'lo':
                push('interfaces_lo');
                break;
              case 'Tunnel':
                push(isSub ? 'subinterfaces_Tunnel' : 'interfaces_Tunnel');
                break;
              default:
                // 未识别类型，暂不分发；保留在原始 interfaces 中
                break;
            }
          });

          // 写回各桶并移除统一的 interfaces 键
          Object.keys(buckets).forEach((k) => {
            const key = k as SectionKey;
            if ((buckets as any)[key] && (buckets as any)[key].length > 0) {
              e[key] = (buckets as any)[key];
            }
          });
          delete e.interfaces;
        }

        // 路由标准化：若存在统一 routes，则拆分到 ipv4_route / ipv6_route
        const routes: any[] = Array.isArray((e as any).routes) ? (e as any).routes : [];
        if (routes.length > 0) {
          const ipv4: any[] = [];
          const ipv6: any[] = [];
          routes.forEach((r) => {
            const dest = String(r?.destination || '');
            if (dest.includes(':')) ipv6.push(r); else ipv4.push(r);
          });
          if (ipv4.length > 0) e.ipv4_route = ipv4;
          if (ipv6.length > 0) e.ipv6_route = ipv6;
          delete e.routes;
        }
        return e;
      })();

      // 展示标准化后的 JSON，便于与模板一一对应
      const sortedExpanded = sortJsonKeys(expanded ?? {});
      setCleanedResponseText(JSON.stringify(sortedExpanded, null, 2));

      // 将远端配置（已标准化）分发到各个模板片段
      const next: Record<SectionKey, string> = { ...sections } as any;
      const nextEnabled: Record<SectionKey, boolean> = { ...enabledSections } as any;
      (Object.keys(DEFAULT_TEMPLATE) as SectionKey[]).forEach((k) => {
        const hasValue = typeof (expanded as any)?.[k] !== 'undefined';
        const value = hasValue ? (expanded as any)[k] : DEFAULT_TEMPLATE[k];
        next[k] = JSON.stringify(value, null, 2);
        nextEnabled[k] = !!hasValue; // 远端有该配置则启用，否则禁用
      });
      setSections(next);
      setEnabledSections(nextEnabled);
      message.success('已加载远端配置');
    } catch (err: any) {
      message.error(`查询失败: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <PageContainer
      title={<span><SettingOutlined style={{ marginRight: 6, color: '#1677ff' }} />专家模式</span>}
      titleLevel={3}
      subtitle="用于分步查询、编辑与下发 VR 配置；支持标准化预览、模板分段编辑、启用/禁用配置点，以及保存到平台或直接下发"
      extra={
        <Space>
          <Button icon={<ArrowLeftOutlined />} onClick={() => navigate(-1)}>返回</Button>
        </Space>
      }
      asCard={false}
    >
      <Row gutter={16}>
        <Col span={5}>
          <Card
            size="small"
            title={<span style={{ fontSize: 13, color: '#000', fontWeight: 400 }}>步骤</span>}
            variant="outlined"
            style={{ position: 'sticky', top: 16 }}
          >
            <Steps
              direction="vertical"
              size="small"
              current={currentStep}
              onChange={(idx) => setCurrentStep(idx)}
              items={[
                { title: '查询现有配置' },
                { title: 'VR 配置模板' },
                { title: '合并预览与下发' },
              ]}
            />
          </Card>
        </Col>
        <Col span={19}>
          <Card
            size="small"
            title={<span style={{ fontSize: 13, color: '#000', fontWeight: 400 }}>{`第 ${currentStep + 1} 步：${stepTitle}`}</span>}
            variant="outlined"
          >
            <Form form={form} layout="vertical">
              <Form.Item label="VR UUID">
                <Input value={uuid} disabled />
              </Form.Item>

              {currentStep === 0 && (
                <>
                  <Divider />
                  <Space style={{ marginBottom: 12 }}>
                    <Button type="primary" onClick={handleQueryExisting} loading={loading}>查询现有配置</Button>
                    <Button type="default" icon={<CopyOutlined />} onClick={() => copyText(cleanedResponseText || '', '有效VR配置 JSON')}>复制有效配置</Button>
                  </Space>
                  <Form.Item label="过滤后的 VR 配置 JSON（只读）">
                    <LinedTextArea
                      value={cleanedResponseText}
                      readOnly
                      minRows={10}
                      maxRows={28}
                      placeholder="只显示有效的 VR 配置内容（已剥离 data 层与元数据）"
                    />
                  </Form.Item>
                </>
              )}

              {currentStep === 1 && (
                <>
                  <Divider />
                  <Space style={{ marginBottom: 12 }}>
                    <Button type="default" onClick={expandAll}>展开全部</Button>
                    <Button type="default" onClick={collapseAll}>折叠全部</Button>
                  </Space>
                  <Collapse
                    activeKey={activePanels}
                    onChange={(keys) => setActivePanels(Array.isArray(keys) ? (keys as string[]) : [String(keys)])}
                    items={GROUPS.map((group) => ({
                      key: group.title,
                      label: group.title,
                      children: (
                        <>
                          {group.keys.map((key) => (
                            <Form.Item
                              key={key}
                              className={!enabledSections[key] ? 'vr-form-item-compact' : undefined}
                              label={
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                    <span style={{ fontWeight: 600, fontSize: 14 }}>{key}</span>
                                    <span style={{ fontSize: 12, color: '#8c8c8c' }}>{SECTION_DESC[key]}</span>
                                  </div>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingLeft: 4 }}>
                                    <Switch
                                      size="small"
                                      checked={!!enabledSections[key]}
                                      onChange={(checked) => setEnabledSections((prev) => ({ ...prev, [key]: checked }))}
                                      checkedChildren="启用"
                                      unCheckedChildren="停用"
                                    />
                                    <Button
                                      size="small"
                                      type="default"
                                      icon={<CopyOutlined />}
                                      disabled={!enabledSections[key]}
                                      style={{ height: 22, lineHeight: '22px', padding: '0 10px' }}
                                      onClick={() => copyText(sections[key], `${key} JSON`)}
                                    >复制</Button>
                                  </div>
                                </div>
                              }
                            >
                              {enabledSections[key] && (
                                <LinedTextArea
                                  value={sections[key]}
                                  onChange={(val) => setSectionText(key, val)}
                                  minRows={6}
                                  maxRows={24}
                                  placeholder={`填写 ${key} 的 JSON 结构（只要标识符和结构，不要具体的值）`}
                                />
                              )}
                            </Form.Item>
                          ))}
                        </>
                      ),
                    }))}
                  />
                </>
              )}

              {currentStep === 2 && (
                <>
                  <Divider />
                  <Form.Item label={
                    <Space>
                      <span>合并后的配置 JSON（只读）</span>
                      <Button type="default" icon={<CopyOutlined />} onClick={() => copyText(JSON.stringify(mergedConfig, null, 2), '合并配置 JSON')}>复制</Button>
                    </Space>
                  }>
                    <LinedTextArea
                      value={JSON.stringify(mergedConfig, null, 2)}
                      readOnly
                      minRows={12}
                      maxRows={32}
                      placeholder="按模板片段合并后的总配置预览"
                    />
                  </Form.Item>
                </>
              )}

              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 16 }}>
                <Space>
                  <Button onClick={() => navigate('/admin/interconnect/vr')}>返回列表</Button>
                  {currentStep > 0 && (
                    <Button onClick={() => setCurrentStep((s) => Math.max(0, s - 1))}>上一步</Button>
                  )}
                </Space>
                <Space>
                  {currentStep < 2 && (
                    <Button type="primary" onClick={() => setCurrentStep((s) => Math.min(2, s + 1))}>下一步</Button>
                  )}
                  {currentStep === 2 && (
                    <>
                      <Button type="primary" icon={<SaveOutlined />} onClick={handleSave} loading={loading}>仅保存</Button>
                      <Button danger icon={<SendOutlined />} onClick={handleSaveAndDispatch} loading={loading}>保存并下发</Button>
                    </>
                  )}
                </Space>
              </div>
            </Form>
          </Card>
        </Col>
      </Row>
    </PageContainer>
  );
};

export default EditVRConfig;
