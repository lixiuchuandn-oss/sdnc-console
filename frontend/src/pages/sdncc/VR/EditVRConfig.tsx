import React, { useEffect, useMemo, useState } from 'react';
import { Button, Form, Input, Space, message, Divider, Collapse, Switch, Card, Row, Col, Tag, Select } from 'antd';
import { SaveOutlined, SendOutlined, ArrowLeftOutlined, CopyOutlined, CloudServerOutlined, ClusterOutlined } from '@ant-design/icons';
import { useNavigate, useParams } from 'react-router-dom';
import PageContainer from '../../../components/PageContainer';

import { getVRConfig, saveVRConfig } from '../../../services/virtualRouterApi';
import LinedTextArea from '../../../components/LinedTextArea';

import { getVR2ConfigRaw } from '../../../services/virtualRouterApi';
import { proxyApiRequest } from '../../../services/api';

const EditVRConfig: React.FC = () => {
  const navigate = useNavigate();
  const { uuid } = useParams();
  const [form] = Form.useForm();
  const [loading, setLoading] = useState<boolean>(false);
  
  // Resource Binding State (Removed from UI, kept for compatibility if needed or removed entirely)
  const [csmctlConfig, setCsmctlConfig] = useState<any | null>(null);

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
            modifiler: '',
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
      initial[k] = '';
    });
    return initial;
  });

  const [enabledSections, setEnabledSections] = useState<Record<SectionKey, boolean>>(() => {
    const initial: Record<SectionKey, boolean> = {} as any;
    (Object.keys(DEFAULT_TEMPLATE) as SectionKey[]).forEach((k) => {
      initial[k] = false;
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

  const [activePanels, setActivePanels] = useState<string[]>([]);
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
        // const clouds = await fetchClouds();
        // setCloudList(clouds);

        // 优先加载平台已保存的配置；如果没有则保持默认空白与关闭状态
        const existing = await getVRConfig(uuid);
        if (existing && typeof existing === 'object') {
          const next: Record<SectionKey, string> = { ...sections } as any;
          const nextEnabled: Record<SectionKey, boolean> = { ...enabledSections } as any;
          (Object.keys(DEFAULT_TEMPLATE) as SectionKey[]).forEach((k) => {
            const hasValue = typeof (existing as any)[k] !== 'undefined';
            if (hasValue) {
              const value = (existing as any)[k];
              next[k] = JSON.stringify(value, null, 2);
              // 根据已保存的配置中是否存在该标识符，恢复启用/停用状态
              nextEnabled[k] = true;
            }
          });
          setSections(next);
          setEnabledSections(nextEnabled);

          // 加载元数据 (已移除 UI，暂不加载以减少请求)
          /*
          if (existing.cloudId) {
            setCloudId(existing.cloudId);
            setCloudName(existing.cloudName);
            fetchVpcList(existing.cloudId);
            fetchVmList(existing.cloudId);
          }
          if (existing.vmId) {
            setVmId(existing.vmId);
          }
          */

          // 自动展开有配置的分组
          const autoExpanded = GROUPS
            .filter((g) => g.keys.some((k) => nextEnabled[k]))
            .map((g) => g.title);
          setActivePanels(autoExpanded);
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
      await saveVRConfig(uuid, obj, {}); // 移除 cloudId/vmId 绑定
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
      // 先保存到平台
      await saveVRConfig(uuid, obj, {}); // 移除 cloudId/vmId 绑定

      // 改为复用 AuthDirect 的直接认证与请求方式进行下发
      const accesskey = 'Cloudmap#123';
      const secretkey = 'Cloudmap#123';
      const path = '/V2/ctcontrol/VR2/VRConfig';
      const method = 'POST';
      // POST 的签名 other 为空；签名服务以 body 原文参与计算
      const other = '';

      const data = await proxyApiRequest(path, method, other, { uuid, ...obj }, accesskey, secretkey);
      if (data && typeof data.code === 'number' && data.code !== 200) {
        throw new Error(data?.msg || `下发失败: ${JSON.stringify(data)}`);
      }
      message.success(data?.msg || '配置已下发');
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
      // 使用 getVR2ConfigRaw 获取包含 code/msg 的完整原始响应
      // 这样用户可以看到真实的后端返回，包括错误码
      const raw = await getVR2ConfigRaw(uuid);
      
      if (!raw) {
        message.info('未查询到远端配置');
        return;
      }

      // 检查业务错误码
      if (typeof raw.code === 'number' && raw.code !== 200 && raw.code !== 0) {
        message.error(`设备控制器返回错误: ${raw.msg || '未知错误'} (Code: ${raw.code})`);
      } else {
        message.success('已查询设备实时配置');
      }
 
      // 辅助：对 CE 元数据进行特定排序，对整体键进行排序
      const sortJsonKeys = (obj: any): any => {
        if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return obj;
        
        // 如果包含 ce 对象，先对其内部进行排序
        const copy = { ...obj };
        if (copy.ce && typeof copy.ce === 'object') {
          const newCe: any = {};
          const ceTopOrder = ['publicConfig', 'lanConfig'];
          ceTopOrder.forEach((k) => {
            if (k in copy.ce) newCe[k] = copy.ce[k];
          });
          if (newCe.publicConfig && typeof newCe.publicConfig === 'object') {
            const pc = newCe.publicConfig;
            const pcOrder = ['wanName', 'wanIpv4', 'wanIpv6', 'publicBgp'];
            const npc: any = {};
            pcOrder.forEach((k) => {
              if (k in pc) npc[k] = pc[k];
            });
            Object.keys(pc).forEach((k) => {
              if (!(k in npc)) npc[k] = pc[k];
            });
            if (npc.publicBgp && typeof npc.publicBgp === 'object') {
              const pb = npc.publicBgp;
              const pbOrder = ['asn', 'routerId'];
              const npb: any = {};
              pbOrder.forEach((k) => {
                if (k in pb) npb[k] = pb[k];
              });
              Object.keys(pb).forEach((k) => {
                if (!(k in npb)) npb[k] = pb[k];
              });
              npc.publicBgp = npb;
            }
            newCe.publicConfig = npc;
          }
          Object.keys(copy.ce).forEach((k) => {
            if (!(k in newCe)) newCe[k] = copy.ce[k];
          });
          copy.ce = newCe;
        }

        // 如果包含 pe 对象：新结构 publicConfig + lanConfig（camelCase）；旧 lanConfigs / 误写 LanConfig 仍保留在后续合并
        if (copy.pe && typeof copy.pe === 'object') {
          const newPe: any = {};
          const peTopOrder = ['publicConfig', 'lanConfig', 'lanConfigs'];
          peTopOrder.forEach((k) => {
            if (k in copy.pe) newPe[k] = copy.pe[k];
          });
          if (newPe.publicConfig && typeof newPe.publicConfig === 'object') {
            const pc = newPe.publicConfig;
            const pcOrder = [
              'publicBgpIndex', 'locatorName', 'sidPrefix', 'wanName', 'wanIpv4', 'wanIpv6',
              'wanRouteDest', 'wanRoutePriority', 'ipv6Dest', 'ipv6Via', 'publicBgp',
            ];
            const npc: any = {};
            pcOrder.forEach((k) => {
              if (k in pc) npc[k] = pc[k];
            });
            Object.keys(pc).forEach((k) => {
              if (!(k in npc)) npc[k] = pc[k];
            });
            newPe.publicConfig = npc;
          }
          Object.keys(copy.pe).forEach((k) => {
            if (!(k in newPe)) newPe[k] = copy.pe[k];
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

      // 直接展示完整原始数据（含 code/msg），仅做字段排序
      const sortedRaw = sortJsonKeys(raw);
      setCsmctlConfig(sortedRaw);

    } catch (err: any) {
      console.error(err);
      message.error(`查询失败: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <PageContainer
      titleLevel={3}
      extra={
        <Space>
          <Button icon={<ArrowLeftOutlined />} onClick={() => navigate(-1)}>返回</Button>
        </Space>
      }
      asCard={false}
    >
      <Row gutter={16}>
        <Col span={12}>
          <Card
            size="small"
            title={<span style={{ fontSize: 13, color: '#000', fontWeight: 400 }}>配置编辑 Configuration Editor (DB Cache)</span>}
            variant="outlined"
          >
            <Form form={form} layout="vertical">
              <div style={{ marginBottom: 16 }}>
                <span style={{ fontSize: 12, color: '#888' }}>VR UUID</span>
                <Input value={uuid} disabled style={{ marginTop: 4 }} />
              </div>

              {/* 资源关联已移除，专家模式专注于策略配置 */}
              
              <Collapse
                activeKey={activePanels}
                onChange={(keys) => setActivePanels(Array.isArray(keys) ? (keys as string[]) : [String(keys)])}
                items={GROUPS.map((group) => {
                  const hasConfig = group.keys.some((k) => enabledSections[k]);
                  return {
                    key: group.title,
                    label: (
                      <Space>
                        {group.title}
                        {hasConfig && <Tag color="success">有配置</Tag>}
                      </Space>
                    ),
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
                };
              })}
              />
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 16 }}>
                <Space>
                  <Button onClick={() => navigate('/admin/interconnect/vr')}>返回列表</Button>
                  <Button onClick={expandAll}>展开全部</Button>
                  <Button onClick={collapseAll}>折叠全部</Button>
                </Space>
                <Space>
                  <Button type="primary" icon={<SaveOutlined />} onClick={handleSave} loading={loading}>仅保存</Button>
                  <Button danger icon={<SendOutlined />} onClick={handleSaveAndDispatch} loading={loading}>保存并下发</Button>
                </Space>
              </div>
            </Form>
          </Card>
        </Col>
        <Col span={12}>
          <Card
            size="small"
            title={<span style={{ fontSize: 13, color: '#000', fontWeight: 400 }}>实时配置 csmctl configuration</span>}
            variant="outlined"
          >
            <div style={{ marginBottom: 16 }}>
              <span style={{ fontSize: 12, color: '#888' }}>VR UUID</span>
              <Input value={uuid} disabled style={{ marginTop: 4 }} />
            </div>
            <LinedTextArea
              value={csmctlConfig ? JSON.stringify(csmctlConfig, null, 2) : '点击下方按钮查询设备实时配置...'}
              readOnly
              minRows={18}
              maxRows={36}
              placeholder="设备实时配置（只读）"
            />
            <div style={{ display: 'flex', justifyContent: 'flex-start', gap: 8, marginTop: 16 }}>
              <Button onClick={handleQueryExisting} loading={loading}>查询现有配置</Button>
              <Button icon={<CopyOutlined />} onClick={() => copyText(csmctlConfig ? JSON.stringify(csmctlConfig, null, 2) : '', '实时配置 JSON')}>复制</Button>
            </div>
          </Card>
        </Col>
      </Row>
    </PageContainer>
  );
};

export default EditVRConfig;
