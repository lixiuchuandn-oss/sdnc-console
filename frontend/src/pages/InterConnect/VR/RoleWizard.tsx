import React, { useEffect, useMemo, useRef, useState, useTransition, useDeferredValue } from 'react';
import { Button, Card, Descriptions, Form, Input, InputNumber, Radio, Space, Steps, message, Row, Col, Switch, Select, Tabs } from 'antd';
import { ArrowLeftOutlined, UserOutlined } from '@ant-design/icons';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import PageContainer from '../../../components/PageContainer';
 
import { getVRConfig, saveVRConfig, setVRRole, listVRConfigVersions, getVRConfigVersion, saveVRConfigVersion } from '../../../services/vrConfigApi';

const RoleWizard: React.FC = () => {
  const navigate = useNavigate();
  const { uuid } = useParams();
  const [searchParams] = useSearchParams();
  const [current, setCurrent] = useState<number>(0);
  const [form] = Form.useForm();
  const [loading, setLoading] = useState<boolean>(false);
  const [existingCfg, setExistingCfg] = useState<any>({});
  const [role, setRole] = useState<'PE' | 'CE' | '标准' | 'SASE' | undefined>(undefined);
  const [versionMode, setVersionMode] = useState<'new' | 'existing'>('new');
  const [versionList, setVersionList] = useState<Array<{ id: number; created_at: string }>>([]);
  const [selectedVersionId, setSelectedVersionId] = useState<number | undefined>(undefined);
  const [ifaceOptions, setIfaceOptions] = useState<string[]>([]);
  const [ifaceLoading, setIfaceLoading] = useState<boolean>(false);
  const [formValues, setFormValues] = useState<any>({});
  const typingTimer = useRef<number | null>(null);
  const [isPending, startTransition] = useTransition();
  // PE Step 3：多内网配置组的页签激活状态，避免重新渲染后回到第一个页签
  const [activeLanTabKey, setActiveLanTabKey] = useState<string | undefined>(undefined);
  // 签名调试信息：展示 Authorization 与 tonce（仅用于排查问题）
  const [signInfo, setSignInfo] = useState<{ Authorization?: string; tonce?: string; lastSignUrl?: string } | null>(null);

  // 支持两组密钥的回退尝试：先用 Cloudmap%23123，失败则尝试 Cloudmap123
  const KEY_CANDIDATES: Array<{ accesskey: string; secretkey: string }> = [
    { accesskey: 'Cloudmap%23123', secretkey: 'Cloudmap%23123' },
    { accesskey: 'Cloudmap123', secretkey: 'Cloudmap123' },
  ];

  /**
   * 统一的签名请求：按候选密钥依次尝试，返回 Authorization 与 tonce
   */
  const requestSign = async (path: string, method: 'GET' | 'POST' | 'PUT' | 'DELETE', other: string, bodyRaw: string): Promise<{ Authorization: string; tonce: string; lastSignUrl: string }> => {
    const lastErrors: string[] = [];
    for (const k of KEY_CANDIDATES) {
      const authUrl = `/api-proxy/api/sign?` +
        `url=${encodeURIComponent(path)}&` +
        `method=${method}&` +
        `other=${encodeURIComponent(other)}&` +
        `accessKey=${k.accesskey}&` +
        `secretKey=${k.secretkey}`;

      try {
        const signResp = await fetch(authUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: bodyRaw,
        });
        const rawText = await signResp.text();
        let signJson: any = null;
        try { signJson = JSON.parse(rawText); } catch { signJson = { raw: rawText }; }
        if (!signResp.ok) {
          lastErrors.push(`sign ${signResp.status}: ${typeof signJson === 'object' && signJson ? JSON.stringify(signJson) : String(signJson)}`);
          continue; // 尝试下一组密钥
        }
        const info = (signJson && signJson.data) ? signJson.data : signJson;
        if (!info || !info.Authorization || !info.tonce) {
          lastErrors.push('认证响应缺少 Authorization 或 tonce');
          continue;
        }
        // 记录调试信息并返回
        setSignInfo({ Authorization: String(info.Authorization), tonce: String(info.tonce), lastSignUrl: authUrl });
        return { Authorization: String(info.Authorization), tonce: String(info.tonce), lastSignUrl: authUrl };
      } catch (e: any) {
        lastErrors.push(e?.message || String(e));
        continue;
      }
    }
    throw new Error(`签名失败：${lastErrors.join(' | ')}`);
  };

  // 仅在用户主动操作（回车或点击导致失焦）时更新预览
  const commitPreview = () => {
    const all = form.getFieldsValue(true);
    startTransition(() => {
      setFormValues(all);
    });
  };

  const handleFormKeyDown: React.KeyboardEventHandler<HTMLFormElement> = (e) => {
    if (e.key === 'Enter') {
      commitPreview();
      const t = e.target as unknown as HTMLElement;
      if (t && typeof (t as any).blur === 'function') {
        (t as any).blur();
      }
      e.preventDefault();
      e.stopPropagation();
    }
  };

  const handleFormBlur: React.FocusEventHandler<HTMLFormElement> = () => {
    // 当输入框因点击其他元素而失焦时，更新预览
    commitPreview();
  };

  // 统一构建配置的函数，供预览与保存复用
  const buildConfigFromValues = (v: any, r?: typeof role) => {
    const cfg: any = {};

    // 正则与规范化函数：IPv4 CIDR（A.B.C.D/掩码，允许 /0 作为默认路由）
    // 注意：之前未允许 /0，导致默认路由 0.0.0.0/0 被判为非法，从而不生成 ipv4_route
    const ipv4CidrPattern = /^(?:(?:[0-9]|[1-9][0-9]|1[0-9]{2}|2[0-4][0-9]|25[0-5])\.){3}(?:[0-9]|[1-9][0-9]|1[0-9]{2}|2[0-4][0-9]|25[0-5])\/([0-9]|[1-2]\d|3[0-2])$/;
    const normalizeIPv4Cidr = (s: any) => {
      const t = String(s || '').trim();
      return ipv4CidrPattern.test(t) ? t : undefined;
    };

    // 正则与规范化函数：IPv6 地址（不允许携带掩码）
    const ipv6AddrPattern = /^(([0-9A-Fa-f]{1,4}:){7}[0-9A-Fa-f]{1,4}|([0-9A-Fa-f]{1,4}:){1,7}:|([0-9A-Fa-f]{1,4}:){1,6}:[0-9A-Fa-f]{1,4}|([0-9A-Fa-f]{1,4}:){1,5}(:[0-9A-Fa-f]{1,4}){1,2}|([0-9A-Fa-f]{1,4}:){1,4}(:[0-9A-Fa-f]{1,4}){1,3}|([0-9A-Fa-f]{1,4}:){1,3}(:[0-9A-Fa-f]{1,4}){1,4}|([0-9A-Fa-f]{1,4}:){1,2}(:[0-9A-Fa-f]{1,4}){1,5}|[0-9A-Fa-f]{1,4}:(:[0-9A-Fa-f]{1,4}){1,6}|:((:[0-9A-Fa-f]{1,4}){1,7}|:))$/;
    const normalizeIPv6Address = (s: any) => {
      const t = String(s || '').trim();
      if (!t || t.includes('/')) return undefined; // 禁止掩码
      return ipv6AddrPattern.test(t) ? t : undefined;
    };

    // SRv6 标识（CE 不需要设置）
    const sidAddr = normalizeIPv6Address(v?.sidPrefix);
    if (r !== 'CE' && (v?.locatorName || sidAddr)) {
      cfg.segment_routing_srv6 = {
        locator: v.locatorName,
        prefix: sidAddr,
      };
    }

    // 接口配置（按类型输出到 interfaces_* / subinterfaces_*）
    // 注意：需要将第2步的公网口与第3步的多组内网口合并到同一顶层接口数组，避免互相覆盖
    const ifaceObjs: any[] = [];
    // 1) 公网口（第2步）
    if (v?.wanDev) {
      const item: any = { name: String(v.wanDev).trim(), status: 'up' };
      const ipv4Wan = normalizeIPv4Cidr(v.wanIpv4);
      if (ipv4Wan) item.ipv4_static = ipv4Wan;
      if (v?.wanIpv6) item.ipv6_static = String(v.wanIpv6).trim();
      ifaceObjs.push(item);
    }
    // 2) 内网口（第3步）：若存在多组配置，逐组追加；否则兼容旧的单组字段
    const lanConfigsForInterface: any[] = Array.isArray(v?.lanConfigs) ? v.lanConfigs : [];
    if (lanConfigsForInterface.length) {
      lanConfigsForInterface.forEach((g: any) => {
        const item: any = { name: String(g?.ifName || '').trim(), status: 'up' };
        if (!item.name) return; // 无名称则跳过
        if (g?.vrf) item.vrf = g.vrf;
        const ipv4Lan = normalizeIPv4Cidr(g?.ipv4);
        if (ipv4Lan) item.ipv4_static = ipv4Lan;
        if (g?.ipv6) item.ipv6_static = String(g.ipv6).trim();
        ifaceObjs.push(item);
      });
    } else if (v?.ifName) {
      // 单组内网字段（旧结构兼容）
      const item: any = { name: String(v.ifName).trim(), status: 'up' };
      if (v?.internalVrf) item.vrf = v.internalVrf;
      const ipv4Lan = normalizeIPv4Cidr(v.ifIpv4);
      if (ipv4Lan) item.ipv4_static = ipv4Lan;
      if (v?.ifIpv6) item.ipv6_static = String(v.ifIpv6).trim();
      ifaceObjs.push(item);
    }
    if (ifaceObjs.length) {
      const buckets: Record<string, any[]> = {
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
      };
      ifaceObjs.forEach((item) => {
        const name: string = String(item?.name || '');
        const typePart = name.split(' ')[0];
        const isSub = name.includes('.');
        const push = (key: string) => { (buckets[key] || (buckets[key] = [])).push(item); };
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
            // 未识别类型时，回退到千兆以太网
            push(isSub ? 'subinterfaces_GigabitEthernet' : 'interfaces_GigabitEthernet');
            break;
        }
      });
      Object.keys(buckets).forEach((k) => {
        if (buckets[k] && buckets[k].length) {
          (cfg as any)[k] = buckets[k];
        }
      });
    }

    // IPv4/IPv6 路由
    // 仅 PE 在第2步需要默认 IPv4 路由；CE 不生成顶层 ipv4_route
    if (r === 'PE' && v?.wanDev) {
      const dest = normalizeIPv4Cidr(v?.wanRouteDest || '0.0.0.0/0');
      const prio = Number(v?.wanRoutePriority ?? 100);
      if (dest) {
        cfg.ipv4_route = [
          { destination: dest, dev: String(v.wanDev).trim(), priority: prio },
        ];
      }
    }
    if (r === 'PE' && v?.wanDev) {
      const route: any = { destination: (v?.ipv6Dest || '0::0/0'), via: (v?.ipv6Via || '500::1') };
      cfg.ipv6_route = [route];
    } else if (r !== 'PE' && v?.ipv6Dest) {
      const route: any = { destination: v.ipv6Dest, via: '500::1' };
      if (v?.internalVrf) route.vrf = v.internalVrf;
      cfg.ipv6_route = [route];
    }

    // VRF（内网配置，支持多组）
    const lanConfigs: any[] = Array.isArray(v?.lanConfigs) ? v.lanConfigs : [];
    if (lanConfigs.length) {
      const vrfs = Array.from(new Set(lanConfigs.map((g: any) => g?.vrf).filter(Boolean)));
      if (vrfs.length) cfg.vrf = vrfs;
    } else {
      // 兼容旧字段
      if (v?.internalVrf) {
        cfg.vrf = [v.internalVrf];
      }
    }

    // BGP（公网 + 私网/VRF）
    const bgp: any[] = [];
    const netsV6 = String(v?.bgpNetworkIpv6 || '')
      .split(',')
      .map((s: string) => s.trim())
      .filter((s: string) => !!s);
    const netsV4 = String(v?.bgpNetworkIpv4 || '')
      .split(',')
      .map((s: string) => s.trim())
      .filter((s: string) => !!s);
    const netsV4Valid = netsV4
      .map((s: string) => normalizeIPv4Cidr(s))
      .filter((s: string | undefined) => !!s);

      if (v?.bgpAsn || v?.bgpRouterId || netsV6.length || netsV4.length) {
        const item: any = {
          asn: Number(v.bgpAsn),
          router_id: v.bgpRouterId,
          bgp_ebgp_requires_policy: 'disable',
        };
        item.timer_bgp_KA = 2;
        item.timer_bgp_HA = 8;
        item.bgp_fast_convergence = 'enable';
        if (r !== 'CE') {
          item.address_family = [
            { address_family: 'ipv6', modifiler: 'unicast', network: netsV6 },
            { address_family: 'ipv4', modifiler: 'unicast', network: netsV4Valid },
          ];
        }
        if (r === 'PE' && v?.locatorName) {
          item.segment_routing_srv6 = { locator: v.locatorName };
        }
      bgp.push(item);
    }

    // 私网 BGP（每组内网配置一项，插入到顶层 bgp，按 PRD 设定 address_family）
    if (lanConfigs.length) {
      lanConfigs.forEach((g: any) => {
        if (g?.asn || g?.routerId) {
          bgp.push({
            asn: Number(g?.asn),
            vrf: g?.vrf,
            router_id: g?.routerId,
            bgp_ebgp_requires_policy: 'disable',
            address_family: [
              {
                address_family: 'ipv4',
                modifiler: 'unicast',
                export_route: 'enable',
                import_route: 'enable',
                auto_assign_sid: 'enable'
              }
            ]
          });
        }
      });
    } else {
      // 兼容旧字段（单组）
      if (v?.bgpAsnLan || v?.bgpRouterIdLan) {
        bgp.push({
          asn: Number(v.bgpAsnLan),
          vrf: v.internalVrf,
          router_id: v.bgpRouterIdLan,
          bgp_ebgp_requires_policy: 'disable',
          address_family: [
            {
              address_family: 'ipv4',
              modifiler: 'unicast',
              export_route: 'enable',
              import_route: 'enable',
              auto_assign_sid: 'enable'
            }
          ]
        });
      }
    }
    if (bgp.length) cfg.bgp = bgp;

    // 注意：这里不再单独为多组内网口生成另一套 buckets，以免覆盖第2步的公网口；
    // 上面已将多组内网口加入 ifaceObjs，统一在前面的 buckets 逻辑中落盘。

    return cfg;
  };

  const deferredValues = useDeferredValue(formValues);
  const configPreview = useMemo(() => buildConfigFromValues(deferredValues || {}, role), [deferredValues, role]);

  const roleDetails: Record<'标准' | 'SASE' | 'PE' | 'CE', {
    position: string;
    scenarios: string;
    capabilities: string[];
    notes: string;
  }> = {
    标准: {
      position: '在多云/异构网络之间提供基础路由互联能力',
      scenarios: '默认连通、监控与简单策略场景',
      capabilities: ['SRv6 转发', '静态路由', '健康监控', '基础策略'],
      notes: '主要配置 Locator 与 SID 前缀',
    },
    SASE: {
      position: '零信任安全出入口，统一策略与访问控制',
      scenarios: '统一出口、策略管控、远程访问与审计',
      capabilities: ['策略控制', '应用访问控制', '日志审计', '统一出入口'],
      notes: '主要配置 Locator 与 SID 前缀（后续可扩展策略模板）',
    },
    PE: {
      position: '与公网/上游运营商做边界互联的 Provider Edge',
      scenarios: 'EBGP/IBGP 互联、前缀通告与过滤',
      capabilities: ['BGP 会话维护', '前缀通告/过滤', 'SRv6 TE（可选）'],
      notes: '需配置 BGP ASN、BGP Router-ID 以及 Locator/SID 前缀',
    },
    CE: {
      position: '连接私网侧设备或网络的 Customer Edge',
      scenarios: '与 PE 对接、静态路由或（可选）IBGP',
      capabilities: ['本地路由', '基本策略', '健康监控'],
      notes: '需配置私网 Router-ID 以及 Locator/SID 前缀',
    },
  };

  useEffect(() => {
    const initRole = (searchParams.get('role') as 'PE' | 'CE' | '标准' | 'SASE' | null);
    if (initRole) setRole(initRole);
  }, [searchParams]);

  // 通过 URL 参数预设版本模式：当 version=latest 或 versionMode=existing 时，切换到“读取现有配置版本”
  useEffect(() => {
    const vParam = searchParams.get('version');
    const modeParam = searchParams.get('versionMode');
    if (vParam === 'latest' || modeParam === 'existing') {
      setVersionMode('existing');
    }
  }, [searchParams]);

  // 当角色选择变化时，拉取该角色的版本列表（最多5个）
  useEffect(() => {
    const fetchVersions = async () => {
      if (!uuid || !role) return;
      try {
        const list = await listVRConfigVersions(uuid, role);
        setVersionList(list.map(v => ({ id: v.id, created_at: v.created_at })));
      } catch (err) {
        console.warn('获取配置版本列表失败:', (err as any)?.message || err);
        setVersionList([]);
      }
    };
    fetchVersions();
  }, [uuid, role]);

  // 若 URL 指定 version=latest，则在拉取到版本列表后自动选择最新版本并预填
  useEffect(() => {
    const vParam = searchParams.get('version');
    if (vParam === 'latest' && versionList.length > 0) {
      const latest = [...versionList].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0];
      setSelectedVersionId(latest.id);
      loadSelectedVersionAndPopulate(latest.id);
    }
  }, [versionList, searchParams]);

  // 将已加载的版本配置映射到当前表单字段
  const populateFromLoadedConfig = (loaded: any) => {
    const pe = loaded?.pe || {};
    const ce = loaded?.ce || {};

    // 顶层 SRv6 信息（兼容老结构）
    const locatorTop = loaded?.segment_routing_srv6?.locator;
    const sidPrefixTop = loaded?.segment_routing_srv6?.prefix;

    // 公网BGP网络数组
    const nets = pe?.bgp?.[0]?.address_family || [];
    const ipv6Fam = nets.find((f: any) => f?.address_family === 'ipv6');
    const ipv4Fam = nets.find((f: any) => f?.address_family === 'ipv4');
    const ipv6Networks = Array.isArray(ipv6Fam?.network) ? ipv6Fam.network.join(', ') : undefined;
    const ipv4Networks = Array.isArray(ipv4Fam?.network) ? ipv4Fam.network.join(', ') : undefined;

    // 内网（第3步）
    const lan = pe?.lan || {};
    const lanIface = Array.isArray(lan?.interfaces_GigabitEthernet) ? lan.interfaces_GigabitEthernet[0] : undefined;
    const lanRoute = Array.isArray(lan?.ipv6_route) ? lan.ipv6_route[0] : undefined;
    const lanBgp = Array.isArray(lan?.bgp) ? lan.bgp[0] : undefined;
    const neighbor0 = Array.isArray(lanBgp?.neighbor) ? lanBgp.neighbor[0] : undefined;

    // 兼容顶层 keys（没有 pe.lan 时从顶层推断）
    const findAnyInterface = () => {
      const keys = Object.keys(loaded || {});
      for (const k of keys) {
        if (k.startsWith('interfaces_') || k.startsWith('subinterfaces_')) {
          const arr = (loaded as any)[k];
          if (Array.isArray(arr) && arr.length) return arr[0];
        }
      }
      return undefined;
    };
    const anyIface = lanIface || findAnyInterface();
    const ipv4RouteTop = Array.isArray(loaded?.ipv4_route) ? loaded.ipv4_route[0] : undefined;
    const ipv6RouteTop = Array.isArray(loaded?.ipv6_route) ? loaded.ipv6_route[0] : undefined;
    const bgpTop = Array.isArray(loaded?.bgp) ? loaded.bgp[0] : undefined;

    const internalVrfTop = Array.isArray(loaded?.vrf) ? loaded.vrf[0] : loaded?.vrf;
    const ifaceVrf = anyIface?.vrf;

      form.setFieldsValue({
        locatorName: pe.locatorName || ce.locatorName || locatorTop,
        sidPrefix: pe.sidPrefix || ce.sidPrefix || sidPrefixTop,
        // 公网（第2步）
        wanDev: pe?.wan?.dev || pe?.interfaces_GigabitEthernet?.[0]?.name || ipv4RouteTop?.dev || anyIface?.name,
        wanIpv4: pe?.interfaces_GigabitEthernet?.[0]?.ipv4_static || anyIface?.ipv4_static,
        wanIpv6: pe?.interfaces_GigabitEthernet?.[0]?.ipv6_static || anyIface?.ipv6_static,
        bgpAsn: pe?.bgp?.[0]?.asn || bgpTop?.asn,
        bgpRouterId: pe?.bgp?.[0]?.router_id || bgpTop?.router_id,
        bgpNetworkIpv6: ipv6Networks,
        bgpNetworkIpv4: ipv4Networks,
        // 按新需求：PE 第2步不再在表单中配置 address_family
        // 内网（第3步）
        internalVrf: Array.isArray(lan?.vrf) ? lan.vrf[0] : lan?.vrf || ifaceVrf || internalVrfTop,
        ifName: lanIface?.name || anyIface?.name,
        ifIpv4: lanIface?.ipv4_static || anyIface?.ipv4_static,
      ifIpv6: lanIface?.ipv6_static || anyIface?.ipv6_static,
      ipv6Dest: lanRoute?.destination || ipv6RouteTop?.destination,
      ipv6Via: (lanRoute?.via || ipv6RouteTop?.via || '500::1'),
      bgpAsnLan: lanBgp?.asn || ((bgpTop && bgpTop.vrf) ? bgpTop.asn : undefined),
      bgpRouterIdLan: lanBgp?.router_id || ((bgpTop && bgpTop.vrf) ? bgpTop.router_id : undefined),
      vpnRD: neighbor0?.route_distinguisher,
      vpnRT: neighbor0?.route_target,
    });

    // 将已加载的“多组内网配置”映射到 Form.List(lanConfigs)，以便 Tabs 正确回显
    // 1) 收集所有接口（优先 pe.lan.*，其次顶层 interfaces_*/subinterfaces_*）
    const ifaceItems: Array<{ name?: string; ipv4_static?: string; ipv6_static?: string; vrf?: any }> = [];
    const collectFromArr = (arr?: any[]) => {
      (arr || []).forEach((it) => {
        if (it && typeof it === 'object') {
          ifaceItems.push({
            name: it.name,
            ipv4_static: it.ipv4_static,
            ipv6_static: it.ipv6_static,
            vrf: it.vrf,
          });
        }
      });
    };
    if (pe?.lan) {
      Object.keys(pe.lan).forEach((k) => {
        if (k.startsWith('interfaces_') || k.startsWith('subinterfaces_')) {
          collectFromArr((pe.lan as any)[k]);
        }
      });
    }
    Object.keys(loaded || {}).forEach((k) => {
      if (k.startsWith('interfaces_') || k.startsWith('subinterfaces_')) {
        collectFromArr((loaded as any)[k]);
      }
    });

    // 2) 收集所有带 vrf 的 BGP 分组（顶层 bgp）
    const topBgpArr: any[] = Array.isArray(loaded?.bgp) ? loaded.bgp : [];
    const bgpByVrf = new Map<any, { asn?: number; routerId?: string }>();
    topBgpArr.forEach((b) => {
      if (b && typeof b === 'object' && 'vrf' in b && b.vrf != null) {
        bgpByVrf.set(b.vrf, { asn: b.asn, routerId: b.router_id });
      }
    });

    // 3) 以 VRF 聚合为 lanConfigs；若接口没有 vrf，但存在 pe.lan.vrf 或 loaded.vrf 顶层字段，则也作为单组
    const vrfCandidates = new Set<any>();
    ifaceItems.forEach((it) => { if (it.vrf != null) vrfCandidates.add(it.vrf); });
    topBgpArr.forEach((b) => { if (b?.vrf != null) vrfCandidates.add(b.vrf); });
    if (lan?.vrf) {
      const arr = Array.isArray(lan.vrf) ? lan.vrf : [lan.vrf];
      arr.forEach((v: any) => { if (v != null) vrfCandidates.add(v); });
    }
    if (loaded?.vrf) {
      const arr = Array.isArray(loaded.vrf) ? loaded.vrf : [loaded.vrf];
      arr.forEach((v: any) => { if (v != null) vrfCandidates.add(v); });
    }

    const groups: any[] = [];
    if (vrfCandidates.size > 0) {
      Array.from(vrfCandidates).forEach((vrfVal) => {
        const ifaceMatch = ifaceItems.find((it) => it.vrf === vrfVal) || ifaceItems[0];
        const bgpMatch = bgpByVrf.get(vrfVal);
        groups.push({
          vrf: vrfVal,
          ifName: ifaceMatch?.name,
          ipv4: ifaceMatch?.ipv4_static,
          ipv6: ifaceMatch?.ipv6_static,
          asn: bgpMatch?.asn,
          routerId: bgpMatch?.routerId,
        });
      });
    } else if (ifaceItems.length) {
      // 无 VRF 候选时，仍然按首个接口生成一组，便于回显旧结构
      const first = ifaceItems[0];
      groups.push({
        vrf: first?.vrf ?? internalVrfTop,
        ifName: first?.name,
        ipv4: first?.ipv4_static,
        ipv6: first?.ipv6_static,
        asn: bgpTop?.asn,
        routerId: bgpTop?.router_id,
      });
    }

    if (groups.length) {
      form.setFieldsValue({ lanConfigs: groups });
      // 保持 Tabs 激活页签稳定：若尚未设置，则默认激活第一个
      setActiveLanTabKey((k) => (k != null ? k : '0'));
    }
    commitPreview();
  };

  const loadSelectedVersionAndPopulate = async (id?: number) => {
    if (!id) return;
    try {
      const v = await getVRConfigVersion(id);
      if (v && v.config_json) {
        const loaded = JSON.parse(v.config_json);
        populateFromLoadedConfig(loaded);
      }
    } catch (err) {
      console.warn('读取配置版本失败:', (err as any)?.message || err);
    }
  };

  useEffect(() => {
    let mounted = true;
    if (!uuid) return;
    getVRConfig(uuid).then((cfg) => {
      if (!mounted) return;
      setExistingCfg(cfg || {});
      // 预填可能已有的基础配置
      const pe = cfg?.pe || {};
      const ce = cfg?.ce || {};
      // 收集网卡选项（尽力从配置中提取）
      const names: string[] = [];
      const collectNames = (arr?: any[]) => {
        (arr || []).forEach((it) => { if (it?.name) names.push(String(it.name)); });
      };
      // 1) 常见位置
      collectNames(pe?.interfaces_GigabitEthernet);
      collectNames(pe?.lan?.interfaces_GigabitEthernet);
      // 2) 顶层 keys（兼容旧结构），扫描 interfaces_*/subinterfaces_* 所有数组
      if (cfg && typeof cfg === 'object') {
        Object.keys(cfg).forEach((key) => {
          if (key.startsWith('interfaces_') || key.startsWith('subinterfaces_')) {
            collectNames((cfg as any)[key]);
          }
        });
      }
      setIfaceOptions(Array.from(new Set(names)).filter(Boolean));

      form.setFieldsValue({
        locatorName: pe.locatorName || ce.locatorName,
        sidPrefix: pe.sidPrefix || ce.sidPrefix,
        bgpAsn: pe.bgpAsn,
        bgpRouterId: pe.publicRouterId,
        privateRouterId: ce.privateRouterId,
        wanDev: pe.wan?.dev,
        wanRouteDest: pe.wan?.route?.destination,
        wanRoutePriority: pe.wan?.route?.priority,
        wanIpv4: pe?.interfaces_GigabitEthernet?.[0]?.ipv4_static,
        wanIpv6: pe?.interfaces_GigabitEthernet?.[0]?.ipv6_static,
        internalVrf: pe.lan?.vrf,
        ifName: pe.lan?.interfaces_GigabitEthernet?.[0]?.name,
        ifIpv4: pe.lan?.interfaces_GigabitEthernet?.[0]?.ipv4_static,
        ifVrf: pe.lan?.interfaces_GigabitEthernet?.[0]?.vrf,
        ifStatus: pe.lan?.interfaces_GigabitEthernet?.[0]?.status,
        ipv6Dest: pe.lan?.ipv6_route?.[0]?.destination,
        ipv6Via: pe.lan?.ipv6_route?.[0]?.via,
        bgpAsnLan: pe.lan?.bgp?.[0]?.asn,
        bgpRouterIdLan: pe.lan?.bgp?.[0]?.router_id,
        bgpEbgpRequiresPolicy: pe.lan?.bgp?.[0]?.bgp_ebgp_requires_policy === 'disable',
        vpnExport: pe.lan?.bgp?.[0]?.neighbor?.[0]?.export_route === 'enable',
        vpnImport: pe.lan?.bgp?.[0]?.neighbor?.[0]?.import_route === 'enable',
        vpnAutoSid: pe.lan?.bgp?.[0]?.neighbor?.[0]?.auto_assign_sid === 'enable',
        bgpNetworkIpv4: (() => {
          const fam = pe?.bgp?.[0]?.address_family || [];
          const ipv4 = fam.find((f: any) => f?.address_family === 'ipv4');
          const nets = ipv4?.network || [];
          return Array.isArray(nets) ? nets.join(', ') : undefined;
        })(),
        bgpNetworkIpv6: (() => {
          const fam = pe?.bgp?.[0]?.address_family || [];
          const ipv6 = fam.find((f: any) => f?.address_family === 'ipv6');
          const nets = ipv6?.network || [];
          return Array.isArray(nets) ? nets.join(', ') : undefined;
        })(),
      });

      // 预填多组内网配置（lanConfigs），使 Tabs 回显
      const ifaceItems: Array<{ name?: string; ipv4_static?: string; ipv6_static?: string; vrf?: any }> = [];
      const collectFromArr = (arr?: any[]) => {
        (arr || []).forEach((it) => {
          if (it && typeof it === 'object') {
            ifaceItems.push({
              name: it.name,
              ipv4_static: it.ipv4_static,
              ipv6_static: it.ipv6_static,
              vrf: it.vrf,
            });
          }
        });
      };
      if (pe?.lan) {
        Object.keys(pe.lan).forEach((k) => {
          if (k.startsWith('interfaces_') || k.startsWith('subinterfaces_')) {
            collectFromArr((pe.lan as any)[k]);
          }
        });
      }
      Object.keys(cfg || {}).forEach((k) => {
        if (k.startsWith('interfaces_') || k.startsWith('subinterfaces_')) {
          collectFromArr((cfg as any)[k]);
        }
      });
      const topBgpArr: any[] = Array.isArray(cfg?.bgp) ? cfg.bgp : [];
      const bgpByVrf = new Map<any, { asn?: number; routerId?: string }>();
      topBgpArr.forEach((b) => {
        if (b && typeof b === 'object' && 'vrf' in b && b.vrf != null) {
          bgpByVrf.set(b.vrf, { asn: b.asn, routerId: b.router_id });
        }
      });
      const vrfCandidates = new Set<any>();
      ifaceItems.forEach((it) => { if (it.vrf != null) vrfCandidates.add(it.vrf); });
      topBgpArr.forEach((b) => { if (b?.vrf != null) vrfCandidates.add(b.vrf); });
      if (pe?.lan?.vrf) {
        const arr = Array.isArray(pe.lan.vrf) ? pe.lan.vrf : [pe.lan.vrf];
        arr.forEach((v: any) => { if (v != null) vrfCandidates.add(v); });
      }
      const groups: any[] = [];
      if (vrfCandidates.size > 0) {
        Array.from(vrfCandidates).forEach((vrfVal) => {
          const ifaceMatch = ifaceItems.find((it) => it.vrf === vrfVal) || ifaceItems[0];
          const bgpMatch = bgpByVrf.get(vrfVal);
          groups.push({
            vrf: vrfVal,
            ifName: ifaceMatch?.name,
            ipv4: ifaceMatch?.ipv4_static,
            ipv6: ifaceMatch?.ipv6_static,
            asn: bgpMatch?.asn,
            routerId: bgpMatch?.routerId,
          });
        });
      } else if (ifaceItems.length) {
        const first = ifaceItems[0];
        groups.push({
          vrf: first?.vrf ?? pe?.lan?.vrf,
          ifName: first?.name,
          ipv4: first?.ipv4_static,
          ipv6: first?.ipv6_static,
          asn: pe?.lan?.bgp?.[0]?.asn,
          routerId: pe?.lan?.bgp?.[0]?.router_id,
        });
      }
      if (groups.length) {
        form.setFieldsValue({ lanConfigs: groups });
        setActiveLanTabKey((k) => (k != null ? k : '0'));
      }
    }).catch(() => {
      setExistingCfg({});
    });
    return () => { mounted = false; };
  }, [uuid, form]);

  // 通过设备“查询现有配置”接口获取真实的接口列表，填充公网口选择
  useEffect(() => {
    const fetchInterfaces = async () => {
      if (!uuid) return;
      setIfaceLoading(true);
      try {
        const method = 'GET';
        const other = `uuid=${uuid}`;
        const path = '/V2/ctcontrol/VR3/VRConfig/list';
        // 使用统一签名函数（支持密钥回退），GET 场景 body 为空字符串
        const info = await requestSign(path, method as any, other, '');

        const queryUrl = `/api-proxy${path}?${other}`;
        const resp = await fetch(queryUrl, {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': info.Authorization,
            'tonce': String(info.tonce),
          },
        });
        const raw = await resp.json().catch(async () => ({ raw: await resp.text() }));
        // 递归剥离多层 data 包裹
        const unwrapData = (obj: any) => {
          let cur = obj;
          while (cur && typeof cur === 'object' && 'data' in cur) {
            cur = (cur as any).data;
          }
          return cur;
        };
        const data = unwrapData(raw);

        // 从返回的配置中提取所有接口名称：支持统一 interfaces 数组与模板拆分后的 interfaces_*/subinterfaces_*
        const names: string[] = [];
        const collectFromArray = (arr?: any[]) => {
          (arr || []).forEach((it) => { if (it && typeof it === 'object' && it.name) names.push(String(it.name)); });
        };
        if (data && typeof data === 'object') {
          // 1) 统一接口数组
          collectFromArray((data as any).interfaces);
          // 2) 各类接口键
          Object.keys(data).forEach((key) => {
            if (key.startsWith('interfaces_') || key.startsWith('subinterfaces_')) {
              collectFromArray((data as any)[key]);
            }
          });
        }

        const unique = Array.from(new Set(names)).filter((n) => !!n);
        if (unique.length) {
          setIfaceOptions(unique);
        }
      } catch (err) {
        // 保持静默，沿用平台已保存配置中的接口名作为备选
        console.warn('[RoleWizard] 获取设备接口列表失败：', (err as any)?.message || err);
      } finally {
        setIfaceLoading(false);
      }
    };
    fetchInterfaces();
  }, [uuid]);

  // 在第2步为 PE 角色设置默认值（默认路由目的与优先级）
  useEffect(() => {
    if (current === 1 && role === 'PE') {
      form.setFieldsValue({
        wanRouteDest: form.getFieldValue('wanRouteDest') ?? '0.0.0.0/0',
        wanRoutePriority: form.getFieldValue('wanRoutePriority') ?? 100,
        ipv6Dest: form.getFieldValue('ipv6Dest') ?? '0::0/0',
        ipv6Via: form.getFieldValue('ipv6Via') ?? '500::1',
      });
    }
  }, [current, role, form]);

  const stepTitle = useMemo(() => {
    if (current === 0) return '选择角色';
    if (current === 1) {
      if (role === 'PE') return '公网配置（PE to PE）';
      if (role === 'CE') return '外网配置(CE to PE)';
      return '配置基础参数';
    }
    if (current === 2) {
      if (role === 'PE') return '内网配置（PE to CE）';
      if (role === 'CE') return '内网配置(CE to local)';
    }
    return '确认与保存';
  }, [current, role]);

  const next = async () => {
    const totalSteps = role === 'PE' ? 4 : (role === 'CE' ? 4 : 3);
    if (current === 0) {
      if (!role) {
        message.warning('请先选择角色（PE/CE/标准/SASE）');
        return;
      }
      // 如果选择读取现有版本且选择了具体版本，则预填表单
      if (versionMode === 'existing' && selectedVersionId) {
        await loadSelectedVersionAndPopulate(selectedVersionId);
      }
      setCurrent(current + 1);
      return;
    }
    try {
      await form.validateFields();
      if (current < totalSteps - 1) {
        setCurrent(current + 1);
      }
    } catch (_) {}
  };

  const prev = () => setCurrent(current - 1);

  const handleSave = async () => {
    if (!uuid) {
      message.error('缺少 VR 的 UUID，无法保存');
      return;
    }
    try {
      // 已在每一步点击“下一步”时进行校验；此处直接抓取所有字段的最新值
      const values = form.getFieldsValue(true);
      // PE 角色兜底：若未选择公网口设备，尝试用已存在配置或设备上报的首个接口填充
      if (role === 'PE' && !String(values?.wanDev || '').trim()) {
        const fallbackWan = String(
          existingCfg?.pe?.wan?.dev ||
          existingCfg?.interfaces_GigabitEthernet?.[0]?.name ||
          (ifaceOptions && ifaceOptions[0]) ||
          ''
        ).trim();
        if (fallbackWan) {
          form.setFieldsValue({ wanDev: fallbackWan });
          (values as any).wanDev = fallbackWan;
        }
      }
      setLoading(true);
      // 使用与右侧预览一致的构建逻辑生成基础配置
      const cfg = buildConfigFromValues(values, role);

      // 防御：若拼装为空对象，给出提示，避免保存空版本
      if (!cfg || (typeof cfg === 'object' && Object.keys(cfg).length === 0)) {
        message.warning('拼装结果为空，请检查第2、3步是否已填写必要字段');
        setLoading(false);
        return;
      }

      // 为版本存储进行结构补充：将“设定BGP（to CE）”、内网接口、内网静态路由同步到 pe.lan.*，以及将公网口接口与默认 IPv4 路由同步到 pe.wan.*，便于后续读取版本时还原该段配置
      const versionCfg: any = { ...cfg };
      const ensurePeLan = () => {
        versionCfg.pe = { ...(versionCfg.pe || {}) };
        versionCfg.pe.lan = { ...(versionCfg.pe.lan || {}) };
        return versionCfg.pe.lan;
      };
      const ensurePeWan = () => {
        versionCfg.pe = { ...(versionCfg.pe || {}) };
        versionCfg.pe.wan = { ...(versionCfg.pe.wan || {}) };
        return versionCfg.pe.wan;
      };

      // 若顶层未生成 ipv4_route，但满足 PE 且已有 wanDev，则补齐默认 ipv4_route
      if (role === 'PE') {
        const wanDev = String(values?.wanDev || '').trim();
        const hasTopIpv4Route = Array.isArray((versionCfg as any)?.ipv4_route) && (versionCfg as any).ipv4_route.length > 0;
        if (wanDev && !hasTopIpv4Route) {
          const dest = '0.0.0.0/0';
          const prio = Number(values?.wanRoutePriority ?? 100);
          (versionCfg as any).ipv4_route = [
            { destination: dest, dev: wanDev, priority: prio },
          ];
        }
      }

      // 顶层 BGP 追加（PE 第3步：按 PRD 设定 address_family），支持多组
      if (role === 'PE') {
        const groups: any[] = Array.isArray(values?.lanConfigs) ? values.lanConfigs : [];
        const ensureTopBgp = () => {
          (versionCfg as any).bgp = Array.isArray((versionCfg as any).bgp) ? (versionCfg as any).bgp : [];
          return (versionCfg as any).bgp as any[];
        };
        if (groups.length) {
          const bgpArr = ensureTopBgp();
          groups.forEach((g: any) => {
            if (g?.asn || g?.routerId) {
              bgpArr.push({
                asn: Number(g?.asn),
                vrf: g?.vrf,
                router_id: g?.routerId,
                bgp_ebgp_requires_policy: 'disable',
                address_family: [
                  {
                    address_family: 'ipv4',
                    modifiler: 'unicast',
                    export_route: 'enable',
                    import_route: 'enable',
                    auto_assign_sid: 'enable'
                  }
                ]
              });
            }
          });
        } else if (values?.bgpAsnLan || values?.bgpRouterIdLan) {
          const bgpArr = ensureTopBgp();
          bgpArr.push({
            asn: Number(values.bgpAsnLan),
            vrf: values.internalVrf,
            router_id: values.bgpRouterIdLan,
            bgp_ebgp_requires_policy: 'disable',
            address_family: [
              {
                address_family: 'ipv4',
                modifiler: 'unicast',
                export_route: 'enable',
                import_route: 'enable',
                auto_assign_sid: 'enable'
              }
            ]
          });
        }
      }

      // 顶层接口数组（PE 第3步），支持多组
      if (role === 'PE') {
        const groups: any[] = Array.isArray(values?.lanConfigs) ? values.lanConfigs : [];
        const buckets: Record<string, any[]> = {
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
        };
        const normalizeIPv4CidrLocal = (s: any) => {
          const re = /^(?:(?:[0-9]|[1-9][0-9]|1[0-9]{2}|2[0-4][0-9]|25[0-5])\.){3}(?:[0-9]|[1-9][0-9]|1[0-9]{2}|2[0-4][0-9]|25[0-5])\/([0-9]|[1-2]\d|3[0-2])$/;
          const t = String(s || '').trim();
          return re.test(t) ? t : undefined;
        };
        const pushItem = (g: any) => {
          if (!g?.ifName) return;
          const item: any = { name: g.ifName, vrf: g?.vrf, status: 'up' };
          const ipv4Lan = normalizeIPv4CidrLocal(g?.ipv4);
          if (ipv4Lan) item.ipv4_static = ipv4Lan;
          if (g?.ipv6) item.ipv6_static = String(g.ipv6).trim();
          const name: string = String(item?.name || '');
          const typePart = name.split(' ')[0];
          const isSub = name.includes('.');
          const push = (key: string) => { (buckets[key] || (buckets[key] = [])).push(item); };
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
              push(isSub ? 'subinterfaces_GigabitEthernet' : 'interfaces_GigabitEthernet');
              break;
          }
        };
        if (groups.length) {
          groups.forEach(pushItem);
        } else if (values?.ifName) {
          pushItem({
            ifName: values.ifName,
            vrf: values.internalVrf,
            ipv4: values.ifIpv4,
            ipv6: values.ifIpv6,
          });
        }
        Object.keys(buckets).forEach((k) => {
          if (buckets[k] && buckets[k].length) {
            (versionCfg as any)[k] = buckets[k];
          }
        });
      }

      // 根据最新 PRD：PE 角色不在第3步设定 IPv6 静态路由（跳过）

      // 将公网口接口同步到 pe.wan.interfaces_*/subinterfaces_*，并同步 pe.wan.dev
      if (role === 'PE' && values?.wanDev) {
        const wan = ensurePeWan();
        wan.dev = values.wanDev;
        const bucketsWan: Record<string, any[]> = {
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
        };
        const normalizeIPv4CidrLocal = (s: any) => {
          const re = /^(?:(?:[0-9]|[1-9][0-9]|1[0-9]{2}|2[0-4][0-9]|25[0-5])\.){3}(?:[0-9]|[1-9][0-9]|1[0-9]{2}|2[0-4][0-9]|25[0-5])\/([1-9]|[1-2]\d|3[0-2])$/;
          const t = String(s || '').trim();
          return re.test(t) ? t : undefined;
        };
        const itemWan: any = { name: values.wanDev, status: 'up' };
        const ipv4Wan = normalizeIPv4CidrLocal(values.wanIpv4);
        if (ipv4Wan) itemWan.ipv4_static = ipv4Wan;
        if (values?.wanIpv6) itemWan.ipv6_static = String(values.wanIpv6).trim();
        const nameWan: string = String(itemWan?.name || '');
        const typePartWan = nameWan.split(' ')[0];
        const isSubWan = nameWan.includes('.');
        const pushWan = (key: string) => { (bucketsWan[key] || (bucketsWan[key] = [])).push(itemWan); };
        switch (typePartWan) {
          case 'BondEthernet':
            pushWan(isSubWan ? 'subinterfaces_BondEthernet' : 'interfaces_BondEthernet');
            break;
          case 'TapEthernet':
            pushWan(isSubWan ? 'subinterfaces_TapEthernet' : 'interfaces_TapEthernet');
            break;
          case 'memif':
            pushWan(isSubWan ? 'subinterfaces_memif' : 'interfaces_memif');
            break;
          case 'GigabitEthernet':
            pushWan(isSubWan ? 'subinterfaces_GigabitEthernet' : 'interfaces_GigabitEthernet');
            break;
          case 'lo':
            pushWan('interfaces_lo');
            break;
          case 'Tunnel':
            pushWan(isSubWan ? 'subinterfaces_Tunnel' : 'interfaces_Tunnel');
            break;
          default:
            pushWan(isSubWan ? 'subinterfaces_GigabitEthernet' : 'interfaces_GigabitEthernet');
            break;
        }
        Object.keys(bucketsWan).forEach((k) => {
          if (bucketsWan[k] && bucketsWan[k].length) {
            (wan as any)[k] = bucketsWan[k];
          }
        });
      }

      // 将默认 IPv4 路由同步到 pe.wan.ipv4_route
      if (role === 'PE' && values?.wanDev) {
        const wan = ensurePeWan();
        const normalizeIPv4CidrLocal = (s: any) => {
          const re = /^(?:(?:[0-9]|[1-9][0-9]|1[0-9]{2}|2[0-4][0-9]|25[0-5])\.){3}(?:[0-9]|[1-9][0-9]|1[0-9]{2}|2[0-4][0-9]|25[0-5])\/([0-9]|[1-2]\d|3[0-2])$/;
          const t = String(s || '').trim();
          return re.test(t) ? t : undefined;
        };
        const dest = normalizeIPv4CidrLocal(values?.wanRouteDest || '0.0.0.0/0');
        const prio = Number(values?.wanRoutePriority ?? 100);
        if (dest) {
          wan.ipv4_route = [
            { destination: dest, dev: values.wanDev, priority: prio },
          ];
        }
        wan.ipv6_route = [
          { destination: (values?.ipv6Dest || '0::0/0'), via: (values?.ipv6Via || '500::1') }
        ];
      }

      // 取消保存前的强制校验：允许在未选择公网口设备时也保存版本（按你的需求，移除该阻断）

      // 保存配置版本（最多保留5个由后端控制）
      await saveVRConfigVersion(uuid, role as 'PE' | 'CE' | '标准' | 'SASE', versionCfg);
      // 仍然更新当前角色，便于列表展示
      await setVRRole(uuid, role as 'PE' | 'CE' | '标准' | 'SASE');
      message.success('配置版本已保存（最多保留5个），已留在当前页面');
    } catch (err: any) {
      message.error(`保存失败：${err?.message || '请稍后重试'}`);
    } finally {
      setLoading(false);
    }
  };

  // 配置下发：直接将当前拼装的配置下发到设备
  const handleDispatch = async () => {
    if (!uuid) {
      message.error('缺少 VR 的 UUID，无法下发');
      return;
    }
    try {
      const values = form.getFieldsValue(true);

      // 取消下发前对默认 IPv4 路由的强制校验：由后端进行最终校验与容错

      // 下发前预检：确保所选接口在设备已上报的接口列表中
      const selectedWan = String(values?.wanDev || '').trim();
      const selectedLan = String(values?.ifName || '').trim();
      const reported = new Set((ifaceOptions || []).map((n) => String(n).trim()));
      if (selectedWan && !reported.has(selectedWan)) {
        const listStr = (ifaceOptions || []).join(', ');
        message.error(`下发失败：公网口设备“${selectedWan}”不在设备已上报的接口中。请从下拉框选择设备上报的接口，或刷新接口列表。可选：${listStr || '（暂无列表）'}`);
        return;
      }
      if (selectedLan && !reported.has(selectedLan)) {
        const listStr = (ifaceOptions || []).join(', ');
        message.error(`下发失败：内网接口“${selectedLan}”不在设备已上报的接口中。请从下拉框选择设备上报的接口，或刷新接口列表。可选：${listStr || '（暂无列表）'}`);
        return;
      }

      const cfg = buildConfigFromValues(values, role);
      if (!cfg || (typeof cfg === 'object' && Object.keys(cfg).length === 0)) {
        message.warning('拼装结果为空，请检查第2、3步是否已填写必要字段');
        return;
      }
      // 取消针对 PE 默认 IPv4 路由的阻断性检查，让配置可下发；若设备侧需要默认路由，由后端进行兜底或返回明确错误
      setLoading(true);

      const path = '/V2/ctcontrol/VR2/VRConfig';
      const method = 'POST';
      // POST 的签名 other 为空；签名服务会以 body 原文参与计算
      const other = '';
      // 使用统一签名函数（支持密钥回退），POST 场景传真实 body
      const info = await requestSign(path, method as any, other, JSON.stringify({ uuid, ...cfg }));

      // 与 Postman 使用方式保持一致：uuid 放到 body 中，URL 不携带查询参数
      const postUrl = `/api-proxy${path}`;
      const resp = await fetch(postUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': info.Authorization,
          // 避免重复同名头导致后端解析异常，仅发送小写 tonce（与 Postman 脚本一致）
          'tonce': String(info.tonce)
        },
        body: JSON.stringify({ uuid, ...cfg })
      });

      const data = await resp.json().catch(async () => ({ raw: await resp.text() }));
      if (resp.ok) {
        message.success(data?.msg || '配置已下发');
      } else {
        throw new Error(data?.msg || `设备返回错误: ${resp.status}`);
      }
    } catch (err: any) {
      message.error(`下发失败：${err?.message || '请稍后重试'}`);
    } finally {
      setLoading(false);
    }
  };

      const CoreContent = () => {
        if (current === 0) {
          return (
            <>
              <Form layout="vertical">
            <Form.Item label={<span style={{ fontSize: 13, color: '#595959' }}>选择角色</span>} required>
              <Radio.Group value={role} onChange={(e) => setRole(e.target.value)}>
                <Radio.Button value="标准" disabled>标准（虚拟路由）</Radio.Button>
                <Radio.Button value="SASE" disabled>SASE（安全网关）</Radio.Button>
                <Radio.Button value="PE">PE（BGP公网互联）</Radio.Button>
                <Radio.Button value="CE">CE（私网接入）</Radio.Button>
              </Radio.Group>
            </Form.Item>
                {role && (
                  <>
                    <Form.Item label={<span style={{ fontSize: 13, color: '#595959' }}>配置版本选项</span>} required>
                      <Radio.Group value={versionMode} onChange={(e) => setVersionMode(e.target.value)}>
                        <Radio.Button value="new">新建配置版本</Radio.Button>
                        <Radio.Button value="existing">读取现有配置版本</Radio.Button>
                      </Radio.Group>
                    </Form.Item>
                    {versionMode === 'existing' && (
                      <Form.Item label={<span style={{ fontSize: 13, color: '#595959' }}>选择现有版本</span>}>
                        <Select
                          placeholder={versionList.length ? '请选择一个版本' : '暂无版本可选'}
                          value={selectedVersionId}
                          onChange={async (v) => {
                            setSelectedVersionId(v);
                            await loadSelectedVersionAndPopulate(v);
                          }}
                          options={versionList.map(v => ({
                            label: `版本 #${v.id}（${new Date(v.created_at).toLocaleString()}）`,
                            value: v.id,
                          }))}
                        />
                      </Form.Item>
                    )}
                  </>
                )}
              </Form>
            </>
          );
        }
    if (current === 1) {
      return (
          <Form
            layout="vertical"
            form={form}
            onKeyDown={handleFormKeyDown}
            onBlur={handleFormBlur}
            // 为满足“整体输入完成后再更新预览”的要求，移除实时 onValuesChange 更新；仅在 Enter 或点击其他组件导致失焦时更新预览
          >
          {(role === '标准' || role === 'SASE') && (
            <>
              <Form.Item name="locatorName" label={<span style={{ fontSize: 13, color: '#595959' }}>SRv6 Locator 名称</span>} rules={[{ required: true, message: '请输入 Locator 名称' }]}> 
                <Input placeholder="例如：default" />
              </Form.Item>
              <Form.Item
                name="sidPrefix"
                label="SRv6 SID 前缀"
                rules={[
                  { required: true, message: '请输入 SID 前缀' },
                  {
                    validator: async (_, value) => {
                      const v = String(value || '').trim();
                      if (!v) return Promise.resolve();
                      if (v.includes('/')) return Promise.reject(new Error('请输入不带掩码的 IPv6 地址（不能包含/）'));
                      const re = /^(([0-9A-Fa-f]{1,4}:){7}[0-9A-Fa-f]{1,4}|([0-9A-Fa-f]{1,4}:){1,7}:|([0-9A-Fa-f]{1,4}:){1,6}:[0-9A-Fa-f]{1,4}|([0-9A-Fa-f]{1,4}:){1,5}(:[0-9A-Fa-f]{1,4}){1,2}|([0-9A-Fa-f]{1,4}:){1,4}(:[0-9A-Fa-f]{1,4}){1,3}|([0-9A-Fa-f]{1,4}:){1,3}(:[0-9A-Fa-f]{1,4}){1,4}|([0-9A-Fa-f]{1,4}:){1,2}(:[0-9A-Fa-f]{1,4}){1,5}|[0-9A-Fa-f]{1,4}:(:[0-9A-Fa-f]{1,4}){1,6}|:((:[0-9A-Fa-f]{1,4}){1,7}|:))$/;
                      if (re.test(v)) return Promise.resolve();
                      return Promise.reject(new Error('请输入合法的 IPv6 地址（例如：2400:1234::1），不包含掩码'));
                    }
                  }
                ]}
              >
                <Input placeholder="例如：2400:1234::1（不能包含/掩码）" />
              </Form.Item>
            </>
          )}
          {role === 'PE' && (
            <>
              {/* 标题1：设定SRv6标识 */}
              <div style={{ fontSize: 13, color: '#1677ff', margin: '4px 0 12px 0', borderBottom: '1px solid #e8e8e8', paddingBottom: 6 }}>设定SRv6标识</div>
              <Form.Item name="locatorName" label={<span style={{ fontSize: 13, color: '#595959' }}>SRv6 Locator 名称</span>} rules={[{ required: true, message: '请输入 Locator 名称' }]}> 
                <Input placeholder="例如：default" />
              </Form.Item>
              <Form.Item
                name="sidPrefix"
                label={<span style={{ fontSize: 13, color: '#595959' }}>SRv6 SID 前缀</span>}
                rules={[
                  { required: true, message: '请输入 SID 前缀' },
                  {
                    validator: async (_, value) => {
                      const v = String(value || '').trim();
                      if (!v) return Promise.resolve();
                      if (v.includes('/')) return Promise.reject(new Error('请输入不带掩码的 IPv6 地址（不能包含/）'));
                      const re = /^(([0-9A-Fa-f]{1,4}:){7}[0-9A-Fa-f]{1,4}|([0-9A-Fa-f]{1,4}:){1,7}:|([0-9A-Fa-f]{1,4}:){1,6}:[0-9A-Fa-f]{1,4}|([0-9A-Fa-f]{1,4}:){1,5}(:[0-9A-Fa-f]{1,4}){1,2}|([0-9A-Fa-f]{1,4}:){1,4}(:[0-9A-Fa-f]{1,4}){1,3}|([0-9A-Fa-f]{1,4}:){1,3}(:[0-9A-Fa-f]{1,4}){1,4}|([0-9A-Fa-f]{1,4}:){1,2}(:[0-9A-Fa-f]{1,4}){1,5}|[0-9A-Fa-f]{1,4}:(:[0-9A-Fa-f]{1,4}){1,6}|:((:[0-9A-Fa-f]{1,4}){1,7}|:))$/;
                      if (re.test(v)) return Promise.resolve();
                      return Promise.reject(new Error('请输入合法的 IPv6 地址（例如：2400:1234::1），不包含掩码'));
                    }
                  }
                ]}
              >
                <Input placeholder="例如：2400:1234::1（不能包含/掩码）" />
              </Form.Item>

              {/* 标题2：设定公网口 */}
              <div style={{ fontSize: 13, color: '#1677ff', margin: '4px 0 12px 0', borderBottom: '1px solid #e8e8e8', paddingBottom: 6 }}>设定公网口</div>
              <Form.Item name="wanDev" label={<span style={{ fontSize: 13, color: '#595959' }}>公网口设备</span>} rules={[{ required: true, message: '请选择公网口设备' }]}> 
                <Select
                  placeholder="请选择网卡"
                  showSearch
                  loading={ifaceLoading}
                  options={ifaceOptions.map(n => ({ label: n, value: n }))}
                  filterOption={(input: string, option?: { label?: string; value?: string }) => ((option?.label || '').toLowerCase().includes(input.toLowerCase()))}
                  onChange={() => {
                    // 选择公网口设备后，立即刷新右侧配置预览，确保顶层 ipv4_route 同步展示
                    commitPreview();
                  }}
                />
              </Form.Item>
              <Form.Item
                name="wanIpv4"
                label={<span style={{ fontSize: 13, color: '#595959' }}>公网口 IPv4 地址</span>}
                rules={[{ pattern: /^(?:(?:[0-9]|[1-9][0-9]|1[0-9]{2}|2[0-4][0-9]|25[0-5])\.){3}(?:[0-9]|[1-9][0-9]|1[0-9]{2}|2[0-4][0-9]|25[0-5])\/([1-9]|[1-2]\d|3[0-2])$/, message: '请输入合法的 IPv4 CIDR（例如：200.1.1.2/24）' }]}
              >
                <Input placeholder="例如：200.1.1.2/24（可选）" />
              </Form.Item>
              <Form.Item name="wanIpv6" label={<span style={{ fontSize: 13, color: '#595959' }}>公网口 IPv6 地址</span>}>
                <Input placeholder="例如：2408:3333:1002::1/64（可选）" />
              </Form.Item>

              {/* 标题3：设定静态路由 */}
              <div style={{ height: 12 }} />
              <div style={{ fontSize: 13, color: '#1677ff', margin: '4px 0 12px 0', borderBottom: '1px solid #e8e8e8', paddingBottom: 6 }}>设定静态路由</div>
              <Form.Item
                name="wanRouteDest"
                label={<span style={{ fontSize: 13, color: '#595959' }}>默认路由目的</span>}
                rules={[{ pattern: /^(?:(?:[0-9]|[1-9][0-9]|1[0-9]{2}|2[0-4][0-9]|25[0-5])\.){3}(?:[0-9]|[1-9][0-9]|1[0-9]{2}|2[0-4][0-9]|25[0-5])\/([0-9]|[1-2]\d|3[0-2])$/, message: '请输入合法的 IPv4 CIDR（例如：0.0.0.0/0 或 200.1.1.2/24）' }]}
              >
                <Input placeholder="例如：0.0.0.0/0" />
              </Form.Item>
              <Form.Item name="wanRoutePriority" label={<span style={{ fontSize: 13, color: '#595959' }}>路由优先级</span>}> 
                <InputNumber style={{ width: '100%' }} placeholder="例如：100" min={1} />
              </Form.Item>
              <Form.Item name="ipv6Dest" label={<span style={{ fontSize: 13, color: '#595959' }}>IPv6 静态路由目的</span>}> 
                <Input placeholder="例如：0::0/0" />
              </Form.Item>
              <Form.Item name="ipv6Via" label={<span style={{ fontSize: 13, color: '#595959' }}>IPv6 静态路由 next-hop</span>}> 
                <Input placeholder="例如：500::1" />
              </Form.Item>

          {/* 标题4：设定BGP路由 */}
          <div style={{ height: 12 }} />
          <div style={{ fontSize: 13, color: '#1677ff', margin: '4px 0 12px 0', borderBottom: '1px solid #e8e8e8', paddingBottom: 6 }}>设定BGP路由</div>
          <Form.Item name="bgpAsn" label={<span style={{ fontSize: 13, color: '#595959' }}>BGP ASN</span>} rules={[{ required: true, message: '请输入 BGP ASN' }]}> 
            <InputNumber style={{ width: '100%' }} placeholder="例如：65000" min={1} />
          </Form.Item>
          <Form.Item name="bgpRouterId" label={<span style={{ fontSize: 13, color: '#595959' }}>BGP Router-ID</span>} rules={[{ required: true, message: '请输入 Router-ID' }, { pattern: /^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/, message: '请输入合法的 IPv4 地址' }]}> 
            <Input placeholder="例如：1.1.1.1" />
          </Form.Item>
          <Form.Item
            name="bgpNetworkIpv6"
            label={<span style={{ fontSize: 13, color: '#595959' }}>宣告的 IPv6 网段</span>}
          > 
            <Input placeholder="逗号分隔，例如：2408:3333:1002::/64" />
          </Form.Item>
          <Form.Item
            name="bgpNetworkIpv4"
            label={<span style={{ fontSize: 13, color: '#595959' }}>宣告的 IPv4 网段</span>}
            rules={[{
              validator: async (_, value) => {
                if (!value) return Promise.resolve();
                const arr = String(value).split(',').map((s) => s.trim()).filter(Boolean);
                const re = /^(?:(?:[0-9]|[1-9][0-9]|1[0-9]{2}|2[0-4][0-9]|25[0-5])\.){3}(?:[0-9]|[1-9][0-9]|1[0-9]{2}|2[0-4][0-9]|25[0-5])\/([0-9]|[1-2]\d|3[0-2])$/;
                const invalid = arr.find((s) => !re.test(s));
                if (invalid) return Promise.reject(new Error(`非法 IPv4 CIDR：${invalid}`));
                return Promise.resolve();
              }
            }]}
          > 
            <Input placeholder="逗号分隔，例如：200.1.1.0/24, 200.1.2.0/24" />
          </Form.Item>
            </>
          )}
          {role === 'CE' && (<>
              {/* CE 第2步：设定外网口（无 SRv6 字段） */}
              <div style={{ fontSize: 13, color: '#1677ff', margin: '4px 0 12px 0', borderBottom: '1px solid #e8e8e8', paddingBottom: 6 }}>设定外网口</div>
              <Form.Item name="wanDev" label={<span style={{ fontSize: 13, color: '#595959' }}>外网口设备</span>} rules={[{ required: true, message: '请选择外网口设备' }]}> 
                <Select
                  placeholder="请选择网卡"
                  showSearch
                  loading={ifaceLoading}
                  options={ifaceOptions.map(n => ({ label: n, value: n }))}
                  filterOption={(input: string, option?: { label?: string; value?: string }) => ((option?.label || '').toLowerCase().includes(input.toLowerCase()))}
                  onChange={() => {
                    // 选择外网口设备后，立即刷新右侧配置预览
                    commitPreview();
                  }}
                />
              </Form.Item>
              <Form.Item
                name="wanIpv4"
                label={<span style={{ fontSize: 13, color: '#595959' }}>外网口 IPv4 地址</span>}
                rules={[{ pattern: /^(?:(?:[0-9]|[1-9][0-9]|1[0-9]{2}|2[0-4][0-9]|25[0-5])\.){3}(?:[0-9]|[1-9][0-9]|1[0-9]{2}|2[0-4][0-9]|25[0-5])\/([1-9]|[1-2]\d|3[0-2])$/, message: '请输入合法的 IPv4 CIDR（例如：200.1.1.2/24）' }]}
              >
                <Input placeholder="例如：200.1.1.2/24（可选）" />
              </Form.Item>
              <Form.Item name="wanIpv6" label={<span style={{ fontSize: 13, color: '#595959' }}>外网口 IPv6 地址</span>} rules={[{ required: true, message: '请输入外网口 IPv6 地址/掩码' }]}> 
                <Input placeholder="例如：2408:3333:1002::1/64（必填）" />
              </Form.Item>
              {/* CE 第2步：设定BGP路由(CE to PE) */}
              <div style={{ height: 12 }} />
              <div style={{ fontSize: 13, color: '#1677ff', margin: '4px 0 12px 0', borderBottom: '1px solid #e8e8e8', paddingBottom: 6 }}>设定BGP路由(CE to PE)</div>
          <Form.Item name="bgpAsn" label={<span style={{ fontSize: 13, color: '#595959' }}>BGP ASN</span>} rules={[{ required: true, message: '请输入 BGP ASN' }]}> 
            <InputNumber style={{ width: '100%' }} placeholder="例如：100" min={1} />
          </Form.Item>
              <Form.Item name="bgpRouterId" label={<span style={{ fontSize: 13, color: '#595959' }}>BGP Router-ID</span>} rules={[{ required: true, message: '请输入 Router-ID' }, { pattern: /^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/, message: '请输入合法的 IPv4 地址' }]}> 
                <Input placeholder="例如：200.1.1.2" />
              </Form.Item>
              <Form.Item style={{ display: 'none' }} name="bgpNetworkIpv6" label={<span style={{ fontSize: 13, color: '#595959' }}>宣告的 IPv6 网段</span>}> 
                {/* 根据 PRD：移除宣告 IPv6 网段输入框 */}
              </Form.Item>
              <Form.Item style={{ display: 'none' }}
                name="bgpNetworkIpv4"
                label={<span style={{ fontSize: 13, color: '#595959' }}>宣告的 IPv4 网段</span>}
                rules={[{
                  validator: async (_, value) => {
                    if (!value) return Promise.resolve();
                    const arr = String(value).split(',').map((s) => s.trim()).filter(Boolean);
                    const re = /^(?:(?:[0-9]|[1-9][0-9]|1[0-9]{2}|2[0-4][0-9]|25[0-5])\.){3}(?:[0-9]|[1-9][0-9]|1[0-9]{2}|2[0-4][0-9]|25[0-5])\/([1-9]|[1-2]\d|3[0-2])$/;
                    if (arr.every((s) => re.test(s))) return Promise.resolve();
                    return Promise.reject(new Error('请输入合法的 IPv4 CIDR，逗号分隔，例如：10.10.10.0/24, 10.10.20.0/24'));
                  }
                }]}
              >
                {/* 根据 PRD：移除宣告 IPv4 网段输入框 */}
              </Form.Item>
              {/* 根据 PRD：CE 第2步不配置 IPv4 宣告网段 */}
          </>)}
        </Form>
      );
    }
    if (current === 2 && role === 'PE') {
      return (
          <Form
            layout="vertical"
            form={form}
            onKeyDown={handleFormKeyDown}
            onBlur={handleFormBlur}
            // 满足 Step 3 的输入完成后更新预览要求：不使用 onValuesChange 实时更新
          >
          <Form.List name="lanConfigs" initialValue={[{}]}> 
            {(fields, { add, remove }) => {
              const items = fields.map((field, idx) => ({
                key: String(field.name),
                label: `内网配置组 #${idx + 1}`,
                children: (
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                      {fields.length > 1 && (
                        <a
                          onClick={() => {
                            const removeIdx = Number(field.name);
                            const currentIdx = activeLanTabKey != null ? Number(activeLanTabKey) : 0;
                            // 先移除，再设置新的激活页签索引
                            remove(field.name);
                            // 如果当前激活的是被删除的页签，则回到前一个；
                            // 如果当前激活索引在删除索引之后，则索引左移 1；
                            // 否则保持不变。
                            let nextIdx = currentIdx;
                            if (currentIdx === removeIdx) {
                              nextIdx = Math.max(0, currentIdx - 1);
                            } else if (currentIdx > removeIdx) {
                              nextIdx = currentIdx - 1;
                            }
                            setActiveLanTabKey(String(nextIdx));
                          }}
                          style={{ color: '#ff4d4f' }}
                        >
                          删除此组
                        </a>
                      )}
                    </div>
                    {/* VRF */}
                    <Form.Item {...field} name={[field.name, 'vrf']} label={<span style={{ fontSize: 13, color: '#595959' }}>网络切片（VRF ID）</span>} rules={[{ required: true, message: '请输入 VRF ID' }]}> 
                      <InputNumber style={{ width: '100%' }} placeholder={"例如：9999"} min={1} />
                    </Form.Item>
                    {/* 接口 */}
                    <Form.Item {...field} name={[field.name, 'ifName']} label={<span style={{ fontSize: 13, color: '#595959' }}>接口名称</span>} rules={[{ required: true, message: '请选择接口名称' }]}> 
                      <Select
                        placeholder="请选择网卡"
                        showSearch
                        loading={ifaceLoading}
                        options={ifaceOptions.map(n => ({ label: n, value: n }))}
                        filterOption={(input: string, option?: { label?: string; value?: string }) => ((option?.label || '').toLowerCase().includes(input.toLowerCase()))}
                      />
                    </Form.Item>
                    <Form.Item
                      {...field}
                      name={[field.name, 'ipv4']}
                      label={<span style={{ fontSize: 13, color: '#595959' }}>IPv4 地址/掩码</span>}
                      rules={[{ pattern: /^(?:(?:[0-9]|[1-9][0-9]|1[0-9]{2}|2[0-4][0-9]|25[0-5])\.){3}(?:[0-9]|[1-9][0-9]|1[0-9]{2}|2[0-4][0-9]|25[0-5])\/([1-9]|[1-2]\d|3[0-2])$/, message: '请输入合法的 IPv4 CIDR（例如：130.1.1.1/24）' }]}
                    >
                      <Input placeholder="例如：130.1.1.1/24（可选）" />
                    </Form.Item>
                    <Form.Item {...field} name={[field.name, 'ipv6']} label={<span style={{ fontSize: 13, color: '#595959' }}>IPv6 地址/掩码</span>} rules={[{ required: true, message: '请输入 IPv6 地址/掩码' }]}> 
                      <Input placeholder="例如：2408:3333:1002::1/64" />
                    </Form.Item>
                    {/* BGP（到 CE 的私网） */}
                    <div style={{ height: 12 }} />
                    <div style={{ fontSize: 13, color: '#1677ff', margin: '4px 0 12px 0', borderBottom: '1px solid #e8e8e8', paddingBottom: 6 }}>设定BGP路由</div>
                    <Form.Item {...field} name={[field.name, 'asn']} label={<span style={{ fontSize: 13, color: '#595959' }}>BGP ASN</span>} rules={[{ required: true, message: '请输入 BGP ASN' }]}> 
                      <InputNumber style={{ width: '100%' }} placeholder="例如：100" min={1} />
                    </Form.Item>
                    <Form.Item {...field} name={[field.name, 'routerId']} label={<span style={{ fontSize: 13, color: '#595959' }}>BGP Router-ID</span>} rules={[{ required: true, message: '请输入 BGP Router-ID' }, { pattern: /^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/, message: '请输入合法的 IPv4 地址' }]}> 
                      <Input placeholder="例如：130.1.1.1" />
                    </Form.Item>
                  </div>
                )
              }));
              return (
                <>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ fontSize: 13, color: '#1677ff', margin: '4px 0 12px 0', borderBottom: '1px solid #e8e8e8', paddingBottom: 6 }}>内网配置（PE to CE）</div>
                    <a
                      onClick={() => {
                        // 新增后将激活页签切换到最新一组
                        add({});
                        setActiveLanTabKey(String(fields.length));
                      }}
                    >
                      + 添加一组内网配置
                    </a>
                  </div>
                  <Tabs
                    type="card"
                    items={items}
                    tabBarGutter={8}
                    size="small"
                    activeKey={activeLanTabKey ?? (items.length ? String(0) : undefined)}
                    onChange={(key) => setActiveLanTabKey(String(key))}
                  />
                </>
              );
            }}
          </Form.List>
          {/* RD/RT 暂不在此阶段配置，后续在 SRv6 阶段处理 */}
        </Form>
      );
    }
    if (current === 2 && role === 'CE') {
      return (
          <Form
            layout="vertical"
            form={form}
            onKeyDown={handleFormKeyDown}
            onBlur={handleFormBlur}
            // 满足 Step 3（CE）的输入完成后更新预览要求：不使用 onValuesChange 实时更新
          >
          {/* 仅保留 标题：设定内网口 */}
          <div style={{ fontSize: 13, color: '#1677ff', margin: '4px 0 12px 0', borderBottom: '1px solid #e8e8e8', paddingBottom: 6 }}>设定内网口</div>
          <Form.Item name="ifName" label={<span style={{ fontSize: 13, color: '#595959' }}>接口名称</span>} rules={[{ required: true, message: '请选择接口名称' }]}> 
            <Select
              placeholder="请选择网卡"
              showSearch
              loading={ifaceLoading}
              options={ifaceOptions.map(n => ({ label: n, value: n }))}
              filterOption={(input: string, option?: { label?: string; value?: string }) => ((option?.label || '').toLowerCase().includes(input.toLowerCase()))}
            />
          </Form.Item>
          <Form.Item
            name="ifIpv4"
            label={<span style={{ fontSize: 13, color: '#595959' }}>IPv4 地址/掩码</span>}
            rules={[{ pattern: /^(?:(?:[0-9]|[1-9][0-9]|1[0-9]{2}|2[0-4][0-9]|25[0-5])\.){3}(?:[0-9]|[1-9][0-9]|1[0-9]{2}|2[0-4][0-9]|25[0-5])\/([1-9]|[1-2]\d|3[0-2])$/, message: '请输入合法的 IPv4 CIDR（例如：130.1.1.1/24）' }]}
          >
            <Input placeholder="例如：130.1.1.1/24（可选）" />
          </Form.Item>
          <Form.Item name="ifIpv6" label={<span style={{ fontSize: 13, color: '#595959' }}>IPv6 地址/掩码</span>} rules={[{ required: true, message: '请输入 IPv6 地址/掩码' }]}> 
            <Input placeholder="例如：2408:3333:1002::1/64（必填）" />
          </Form.Item>
        </Form>
      );
    }
    return (
      <div>
        {/* 总览基础信息（统一样式） */}
        <div style={{ fontSize: 13, color: '#1677ff', margin: '4px 0 12px 0', borderBottom: '1px solid #e8e8e8', paddingBottom: 6 }}>基础信息</div>
        <Descriptions column={1} bordered size="small">
          <Descriptions.Item label="角色" labelStyle={{ width: 160 }} contentStyle={{ minWidth: 240 }}>{role || '未选择'}</Descriptions.Item>
          {role !== 'CE' && (
            <>
              <Descriptions.Item label="SRv6 Locator" labelStyle={{ width: 160 }} contentStyle={{ minWidth: 240 }}>{form.getFieldValue('locatorName') || '-'}</Descriptions.Item>
              <Descriptions.Item label="SRv6 SID 前缀" labelStyle={{ width: 160 }} contentStyle={{ minWidth: 240 }}>{form.getFieldValue('sidPrefix') || '-'}</Descriptions.Item>
            </>
          )}
        </Descriptions>

        <div style={{ height: 12 }} />

        {role === 'PE' && (
          <>
            {/* 公网配置分区（统一样式） */}
            <div style={{ fontSize: 13, color: '#1677ff', margin: '4px 0 12px 0', borderBottom: '1px solid #e8e8e8', paddingBottom: 6 }}>公网配置（PE to PE）</div>
            <Descriptions column={1} bordered size="small">
              <Descriptions.Item label="公网口设备" labelStyle={{ width: 160 }} contentStyle={{ minWidth: 240 }}>{form.getFieldValue('wanDev') || '-'}</Descriptions.Item>
            <Descriptions.Item label="默认路由目的" labelStyle={{ width: 160 }} contentStyle={{ minWidth: 240 }}>{form.getFieldValue('wanRouteDest') || '0.0.0.0/0'}</Descriptions.Item>
            <Descriptions.Item label="路由优先级" labelStyle={{ width: 160 }} contentStyle={{ minWidth: 240 }}>{form.getFieldValue('wanRoutePriority') ?? 100}</Descriptions.Item>
            <Descriptions.Item label="IPv6 静态路由目的" labelStyle={{ width: 160 }} contentStyle={{ minWidth: 240 }}>{form.getFieldValue('ipv6Dest') || '0::0/0'}</Descriptions.Item>
            <Descriptions.Item label="IPv6 静态路由 next-hop" labelStyle={{ width: 160 }} contentStyle={{ minWidth: 240 }}>{form.getFieldValue('ipv6Via') || '500::1'}</Descriptions.Item>
              <Descriptions.Item label="公网口 IPv4" labelStyle={{ width: 160 }} contentStyle={{ minWidth: 240 }}>{form.getFieldValue('wanIpv4') || '-'}</Descriptions.Item>
              <Descriptions.Item label="公网口 IPv6" labelStyle={{ width: 160 }} contentStyle={{ minWidth: 240 }}>{form.getFieldValue('wanIpv6') || '-'}</Descriptions.Item>
              <Descriptions.Item label="BGP ASN" labelStyle={{ width: 160 }} contentStyle={{ minWidth: 240 }}>{form.getFieldValue('bgpAsn') || '-'}</Descriptions.Item>
              <Descriptions.Item label="BGP Router-ID" labelStyle={{ width: 160 }} contentStyle={{ minWidth: 240 }}>{form.getFieldValue('bgpRouterId') || '-'}</Descriptions.Item>
              {/* 不再在第2步展示宣告网段 */}
            </Descriptions>

            <div style={{ height: 12 }} />

            {/* 内网配置分区（统一样式，多组摘要） */}
            <div style={{ fontSize: 13, color: '#1677ff', margin: '4px 0 12px 0', borderBottom: '1px solid #e8e8e8', paddingBottom: 6 }}>内网配置（PE to CE）</div>
            {(() => {
              const groups: any[] = form.getFieldValue('lanConfigs') || [];
              if (!Array.isArray(groups) || groups.length === 0) {
                return (
                  <Descriptions column={1} bordered size="small">
                    <Descriptions.Item label="业务 VRF" labelStyle={{ width: 160 }} contentStyle={{ minWidth: 240 }}>-</Descriptions.Item>
                    <Descriptions.Item label="接口名称" labelStyle={{ width: 160 }} contentStyle={{ minWidth: 240 }}>-</Descriptions.Item>
                    <Descriptions.Item label="IPv4 地址/掩码" labelStyle={{ width: 160 }} contentStyle={{ minWidth: 240 }}>-</Descriptions.Item>
                    <Descriptions.Item label="接口状态" labelStyle={{ width: 160 }} contentStyle={{ minWidth: 240 }}>up（默认启用）</Descriptions.Item>
                    <Descriptions.Item label="BGP ASN" labelStyle={{ width: 160 }} contentStyle={{ minWidth: 240 }}>-</Descriptions.Item>
                    <Descriptions.Item label="BGP Router-ID" labelStyle={{ width: 160 }} contentStyle={{ minWidth: 240 }}>-</Descriptions.Item>
                  </Descriptions>
                );
              }
              return (
                <div>
                  {groups.map((g: any, i: number) => (
                    <div key={i} style={{ marginBottom: 8 }}>
                      <div style={{ fontSize: 12, color: '#8c8c8c', margin: '6px 0' }}>内网配置组 #{i + 1}</div>
                      <Descriptions column={1} bordered size="small">
                        <Descriptions.Item label="业务 VRF" labelStyle={{ width: 160 }} contentStyle={{ minWidth: 240 }}>{g?.vrf ?? '-'}</Descriptions.Item>
                        <Descriptions.Item label="接口名称" labelStyle={{ width: 160 }} contentStyle={{ minWidth: 240 }}>{g?.ifName || '-'}</Descriptions.Item>
                        <Descriptions.Item label="IPv4 地址/掩码" labelStyle={{ width: 160 }} contentStyle={{ minWidth: 240 }}>{g?.ipv4 || '-'}</Descriptions.Item>
                        <Descriptions.Item label="接口状态" labelStyle={{ width: 160 }} contentStyle={{ minWidth: 240 }}>up（默认启用）</Descriptions.Item>
                        <Descriptions.Item label="BGP ASN" labelStyle={{ width: 160 }} contentStyle={{ minWidth: 240 }}>{g?.asn || '-'}</Descriptions.Item>
                        <Descriptions.Item label="BGP Router-ID" labelStyle={{ width: 160 }} contentStyle={{ minWidth: 240 }}>{g?.routerId || '-'}</Descriptions.Item>
                      </Descriptions>
                    </div>
                  ))}
                </div>
              );
            })()}
          </>
        )}

        {role === 'CE' && (
          <>
            {/* 外网配置分区（CE to PE，统一样式） */}
            <div style={{ fontSize: 13, color: '#1677ff', margin: '4px 0 12px 0', borderBottom: '1px solid #e8e8e8', paddingBottom: 6 }}>外网配置(CE to PE)</div>
            <Descriptions column={1} bordered size="small">
              <Descriptions.Item label="外网口设备" labelStyle={{ width: 160 }} contentStyle={{ minWidth: 240 }}>{form.getFieldValue('wanDev') || '-'}</Descriptions.Item>
              <Descriptions.Item label="外网口 IPv4" labelStyle={{ width: 160 }} contentStyle={{ minWidth: 240 }}>{form.getFieldValue('wanIpv4') || '-'}</Descriptions.Item>
              <Descriptions.Item label="外网口 IPv6" labelStyle={{ width: 160 }} contentStyle={{ minWidth: 240 }}>{form.getFieldValue('wanIpv6') || '-'}</Descriptions.Item>
              <Descriptions.Item label="BGP ASN" labelStyle={{ width: 160 }} contentStyle={{ minWidth: 240 }}>{form.getFieldValue('bgpAsn') || '-'}</Descriptions.Item>
              <Descriptions.Item label="BGP Router-ID" labelStyle={{ width: 160 }} contentStyle={{ minWidth: 240 }}>{form.getFieldValue('bgpRouterId') || '-'}</Descriptions.Item>
              {/* 根据 PRD：CE 第2步不展示宣告网段（IPv6/IPv4） */}
            </Descriptions>

            <div style={{ height: 12 }} />

            {/* 内网配置分区（CE to local，统一样式） */}
            <div style={{ fontSize: 13, color: '#1677ff', margin: '4px 0 12px 0', borderBottom: '1px solid #e8e8e8', paddingBottom: 6 }}>内网配置(CE to local)</div>
            <Descriptions column={1} bordered size="small">
              <Descriptions.Item label="接口名称" labelStyle={{ width: 160 }} contentStyle={{ minWidth: 240 }}>{form.getFieldValue('ifName') || '-'}</Descriptions.Item>
              <Descriptions.Item label="IPv4 地址/掩码" labelStyle={{ width: 160 }} contentStyle={{ minWidth: 240 }}>{form.getFieldValue('ifIpv4') || '-'}</Descriptions.Item>
              <Descriptions.Item label="接口状态" labelStyle={{ width: 160 }} contentStyle={{ minWidth: 240 }}>up（默认启用）</Descriptions.Item>
              {/* CE 不显示静态路由相关摘要 */}
            </Descriptions>
          </>
        )}
      </div>
    );
  };

  return (
    <PageContainer
      title={<span><UserOutlined style={{ marginRight: 6, color: '#1677ff' }} />设置角色向导</span>}
      titleLevel={3}
      subtitle="用于选择 VR 角色并分步配置公网/内网基础参数；支持参数校验、配置预览、保存版本与直接下发"
      icon={undefined}
      extra={<Space><Button icon={<ArrowLeftOutlined />} onClick={() => navigate(-1)}>返回</Button></Space>}
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
              current={current}
              onChange={(idx) => setCurrent(idx)}
              items={
                role === 'PE'
                  ? [
                      { title: '选择角色' },
                      { title: '公网配置（PE to PE）' },
                      { title: '内网配置（PE to CE）' },
                      { title: '确认保存' },
                    ]
                  : role === 'CE'
                  ? [
                      { title: '选择角色' },
                      { title: '外网配置(CE to PE)' },
                      { title: '内网配置(CE to local)' },
                      { title: '确认保存' },
                    ]
                  : [
                    { title: '选择角色' },
                    { title: '基础参数' },
                    { title: '确认保存' },
                  ]
              }
            />
          </Card>
        </Col>
        <Col span={12}>
          <Card size="small" title={<span style={{ fontSize: 13, color: '#000', fontWeight: 400 }}>{`第 ${current + 1} 步：${stepTitle}`}</span>} variant="outlined">
            <CoreContent />
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 16 }}>
              <Space>
                <Button onClick={() => navigate('/admin/interconnect/vr')}>返回列表</Button>
                {current > 0 && <Button onClick={prev}>上一步</Button>}
              </Space>
              <Space>
                {current < ((role === 'PE' || role === 'CE') ? 3 : 2) && <Button type="primary" onClick={next}>下一步</Button>}
                {current === ((role === 'PE' || role === 'CE') ? 3 : 2) && (
                  <>
                    <Button type="primary" loading={loading} onClick={handleSave}>保存配置版本</Button>
                    <Button danger loading={loading} onClick={handleDispatch}>配置下发</Button>
                  </>
                )}
              </Space>
            </div>
          </Card>
        </Col>
        <Col span={7}>
          <Card
            size="small"
            title={<span style={{ fontSize: 13, color: '#000', fontWeight: 400 }}>配置 JSON预览</span>}
            variant="outlined"
            style={{ position: 'sticky', top: 16 }}
          >
            <pre style={{ fontSize: 12, lineHeight: '18px', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
              {JSON.stringify(uuid ? { uuid, ...configPreview } : configPreview, null, 2)}
            </pre>
          </Card>
          {signInfo && (
            <Card
              size="small"
              title={<span style={{ fontSize: 13, color: '#000', fontWeight: 400 }}>签名信息（调试）</span>}
              variant="outlined"
              style={{ marginTop: 12, position: 'sticky', top: 16 }}
            >
              <div style={{ fontSize: 12, wordBreak: 'break-all' }}>
                <div><b>Authorization:</b> {String(signInfo.Authorization || '')}</div>
                <div><b>tonce:</b> {String(signInfo.tonce || '')}</div>
                <div style={{ marginTop: 6 }}><b>sign URL:</b> {String(signInfo.lastSignUrl || '')}</div>
              </div>
            </Card>
          )}
        </Col>
      </Row>
    </PageContainer>
  );
};

export default RoleWizard;
