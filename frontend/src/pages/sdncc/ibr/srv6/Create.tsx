import React, { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { Alert, Button, Descriptions, Form, Input, Radio, Select, Space, Steps, message, Row, Col } from 'antd';
import { ExportOutlined, CheckCircleOutlined } from '@ant-design/icons';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../../../contexts/AuthContext';
import { hasPermissionForAction } from '../../../../utils/accessMapping';
import { getVRRoles, getVRConfig, fetchVrCachePageList, getVR2Config } from '../../../../services/virtualRouterApi';
import { fetchSrv6HubStatus, fetchSrv6Tunnel, type Srv6HubVrStatus } from '../../../../services/api';
import IbrDeployWizardPanel from '../lib/IbrDeployWizardPanel';
import IbrWizardCard, { ibrWizardStepCardTitle } from '../lib/IbrWizardCard';
import IbrWizardPage from '../lib/IbrWizardPage';
import IbrWizardStepPane from '../lib/IbrWizardStepPane';
import { useIbrDeployWizard } from '../lib/useIbrDeployWizard';
import { filterLinkLocalIpv6 } from '../routers/vrIpv6Utils';
import { buildSrv6PeerRouteDestination, resolveSid64Via } from './srv6Ipv6';
import {
  buildSrv6RdRtMetaFromPeEndpoints,
  extractRdRtFromPeConfigForVrf,
  validateSrv6RdRtMeta,
  type Srv6RdRtMeta,
} from './srv6RdRt';
import {
  inferTunnelLinkTypeFromRoles,
  inferTunnelTopologyFromRoles,
  resolveHubPeSlotFromRoles,
  tunnelLinkTypeLabel,
  tunnelLinkTypeToTopology,
  type Srv6HubVrfMode,
  type Srv6TunnelLinkType,
} from './srv6Archive';
import {
  classifyHubLanOption,
  hubCeSlotForPeSlot,
  hubInventoryBlockMessage,
  hubLanSelectionPatch,
  hubLanSelectionClear,
  hubPeInnerIfField,
  findFirstReuseVrfTunnelRef,
  isFirstHubTunnel,
  matchesHubReuseAnchorLan,
  pickHubReuseAnchorFromTunnel,
  pickHubReuseAnchorPreviewFromStatus,
  resolveSelectedHubLanState,
  resolveHubVrfModeFromWizard,
  shouldInheritReuseAnchor,
  validateHubTunnelInventory,
  type HubLanOptionState,
  type HubReuseAnchor,
} from './srv6TunnelWizardHub';
import { fetchIbrHaGroups, type IbrHaGroup } from '../../../../services/ibrHaGroupApi';
import { fetchRrDomains, type RrDomain } from '../../../../services/rrDomainApi';
import {
  buildRrNeighborTargetsFromDomain,
  injectNeighborsForRrDomain,
} from './srv6RrNeighbor';
import {
  buildSrv6HaGroupSelectOptions,
  findHaGroupById,
  resolveSrv6CeHaBinding,
  resolveSrv6CeHaBindingById,
  type Srv6TunnelCeMode,
} from './srv6CeHaGroupLib';

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
  const { user } = useAuth();
  const perms = Array.isArray(user?.permissions) ? user?.permissions ?? [] : [];
  const canWrite =
    user?.role === 'super_admin' || hasPermissionForAction(perms, 'networks.srv6:write');

  useEffect(() => {
    if (!canWrite) {
      message.warning('无 SRv6 写权限，无法创建或编辑隧道');
      navigate('/admin/interconnect/srv6', { replace: true });
    }
  }, [canWrite, navigate]);

  const [form] = Form.useForm();

  // 向导状态
  const [current, setCurrent] = useState<number>(0);
  /** 第 1 步：隧道类型（PE 角色配对） */
  const [tunnelLinkType, setTunnelLinkType] = useState<Srv6TunnelLinkType>('spoke_spoke');
  /** 本端 / 对端 CE 接入可分别选标准或高可用 */
  const [ceAMode, setCeAMode] = useState<Srv6TunnelCeMode>('标准');
  const [ceBMode, setCeBMode] = useState<Srv6TunnelCeMode>('标准');
  const ceModeOf = (slot: 'ceA' | 'ceB') => (slot === 'ceA' ? ceAMode : ceBMode);
  const hasAnyCeHa = ceAMode === '高可用' || ceBMode === '高可用';
  const bothCeHa = ceAMode === '高可用' && ceBMode === '高可用';
  const [haGroups, setHaGroups] = useState<IbrHaGroup[]>([]);
  const [haGroupsLoading, setHaGroupsLoading] = useState(false);
  const [rrDomains, setRrDomains] = useState<RrDomain[]>([]);
  const [rrDomainsLoading, setRrDomainsLoading] = useState(false);
  const [formValues, setFormValues] = useState<any>({});
  const [, startTransition] = useTransition();
  const [peConfigs, setPeConfigs] = useState<{ peA?: any; peB?: any }>({});
  const [ceConfigs, setCeConfigs] = useState<{ ceA?: any; ceB?: any }>({});
  /** 第 3 步：已创建隧道记录并写入平台 VR配置库 */
  const [platformSaved, setPlatformSaved] = useState(false);
  const [platformSaveLoading, setPlatformSaveLoading] = useState(false);
  const deployAutoStartedRef = React.useRef(false);
  const [peHubStatus, setPeHubStatus] = useState<{ peA?: Srv6HubVrStatus; peB?: Srv6HubVrStatus }>({});
  const [previewTabKey, setPreviewTabKey] = useState<string>('peA');

  const resolveSrv6DeployEndpoints = useCallback(
    () => [
      { label: 'PE-A', vrId: String(form.getFieldValue('peA') || '') },
      { label: 'PE-B', vrId: String(form.getFieldValue('peB') || '') },
      { label: 'CE-A', vrId: String(form.getFieldValue('ceA') || '') },
      { label: 'CE-B', vrId: String(form.getFieldValue('ceB') || '') },
    ],
    [form],
  );

  const srv6DeployWizard = useIbrDeployWizard({
    feature: 'srv6',
    resolveEndpoints: resolveSrv6DeployEndpoints,
    onAllFinished: () => message.success('四台 IBR 下发流程已执行完毕'),
  });

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

  const prefillGenRef = useRef(0);
  useEffect(() => {
    const prefill = async () => {
      if (!editId) return;
      const gen = ++prefillGenRef.current;
      const reqEditId = editId;
      try {
        const { fetchSrv6Tunnel } = await import('../../../../services/api');
        const item = await fetchSrv6Tunnel(reqEditId);
        if (gen !== prefillGenRef.current || reqEditId !== editId) return;
        if (item && item.id) {
          form.setFieldsValue({
            tunnelName: item.name,
            peA: item.peA,
            peB: item.peB,
            ceA: item.ceA,
            ceB: item.ceB,
            peAInnerIf: item.peAInnerIf || undefined,
            peBInnerIf: item.peBInnerIf || undefined,
            peANeighborMode: item.peANeighborMode || 'static',
            peBNeighborMode: item.peBNeighborMode || 'static',
            peARrDomainId: item.peARrDomainId || undefined,
            peBRrDomainId: item.peBRrDomainId || undefined,
            hubWanIf: item.hubBindings?.wanIf,
            hubLanIf: item.hubBindings?.lanIf,
            hubWanInventoryId: item.hubBindings?.wanInventoryId,
            hubLanInventoryId: item.hubBindings?.lanInventoryId,
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
          if (item.rdRtMeta) {
            setRdRtMeta(item.rdRtMeta);
          }
          const fpA = item.endpointFingerprint?.ceA;
          const fpB = item.endpointFingerprint?.ceB;
          setCeAMode(fpA?.haGroupId ? '高可用' : '标准');
          setCeBMode(fpB?.haGroupId ? '高可用' : '标准');
          form.setFieldsValue({
            ceAHaGroupId: fpA?.haGroupId || undefined,
            ceBHaGroupId: fpB?.haGroupId || undefined,
          });
          // 编辑模式：加载各端已有配置，便于拼装下发 JSON
          if (item.peA) await fetchAndSetPeConfig('peA', item.peA);
          if (gen !== prefillGenRef.current) return;
          if (item.peB) await fetchAndSetPeConfig('peB', item.peB);
          if (gen !== prefillGenRef.current) return;
          if (item.ceA) await fetchAndSetCeConfig('ceA', item.ceA);
          if (gen !== prefillGenRef.current) return;
          if (item.ceB) await fetchAndSetCeConfig('ceB', item.ceB);
          if (gen !== prefillGenRef.current) return;
          if (item.peA) await refreshPeHubStatus('peA', item.peA);
          if (gen !== prefillGenRef.current) return;
          if (item.peB) await refreshPeHubStatus('peB', item.peB);
        }
      } catch (e) {
        if (gen !== prefillGenRef.current) return;
        console.warn('编辑模式回显失败:', e);
      }
    };
    void prefill();
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
      message.error(`获取IBR列表失败: ${error.message || '请稍后重试'}`);
      setVrs([]);
      setRolesMap({});
      rolesMapRef.current = {};
    }
  };

  useEffect(() => {
    fetchVRsAndRoles(100, 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setHaGroupsLoading(true);
      try {
        const groups = await fetchIbrHaGroups({ skipCache: true });
        if (!cancelled) setHaGroups(groups);
      } catch {
        if (!cancelled) setHaGroups([]);
      } finally {
        if (!cancelled) setHaGroupsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setRrDomainsLoading(true);
      try {
        const domains = await fetchRrDomains({ skipCache: true, status: 'active' });
        if (!cancelled) setRrDomains(domains);
      } catch {
        if (!cancelled) setRrDomains([]);
      } finally {
        if (!cancelled) setRrDomainsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const rrDomainOptions = useMemo(
    () =>
      rrDomains.map((d) => ({
        value: d.id,
        label: `${d.displayName} (${d.name}) · AS${d.remoteAs} · ${d.nodes.length} RR`,
      })),
    [rrDomains],
  );

  const resolveRrDomainById = useCallback(
    (id?: string | null) => {
      const key = String(id ?? '').trim();
      if (!key) return null;
      return rrDomains.find((d) => d.id === key) ?? null;
    },
    [rrDomains],
  );

  const haGroupOptions = useMemo(() => buildSrv6HaGroupSelectOptions(haGroups), [haGroups]);

  const resolveCeHaBinding = useCallback(
    (slot: 'ceA' | 'ceB') => {
      const field = slot === 'ceA' ? 'ceAHaGroupId' : 'ceBHaGroupId';
      const groupId = String(form.getFieldValue(field) || '').trim();
      return resolveSrv6CeHaBindingById(haGroups, groupId);
    },
    [form, haGroups],
  );

  const peOptions = useMemo(() => {
    const allowedRoles =
      tunnelLinkType === 'spoke_spoke'
        ? new Set(['SPOKE_PE'])
        : tunnelLinkType === 'hub_hub'
          ? new Set(['HUB_PE'])
          : new Set(['SPOKE_PE', 'HUB_PE']);
    const items = (vrs || []).map((r: any) => {
      const uuid = r?.uuid;
      const label = getVRLabel(r);
      const roleFromMap = uuid ? rolesMap[uuid] : undefined;
      const roleFromItem = String(r?.role || r?.vrRole || r?.vr_role || '').toUpperCase();
      const role = roleFromMap || (roleFromItem || undefined);
      return { uuid, label, role };
    });
    const filtered = items.filter((x) => !!x.uuid && x.role && allowedRoles.has(x.role));
    return filtered.map((x) => ({
      value: x.uuid,
      label: `${x.label}${x.role === 'HUB_PE' ? ' · Hub' : x.role === 'SPOKE_PE' ? ' · Spoke' : ''}`,
    }));
  }, [vrs, rolesMap, tunnelLinkType]);

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

  /** 平台档案拓扑：以第 1 步隧道类型为准；两端未齐时仍按选型落库语义 */
  const selectedTopology = useMemo(
    () => tunnelLinkTypeToTopology(tunnelLinkType),
    [tunnelLinkType],
  );

  const inferredTopology = useMemo(() => {
    const peA = formValues?.peA ?? form.getFieldValue('peA');
    const peB = formValues?.peB ?? form.getFieldValue('peB');
    return inferTunnelTopologyFromRoles(getPeRole(peA), getPeRole(peB));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formValues?.peA, formValues?.peB, rolesMap]);

  // 编辑回显：按已选 PE 角色还原隧道类型
  useEffect(() => {
    if (!editId) return;
    const peA = formValues?.peA ?? form.getFieldValue('peA');
    const peB = formValues?.peB ?? form.getFieldValue('peB');
    if (!peA || !peB) return;
    const link = inferTunnelLinkTypeFromRoles(getPeRole(peA), getPeRole(peB));
    if (link) setTunnelLinkType(link);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editId, formValues?.peA, formValues?.peB, rolesMap]);

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
    const fromApi = rows
      .filter((o) => o.selectable !== false)
      .map((o) => ({
        value: o.id,
        label: o.label || `${o.ifName} · ${o.ipv6}`,
        ifName: o.ifName,
        ipv6: o.ipv6,
        disabled: o.selectable === false,
      }));
    if (fromApi.length) return fromApi;

    const cfg = inferredHubPeSlot ? peConfigs[inferredHubPeSlot] : undefined;
    if (!cfg || typeof cfg !== 'object') return [];
    const fallback: { value: string; label: string; ifName: string; ipv6: string; disabled?: boolean }[] = [];
    for (const k of Object.keys(cfg)) {
      if (!k.startsWith('interfaces_') && !k.startsWith('subinterfaces_')) continue;
      const arr = (cfg as Record<string, unknown>)[k];
      if (!Array.isArray(arr)) continue;
      for (const raw of arr) {
        if (!raw || typeof raw !== 'object') continue;
        const row = raw as Record<string, unknown>;
        const ifName = String(row.name || '').trim();
        if (!ifName) continue;
        const vrf = row.vrf;
        const hasVrf = vrf !== undefined && vrf !== null && String(vrf).trim() !== '' && Number(vrf) > 0;
        if (hasVrf) continue;
        const ipv6 = String(row.ipv6_static ?? row.ipv6 ?? '').trim();
        if (!ipv6) continue;
        const id = `baseline-wan:${ifName}`;
        fallback.push({
          value: id,
          ifName,
          ipv6,
          label: `${ifName} · ${ipv6} [Hub 已有公网口]`,
        });
      }
    }
    return fallback;
  }, [hubInventoryUi, inferredHubPeSlot, peConfigs]);

  const hubLanInventoryOptions = useMemo(() => {
    const annotateLan = (row: {
      id: string;
      ifName: string;
      vrf: number;
      label?: string;
      selectable?: boolean;
    }) => {
      const { state, tunnelNames } = classifyHubLanOption(
        { id: row.id, ifName: row.ifName, vrf: row.vrf },
        hubPortRegistry,
      );
      const tag =
        state === 'dedicated_occupied'
          ? `已用于 ${tunnelNames.join('、')} · 专网占用`
          : state === 'reuse_reusable'
            ? `已用于 ${tunnelNames.join('、')} · 可复用`
            : '空闲';
      return {
        value: row.id,
        label: `${row.ifName} · VRF ${row.vrf} [${tag}]`,
        ifName: row.ifName,
        vrf: row.vrf,
        disabled: state === 'dedicated_occupied' || row.selectable === false,
        lanState: state as HubLanOptionState,
      };
    };

    const rows = hubInventoryUi?.lanOptions ?? [];
    const fromApi = rows.map((o) => annotateLan(o));
    if (fromApi.length) return fromApi;

    const cfg = inferredHubPeSlot ? peConfigs[inferredHubPeSlot] : undefined;
    if (!cfg || typeof cfg !== 'object') return [];
    const bgpArr = Array.isArray((cfg as { bgp?: unknown }).bgp) ? (cfg as { bgp: unknown[] }).bgp : [];
    const fallback: ReturnType<typeof annotateLan>[] = [];
    for (const k of Object.keys(cfg)) {
      if (!k.startsWith('interfaces_') && !k.startsWith('subinterfaces_')) continue;
      const arr = (cfg as Record<string, unknown>)[k];
      if (!Array.isArray(arr)) continue;
      for (const raw of arr) {
        if (!raw || typeof raw !== 'object') continue;
        const row = raw as Record<string, unknown>;
        const ifName = String(row.name || '').trim();
        const vrfNum = Number(row.vrf);
        if (!ifName || !Number.isFinite(vrfNum) || vrfNum <= 0) continue;
        const bgpHit = bgpArr.find(
          (b) => b && typeof b === 'object' && Number((b as Record<string, unknown>).vrf) === vrfNum,
        ) as Record<string, unknown> | undefined;
        if (!bgpHit) continue;
        fallback.push(
          annotateLan({
            id: `baseline-lan:${ifName}:${vrfNum}`,
            ifName,
            vrf: vrfNum,
          }),
        );
      }
    }
    return fallback;
  }, [hubInventoryUi, inferredHubPeSlot, peConfigs, hubPortRegistry]);

  const hubAliveTunnelCount = useMemo(() => {
    if (!inferredHubPeSlot) return 0;
    return peHubStatus[inferredHubPeSlot]?.tunnelCount ?? 0;
  }, [inferredHubPeSlot, peHubStatus]);

  const isFirstHubTunnelOnPe = isFirstHubTunnel(hubAliveTunnelCount);

  const hubHasReuseAnchorOnPe = useMemo(() => {
    if (!inferredHubPeSlot) return false;
    return !!findFirstReuseVrfTunnelRef(peHubStatus[inferredHubPeSlot]?.tunnels);
  }, [inferredHubPeSlot, peHubStatus]);

  const [hubReuseAnchor, setHubReuseAnchor] = useState<HubReuseAnchor | null>(null);

  const clearPeSelectionsForLinkTypeChange = useCallback(() => {
    form.setFieldsValue({
      peA: undefined,
      peB: undefined,
      peAInnerIf: undefined,
      peBInnerIf: undefined,
      hubWanIf: undefined,
      hubLanIf: undefined,
      hubWanInventoryId: undefined,
      hubLanInventoryId: undefined,
    });
    setPeConfigs({});
    setPeHubStatus({});
    setHubReuseAnchor(null);
    setFormValues((prev: any) => ({
      ...prev,
      peA: undefined,
      peB: undefined,
      peAInnerIf: undefined,
      peBInnerIf: undefined,
      hubWanIf: undefined,
      hubLanIf: undefined,
      hubWanInventoryId: undefined,
      hubLanInventoryId: undefined,
    }));
  }, [form]);

  /** 用户已手动改选 Hub 客户侧（LAN/CE）后，禁止锚点 autofill 覆盖 */
  const hubCustomerSideTouchedRef = useRef(false);
  const [hubCustomerSideTouched, setHubCustomerSideTouched] = useState(false);

  const markHubCustomerSideTouched = () => {
    hubCustomerSideTouchedRef.current = true;
    setHubCustomerSideTouched(true);
  };

  const hubLanInventoryIdWatch = Form.useWatch('hubLanInventoryId', form);
  const hubLanIfWatch = Form.useWatch('hubLanIf', form);
  const hubCeFieldWatch = inferredHubPeSlot ? hubCeSlotForPeSlot(inferredHubPeSlot) : null;
  const hubCeUuidWatch = Form.useWatch(hubCeFieldWatch ?? 'ceA', form);

  /** Step2+ Form 卸载时 useWatch 可能为空，回退 form store / formValues */
  const hubFormSnapshot = useMemo(() => {
    const ceField = (hubCeFieldWatch ?? 'ceA') as 'ceA' | 'ceB';
    const stored = form.getFieldsValue(true);
    return {
      hubLanInventoryId:
        hubLanInventoryIdWatch ?? stored.hubLanInventoryId ?? formValues?.hubLanInventoryId,
      hubLanIf: hubLanIfWatch ?? stored.hubLanIf ?? formValues?.hubLanIf,
      hubCeUuid: hubCeUuidWatch ?? stored[ceField] ?? formValues?.[ceField],
    };
  }, [
    formValues,
    hubLanInventoryIdWatch,
    hubLanIfWatch,
    hubCeUuidWatch,
    hubCeFieldWatch,
    form,
  ]);

  const hubLanInventoryIdEffective = hubFormSnapshot.hubLanInventoryId;
  const hubLanIfEffective = hubFormSnapshot.hubLanIf;
  const hubCeUuidEffective = hubFormSnapshot.hubCeUuid;

  const hubReuseAnchorPreview = useMemo(() => {
    if (!inferredHubPeSlot || isFirstHubTunnelOnPe) return null;
    return pickHubReuseAnchorPreviewFromStatus(
      inferredHubPeSlot,
      peHubStatus[inferredHubPeSlot]?.tunnels,
    );
  }, [inferredHubPeSlot, isFirstHubTunnelOnPe, peHubStatus]);

  const effectiveAnchorLanIf = hubReuseAnchor?.hubLanIf ?? hubReuseAnchorPreview?.hubLanIf;
  const effectiveAnchorLanInventoryId =
    hubReuseAnchor?.hubLanInventoryId ?? hubReuseAnchorPreview?.hubLanInventoryId;
  const effectiveAnchorCeUuid = hubReuseAnchor?.hubCeUuid ?? hubReuseAnchorPreview?.hubCeUuid;

  const hubLanOptionRows = useMemo(
    () =>
      hubLanInventoryOptions.map((o) => ({
        value: String(o.value),
        ifName: o.ifName,
        lanState: o.lanState,
      })),
    [hubLanInventoryOptions],
  );

  const resolvedHubLanSelection = useMemo(
    () =>
      resolveSelectedHubLanState({
        hubLanInventoryId: hubLanInventoryIdEffective,
        hubLanIf: hubLanIfEffective,
        lanOptions: hubLanOptionRows,
        portRegistry: hubPortRegistry,
      }),
    [hubLanInventoryIdEffective, hubLanIfEffective, hubLanOptionRows, hubPortRegistry],
  );

  const selectedHubLanState = resolvedHubLanSelection.state;
  const hubLanSelectionDesynced = resolvedHubLanSelection.desynced;

  const inheritReuseAnchor = useMemo(
    () =>
      shouldInheritReuseAnchor({
        isFirstHubTunnel: isFirstHubTunnelOnPe,
        hasReuseAnchor: hubHasReuseAnchorOnPe || !!hubReuseAnchor,
        hubLanInventoryId: hubLanInventoryIdEffective,
        hubLanIf: hubLanIfEffective,
        anchorLanInventoryId: effectiveAnchorLanInventoryId,
        anchorLanIf: effectiveAnchorLanIf,
        selectedLanState: selectedHubLanState,
        hubCeUuid: hubCeUuidEffective,
        anchorCeUuid: effectiveAnchorCeUuid,
        hubLanDesynced: hubLanSelectionDesynced,
        customerSideTouched: hubCustomerSideTouched,
      }),
    [
      isFirstHubTunnelOnPe,
      hubHasReuseAnchorOnPe,
      hubReuseAnchor,
      hubLanInventoryIdEffective,
      hubLanIfEffective,
      effectiveAnchorLanInventoryId,
      effectiveAnchorLanIf,
      selectedHubLanState,
      hubCeUuidEffective,
      hubLanSelectionDesynced,
      hubCustomerSideTouched,
      effectiveAnchorCeUuid,
    ],
  );

  const resolvedHubVrfMode = useMemo(
    () =>
      resolveHubVrfModeFromWizard({
        isFirstHubTunnel: isFirstHubTunnelOnPe,
        hasReuseAnchorOnHub: hubHasReuseAnchorOnPe,
        hasReuseAnchorLoaded: !!hubReuseAnchor,
        hubLanInventoryId: hubLanInventoryIdEffective,
        hubLanIf: hubLanIfEffective,
        hubCeUuid: hubCeUuidEffective,
        effectiveAnchorLanInventoryId,
        effectiveAnchorLanIf,
        effectiveAnchorCeUuid,
        lanOptions: hubLanOptionRows,
        portRegistry: hubPortRegistry,
        customerSideTouched: hubCustomerSideTouched,
      }),
    [
      isFirstHubTunnelOnPe,
      hubHasReuseAnchorOnPe,
      hubReuseAnchor,
      hubLanInventoryIdEffective,
      hubLanIfEffective,
      hubCeUuidEffective,
      effectiveAnchorLanInventoryId,
      effectiveAnchorLanIf,
      effectiveAnchorCeUuid,
      hubLanOptionRows,
      hubPortRegistry,
      hubCustomerSideTouched,
    ],
  );

  // UX：不锁定 CE（允许用户自行选择）；仅在程序性回填 CE 时主动拉取配置，保证关系档案完整。

  // 新建向导 mount：清空 Hub 互联残留，避免删隧道后二次创建继承上一条表单值
  useEffect(() => {
    if (editId) return;
    form.setFieldsValue({
      hubWanInventoryId: undefined,
      hubWanIf: undefined,
      hubLanInventoryId: undefined,
      hubLanIf: undefined,
      peAInnerIf: undefined,
      peBInnerIf: undefined,
    });
    setHubReuseAnchor(null);
    hubCustomerSideTouchedRef.current = false;
    setHubCustomerSideTouched(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 仅新建模式 mount 时执行
  }, [editId]);

  useEffect(() => {
    hubCustomerSideTouchedRef.current = false;
    setHubCustomerSideTouched(false);
  }, [inferredHubPeSlot, isFirstHubTunnelOnPe, formValues?.peA, formValues?.peB]);

  useEffect(() => {
    if (editId || inferredTopology !== 'H' || !inferredHubPeSlot || isFirstHubTunnelOnPe) {
      setHubReuseAnchor(null);
      return;
    }
    if (hubCustomerSideTouchedRef.current) return;
    const status = peHubStatus[inferredHubPeSlot];
    const firstRef = findFirstReuseVrfTunnelRef(status?.tunnels);
    if (!firstRef?.tunnelId) {
      setHubReuseAnchor(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const tunnel = await fetchSrv6Tunnel(firstRef.tunnelId);
        if (cancelled) return;
        const anchor = pickHubReuseAnchorFromTunnel(inferredHubPeSlot, {
          id: tunnel.id,
          name: tunnel.name,
          ceA: tunnel.ceA,
          ceB: tunnel.ceB,
          peAInnerIf: tunnel.peAInnerIf,
          peBInnerIf: tunnel.peBInnerIf,
          hubBindings: tunnel.hubBindings,
        });
        if (!anchor) {
          setHubReuseAnchor(null);
          return;
        }
        setHubReuseAnchor(anchor);
        if (hubCustomerSideTouchedRef.current) return;
        const currentLanId = String(form.getFieldValue('hubLanInventoryId') ?? '').trim();
        const currentLanIf = String(form.getFieldValue('hubLanIf') ?? '').trim();
        const hasCurrentLan = !!(currentLanId || currentLanIf);
        if (
          hasCurrentLan &&
          !matchesHubReuseAnchorLan({
            hubLanInventoryId: currentLanId,
            hubLanIf: currentLanIf,
            anchorLanInventoryId: anchor.hubLanInventoryId,
            anchorLanIf: anchor.hubLanIf,
          })
        ) {
          return;
        }
        const innerField = hubPeInnerIfField(inferredHubPeSlot);
        const ceField = hubCeSlotForPeSlot(inferredHubPeSlot);
        form.setFieldsValue({
          hubLanIf: anchor.hubLanIf,
          hubLanInventoryId: anchor.hubLanInventoryId,
          [innerField]: anchor.hubPeInnerIf,
          [ceField]: anchor.hubCeUuid,
        });
        // setFieldsValue 不会触发 onValuesChange：这里补拉 Hub 侧 CE 配置，避免 injectedDelta.ceX 缺失
        await fetchAndSetCeConfig(ceField, anchor.hubCeUuid);
      } catch {
        if (!cancelled) setHubReuseAnchor(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editId, inferredTopology, inferredHubPeSlot, isFirstHubTunnelOnPe, peHubStatus]);

  const handleHubLanInventoryChange = (id: string) => {
    markHubCustomerSideTouched();
    if (!String(id ?? '').trim()) {
      if (inferredHubPeSlot) {
        form.setFieldsValue(hubLanSelectionClear(inferredHubPeSlot));
      }
      return;
    }
    const fromOpts = hubLanInventoryOptions.find((l) => l.value === id);
    const raw = hubInventoryUi?.lanOptions?.find((l) => l.id === id);
    const ifName = fromOpts?.ifName ?? raw?.ifName;
    const lanState =
      fromOpts?.lanState ??
      (ifName
        ? classifyHubLanOption({ id: String(id), ifName }, hubPortRegistry).state
        : ('idle' as HubLanOptionState));
    if (ifName && inferredHubPeSlot) {
      form.setFieldsValue(hubLanSelectionPatch(inferredHubPeSlot, ifName, String(id)));
    }
    const onAnchorReuseLan =
      lanState === 'reuse_reusable' ||
      matchesHubReuseAnchorLan({
        hubLanInventoryId: id,
        hubLanIf: ifName,
        anchorLanInventoryId: effectiveAnchorLanInventoryId,
        anchorLanIf: effectiveAnchorLanIf,
      });
    if (inferredHubPeSlot && hubReuseAnchor && onAnchorReuseLan) {
      const ceField = hubCeSlotForPeSlot(inferredHubPeSlot);
      form.setFieldsValue({ [ceField]: hubReuseAnchor.hubCeUuid });
      // setFieldsValue 不会触发 onValuesChange：补拉 Hub 侧 CE 配置
      void fetchAndSetCeConfig(ceField, hubReuseAnchor.hubCeUuid);
    }
  };

  const wizardSectionHeader = (text: string) => (
    <div
      style={{
        color: '#1677ff',
        margin: '4px 0 12px 0',
        borderBottom: '1px solid #e8e8e8',
        paddingBottom: 6,
      }}
    >
      {text}
    </div>
  );

  const renderHubPeInline = (peSlot: 'peA' | 'peB') => {
    if (inferredTopology !== 'H' || inferredHubPeSlot !== peSlot) return null;
    const lanMeta = hubLanInventoryOptions.find((o) => o.value === hubLanInventoryIdEffective);
    const lanIf = String(hubLanIfEffective || lanMeta?.ifName || '').trim();
    const lanVrf = lanMeta?.vrf;
    const lanIp = lanIf ? extractInterfaceIp(peConfigs[peSlot], lanIf) : undefined;
    const lanExtra = [
      lanVrf != null ? `VRF: ${lanVrf}` : null,
      lanIp ? `IP: ${lanIp}` : null,
      lanIf ? '本选项即 PE 内网互联槽位' : null,
    ]
      .filter(Boolean)
      .join(' · ');

    return (
      <>
        {wizardSectionHeader('Hub 互联配置')}
        {!hubWanInventoryOptions.length ? (
          <Alert
            type="warning"
            showIcon
            message="尚未发现可用 Hub 公网口"
            description={hubInventoryUi?.guidance || hubInventoryBlockMessage('wan')}
          />
        ) : null}
        <Form.Item name="hubWanIf" hidden>
          <Input />
        </Form.Item>
        <Form.Item name="hubLanIf" hidden>
          <Input />
        </Form.Item>
        <Form.Item name={hubPeInnerIfField(peSlot)} hidden>
          <Input />
        </Form.Item>
        <Form.Item
          name="hubWanInventoryId"
          label="Hub 公网口"
          rules={[{ required: true, message: '请选择 Hub 公网口' }]}
          extra="从 HUB_PE 角色向导 inventory 选用；同一口可被多条隧道复用"
        >
          <Select
            options={hubWanInventoryOptions}
            showSearch
            allowClear
            optionFilterProp="label"
            placeholder={hubWanInventoryOptions.length ? '选择 Hub 公网口' : '暂无可用公网口'}
            onChange={(id) => {
              if (isFirstHubTunnelOnPe) {
                markHubCustomerSideTouched();
              }
              const hit =
                hubInventoryUi?.wanOptions?.find((w) => w.id === id) ??
                hubWanInventoryOptions.find((w) => w.value === id);
              if (hit) form.setFieldsValue({ hubWanIf: hit.ifName });
            }}
          />
        </Form.Item>
        <Form.Item
          name="hubLanInventoryId"
          label="Hub 内网口"
          rules={[{ required: true, message: '请选择 Hub 内网口' }]}
          extra={
            resolvedHubVrfMode === 'DEDICATED_VRF'
              ? '独立专网：请选择一条空闲内网口（专网占用不可选）'
              : lanExtra || '共用客户侧：可复用已占用内网口；或改选空闲口切换为独立专网'
          }
        >
          <Select
            options={hubLanInventoryOptions}
            showSearch
            allowClear
            optionFilterProp="label"
            placeholder={
              hubLanInventoryOptions.length ? '选择 Hub 内网口' : hubInventoryBlockMessage('lan')
            }
            onChange={(id) => handleHubLanInventoryChange(String(id ?? ''))}
          />
        </Form.Item>
      </>
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
      if (getPeRole(uuid) === 'HUB_PE') {
        await refreshPeHubStatus(target, uuid);
      }
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

  const markHubCustomerSideTouchedIfCeDiverges = (ceSlot: 'ceA' | 'ceB', _ceUuid: string) => {
    const peSlot = ceSlot === 'ceA' ? 'peA' : 'peB';
    if (inferredHubPeSlot !== peSlot) return;
    if (isFirstHubTunnelOnPe) {
      markHubCustomerSideTouched();
      return;
    }
    markHubCustomerSideTouched();
  };

  const applyCeHaGroupSelection = async (slot: 'ceA' | 'ceB', groupId: string) => {
    const group = findHaGroupById(haGroups, groupId);
    if (!group) return;
    const binding = resolveSrv6CeHaBinding(group);
    if (!binding) {
      message.warning('所选高可用组缺少主备成员');
      return;
    }
    form.setFieldsValue({ [slot]: binding.primaryVrUuid });
    markHubCustomerSideTouchedIfCeDiverges(slot, binding.primaryVrUuid);
    await fetchAndSetCeConfig(slot, binding.primaryVrUuid);
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
    if (changed?.ceAHaGroupId) {
      await applyCeHaGroupSelection('ceA', String(changed.ceAHaGroupId));
    }
    if (changed?.ceBHaGroupId) {
      await applyCeHaGroupSelection('ceB', String(changed.ceBHaGroupId));
    }
    if (changed?.ceA) {
      markHubCustomerSideTouchedIfCeDiverges('ceA', changed.ceA);
      await fetchAndSetCeConfig('ceA', changed.ceA);
    }
    if (changed?.ceB) {
      markHubCustomerSideTouchedIfCeDiverges('ceB', changed.ceB);
      await fetchAndSetCeConfig('ceB', changed.ceB);
    }
    // 为了让“接口选项”与“预览”在选择 VRF/接口时也刷新，更新本地状态
    try {
      setFormValues(all);
    } catch {}
  };

  /** RD/RT 取自 PE 角色向导写入的 LAN BGP；随所选内网口 VRF 同步 */
  const [rdRtMeta, setRdRtMeta] = useState<Srv6RdRtMeta | null>(null);

  useEffect(() => {
    const peA = formValues?.peA ?? form.getFieldValue('peA');
    const peB = formValues?.peB ?? form.getFieldValue('peB');
    const peAInnerIf = formValues?.peAInnerIf ?? form.getFieldValue('peAInnerIf');
    const peBInnerIf = formValues?.peBInnerIf ?? form.getFieldValue('peBInnerIf');
    if (!peA || !peB || !peConfigs.peA || !peConfigs.peB) return;
    const peAVrf = extractInterfaceVrf(peConfigs.peA, peAInnerIf);
    const peBVrf = extractInterfaceVrf(peConfigs.peB, peBInnerIf);
    const fromPe = buildSrv6RdRtMetaFromPeEndpoints({
      peACfg: peConfigs.peA,
      peBCfg: peConfigs.peB,
      peAVrf,
      peBVrf,
    });
    if (fromPe) {
      setRdRtMeta(fromPe);
      return;
    }
    // 编辑态：PE 上尚未读到 RD/RT 时保留档案值；新建则清空以便校验提示
    if (!editId) setRdRtMeta(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    editId,
    formValues?.peA,
    formValues?.peB,
    formValues?.peAInnerIf,
    formValues?.peBInnerIf,
    peConfigs.peA,
    peConfigs.peB,
  ]);

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

    const neighborModeField = selfKey === 'peA' ? 'peANeighborMode' : 'peBNeighborMode';
    const rrDomainIdField = selfKey === 'peA' ? 'peARrDomainId' : 'peBRrDomainId';
    const neighborMode = form.getFieldValue(neighborModeField) || 'static';
    const rrDomain = resolveRrDomainById(form.getFieldValue(rrDomainIdField));
    if (c && neighborMode === 'rr_domain' && rrDomain) {
      const targets = buildRrNeighborTargetsFromDomain(rrDomain);
      c = injectNeighborsForRrDomain(c, targets);
    } else if (c && neighborMode !== 'rr_domain') {
      if (peerPublicIp) c = injectNeighborsForPEPeerIp(c, peerPublicIp, peerAsn);
      else if (peerCfg) c = injectNeighborsForPEPeer(c, peerCfg);
    }

    if (c && ceCfg) c = injectNeighborsForPEToCE(c, ceCfg, vrf);
    if (c && rdRtMeta?.rtCommon && rdRtMeta?.rdMap?.[rdKey] && vrf !== undefined) {
      const idx = findBgpIndexByVrf(c, vrf);
      c = injectRdRtIntoIpv4UnicastAfAtBgpIndex(c, idx !== undefined ? idx : 1, rdRtMeta.rdMap[rdKey], rdRtMeta.rtCommon);
    }
    // IPv6 路由：注入两条——①对端 SID/64 路由(不带 vrf，via=对端PE公网IPv6) ②VRF默认路由 ::/0(带 vrf，via=nexthop-vrf 0)
    const peerPrefix = peerCfg ? extractSrv6Prefix(peerCfg) : undefined;
    const srv6PeerDest = buildSrv6PeerRouteDestination(peerPrefix);
    const sid64WanIf = topo === 'H' && hubSlot && selfKey === hubSlot ? hubWanIf : undefined;
    const via = peerCfg ? resolveSid64Via(selfCfg, peerCfg, sid64WanIf) : undefined;
    if (c && srv6PeerDest && via && vrf !== undefined) c = injectIpv6RouteTop(c, srv6PeerDest, via, vrf);

    return {
      preview: c ? sanitizeForDevice(c) : null,
      storage: c ? buildPeConfigForPlatformStorage(c) : null,
    };
  };

  // 计算注入邻居后的预览配置（复用 buildInjectedPeConfig：SID/64 + VRF ::/0 双路由）
  // eslint-disable-next-line react-hooks/exhaustive-deps -- buildInjectedPeConfig 为同渲染周期内辅助函数，依赖 peConfigs/ceConfigs/rdRtMeta/formValues
  const peAInjected = useMemo(() => buildInjectedPeConfig('peA'), [peConfigs, ceConfigs, rdRtMeta, formValues, inferredTopology, inferredHubPeSlot, rrDomains]);
  const peAPreviewCfg = peAInjected.preview;
  const peAPreviewStorageCfg = peAInjected.storage;

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const peBInjected = useMemo(() => buildInjectedPeConfig('peB'), [peConfigs, ceConfigs, rdRtMeta, formValues, inferredTopology, inferredHubPeSlot, rrDomains]);
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

  // 打开角色配置向导（新页面）
  const openRoleWizard = (target: 'peA' | 'peB' | 'ceA' | 'ceB') => {
    const uuid = form.getFieldValue(target);
    if (!uuid) {
      message.error(`请先选择 ${target === 'peA' ? 'PE-A' : target === 'peB' ? 'PE-B' : target === 'ceA' ? 'CE-A' : 'CE-B'} 的 IBR实例`);
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

  /** 仅在前两步回退时清空「已保存」标记；从下发向导回到确认页仍保留（避免重复点创建） */
  useEffect(() => {
    if (current === 0 || current === 1) setPlatformSaved(false);
  }, [current]);

  /** 校验隧道表单（与原先提交前一致） */
  const computeHubVrfModeForValues = (values: Record<string, unknown>) => {
    const ceField = (hubCeFieldWatch ?? 'ceA') as 'ceA' | 'ceB';
    return resolveHubVrfModeFromWizard({
      isFirstHubTunnel: isFirstHubTunnelOnPe,
      hasReuseAnchorOnHub: hubHasReuseAnchorOnPe,
      hasReuseAnchorLoaded: !!hubReuseAnchor,
      hubLanInventoryId: values?.hubLanInventoryId as string | undefined,
      hubLanIf: values?.hubLanIf as string | undefined,
      hubCeUuid: values?.[ceField] as string | undefined,
      effectiveAnchorLanInventoryId,
      effectiveAnchorLanIf,
      effectiveAnchorCeUuid,
      lanOptions: hubLanOptionRows,
      portRegistry: hubPortRegistry,
      customerSideTouched: hubCustomerSideTouched,
    });
  };

  const validateTunnelForm = (): boolean => {
    const values = form.getFieldsValue(true);
    const peA = values?.peA;
    const peB = values?.peB;
    const ceA = values?.ceA;
    const ceB = values?.ceB;
    const ceAHaGroupId = String(values?.ceAHaGroupId || '').trim();
    const ceBHaGroupId = String(values?.ceBHaGroupId || '').trim();
    const tunnelName = String(values?.tunnelName || '').trim();
    const peAInnerIf = values?.peAInnerIf;
    const peBInnerIf = values?.peBInnerIf;

    if (peA && peB && String(peA) === String(peB)) {
      message.error('PE-A 与 PE-B 不能相同');
      return false;
    }

    if (!tunnelName || !peA || !peB) {
      message.error('请完整填写隧道名称与 PE');
      return false;
    }

    const bindA =
      ceAMode === '高可用' ? resolveSrv6CeHaBindingById(haGroups, ceAHaGroupId) : null;
    const bindB =
      ceBMode === '高可用' ? resolveSrv6CeHaBindingById(haGroups, ceBHaGroupId) : null;

    if (ceAMode === '高可用') {
      if (!ceAHaGroupId || !bindA || !ceA) {
        message.error('请为本端选择完整的 CE 高可用组');
        return false;
      }
    } else if (!ceA) {
      message.error('请选择本端 CE（CE-A）');
      return false;
    }

    if (ceBMode === '高可用') {
      if (!ceBHaGroupId || !bindB || !ceB) {
        message.error('请为对端选择完整的 CE 高可用组');
        return false;
      }
    } else if (!ceB) {
      message.error('请选择对端 CE（CE-B）');
      return false;
    }

    if (ceA && ceB && String(ceA) === String(ceB)) {
      message.error('CE-A 与 CE-B 不能相同');
      return false;
    }
    if (ceAMode === '高可用' && ceBMode === '高可用') {
      if (ceAHaGroupId === ceBHaGroupId) {
        message.error('两端不能选择同一高可用组');
        return false;
      }
      if (bindA && bindB && bindA.primaryVrUuid === bindB.primaryVrUuid) {
        message.error('两端高可用组的主 CE 不能相同');
        return false;
      }
    }
    if (ceAMode === '高可用' && ceBMode === '标准' && bindA) {
      if (
        String(ceB) === bindA.primaryVrUuid ||
        String(ceB) === bindA.backupVrUuid
      ) {
        message.error('对端单台 CE 不能与本端高可用组主/备重复');
        return false;
      }
    }
    if (ceBMode === '高可用' && ceAMode === '标准' && bindB) {
      if (
        String(ceA) === bindB.primaryVrUuid ||
        String(ceA) === bindB.backupVrUuid
      ) {
        message.error('本端单台 CE 不能与对端高可用组主/备重复');
        return false;
      }
    }
    if (!peAInnerIf || !peBInnerIf) {
      message.error('请在“选择 PE”步骤中选择 PE-A 与 PE-B 的内网口');
      return false;
    }
    const peANeighborMode = values?.peANeighborMode || 'static';
    const peBNeighborMode = values?.peBNeighborMode || 'static';
    if (peANeighborMode === 'rr_domain') {
      const domainA = resolveRrDomainById(values?.peARrDomainId);
      if (!domainA) {
        message.error('PE-A 选择 RR 反射域模式时须指定 RR 域');
        return false;
      }
      if (!domainA.nodes?.length) {
        message.error(`PE-A 所选 RR 域「${domainA.displayName}」无 RR 节点，无法建邻`);
        return false;
      }
    }
    if (peBNeighborMode === 'rr_domain') {
      const domainB = resolveRrDomainById(values?.peBRrDomainId);
      if (!domainB) {
        message.error('PE-B 选择 RR 反射域模式时须指定 RR 域');
        return false;
      }
      if (!domainB.nodes?.length) {
        message.error(`PE-B 所选 RR 域「${domainB.displayName}」无 RR 节点，无法建邻`);
        return false;
      }
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
    const linkFromRoles = inferTunnelLinkTypeFromRoles(rA, rB);
    if (!linkFromRoles) {
      message.error('请为两端选择有效的 PE 角色（SPOKE_PE / HUB_PE）');
      return false;
    }
    if (linkFromRoles !== tunnelLinkType) {
      if (tunnelLinkType === 'spoke_spoke') {
        message.error('Spoke – Spoke 隧道两端须均为 SPOKE_PE');
      } else if (tunnelLinkType === 'hub_hub') {
        message.error('Hub – Hub 隧道两端须均为 HUB_PE');
      } else {
        message.error('Spoke – Hub 隧道须恰好一端为 HUB_PE、另一端为 SPOKE_PE');
      }
      return false;
    }
    if (selectedTopology === 'H') {
      const hubVrfModeForSubmit = computeHubVrfModeForValues(values);
      const invCheck = validateHubTunnelInventory({
        hubVrfMode: hubVrfModeForSubmit,
        hubWanInventoryId: values?.hubWanInventoryId,
        hubWanIf: values?.hubWanIf,
        hubLanInventoryId: values?.hubLanInventoryId,
        hubLanIf: values?.hubLanIf,
        isFirstHubTunnel: isFirstHubTunnelOnPe,
        hasWanInventoryOptions: hubWanInventoryOptions.length > 0,
        hasLanInventoryOptions: hubLanInventoryOptions.length > 0,
        reuseAnchor: hubReuseAnchor,
        inheritReuseAnchor,
        selectedLanState: selectedHubLanState,
      });
      if (!invCheck.ok) {
        message.error(invCheck.message);
        return false;
      }
      if (inferredHubPeSlot) {
        const innerField = hubPeInnerIfField(inferredHubPeSlot);
        const hubInner = String(values?.[innerField] ?? '').trim();
        const hubLan = String(values?.hubLanIf ?? '').trim();
        if (hubLan && hubInner && hubInner !== hubLan) {
          message.error('Hub 内网口须与所选 Hub LAN inventory 一致');
          return false;
        }
      }
    }

    const peAVrf = extractInterfaceVrf(peConfigs.peA, peAInnerIf);
    const peBVrf = extractInterfaceVrf(peConfigs.peB, peBInnerIf);
    const aRdRt = extractRdRtFromPeConfigForVrf(peConfigs.peA, peAVrf);
    const bRdRt = extractRdRtFromPeConfigForVrf(peConfigs.peB, peBVrf);
    if (aRdRt.rt && bRdRt.rt && aRdRt.rt !== bRdRt.rt) {
      message.error('两端 PE 所选 VRF 的 Route Target（RT）不一致，请在 PE 角色向导「BGP 配置（LAN）」中调整为相同 RT');
      return false;
    }
    const fromPe = buildSrv6RdRtMetaFromPeEndpoints({
      peACfg: peConfigs.peA,
      peBCfg: peConfigs.peB,
      peAVrf,
      peBVrf,
    });
    if (fromPe) {
      setRdRtMeta(fromPe);
      return true;
    }
    if (rdRtMeta && !validateSrv6RdRtMeta(rdRtMeta)) {
      return true;
    }
    message.error(
      '请在 PE 角色向导第 2 步「BGP 配置（LAN）」中为所选内网 VRF 配置 RD 与 RT，再返回本向导选择内网口',
    );
    return false;
  };

  /** 第 3 步：创建隧道记录 + 仅保存平台库（不下发设备）；下发在下一步向导中分步执行 */
  const saveTunnelPlatformOnly = async () => {
    if (!validateTunnelForm()) return;
    const values = form.getFieldsValue(true);
    const peAVrfForRd = extractInterfaceVrf(peConfigs.peA, values?.peAInnerIf);
    const peBVrfForRd = extractInterfaceVrf(peConfigs.peB, values?.peBInnerIf);
    const rdRtForSave =
      buildSrv6RdRtMetaFromPeEndpoints({
        peACfg: peConfigs.peA,
        peBCfg: peConfigs.peB,
        peAVrf: peAVrfForRd,
        peBVrf: peBVrfForRd,
      }) || rdRtMeta;
    if (validateSrv6RdRtMeta(rdRtForSave)) {
      message.error(
        '请在 PE 角色向导第 2 步「BGP 配置（LAN）」中为所选内网 VRF 配置 RD 与 RT，再返回本向导',
      );
      return;
    }
    setRdRtMeta(rdRtForSave);
    commitPreview();
    const peA = values?.peA;
    const peB = values?.peB;
    const ceA = values?.ceA;
    const ceB = values?.ceB;
    const tunnelName = String(values?.tunnelName || '').trim();
    setPlatformSaveLoading(true);
    try {
      const { createSrv6Tunnel, updateSrv6Tunnel } = await import('../../../../services/api');
      const { buildTunnelArchive } = await import('./srv6Archive');
      const hubVrfMode: Srv6HubVrfMode = computeHubVrfModeForValues(values);
      const hubWanIfResolved = values?.hubWanIf;
      const hubLanIfResolved = values?.hubLanIf;
      const hubLanInventoryIdResolved = String(values?.hubLanInventoryId ?? '').trim();
      const hubLanIfNorm = String(hubLanIfResolved ?? '').trim().toLowerCase();
      const lanOptMatch = hubLanInventoryIdResolved
        ? hubLanInventoryOptions.find((o) => o.value === hubLanInventoryIdResolved)
        : hubLanInventoryOptions.find(
            (o) => String(o.ifName ?? '').trim().toLowerCase() === hubLanIfNorm,
          );
      const archive = buildTunnelArchive({
        peA: String(peA),
        peB: String(peB),
        peAInnerIf: values?.peAInnerIf,
        peBInnerIf: values?.peBInnerIf,
        peANeighborMode: values?.peANeighborMode || 'static',
        peBNeighborMode: values?.peBNeighborMode || 'static',
        peARrDomain: resolveRrDomainById(values?.peARrDomainId),
        peBRrDomain: resolveRrDomainById(values?.peBRrDomainId),
        peConfigs,
        ceConfigs,
        peStorageCfgs: {
          peA: peAPreviewStorageCfg,
          peB: peBPreviewStorageCfg,
        },
        cePreviewCfgs: { ceA: ceAPreviewCfg, ceB: ceBPreviewCfg },
        rdRtMeta: rdRtForSave,
        tunnelTopology: selectedTopology,
        hubPeSlot: inferredHubPeSlot ?? undefined,
        hubVrfMode: selectedTopology === 'H' ? hubVrfMode : undefined,
        hubWanIf: hubWanIfResolved,
        hubLanIf: hubLanIfResolved,
        hubWanInventoryId: values?.hubWanInventoryId,
        hubLanInventoryId: hubLanInventoryIdResolved || lanOptMatch?.value,
        ceAHaBinding:
          ceAMode === '高可用'
            ? resolveSrv6CeHaBindingById(haGroups, String(values?.ceAHaGroupId || ''))
            : null,
        ceBHaBinding:
          ceBMode === '高可用'
            ? resolveSrv6CeHaBindingById(haGroups, String(values?.ceBHaGroupId || ''))
            : null,
        hubInventory:
          hubInventoryUi?.inventory && hubInventoryUi.inventory.wan.length
            ? hubInventoryUi.inventory
            : {
                wan: hubWanInventoryOptions.map((o) => ({
                  id: String(o.value),
                  ifName: o.ifName,
                  ipv6: o.ipv6 || '',
                  source: 'device_baseline' as const,
                  createdAt: '',
                })),
                lan: [],
              },
      });
      const payload = {
        name: tunnelName,
        peA: String(peA),
        peB: String(peB),
        ceA: String(ceA),
        ceB: String(ceB),
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
        bothCeHa
          ? `隧道已${editId ? '更新' : '创建'}，四端生效配置已由平台重算并写入库。两端高可用侧请由网工完成下发。`
          : hasAnyCeHa
            ? `隧道已${editId ? '更新' : '创建'}，四端生效配置已由平台重算并写入库。可进入「下发向导」推送 PE/标准侧 CE；高可用侧由网工处理。`
            : `隧道已${editId ? '更新' : '创建'}，四端生效配置已由平台重算并写入库。请进入「下发向导」分步推送到设备。`,
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

  useEffect(() => {
    if (current !== 3) {
      deployAutoStartedRef.current = false;
      srv6DeployWizard.cancel();
      return;
    }
    // 任一端 CE 为高可用时不自动连跑（VRRP/HA 侧由网工处理）；两端均为标准时自动下发
    if (hasAnyCeHa) return;
    if (deployAutoStartedRef.current) return;
    deployAutoStartedRef.current = true;
    srv6DeployWizard.startAuto();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 仅在进入第 4 步时触发自动下发链
  }, [current, hasAnyCeHa]);

  const next = () => {
    if (current === 1 && !validateTunnelForm()) return;
    setCurrent((c) => Math.min(c + 1, 3));
  };
  const prev = () => setCurrent((c) => Math.max(c - 1, 0));

  const peRoleWizardExtra = (target: 'peA' | 'peB') => (
    <Button
      size="small"
      type="link"
      icon={<ExportOutlined />}
      style={{ padding: 0, height: 'auto' }}
      onClick={() => openRoleWizard(target)}
    >
      角色配置向导
    </Button>
  );

  const applyCeSideModeChange = (slot: 'ceA' | 'ceB', nextMode: Srv6TunnelCeMode) => {
    const currentMode = ceModeOf(slot);
    if (nextMode === currentMode) return;
    if (slot === 'ceA') setCeAMode(nextMode);
    else setCeBMode(nextMode);
    const haField = slot === 'ceA' ? 'ceAHaGroupId' : 'ceBHaGroupId';
    if (nextMode === '高可用') {
      form.setFieldsValue({ [slot]: undefined, [haField]: undefined });
      setCeConfigs((prev) => ({ ...prev, [slot]: undefined }));
    } else {
      form.setFieldsValue({ [haField]: undefined });
    }
    setFormValues((prev: any) => ({
      ...prev,
      [slot]: nextMode === '高可用' ? undefined : prev?.[slot],
      [haField]: undefined,
    }));
  };

  const ceRoleWizardExtra = (slot: 'ceA' | 'ceB') => (
    <Button
      size="small"
      type="link"
      icon={<ExportOutlined />}
      style={{ padding: 0, height: 'auto' }}
      onClick={() => openRoleWizard(slot)}
    >
      角色配置向导
    </Button>
  );

  const renderPeInnerIfField = (peKey: 'peA' | 'peB', field: 'peAInnerIf' | 'peBInnerIf', label: string) => {
    if (inferredTopology === 'H' && inferredHubPeSlot === peKey) return null;
    const cfg = peConfigs[peKey];
    return (
      <Form.Item
        name={field}
        label={label}
        rules={[{ required: true, message: `请选择 ${label}` }]}
      >
        <Select
          options={listInterfaceOptions(cfg)}
          showSearch
          allowClear
          optionFilterProp="label"
          placeholder="请选择"
        />
      </Form.Item>
    );
  };

  const renderPeNeighborFields = (peKey: 'peA' | 'peB') => {
    const modeField = peKey === 'peA' ? 'peANeighborMode' : 'peBNeighborMode';
    const domainField = peKey === 'peA' ? 'peARrDomainId' : 'peBRrDomainId';
    const peLabel = peKey === 'peA' ? 'PE-A' : 'PE-B';
    return (
      <>
        <Form.Item
          name={modeField}
          label={`${peLabel} 公网邻居模式`}
          initialValue="static"
        >
          <Radio.Group>
            <Radio value="static">静态 PE–PE</Radio>
            <Radio value="rr_domain">RR 反射域</Radio>
          </Radio.Group>
        </Form.Item>
        <Form.Item noStyle shouldUpdate={(prev, cur) => prev[modeField] !== cur[modeField]}>
          {({ getFieldValue }) =>
            getFieldValue(modeField) === 'rr_domain' ? (
              <Form.Item
                name={domainField}
                label={`${peLabel} RR 反射域`}
                rules={[{ required: true, message: '请选择 RR 反射域' }]}
              >
                <Select
                  options={rrDomainOptions}
                  loading={rrDomainsLoading}
                  showSearch
                  allowClear
                  optionFilterProp="label"
                  placeholder="选择 RR 反射域档案"
                />
              </Form.Item>
            ) : null
          }
        </Form.Item>
      </>
    );
  };

  const renderCeField = (slot: 'ceA' | 'ceB') => {
    const isLocal = slot === 'ceA';
    const sideMode = ceModeOf(slot);
    if (sideMode === '标准') {
      return (
        <Form.Item
          name={slot}
          label={isLocal ? 'CE-A' : 'CE-B'}
          dependencies={isLocal ? undefined : ['ceA']}
          rules={
            isLocal
              ? [{ required: true, message: '请选择 CE-A' }]
              : [
                  { required: true, message: '请选择 CE-B' },
                  ({ getFieldValue }) => ({
                    validator(_, v) {
                      const a = getFieldValue('ceA');
                      if (!v) return Promise.resolve();
                      if (String(v) !== String(a)) return Promise.resolve();
                      return Promise.reject(new Error('CE-A 与 CE-B 不能相同'));
                    },
                  }),
                ]
          }
          extra={ceRoleWizardExtra(slot)}
        >
          <Select
            options={ceOptions}
            showSearch
            allowClear
            optionFilterProp="label"
            placeholder={isLocal ? '选择 CE-A' : '选择 CE-B'}
          />
        </Form.Item>
      );
    }
    const haField = isLocal ? 'ceAHaGroupId' : 'ceBHaGroupId';
    return (
      <Form.Item
        name={haField}
        label={`${isLocal ? 'CE-A' : 'CE-B'}（高可用组）`}
        dependencies={isLocal ? undefined : ['ceAHaGroupId']}
        rules={
          isLocal
            ? [{ required: true, message: '请选择 CE-A 高可用组' }]
            : [
                { required: true, message: '请选择 CE-B 高可用组' },
                ({ getFieldValue }) => ({
                  validator(_, v) {
                    const a = getFieldValue('ceAHaGroupId');
                    if (!v || !a || String(v) !== String(a)) return Promise.resolve();
                    return Promise.reject(new Error('不能与 CE-A 选择同一高可用组'));
                  },
                }),
              ]
        }
        extra={
          <Button
            type="link"
            size="small"
            icon={<ExportOutlined />}
            style={{ padding: 0, height: 'auto' }}
            onClick={() =>
              window.open('/admin/interconnect/ha-groups/create', '_blank', 'noopener,noreferrer')
            }
          >
            高可用组向导
          </Button>
        }
      >
        <Select
          options={haGroupOptions.map((o) => ({ value: o.value, label: o.label }))}
          loading={haGroupsLoading}
          showSearch
          allowClear
          optionFilterProp="label"
          placeholder="选择 CE 高可用组"
        />
      </Form.Item>
    );
  };

  const renderEndpointColumn = (side: 'local' | 'remote') => {
    const peKey = side === 'local' ? 'peA' : 'peB';
    const innerField = side === 'local' ? 'peAInnerIf' : 'peBInnerIf';
    const ceSlot = side === 'local' ? 'ceA' : 'ceB';
    const title = side === 'local' ? '设定本端设备' : '设定对端设备';
    return (
      <>
        {wizardSectionHeader(title)}
        <Form.Item
          name={peKey}
          label={peKey === 'peA' ? 'PE-A' : 'PE-B'}
          dependencies={side === 'remote' ? ['peA'] : undefined}
          rules={
            side === 'local'
              ? [{ required: true, message: '请选择 PE-A' }]
              : [
                  { required: true, message: '请选择 PE-B' },
                  ({ getFieldValue }) => ({
                    validator(_, v) {
                      const a = getFieldValue('peA');
                      if (!v) return Promise.resolve();
                      if (String(v) !== String(a)) return Promise.resolve();
                      return Promise.reject(new Error('PE-A 与 PE-B 不能相同'));
                    },
                  }),
                ]
          }
          extra={peRoleWizardExtra(peKey)}
        >
          <Select
            options={peOptions}
            showSearch
            allowClear
            optionFilterProp="label"
            placeholder={side === 'local' ? '选择 PE-A' : '选择 PE-B'}
          />
        </Form.Item>
        {renderPeInnerIfField(peKey, innerField, `${peKey === 'peA' ? 'PE-A' : 'PE-B'} 内网口`)}
        {renderHubPeInline(peKey)}
        {renderPeNeighborFields(peKey)}
        <Form.Item label={ceSlot === 'ceA' ? 'CE-A 类型' : 'CE-B 类型'} required>
          <Radio.Group
            value={ceModeOf(ceSlot)}
            onChange={(e) => applyCeSideModeChange(ceSlot, e.target.value as Srv6TunnelCeMode)}
          >
            <Radio value="标准">标准（单台 CE）</Radio>
            <Radio value="高可用">高可用（CE 高可用组）</Radio>
          </Radio.Group>
        </Form.Item>
        {renderCeField(ceSlot)}
        {ceModeOf(ceSlot) === '高可用' ? (
          <Form.Item name={ceSlot} hidden>
            <Input />
          </Form.Item>
        ) : null}
      </>
    );
  };

  const wizardStepShell = (children: React.ReactNode) => (
    <Space direction="vertical" size="middle" style={{ width: '100%' }}>
      {children}
    </Space>
  );

  const CoreContent: React.FC = () => {
    if (current === 0) {
      return (
        <Form layout="vertical" form={form} onKeyDown={handleFormKeyDown} onBlur={handleFormBlur}>
          <Form.Item
            name="tunnelName"
            label="隧道名称"
            rules={[{ required: true, message: '请输入隧道名称' }]}
          >
            <Input placeholder="例如：beijing-to-shanghai" />
          </Form.Item>
          <Form.Item label="隧道类型" required>
            <Radio.Group
              value={tunnelLinkType}
              onChange={(e) => {
                const next = e.target.value as Srv6TunnelLinkType;
                if (next === tunnelLinkType) return;
                setTunnelLinkType(next);
                clearPeSelectionsForLinkTypeChange();
              }}
            >
              <Radio value="spoke_spoke">Spoke – Spoke</Radio>
              <Radio value="spoke_hub">Spoke – Hub</Radio>
              <Radio value="hub_hub">Hub – Hub</Radio>
            </Radio.Group>
          </Form.Item>
        </Form>
      );
    }
    if (current === 1) {
      return (
        <Form
          layout="vertical"
          form={form}
          onKeyDown={handleFormKeyDown}
          onBlur={handleFormBlur}
          onValuesChange={handleValuesChange}
        >
          {wizardStepShell(
            <Row gutter={24}>
              <Col xs={24} lg={12}>
                {renderEndpointColumn('local')}
              </Col>
              <Col xs={24} lg={12}>
                {renderEndpointColumn('remote')}
              </Col>
            </Row>,
          )}
        </Form>
      );
    }
    if (current === 2) {
      const neighborLabel = (side: 'peA' | 'peB') => {
        const modeField = side === 'peA' ? 'peANeighborMode' : 'peBNeighborMode';
        const domainField = side === 'peA' ? 'peARrDomainId' : 'peBRrDomainId';
        const m = form.getFieldValue(modeField) || 'static';
        if (m !== 'rr_domain') return '静态（PE–PE）';
        const d = resolveRrDomainById(form.getFieldValue(domainField));
        return d
          ? `RR 反射域 · ${d.displayName}（${d.name}）· AS${d.remoteAs} · ${d.nodes.length} RR`
          : 'RR 反射域（未选域）';
      };
      return wizardStepShell(
        <>
          <Descriptions bordered column={1} size="small">
            <Descriptions.Item label="隧道名称">{form.getFieldValue('tunnelName') || '-'}</Descriptions.Item>
            <Descriptions.Item label="隧道类型">{tunnelLinkTypeLabel(tunnelLinkType)}</Descriptions.Item>
            <Descriptions.Item label="档案拓扑">
              {selectedTopology === 'H' ? 'Hub–Spoke (H)' : '点对点 (S)'}
            </Descriptions.Item>
            <Descriptions.Item label="CE-A 类型">{ceAMode}</Descriptions.Item>
            {ceAMode === '高可用' ? (
              <>
                <Descriptions.Item label="CE-A 高可用组">
                  {resolveCeHaBinding('ceA')?.haGroupName || form.getFieldValue('ceAHaGroupId') || '-'}
                </Descriptions.Item>
                <Descriptions.Item label="CE-A 主/备">
                  {(() => {
                    const b = resolveCeHaBinding('ceA');
                    return b ? `${b.primaryName || b.primaryVrUuid} / ${b.backupName || b.backupVrUuid}` : '-';
                  })()}
                </Descriptions.Item>
              </>
            ) : (
              <Descriptions.Item label="CE-A">{form.getFieldValue('ceA') || '-'}</Descriptions.Item>
            )}
            <Descriptions.Item label="CE-B 类型">{ceBMode}</Descriptions.Item>
            {ceBMode === '高可用' ? (
              <>
                <Descriptions.Item label="CE-B 高可用组">
                  {resolveCeHaBinding('ceB')?.haGroupName || form.getFieldValue('ceBHaGroupId') || '-'}
                </Descriptions.Item>
                <Descriptions.Item label="CE-B 主/备">
                  {(() => {
                    const b = resolveCeHaBinding('ceB');
                    return b ? `${b.primaryName || b.primaryVrUuid} / ${b.backupName || b.backupVrUuid}` : '-';
                  })()}
                </Descriptions.Item>
              </>
            ) : (
              <Descriptions.Item label="CE-B">{form.getFieldValue('ceB') || '-'}</Descriptions.Item>
            )}
            <Descriptions.Item label="PE-A">{form.getFieldValue('peA') || '-'}</Descriptions.Item>
            <Descriptions.Item label="PE-A 公网邻居">{neighborLabel('peA')}</Descriptions.Item>
            <Descriptions.Item label="PE-B">{form.getFieldValue('peB') || '-'}</Descriptions.Item>
            <Descriptions.Item label="PE-B 公网邻居">{neighborLabel('peB')}</Descriptions.Item>
            {selectedTopology === 'H' ? (
              <>
                <Descriptions.Item label="Hub 槽位">
                  {inferredHubPeSlot === 'peA' ? 'PE-A' : inferredHubPeSlot === 'peB' ? 'PE-B' : '-'}
                </Descriptions.Item>
                <Descriptions.Item label="Hub WAN">{form.getFieldValue('hubWanIf') || '-'}</Descriptions.Item>
                <Descriptions.Item label="Hub LAN">
                  {(() => {
                    const lanIf = String(form.getFieldValue('hubLanIf') ?? '').trim();
                    const lanId = String(form.getFieldValue('hubLanInventoryId') ?? '').trim();
                    const meta =
                      hubLanInventoryOptions.find((o) => o.value === lanId) ??
                      hubLanInventoryOptions.find((o) => o.ifName === lanIf);
                    const parts = [lanIf || undefined, meta?.vrf != null ? `VRF ${meta.vrf}` : undefined].filter(
                      Boolean,
                    );
                    return parts.length ? parts.join(' · ') : '-';
                  })()}
                </Descriptions.Item>
                <Descriptions.Item label="客户侧模式">
                  {resolvedHubVrfMode === 'DEDICATED_VRF' ? '独立专网（DEDICATED_VRF）' : '共用客户侧（REUSE_VRF）'}
                </Descriptions.Item>
              </>
            ) : null}
            <Descriptions.Item label="公共 RT">{rdRtMeta?.rtCommon || '-'}</Descriptions.Item>
            <Descriptions.Item label="PE-A RD">{rdRtMeta?.rdMap?.peA || '-'}</Descriptions.Item>
            <Descriptions.Item label="PE-B RD">{rdRtMeta?.rdMap?.peB || '-'}</Descriptions.Item>
          </Descriptions>

          {!rdRtMeta || validateSrv6RdRtMeta(rdRtMeta) ? (
            <Alert
              type="warning"
              showIcon
              message="尚未从 PE 读到完整 RD/RT"
              description="请在各端 PE 角色向导第 2 步「LAN 侧配置 → BGP 配置（LAN）」中填写 Route Distinguisher（RD）与 Route Target（RT），且两端 RT 须一致；保存后再回到本向导选择内网口。"
            />
          ) : (
            <Alert
              type="info"
              showIcon
              message="RD / RT"
              description="取值来自 PE 角色向导已写入的 LAN BGP（所选内网 VRF）。如需修改请前往对应 PE 的角色配置向导。"
            />
          )}

          <Alert
            type="info"
            showIcon
            message="保存说明"
            description={
              bothCeHa
                ? '请先点击「创建隧道并保存到平台」，将隧道档案与四端拼装配置写入平台库。两端均为高可用时，策略与 VRRP 下发由网工执行，本向导不提供自动下发步骤。'
                : hasAnyCeHa
                  ? '请先保存到平台；保存后可进入下发向导推送 PE 与标准侧 CE。高可用侧 VRRP/策略由网工处理，向导不会自动连跑。'
                  : '请先点击「创建隧道并保存到平台」，将隧道记录与四端拼装配置写入平台库；再进入下一步「下发向导」，按 PE-A → PE-B → CE-A → CE-B 顺序分步预览并推送到设备（与 IPsec VPN 向导一致）。'
            }
          />
        </>,
      );
    }
    if (current === 3) {
      if (bothCeHa) {
        return wizardStepShell(
          <Alert
            type="success"
            showIcon
            message="平台档案已保存"
            description="两端高可用隧道档案已写入平台库。请由网工在设备侧完成 VRRP 与 SRv6 策略下发；可在 IBR Console 的 VRRP 面板查看设备态。"
          />,
        );
      }
      return wizardStepShell(
        <>
          {hasAnyCeHa ? (
            <Alert
              type="info"
              showIcon
              message="混合 CE 类型"
              description={`CE-A ${ceAMode} / CE-B ${ceBMode}。可对 PE 与标准侧 CE 手工分步下发；高可用侧请由网工完成 VRRP 与策略。`}
            />
          ) : null}
          <IbrDeployWizardPanel
            steps={srv6DeployWizard.steps}
            activeStep={srv6DeployWizard.activeStep}
            logs={srv6DeployWizard.logs}
            status={srv6DeployWizard.status}
            onRunStep={(idx) => void srv6DeployWizard.runStep(idx)}
          />
        </>,
      );
    }
    return null;
  };

  const handleWizardStepChange = (idx: number) => {
    if (idx >= 3 && !platformSaved) {
      message.warning('请先在「确认并保存」中完成「创建隧道并保存到平台」');
      return;
    }
    setCurrent(idx);
  };

  if (!canWrite) {
    return null;
  }

  return (
    <IbrWizardPage onBack={() => navigate('/admin/interconnect/srv6')} layout="linear" steps={
          <Steps
            direction="vertical"
            size="small"
            current={current}
            onChange={handleWizardStepChange}
            items={[
              { title: '基础信息' },
              { title: '选择 PE 与 CE' },
              { title: '确认并保存' },
              { title: bothCeHa ? '完成' : '下发向导', disabled: !platformSaved },
            ]}
          />
        }
        main={
          <IbrWizardStepPane
            title={ibrWizardStepCardTitle(
              current,
              ['基础信息', '选择 PE 与 CE', '确认并保存', bothCeHa ? '完成' : '下发向导'][current],
            )}
            footerLeft={
              <>
                {current !== 3 && <Button onClick={() => navigate('/admin/interconnect/srv6')}>返回列表</Button>}
                {current > 0 && (
                  <Button
                    onClick={prev}
                    disabled={srv6DeployWizard.steps.some((_, i) => srv6DeployWizard.status[i] === 'process')}
                  >
                    上一步
                  </Button>
                )}
                {current === 3 && (
                  <Button type="primary" onClick={() => navigate('/admin/interconnect/srv6')}>
                    关闭向导
                  </Button>
                )}
              </>
            }
            footerRight={
              <>
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
                    {bothCeHa ? (
                      <Button type="primary" disabled={!platformSaved} onClick={() => navigate('/admin/interconnect/srv6')}>
                        完成
                      </Button>
                    ) : (
                      <Button type="primary" disabled={!platformSaved} onClick={() => { commitPreview(); next(); }}>
                        下一步：下发向导
                      </Button>
                    )}
                  </>
                )}
              </>
            }
          >
            <CoreContent />
          </IbrWizardStepPane>
        }
        preview={
          <IbrWizardCard
            sticky
            style={{ width: '100%' }}
            tabList={[
              { key: 'peA', tab: 'PE-A' },
              { key: 'peB', tab: 'PE-B' },
              { key: 'ceA', tab: 'CE-A' },
              { key: 'ceB', tab: 'CE-B' },
            ]}
            activeTabKey={previewTabKey}
            onTabChange={setPreviewTabKey}
            tabProps={{ size: 'middle' }}
          >
            {(() => {
              const cfgMap: Record<string, unknown> = {
                peA: peAPreviewCfg,
                peB: peBPreviewCfg,
                ceA: ceAPreviewCfg,
                ceB: ceBPreviewCfg,
              };
              const cfg = cfgMap[previewTabKey];
              return cfg ? (
                <pre style={{ fontSize: 12, lineHeight: '18px', whiteSpace: 'pre-wrap', wordBreak: 'break-word', margin: 0 }}>
                  {safeStringify(cfg)}
                </pre>
              ) : (
                <div style={{ color: 'rgba(0,0,0,.45)' }}>未选择或无配置</div>
              );
            })()}
          </IbrWizardCard>
        }
    >
    </IbrWizardPage>
  );
};

export default SRv6CreatePage;
