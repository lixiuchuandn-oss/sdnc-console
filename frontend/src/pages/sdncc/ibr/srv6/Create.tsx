import React, { useEffect, useMemo, useState, useTransition, useDeferredValue } from 'react';
import { Alert, Button, Card, Descriptions, Form, Input, Radio, Select, Space, Steps, message, Row, Col, Modal, Tabs, Divider } from 'antd';
import { ExportOutlined, CheckCircleOutlined } from '@ant-design/icons';
import { useNavigate, useLocation } from 'react-router-dom';
import PageContainer from '../../../../components/PageContainer';
import { getVRRoles, saveVRConfig, getVRConfig, fetchVrCachePageList, getVR2Config } from '../../../../services/virtualRouterApi';
import { apiRequest, apiPost, fetchSrv6HubStatus, fetchSrv6Tunnel, type Srv6HubVrStatus } from '../../../../services/api';
import { filterLinkLocalIpv6 } from '../routers/vrIpv6Utils';
import { buildSrv6PeerRouteDestination, resolveSid64Via } from './srv6Ipv6';
import {
  inferTunnelTopologyFromRoles,
  resolveHubPeSlotFromRoles,
  type Srv6HubVrfMode,
} from './srv6Archive';

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

/** SRv6 下发向导步骤（与 IPsec手动下发类似：每台 VR 先预览再推送） */
const SRV6_DEPLOY_STEP_DEFS: { title: string; desc: string }[] = [
  { title: '预览 PE-A', desc: '从平台库读取待下发配置（清洗后）' },
  { title: '下发 PE-A', desc: '推送到设备' },
  { title: '预览 PE-B', desc: '从平台库读取待下发配置（清洗后）' },
  { title: '下发 PE-B', desc: '推送到设备' },
  { title: '预览 CE-A', desc: '从平台库读取待下发配置（清洗后）' },
  { title: '下发 CE-A', desc: '推送到设备' },
  { title: '预览 CE-B', desc: '从平台库读取待下发配置（清洗后）' },
  { title: '下发 CE-B', desc: '推送到设备' },
];

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
  const [, startTransition] = useTransition();
  const [peConfigs, setPeConfigs] = useState<{ peA?: any; peB?: any }>({});
  const [ceConfigs, setCeConfigs] = useState<{ ceA?: any; ceB?: any }>({});
  /** 第 3 步：已创建隧道记录并写入平台 VR配置库 */
  const [platformSaved, setPlatformSaved] = useState(false);
  const [platformSaveLoading, setPlatformSaveLoading] = useState(false);
  /** 第 4 步：分步下发 */
  const [deployStep, setDeployStep] = useState(0);
  const [deployLogs, setDeployLogs] = useState<Record<number, string>>({});
  const [deployStatus, setDeployStatus] = useState<Record<number, 'wait' | 'process' | 'finish' | 'error'>>({});
  const deployVrSeqRef = React.useRef<{ label: string; id: string }[]>([]);
  const deployAutoStartedRef = React.useRef(false);
  const [peHubStatus, setPeHubStatus] = useState<{ peA?: Srv6HubVrStatus; peB?: Srv6HubVrStatus }>({});

  const refreshPeHubStatus = async (target: 'peA' | 'peB', vrUuid?: string) => {
    const id = String(vrUuid || '').trim();
    if (!id) {
      setPeHubStatus((prev) => ({ ...prev, [target]: undefined }));
      return;
    }
    try {
      const status = await fetchSrv6HubStatus(id);
      const filtered = editId
        ? { ...status, tunnels: status.tunnels.filter((t) => t.tunnelId !== editId) }
        : status;
      const adjusted = {
        ...filtered,
        tunnelCount: filtered.tunnels.length,
        isHub: filtered.isHub || (filtered.portRegistry?.length ?? 0) > 0,
      };
      const keep =
        adjusted.isHub ||
        String(adjusted.role || '').toUpperCase() === 'HUB_PE' ||
        !adjusted.hubInventoryUi?.inventoryEmpty ||
        adjusted.tunnelCount > 0 ||
        (adjusted.portRegistry?.length ?? 0) > 0;
      setPeHubStatus((prev) => ({ ...prev, [target]: keep ? adjusted : undefined }));
    } catch {
      setPeHubStatus((prev) => ({ ...prev, [target]: undefined }));
    }
  };

  const renderPeHubAlert = (target: 'peA' | 'peB', label: string) => {
    const status = peHubStatus[target];
    if (!status?.tunnelCount) return null;
    const names = status.tunnels.map((t) => `「${t.tunnelName}」(${t.slot})`).join('、');
    const hubNote = status.isHub
      ? '该 PE 处于 Hub 多隧道模式。'
      : '该 PE 已被其它隧道引用。';
    const hubCustomerSide = form.getFieldValue('hubCustomerSide');
    const reuseHint =
      hubCustomerSide === 'dedicated'
        ? '路线 B（独立客户侧）：每条 Spoke 须使用独立内网 VRF/口与 RD/RT；仅对端 Spoke 公网 IPv6 邻居不可与已有隧道重复。'
        : '路线 A（共用客户侧）：可复用 Hub WAN/LAN/VRF 与 Hub 侧 CE；仅对端 Spoke 公网 IPv6 邻居不可与已有隧道重复。';
    return (
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 12 }}
        message={`${label} ${hubNote}`}
        description={
          <>
            <div>已引用隧道（{status.tunnelCount}）：{names}</div>
            <div style={{ marginTop: 4, color: 'rgba(0,0,0,.55)' }}>{reuseHint}</div>
          </>
        }
      />
    );
  };

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
        const { fetchSrv6Tunnel } = await import('../../../../services/api');
        const item = await fetchSrv6Tunnel(editId);
        if (item && item.id) {
          form.setFieldsValue({
            tunnelName: item.name,
            peA: item.peA,
            peB: item.peB,
            ceA: item.ceA,
            ceB: item.ceB,
            peAInnerIf: item.peAInnerIf || undefined,
            peBInnerIf: item.peBInnerIf || undefined,
            hubWanIf: item.hubBindings?.wanIf,
            hubLanIf: item.hubBindings?.lanIf,
            hubWanInventoryId: item.hubBindings?.wanInventoryId,
            hubLanInventoryId: item.hubBindings?.lanInventoryId,
            hubCustomerSide:
              item.hubVrfMode === 'DEDICATED_VRF' ? 'dedicated' : item.hubVrfMode ? 'reuse' : undefined,
          });
          setFormValues({
            tunnelName: item.name,
            peA: item.peA,
            peB: item.peB,
            ceA: item.ceA,
            ceB: item.ceB,
            peAInnerIf: item.peAInnerIf,
            peBInnerIf: item.peBInnerIf,
          });
          if (item.rdRtMeta) setRdRtMeta(item.rdRtMeta);
          // 编辑模式：加载各端已有配置，便于拼装下发 JSON
          if (item.peA) await fetchAndSetPeConfig('peA', item.peA);
          if (item.peB) await fetchAndSetPeConfig('peB', item.peB);
          if (item.ceA) await fetchAndSetCeConfig('ceA', item.ceA);
          if (item.ceB) await fetchAndSetCeConfig('ceB', item.ceB);
          if (item.peA) await refreshPeHubStatus('peA', item.peA);
          if (item.peB) await refreshPeHubStatus('peB', item.peB);
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

  const ipv6HostFromRaw = (v?: string): string | undefined => {
    const picked = filterLinkLocalIpv6(v);
    return trimPrefix(picked || undefined);
  };

  // 提取指定端口索引的 IPv6（0=第一个网口/公网；1=第二个网口/内网），尽力解析；剔除 fe80::
  const extractPortIpv6 = (cfg: any, portIndex: number): string | undefined => {
    if (!cfg || typeof cfg !== 'object') return undefined;
    const keys = Object.keys(cfg);
    for (const k of keys) {
      if (k.startsWith('interfaces_') || k.startsWith('subinterfaces_')) {
        const arr = (cfg as any)[k];
        if (Array.isArray(arr) && arr[portIndex]) {
          const ip = ipv6HostFromRaw(arr[portIndex]?.ipv6_static || arr[portIndex]?.ipv6);
          if (ip) return ip;
        }
      }
    }
    const candidates: string[] = [];
    for (const k of keys) {
      if (k.startsWith('interfaces_') || k.startsWith('subinterfaces_')) {
        const arr = (cfg as any)[k];
        if (Array.isArray(arr)) {
          for (const it of arr) {
            const ip = ipv6HostFromRaw(it?.ipv6_static || it?.ipv6);
            if (ip) candidates.push(ip);
          }
        }
      }
    }
    if (portIndex === 0) {
      return candidates[0] || ipv6HostFromRaw((cfg as any)?.ipv6_static || (cfg as any)?.ipv6);
    }
    if (portIndex === 1) return candidates[1] || candidates[0] || undefined;
    return undefined;
  };

  /** 接口行：优先 IPv4（与 CE–PE 纯 IPv4 专家配置一致），否则 IPv6 */
  const rowHostIpPreferV4 = (it: any): string | undefined => {
    const v4 = trimPrefix(it?.ipv4_static || it?.ipv4);
    if (v4) return v4;
    return ipv6HostFromRaw(it?.ipv6_static || it?.ipv6);
  };

  /** 按端口索引取“公网/内网”主机地址：IPv4 优先，否则 IPv6（用于 CE 外网、PE 内网等） */
  const extractPortIp = (cfg: any, portIndex: number): string | undefined => {
    if (!cfg || typeof cfg !== 'object') return undefined;
    const keys = Object.keys(cfg);
    for (const k of keys) {
      if (k.startsWith('interfaces_') || k.startsWith('subinterfaces_')) {
        const arr = (cfg as any)[k];
        if (Array.isArray(arr) && arr[portIndex]) {
          const ip = rowHostIpPreferV4(arr[portIndex]);
          if (ip) return ip;
        }
      }
    }
    const candidates: string[] = [];
    for (const k of keys) {
      if (k.startsWith('interfaces_') || k.startsWith('subinterfaces_')) {
        const arr = (cfg as any)[k];
        if (Array.isArray(arr)) {
          for (const it of arr) {
            const ip = rowHostIpPreferV4(it);
            if (ip) candidates.push(ip);
          }
        }
      }
    }
    if (portIndex === 0) {
      return (
        candidates[0] ||
        trimPrefix((cfg as any)?.ipv4_static || (cfg as any)?.ipv4) ||
        trimPrefix((cfg as any)?.ipv6_static || (cfg as any)?.ipv6)
      );
    }
    if (portIndex === 1) return candidates[1] || candidates[0] || undefined;
    return undefined;
  };

  /** 按接口名取主机地址：IPv4 优先，否则 IPv6 */
  const extractInterfaceIp = (cfg: any, ifName?: string): string | undefined => {
    if (!cfg || typeof cfg !== 'object' || !ifName) return undefined;
    const keys = Object.keys(cfg);
    for (const k of keys) {
      if (k.startsWith('interfaces_') || k.startsWith('subinterfaces_')) {
        const arr = (cfg as any)[k];
        if (Array.isArray(arr)) {
          for (const it of arr) {
            if (String(it?.name || '') === ifName) return rowHostIpPreferV4(it);
          }
        }
      }
    }
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
    const items: { name: string; vrf?: any; ipv6?: string; ipv4?: string }[] = [];
    for (const k of keys) {
      if (k.startsWith('interfaces_') || k.startsWith('subinterfaces_')) {
        const arr = (cfg as any)[k];
        if (Array.isArray(arr)) {
          for (const it of arr) {
            const name = String(it?.name || '');
            if (!name) continue;
            const vrf = (it as any)?.vrf;
            const ip6 = trimPrefix((it as any)?.ipv6_static || (it as any)?.ipv6);
            const ip4 = trimPrefix((it as any)?.ipv4_static || (it as any)?.ipv4);
            items.push({ name, vrf, ipv6: ip6, ipv4: ip4 });
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
    const fallback = withVrf.length > 0 ? [] : items.filter(excludePublic).filter((it) => !!(it.ipv6 || it.ipv4));
    const finalItems = withVrf.length > 0 ? withVrf : fallback;
    // 以接口名去重，保留其 VRF/IPv6 显示在标签中，便于用户识别“属于哪个内网配置组、VRF是多少”
    const nameToMeta: Record<string, { vrf?: any; ipv6?: string; ipv4?: string }> = {};
    finalItems.forEach((x) => { if (!(x.name in nameToMeta)) nameToMeta[x.name] = { vrf: x.vrf, ipv6: x.ipv6, ipv4: x.ipv4 }; });
    return Object.keys(nameToMeta).map((n) => ({ value: n, label: n }));
  };

  // PE+PE：公网 BGP 去掉 ipv6 unicast；保留 ipv4 vpn + activate_address_family；控制器要求此时必须配置 neighbor，故注入对端公网 IPv6 邻居及对端 ASN
  const injectNeighborsForPEPeer = (selfCfg: any, peerPeCfg: any): any => {
    try {
      const cloned = JSON.parse(JSON.stringify(selfCfg || {}));
      const peerPublicIp = extractPortIpv6(peerPeCfg, 0);
      if (!peerPublicIp) return cloned;
      const isPublicBgp = (b: any) =>
        b && typeof b === 'object' && (!b.vrf || b.vrf === 0 || b.vrf === '0');
      let bgpArr = Array.isArray((cloned as any)?.bgp) ? (cloned as any).bgp : [];
      const pubIdxFromMeta = readPePublicBgpIndex((cloned as any)?.pe);
      let pubIdx = -1;
      if (
        typeof pubIdxFromMeta === 'number' &&
        pubIdxFromMeta >= 0 &&
        pubIdxFromMeta < bgpArr.length &&
        isPublicBgp(bgpArr[pubIdxFromMeta])
      ) {
        pubIdx = pubIdxFromMeta;
      } else {
        pubIdx = bgpArr.findIndex(isPublicBgp);
      }
      if (pubIdx < 0) {
        bgpArr = [{ bgp_ebgp_requires_policy: 'disable', address_family: [] }, ...bgpArr];
        (cloned as any).bgp = bgpArr;
        pubIdx = 0;
      }
      const bgpPub = bgpArr[pubIdx];
      if (!bgpPub || typeof bgpPub !== 'object') return cloned;

      const afArr = Array.isArray(bgpPub.address_family) ? bgpPub.address_family : [];
      const afNoV6 = afArr.filter((af: any) => String(af?.address_family).toLowerCase() !== 'ipv6');
      const afV4Idx = afNoV6.findIndex((af: any) => String(af?.address_family).toLowerCase() === 'ipv4');
      if (afV4Idx >= 0) {
        const af = afNoV6[afV4Idx];
        delete (af as any).modifier;
        af.modifiler = 'vpn';
        const act = Array.isArray(af.activate_address_family) ? af.activate_address_family : [];
        if (!act.includes(peerPublicIp)) act.push(peerPublicIp);
        af.activate_address_family = act;
        afNoV6[afV4Idx] = af;
      } else {
        afNoV6.push({
          address_family: 'ipv4',
          modifiler: 'vpn',
          activate_address_family: [peerPublicIp],
        });
      }
      bgpPub.address_family = afNoV6;
      const peerPublicAsn = extractBgpAsnAt(peerPeCfg, 0);
      const neighbors = Array.isArray(bgpPub.neighbor) ? [...bgpPub.neighbor] : [];
      const hasPeerNeighbor = neighbors.some((n: any) => String(n?.remote_ip) === String(peerPublicIp));
      if (!hasPeerNeighbor) {
        neighbors.push({
          remote_ip: peerPublicIp,
          remote_as: peerPublicAsn ?? 0,
        });
      }
      bgpPub.neighbor = neighbors;
      const ndc = Array.isArray(bgpPub.neighbor_disable_connected_check)
        ? [...bgpPub.neighbor_disable_connected_check]
        : [];
      if (!ndc.some((ip: any) => String(ip) === String(peerPublicIp))) {
        ndc.push(peerPublicIp);
      }
      bgpPub.neighbor_disable_connected_check = ndc;
      bgpArr[pubIdx] = bgpPub;
      return cloned;
    } catch (_) {
      return selfCfg;
    }
  };

  const injectNeighborsForPEPeerIp = (selfCfg: any, peerPublicIp: string, peerPublicAsn?: number): any => {
    if (!peerPublicIp) return selfCfg;
    return injectNeighborsForPEPeer(selfCfg, {
      bgp: [{ asn: peerPublicAsn ?? 0 }],
      interfaces_eth0: [{ ipv6_static: `${peerPublicIp}/64` }],
    });
  };

  const extractInterfaceIpv6ByName = (cfg: any, ifName?: string): string | undefined => {
    if (!cfg || !ifName) return undefined;
    for (const k of Object.keys(cfg)) {
      if (!k.startsWith('interfaces_') && !k.startsWith('subinterfaces_')) continue;
      const arr = (cfg as any)[k];
      if (!Array.isArray(arr)) continue;
      for (const it of arr) {
        if (String(it?.name || '') === ifName) {
          return ipv6HostFromRaw(it?.ipv6_static || it?.ipv6);
        }
      }
    }
    return undefined;
  };

  // PE+CE 模式：在 PE 的第二个 ASN 结构体（内网自治域）中追加本端 CE 的公网IP与其“内”ASN
   const injectNeighborsForPEToCE = (selfCfg: any, ceCfg: any, bgpVrf?: any): any => {
    try {
      const cloned = JSON.parse(JSON.stringify(selfCfg || {}));
      const cePublicIp = extractPortIp(ceCfg, 0); // CE 外网口：IPv4 优先（专家样例），否则 IPv6
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
      const peInnerIp = (peCfg as any)?._inner_ip_override || extractPortIp(peCfg, 1); // 内网口常为 IPv4
      const peAsnInner = extractBgpAsnAt(peCfg, 1); // PE 第二个结构体 ASN
      if (!peInnerIp) return cloned;
      const bgpArr = Array.isArray((cloned as any)?.bgp) ? (cloned as any).bgp : [];
      const bgp0 = bgpArr[0]; // 明确仅在第一个结构体追加（与 ce2 专家一致：不写 neighbor_disable_connected_check）
      if (!bgp0 || typeof bgp0 !== 'object') return cloned;
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

  /**
   * 将 RD/RT 写入指定 BGP 结构体中的「ipv4 + unicast」地址族（与 pe2 专家内网 BGP 一致）；
   * 若已有则由向导/设备生成的 address_family 条目上合并，否则追加一条。
   */
  const injectRdRtIntoIpv4UnicastAfAtBgpIndex = (cfg: any, bgpIndex: number, rd: string, rt: string): any => {
    try {
      const cloned = JSON.parse(JSON.stringify(cfg || {}));
      const bgpArr = Array.isArray((cloned as any)?.bgp) ? (cloned as any).bgp : [];
      const bgp = bgpArr[bgpIndex];
      if (!bgp || typeof bgp !== 'object') return cloned;
      const afArr = Array.isArray(bgp.address_family) ? [...bgp.address_family] : [];
      const modOf = (af: any) => String(af?.modifier || af?.modifiler || '').toLowerCase();
      const isIpv4Unicast = (af: any) =>
        String(af?.address_family || '').toLowerCase() === 'ipv4' && modOf(af) === 'unicast';
      let idx = afArr.findIndex(isIpv4Unicast);
      if (idx < 0) idx = afArr.findIndex((af: any) => String(af?.address_family || '').toLowerCase() === 'ipv4');
      if (idx >= 0) {
        const cur = afArr[idx] || {};
        afArr[idx] = {
          ...cur,
          address_family: cur.address_family || 'ipv4',
          modifiler: cur.modifiler || cur.modifier || 'unicast',
          export_route: cur.export_route || 'enable',
          import_route: cur.import_route || 'enable',
          auto_assign_sid: cur.auto_assign_sid || 'enable',
          route_distinguisher: rd,
          route_target: rt,
        };
        delete (afArr[idx] as any).modifier;
      } else {
        afArr.push({
          address_family: 'ipv4',
          modifiler: 'unicast',
          export_route: 'enable',
          import_route: 'enable',
          auto_assign_sid: 'enable',
          route_distinguisher: rd,
          route_target: rt,
        });
      }
      bgp.address_family = afArr;
      return cloned;
    } catch (_) {
      return cfg;
    }
  };

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

  // 无 VRF（或 vrf 为 0）的 BGP 结构体视为「公网/global」段，与 injectNeighborsForPEPeer 判定一致
  const isPublicBgpBlock = (b: any) =>
    b && typeof b === 'object' && (!b.vrf || b.vrf === 0 || b.vrf === '0');

  const computePublicBgpIndex = (cfg: any): number => {
    try {
      const bgpArr = Array.isArray((cfg as any)?.bgp) ? (cfg as any).bgp : [];
      const idx = bgpArr.findIndex(isPublicBgpBlock);
      return idx >= 0 ? idx : 0;
    } catch {
      return 0;
    }
  };

  /** pe 元数据中公网 BGP 下标：新 pe.publicConfig.publicBgpIndex；旧 pe.publicBgpIndex */
  const readPePublicBgpIndex = (pe: any): number | undefined => {
    if (!pe || typeof pe !== 'object') return undefined;
    const pc = pe.publicConfig;
    if (pc && typeof pc === 'object' && typeof pc.publicBgpIndex === 'number') return pc.publicBgpIndex;
    if (typeof pe.publicBgpIndex === 'number') return pe.publicBgpIndex;
    return undefined;
  };

  const mergePublicBgpIndexIntoPe = (prevPe: any, idx: number): any => {
    const base = prevPe && typeof prevPe === 'object' ? { ...prevPe } : {};
    if (base.publicConfig && typeof base.publicConfig === 'object') {
      return {
        ...base,
        publicConfig: { ...base.publicConfig, publicBgpIndex: idx },
      };
    }
    return { ...base, publicBgpIndex: idx };
  };

  /** 预览/下发前深拷贝，保留 pe、ce、role 等与设备回读一致的顶层字段 */
  const sanitizeForDevice = (cfg: any): any => {
    try {
      return JSON.parse(JSON.stringify(cfg || {}));
    } catch {
      return cfg;
    }
  };

  /** 平台 vr-config 保存（PE）：设备体 + pe.publicConfig.publicBgpIndex（兼容旧扁平 pe） */
  const buildPeConfigForPlatformStorage = (injectedFull: any): any => {
    try {
      const idx = computePublicBgpIndex(injectedFull);
      const prevPe =
        injectedFull && typeof injectedFull === 'object' && injectedFull.pe && typeof injectedFull.pe === 'object'
          ? injectedFull.pe
          : {};
      const device = sanitizeForDevice(injectedFull);
      return {
        ...device,
        pe: mergePublicBgpIndexIntoPe(prevPe, idx),
      };
    } catch {
      return sanitizeForDevice(injectedFull);
    }
  };

  /** 拉取 PE 后补全公网 BGP 下标（写入 publicConfig 或 legacy 顶层） */
  const enrichPeConfigWithPublicBgpMeta = (cfg: any): any => {
    if (!cfg) return cfg;
    try {
      const c = JSON.parse(JSON.stringify(cfg));
      const idx = computePublicBgpIndex(c);
      const prevPe = c.pe && typeof c.pe === 'object' ? c.pe : {};
      c.pe = mergePublicBgpIndexIntoPe(prevPe, idx);
      return c;
    } catch {
      return cfg;
    }
  };

  /** 从设备/平台配置提取对端 SRv6 SID 前缀（segment_routing_srv6.prefix 或 pe.publicConfig.sidPrefix） */
  const extractSrv6Prefix = (cfg: any): string | undefined => {
    try {
      const sr = (cfg && (cfg as any).segment_routing_srv6) || undefined;
      const top = (sr as any)?.prefix;
      if (typeof top === 'string' && top.trim().length > 0) return top.trim();
      const pe = (cfg as any)?.pe;
      const legacy =
        pe?.publicConfig?.sidPrefix ??
        pe?.sidPrefix ??
        (cfg as any)?.sidPrefix;
      return typeof legacy === 'string' && legacy.trim().length > 0 ? legacy.trim() : undefined;
    } catch {
      return undefined;
    }
  };

  /**
   * 向顶层写入两条 IPv6 静态路由：
   * 1. 对端 PE SID 网段/64 路由（不带 vrf），via 为对端 PE 公网 IPv6
   * 2. VRF 默认路由 ::/0（带 vrf），via 固定为 "nexthop-vrf 0"，使 VRF 内流量可经由公网表转发
   *
   * 去重策略：对相同 via 且不带 vrf 的 IPv6 路由只保留本次注入的一条；
   * 对相同 vrf 且 destination 为 ::/0 的条目也只保留一条。
   */
  const injectIpv6RouteTop = (cfg: any, destination?: string, via?: string, vrf?: number | string): any => {
    if (!destination || !via) return cfg;
    try {
      const cloned = JSON.parse(JSON.stringify(cfg || {}));
      const arr = Array.isArray((cloned as any).ipv6_route) ? (cloned as any).ipv6_route : [];
      const vrfKey = (v: any) => String(v ?? '');
      // 去重：去掉同 via、不带 vrf 的旧 IPv6 路由（避免公网侧重复）
      const filtered = arr.filter((r: any) => {
        const dest = String(r?.destination || '');
        if (!dest.includes(':')) return true;
        if (String(r?.via || '') !== String(via)) return true;
        if (vrfKey(r?.vrf) !== '') return true; // 保留带 vrf 的条目
        return false;
      });
      // 条目 1：对端 SID 网段路由，不带 vrf，走公网转发
      filtered.push({ destination, via });
      // 条目 2：VRF 默认路由，带 vrf，via 固定为 nexthop-vrf 0
      if (vrf !== undefined) {
        // 去重：去掉同 vrf 下已有的 ::/0 默认路由
        const withoutVrfDefault = filtered.filter((r: any) => {
          if (vrfKey(r?.vrf) === vrfKey(vrf) && String(r?.destination || '') === '::/0') return false;
          return true;
        });
        withoutVrfDefault.push({ destination: '::/0', vrf, via: 'nexthop-vrf 0' });
        (cloned as any).ipv6_route = withoutVrfDefault;
      } else {
        (cloned as any).ipv6_route = filtered;
      }
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
    const { msg: _msg, code: _code, report_config_status: _report_config_status, updateDate: _updateDate, createDate: _createDate, _id, requestId: _requestId, ...rest } = obj as any;
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
      const json = await fetchVrCachePageList(pageSize, pageNum);
      const cacheData: any = (json && (json as any).data) ? (json as any).data : json;
      const cacheRaw = (cacheData && cacheData.data) ? cacheData.data : cacheData;
      const parsed = typeof cacheRaw === 'string' ? safeJsonParse(cacheRaw) : cacheRaw;
      const list: any[] = Array.isArray(parsed?.page)
        ? parsed.page
        : Array.isArray(parsed?.list)
        ? parsed.list
        : Array.isArray(parsed?.rows)
        ? parsed.rows
        : Array.isArray(parsed)
        ? (parsed as any[])
        : [];
      
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
    const filtered = items.filter((x) => !!x.uuid && (x.role === 'SPOKE_PE' || x.role === 'HUB_PE'));
    return filtered.map((x) => ({
      value: x.uuid,
      label: `${x.label}${x.role === 'HUB_PE' ? ' · Hub' : x.role === 'SPOKE_PE' ? ' · Spoke' : ''}`,
    }));
  }, [vrs, rolesMap]);

  const _vrsView = useMemo(() => {
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

  const getPeRole = (uuid?: string) =>
    String(uuid ? rolesMapRef.current[uuid] || rolesMap[uuid] || '' : '').toUpperCase();

  const inferredTopology = useMemo(() => {
    const peA = formValues?.peA ?? form.getFieldValue('peA');
    const peB = formValues?.peB ?? form.getFieldValue('peB');
    return inferTunnelTopologyFromRoles(getPeRole(peA), getPeRole(peB));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formValues?.peA, formValues?.peB, rolesMap]);

  const inferredHubPeSlot = useMemo(
    () => resolveHubPeSlotFromRoles(getPeRole(formValues?.peA), getPeRole(formValues?.peB)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [formValues?.peA, formValues?.peB, rolesMap],
  );

  const hubPortRegistry = useMemo(() => {
    if (!inferredHubPeSlot) return [];
    const status = peHubStatus[inferredHubPeSlot];
    return status?.portRegistry ?? [];
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inferredHubPeSlot, peHubStatus, formValues]);

  const hubInventoryUi = useMemo(() => {
    if (!inferredHubPeSlot) return undefined;
    return peHubStatus[inferredHubPeSlot]?.hubInventoryUi;
  }, [inferredHubPeSlot, peHubStatus]);

  const hubWanInventoryOptions = useMemo(() => {
    const rows = hubInventoryUi?.wanOptions ?? [];
    return rows
      .filter((o) => o.selectable !== false)
      .map((o) => ({
        value: o.id,
        label: o.label || `${o.ifName} · ${o.ipv6}`,
        ifName: o.ifName,
        disabled: o.selectable === false,
      }));
  }, [hubInventoryUi]);

  const hubLanInventoryOptions = useMemo(() => {
    const rows = hubInventoryUi?.lanOptions ?? [];
    return rows
      .filter((o) => o.selectable !== false)
      .map((o) => ({
        value: o.id,
        label: o.label || `${o.ifName} · VRF ${o.vrf}`,
        ifName: o.ifName,
        vrf: o.vrf,
        disabled: o.selectable === false,
      }));
  }, [hubInventoryUi]);

  const renderHubPortRegistry = () => {
    if (!hubPortRegistry.length) return null;
    return (
      <Alert
        type="warning"
        showIcon
        style={{ marginBottom: 12 }}
        message="Hub WAN 口占用"
        description={
          <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
            {hubPortRegistry.map((e) => (
              <li key={e.tunnelId}>
                {e.tunnelName}：{e.wanIf} → 邻居 {e.peerPublicNeighbor}
              </li>
            ))}
          </ul>
        }
      />
    );
  };

  const wizardMetaEmpty = (v: any) =>
    v == null || typeof v !== 'object' || Array.isArray(v) || Object.keys(v).length === 0;

  /**
   * 仍以设备实时为底；仅当设备 JSON 里没有向导块 pe/ce 时，用平台 vr-config 缓存补一层（CSM 常不回显这些键）。
   */
  const fillWizardMetaGapsFromTower = (deviceNorm: any, towerNorm: any | null): any => {
    if (!deviceNorm) return towerNorm ? JSON.parse(JSON.stringify(towerNorm)) : null;
    if (!towerNorm) return deviceNorm;
    const d = JSON.parse(JSON.stringify(deviceNorm));
    if (!wizardMetaEmpty(towerNorm.pe) && wizardMetaEmpty(d.pe)) {
      d.pe = JSON.parse(JSON.stringify(towerNorm.pe));
    }
    if (!wizardMetaEmpty(towerNorm.ce) && wizardMetaEmpty(d.ce)) {
      d.ce = JSON.parse(JSON.stringify(towerNorm.ce));
    }
    return d;
  };

  // 先拉设备实时，再按需补 pe/ce 元数据缺口
  const fetchAndSetPeConfig = async (target: 'peA' | 'peB', uuid: string) => {
    if (!uuid) return;
    try {
      const cfgRaw = await getVR2Config(uuid);
      let cfg = normalizeVRConfigForPreview(cfgRaw);
      const towerRaw = await getVRConfig(uuid);
      const towerNorm = towerRaw ? normalizeVRConfigForPreview(towerRaw) : null;
      cfg = fillWizardMetaGapsFromTower(cfg, towerNorm);
      setPeConfigs((prev) => ({ ...prev, [target]: enrichPeConfigWithPublicBgpMeta(cfg) }));
    } catch (e: any) {
      console.warn('获取PE配置失败(设备实时):', e?.message || e);
      setPeConfigs((prev) => ({ ...prev, [target]: null }));
    }
  };

  const fetchAndSetCeConfig = async (target: 'ceA' | 'ceB', uuid: string) => {
    if (!uuid) return;
    try {
      const cfgRaw = await getVR2Config(uuid);
      let cfg = normalizeVRConfigForPreview(cfgRaw);
      const towerRaw = await getVRConfig(uuid);
      const towerNorm = towerRaw ? normalizeVRConfigForPreview(towerRaw) : null;
      cfg = fillWizardMetaGapsFromTower(cfg, towerNorm);
      setCeConfigs((prev) => ({ ...prev, [target]: cfg }));
    } catch (e: any) {
      console.warn('获取CE配置失败(设备实时):', e?.message || e);
      setCeConfigs((prev) => ({ ...prev, [target]: null }));
    }
  };

  const handleValuesChange = async (changed: any, all: any) => {
    if (changed?.peA) {
      await fetchAndSetPeConfig('peA', changed.peA);
      form.setFieldsValue({ peAInnerIf: undefined });
      await refreshPeHubStatus('peA', changed.peA);
    }
    if (changed?.peB) {
      await fetchAndSetPeConfig('peB', changed.peB);
      form.setFieldsValue({ peBInnerIf: undefined });
      await refreshPeHubStatus('peB', changed.peB);
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

  // 计算本次隧道的公共 RT 与各端唯一 RD（Hub REUSE 时继承首条隧道 RT/RD）
  const [rdRtMeta, setRdRtMeta] = useState<{ rtCommon: string; rdMap: Record<string, string> } | null>(null);

  const inheritReuseVrfRdRtMeta = async (): Promise<boolean> => {
    if (editId) return false;
    if (inferredTopology !== 'H' || form.getFieldValue('hubCustomerSide') !== 'reuse') return false;
    const hubSlot = inferredHubPeSlot;
    if (!hubSlot) return false;
    const status = peHubStatus[hubSlot];
    const firstRef = status?.tunnels?.[0];
    if (!firstRef?.tunnelId) return false;
    try {
      const refTunnel = await fetchSrv6Tunnel(firstRef.tunnelId);
      const meta = refTunnel?.rdRtMeta;
      if (meta?.rtCommon && meta?.rdMap?.peA && meta?.rdMap?.peB) {
        setRdRtMeta({ rtCommon: meta.rtCommon, rdMap: { peA: meta.rdMap.peA, peB: meta.rdMap.peB } });
        return true;
      }
    } catch {
      /* 回退随机生成 */
    }
    return false;
  };

  useEffect(() => {
    if (rdRtMeta) return;
    void (async () => {
      const inherited = await inheritReuseVrfRdRtMeta();
      if (inherited) return;
      const randNum = () => 100 + Math.floor(Math.random() * 50000);
      const rtCommon = `200:${randNum()}`;
      const rdMap = { peA: `200:${randNum()}`, peB: `200:${randNum()}` };
      setRdRtMeta({ rtCommon, rdMap });
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps -- 仅在尚未生成 rdRtMeta 时初始化
  }, [rdRtMeta]);

  useEffect(() => {
    if (editId || rdRtMeta) return;
    if (inferredTopology !== 'H' || form.getFieldValue('hubCustomerSide') !== 'reuse') return;
    void inheritReuseVrfRdRtMeta();
  }, [editId, inferredTopology, inferredHubPeSlot, peHubStatus, formValues?.hubCustomerSide, rdRtMeta]);

  /** 公共 PE 注入逻辑：PE-PE 邻居 + PE-CE 邻居 + RD/RT + 两条 IPv6 路由（SID/64 + VRF ::/0） */
  const buildInjectedPeConfig = (
    selfKey: 'peA' | 'peB',
  ): { preview: any; storage: any } => {
    const selfCfg = peConfigs[selfKey];
    const peerKey = selfKey === 'peA' ? 'peB' : 'peA';
    const peerCfg = peConfigs[peerKey];
    const ceCfg = ceConfigs[selfKey === 'peA' ? 'ceA' : 'ceB'];
    const innerIfField = selfKey === 'peA' ? 'peAInnerIf' : 'peBInnerIf';
    const rdKey = selfKey === 'peA' ? 'peA' : 'peB';

    const innerIf: string | undefined = form.getFieldValue(innerIfField);
    const vrf = selfCfg && innerIf ? extractInterfaceVrf(selfCfg, innerIf) : undefined;
    const hubWanIf: string | undefined = form.getFieldValue('hubWanIf');
    const topo = inferredTopology;
    const hubSlot = inferredHubPeSlot ?? undefined;

    let c = selfCfg;
    const peerKeyForPublic = selfKey === 'peA' ? 'peB' : 'peA';
    const peerCfgForPublic = peConfigs[peerKeyForPublic];
    let peerPublicIp: string | undefined;
    let peerAsn: number | undefined;
    if (topo === 'H' && hubSlot) {
      if (selfKey === hubSlot) {
        peerPublicIp = extractPortIpv6(peerCfgForPublic, 0);
        peerAsn = extractBgpAsnAt(peerCfgForPublic, 0);
      } else {
        const hubCfg = peConfigs[hubSlot];
        peerPublicIp =
          (hubWanIf && hubCfg ? extractInterfaceIpv6ByName(hubCfg, hubWanIf) : undefined) ??
          extractPortIpv6(hubCfg, 0);
        peerAsn = extractBgpAsnAt(hubCfg, 0);
      }
    } else if (peerCfgForPublic) {
      peerPublicIp = extractPortIpv6(peerCfgForPublic, 0);
      peerAsn = extractBgpAsnAt(peerCfgForPublic, 0);
    }
    if (c && peerPublicIp) c = injectNeighborsForPEPeerIp(c, peerPublicIp, peerAsn);
    else if (c && peerCfg) c = injectNeighborsForPEPeer(c, peerCfg);
    if (c && ceCfg) c = injectNeighborsForPEToCE(c, ceCfg, vrf);
    if (c && rdRtMeta?.rtCommon && rdRtMeta?.rdMap?.[rdKey] && vrf !== undefined) {
      const idx = findBgpIndexByVrf(c, vrf);
      c = injectRdRtIntoIpv4UnicastAfAtBgpIndex(c, idx !== undefined ? idx : 1, rdRtMeta.rdMap[rdKey], rdRtMeta.rtCommon);
    }
    // IPv6 路由：注入两条——①对端 SID/64 路由(不带 vrf，via=对端PE公网IPv6) ②VRF默认路由 ::/0(带 vrf，via=nexthop-vrf 0)
    const peerPrefix = peerCfg ? extractSrv6Prefix(peerCfg) : undefined;
    const srv6PeerDest = buildSrv6PeerRouteDestination(peerPrefix);
    const via = peerCfg ? resolveSid64Via(selfCfg, peerCfg) : undefined;
    if (c && srv6PeerDest && via && vrf !== undefined) c = injectIpv6RouteTop(c, srv6PeerDest, via, vrf);

    return {
      preview: c ? sanitizeForDevice(c) : null,
      storage: c ? buildPeConfigForPlatformStorage(c) : null,
    };
  };

  // 计算注入邻居后的预览配置（复用 buildInjectedPeConfig：SID/64 + VRF ::/0 双路由）
  // eslint-disable-next-line react-hooks/exhaustive-deps -- buildInjectedPeConfig 为同渲染周期内辅助函数，依赖 peConfigs/ceConfigs/rdRtMeta/formValues
  const peAInjected = useMemo(() => buildInjectedPeConfig('peA'), [peConfigs, ceConfigs, rdRtMeta, formValues, inferredTopology, inferredHubPeSlot]);
  const peAPreviewCfg = peAInjected.preview;
  const peAPreviewStorageCfg = peAInjected.storage;

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const peBInjected = useMemo(() => buildInjectedPeConfig('peB'), [peConfigs, ceConfigs, rdRtMeta, formValues, inferredTopology, inferredHubPeSlot]);
  const peBPreviewCfg = peBInjected.preview;
  const peBPreviewStorageCfg = peBInjected.storage;

  // CE 预览：仅注入 PE 内网 neighbor（与 ce2 一致：无 RD/RT、无 neighbor_disable_connected_check）
  const ceAPreviewCfg = useMemo(() => {
    const ceA = ceConfigs.ceA;
    const peA = peConfigs.peA;
    const peAInnerIf: string | undefined = form.getFieldValue('peAInnerIf');
    const peAInnerIp = peAInnerIf ? extractInterfaceIp(peA, peAInnerIf) : extractPortIp(peA, 1);
    const injected = ceA && peA ? injectConnectionsForCE(ceA, peAInnerIp ? { ...peA, _inner_ip_override: peAInnerIp } : peA) : ceA;
    return injected ? sanitizeForDevice(injected) : null;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ceConfigs, peConfigs, formValues]);

  const ceBPreviewCfg = useMemo(() => {
    const ceB = ceConfigs.ceB;
    const peB = peConfigs.peB;
    const peBInnerIf: string | undefined = form.getFieldValue('peBInnerIf');
    const peBInnerIp = peBInnerIf ? extractInterfaceIp(peB, peBInnerIf) : extractPortIp(peB, 1);
    const injected = ceB && peB ? injectConnectionsForCE(ceB, peBInnerIp ? { ...peB, _inner_ip_override: peBInnerIp } : peB) : ceB;
    return injected ? sanitizeForDevice(injected) : null;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ceConfigs, peConfigs, formValues]);

  // 打开 PE 配置弹窗
  const _openPeDialog = (target: 'peA' | 'peB') => {
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
  const _goExpertMode = (target: 'peA' | 'peB') => {
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
      message.error(`请先选择 ${target === 'peA' ? 'PE-A' : target === 'peB' ? 'PE-B' : target === 'ceA' ? 'CE-A' : 'CE-B'} 的 VR 实例`);
      return;
    }
    const url = target.startsWith('pe')
      ? `/admin/interconnect/vr/${uuid}/role-pe`
      : `/admin/interconnect/vr/${uuid}/role-ce`;
    const peRoleQs =
      target.startsWith('pe')
        ? `?peRole=${encodeURIComponent(getPeRole(uuid) === 'HUB_PE' ? 'HUB_PE' : 'SPOKE_PE')}`
        : '';
    window.open(`${url}${peRoleQs}`, '_blank');
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const _configPreview = useMemo(() => buildTunnelConfigFromValues(deferredValues || {}), [deferredValues, mode]);

  /** 仅在前两步回退时清空「已保存」标记；从下发向导回到确认页仍保留（避免重复点创建） */
  useEffect(() => {
    if (current === 0 || current === 1) setPlatformSaved(false);
  }, [current]);

  /** 校验隧道表单（与原先提交前一致） */
  const validateTunnelForm = (): boolean => {
    const values = form.getFieldsValue(true);
    const peA = values?.peA;
    const peB = values?.peB;
    const ceA = values?.ceA;
    const ceB = values?.ceB;
    const tunnelName = String(values?.tunnelName || '').trim();
    const peAInnerIf = values?.peAInnerIf;
    const peBInnerIf = values?.peBInnerIf;

    if (peA && peB && String(peA) === String(peB)) {
      message.error('PE-A 与 PE-B 不能相同');
      return false;
    }
    if (ceA && ceB && String(ceA) === String(ceB)) {
      message.error('CE-A 与 CE-B 不能相同');
      return false;
    }
    if (!tunnelName || !peA || !peB || !ceA || !ceB) {
      message.error('请完成隧道名称、PE/CE 选择');
      return false;
    }
    if (!peAInnerIf || !peBInnerIf) {
      message.error('请在“选择 PE”步骤中选择 PE-A 与 PE-B 的内网口');
      return false;
    }
    const peAHasVrf = extractInterfaceVrf(peConfigs.peA, peAInnerIf);
    const peBHasVrf = extractInterfaceVrf(peConfigs.peB, peBInnerIf);
    if (!peAHasVrf || !peBHasVrf) {
      message.error('所选内网口未携带 VRF，无法识别内网配置组，请重新选择带 VRF 的接口');
      return false;
    }
    
    // 后端控制：SRv6 segment_routing_srv6.prefix 不允许带掩码（例如 /64）
    const peAPrefix = extractSrv6Prefix(peConfigs.peA);
    if (peAPrefix && peAPrefix.includes('/')) {
      message.error('PE-A 的 SRv6 SID 前缀不允许包含/掩码，请去掉 /xx');
      return false;
    }
    const peBPrefix = extractSrv6Prefix(peConfigs.peB);
    if (peBPrefix && peBPrefix.includes('/')) {
      message.error('PE-B 的 SRv6 SID 前缀不允许包含/掩码，请去掉 /xx');
      return false;
    }

    const rA = getPeRole(peA);
    const rB = getPeRole(peB);
    if (rA === 'HUB_PE' && rB === 'HUB_PE') {
      message.error('Hub–Spoke 隧道不能两端均为 HUB_PE');
      return false;
    }
    if (inferredTopology === 'H') {
      const hubCustomerSide = values?.hubCustomerSide;
      const hubWanPickMode = values?.hubWanPickMode ?? 'select';
      if (hubWanPickMode === 'inline') {
        if (!values?.hubWanInlineIfName || !values?.hubWanInlineIpv6) {
          message.error('内联新建 Hub WAN 须填写接口名与 IPv6');
          return false;
        }
      } else if (!values?.hubWanInventoryId && !values?.hubWanIf) {
        message.error('Hub–Spoke 隧道须从 Hub WAN inventory 选用公网口');
        return false;
      }
      if (hubCustomerSide === 'dedicated') {
        const lanPick = values?.hubLanPickMode ?? 'select';
        if (lanPick === 'inline') {
          if (
            !values?.hubLanInlineIfName ||
            !values?.hubLanInlineVrf ||
            !values?.hubLanInlineAsn ||
            !values?.hubLanInlineRouterId
          ) {
            message.error('路线 B 内联新建须完整填写 LAN Bundle');
            return false;
          }
        } else if (!values?.hubLanInventoryId && !values?.hubLanIf) {
          message.error('路线 B 须从 Hub LAN inventory 选用专网口');
          return false;
        }
      }
      if (!hubCustomerSide) {
        message.error('请选择客户侧网络配置方式');
        return false;
      }
    } else if (rA === 'HUB_PE' || rB === 'HUB_PE') {
      message.error('一端为 HUB_PE 时，另一端须为 SPOKE_PE');
      return false;
    }

    return true;
  };

  /** 第 3 步：创建隧道记录 + 仅保存平台库（不下发设备）；下发在下一步向导中分步执行 */
  const saveTunnelPlatformOnly = async () => {
    if (!validateTunnelForm()) return;
    commitPreview();
    const values = form.getFieldsValue(true);
    const peA = values?.peA;
    const peB = values?.peB;
    const ceA = values?.ceA;
    const ceB = values?.ceB;
    const tunnelName = String(values?.tunnelName || '').trim();
    setPlatformSaveLoading(true);
    try {
      const { createSrv6Tunnel, updateSrv6Tunnel } = await import('../../../../services/api');
      const { buildTunnelArchive } = await import('./srv6Archive');
      const hubVrfMode: Srv6HubVrfMode =
        values?.hubCustomerSide === 'dedicated' ? 'DEDICATED_VRF' : 'REUSE_VRF';
      const hubWanIfResolved =
        values?.hubWanPickMode === 'inline'
          ? String(values?.hubWanInlineIfName || '').trim()
          : values?.hubWanIf;
      const hubLanIfResolved =
        hubVrfMode === 'DEDICATED_VRF' && values?.hubLanPickMode === 'inline'
          ? String(values?.hubLanInlineIfName || '').trim()
          : values?.hubLanIf;
      const hubInventoryInline =
        inferredTopology === 'H'
          ? (() => {
              const inline: Record<string, unknown> = {};
              if (values?.hubWanPickMode === 'inline' && hubWanIfResolved) {
                inline.wan = {
                  ifName: hubWanIfResolved,
                  ipv4: values?.hubWanInlineIpv4?.trim() || undefined,
                  ipv6: String(values?.hubWanInlineIpv6 || '').trim(),
                };
              }
              if (
                hubVrfMode === 'DEDICATED_VRF' &&
                values?.hubLanPickMode === 'inline' &&
                hubLanIfResolved
              ) {
                inline.lan = {
                  ifName: hubLanIfResolved,
                  vrf: Number(values?.hubLanInlineVrf),
                  ipv4: values?.hubLanInlineIpv4?.trim() || undefined,
                  ipv6: values?.hubLanInlineIpv6?.trim() || undefined,
                  privateAsn: Number(values?.hubLanInlineAsn),
                  routerId: String(values?.hubLanInlineRouterId || '').trim(),
                };
              }
              return Object.keys(inline).length ? inline : undefined;
            })()
          : undefined;
      const archive = buildTunnelArchive({
        peA: String(peA),
        peB: String(peB),
        peAInnerIf: values?.peAInnerIf,
        peBInnerIf: values?.peBInnerIf,
        peConfigs,
        ceConfigs,
        peStorageCfgs: {
          peA: peAPreviewStorageCfg,
          peB: peBPreviewStorageCfg,
        },
        cePreviewCfgs: { ceA: ceAPreviewCfg, ceB: ceBPreviewCfg },
        rdRtMeta,
        tunnelTopology: inferredTopology || 'S',
        hubPeSlot: inferredHubPeSlot ?? undefined,
        hubVrfMode: inferredTopology === 'H' ? hubVrfMode : undefined,
        hubWanIf: hubWanIfResolved,
        hubLanIf: hubLanIfResolved,
        hubWanInventoryId:
          values?.hubWanPickMode === 'inline' ? undefined : values?.hubWanInventoryId,
        hubLanInventoryId:
          values?.hubLanPickMode === 'inline' ? undefined : values?.hubLanInventoryId,
        hubInventory: hubInventoryUi?.inventory,
      });
      const payload = {
        name: tunnelName,
        peA: String(peA),
        peB: String(peB),
        ceA: String(ceA),
        ceB: String(ceB),
        ...(hubInventoryInline ? { hubInventoryInline } : {}),
        ...archive,
      };
      if (editId) {
        await updateSrv6Tunnel(editId, payload);
      } else {
        await createSrv6Tunnel(payload);
      }
      // P2：四端 config_json 由服务端 baseline+Σcontrib 重算落库，不再前端直写注入预览态
      setPlatformSaved(true);
      message.success(
        `隧道已${editId ? '更新' : '创建'}，四端生效配置已由平台重算并写入库。请进入「下发向导」分步推送到设备。`,
      );
    } catch (err: any) {
      const conflictList = err?.conflicts ?? err?.responseData?.conflicts;
      const detail =
        Array.isArray(conflictList) && conflictList.length
          ? conflictList.map((c: { message?: string }) => c.message).filter(Boolean).join('；')
          : '';
      const baseMsg = err?.message || '请稍后重试';
      const showMsg =
        detail || (baseMsg.startsWith('无法保存隧道') ? baseMsg : `保存失败：${baseMsg}`);
      message.error(showMsg, 8);
    } finally {
      setPlatformSaveLoading(false);
    }
  };

  async function executeSrv6DeployStep(stepIndex: number) {
    setDeployStatus((prev) => ({ ...prev, [stepIndex]: 'process' }));
    setDeployLogs((prev) => ({ ...prev, [stepIndex]: '执行中…' }));
    try {
      const seq = deployVrSeqRef.current;
      const vrIdx = Math.floor(stepIndex / 2);
      const entry = seq[vrIdx];
      if (!entry?.id) throw new Error(`缺少 ${entry?.label || 'VR'} 的 UUID`);
      let logMsg = '';
      if (stepIndex % 2 === 0) {
        const res: any = await apiRequest(
          `/api/networks/srv6/deploy/preview?vrId=${encodeURIComponent(entry.id)}`,
          { skipCache: true },
        );
        if (res?.error) throw new Error(res.error);
        logMsg = `[${entry.label}] 平台待下发配置（清洗后）\n${JSON.stringify(res.config, null, 2)}`;
      } else {
        const res: any = await apiPost('/api/networks/srv6/deploy/push', { vrId: entry.id });
        if (res?.error) throw new Error(res.error);
        logMsg = `[${entry.label}] 下发设备响应\nHTTP 状态: ${res.status}\nBody:\n${JSON.stringify(res.data ?? res, null, 2)}`;
        if (res.status !== 200 && res.status !== 201) throw new Error(`设备侧返回 HTTP ${res.status}`);
      }
      setDeployLogs((prev) => ({ ...prev, [stepIndex]: logMsg }));
      setDeployStatus((prev) => ({ ...prev, [stepIndex]: 'finish' }));
      setDeployStep(stepIndex + 1);
      if (stepIndex < SRV6_DEPLOY_STEP_DEFS.length - 1) {
        setTimeout(() => void executeSrv6DeployStep(stepIndex + 1), 500);
      } else {
        message.success('四台 VR 下发流程已执行完毕');
      }
    } catch (e: any) {
      console.error(e);
      setDeployLogs((prev) => ({ ...prev, [stepIndex]: `[Error] ${e?.message || String(e)}` }));
      setDeployStatus((prev) => ({ ...prev, [stepIndex]: 'error' }));
    }
  }

  useEffect(() => {
    if (current !== 3) {
      deployAutoStartedRef.current = false;
      return;
    }
    if (deployAutoStartedRef.current) return;
    deployAutoStartedRef.current = true;
    const v = form.getFieldsValue(true);
    deployVrSeqRef.current = [
      { label: 'PE-A', id: String(v.peA || '') },
      { label: 'PE-B', id: String(v.peB || '') },
      { label: 'CE-A', id: String(v.ceA || '') },
      { label: 'CE-B', id: String(v.ceB || '') },
    ];
    setDeployStep(0);
    setDeployLogs({});
    const initStatus: Record<number, 'wait' | 'process' | 'finish' | 'error'> = {};
    for (let i = 0; i < SRV6_DEPLOY_STEP_DEFS.length; i++) initStatus[i] = 'wait';
    setDeployStatus(initStatus);
    const t = window.setTimeout(() => void executeSrv6DeployStep(0), 400);
    return () => {
      window.clearTimeout(t);
      deployAutoStartedRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 仅在进入第 4 步时触发自动下发链
  }, [current]);

  const next = () => setCurrent((c) => Math.min(c + 1, 3));
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
              {renderPeHubAlert('peA', 'PE-A')}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 0 }}>
                <Button size="small" type="link" icon={<ExportOutlined />} onClick={() => openRoleWizard('peA')}>角色配置向导</Button>
              </div>
              <Form.Item 
                name="peAInnerIf" 
                label="选择 PE-A 内网口" 
                rules={[{ required: true, message: '请选择 PE-A 内网口' }]} 
                extra={( () => { const sel = form.getFieldValue('peAInnerIf'); const vrf = extractInterfaceVrf(peConfigs.peA, sel); const ip = extractInterfaceIp(peConfigs.peA, sel); return <span style={{ color: '#999' }}>VRF: {vrf ?? '-'} · IP: {ip ?? '-'}</span>; })()}
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
              {renderPeHubAlert('peB', 'PE-B')}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 0 }}>
                <Button size="small" type="link" icon={<ExportOutlined />} onClick={() => openRoleWizard('peB')}>角色配置向导</Button>
              </div>
              <Form.Item 
                name="peBInnerIf" 
                label="选择 PE-B 内网口" 
                rules={[{ required: true, message: '请选择 PE-B 内网口' }]} 
                extra={( () => { const sel = form.getFieldValue('peBInnerIf'); const vrf = extractInterfaceVrf(peConfigs.peB, sel); const ip = extractInterfaceIp(peConfigs.peB, sel); return <span style={{ color: '#999' }}>VRF: {vrf ?? '-'} · IP: {ip ?? '-'}</span>; })()}
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
          {inferredTopology === 'H' && inferredHubPeSlot ? (
            <>
              <div style={{ fontSize: 13, color: '#1677ff', margin: '16px 0 12px 0', borderBottom: '1px solid #e8e8e8', paddingBottom: 6 }}>
                Hub 互联（{inferredHubPeSlot === 'peA' ? 'PE-A · 中心 Hub' : 'PE-B · 中心 Hub'}）
              </div>
              {renderHubPortRegistry()}
              {hubInventoryUi?.inventoryEmpty ? (
                <Alert
                  type="warning"
                  showIcon
                  style={{ marginBottom: 12 }}
                  message="Hub 口清单为空"
                  description={
                    hubInventoryUi.guidance ||
                    '请先在 HUB_PE 角色配置向导维护 WAN/LAN inventory，保存后刷新本页。'
                  }
                />
              ) : null}
              <div style={{ fontSize: 12, color: 'rgba(0,0,0,.55)', marginBottom: 8 }}>
                ① Hub 公网 WAN（与路线 A/B 独立选用）
              </div>
              <Form.Item name="hubWanIf" hidden>
                <Input />
              </Form.Item>
              <Form.Item name="hubWanPickMode" label="Hub WAN 选用方式" initialValue="select">
                <Radio.Group>
                  <Radio value="select">从 inventory 选用</Radio>
                  <Radio value="inline">为本隧道内联新建</Radio>
                </Radio.Group>
              </Form.Item>
              <Form.Item noStyle shouldUpdate={(p, c) => p.hubWanPickMode !== c.hubWanPickMode}>
                {({ getFieldValue }) =>
                  getFieldValue('hubWanPickMode') === 'inline' ? (
                    <>
                      <Form.Item
                        name="hubWanInlineIfName"
                        label="新建 WAN 接口"
                        rules={[{ required: true, message: '请选择或填写 WAN 接口名' }]}
                      >
                        <Select
                          showSearch
                          allowClear
                          placeholder="选择接口"
                          options={listInterfaceOptions(
                            inferredHubPeSlot ? peConfigs[inferredHubPeSlot] : undefined,
                          )}
                        />
                      </Form.Item>
                      <Form.Item name="hubWanInlineIpv4" label="WAN IPv4（可选）">
                        <Input placeholder="例如 200.1.1.2/24" />
                      </Form.Item>
                      <Form.Item
                        name="hubWanInlineIpv6"
                        label="WAN IPv6"
                        rules={[
                          { required: true, message: '请输入 WAN IPv6' },
                          {
                            pattern: /^[0-9a-fA-F:]+\/([0-9]|[1-9]\d|1[01]\d|12[0-8])$/,
                            message: '格式示例：2408:3333:1002::1/64',
                          },
                        ]}
                      >
                        <Input placeholder="例如 2408:3333:1002::1/64" />
                      </Form.Item>
                    </>
                  ) : (
                    <Form.Item
                      name="hubWanInventoryId"
                      label="Hub WAN 口"
                      rules={[{ required: true, message: '请从 Hub WAN inventory 选用公网口' }]}
                      extra="从 Hub PE 基线 inventory 选用；同一 WAN 口可服务多条 Spoke 隧道"
                    >
                      <Select
                        options={hubWanInventoryOptions}
                        showSearch
                        allowClear
                        optionFilterProp="label"
                        placeholder={hubWanInventoryOptions.length ? '选择 Hub WAN 口' : '暂无可用 WAN inventory'}
                        onChange={(id) => {
                          const hit = hubInventoryUi?.wanOptions?.find((w) => w.id === id);
                          if (hit) form.setFieldsValue({ hubWanIf: hit.ifName });
                        }}
                      />
                    </Form.Item>
                  )
                }
              </Form.Item>
              <Form.Item
                name="hubCustomerSide"
                label="② 客户侧网络"
                rules={[{ required: true, message: '请选择客户侧网络配置方式' }]}
                initialValue="reuse"
              >
                <Radio.Group>
                  <Space direction="vertical">
                    <Radio value="reuse">路线 A：与已有隧道共用客户侧网络</Radio>
                    <Radio value="dedicated">路线 B：为本 Spoke 配置独立客户侧网络</Radio>
                  </Space>
                </Radio.Group>
              </Form.Item>
              <Form.Item noStyle shouldUpdate={(prev, cur) => prev.hubCustomerSide !== cur.hubCustomerSide}>
                {({ getFieldValue }) =>
                  getFieldValue('hubCustomerSide') === 'dedicated' ? (
                    <>
                      <Form.Item name="hubLanIf" hidden>
                        <Input />
                      </Form.Item>
                      <Form.Item name="hubLanPickMode" label="Hub LAN 选用方式" initialValue="select">
                        <Radio.Group>
                          <Radio value="select">从 inventory 选用</Radio>
                          <Radio value="inline">内联新建专网 Bundle</Radio>
                        </Radio.Group>
                      </Form.Item>
                      <Form.Item noStyle shouldUpdate={(p, c) => p.hubLanPickMode !== c.hubLanPickMode}>
                        {({ getFieldValue: gf }) =>
                          gf('hubLanPickMode') === 'inline' ? (
                            <>
                              <Form.Item
                                name="hubLanInlineIfName"
                                label="新建 LAN 接口"
                                rules={[{ required: true, message: '请选择 LAN 接口' }]}
                              >
                                <Select
                                  showSearch
                                  allowClear
                                  placeholder="选择接口"
                                  options={listInterfaceOptions(
                                    inferredHubPeSlot ? peConfigs[inferredHubPeSlot] : undefined,
                                  )}
                                />
                              </Form.Item>
                              <Form.Item
                                name="hubLanInlineVrf"
                                label="VRF ID"
                                rules={[
                                  { required: true, message: '请填写 VRF' },
                                  { type: 'number', min: 4001, message: 'VRF 最小 4001' },
                                ]}
                              >
                                <Input type="number" placeholder="例如 8888" />
                              </Form.Item>
                              <Form.Item name="hubLanInlineIpv4" label="LAN IPv4（可选）">
                                <Input />
                              </Form.Item>
                              <Form.Item name="hubLanInlineIpv6" label="LAN IPv6（可选）">
                                <Input />
                              </Form.Item>
                              <Form.Item
                                name="hubLanInlineAsn"
                                label="私网 ASN"
                                rules={[{ required: true, message: '请填写 ASN' }]}
                              >
                                <Input type="number" />
                              </Form.Item>
                              <Form.Item
                                name="hubLanInlineRouterId"
                                label="Router-ID"
                                rules={[{ required: true, message: '请填写 Router-ID' }]}
                              >
                                <Input />
                              </Form.Item>
                            </>
                          ) : (
                            <Form.Item
                              name="hubLanInventoryId"
                              label="Hub LAN 口（路线 B）"
                              rules={[{ required: true, message: '请从 Hub LAN inventory 选用专网口' }]}
                              extra="专网 VRF 段不可与其它路线 B 隧道复用"
                            >
                              <Select
                                options={hubLanInventoryOptions}
                                showSearch
                                allowClear
                                optionFilterProp="label"
                                placeholder={
                                  hubLanInventoryOptions.length ? '选择 Hub LAN 口' : '暂无可用 LAN inventory'
                                }
                                onChange={(id) => {
                                  const hit = hubInventoryUi?.lanOptions?.find((l) => l.id === id);
                                  if (hit) form.setFieldsValue({ hubLanIf: hit.ifName });
                                }}
                              />
                            </Form.Item>
                          )
                        }
                      </Form.Item>
                    </>
                  ) : null
                }
              </Form.Item>
              <Alert
                type="info"
                showIcon
                message="拓扑：Hub–Spoke"
                description={`Hub 槽位 ${inferredHubPeSlot === 'peA' ? 'PE-A' : 'PE-B'}；公网邻居判重键为对端 Spoke 公网 IPv6，同一 Hub 上不可重复。`}
              />
            </>
          ) : inferredTopology === 'S' ? (
            <Alert type="info" showIcon style={{ marginTop: 12 }} message="拓扑：Spoke 点对点" />
          ) : null}
        </Form>
      );
    }
    if (current === 2) {
      return (
        <>
          <Descriptions title="概要" bordered column={1} size="small">
            <Descriptions.Item label="隧道名称">{form.getFieldValue('tunnelName') || '-'}</Descriptions.Item>
            <Descriptions.Item label="模式">{mode || '-'}</Descriptions.Item>
            <Descriptions.Item label="PE-A">{form.getFieldValue('peA') || '-'}</Descriptions.Item>
            <Descriptions.Item label="PE-B">{form.getFieldValue('peB') || '-'}</Descriptions.Item>
            <Descriptions.Item label="CE-A">{form.getFieldValue('ceA') || '-'}</Descriptions.Item>
            <Descriptions.Item label="CE-B">{form.getFieldValue('ceB') || '-'}</Descriptions.Item>
            <Descriptions.Item label="拓扑">
              {inferredTopology === 'H' ? 'Hub–Spoke' : inferredTopology === 'S' ? 'Spoke 点对点' : '-'}
            </Descriptions.Item>
            {inferredTopology === 'H' ? (
              <>
                <Descriptions.Item label="Hub 槽位">
                  {inferredHubPeSlot === 'peA' ? 'PE-A' : inferredHubPeSlot === 'peB' ? 'PE-B' : '-'}
                </Descriptions.Item>
                <Descriptions.Item label="Hub WAN">{form.getFieldValue('hubWanIf') || '-'}</Descriptions.Item>
                <Descriptions.Item label="客户侧">
                  {form.getFieldValue('hubCustomerSide') === 'dedicated'
                    ? '独立客户侧网络'
                    : '共用客户侧网络'}
                </Descriptions.Item>
              </>
            ) : null}
          </Descriptions>
          <div style={{ marginTop: 16, fontSize: 12, color: '#64748b' }}>
            请先点击「创建隧道并保存到平台」，将隧道记录与四端拼装配置写入平台库；再进入下一步「下发向导」，按 PE-A → PE-B → CE-A → CE-B 顺序分步预览并推送到设备（与 IPsec VPN 向导一致）。
          </div>
        </>
      );
    }
    if (current === 3) {
      return (
        <div>
          <div style={{ marginBottom: 16, fontSize: 16, fontWeight: 600, color: '#1f1f1f' }}>下发向导</div>
          <div style={{ fontSize: 12, color: '#64748b', marginBottom: 16 }}>
            进入本页后将自动依次执行各步；某步失败时可点击该步「执行」重试。以下为每步返回结果。
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {SRV6_DEPLOY_STEP_DEFS.map((step, idx) => (
              <Card
                key={idx}
                size="small"
                type="inner"
                title={
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <div
                      style={{
                        width: 24,
                        height: 24,
                        borderRadius: '50%',
                        background:
                          deployStatus[idx] === 'finish'
                            ? '#52c41a'
                            : deployStatus[idx] === 'error'
                              ? '#ff4d4f'
                              : deployStatus[idx] === 'process'
                                ? '#1677ff'
                                : '#d9d9d9',
                        color: '#fff',
                        textAlign: 'center',
                        lineHeight: '24px',
                        fontSize: 12,
                      }}
                    >
                      {idx + 1}
                    </div>
                    <span>{step.title}</span>
                    <span style={{ fontSize: 12, color: '#888', fontWeight: 'normal' }}>{step.desc}</span>
                  </div>
                }
                extra={
                  <Button
                    type="primary"
                    size="small"
                    disabled={idx !== deployStep}
                    loading={deployStatus[idx] === 'process'}
                    onClick={() => void executeSrv6DeployStep(idx)}
                  >
                    执行
                  </Button>
                }
              >
                {deployLogs[idx] ? (
                  <pre
                    style={{
                      fontSize: 12,
                      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
                      background: '#1e1e1e',
                      color: '#d4d4d4',
                      padding: 12,
                      borderRadius: 6,
                      overflow: 'auto',
                      maxHeight: 220,
                      border: 'none',
                      marginTop: 0,
                      marginBottom: 0,
                    }}
                  >
                    {deployLogs[idx]}
                  </pre>
                ) : null}
              </Card>
            ))}
          </div>
        </div>
      );
    }
    return null;
  };

  const stepTitle = ['基础信息与模式', '选择 PE 与 CE', '确认并保存', '下发向导'][current];

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
          <Card size="small" title={<span style={{ fontSize: 13, fontWeight: 400 }}>步骤</span>} variant="outlined" style={{ position: 'sticky', top: 16 }}>
            <Steps
              direction="vertical"
              size="small"
              current={current}
              onChange={(idx) => {
                if (idx >= 3 && !platformSaved) {
                  message.warning('请先在「确认并保存」中完成「创建隧道并保存到平台」');
                  return;
                }
                setCurrent(idx);
              }}
              items={[
                { title: '基础信息与模式' },
                { title: '选择 PE 与 CE' },
                { title: '确认并保存' },
                { title: '下发向导', disabled: !platformSaved },
              ]}
            />
          </Card>
        </Col>
        <Col span={12}>
          <Card size="small" title={`第 ${current + 1} 步：${stepTitle}`} variant="outlined">
            <CoreContent />
            <Divider style={{ margin: '12px 0' }} />
            <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
              <Space wrap>
                {current !== 3 && <Button onClick={() => navigate('/admin/interconnect/srv6')}>返回列表</Button>}
                {current > 0 && (
                  <Button
                    onClick={prev}
                    disabled={
                      SRV6_DEPLOY_STEP_DEFS.some((_, i) => deployStatus[i] === 'process')
                    }
                  >
                    上一步
                  </Button>
                )}
                {current === 3 && (
                  <Button type="primary" onClick={() => navigate('/admin/interconnect/srv6')}>
                    关闭向导
                  </Button>
                )}
              </Space>
              <Space wrap>
                {current < 2 && (
                  <Button
                    type="primary"
                    onClick={() => {
                      commitPreview();
                      next();
                    }}
                  >
                    下一步
                  </Button>
                )}
                {current === 2 && (
                  <>
                    {platformSaved && (
                      <span style={{ color: '#52c41a', display: 'inline-flex', alignItems: 'center', fontWeight: 500, marginRight: 8 }}>
                        <CheckCircleOutlined style={{ marginRight: 4 }} />
                        已保存到平台
                      </span>
                    )}
                    <Button type="primary" loading={platformSaveLoading} disabled={platformSaved} onClick={() => void saveTunnelPlatformOnly()}>
                      {editId ? '更新隧道并保存到平台' : '创建隧道并保存到平台'}
                    </Button>
                    <Button type="primary" disabled={!platformSaved} onClick={() => { commitPreview(); next(); }}>
                      下一步：下发向导
                    </Button>
                  </>
                )}
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
          <Form.Item
            label="SRv6 SID 前缀"
            name="prefix"
            rules={[
              { required: true, message: '请输入 SID 前缀' },
              {
                validator: (_, value) => {
                  const s = String(value ?? '').trim();
                  if (!s) return Promise.resolve();
                  if (s.includes('/')) return Promise.reject(new Error('SID 前缀不允许包含/掩码'));
                  return Promise.resolve();
                },
              },
            ]}
          >
            <Input placeholder="例如：2001:db8:100::（不包含 /xx）" />
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
