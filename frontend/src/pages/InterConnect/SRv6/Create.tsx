import React, { useEffect, useMemo, useState, useTransition, useDeferredValue } from 'react';
import { Button, Card, Descriptions, Form, Input, Radio, Select, Space, Steps, message, Row, Col, Modal, Tabs, Table } from 'antd';
import { ArrowLeftOutlined, ExportOutlined } from '@ant-design/icons';
import { useNavigate, useLocation } from 'react-router-dom';
import PageContainer from '../../../components/PageContainer';
import { vrApi } from '../../../services/vrApi';
import { getVRRoles, saveVRConfig, getVRConfig } from '../../../services/vrConfigApi';
import { getVR2Config } from '../../../services/vr2Api';
import { API_BASE_URL } from '../../../services/api';

// 安全 JSON 解析：字符串尝试解析为对象，失败则原样返回
const safeJsonParse = (text: string): any => {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
};

// 安全序列化：兼容 BigInt / 不可序列化对象，避免 JSON 预览报错
const safeStringify = (obj: any): string => {
  try {
    return JSON.stringify(obj, (k, v) => (typeof v === 'bigint' ? String(v) : v), 2);
  } catch {
    try {
      const cloned = JSON.parse(JSON.stringify(obj || {}));
      return JSON.stringify(cloned, null, 2);
    } catch {
      return String(obj);
    }
  }
};

const SRv6CreatePage: React.FC = () => {
  const navigate = useNavigate();
  const [form] = Form.useForm();
  const [peConfigModalOpen, setPeConfigModalOpen] = useState(false);
  const [peConfigTarget, setPeConfigTarget] = useState<'peA' | 'peB' | null>(null);
  const [peConfigForm] = Form.useForm();

  // 向导状态
  const [current, setCurrent] = useState<number>(0);
  const [mode, setMode] = useState<'标准' | '高可用' | undefined>('标准');
  const [formValues, setFormValues] = useState<any>({});
  const [isPending, startTransition] = useTransition();
  const [peConfigs, setPeConfigs] = useState<{ peA?: any; peB?: any }>({});
  const [ceConfigs, setCeConfigs] = useState<{ ceA?: any; ceB?: any }>({});

  // 编辑模式：根据 query 参数回显隧道数据
  const location = useLocation();
  const editId = useMemo(() => {
    try {
      const qs = new URLSearchParams(location.search || '');
      return qs.get('editId') || undefined;
    } catch {
      return undefined;
    }
  }, [location.search]);

  useEffect(() => {
    const prefill = async () => {
      if (!editId) return;
      try {
        const { fetchSrv6Tunnel } = await import('../../../services/api');
        const item = await fetchSrv6Tunnel(editId);
        if (item && item.id) {
          form.setFieldsValue({
            tunnelName: item.name,
            peA: item.peA,
            peB: item.peB,
            ceA: item.ceA,
            ceB: item.ceB,
          });
          setFormValues({
            tunnelName: item.name,
            peA: item.peA,
            peB: item.peB,
            ceA: item.ceA,
            ceB: item.ceB,
          });
          // 编辑模式：加载各端已有配置，便于拼装下发 JSON
          if (item.peA) await fetchAndSetPeConfig('peA', item.peA);
          if (item.peB) await fetchAndSetPeConfig('peB', item.peB);
          if (item.ceA) await fetchAndSetCeConfig('ceA', item.ceA);
          if (item.ceB) await fetchAndSetCeConfig('ceB', item.ceB);
        }
      } catch (e) {
        console.warn('编辑模式回显失败:', e);
      }
    };
    prefill();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editId]);

  // 工具：去除 CIDR 前缀
  const trimPrefix = (v?: string): string | undefined => {
    if (!v) return undefined;
    const s = String(v);
    return s.includes('/') ? s.split('/')[0] : s;
  };

  // 提取指定端口索引的 IPv6（含掩码），若存在 CIDR 则原样返回
  const extractPortIpv6Cidr = (cfg: any, portIndex: number): string | undefined => {
    if (!cfg || typeof cfg !== 'object') return undefined;
    const keys = Object.keys(cfg);
    for (const k of keys) {
      if (k.startsWith('interfaces_') || k.startsWith('subinterfaces_')) {
        const arr = (cfg as any)[k];
        if (Array.isArray(arr) && arr[portIndex]) {
          const v = arr[portIndex]?.ipv6_static || arr[portIndex]?.ipv6;
          if (v) return String(v);
        }
      }
    }
    // 兜底：第一个可用 IPv6
    for (const k of keys) {
      if (k.startsWith('interfaces_') || k.startsWith('subinterfaces_')) {
        const arr = (cfg as any)[k];
        if (Array.isArray(arr)) {
          for (const it of arr) {
            const v = it?.ipv6_static || it?.ipv6;
            if (v) return String(v);
          }
        }
      }
    }
    return undefined;
  };

  // 根据 IPv6 CIDR 推导网络前缀（简化：将主机位归零）。例如："500::1/64" -> "500::0/64"
  const getIpv6NetworkFromCidr = (cidr?: string): string | undefined => {
    if (!cidr) return undefined;
    const s = String(cidr).trim();
    const [addr, mask] = s.split('/');
    if (!addr) return undefined;
    const m = mask && /^\d{1,3}$/.test(mask) ? mask : '64';
    // 简化归零策略：若包含"::"，则将最后的"::"后的内容归零；否则在末尾追加"::0"
    let network = addr;
    if (addr.includes('::')) {
      // 保留到"::"，去掉后续主机位，补"0"
      const idx = addr.indexOf('::');
      network = addr.substring(0, idx + 2) + '0';
    } else {
      // 无缩写时，直接在末尾追加"::0"
      network = addr + '::0';
    }
    return `${network}/${m}`;
  };

  // 提取指定端口索引的 IPv6（0=第一个网口/公网；1=第二个网口/内网），尽力解析
  const extractPortIpv6 = (cfg: any, portIndex: number): string | undefined => {
    if (!cfg || typeof cfg !== 'object') return undefined;
    const keys = Object.keys(cfg);
    for (const k of keys) {
      if (k.startsWith('interfaces_') || k.startsWith('subinterfaces_')) {
        const arr = (cfg as any)[k];
        if (Array.isArray(arr) && arr[portIndex]) {
          const v = arr[portIndex]?.ipv6_static || arr[portIndex]?.ipv6;
          const ip = trimPrefix(v);
          if (ip) return ip;
        }
      }
    }
    // 兜底：若无法按索引解析，第一个端口用任何可用 IPv6，第二个端口尝试取“第二个可用项”
    const candidates: string[] = [];
    for (const k of keys) {
      if (k.startsWith('interfaces_') || k.startsWith('subinterfaces_')) {
        const arr = (cfg as any)[k];
        if (Array.isArray(arr)) {
          for (const it of arr) {
            const v = it?.ipv6_static || it?.ipv6;
            const ip = trimPrefix(v);
            if (ip) candidates.push(ip);
          }
        }
      }
    }
    if (portIndex === 0) return candidates[0] || trimPrefix((cfg as any)?.ipv6_static || (cfg as any)?.ipv6);
    if (portIndex === 1) return candidates[1] || candidates[0] || undefined;
    return undefined;
  };

  // 提取 BGP ASN：优先第 idx 个结构体，其次第 0 个
  const extractBgpAsnAt = (cfg: any, idx: number): number | undefined => {
    if (!cfg || typeof cfg !== 'object') return undefined;
    const arr = (cfg as any)?.bgp;
    let asn: any = Array.isArray(arr) ? arr[idx]?.asn : undefined;
    if (asn === undefined && Array.isArray(arr)) asn = arr[0]?.asn;
    return typeof asn === 'number' ? asn : (asn ? Number(asn) : undefined);
  };

  // 根据接口名称提取 IPv6（支持 static 或动态字段）
  const extractInterfaceIpv6 = (cfg: any, ifName?: string): string | undefined => {
    if (!cfg || typeof cfg !== 'object' || !ifName) return undefined;
    const keys = Object.keys(cfg);
    for (const k of keys) {
      if (k.startsWith('interfaces_') || k.startsWith('subinterfaces_')) {
        const arr = (cfg as any)[k];
        if (Array.isArray(arr)) {
          for (const it of arr) {
            const name = String(it?.name || '');
            if (name === ifName) {
              const v = it?.ipv6_static || it?.ipv6;
              const ip = trimPrefix(v);
              if (ip) return ip;
            }
          }
        }
      }
    }
    return undefined;
  };

  // 根据接口名称提取 VRF（仅当接口对象显式包含 vrf 时返回）
  const extractInterfaceVrf = (cfg: any, ifName?: string): string | number | undefined => {
    if (!cfg || typeof cfg !== 'object' || !ifName) return undefined;
    const keys = Object.keys(cfg);
    for (const k of keys) {
      if (k.startsWith('interfaces_') || k.startsWith('subinterfaces_')) {
        const arr = (cfg as any)[k];
        if (Array.isArray(arr)) {
          for (const it of arr) {
            const name = String(it?.name || '');
            if (name === ifName) {
              const vrf = (it as any)?.vrf;
              if (vrf !== undefined && vrf !== null && String(vrf) !== '') return vrf;
            }
          }
        }
      }
    }
    return undefined;
  };

  // 列出接口选项（用于“选择PE内网口”）。优先展示带 VRF 的接口，自动排除明显的公网口；若无 VRF，则以 IPv6 兜底显示
  const listInterfaceOptions = (cfg: any): { value: string; label: string }[] => {
    if (!cfg || typeof cfg !== 'object') return [];
    const keys = Object.keys(cfg);
    const items: { name: string; vrf?: any; ipv6?: string }[] = [];
    for (const k of keys) {
      if (k.startsWith('interfaces_') || k.startsWith('subinterfaces_')) {
        const arr = (cfg as any)[k];
        if (Array.isArray(arr)) {
          for (const it of arr) {
            const name = String(it?.name || '');
            if (!name) continue;
            const vrf = (it as any)?.vrf;
            const ip = trimPrefix((it as any)?.ipv6_static || (it as any)?.ipv6);
            items.push({ name, vrf, ipv6: ip });
          }
        }
      }
    }
    // 排除公网口：若接口 IPv6 与“第一个端口的 IPv6”一致则排除；若无法判定，则不排除
    const publicIp = extractPortIpv6(cfg, 0);
    const excludePublic = (x: { ipv6?: string }) => (publicIp ? x.ipv6 !== publicIp : true);
    // 重要调整：带 VRF 的接口不再因为“IPv6 等于第一个端口”而被排除，避免误判导致选项消失
    const withVrf = items.filter((it) => it.vrf !== undefined && it.vrf !== null && String(it.vrf) !== '');
    // 若设备未在接口上标注 VRF，则兜底：展示所有具备 IPv6 的接口，辅助显示 IPv6，方便用户人工选择
    const fallback = withVrf.length > 0 ? [] : items.filter(excludePublic).filter((it) => !!it.ipv6);
    const finalItems = withVrf.length > 0 ? withVrf : fallback;
    // 以接口名去重，保留其 VRF/IPv6 显示在标签中，便于用户识别“属于哪个内网配置组、VRF是多少”
    const nameToMeta: Record<string, { vrf?: any; ipv6?: string }> = {};
    finalItems.forEach((x) => { if (!(x.name in nameToMeta)) nameToMeta[x.name] = { vrf: x.vrf, ipv6: x.ipv6 }; });
    return Object.keys(nameToMeta).map((n) => ({ value: n, label: n }));
  };

  // PE+PE 模式：为 PE JSON 的第一个 ASN 结构体（公网自治域）追加对端 PE 的 neighbor 与关闭直连检查
  const injectNeighborsForPEPeer = (selfCfg: any, peerPeCfg: any): any => {
    try {
      const cloned = JSON.parse(JSON.stringify(selfCfg || {}));
      const peerPublicIp = extractPortIpv6(peerPeCfg, 0); // 对端 PE 的第一个网口（公网）IP
      const peerPublicIpCidr = extractPortIpv6Cidr(peerPeCfg, 0); // 含掩码的 IPv6
      const interconnectV6Net = getIpv6NetworkFromCidr(peerPublicIpCidr); // 互联 IPv6 网段（用于地址族 network）
      const peerPublicAsn = extractBgpAsnAt(peerPeCfg, 0); // 对端 PE 的第一个 ASN（公网自治域）
      if (!peerPublicIp) return cloned;
      const bgpArr = Array.isArray((cloned as any)?.bgp) ? (cloned as any).bgp : [];
      const bgp0 = bgpArr[0];
      if (!bgp0 || typeof bgp0 !== 'object') return cloned;
      // 1) neighbor_disable_connected_check 追加对端公网IP（若不存在则追加）
      const ndcc = Array.isArray(bgp0.neighbor_disable_connected_check) ? bgp0.neighbor_disable_connected_check : [];
      if (!ndcc.includes(peerPublicIp)) ndcc.push(peerPublicIp);
      bgp0.neighbor_disable_connected_check = ndcc;
      // 2) neighbor 追加 { remote_ip, remote_as } 到第一个 ASN 结构体
      const neighbors = Array.isArray(bgp0.neighbor) ? bgp0.neighbor : [];
      const exists = neighbors.some((n: any) => String(n?.remote_ip) === peerPublicIp);
      if (!exists) {
        neighbors.push({ remote_ip: peerPublicIp, remote_as: peerPublicAsn ?? 0 });
      }
      bgp0.neighbor = neighbors;

      // 3) 地址族信息（按 PRD）：在第一个 ASN 结构体中设定 IPv6(unicast) 与 IPv4(vpn)
      const afArr = Array.isArray(bgp0.address_family) ? bgp0.address_family : [];
      // IPv6 地址族：unicast + activate_address_family + network
      const afV6Idx = afArr.findIndex((af: any) => String(af?.address_family).toLowerCase() === 'ipv6');
      if (afV6Idx >= 0) {
        const af = afArr[afV6Idx];
        af.modifier = 'unicast';
        const act = Array.isArray(af.activate_address_family) ? af.activate_address_family : [];
        if (!act.includes(peerPublicIp)) act.push(peerPublicIp);
        af.activate_address_family = act;
        const nets = Array.isArray(af.network) ? af.network : [];
        if (interconnectV6Net && !nets.includes(interconnectV6Net)) nets.push(interconnectV6Net);
        af.network = nets;
        afArr[afV6Idx] = af;
      } else {
        afArr.push({
          address_family: 'ipv6',
          modifier: 'unicast',
          activate_address_family: peerPublicIp ? [peerPublicIp] : [],
          network: interconnectV6Net ? [interconnectV6Net] : [],
        });
      }
      // IPv4 地址族：vpn + activate_address_family（PRD 未要求 network）
      const afV4Idx = afArr.findIndex((af: any) => String(af?.address_family).toLowerCase() === 'ipv4');
      if (afV4Idx >= 0) {
        const af = afArr[afV4Idx];
        af.modifier = 'vpn';
        const act = Array.isArray(af.activate_address_family) ? af.activate_address_family : [];
        if (!act.includes(peerPublicIp)) act.push(peerPublicIp);
        af.activate_address_family = act;
        afArr[afV4Idx] = af;
      } else {
        afArr.push({
          address_family: 'ipv4',
          modifier: 'vpn',
          activate_address_family: peerPublicIp ? [peerPublicIp] : [],
        });
      }
      bgp0.address_family = afArr;
      return cloned;
    } catch (_) {
      return selfCfg;
    }
  };

  // PE+CE 模式：在 PE 的第二个 ASN 结构体（内网自治域）中追加本端 CE 的公网IP与其“内”ASN
  const injectNeighborsForPEToCE = (selfCfg: any, ceCfg: any, bgpVrf?: any): any => {
    try {
      const cloned = JSON.parse(JSON.stringify(selfCfg || {}));
      const cePublicIp = extractPortIpv6(ceCfg, 0); // CE 第一个网口（公网）IP
      const ceAsnInner = extractBgpAsnAt(ceCfg, 1); // CE 第二个结构体 ASN（内网ASN）
      if (!cePublicIp) return cloned;
      const bgpArr = Array.isArray((cloned as any)?.bgp) ? (cloned as any).bgp : [];
      // 优先按 VRF 定位；若未找到则回退到第二个结构体，不存在则回退到第一个
      const targetIdx = bgpVrf !== undefined ? findBgpIndexByVrf(cloned, bgpVrf) : undefined;
      const bgp = (targetIdx !== undefined ? bgpArr[targetIdx] : (bgpArr[1] || bgpArr[0]));
      if (!bgp || typeof bgp !== 'object') return cloned;
      const neighbors = Array.isArray(bgp.neighbor) ? bgp.neighbor : [];
      const exists = neighbors.some((n: any) => String(n?.remote_ip) === cePublicIp);
      if (!exists) {
        neighbors.push({ remote_ip: cePublicIp, remote_as: ceAsnInner ?? 0 });
      }
      bgp.neighbor = neighbors;
      return cloned;
    } catch (_) {
      return selfCfg;
    }
  };

  const injectConnectionsForCE = (selfCfg: any, peCfg: any): any => {
    try {
      const cloned = JSON.parse(JSON.stringify(selfCfg || {}));
      const peInnerIp = (peCfg as any)?._inner_ip_override || extractPortIpv6(peCfg, 1); // 优先使用选择的内网口 IP
      const peAsnInner = extractBgpAsnAt(peCfg, 1); // PE 第二个结构体 ASN
      if (!peInnerIp) return cloned;
      const bgpArr = Array.isArray((cloned as any)?.bgp) ? (cloned as any).bgp : [];
      const bgp0 = bgpArr[0]; // 明确仅在第一个结构体追加
      if (!bgp0 || typeof bgp0 !== 'object') return cloned;
      // a) 追加禁用直连检查列表
      const ndcc = Array.isArray(bgp0.neighbor_disable_connected_check) ? bgp0.neighbor_disable_connected_check : [];
      if (!ndcc.includes(peInnerIp)) ndcc.push(peInnerIp);
      bgp0.neighbor_disable_connected_check = ndcc;
      // b) 追加邻居列表
      const neighbors = Array.isArray(bgp0.neighbor) ? bgp0.neighbor : [];
      const exists = neighbors.some((n: any) => String(n?.remote_ip) === peInnerIp);
      if (!exists) {
        neighbors.push({ remote_ip: peInnerIp, remote_as: peAsnInner ?? 0 });
      }
      bgp0.neighbor = neighbors;
      return cloned;
    } catch (_) {
      return selfCfg;
    }
  };

  // 在指定 BGP 结构体中插入 RD/RT（若 address_family 不存在则创建首个对象）
  const injectRdRtAtBgpIndex = (cfg: any, bgpIndex: number, rd: string, rt: string): any => {
    try {
      const cloned = JSON.parse(JSON.stringify(cfg || {}));
      const bgpArr = Array.isArray((cloned as any)?.bgp) ? (cloned as any).bgp : [];
      const bgp = bgpArr[bgpIndex] || bgpArr[0];
      if (!bgp || typeof bgp !== 'object') return cloned;
      const afArr = Array.isArray(bgp.address_family) ? bgp.address_family : [];
      // 必须在已有的 address_family 结构内插入；若不存在则不创建
      if (!afArr.length) return cloned;
      bgp.address_family = afArr.map((af: any) => {
        // 规范化 activate_address_family：确保包含 ipv6
        const aaf = Array.isArray(af.activate_address_family) ? af.activate_address_family : [];
        const nextAaf = Array.from(new Set([...(aaf || []).filter(Boolean), 'ipv6']));
        return {
          ...af,
          modifier: af.modifier || 'unicast',
          activate_address_family: nextAaf,
          export_route: af.export_route || 'enable',
          import_route: af.import_route || 'enable',
          auto_assign_sid: af.auto_assign_sid || 'enable',
          route_distinguisher: rd,
          route_target: rt,
        };
      });
      return cloned;
    } catch (_) {
      return cfg;
    }
  };

  // 为 PE/CE 插入 RD/RT：PE 优先第二个结构体（内 ASN），CE 固定第一个结构体
  const injectRdRtForPE = (cfg: any, rd: string, rt: string): any => injectRdRtAtBgpIndex(cfg, 1, rd, rt);
  const injectRdRtForCE = (cfg: any, rd: string, rt: string): any => injectRdRtAtBgpIndex(cfg, 0, rd, rt);

  // 按 VRF 定位 BGP 结构体索引（完全匹配字符串值）
  const findBgpIndexByVrf = (cfg: any, targetVrf: any): number | undefined => {
    try {
      if (targetVrf === undefined || targetVrf === null || String(targetVrf) === '') return undefined;
      const bgpArr = Array.isArray((cfg as any)?.bgp) ? (cfg as any).bgp : [];
      const idx = bgpArr.findIndex((b: any) => String((b as any)?.vrf) === String(targetVrf));
      return idx >= 0 ? idx : undefined;
    } catch {
      return undefined;
    }
  };

  // 在按 VRF 定位到的 BGP 结构体中插入 RD/RT 与地址族路由信息
  const injectRdRtAtBgpVrf = (cfg: any, bgpVrf: any, rd: string, rt: string): any => {
    const idx = findBgpIndexByVrf(cfg, bgpVrf);
    if (idx === undefined) return cfg;
    return injectRdRtAtBgpIndex(cfg, idx, rd, rt);
  };

  // 在指定 BGP 结构体的 neighbor 中追加路由策略对象（包含 address_family、RD/RT、导入导出与自动分配SID）
  const injectNeighborRoutePolicyAtIndex = (cfg: any, bgpIndex: number, rd: string, rt: string): any => {
    try {
      const cloned = JSON.parse(JSON.stringify(cfg || {}));
      const bgpArr = Array.isArray((cloned as any)?.bgp) ? (cloned as any).bgp : [];
      const bgp = bgpArr[bgpIndex] || bgpArr[0];
      if (!bgp || typeof bgp !== 'object') return cloned;
      const neighbors = Array.isArray(bgp.neighbor) ? bgp.neighbor : [];
      // 优先合并已有的“带 address_family 标记”的策略项，避免重复
      const policyIdx = neighbors.findIndex((n: any) => n && typeof n === 'object' && 'address_family' in n);
      if (policyIdx >= 0) {
        const item = { ...(neighbors[policyIdx] || {}) };
        const afLabel = String(item.address_family || '').toLowerCase();
        item.address_family = afLabel || 'ipv4';
        item.modifier = 'unicast';
        item.route_distinguisher = rd;
        item.route_target = rt;
        item.export_route = 'enable';
        item.import_route = 'enable';
        item.auto_assign_sid = 'enable';
        neighbors[policyIdx] = item;
      } else {
        neighbors.push({
          address_family: 'ipv4',
          modifier: 'unicast',
          route_distinguisher: rd,
          route_target: rt,
          export_route: 'enable',
          import_route: 'enable',
          auto_assign_sid: 'enable',
        });
      }
      bgp.neighbor = neighbors;
      return cloned;
    } catch (_) {
      return cfg;
    }
  };

  // 预览前清理：移除非接口定义的 pe/ce 字段，保持与后端接口结构一致
  const sanitizePreview = (cfg: any): any => {
    try {
      const c = JSON.parse(JSON.stringify(cfg || {}));
      if (c && typeof c === 'object') {
        delete (c as any).pe;
        delete (c as any).ce;
      }
      return c;
    } catch {
      return cfg;
    }
  };

  // 从配置中提取 SRv6 prefix（若存在）
  const extractSrv6Prefix = (cfg: any): string | undefined => {
    try {
      const sr = (cfg && (cfg as any).segment_routing_srv6) || undefined;
      if (!sr) return undefined;
      const p = (sr as any).prefix;
      return typeof p === 'string' && p.trim().length > 0 ? p.trim() : undefined;
    } catch {
      return undefined;
    }
  };

  // 向顶层追加 IPv6 路由（destination/via），避免重复
  const injectIpv6RouteTop = (cfg: any, destination?: string, via?: string, vrf?: number | string): any => {
    if (!destination || !via) return cfg;
    try {
      const cloned = JSON.parse(JSON.stringify(cfg || {}));
      const arr = Array.isArray((cloned as any).ipv6_route) ? (cloned as any).ipv6_route : [];
      const exists = arr.some((r: any) => String(r?.destination) === String(destination) && String(r?.via) === String(via) && (vrf === undefined || String(r?.vrf) === String(vrf)));
      const route: any = { destination, via };
      if (vrf !== undefined) route.vrf = vrf;
      if (!exists) arr.push(route);
      (cloned as any).ipv6_route = arr;
      return cloned;
    } catch {
      return cfg;
    }
  };

  // —— 按专家模式“过滤后的 VR 配置 JSON（只读）”规范进行标准化 ——
  const unwrapData = (obj: any) => {
    let cur = obj;
    try {
      while (cur && typeof cur === 'object' && 'data' in cur) {
        cur = (cur as any).data;
      }
    } catch {}
    return cur;
  };
  const stripMeta = (obj: any) => {
    if (!obj || typeof obj !== 'object') return obj;
    const { msg, code, report_config_status, updateDate, createDate, _id, requestId, ...rest } = obj as any;
    return rest;
  };
  const expandForPreview = (cleaned: any) => {
    const e: any = { ...(cleaned ?? {}) };
    // 拆分统一 interfaces 到各接口键
    const ifaces: any[] = Array.isArray(e.interfaces) ? e.interfaces : [];
    if (ifaces.length > 0) {
      const buckets: Record<string, any[]> = {
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
      };
      ifaces.forEach((item: any) => {
        const name = String(item?.name || '');
        const typePart = name.split(' ')[0];
        const isSub = name.includes('.');
        const push = (key: string) => { (buckets as any)[key].push(item); };
        switch (typePart) {
          case 'BondEthernet': push(isSub ? 'subinterfaces_BondEthernet' : 'interfaces_BondEthernet'); break;
          case 'TapEthernet': push(isSub ? 'subinterfaces_TapEthernet' : 'interfaces_TapEthernet'); break;
          case 'memif': push(isSub ? 'subinterfaces_memif' : 'interfaces_memif'); break;
          case 'GigabitEthernet': push(isSub ? 'subinterfaces_GigabitEthernet' : 'interfaces_GigabitEthernet'); break;
          case 'lo': push('interfaces_lo'); break;
          case 'Tunnel': push(isSub ? 'subinterfaces_Tunnel' : 'interfaces_Tunnel'); break;
          default: break;
        }
      });
      Object.keys(buckets).forEach((k) => {
        if ((buckets as any)[k] && (buckets as any)[k].length > 0) {
          e[k] = (buckets as any)[k];
        }
      });
      delete e.interfaces;
    }
    // 路由拆分到 ipv4_route / ipv6_route
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
  };
  const normalizeVRConfigForPreview = (raw: any) => {
    const unwrapped = unwrapData(raw);
    const cleaned = stripMeta(unwrapped);
    return expandForPreview(cleaned);
  };

  // VR 列表与角色映射
  const [vrs, setVrs] = useState<any[]>([]);
  const [rolesMap, setRolesMap] = useState<Record<string, string>>({});
  const rolesMapRef = React.useRef<Record<string, string>>({});

  // 统一提取展示名称：兼容不同字段名（name/vrName/vr_name/instance_name/InstanceName/displayName/hostname/title/label）
  const getVRLabel = (r: any): string => {
    const uuid = r?.uuid;
    const candidates = [
      r?.name,
      r?.vrName,
      r?.vr_name,
      r?.instance_name,
      r?.InstanceName,
      r?.displayName,
      r?.hostname,
      r?.title,
      r?.label,
    ];
    const firstName = candidates.find((x) => typeof x === 'string' && x.trim().length > 0);
    return firstName || uuid || '';
  };

  const fetchVRsAndRoles = async (pageSize: number = 100, pageNum: number = 1) => {
    try {
      // 简化逻辑：直接走远端 VR1 列表，使用实例名称作为下拉显示
      let list: any[] = [];
      let rawRemote: any = null; // 用于在远端成功时自动入库缓存
      try {
        // 完全对齐“VR实例管理”页的认证与请求方式（手动签名 + fetch）
        const accesskey = 'Cloudmap%23123';
        const secretkey = 'Cloudmap%23123';
        const path = '/V2/ctcontrol/VR1/pagelist';
        const method = 'GET';
        const other = `page_size=${pageSize}&page_num=${pageNum}`;

        const authUrl = `/api-proxy/api/sign?` +
          `url=${encodeURIComponent(path)}&` +
          `method=${method}&` +
          `other=${encodeURIComponent(other)}&` +
          `accessKey=${accesskey}&` +
          `secretKey=${secretkey}`;

        const signResp = await fetch(authUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '' });
        const signJson = await signResp.json();
        const info = (signJson && (signJson as any).data) ? (signJson as any).data : signJson;
        if (!info || !info.Authorization || !info.tonce) {
          throw new Error('认证响应数据缺少 Authorization 或 tonce');
        }

        const listUrl = `/api-proxy${path}?${other}`;
        const res = await fetch(listUrl, {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
            // 与 VR 实例管理页保持一致：不加 Bearer，仅传 Authorization 与小写 tonce
            'Authorization': info.Authorization,
            'tonce': String(info.tonce)
          }
        });
        const remoteJson = await res.json().catch(async () => ({ raw: await res.text() }));
        rawRemote = remoteJson;
        const remoteData: any = (remoteJson && (remoteJson as any).data) ? (remoteJson as any).data : remoteJson;
        list = Array.isArray((remoteData as any)?.page)
          ? (remoteData as any).page
          : Array.isArray((remoteData as any)?.list)
          ? (remoteData as any).list
          : Array.isArray((remoteData as any)?.rows)
          ? (remoteData as any).rows
          : Array.isArray(remoteData)
          ? (remoteData as any[])
          : [];

        // 远端成功时，自动把原始响应写入后端缓存表 vr_list_cache，方便后续页面回退本地读取
        try {
          const upsertUrl = `${API_BASE_URL}/api/vr-cache/upsert`;
          await fetch(upsertUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ page_num: pageNum, page_size: pageSize, data: rawRemote })
          });
        } catch (cacheErr) {
          // 写缓存失败不阻断页面使用；仅输出调试日志
          console.warn('[VR_CACHE] 远端列表入库失败:', (cacheErr as any)?.message || cacheErr);
        }
      } catch (e) {
        console.error('获取远端 VR 列表失败：', e);
        // 二次回退：尝试使用 vrApi 服务方法（axios + 代理）
        try {
          const remoteResp: any = await vrApi.getVRInstances(pageSize, pageNum);
          const remoteData: any = remoteResp?.data ?? remoteResp;
          rawRemote = remoteResp;
          list = Array.isArray(remoteData?.page)
            ? remoteData.page
            : Array.isArray(remoteData?.list)
            ? remoteData.list
            : Array.isArray(remoteData?.rows)
            ? remoteData.rows
            : Array.isArray(remoteData)
            ? (remoteData as any[])
            : [];

          // 写入缓存
          try {
            const upsertUrl = `${API_BASE_URL}/api/vr-cache/upsert`;
            await fetch(upsertUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ page_num: pageNum, page_size: pageSize, data: rawRemote })
            });
          } catch (cacheErr) {
            console.warn('[VR_CACHE] 远端列表入库失败:', (cacheErr as any)?.message || cacheErr);
          }
        } catch (secondErr) {
          console.warn('二次远端尝试失败，回退读取本地缓存：', (secondErr as any)?.message || secondErr);
          // 远端失败时，尝试读取本地缓存以便“打印列表”可见
          try {
            const url = `${API_BASE_URL}/api/vr-cache/pagelist?page_num=${pageNum}&page_size=${pageSize}`;
            const resp = await fetch(url, { method: 'GET' });
            const json = await resp.json().catch(async () => ({ raw: await resp.text() }));
            const cacheData: any = (json && (json as any).data) ? (json as any).data : json;
            const cacheRaw = (cacheData && cacheData.data) ? cacheData.data : cacheData;
            const parsed = typeof cacheRaw === 'string' ? safeJsonParse(cacheRaw) : cacheRaw;
            const rows: any[] = Array.isArray(parsed?.page)
              ? parsed.page
              : Array.isArray(parsed?.list)
              ? parsed.list
              : Array.isArray(parsed?.rows)
              ? parsed.rows
              : Array.isArray(parsed)
              ? (parsed as any[])
              : [];
            list = rows;
          } catch (ee) {
            message.error('获取 VR 实例列表失败');
          }
        }
      }
      setVrs(list || []);

      // 角色映射严格以 uuid 为键，避免 id/vm_id 与 uuid 的混用导致过滤混乱
      const ids = list
        .map((r: any) => r.uuid)
        .filter(Boolean) as string[];
      try {
        const roles = await getVRRoles(ids);
        const map = roles || {};
        setRolesMap(map);
        rolesMapRef.current = map;
      } catch (e: any) {
        console.warn('获取角色映射失败:', e?.message || e);
        setRolesMap({});
        rolesMapRef.current = {};
      }
    } catch (error: any) {
      console.error('[SRV6_DEBUG_ERROR] 获取VR缓存列表失败:', error);
      message.error(`获取VR列表失败: ${error.message || '请稍后重试'}`);
      setVrs([]);
      setRolesMap({});
      rolesMapRef.current = {};
    }
  };

  useEffect(() => {
    fetchVRsAndRoles(100, 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const peOptions = useMemo(() => {
    const items = (vrs || []).map((r: any) => {
      const uuid = r?.uuid;
      const label = getVRLabel(r);
      const roleFromMap = uuid ? rolesMap[uuid] : undefined;
      const roleFromItem = String(r?.role || r?.vrRole || r?.vr_role || '').toUpperCase();
      const role = roleFromMap || (roleFromItem || undefined);
      return { uuid, label, role };
    });
    const filtered = items.filter((x) => !!x.uuid && x.role === 'PE');
    return filtered.map((x) => ({ value: x.uuid, label: x.label }));
  }, [vrs, rolesMap]);

  // 简易视图：将 VR 列表映射为表格行，显示名称/角色/UUID/状态
  const vrsView = useMemo(() => {
    return (vrs || []).map((r: any, idx: number) => {
      const uuid = r?.uuid;
      const name = getVRLabel(r);
      const roleFromMap = uuid ? rolesMap[uuid] : undefined;
      const roleFromItem = String(r?.role || r?.vrRole || r?.vr_role || '').toUpperCase();
      const role = roleFromMap || roleFromItem || '-';
      const status = r?.status || r?.Status || r?.state || '-';
      return { key: uuid || String(idx), name, role, uuid, status };
    });
  }, [vrs, rolesMap]);

  const ceOptions = useMemo(() => {
    const items = (vrs || []).map((r: any) => {
      const uuid = r?.uuid;
      const label = getVRLabel(r);
      const roleFromMap = uuid ? rolesMap[uuid] : undefined;
      const roleFromItem = String(r?.role || r?.vrRole || r?.vr_role || '').toUpperCase();
      const role = roleFromMap || (roleFromItem || undefined);
      return { uuid, label, role };
    });
    const filtered = items.filter((x) => !!x.uuid && x.role === 'CE');
    return filtered.map((x) => ({ value: x.uuid, label: x.label }));
  }, [vrs, rolesMap]);

  // 监听表单变更以加载 PE 配置（内置于组件作用域，便于访问状态）
  const fetchAndSetPeConfig = async (target: 'peA' | 'peB', uuid: string) => {
    if (!uuid) return;
    try {
      const cfgRaw = await getVR2Config(uuid);
      const cfg = normalizeVRConfigForPreview(cfgRaw);
      setPeConfigs((prev) => ({ ...prev, [target]: cfg }));
    } catch (e: any) {
      console.warn('获取PE配置失败(远端VR2):', e?.message || e);
      // 回退到平台本地保存的配置
      try {
        const localCfg = await getVRConfig(uuid);
        const norm = localCfg ? normalizeVRConfigForPreview(localCfg) : null;
        setPeConfigs((prev) => ({ ...prev, [target]: norm }));
      } catch (ee: any) {
        console.warn('获取PE配置失败(本地保存):', ee?.message || ee);
        setPeConfigs((prev) => ({ ...prev, [target]: null }));
      }
    }
  };

  // 加载 CE 配置（优先最新版本，其次当前配置）
  const fetchAndSetCeConfig = async (target: 'ceA' | 'ceB', uuid: string) => {
    if (!uuid) return;
    try {
      const cfgRaw = await getVR2Config(uuid);
      const cfg = normalizeVRConfigForPreview(cfgRaw);
      setCeConfigs((prev) => ({ ...prev, [target]: cfg }));
    } catch (e: any) {
      console.warn('获取CE配置失败(远端VR2):', e?.message || e);
      // 回退到平台本地保存的配置
      try {
        const localCfg = await getVRConfig(uuid);
        const norm = localCfg ? normalizeVRConfigForPreview(localCfg) : null;
        setCeConfigs((prev) => ({ ...prev, [target]: norm }));
      } catch (ee: any) {
        console.warn('获取CE配置失败(本地保存):', ee?.message || ee);
        setCeConfigs((prev) => ({ ...prev, [target]: null }));
      }
    }
  };

  // 直接下发配置到设备（通过 /api-proxy 调用远端 VR2/VRConfig）
  const dispatchVRConfig = async (uuid: string, cfg: any) => {
    if (!uuid || !cfg) return;
      const accesskey = 'Cloudmap%23123';
      const secretkey = 'Cloudmap%23123';
      const path = '/V2/ctcontrol/VR2/VRConfig';
      const method = 'POST';
      // 与 Postman 的 Pre-request Script 一致：POST 的签名 other 为空，签名计算使用 body 原文
      const other = '';

    const authUrl = `/api-proxy/api/sign?` +
      `url=${encodeURIComponent(path)}&` +
      `method=${method}&` +
      `other=${encodeURIComponent(other)}&` +
      `accessKey=${accesskey}&` +
      `secretKey=${secretkey}`;

    const signResp = await fetch(authUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ uuid, ...cfg }) });
    const signJson = await signResp.json();
    const info = (signJson && signJson.data) ? signJson.data : signJson;
    if (!info || !info.Authorization || !info.tonce) {
      throw new Error('认证响应数据缺少 Authorization 或 tonce');
    }

      // UUID 放在 body 中，URL 不携带查询参数
      const postUrl = `/api-proxy${path}`;
    const resp = await fetch(postUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': info.Authorization,
        // 仅发送小写 tonce，避免重复头可能引发的后端解析问题
        'tonce': String(info.tonce)
      },
      body: JSON.stringify({ uuid, ...cfg })
    });

    const data = await resp.json().catch(async () => ({ raw: await resp.text() }));
    if (!resp.ok) {
      throw new Error(data?.msg || `设备返回错误: ${resp.status}`);
    }
    return data;
  };

  const handleValuesChange = async (changed: any, all: any) => {
    if (changed?.peA) {
      await fetchAndSetPeConfig('peA', changed.peA);
      form.setFieldsValue({ peAInnerIf: undefined });
    }
    if (changed?.peB) {
      await fetchAndSetPeConfig('peB', changed.peB);
      form.setFieldsValue({ peBInnerIf: undefined });
    }
    if (changed?.ceA) {
      await fetchAndSetCeConfig('ceA', changed.ceA);
    }
    if (changed?.ceB) {
      await fetchAndSetCeConfig('ceB', changed.ceB);
    }
    // 为了让“接口选项”与“预览”在选择 VRF/接口时也刷新，更新本地状态
    try {
      setFormValues(all);
    } catch {}
  };

  // 计算本次隧道的公共 RT 与各端唯一 RD（基于选择的端点与隧道名稳定生成）
  const [rdRtMeta, setRdRtMeta] = useState<{ rtCommon: string; rdMap: Record<string, string> } | null>(null);
  useEffect(() => {
    if (!rdRtMeta) {
      const randNum = () => 100 + Math.floor(Math.random() * 50000);
      const rtCommon = `200:${randNum()}`; // 四端一致，随机生成
      const rdMap = { peA: `200:${randNum()}`, peB: `200:${randNum()}`, ceA: `200:${randNum()}`, ceB: `200:${randNum()}` };
      setRdRtMeta({ rtCommon, rdMap });
    }
  }, [rdRtMeta]);

  // 计算注入邻居后的预览配置
  const peAPreviewCfg = useMemo(() => {
    let c = peConfigs.peA;
    const b = peConfigs.peB;
    const ceA = ceConfigs.ceA;
    const peAInnerIf: string | undefined = form.getFieldValue('peAInnerIf');
    const vrf = c && peAInnerIf ? extractInterfaceVrf(c, peAInnerIf) : undefined;
    if (c && b) c = injectNeighborsForPEPeer(c, b);
    if (c && ceA) c = injectNeighborsForPEToCE(c, ceA, vrf);
    // 在 neighbor 中追加 route 信息（address_family 标记下），遵循 PRD：RD 唯一、RT 四端一致
    if (c && rdRtMeta?.rtCommon && rdRtMeta?.rdMap?.peA && vrf !== undefined) {
      const idx = findBgpIndexByVrf(c, vrf);
      c = injectNeighborRoutePolicyAtIndex(c, idx !== undefined ? idx : 1, rdRtMeta.rdMap.peA, rdRtMeta.rtCommon);
    }
    // 严格按 PRD：不再在 BGP.address_family 层注入 RD/RT，避免与 neighbor 路由策略产生冗余
    // IPv6 路由：目的前缀为本端 SRv6 prefix，经由对端 PE 的公网IPv6
    const dest = extractSrv6Prefix(c);
    const dest64 = dest && dest.includes('/') ? dest : (dest ? `${dest}/64` : undefined);
    const via = b ? extractPortIpv6(b, 0) : undefined;
    if (c && dest64 && via && vrf !== undefined) c = injectIpv6RouteTop(c, dest64, via, vrf);
    return sanitizePreview(c);
  }, [peConfigs, ceConfigs, rdRtMeta, formValues]);

  const peBPreviewCfg = useMemo(() => {
    let c = peConfigs.peB;
    const a = peConfigs.peA;
    const ceB = ceConfigs.ceB;
    const peBInnerIf: string | undefined = form.getFieldValue('peBInnerIf');
    const vrf = c && peBInnerIf ? extractInterfaceVrf(c, peBInnerIf) : undefined;
    if (c && a) c = injectNeighborsForPEPeer(c, a);
    if (c && ceB) c = injectNeighborsForPEToCE(c, ceB, vrf);
    // 在 neighbor 中追加 route 信息（address_family 标记下），遵循 PRD：RD 唯一、RT 四端一致
    if (c && rdRtMeta?.rtCommon && rdRtMeta?.rdMap?.peB && vrf !== undefined) {
      const idx = findBgpIndexByVrf(c, vrf);
      c = injectNeighborRoutePolicyAtIndex(c, idx !== undefined ? idx : 1, rdRtMeta.rdMap.peB, rdRtMeta.rtCommon);
    }
    // 严格按 PRD：不在 BGP.address_family 层注入 RD/RT
    // IPv6 路由：目的前缀为本端 SRv6 prefix，经由对端 PE 的公网IPv6
    const dest = extractSrv6Prefix(c);
    const dest64 = dest && dest.includes('/') ? dest : (dest ? `${dest}/64` : undefined);
    const via = a ? extractPortIpv6(a, 0) : undefined;
    if (c && dest64 && via && vrf !== undefined) c = injectIpv6RouteTop(c, dest64, via, vrf);
    return sanitizePreview(c);
  }, [peConfigs, ceConfigs, rdRtMeta, formValues]);

  // CE 预览（不做邻居注入，仅展示配置）
  const ceAPreviewCfg = useMemo(() => {
    const ceA = ceConfigs.ceA;
    const peA = peConfigs.peA;
    const peAInnerIf: string | undefined = form.getFieldValue('peAInnerIf');
    const peAInnerIp = peAInnerIf ? extractInterfaceIpv6(peA, peAInnerIf) : extractPortIpv6(peA, 1);
    let injected = ceA && peA ? injectConnectionsForCE(ceA, peAInnerIp ? { ...peA, _inner_ip_override: peAInnerIp } : peA) : ceA;
    // 严格按 PRD：SRv6 创建页不向 CE 的 BGP.address_family 注入 RD/RT
    return sanitizePreview(injected);
  }, [ceConfigs, peConfigs, rdRtMeta, formValues]);

  const ceBPreviewCfg = useMemo(() => {
    const ceB = ceConfigs.ceB;
    const peB = peConfigs.peB;
    const peBInnerIf: string | undefined = form.getFieldValue('peBInnerIf');
    const peBInnerIp = peBInnerIf ? extractInterfaceIpv6(peB, peBInnerIf) : extractPortIpv6(peB, 1);
    let injected = ceB && peB ? injectConnectionsForCE(ceB, peBInnerIp ? { ...peB, _inner_ip_override: peBInnerIp } : peB) : ceB;
    // 严格按 PRD：SRv6 创建页不向 CE 的 BGP.address_family 注入 RD/RT
    return sanitizePreview(injected);
  }, [ceConfigs, peConfigs, rdRtMeta, formValues]);

  // 打开 PE 配置弹窗
  const openPeDialog = (target: 'peA' | 'peB') => {
    const uuid = form.getFieldValue(target);
    if (!uuid) {
      message.error(`请先选择 ${target === 'peA' ? 'PE-A' : 'PE-B'} 的 VR 实例`);
      return;
    }
    setPeConfigTarget(target);
    const tunnelName = form.getFieldValue('tunnelName') || '';
    peConfigForm.setFieldsValue({
      locator: '',
      prefix: '',
      bgpAsn: undefined,
      bgpRouterId: tunnelName ? `${tunnelName}-router` : ''
    });
    setPeConfigModalOpen(true);
  };

  // 专家模式跳转到 VR 配置专家页
  const goExpertMode = (target: 'peA' | 'peB') => {
    const uuid = form.getFieldValue(target);
    if (!uuid) {
      message.error(`请先选择 ${target === 'peA' ? 'PE-A' : 'PE-B'} 的 VR 实例`);
      return;
    }
    navigate(`/admin/interconnect/vr/${uuid}/config`);
  };

  // 打开角色配置向导（新页面）
  const openRoleWizard = (target: 'peA' | 'peB' | 'ceA' | 'ceB') => {
    const uuid = form.getFieldValue(target);
    if (!uuid) {
      message.error(`请先选择 ${target === 'peA' ? 'PE-A' : 'PE-B'} 的 VR 实例`);
      return;
    }
    const role = target.startsWith('pe') ? 'PE' : 'CE';
    const url = role === 'PE'
      ? `/admin/interconnect/vr/${uuid}/role-pe`
      : `/admin/interconnect/vr/${uuid}/role-ce`;
    window.open(url, '_blank');
  };

  const handleSavePeConfig = async () => {
    try {
      const vals = await peConfigForm.validateFields();
      const uuid = peConfigTarget ? form.getFieldValue(peConfigTarget) : null;
      if (!uuid) {
        message.error('缺少 VR UUID');
        return;
      }
      const config = {
        segment_routing_srv6: {
          locator: vals.locator || '',
          prefix: vals.prefix || ''
        },
        bgp: [
          {
            asn: Number(vals.bgpAsn || 0),
            bgp_router_id: vals.bgpRouterId || '',
            neighbor: [],
            address_family: []
          }
        ]
      };
      const res = await saveVRConfig(uuid, config);
      if (res) {
        message.success('PE 配置已保存到平台');
        setPeConfigModalOpen(false);
        // 保存后刷新预览
        if (peConfigTarget) {
          const uuid = form.getFieldValue(peConfigTarget);
          await fetchAndSetPeConfig(peConfigTarget, uuid);
        }
      }
    } catch (err: any) {
      if (err?.errorFields) return; // 表单校验错误
      message.error(`保存失败：${err?.message || '未知错误'}`);
    }
  };

  // 预览更新：仅在用户主动操作（回车或点击导致失焦）时更新预览
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
    commitPreview();
  };

  // 构建 SRv6 隧道配置 JSON（预览用）
  const buildTunnelConfigFromValues = (v: any) => {
    const cfg: any = {};
    const tunnelName = String(v?.tunnelName || '').trim();
    if (tunnelName) cfg.tunnel_name = tunnelName;
    if (mode) cfg.mode = mode;
    // 端点选择
    const endpoints: any = {};
    if (v?.peA) endpoints.pe_a = String(v.peA);
    if (v?.peB) endpoints.pe_b = String(v.peB);
    if (v?.ceA) endpoints.ce_a = String(v.ceA);
    if (v?.ceB) endpoints.ce_b = String(v.ceB);
    if (Object.keys(endpoints).length) cfg.endpoints = endpoints;
    return cfg;
  };

  const deferredValues = useDeferredValue(formValues);
  const configPreview = useMemo(() => buildTunnelConfigFromValues(deferredValues || {}), [deferredValues, mode]);

  const submit = async () => {
    try {
      // 在第4步（确认创建）表单项未挂载，直接读取存储的字段值
      const values = form.getFieldsValue(true);
      const peA = values?.peA;
      const peB = values?.peB;
      const ceA = values?.ceA;
      const ceB = values?.ceB;
      const tunnelName = String(values?.tunnelName || '').trim();
      const peAInnerIf = values?.peAInnerIf;
      const peBInnerIf = values?.peBInnerIf;

      // 仅在两端都已选择时比较，避免空值误判
      if (peA && peB && String(peA) === String(peB)) {
        message.error('PE-A 与 PE-B 不能相同');
        return;
      }
      if (ceA && ceB && String(ceA) === String(ceB)) {
        message.error('CE-A 与 CE-B 不能相同');
        return;
      }
      if (!tunnelName || !peA || !peB || !ceA || !ceB) {
        message.error('请完成隧道名称、PE/CE 选择');
        return;
      }
      if (!peAInnerIf || !peBInnerIf) {
        message.error('请在“选择 PE”步骤中选择 PE-A 与 PE-B 的内网口');
        return;
      }
      // 确认所选内网口包含 VRF（否则视为无法识别“内网配置组”，不允许提交）
      const peAHasVrf = extractInterfaceVrf(peConfigs.peA, peAInnerIf);
      const peBHasVrf = extractInterfaceVrf(peConfigs.peB, peBInnerIf);
      if (!peAHasVrf || !peBHasVrf) {
        message.error('所选内网口未携带 VRF，无法识别内网配置组，请重新选择带 VRF 的接口');
        return;
      }
      // 调用后端创建接口
      try {
        const { createSrv6Tunnel } = await import('../../../services/api');
        await createSrv6Tunnel({ name: tunnelName, peA: String(peA), peB: String(peB), ceA: String(ceA), ceB: String(ceB) });
        // 保存并下发拼装后的 JSON 至各端（最佳努力）
        try {
          const ops: Promise<any>[] = [];
          if (peA && peAPreviewCfg) ops.push(saveVRConfig(String(peA), peAPreviewCfg));
          if (peB && peBPreviewCfg) ops.push(saveVRConfig(String(peB), peBPreviewCfg));
          if (ceA && ceAPreviewCfg) ops.push(saveVRConfig(String(ceA), ceAPreviewCfg));
          if (ceB && ceBPreviewCfg) ops.push(saveVRConfig(String(ceB), ceBPreviewCfg));
          if (ops.length) {
            await Promise.allSettled(ops);
          }

          const dispatchOps: Promise<any>[] = [];
          if (peA && peAPreviewCfg) dispatchOps.push(dispatchVRConfig(String(peA), peAPreviewCfg));
          if (peB && peBPreviewCfg) dispatchOps.push(dispatchVRConfig(String(peB), peBPreviewCfg));
          if (ceA && ceAPreviewCfg) dispatchOps.push(dispatchVRConfig(String(ceA), ceAPreviewCfg));
          if (ceB && ceBPreviewCfg) dispatchOps.push(dispatchVRConfig(String(ceB), ceBPreviewCfg));
          if (dispatchOps.length) {
            await Promise.allSettled(dispatchOps);
          }
        } catch (e) {
          // 下发失败不阻断导航，提示即可
          console.warn('部分或全部配置下发失败:', e);
        }
        message.success('SRv6 隧道创建提交成功，配置已下发');
        navigate('/admin/interconnect/srv6');
      } catch (err: any) {
        message.error(`创建失败：${err?.message || '请稍后重试'}`);
      }
    } catch (e) {
      // 表单校验失败不处理
    }
  };

  const next = () => setCurrent((c) => Math.min(c + 1, 2));
  const prev = () => setCurrent((c) => Math.max(c - 1, 0));

  const CoreContent: React.FC = () => {
    if (current === 0) {
      return (
        <Form layout="vertical" form={form} onKeyDown={handleFormKeyDown} onBlur={handleFormBlur}>
          <Form.Item name="tunnelName" label="隧道名称" rules={[{ required: true, message: '请输入隧道名称' }]}> 
            <Input placeholder="例如：beijing-to-shanghai" style={{ width: 360 }} />
          </Form.Item>
          <Form.Item label="选择模式" required>
            <Radio.Group value={mode} onChange={(e) => setMode(e.target.value)}>
              <Radio.Button value="标准">标准模式</Radio.Button>
              <Radio.Button value="高可用">高可用模式（待设计）</Radio.Button>
            </Radio.Group>
          </Form.Item>
        </Form>
      );
    }
  if (current === 1) {
    return (
        <Form layout="vertical" form={form} onKeyDown={handleFormKeyDown} onBlur={handleFormBlur} onValuesChange={handleValuesChange}>
          <Row gutter={16}>
            <Col span={24}>
              {/* 分组1 标题：参照 VR 角色配置向导 样式 */}
              <div style={{ fontSize: 13, color: '#1677ff', margin: '4px 0 12px 0', borderBottom: '1px solid #e8e8e8', paddingBottom: 6 }}>设定对端设备</div>
              <Form.Item name="peA" label="PE-A" rules={[{ required: true, message: '请选择 PE-A' }]} style={{ marginBottom: 8 }}> 
                <Select
                  options={peOptions}
                  showSearch
                  allowClear
                  optionFilterProp="label"
                  placeholder="选择 PE-A 的 VR 实例"
                />
              </Form.Item>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 0 }}>
                <Button size="small" type="link" icon={<ExportOutlined />} onClick={() => openRoleWizard('peA')}>角色配置向导</Button>
              </div>
              <Form.Item 
                name="peAInnerIf" 
                label="选择 PE-A 内网口" 
                rules={[{ required: true, message: '请选择 PE-A 内网口' }]} 
                extra={( () => { const sel = form.getFieldValue('peAInnerIf'); const vrf = extractInterfaceVrf(peConfigs.peA, sel); const ip = extractInterfaceIpv6(peConfigs.peA, sel); return <span style={{ color: '#999' }}>VRF: {vrf ?? '-'} · IPv6: {ip ?? '-'}</span>; })()}
              > 
                <Select
                  options={listInterfaceOptions(peConfigs.peA)}
                  showSearch
                  allowClear
                  optionFilterProp="label"
                  placeholder="请选择用于 PE-A 内网互联的接口（优先展示带 VRF 的接口；若设备未标注 VRF，将以 IPv6 兜底展示）"
                />
              </Form.Item>
              {/* CE-A 选择移动到与 PE-A 同一分组 */}
              <Form.Item name="ceA" label="CE-A" rules={[{ required: true, message: '请选择 CE-A' }]} style={{ marginBottom: 8 }}> 
                <Select
                  options={ceOptions}
                  showSearch
                  allowClear
                  optionFilterProp="label"
                  placeholder="选择 CE-A 的 VR 实例"
                />
              </Form.Item>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 0 }}>
                <Button size="small" type="link" icon={<ExportOutlined />} onClick={() => openRoleWizard('ceA')}>角色配置向导</Button>
              </div>
            </Col>
            <Col span={24}>
              {/* 分组2 标题：参照 VR 角色配置向导 样式 */}
              <div style={{ fontSize: 13, color: '#1677ff', margin: '4px 0 12px 0', borderBottom: '1px solid #e8e8e8', paddingBottom: 6 }}>设定对端设备</div>
              <Form.Item name="peB" label="PE-B" dependencies={["peA"]} rules={[
                { required: true, message: '请选择 PE-B' },
                ({ getFieldValue }) => ({ validator(_, v){ const a = getFieldValue('peA'); if(!v) return Promise.resolve(); if(String(v) !== String(a)) return Promise.resolve(); return Promise.reject(new Error('PE-A 与 PE-B 不能相同')); } })
              ]} style={{ marginBottom: 8 }}> 
                <Select
                  options={peOptions}
                  showSearch
                  allowClear
                  optionFilterProp="label"
                  placeholder="选择 PE-B 的 VR 实例"
                />
              </Form.Item>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 0 }}>
                <Button size="small" type="link" icon={<ExportOutlined />} onClick={() => openRoleWizard('peB')}>角色配置向导</Button>
              </div>
              <Form.Item 
                name="peBInnerIf" 
                label="选择 PE-B 内网口" 
                rules={[{ required: true, message: '请选择 PE-B 内网口' }]} 
                extra={( () => { const sel = form.getFieldValue('peBInnerIf'); const vrf = extractInterfaceVrf(peConfigs.peB, sel); const ip = extractInterfaceIpv6(peConfigs.peB, sel); return <span style={{ color: '#999' }}>VRF: {vrf ?? '-'} · IPv6: {ip ?? '-'}</span>; })()}
              > 
                <Select
                  options={listInterfaceOptions(peConfigs.peB)}
                  showSearch
                  allowClear
                  optionFilterProp="label"
                  placeholder="请选择用于 PE-B 内网互联的接口（优先展示带 VRF 的接口；若设备未标注 VRF，将以 IPv6 兜底展示）"
                />
              </Form.Item>
              {/* CE-B 选择移动到与 PE-B 同一分组 */}
              <Form.Item name="ceB" label="CE-B" dependencies={["ceA"]} rules={[
                { required: true, message: '请选择 CE-B' },
                ({ getFieldValue }) => ({ validator(_, v){ if(!v || v!==getFieldValue('ceA')) return Promise.resolve(); return Promise.reject(new Error('CE-A 与 CE-B 不能相同')); } })
              ]} style={{ marginBottom: 8 }}> 
                <Select
                  options={ceOptions}
                  showSearch
                  allowClear
                  optionFilterProp="label"
                  placeholder="选择 CE-B 的 VR 实例"
                />
              </Form.Item>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 0 }}>
                <Button size="small" type="link" icon={<ExportOutlined />} onClick={() => openRoleWizard('ceB')}>角色配置向导</Button>
              </div>
            </Col>
          </Row>
        </Form>
      );
    }
    if (current === 2) {
      return (
        <Descriptions title="概要" bordered column={1} size="small">
          <Descriptions.Item label="隧道名称">{form.getFieldValue('tunnelName') || '-'}</Descriptions.Item>
          <Descriptions.Item label="模式">{mode || '-'}</Descriptions.Item>
          <Descriptions.Item label="PE-A">{form.getFieldValue('peA') || '-'}</Descriptions.Item>
          <Descriptions.Item label="PE-B">{form.getFieldValue('peB') || '-'}</Descriptions.Item>
          <Descriptions.Item label="CE-A">{form.getFieldValue('ceA') || '-'}</Descriptions.Item>
          <Descriptions.Item label="CE-B">{form.getFieldValue('ceB') || '-'}</Descriptions.Item>
        </Descriptions>
      );
    }
    return (
      <Descriptions title="概要" bordered column={1} size="small">
        <Descriptions.Item label="隧道名称">{form.getFieldValue('tunnelName') || '-'}</Descriptions.Item>
        <Descriptions.Item label="模式">{mode || '-'}</Descriptions.Item>
        <Descriptions.Item label="PE-A">{form.getFieldValue('peA') || '-'}</Descriptions.Item>
        <Descriptions.Item label="PE-B">{form.getFieldValue('peB') || '-'}</Descriptions.Item>
        <Descriptions.Item label="CE-A">{form.getFieldValue('ceA') || '-'}</Descriptions.Item>
        <Descriptions.Item label="CE-B">{form.getFieldValue('ceB') || '-'}</Descriptions.Item>
      </Descriptions>
    );
  };

  const stepTitle = ['基础信息与模式', '选择 PE 与 CE', '确认创建'][current];

  return (
    <PageContainer
      title="创建 SRv6 隧道（向导模式）"
      titleLevel={3}
      asCard={false}
      contentPadding={16}
    >
      {/* 已移除：VR 实例列表（调试）与（简表） */}
      <Row gutter={16}>
        <Col span={5}>
          <Card size="small" title={<span style={{ fontSize: 13, fontWeight: 600 }}>步骤</span>} variant="outlined" style={{ position: 'sticky', top: 16 }}>
            <Steps
              direction="vertical"
              size="small"
              current={current}
              onChange={(idx) => setCurrent(idx)}
              items={[
                { title: '基础信息与模式' },
                { title: '选择 PE 与 CE' },
                { title: '确认创建' },
              ]}
            />
          </Card>
        </Col>
        <Col span={12}>
          <Card size="small" title={`第 ${current + 1} 步：${stepTitle}`} variant="outlined">
            <CoreContent />
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 16 }}>
              <Space>
                <Button onClick={() => navigate('/admin/interconnect/srv6')}>返回列表</Button>
                {current > 0 && <Button onClick={prev}>上一步</Button>}
              </Space>
              <Space>
                {current < 2 && <Button type="primary" onClick={() => { commitPreview(); next(); }}>下一步</Button>}
                {current === 2 && <Button type="primary" onClick={submit}>提交创建</Button>}
              </Space>
            </div>
          </Card>
        </Col>
        <Col span={7}>
          <Card size="small" title={<span style={{ fontSize: 13, fontWeight: 600 }}>配置 JSON预览</span>} variant="outlined" style={{ position: 'sticky', top: 16 }}>
            <Tabs size="small" defaultActiveKey="peA">
              <Tabs.TabPane tab="PE-A配置" key="peA">
                {peAPreviewCfg ? (
                  <pre style={{ fontSize: 12, lineHeight: '18px', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                    {safeStringify(peAPreviewCfg)}
                  </pre>
                ) : (
                  <div style={{ fontSize: 12, color: '#64748b' }}>未选择或无配置</div>
                )}
              </Tabs.TabPane>
              <Tabs.TabPane tab="PE-B配置" key="peB">
                {peBPreviewCfg ? (
                  <pre style={{ fontSize: 12, lineHeight: '18px', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                    {safeStringify(peBPreviewCfg)}
                  </pre>
                ) : (
                  <div style={{ fontSize: 12, color: '#64748b' }}>未选择或无配置</div>
                )}
              </Tabs.TabPane>
              <Tabs.TabPane tab="CE-A配置" key="ceA">
                {ceAPreviewCfg ? (
                  <pre style={{ fontSize: 12, lineHeight: '18px', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                    {safeStringify(ceAPreviewCfg)}
                  </pre>
                ) : (
                  <div style={{ fontSize: 12, color: '#64748b' }}>未选择或无配置</div>
                )}
              </Tabs.TabPane>
              <Tabs.TabPane tab="CE-B配置" key="ceB">
                {ceBPreviewCfg ? (
                  <pre style={{ fontSize: 12, lineHeight: '18px', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                    {safeStringify(ceBPreviewCfg)}
                  </pre>
                ) : (
                  <div style={{ fontSize: 12, color: '#64748b' }}>未选择或无配置</div>
                )}
              </Tabs.TabPane>
            </Tabs>
          </Card>
        </Col>
      </Row>

      <Modal
        title={peConfigTarget ? `PE配置 - ${peConfigTarget === 'peA' ? 'PE-A' : 'PE-B'}` : 'PE配置'}
        open={peConfigModalOpen}
        onCancel={() => setPeConfigModalOpen(false)}
        onOk={handleSavePeConfig}
        okText="保存"
        cancelText="取消"
        destroyOnHidden
      >
        <Form form={peConfigForm} layout="vertical">
          <Form.Item label="SRv6 Locator" name="locator" rules={[{ required: true, message: '请输入 Locator' }]}> 
            <Input placeholder="例如：node-a-locator" />
          </Form.Item>
          <Form.Item label="SRv6 SID 前缀" name="prefix" rules={[{ required: true, message: '请输入 SID 前缀' }]}> 
            <Input placeholder="例如：2001:db8:100::/64" />
          </Form.Item>
          <Form.Item label="BGP ASN" name="bgpAsn" rules={[{ required: true, message: '请输入 BGP ASN' }]}> 
            <Input placeholder="例如：65001" />
          </Form.Item>
          <Form.Item label="BGP Router ID" name="bgpRouterId" rules={[{ required: true, message: '请输入 Router ID' }]}> 
            <Input placeholder="例如：10.0.0.1" />
          </Form.Item>
          <div style={{ fontSize: 12, color: '#64748b' }}>提示：该对话框仅保存 SRv6/BGP 关键片段，可通过“专家模式”进行完整配置。</div>
        </Form>
      </Modal>
    </PageContainer>
  );
};

export default SRv6CreatePage;
