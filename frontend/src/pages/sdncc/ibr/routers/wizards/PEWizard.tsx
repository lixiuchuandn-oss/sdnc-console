import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, Descriptions, Divider, Form, Input, InputNumber, Steps, message, Select, Tabs, Spin, Modal, Checkbox } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import {
  srv6SidPrefixPhase1Extra,
  validateSrv6SidPrefixPhase1,
} from '../../srv6/srv6SidPrefix';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import {
  fetchVrTowerLocalConfigCache,
  saveVRConfig,
  setVRRole,
  fetchVrCacheMerged,
} from '../../../../../services/virtualRouterApi';
import { fetchSrv6VrReferences, proxyApiRequest } from '../../../../../services/api';
import {
  collectIfaceNamesForSelect,
  looksLikeIfaceName,
  pickDeviceBlobForLookup,
} from '../vrMergedHelpers';
import { renderIfaceWizardSelectLabel } from '../vrWizardIfaceSelect';
import { filterLinkLocalIpv6, pickIfaceIpv6FromDevice } from '../vrIpv6Utils';
import {
  attachHubInventoryToConfig,
  buildHubInventoryFromPeWizardValues,
  hubInventoryToPeWizardForm,
  parseHubInventoryFromConfig,
  stripTowerExtensionsFromDeviceConfig,
} from '../hubPeInventory';
import { planInventoryTabEdit } from '../peWizardTabEdit';
import { warnFormValidationFailure } from '../vrWizardFormUtils';
import { sortVrConfigJsonKeys } from '../vrConfigJsonSort';
import {
  assertUniqueHubInventoryIfNames,
  buildHubWanMirrorRowsFromDevice,
  buildWanStaticRoutesFromRows,
  type WanRouteFormRow,
} from '../peWizardWanRoutes';
import { isValidRdRtToken } from '../../srv6/srv6RdRt';
import IbrWizardCard, { ibrWizardStepCardTitle } from '../../lib/IbrWizardCard';
import IbrWizardPage from '../../lib/IbrWizardPage';
import IbrWizardStepPane from '../../lib/IbrWizardStepPane';

const rdRtFieldRules = (label: string) => [
  { required: true, message: `请输入 ${label}` },
  {
    validator: (_: unknown, value: unknown) => {
      const s = String(value ?? '').trim();
      if (!s) return Promise.resolve();
      if (!isValidRdRtToken(s)) {
        return Promise.reject(new Error(`${label} 须为「数字:数字」格式（例如 200:100）`));
      }
      return Promise.resolve();
    },
  },
];

/** 从 BGP 段 ipv4 unicast AF 读取 RD/RT */
const extractRdRtFromBgpEntry = (
  b: any,
): { routeDistinguisher?: string; routeTarget?: string } => {
  const afs = Array.isArray(b?.address_family) ? b.address_family : [];
  const af =
    afs.find(
      (a: any) =>
        String(a?.address_family || '').toLowerCase() === 'ipv4' &&
        String(a?.modifiler || a?.modifier || '').toLowerCase() === 'unicast',
    ) || afs[0];
  const rd = String(af?.route_distinguisher ?? '').trim();
  const rt = String(af?.route_target ?? '').trim();
  return {
    ...(rd ? { routeDistinguisher: rd } : {}),
    ...(rt ? { routeTarget: rt } : {}),
  };
};

/** 读取平台侧 pe 配置；优先 pe.publicConfig，否则从根级扁平字段组装 */
function getPePublicConfig(pe: any): Record<string, any> {
  if (!pe || typeof pe !== 'object') return {};
  if (pe.publicConfig && typeof pe.publicConfig === 'object') {
    return { ...pe.publicConfig };
  }
  const legacy: any = {};
  const keys = [
    'publicBgpIndex',
    'locatorName',
    'sidPrefix',
    'wanName',
    'wanDev',
    'wanIpv4',
    'wanIpv6',
    'wanRouteDest',
    'wanRoutePriority',
    'wanRouteVia', // legacy：曾用 via，回读时忽略
    'ipv6Dest',
    'ipv6Via',
    'publicBgp',
    'bgpNetworkIpv4',
    'bgpNetworkIpv6',
  ];
  keys.forEach((k) => {
    if ((pe as any)[k] !== undefined) legacy[k] = (pe as any)[k];
  });
  return legacy;
}

/** 读取 LAN 列表：兼容 pe.lanConfig、pe.lanConfigs、pe.LanConfig */
function readLanListFromPe(pe: any): any[] {
  if (!pe || typeof pe !== 'object') return [];
  if (Array.isArray((pe as any).lanConfig)) return (pe as any).lanConfig;
  if (Array.isArray((pe as any).LanConfig)) return (pe as any).LanConfig;
  if (Array.isArray((pe as any).lanConfigs)) return (pe as any).lanConfigs;
  return [];
}

/** 公网 BGP 元数据：从 PE publicBgp 或根级 bgpAsn / bgpRouterId 读取 */
function readPublicBgpMetaFromPe(pe: any): { asn?: number; routerId?: string } {
  const pub = getPePublicConfig(pe);
  const pb = pub.publicBgp && typeof pub.publicBgp === 'object' ? pub.publicBgp : {};
  const root = pe && typeof pe === 'object' ? pe : {};
  const asnRaw = pb.asn ?? (pb as any).bgpAsn ?? (root as any).bgpAsn ?? (root as any).publicBgpAsn;
  const asnNum = Number(asnRaw);
  const routerId =
    String(
      pb.routerId ??
        (pb as any).bgpRouterId ??
        (root as any).bgpRouterId ??
        (root as any).publicBgpRouterId ??
        '',
    ).trim() || undefined;
  return {
    ...(Number.isFinite(asnNum) ? { asn: asnNum } : {}),
    ...(routerId ? { routerId } : {}),
  };
}

/** 规范 LAN 行：展开 lanBgp，去掉扁平 lan 上的冗余 bgpAsn 等 */
function normalizeLanRowFromPeMeta(l: any) {
  if (!l || typeof l !== 'object') return {};
  const lb = l.lanBgp && typeof l.lanBgp === 'object' ? l.lanBgp : {};
  const asnRaw = lb.asn ?? l.lanBgpAsn ?? l.bgpAsn ?? l.asn;
  const asnNum = Number(asnRaw);
  const routerId =
    String(lb.routerId ?? l.lanBgpRouterId ?? l.bgpRouterId ?? l.routerId ?? '').trim() || undefined;
  const routeDistinguisher =
    String(lb.routeDistinguisher ?? l.routeDistinguisher ?? '').trim() || undefined;
  const routeTarget = String(lb.routeTarget ?? l.routeTarget ?? '').trim() || undefined;
  const {
    lanBgp: _lb,
    lanBgpAsn: _la,
    lanBgpRouterId: _lr,
    bgpAsn: _ba,
    bgpRouterId: _br,
    asn: _a,
    routerId: _r,
    routeDistinguisher: _rd,
    routeTarget: _rt,
    ifName,
    lanName,
    ...rest
  } = l;
  return {
    ...rest,
    ifName: lanName || ifName,
    ...(Number.isFinite(asnNum) ? { asn: asnNum } : {}),
    ...(routerId ? { routerId } : {}),
    ...(routeDistinguisher ? { routeDistinguisher } : {}),
    ...(routeTarget ? { routeTarget } : {}),
  };
}

function isPublicBgpEntry(b: any): boolean {
  return !!b && (b.vrf == null || b.vrf === '' || b.vrf === 0 || b.vrf === '0');
}

function ipv6DestFromRoute(route: any): string | undefined {
  const raw = String(route?.destination || '').trim();
  if (!raw) return undefined;
  if (raw.includes('/')) return raw;
  return `${raw}/128`;
}

function roleText(v: unknown): string {
  return String(v ?? '').trim();
}

/** 角色没填的地址不回显；填了才读该接口上角色下发后的 static，避免把初始化地址当成角色配置。 */
function deviceStaticIfRoleSet(
  iface: any,
  key: 'ipv4_static' | 'ipv6_static',
  roleValue: unknown,
): string | undefined {
  if (!roleText(roleValue)) return undefined;
  return roleText(iface?.[key]) || undefined;
}

function pickIpv4RouteForWan(routes: any[], wanName: string, roleDest: unknown, rolePriority?: unknown) {
  if (!wanName || (!roleText(roleDest) && rolePriority == null)) return undefined;
  const onDev = routes.filter((r) => roleText(r?.dev) === wanName);
  if (!onDev.length) return undefined;
  const dest = roleText(roleDest);
  return (dest && onDev.find((r) => roleText(r?.destination) === dest)) || onDev[0];
}

/** IPv6 路由没有 dev。角色没配则不回显；配了则按目的网段对上设备条目，单条时直接展示以便看出不一致。 */
function pickIpv6RouteForRole(
  routes: any[],
  roleDest: unknown,
  roleVia: unknown,
  allowSingle: boolean,
) {
  if (!roleText(roleDest) && !roleText(roleVia)) return undefined;
  const dest = roleText(roleDest);
  const hit = dest ? routes.find((r) => ipv6DestFromRoute(r) === dest) : undefined;
  if (hit) return hit;
  if (allowSingle && routes.length === 1) return routes[0];
  return undefined;
}

/**
 * 设备回读只核对角色配置点名的对象：
 * 口名、是否回显地址/路由，以已保存的 pe 为准；
 * 值只来自这些口的 ipv4_static/ipv6_static、dev 对上的 ipv4_route、以及无 VRF 的公网 BGP。
 */
function buildSpokeRoleMirror(
  dev: any,
  pe: any,
  findInterface: (device: any, name: string) => any,
): Record<string, any> {
  const pcfg = getPePublicConfig(pe);
  const wanName = roleText(pcfg.wanName || pcfg.wanDev);
  const wanIf = wanName ? findInterface(dev, wanName) : null;
  const routes4 = Array.isArray(dev?.ipv4_route) ? dev.ipv4_route : [];
  const routes6 = Array.isArray(dev?.ipv6_route) ? dev.ipv6_route : [];
  const wanRoute4 = pickIpv4RouteForWan(
    routes4,
    wanName,
    pcfg.wanRouteDest,
    pcfg.wanRoutePriority,
  );
  const wanRoute6 = pickIpv6RouteForRole(routes6, pcfg.ipv6Dest, pcfg.ipv6Via, true);
  const bgpArr = Array.isArray(dev?.bgp) ? dev.bgp : [];
  const publicBgp = bgpArr.find(isPublicBgpEntry);
  const lanConfigs = readLanListFromPe(pe)
    .map((row) => normalizeLanRowFromPeMeta(row))
    .filter((row) => roleText(row?.ifName) || row?.vrf != null)
    .map((row) => {
      const ifn = roleText(row?.ifName);
      const iface = ifn ? findInterface(dev, ifn) : null;
      const bgp = bgpArr.find((b: any) => row?.vrf != null && String(b?.vrf) === String(row.vrf));
      const rdRt = bgp ? extractRdRtFromBgpEntry(bgp) : {};
      return {
        vrf: row.vrf,
        ifName: ifn || undefined,
        ipv4: deviceStaticIfRoleSet(iface, 'ipv4_static', row?.ipv4),
        ipv6: deviceStaticIfRoleSet(iface, 'ipv6_static', row?.ipv6),
        asn: row?.asn != null && row?.asn !== '' ? bgp?.asn : undefined,
        routerId: roleText(row?.routerId) ? bgp?.router_id : undefined,
        routeDistinguisher: roleText(row?.routeDistinguisher) ? rdRt.routeDistinguisher : undefined,
        routeTarget: roleText(row?.routeTarget) ? rdRt.routeTarget : undefined,
      };
    });
  const srv6 = dev?.segment_routing_srv6;
  return {
    locatorName: roleText(pcfg.locatorName) ? srv6?.locator : undefined,
    sidPrefix: roleText(pcfg.sidPrefix) ? srv6?.prefix : undefined,
    wanDev: wanName || undefined,
    wanIpv4: deviceStaticIfRoleSet(wanIf, 'ipv4_static', pcfg.wanIpv4),
    wanIpv6: deviceStaticIfRoleSet(wanIf, 'ipv6_static', pcfg.wanIpv6),
    wanRouteDest: wanRoute4?.destination || undefined,
    wanRoutePriority:
      wanRoute4?.priority !== undefined && wanRoute4?.priority !== null
        ? Number(wanRoute4.priority)
        : undefined,
    ipv6Dest: ipv6DestFromRoute(wanRoute6),
    ipv6Via: wanRoute6?.via || undefined,
    bgpAsn: publicBgp?.asn,
    bgpRouterId: publicBgp?.router_id,
    lanConfigs: lanConfigs.length ? lanConfigs : [{}],
  };
}

type PeWizardFieldName = string | (string | number)[];

/** 按向导步骤收集待校验字段，避免第 1 步误校验隐藏的 LAN 配置 */
function buildPeWizardStepFieldNames(
  step: number,
  hub: boolean,
  values: Record<string, unknown>,
): PeWizardFieldName[] {
  if (step === 0) {
    if (hub) {
      const rows = Array.isArray(values.hubWanInventory) ? values.hubWanInventory : [{}];
      const names: PeWizardFieldName[] = ['locatorName', 'sidPrefix', 'bgpAsn', 'bgpRouterId'];
      rows.forEach((_: unknown, idx: number) => {
        names.push(
          ['hubWanInventory', idx, 'ifName'],
          ['hubWanInventory', idx, 'ipv6'],
          ['hubWanInventory', idx, 'ipv6Dest'],
          ['hubWanInventory', idx, 'ipv6Via'],
        );
      });
      return names;
    }
    return [
      'locatorName',
      'sidPrefix',
      'wanDev',
      'wanIpv6',
      'bgpAsn',
      'bgpRouterId',
      'ipv6Dest',
      'ipv6Via',
    ];
  }
  if (step === 1) {
    const rows = Array.isArray(values.lanConfigs) ? values.lanConfigs : [{}];
    const names: PeWizardFieldName[] = [];
    rows.forEach((_: unknown, idx: number) => {
      if (hub) {
        names.push(
          ['lanConfigs', idx, 'vrf'],
          ['lanConfigs', idx, 'asn'],
          ['lanConfigs', idx, 'routerId'],
          ['lanConfigs', idx, 'routeDistinguisher'],
          ['lanConfigs', idx, 'routeTarget'],
        );
      } else {
        names.push(
          ['lanConfigs', idx, 'vrf'],
          ['lanConfigs', idx, 'routeDistinguisher'],
          ['lanConfigs', idx, 'routeTarget'],
        );
      }
    });
    return names;
  }
  return [];
}

const PEWizard: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const peRoleTarget =
    new URLSearchParams(location.search).get('peRole') === 'HUB_PE' ||
    (location.state as { peRole?: string } | null)?.peRole === 'HUB_PE'
      ? 'HUB_PE'
      : 'SPOKE_PE';
  const isHubPe = peRoleTarget === 'HUB_PE';
  const { uuid } = useParams();
  const [form] = Form.useForm();
  const [mirrorForm] = Form.useForm();
  const [current, setCurrent] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(false);
  const [existingCfg, setExistingCfg] = useState<any>({});
  const [ifaceOptions, setIfaceOptions] = useState<string[]>([]);
  const [ifaceLoading, setIfaceLoading] = useState<boolean>(false);
  const [csmctlCfg, setCsmctlCfg] = useState<any | null>(null);
  const hasRoleConfig = Boolean(
    (existingCfg?.pe && typeof existingCfg.pe === 'object' && Object.keys(existingCfg.pe).length) ||
      (csmctlCfg?.pe && typeof csmctlCfg.pe === 'object' && Object.keys(csmctlCfg.pe).length),
  );
  /** vr3_info 设备回读：用于在接口选择后反查 IP 等字段 */
  const [vr3Info, setVr3Info] = useState<any | null>(null);
  const [activeLanTabKey, setActiveLanTabKey] = useState<string>('0');
  const [activeWanTabKey, setActiveWanTabKey] = useState<string>('0');
  const [confirmOpen, setConfirmOpen] = useState<boolean>(false);
  const [confirmChecked, setConfirmChecked] = useState<boolean>(false);
  const existingHubInventory = useMemo(
    () => parseHubInventoryFromConfig(existingCfg),
    [existingCfg],
  );
  /** 仅刷新设备回读时：跳过用 vr2 推断覆盖左侧编辑 form，只更新右侧 mirror */
  const skipEditFormOnNextDeviceReadRef = useRef(false);
  /** 平台上报的管理口 IPv4，用于 Router-ID 空值预填 */
  const managementIpRef = useRef('');

  const watchWanDev = Form.useWatch('wanDev', form);
  const watchLanConfigs = Form.useWatch('lanConfigs', form);
  const watchHubWanInventory = Form.useWatch('hubWanInventory', form);

  const peIfaceSelectOptions = useCallback(
    (
      rowIndex: number,
      kind: 'hubWan' | 'lan' | 'wan',
    ): Array<{ value: string; label: React.ReactNode }> => {
      const hubWanRows = Array.isArray(watchHubWanInventory) ? watchHubWanInventory : [];
      const lanRows = Array.isArray(watchLanConfigs) ? watchLanConfigs : [];
      const legacyWan = String(watchWanDev || '').trim();

      return ifaceOptions.filter(looksLikeIfaceName).map((n) => {
        const hits: string[] = [];
        hubWanRows.forEach((row: any, i: number) => {
          if (kind === 'hubWan' && i === rowIndex) return;
          const ifn = String(row?.ifName || '').trim();
          if (ifn && ifn === n) hits.push(`WAN#${i + 1}`);
        });
        lanRows.forEach((row: any, i: number) => {
          if (kind === 'lan' && i === rowIndex) return;
          const ifn = String(row?.ifName || '').trim();
          if (ifn && ifn === n) hits.push(`LAN#${i + 1}`);
        });
        if (kind !== 'hubWan' && kind !== 'wan' && legacyWan && legacyWan === n) {
          hits.push('WAN');
        }
        return {
          value: n,
          label: renderIfaceWizardSelectLabel(n, hits.length ? hits.join('、') : undefined),
        };
      });
    },
    [ifaceOptions, watchHubWanInventory, watchLanConfigs, watchWanDev],
  );

  const normalizeIfaceName = (s: string) =>
    String(s || '')
      .trim()
      .replace(/\s+/g, ' ')
      .toLowerCase();

  const ifaceRowMatchesName = (it: any, ifaceName: string) => {
    const name = normalizeIfaceName(ifaceName);
    if (!name) return false;
    const candidates = [it?.name, it?.iface, it?.interface, it?.ifName, it?.devName].filter(Boolean);
    return candidates.some((c) => normalizeIfaceName(String(c)) === name);
  };

  const findInterfaceInDevice = (dev: any, ifaceName: string) => {
    const nameRaw = String(ifaceName || '').trim();
    if (!dev || !nameRaw) return null;
    const root = dev?.data && typeof dev.data === 'object' ? dev.data : dev;
    const lists: any[][] = [];
    if (Array.isArray(root.interfaces)) lists.push(root.interfaces);
    if (Array.isArray(dev.interfaces) && dev !== root) lists.push(dev.interfaces);
    for (const arr of lists) {
      const hit = arr.find((it: any) => ifaceRowMatchesName(it, nameRaw));
      if (hit) return hit;
    }
    const scanBuckets = (obj: any) => {
      if (!obj || typeof obj !== 'object') return null;
      for (const key of Object.keys(obj)) {
        if ((key.startsWith('interfaces_') || key.startsWith('subinterfaces_')) && Array.isArray((obj as any)[key])) {
          const hit = ((obj as any)[key] as any[]).find((it: any) => ifaceRowMatchesName(it, nameRaw));
          if (hit) return hit;
        }
      }
      return null;
    };
    const fromRoot = scanBuckets(root);
    if (fromRoot) return fromRoot;
    return scanBuckets(dev);
  };

  const pickIfaceIpv4 = (iface: any) =>
    iface?.ipv4_static ??
    iface?.ipv4Static ??
    iface?.ipv4 ??
    iface?.ipv4_address ??
    iface?.ipv4Address ??
    iface?.ip_address ??
    iface?.ipAddress ??
    iface?.ip ??
    iface?.address ??
    '';
  const pickIfaceIpv6 = pickIfaceIpv6FromDevice;

  /** WAN 口变更时：从 VR3 设备回读回填 IPv4/IPv6 */
  const autoFillWanFromIface = (ifaceName: string, opts?: { force?: boolean }) => {
    const force = opts?.force ?? false;
    const obj =
      findInterfaceInDevice(vr3Info, ifaceName) || findInterfaceInDevice(csmctlCfg, ifaceName);
    if (!obj) {
      if (force) form.setFieldsValue({ wanIpv4: undefined, wanIpv6: undefined });
      return;
    }
    const v4 = String(pickIfaceIpv4(obj) || '').trim();
    const v6 = String(pickIfaceIpv6(obj) || '').trim();
    const touchedV4 = form.isFieldTouched('wanIpv4');
    const touchedV6 = form.isFieldTouched('wanIpv6');
    form.setFieldsValue({
      ...(force || !touchedV4 ? { wanIpv4: v4 || undefined } : {}),
      ...(force || !touchedV6 ? { wanIpv6: v6 || undefined } : {}),
    });
  };

  const autoFillHubWanRow = (fieldIndex: number, ifaceName: string, opts?: { force?: boolean }) => {
    const force = opts?.force ?? false;
    const obj =
      findInterfaceInDevice(vr3Info, ifaceName) || findInterfaceInDevice(csmctlCfg, ifaceName);
    const rows = [...(form.getFieldValue('hubWanInventory') || [])];
    const row = { ...(rows[fieldIndex] || {}), ifName: ifaceName };
    if (obj) {
      const v4 = String(pickIfaceIpv4(obj) || '').trim();
      const v6 = String(pickIfaceIpv6(obj) || '').trim();
      if (force || !row.ipv4) row.ipv4 = v4 || undefined;
      if (force || !row.ipv6) row.ipv6 = v6 || undefined;
    } else if (force) {
      row.ipv4 = undefined;
      row.ipv6 = undefined;
    }
    rows[fieldIndex] = row;
    form.setFieldsValue({ hubWanInventory: rows });
  };

  /** LAN 口变更时：从 VR3/设备回读回填 IPv4/IPv6（与 WAN 一致） */
  const autoFillLanRow = (fieldIndex: number, ifaceName: string, opts?: { force?: boolean }) => {
    const force = opts?.force ?? false;
    const obj =
      findInterfaceInDevice(vr3Info, ifaceName) || findInterfaceInDevice(csmctlCfg, ifaceName);
    const rows = [...(form.getFieldValue('lanConfigs') || [])];
    const row = { ...(rows[fieldIndex] || {}), ifName: ifaceName };
    if (obj) {
      const v4 = String(pickIfaceIpv4(obj) || '').trim();
      const v6 = String(pickIfaceIpv6(obj) || '').trim();
      if (force || !row.ipv4) row.ipv4 = v4 || undefined;
      if (force || !row.ipv6) row.ipv6 = v6 || undefined;
    } else if (force) {
      row.ipv4 = undefined;
      row.ipv6 = undefined;
    }
    rows[fieldIndex] = row;
    form.setFieldsValue({ lanConfigs: rows });
  };

  const formatHubWanConfirmLine = (wan: any): string =>
    [wan?.ifName, wan?.ipv4, wan?.ipv6, wan?.ipv4RouteDest, wan?.ipv6Dest, wan?.ipv6Via ? `gw ${wan.ipv6Via}` : '']
      .filter(Boolean)
      .join(' · ') || '-';

  const prevWanDevRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    prevWanDevRef.current = undefined;
    skipEditFormOnNextDeviceReadRef.current = false;
    setActiveLanTabKey('0');
    setActiveWanTabKey('0');
  }, [uuid]);

  const ifaceLoadGenRef = useRef(0);

  /** 拉平台已保存角色和设备 VR2。左侧回读用这两份；VR3 只参与网卡下拉和用户改口时的预填。 */
  const fetchInterfaces = useCallback(async (silent = false) => {
    if (!uuid) return;
    const gen = ++ifaceLoadGenRef.current;
    const reqUuid = uuid;
    setIfaceLoading(true);
    try {
      const merged = await fetchVrCacheMerged(reqUuid);
      if (gen !== ifaceLoadGenRef.current || reqUuid !== uuid) return;
      if (!merged || typeof merged !== 'object') {
        if (!silent) message.warning('未获取到设备回读数据，请先确认 IBR 设备在线/已接入。');
        setCsmctlCfg(null);
        setVr3Info(null);
        return;
      }
      let savedCfg: any = {};
      try {
        const cached = await fetchVrTowerLocalConfigCache(reqUuid, { skipCache: true });
        if (gen !== ifaceLoadGenRef.current) return;
        savedCfg = cached?.config || {};
        managementIpRef.current = String(cached?.meta?.managementIp || '').trim();
      } catch (e) {
        console.warn('fetchInterfaces: fetchVrTowerLocalConfigCache failed:', e);
      }
      if (gen !== ifaceLoadGenRef.current || reqUuid !== uuid) return;
      if (!silent) {
        skipEditFormOnNextDeviceReadRef.current = true;
      }
      const inv = parseHubInventoryFromConfig(savedCfg);
      const extraNames = [
        ...(inv?.wan ?? []).map((w) => w.ifName),
        ...(inv?.lan ?? []).map((l) => l.ifName),
      ];
      const unique = collectIfaceNamesForSelect(merged as Record<string, any>, {
        baseline: savedCfg && typeof savedCfg === 'object' ? savedCfg : null,
        extraNames,
      });
      setIfaceOptions(unique.filter(looksLikeIfaceName));
      setCsmctlCfg(pickDeviceBlobForLookup(merged));
      setVr3Info(merged.vr3_info && typeof merged.vr3_info === 'object' ? merged.vr3_info : null);
      setExistingCfg(savedCfg);
      if (!silent) message.success('设备回读已刷新');
    } catch (err) {
      if (gen !== ifaceLoadGenRef.current) return;
      console.warn('[PEWizard] fetchVrCacheMerged:', (err as any)?.message || err);
      if (!silent) message.error('设备回读失败');
    } finally {
      if (gen === ifaceLoadGenRef.current) setIfaceLoading(false);
    }
  }, [uuid]);

  useEffect(() => {
    fetchInterfaces(true);
  }, [fetchInterfaces]);

  useEffect(() => {
    const applySavedPeToForm = () => {
      if (!existingCfg?.pe || !Object.keys(existingCfg.pe).length) return;
      const pe = existingCfg.pe;
      const pcfg = getPePublicConfig(pe);
      let lanConfigs = readLanListFromPe(pe).map((x: any) => normalizeLanRowFromPeMeta(x));
      if (!lanConfigs.length) lanConfigs = [{}];
      const pbg = readPublicBgpMetaFromPe(pe);
      form.setFieldsValue({
        locatorName: pcfg.locatorName,
        sidPrefix: pcfg.sidPrefix,
        wanDev: pcfg.wanName || pcfg.wanDev,
        wanIpv4: pcfg.wanIpv4,
        wanIpv6: pcfg.wanIpv6,
        wanRouteDest: pcfg.wanRouteDest,
        wanRoutePriority: pcfg.wanRoutePriority,
        ipv6Dest: pcfg.ipv6Dest,
        ipv6Via: pcfg.ipv6Via,
        bgpNetworkIpv4: pcfg.bgpNetworkIpv4,
        bgpNetworkIpv6: pcfg.bgpNetworkIpv6,
        bgpAsn: pbg.asn,
        bgpRouterId: pbg.routerId || undefined,
        lanConfigs,
        ...(isHubPe
          ? (() => {
              const hubForm = hubInventoryToPeWizardForm(existingCfg, {
                wanDev: pcfg.wanName || pcfg.wanDev,
                wanIpv4: pcfg.wanIpv4,
                wanIpv6: pcfg.wanIpv6,
                lanConfigs,
              });
              return {
                hubWanInventory: hubForm.hubWanInventory?.length ? hubForm.hubWanInventory : [{}],
                lanConfigs: hubForm.lanConfigs,
              };
            })()
          : {}),
      });
    };

    // vr2_info 为空且尚无 csmctlCfg：仅能应用 Tower 已保存的 pe 到表单
    if (!csmctlCfg) {
      if (skipEditFormOnNextDeviceReadRef.current) {
        skipEditFormOnNextDeviceReadRef.current = false;
        return;
      }
      applySavedPeToForm();
      return;
    }

    const dev = csmctlCfg || {};
    const keys = Object.keys(dev || {});
    const findAnyInterface = () => {
      for (const k of keys) {
        if (k.startsWith('interfaces_') || k.startsWith('subinterfaces_')) {
          const arr = (dev as any)[k];
          if (Array.isArray(arr) && arr.length) return arr[0];
        }
      }
      return undefined;
    };
    const anyIface = findAnyInterface();
    const ipv4RouteTop = Array.isArray((dev as any)?.ipv4_route) ? (dev as any).ipv4_route[0] : undefined;
    const ipv6RouteTop = Array.isArray((dev as any)?.ipv6_route) ? (dev as any).ipv6_route[0] : undefined;
    const wanDevCandidate = ipv4RouteTop?.dev || anyIface?.name;
    const wanDevStr = wanDevCandidate ? String(wanDevCandidate) : '';
    const wanIfCfg = wanDevStr ? findInterfaceInDevice(dev, wanDevStr) : null;
    const v4Wan = String(wanIfCfg?.ipv4_static || '').trim();
    const v6Wan = String(wanIfCfg?.ipv6_static || '').trim();
    const bgpTop = Array.isArray((dev as any)?.bgp) ? (dev as any).bgp[0] : undefined;
    const fam = Array.isArray(bgpTop?.address_family) ? bgpTop.address_family : [];
    const af4 = fam.find((f: any) => f?.address_family === 'ipv4');
    const af6 = fam.find((f: any) => f?.address_family === 'ipv6');
    const nets4 = Array.isArray(af4?.network) ? af4.network.join(', ') : undefined;
    const nets6 = Array.isArray(af6?.network) ? af6.network.join(', ') : undefined;

    // 从 vr2 顶层 ipv4_route/ipv6_route、BGP 等推断 WAN 默认值
    const inferredTop = {
      locatorName: (dev as any)?.segment_routing_srv6?.locator,
      sidPrefix: (dev as any)?.segment_routing_srv6?.prefix,
      wanDev: wanDevCandidate,
      wanIpv4: v4Wan || undefined,
      wanIpv6: v6Wan || undefined,
      wanRouteDest: ipv4RouteTop?.destination || undefined,
      wanRoutePriority:
        ipv4RouteTop?.priority !== undefined && ipv4RouteTop?.priority !== null
          ? Number(ipv4RouteTop.priority)
          : undefined,
      ipv6Dest: ipv6DestFromRoute(ipv6RouteTop),
      ipv6Via: ipv6RouteTop?.via || undefined,
      bgpAsn: bgpTop?.asn,
      bgpRouterId: bgpTop?.router_id,
      bgpNetworkIpv4: nets4,
      bgpNetworkIpv6: nets6,
    };

    const ifaceItems: Array<{ name?: string; ipv4_static?: string; ipv6_static?: string; vrf?: any }> = [];
    const staticIpOnRoleIface = (ifName?: string) => {
      const n = String(ifName || '').trim();
      if (!n) return { ipv4: undefined as string | undefined, ipv6: undefined as string | undefined };
      const o = findInterfaceInDevice(dev, n);
      if (!o) return { ipv4: undefined, ipv6: undefined };
      const ipv4 = String(o.ipv4_static || '').trim() || undefined;
      const ipv6 = String(o.ipv6_static || '').trim() || undefined;
      return { ipv4, ipv6 };
    };
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
    // 汇总 interfaces[] 与各 interfaces_XXX / subinterfaces_XXX 桶
    collectFromArr(Array.isArray((dev as any).interfaces) ? (dev as any).interfaces : undefined);
    Object.keys(dev || {}).forEach((k) => {
      if (k.startsWith('interfaces_') || k.startsWith('subinterfaces_')) {
        collectFromArr((dev as any)[k]);
      }
    });
    const topBgpArr: any[] = Array.isArray((dev as any)?.bgp) ? (dev as any).bgp : [];
    const bgpByVrf = new Map<
      any,
      { asn?: number; routerId?: string; routeDistinguisher?: string; routeTarget?: string }
    >();
    topBgpArr.forEach((b) => {
      if (b && typeof b === 'object' && 'vrf' in b && b.vrf != null) {
        bgpByVrf.set(b.vrf, {
          asn: b.asn,
          routerId: b.router_id,
          ...extractRdRtFromBgpEntry(b),
        });
      }
    });
    const vrfCandidates = new Set<any>();
    ifaceItems.forEach((it) => { if (it.vrf != null) vrfCandidates.add(it.vrf); });
    topBgpArr.forEach((b) => { if (b?.vrf != null) vrfCandidates.add(b.vrf); });
    const groups: any[] = [];
    if (vrfCandidates.size > 0) {
      Array.from(vrfCandidates).forEach((vrfVal) => {
        const ifaceMatch = ifaceItems.find((it) => it.vrf === vrfVal);
        const bgpMatch = bgpByVrf.get(vrfVal);
        const ifn = ifaceMatch?.name;
        const ipRole = staticIpOnRoleIface(ifn);
        groups.push({
          vrf: vrfVal,
          ifName: ifn,
          ipv4: ipRole.ipv4,
          ipv6: ipRole.ipv6,
          asn: bgpMatch?.asn,
          routerId: bgpMatch?.routerId,
          routeDistinguisher: bgpMatch?.routeDistinguisher,
          routeTarget: bgpMatch?.routeTarget,
        });
      });
    } else if (ifaceItems.length) {
      const first = ifaceItems[0];
      const ifn = first?.name;
      const ipRole = staticIpOnRoleIface(ifn);
      const topRdRt = extractRdRtFromBgpEntry(bgpTop);
      groups.push({
        vrf: first?.vrf,
        ifName: ifn,
        ipv4: ipRole.ipv4,
        ipv6: ipRole.ipv6,
        asn: bgpTop?.asn,
        routerId: bgpTop?.router_id,
        ...topRdRt,
      });
    }

    // LAN 分组为空时仍保留 [{}]，避免 Form.List 无行；与 vr2 推断一致
    const lanConfigsForForm = groups.length > 0 ? groups : [{}];

    const fullInferredForForm = {
      ...inferredTop,
      lanConfigs: lanConfigsForForm,
      ...(isHubPe
        ? {
            hubWanInventory: buildHubWanMirrorRowsFromDevice(ifaceItems, {
              ipv4_route: (dev as any)?.ipv4_route,
              ipv6_route: (dev as any)?.ipv6_route,
            }),
          }
        : {}),
    };
    const rolePe =
      existingCfg?.pe && Object.keys(existingCfg.pe).length
        ? existingCfg.pe
        : dev?.pe && typeof dev.pe === 'object' && Object.keys(dev.pe).length
          ? dev.pe
          : null;
    mirrorForm.resetFields();
    if (rolePe) {
      const spokeMirror = buildSpokeRoleMirror(dev, rolePe, findInterfaceInDevice);
      if (isHubPe) {
        const pcfg = getPePublicConfig(rolePe);
        const inv = parseHubInventoryFromConfig(existingCfg) || parseHubInventoryFromConfig(dev);
        const routes4 = Array.isArray((dev as any)?.ipv4_route) ? (dev as any).ipv4_route : [];
        const routes6 = Array.isArray((dev as any)?.ipv6_route) ? (dev as any).ipv6_route : [];
        const wanItems = (inv?.wan || []).filter((w) => w.source === 'role_wizard');
        const usingInventory = wanItems.length > 0;
        const hubWanFromRole = usingInventory
          ? wanItems
          : spokeMirror.wanDev
            ? [{
                ifName: String(spokeMirror.wanDev),
                ipv4: pcfg.wanIpv4,
                ipv6: pcfg.wanIpv6,
                ipv4RouteDest: pcfg.wanRouteDest,
                ipv4RoutePriority: pcfg.wanRoutePriority,
                ipv6Dest: pcfg.ipv6Dest,
                ipv6Via: pcfg.ipv6Via,
              }]
            : [];
        spokeMirror.hubWanInventory = hubWanFromRole.map((w) => {
          const ifName = roleText(w.ifName);
          const iface = findInterfaceInDevice(dev, ifName);
          const v4 = pickIpv4RouteForWan(routes4, ifName, w.ipv4RouteDest, w.ipv4RoutePriority);
          const v6 = pickIpv6RouteForRole(routes6, w.ipv6Dest, w.ipv6Via, hubWanFromRole.length === 1);
          return {
            ifName,
            ipv4: deviceStaticIfRoleSet(iface, 'ipv4_static', w.ipv4),
            ipv6: deviceStaticIfRoleSet(iface, 'ipv6_static', w.ipv6),
            ipv4RouteDest: v4?.destination || undefined,
            ipv4RoutePriority:
              v4?.priority !== undefined && v4?.priority !== null ? Number(v4.priority) : undefined,
            ipv6Dest: ipv6DestFromRoute(v6),
            ipv6Via: v6?.via || undefined,
          };
        });
        const lanItems = (inv?.lan || []).filter((l) => l.source === 'role_wizard');
        if (lanItems.length) {
          const bgpArr = Array.isArray((dev as any)?.bgp) ? (dev as any).bgp : [];
          spokeMirror.lanConfigs = lanItems.map((l) => {
            const iface = findInterfaceInDevice(dev, l.ifName);
            const bgp = bgpArr.find((b: any) => String(b?.vrf) === String(l.vrf));
            const rdRt = bgp ? extractRdRtFromBgpEntry(bgp) : {};
            return {
              vrf: l.vrf,
              ifName: l.ifName,
              ipv4: deviceStaticIfRoleSet(iface, 'ipv4_static', l.ipv4),
              ipv6: deviceStaticIfRoleSet(iface, 'ipv6_static', l.ipv6),
              asn: l.privateAsn != null ? bgp?.asn : undefined,
              routerId: roleText(l.routerId) ? bgp?.router_id : undefined,
              routeDistinguisher: roleText(l.routeDistinguisher) ? rdRt.routeDistinguisher : undefined,
              routeTarget: roleText(l.routeTarget) ? rdRt.routeTarget : undefined,
            };
          });
        }
      }
      mirrorForm.setFieldsValue(spokeMirror);
    }

    if (skipEditFormOnNextDeviceReadRef.current) {
      skipEditFormOnNextDeviceReadRef.current = false;
      return;
    }

    if (existingCfg && existingCfg.pe && Object.keys(existingCfg.pe).length > 0) {
      const pe = existingCfg.pe;
      const pcfg = getPePublicConfig(pe);
      let lanConfigs = readLanListFromPe(pe).map((x: any) => normalizeLanRowFromPeMeta(x));
      if (!lanConfigs.length) {
        lanConfigs = [{}];
      }
      const pbg = readPublicBgpMetaFromPe(pe);
      const { publicConfig: _pc, lanConfig: _lnc, LanConfig: _LncLegacy, lanConfigs: _lc, publicBgp: _pb, ...peRest } = pe;
      const wanDevMapped = pcfg.wanName || pcfg.wanDev || peRest.wanDev;
      const wanIpv4Mapped = String(pcfg.wanIpv4 || '').trim() || undefined;
      const wanIpv6Mapped = filterLinkLocalIpv6(pcfg.wanIpv6) || undefined;
      const lanConfigsVr3 = (lanConfigs || []).map((row: any) => ({
        ...row,
        ipv4: String(row?.ipv4 || '').trim() || undefined,
        ipv6: String(row?.ipv6 || '').trim() || undefined,
      }));
      const mapped = {
        ...peRest,
        locatorName: pcfg.locatorName ?? peRest.locatorName,
        sidPrefix: pcfg.sidPrefix ?? peRest.sidPrefix,
        wanDev: wanDevMapped,
        wanIpv4: wanIpv4Mapped,
        wanIpv6: wanIpv6Mapped,
        wanRouteDest: pcfg.wanRouteDest ?? peRest.wanRouteDest,
        wanRoutePriority: pcfg.wanRoutePriority ?? peRest.wanRoutePriority,
        ipv6Dest: pcfg.ipv6Dest ?? peRest.ipv6Dest,
        ipv6Via: pcfg.ipv6Via ?? peRest.ipv6Via,
        bgpNetworkIpv4: pcfg.bgpNetworkIpv4,
        bgpNetworkIpv6: pcfg.bgpNetworkIpv6,
        lanConfigs: lanConfigsVr3,
        bgpAsn: pbg.asn,
        bgpRouterId: pbg.routerId || undefined,
        ...(isHubPe
          ? (() => {
              const hubForm = hubInventoryToPeWizardForm(existingCfg, {
                wanDev: wanDevMapped,
                wanIpv4: wanIpv4Mapped,
                wanIpv6: wanIpv6Mapped,
                lanConfigs: lanConfigsVr3,
              });
              return {
                hubWanInventory: hubForm.hubWanInventory?.length ? hubForm.hubWanInventory : [{}],
                lanConfigs: hubForm.lanConfigs,
              };
            })()
          : {}),
      };
      form.setFieldsValue(mapped);
    } else {
      form.setFieldsValue(fullInferredForForm);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [csmctlCfg, existingCfg, vr3Info, mirrorForm, form]);

  const watchedWanDev = Form.useWatch('wanDev', form);
  useEffect(() => {
    const wan = watchedWanDev ? String(watchedWanDev) : '';
    const prev = prevWanDevRef.current;
    if (!wan) {
      prevWanDevRef.current = undefined;
      return;
    }
    prevWanDevRef.current = wan;
    // 向导打开或 VR3 晚到时不覆盖已保存的角色地址。只有用户把公网口改成另一块网卡，才用该口当前地址预填。
    if (prev !== undefined && prev !== wan) {
      autoFillWanFromIface(wan, { force: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [watchedWanDev]);

  const buildConfigFromValues = (v: any): Record<string, unknown> => {
    const cfg: Record<string, unknown> = {};
    const ipv4CidrPattern = /^(?:(?:[0-9]|[1-9][0-9]|1[0-9]{2}|2[0-4][0-9]|25[0-5])\.){3}(?:[0-9]|[1-9][0-9]|1[0-9]{2}|2[0-4][0-9]|25[0-5])\/([0-9]|[1-2]\d|3[0-2])$/;
    // IPv6 CIDR 校验正则
    // 示例：2408:3333:1002::/64、::1/128、::/0
    const ipv6CidrPattern = /^[0-9a-fA-F:]+\/([0-9]|[1-9]\d|1[01]\d|12[0-8])$/;
    const normalizeIPv4Cidr = (s: any) => {
      const t = String(s || '').trim();
      return ipv4CidrPattern.test(t) ? t : undefined;
    };
    const normalizeIPv6Cidr = (s: any) => {
      const t = String(s || '').trim();
      if (!t) return undefined;
      // 含点号视为非 IPv6（排除误填 IPv4）
      if (t.includes('.')) return undefined;
      // ::/0 等须符合 CIDR 正则
      return ipv6CidrPattern.test(t) ? t : undefined;
    };
    const sid = String(v?.sidPrefix || '').trim();
    if (sid || v?.locatorName) {
      cfg.segment_routing_srv6 = { locator: v?.locatorName, prefix: sid || undefined };
    }
    const ifaceObjs: any[] = [];
    const wanRows: WanRouteFormRow[] =
      isHubPe && Array.isArray(v?.hubWanInventory)
        ? v.hubWanInventory
        : v?.wanDev
          ? [{ ifName: v.wanDev, ipv4: v.wanIpv4, ipv6: v.wanIpv6 }]
          : [];
    wanRows.forEach((row) => {
      const ifName = String(row?.ifName || '').trim();
      if (!ifName) return;
      const item: any = { name: ifName, status: 'up' };
      const ipv4Wan = normalizeIPv4Cidr(row.ipv4);
      if (ipv4Wan) item.ipv4_static = ipv4Wan;
      const wan6 = normalizeIPv6Cidr(filterLinkLocalIpv6(row?.ipv6) || row?.ipv6);
      if (wan6) item.ipv6_static = wan6;
      ifaceObjs.push(item);
    });
    const primaryWanDev = String(wanRows[0]?.ifName || v?.wanDev || '').trim();
    const groups: any[] = Array.isArray(v?.lanConfigs) ? v.lanConfigs : [];
    const vrfSet = new Set<number>();
    groups.forEach((g) => {
      const item: any = { name: String(g?.ifName || '').trim(), status: 'up' };
      if (!item.name) return;
      if (g?.vrf) {
        item.vrf = g.vrf;
        vrfSet.add(Number(g.vrf));
      }
      const ipv4Lan = normalizeIPv4Cidr(g?.ipv4);
      if (ipv4Lan) item.ipv4_static = ipv4Lan;
      if (g?.ipv6) {
        const lan6 = normalizeIPv6Cidr(filterLinkLocalIpv6(g.ipv6) || g.ipv6);
        if (lan6) item.ipv6_static = lan6;
      }
      ifaceObjs.push(item);
    });
    if (ifaceObjs.length) {
      const mergedMap = new Map<string, any>();
      ifaceObjs.forEach((obj) => {
        const name = obj.name;
        if (mergedMap.has(name)) {
          mergedMap.set(name, { ...mergedMap.get(name), ...obj });
        } else {
          mergedMap.set(name, obj);
        }
      });
      const mergedIfaces = Array.from(mergedMap.values());

      const buckets: Record<string, any[]> = {
        interfaces_GigabitEthernet: [],
        subinterfaces_GigabitEthernet: [],
        interfaces_lo: [],
        interfaces_Tunnel: [],
        subinterfaces_Tunnel: [],
      };
      mergedIfaces.forEach((item) => {
        const name: string = String(item?.name || '');
        const typePart = name.split(' ')[0];
        const isSub = name.includes('.');
        const push = (key: string) => { (buckets[key] || (buckets[key] = [])).push(item); };
        switch (typePart) {
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
      });
      Object.keys(buckets).forEach((k) => { if ((buckets as any)[k]?.length) (cfg as any)[k] = (buckets as any)[k]; });
    }
    if (isHubPe && wanRows.length) {
      const { ipv4_route, ipv6_route } = buildWanStaticRoutesFromRows(wanRows);
      if (ipv4_route.length) cfg.ipv4_route = ipv4_route;
      if (ipv6_route.length) cfg.ipv6_route = ipv6_route;
    } else if (primaryWanDev) {
      const dest = normalizeIPv4Cidr(v?.wanRouteDest);
      if (dest) {
        const prio = Number(v?.wanRoutePriority ?? 100);
        cfg.ipv4_route = [
          {
            destination: dest,
            dev: primaryWanDev,
            priority: Number.isFinite(prio) && prio >= 1 ? Math.trunc(prio) : 100,
          },
        ];
      }
      const v6dest = String(v?.ipv6Dest || '').trim();
      const v6via = String(v?.ipv6Via || '').trim();
      const dest6 = normalizeIPv6Cidr(v6dest);
      if (dest6) {
        const route6: any = { destination: dest6 };
        if (v6via) route6.via = v6via;
        cfg.ipv6_route = [route6];
      }
    }
    if (vrfSet.size > 0) {
      cfg.vrf = Array.from(vrfSet);
    }
    if (groups.length) {
      const bgpArr: any[] = [];
      // 1. 保留设备回读中的 Global BGP（vrf 0 或空）
      if (csmctlCfg?.bgp && Array.isArray(csmctlCfg.bgp)) {
        const globalBgp = csmctlCfg.bgp.find((b: any) => !b.vrf || b.vrf === 0 || b.vrf === '0');
        if (globalBgp) {
          bgpArr.push(globalBgp);
        }
      }
      const hasPublic = bgpArr.some((b: any) => !b?.vrf || b?.vrf === 0 || b?.vrf === '0');
      if (!hasPublic) {
        bgpArr.unshift({
          bgp_ebgp_requires_policy: 'disable',
          address_family: [],
        });
      }
      // 2. 按 LAN 行追加 VRF BGP 段
      groups.forEach((g) => {
        if (g?.asn || g?.routerId || g?.routeDistinguisher || g?.routeTarget) {
          const vrfNum = g?.vrf != null && String(g.vrf).trim() !== '' ? Number(g.vrf) : undefined;
          const enableAutoSid = Number.isFinite(vrfNum as any) && (vrfNum as number) >= 4001;
          const asnRaw = Number(g?.asn);
          const asn = Number.isFinite(asnRaw) ? asnRaw : undefined;
          const rd = String(g?.routeDistinguisher || '').trim();
          const rt = String(g?.routeTarget || '').trim();
          bgpArr.push({
            ...(asn != null ? { asn } : {}),
            ...(enableAutoSid ? { vrf: vrfNum } : {}), // VRF>=4001 时带 vrf，并开启 auto_assign_sid
            router_id: g?.routerId,
            bgp_ebgp_requires_policy: 'disable',
            address_family: [
              {
                address_family: 'ipv4',
                modifiler: 'unicast',
                export_route: 'enable',
                import_route: 'enable',
                // enableAutoSid 时在 address_family 打开 auto_assign_sid
                ...(enableAutoSid ? { auto_assign_sid: 'enable' } : { auto_assign_sid: 'disable' }),
                ...(rd ? { route_distinguisher: rd } : {}),
                ...(rt ? { route_target: rt } : {}),
              },
            ],
          });
        }
      });
      if (bgpArr.length) {
        // 公网 BGP 补齐 segment_routing_srv6 locator 与表单 ASN / router_id
        const loc = String(v?.locatorName || '').trim();
        const pubIdx = bgpArr.findIndex((b: any) => !b?.vrf || b?.vrf === 0 || b?.vrf === '0');
        if (pubIdx >= 0) {
          const cur = bgpArr[pubIdx] && typeof bgpArr[pubIdx] === 'object' ? bgpArr[pubIdx] : {};
          const next: any = { ...cur };
          if (loc) next.segment_routing_srv6 = { locator: loc };
          const asnPub = Number(v?.bgpAsn);
          if (Number.isFinite(asnPub)) next.asn = asnPub;
          const rid = String(v?.bgpRouterId || '').trim();
          if (rid) next.router_id = rid;
          bgpArr[pubIdx] = next;
        }
        cfg.bgp = bgpArr;
      }
    }
    
    // Metadata for PE Wizard
    cfg.role = peRoleTarget;
    cfg.pe = {
      publicConfig: {
        publicBgpIndex: 0,
        locatorName: v.locatorName,
        sidPrefix: v.sidPrefix,
        wanName: primaryWanDev || v.wanDev,
        wanIpv4: wanRows[0]?.ipv4 ?? v.wanIpv4,
        wanIpv6: filterLinkLocalIpv6(wanRows[0]?.ipv6) || filterLinkLocalIpv6(v.wanIpv6) || undefined,
        wanRouteDest: isHubPe ? wanRows[0]?.ipv4RouteDest : v.wanRouteDest,
        wanRoutePriority: isHubPe ? wanRows[0]?.ipv4RoutePriority : v.wanRoutePriority,
        ipv6Dest: isHubPe ? wanRows[0]?.ipv6Dest : v.ipv6Dest,
        ipv6Via: isHubPe ? wanRows[0]?.ipv6Via : v.ipv6Via,
        publicBgp: {
          asn: v.bgpAsn,
          routerId: v.bgpRouterId,
        },
      },
      lanConfig: (v.lanConfigs || []).map((l: any) => {
        const { ifName, asn, routerId, routeDistinguisher, routeTarget, ...rest } = l;
        const asnN = Number(asn);
        const rid = String(routerId || '').trim();
        const rd = String(routeDistinguisher || '').trim();
        const rt = String(routeTarget || '').trim();
        const row: any = {
          ...rest,
          lanName: ifName,
        };
        if (Number.isFinite(asnN) || rid || rd || rt) {
          row.lanBgp = {
            ...(Number.isFinite(asnN) ? { asn: asnN } : {}),
            ...(rid ? { routerId: rid } : {}),
            ...(rd ? { routeDistinguisher: rd } : {}),
            ...(rt ? { routeTarget: rt } : {}),
          };
        }
        return row;
      }),
    };

    if (isHubPe) {
      const inventory = buildHubInventoryFromPeWizardValues(v, existingHubInventory);
      attachHubInventoryToConfig(cfg, inventory);
    }

    return sortVrConfigJsonKeys(cfg, 'pe');
  };

  const watchedValues = Form.useWatch([], form);
  const configPreview = useMemo(
    () => buildConfigFromValues(watchedValues || form.getFieldsValue(true) || {}),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- buildConfigFromValues 闭包依赖 form/isHubPe/inventory
    [watchedValues, isHubPe, existingHubInventory],
  );

  const ensureUniqueHubIfNames = (): boolean => {
    if (!isHubPe) return true;
    const values = form.getFieldsValue(true);
    const err = assertUniqueHubInventoryIfNames(values.hubWanInventory, values.lanConfigs);
    if (err) {
      message.error(err);
      return false;
    }
    return true;
  };

  const focusPeWizardValidationError = (err: unknown) => {
    warnFormValidationFailure(err);
    const e = err as { errorFields?: { name: (string | number)[]; errors: string[] }[] };
    const name = e?.errorFields?.[0]?.name;
    if (!Array.isArray(name)) return;
    if (name[0] === 'hubWanInventory' && typeof name[1] === 'number') {
      setActiveWanTabKey(String(name[1]));
    }
    if (name[0] === 'lanConfigs' && typeof name[1] === 'number') {
      setActiveLanTabKey(String(name[1]));
    }
  };

  const validatePeWizardStepsThrough = async (fromStep: number, toStep: number): Promise<boolean> => {
    for (let s = fromStep; s < toStep; s++) {
      const fields = buildPeWizardStepFieldNames(s, isHubPe, form.getFieldsValue(true));
      if (fields.length > 0) {
        await form.validateFields(fields);
      }
      if (s === 0 && !ensureUniqueHubIfNames()) {
        return false;
      }
    }
    return true;
  };

  const next = async () => {
    try {
      const ok = await validatePeWizardStepsThrough(current, current + 1);
      if (!ok) return;
      setCurrent((c) => Math.min(2, c + 1));
    } catch (err) {
      focusPeWizardValidationError(err);
    }
  };
  const prev = () => setCurrent((c) => Math.max(0, c - 1));

  /** 步骤切换：须通过当前步表单校验 */
  const handleStepsChange = async (idx: number) => {
    if (idx === current) return;
    if (idx < current) {
      setCurrent(idx);
      return;
    }
    try {
      const ok = await validatePeWizardStepsThrough(current, idx);
      if (!ok) return;
      setCurrent(idx);
    } catch (err) {
      focusPeWizardValidationError(err);
    }
  };

  const handleDispatch = async () => {
    if (!uuid) {
      message.error('缺少 IBR 实例 UUID，无法继续');
      return;
    }
    try {
      const refs = await fetchSrv6VrReferences(uuid);
      if (refs?.count && refs.count > 0) {
        const names = Array.from(new Set((refs.refs || []).map((r) => r.tunnelName).filter(Boolean)));
        const namesPart = names.length ? `引用隧道：${names.join('、')}` : '当前 IBR 已被 SRv6 隧道引用';
        message.error(
          `为规避 SRv6 注入路由被向导全量覆盖的风险，当前阶段不允许在角色配置向导中保存/下发该 VR 配置。${namesPart}`,
          8,
        );
        return;
      }
    } catch (e: any) {
      // refs 接口失败时不阻塞原有流程，但要让用户感知
      console.warn('PEWizard: fetchSrv6VrReferences failed:', e);
    }
    try {
      await form.validateFields();
    } catch {
      message.warning('请先完善表单必填项');
      return;
    }
    if (!ensureUniqueHubIfNames()) return;
    try {
      setLoading(true);
      const values = form.getFieldsValue(true);
      const cfg = buildConfigFromValues(values);
      if (uuid) cfg.uuid = uuid;
      
      // 1. 先保存到平台（saveVRConfig + setVRRole），失败则中止设备下发
      try {
        await saveVRConfig(uuid, cfg);
        await setVRRole(uuid, peRoleTarget);
      } catch (e: any) {
        console.warn('PEWizard handleDispatch: saveVRConfig/setVRRole failed:', e);
        throw new Error(e?.message || '保存到平台失败，已中止设备下发');
      }

      const deviceCfg = isHubPe ? stripTowerExtensionsFromDeviceConfig(cfg) : cfg;
      const method = 'POST';
      const other = `uuid=${uuid}`;
      const path = '/V2/ctcontrol/VR2/VRConfig';
      const data = await proxyApiRequest(path, method, other, deviceCfg);
      if (data && typeof data.code === 'number' && data.code !== 200) {
        throw new Error(data?.msg || `下发失败: ${JSON.stringify(data)}`);
      }
      message.success('配置已下发');
    } catch (e: any) {
      message.error(e?.message || '下发失败');
    } finally {
      setLoading(false);
    }
  };

  /** 预览占位：空值显示为 - */
  const previewStr = (v: any) =>
    v !== undefined && v !== null && String(v).trim() !== '' ? String(v) : '-';
  const previewNum = (v: any) => {
    if (v === undefined || v === null || v === '') return '-';
    const n = Number(v);
    return Number.isFinite(n) ? n : '-';
  };

  const renderCoreContent = () => {
    // values for preview (step 3)
    const values = form.getFieldsValue(true);

    return (
      <Form form={form} layout="vertical">
        {/* Step 1 Content */}
        <div style={{ display: current === 0 ? 'block' : 'none' }}>
          <div style={{ color: '#1677ff', margin: '4px 0 12px 0', borderBottom: '1px solid #e8e8e8', paddingBottom: 6 }}>SRv6 配置</div>
          <Form.Item name="locatorName" label="SRv6 Locator 名称"> 
            <Input placeholder="例如 default" />
          </Form.Item>
          <Form.Item
            name="sidPrefix"
            label="SRv6 SID 前缀（可带 /掩码）"
            extra={srv6SidPrefixPhase1Extra()}
            rules={[
              {
                validator: (_, value) => {
                  const r = validateSrv6SidPrefixPhase1(value);
                  return r.ok ? Promise.resolve() : Promise.reject(new Error(r.message));
                },
              },
            ]}
          >
            <Input placeholder="例如 2400:1234::1 或 2400:1234::/48" />
          </Form.Item>
          {isHubPe ? (
            <>
              <div style={{ color: '#1677ff', margin: '4px 0 12px 0', borderBottom: '1px solid #e8e8e8', paddingBottom: 6 }}>
                Hub 公网 BGP（进程级 · bgp[0]）
              </div>
              <Form.Item name="bgpAsn" label="ASN" rules={[{ required: true, message: '请输入 BGP ASN' }]}>
                <InputNumber style={{ width: '100%' }} min={1} placeholder="例如 100" />
              </Form.Item>
              <Form.Item name="bgpRouterId" label="Router-ID" rules={[{ required: true, message: '请输入 BGP Router-ID' }]}>
                <Input placeholder="例如 200.1.1.2" />
              </Form.Item>
              <Divider style={{ margin: '16px 0' }} />
            </>
          ) : null}
          {isHubPe ? (
            <>
            <div style={{ color: '#1677ff', margin: '4px 0 12px 0', borderBottom: '1px solid #e8e8e8', paddingBottom: 6 }}>
              WAN侧配置（Hub-PE to Spoke-PE）
            </div>
            <Form.List name="hubWanInventory" initialValue={[{}]}>
              {(fields, { add, remove }) => {
                const onWanTabEdit = (
                  targetKey: string | React.MouseEvent | React.KeyboardEvent,
                  action: 'add' | 'remove',
                ) => {
                  const plan = planInventoryTabEdit(
                    action,
                    String(targetKey),
                    fields.length,
                    activeWanTabKey ?? '0',
                  );
                  if (!plan) return;
                  if (plan.action === 'add') {
                    add({});
                    setActiveWanTabKey(plan.nextActiveKey);
                    return;
                  }
                  remove(plan.removeIndex);
                  setActiveWanTabKey(plan.nextActiveKey);
                };
                const items = fields.map((field, idx) => ({
                  key: String(field.name),
                  label: `WAN 接口 #${idx + 1}`,
                  children: (
                    <div>
                      <Form.Item {...field} name={[field.name, 'id']} hidden>
                        <Input />
                      </Form.Item>
                      <Form.Item
                        {...field}
                        name={[field.name, 'ifName']}
                        label="WAN 侧接口"
                        rules={[{ required: true, message: '请选择 WAN 侧接口' }]}
                      >
                        <Select
                          placeholder="请选择接口"
                          showSearch
                          loading={ifaceLoading}
                          options={peIfaceSelectOptions(idx, 'hubWan')}
                          filterOption={(input: string, option?: { value?: string }) =>
                            String(option?.value || '')
                              .toLowerCase()
                              .includes(input.toLowerCase())
                          }
                          onChange={(val) => autoFillHubWanRow(idx, String(val || ''), { force: true })}
                        />
                      </Form.Item>
                      <Form.Item
                        {...field}
                        name={[field.name, 'ipv4']}
                        label="WAN 侧 IPv4 地址/掩码"
                      >
                        <Input placeholder="例如 200.1.1.2/24" />
                      </Form.Item>
                      <Form.Item
                        {...field}
                        name={[field.name, 'ipv6']}
                        label="WAN 侧 IPv6 地址/掩码"
                        rules={[
                          { required: true, message: '请输入 WAN 侧 IPv6 地址/掩码' },
                          {
                            pattern: /^[0-9a-fA-F:]+\/([0-9]|[1-9]\d|1[01]\d|12[0-8])$/,
                            message: '格式示例：2408:3333:1002::1/64',
                          },
                        ]}
                      >
                        <Input placeholder="例如 2408:3333:1002::1/64" />
                      </Form.Item>
                      <div style={{ height: 8 }} />
                      <div style={{ color: '#1677ff', margin: '4px 0 12px 0', borderBottom: '1px solid #e8e8e8', paddingBottom: 6 }}>
                        静态路由（本 WAN 口）
                      </div>
                      <Form.Item
                        {...field}
                        name={[field.name, 'ipv4RouteDest']}
                        label="IPv4 目的网段"
                        extra="填写后按本 WAN 口下发 `ip route … dev …`（无 via）"
                      >
                        <Input placeholder="例如 0.0.0.0/0" />
                      </Form.Item>
                      <Form.Item
                        {...field}
                        name={[field.name, 'ipv4RoutePriority']}
                        label="IPv4 优先级"
                        initialValue={100}
                        extra="缺省 100，可改；对应设备 priority"
                      >
                        <InputNumber min={1} max={65535} style={{ width: '100%' }} placeholder="100" />
                      </Form.Item>
                      <Form.Item
                        {...field}
                        name={[field.name, 'ipv6Dest']}
                        label="IPv6 目的网段"
                        dependencies={[['hubWanInventory', field.name, 'ipv6Via']]}
                        rules={[
                          {
                            validator: async (_, value) => {
                              const dest = String(value ?? '').trim();
                              const via = String(
                                form.getFieldValue(['hubWanInventory', field.name, 'ipv6Via']) ?? '',
                              ).trim();
                              if ((dest && !via) || (!dest && via)) {
                                throw new Error('IPv6 目的网段与 IPv6 网关需同时填写或同时留空');
                              }
                            },
                          },
                          {
                            pattern: /^[0-9a-fA-F:]+\/([0-9]|[1-9]\d|1[01]\d|12[0-8])$/,
                            message: '格式示例：::/0 或 2408:3333:1002::/64',
                          },
                        ]}
                      >
                        <Input placeholder="例如 ::/0" />
                      </Form.Item>
                      <Form.Item
                        {...field}
                        name={[field.name, 'ipv6Via']}
                        label="IPv6 网关"
                        dependencies={[['hubWanInventory', field.name, 'ipv6Dest']]}
                        rules={[
                          {
                            validator: async (_, value) => {
                              const via = String(value ?? '').trim();
                              const dest = String(
                                form.getFieldValue(['hubWanInventory', field.name, 'ipv6Dest']) ?? '',
                              ).trim();
                              if ((dest && !via) || (!dest && via)) {
                                throw new Error('IPv6 目的网段与 IPv6 网关需同时填写或同时留空');
                              }
                            },
                          },
                          { pattern: /^[0-9a-fA-F:]+$/, message: '请输入合法的 IPv6 网关地址（不带 /xx）' },
                        ]}
                      >
                        <Input placeholder="例如 203::33" />
                      </Form.Item>
                    </div>
                  ),
                }));
                return (
                  <Tabs
                    type="editable-card"
                    items={items}
                    tabBarGutter={8}
                    size="small"
                    activeKey={activeWanTabKey ?? (items.length ? String(0) : undefined)}
                    onChange={(key) => setActiveWanTabKey(String(key))}
                    onEdit={onWanTabEdit}
                  />
                );
              }}
            </Form.List>
            <Divider style={{ margin: '16px 0' }} />
            </>
          ) : (
            <>
          <div style={{ color: '#1677ff', margin: '4px 0 12px 0', borderBottom: '1px solid #e8e8e8', paddingBottom: 6 }}>
            WAN 侧配置（PE to PE）
          </div>
          <Form.Item name="wanDev" label="WAN 侧接口" rules={[{ required: true, message: '请选择 WAN 侧接口' }]}> 
            <Select
              placeholder="请选择接口"
              showSearch
              loading={ifaceLoading}
              options={peIfaceSelectOptions(0, 'wan')}
              filterOption={(input: string, option?: { value?: string }) =>
                String(option?.value || '')
                  .toLowerCase()
                  .includes(input.toLowerCase())
              }
              onChange={(val) =>
                autoFillWanFromIface(String(val || ''), { force: true })
              }
            />
          </Form.Item>
          <Form.Item name="wanIpv4" label="WAN 侧 IPv4 地址/掩码">
            <Input placeholder="例如 200.1.1.2/24" />
          </Form.Item>
          <Form.Item
            name="wanIpv6"
            label="WAN 侧 IPv6 地址/掩码"
            rules={[
              { required: true, message: '请输入 WAN 侧 IPv6 地址/掩码' },
              { pattern: /^[0-9a-fA-F:]+\/([0-9]|[1-9]\d|1[01]\d|12[0-8])$/, message: '格式示例：2408:3333:1002::1/64' },
            ]}
          >
            <Input placeholder="例如 2408:3333:1002::1/64" />
          </Form.Item>
            </>
          )}
          {!isHubPe ? (
            <>
          <div style={{ height: 12 }} />
          <div style={{ color: '#1677ff', margin: '4px 0 12px 0', borderBottom: '1px solid #e8e8e8', paddingBottom: 6 }}>BGP 配置（PE to PE）</div>
          <Form.Item name="bgpAsn" label="ASN" rules={[{ required: true, message: '请输入 BGP ASN' }]}>
            <InputNumber style={{ width: '100%' }} min={1} placeholder="例如 100" />
          </Form.Item>
          <Form.Item name="bgpRouterId" label="Router-ID" rules={[{ required: true, message: '请输入 BGP Router-ID' }]}>
            <Input placeholder="例如 200.1.1.2" />
          </Form.Item>
          <div style={{ height: 12 }} />
          <div style={{ color: '#1677ff', margin: '4px 0 12px 0', borderBottom: '1px solid #e8e8e8', paddingBottom: 6 }}>静态路由（WAN）</div>
          <Form.Item
            name="wanRouteDest"
            label="IPv4 目的网段"
            extra="填写后按 WAN 口下发 `ip route … dev …`（无 via）"
          >
            <Input placeholder="例如 0.0.0.0/0" />
          </Form.Item>
          <Form.Item
            name="wanRoutePriority"
            label="IPv4 优先级"
            initialValue={100}
            extra="缺省 100，可改；对应设备 priority"
          >
            <InputNumber min={1} max={65535} style={{ width: '100%' }} placeholder="100" />
          </Form.Item>
          <Form.Item
            name="ipv6Dest"
            label="IPv6 目的网段"
            dependencies={['ipv6Via']}
            rules={[
              {
                validator: async (_, value) => {
                  const dest = String(value ?? '').trim();
                  const via = String(form.getFieldValue('ipv6Via') ?? '').trim();
                  if ((dest && !via) || (!dest && via)) {
                    throw new Error('IPv6 目的网段与 IPv6 网关需同时填写或同时留空');
                  }
                },
              },
              { pattern: /^[0-9a-fA-F:]+\/([0-9]|[1-9]\d|1[01]\d|12[0-8])$/, message: '格式示例：2408:3333:1002::/64' },
            ]}
          >
            <Input placeholder="例如 2408:3333:1002::/64" />
          </Form.Item>
          <Form.Item
            name="ipv6Via"
            label="IPv6 网关"
            dependencies={['ipv6Dest']}
            rules={[
              {
                validator: async (_, value) => {
                  const via = String(value ?? '').trim();
                  const dest = String(form.getFieldValue('ipv6Dest') ?? '').trim();
                  if ((dest && !via) || (!dest && via)) {
                    throw new Error('IPv6 目的网段与 IPv6 网关需同时填写或同时留空');
                  }
                },
              },
              { pattern: /^[0-9a-fA-F:]+$/, message: '请输入合法的 IPv6 网关地址（不带 /xx）' },
            ]}
          >
            <Input placeholder="例如 203::44（可留空：表示不配置 IPv6 网关）" />
          </Form.Item>
            </>
          ) : null}
        </div>

        {/* Step 2 Content */}
        <div style={{ display: current === 1 ? 'block' : 'none' }}>
          <div style={{ color: '#1677ff', margin: '4px 0 12px 0', borderBottom: '1px solid #e8e8e8', paddingBottom: 6 }}>
            {isHubPe ? 'LAN 侧配置（Hub-PE to CE）' : 'LAN 侧配置（PE to CE）'}
          </div>
          <Form.List name="lanConfigs" initialValue={[{}]}>
            {(fields, { add, remove }) => {
              const onLanTabEdit = (
                targetKey: string | React.MouseEvent | React.KeyboardEvent,
                action: 'add' | 'remove',
              ) => {
                const plan = planInventoryTabEdit(
                  action,
                  String(targetKey),
                  fields.length,
                  activeLanTabKey ?? '0',
                );
                if (!plan) return;
                if (plan.action === 'add') {
                  add({});
                  setActiveLanTabKey(plan.nextActiveKey);
                  return;
                }
                remove(plan.removeIndex);
                setActiveLanTabKey(plan.nextActiveKey);
              };
              const items = fields.map((field, idx) => ({
                key: String(field.name),
                label: `LAN 接口 #${idx + 1}`,
                children: (
                  <div>
                    <Form.Item {...field} name={[field.name, 'id']} hidden>
                      <Input />
                    </Form.Item>
                    <Form.Item
                      {...field}
                      name={[field.name, 'vrf']}
                      label={<>VRF ID{isHubPe ? '' : '（可选）'}</>}
                      rules={
                        isHubPe
                          ? [
                              { required: true, message: 'Hub LAN inventory 须填写 VRF ID' },
                              { type: 'number', min: 4001, message: 'VRF ID 最小为 4001' },
                            ]
                          : [{ type: 'number', min: 4001, message: 'VRF ID 最小为 4001' }]
                      }
                    >
                      <InputNumber style={{ width: '100%' }} placeholder={"例如 9999（4001+）"} min={4001} />
                    </Form.Item>
                    <Form.Item {...field} name={[field.name, 'ifName']} label="LAN 侧接口">
                      <Select
                        placeholder="请选择接口"
                        showSearch
                        loading={ifaceLoading}
                        options={peIfaceSelectOptions(idx, 'lan')}
                        filterOption={(input: string, option?: { value?: string }) =>
                          String(option?.value || '')
                            .toLowerCase()
                            .includes(input.toLowerCase())
                        }
                        onChange={(val) => autoFillLanRow(idx, String(val || ''), { force: true })}
                      />
                    </Form.Item>
                    <Form.Item {...field} name={[field.name, 'ipv4']} label="IPv4 地址/掩码">
                      <Input placeholder="例如 130.1.1.1/24" />
                    </Form.Item>
                    <Form.Item {...field} name={[field.name, 'ipv6']} label="IPv6 地址/掩码">
                      <Input placeholder="例如 2408:3333:1002::1/64" />
                    </Form.Item>
                    <>
                      <div style={{ height: 12 }} />
                      <div style={{ color: '#1677ff', margin: '4px 0 12px 0', borderBottom: '1px solid #e8e8e8', paddingBottom: 6 }}>BGP 配置（LAN）</div>
                      <Form.Item
                        {...field}
                        name={[field.name, 'asn']}
                        label="BGP ASN"
                        rules={isHubPe ? [{ required: true, message: '请输入 BGP ASN' }] : undefined}
                      >
                        <InputNumber style={{ width: '100%' }} placeholder="例如 100" />
                      </Form.Item>
                      <Form.Item
                        {...field}
                        name={[field.name, 'routerId']}
                        label="BGP Router-ID"
                        rules={isHubPe ? [{ required: true, message: '请输入 BGP Router-ID' }] : undefined}
                      >
                        <Input placeholder="例如 130.1.1.1" />
                      </Form.Item>
                      <Form.Item
                        {...field}
                        name={[field.name, 'routeDistinguisher']}
                        label="Route Distinguisher（RD）"
                        rules={rdRtFieldRules('RD')}
                      >
                        <Input placeholder="例如 200:1001" />
                      </Form.Item>
                      <Form.Item
                        {...field}
                        name={[field.name, 'routeTarget']}
                        label="Route Target（RT）"
                        rules={rdRtFieldRules('RT')}
                      >
                        <Input placeholder="例如 200:100" />
                      </Form.Item>
                    </>
                  </div>
                ),
              }));
              if (!isHubPe) {
                const field = fields[0];
                if (!field) return null;
                return items[0]?.children ?? null;
              }
              return (
                <Tabs
                  type="editable-card"
                  items={items}
                  tabBarGutter={8}
                  size="small"
                  activeKey={activeLanTabKey ?? (items.length ? String(0) : undefined)}
                  onChange={(key) => {
                    setActiveLanTabKey(String(key));
                  }}
                  onEdit={onLanTabEdit}
                />
              );
            }}
          </Form.List>
        </div>

        {/* Step 3 Content */}
        <div style={{ display: current === 2 ? 'block' : 'none' }}>
          <Descriptions column={1} bordered size="small">
            <Descriptions.Item label="SRv6 Locator">{values.locatorName || '-'}</Descriptions.Item>
            <Descriptions.Item label="SRv6 SID Prefix">{values.sidPrefix || '-'}</Descriptions.Item>
            {isHubPe ? (
              (values.hubWanInventory || []).map((wan: any, idx: number) => (
                <Descriptions.Item key={`wan-${idx}`} label={`WAN 接口 #${idx + 1}`}>
                  {formatHubWanConfirmLine(wan)}
                </Descriptions.Item>
              ))
            ) : (
              <Descriptions.Item label="WAN 侧接口">{values.wanDev || '-'}</Descriptions.Item>
            )}
            {!isHubPe && (
              <>
            <Descriptions.Item label="WAN 侧 IPv4">{previewStr(values.wanIpv4)}</Descriptions.Item>
            <Descriptions.Item label="WAN 侧 IPv6">{previewStr(values.wanIpv6)}</Descriptions.Item>
              </>
            )}
            {isHubPe ? (
              <>
                <Descriptions.Item label="公网 BGP ASN">{previewNum(values.bgpAsn)}</Descriptions.Item>
                <Descriptions.Item label="公网 BGP Router-ID">{previewStr(values.bgpRouterId)}</Descriptions.Item>
              </>
            ) : (
              <>
                <Descriptions.Item label="BGP ASN（WAN）">{previewNum(values.bgpAsn)}</Descriptions.Item>
                <Descriptions.Item label="BGP Router-ID（WAN）">{previewStr(values.bgpRouterId)}</Descriptions.Item>
              </>
            )}
            {!isHubPe && (
              <>
                <Descriptions.Item label="IPv4 目的网段">{previewStr(values.wanRouteDest)}</Descriptions.Item>
                <Descriptions.Item label="IPv4 优先级">
                  {values.wanRoutePriority != null && values.wanRoutePriority !== ''
                    ? previewNum(values.wanRoutePriority)
                    : values.wanRouteDest
                      ? 100
                      : '-'}
                </Descriptions.Item>
                <Descriptions.Item label="IPv6 目的网段">{previewStr(values.ipv6Dest)}</Descriptions.Item>
                <Descriptions.Item label="IPv6 网关">{previewStr(values.ipv6Via)}</Descriptions.Item>
              </>
            )}
          </Descriptions>
          {(values.lanConfigs || []).map((lan: any, idx: number) => (
            <div key={idx} style={{ marginTop: 12 }}>
              <div style={{ color: '#1677ff', margin: '4px 0 8px 0', borderBottom: '1px solid #e8e8e8', paddingBottom: 6 }}>LAN 接口 #{idx + 1}</div>
              <Descriptions column={1} bordered size="small">
                <Descriptions.Item label="VRF ID">{lan.vrf || '-'}</Descriptions.Item>
                <Descriptions.Item label="LAN 侧接口">{lan.ifName || '-'}</Descriptions.Item>
                <Descriptions.Item label="IPv4">{lan.ipv4 || '-'}</Descriptions.Item>
                <Descriptions.Item label="IPv6">{lan.ipv6 || '-'}</Descriptions.Item>
                <Descriptions.Item label="BGP ASN">{lan.asn || '-'}</Descriptions.Item>
                <Descriptions.Item label="BGP Router-ID">{lan.routerId || '-'}</Descriptions.Item>
                <Descriptions.Item label="RD">{lan.routeDistinguisher || '-'}</Descriptions.Item>
                <Descriptions.Item label="RT">{lan.routeTarget || '-'}</Descriptions.Item>
              </Descriptions>
            </div>
          ))}
        </div>
      </Form>
    );
  };

  const wizardStepTitles = isHubPe
    ? ['基础配置（Hub-PE）', 'LAN 侧配置（Hub-PE to CE）', '确认下发']
    : ['基础配置（PE to PE）', 'LAN 侧配置（PE to CE）', '确认下发'];

  return (
    <IbrWizardPage
      meta={uuid || undefined}
      extra={<Button icon={<ReloadOutlined />} onClick={() => fetchInterfaces()}>刷新设备回读</Button>}
      layout="compare"
      steps={
          <Steps
            direction="vertical"
            size="small"
            current={current}
            onChange={handleStepsChange}
            items={wizardStepTitles.map((title) => ({ title }))}
          />
        }
        mirror={
          <IbrWizardCard title={ibrWizardStepCardTitle(current, wizardStepTitles[current], '设备回读')}>
            {ifaceLoading ? (
              <div style={{ textAlign: 'center', padding: '32px 0' }}>
                <Spin />
              </div>
            ) : hasRoleConfig && csmctlCfg ? (
              <Form layout="vertical" form={mirrorForm} disabled>
                {current === 0 && (
                  <>
                    <div style={{ color: '#1677ff', margin: '4px 0 12px 0', borderBottom: '1px solid #e8e8e8', paddingBottom: 6 }}>SRv6 配置</div>
                    <Form.Item name="locatorName" label="SRv6 Locator 名称"> 
                      <Input placeholder="未配置" />
                    </Form.Item>
                    <Form.Item name="sidPrefix" label="SRv6 SID 前缀">
                      <Input placeholder="未配置" />
                    </Form.Item>
                    {isHubPe ? (
                      <>
                        <div style={{ color: '#1677ff', margin: '4px 0 12px 0', borderBottom: '1px solid #e8e8e8', paddingBottom: 6 }}>
                          Hub 公网 BGP（进程级 · bgp[0]）
                        </div>
                        <Form.Item name="bgpAsn" label="ASN">
                          <InputNumber style={{ width: '100%' }} placeholder="未配置" />
                        </Form.Item>
                        <Form.Item name="bgpRouterId" label="Router-ID">
                          <Input placeholder="未配置" />
                        </Form.Item>
                        <div style={{ height: 12 }} />
                        <div style={{ color: '#1677ff', margin: '4px 0 12px 0', borderBottom: '1px solid #e8e8e8', paddingBottom: 6 }}>
                          WAN侧配置（Hub-PE to Spoke-PE）
                        </div>
                        <Tabs
                          type="card"
                          size="small"
                          items={(() => {
                            const groups: any[] = mirrorForm.getFieldValue('hubWanInventory') || [{}];
                            return groups.map((g, idx) => ({
                              key: String(idx),
                              label: `WAN 接口 #${idx + 1}`,
                              children: (
                                <div>
                                  <Form.Item label="WAN 侧接口">
                                    <Input disabled value={g?.ifName || '未配置'} />
                                  </Form.Item>
                                  <Form.Item label="WAN 侧 IPv4 地址/掩码">
                                    <Input disabled value={g?.ipv4 || '未配置'} />
                                  </Form.Item>
                                  <Form.Item label="WAN 侧 IPv6 地址/掩码">
                                    <Input disabled value={g?.ipv6 || '未配置'} />
                                  </Form.Item>
                                  <div style={{ height: 8 }} />
                                  <div style={{ color: '#1677ff', margin: '4px 0 12px 0', borderBottom: '1px solid #e8e8e8', paddingBottom: 6 }}>
                                    静态路由（本 WAN 口）
                                  </div>
                                  <Form.Item label="IPv4 目的网段">
                                    <Input disabled value={g?.ipv4RouteDest || '未配置'} />
                                  </Form.Item>
                                  <Form.Item label="IPv4 优先级">
                                    <Input
                                      disabled
                                      value={
                                        g?.ipv4RoutePriority != null
                                          ? String(g.ipv4RoutePriority)
                                          : g?.ipv4RouteDest
                                            ? '100'
                                            : '未配置'
                                      }
                                    />
                                  </Form.Item>
                                  <Form.Item label="IPv6 目的网段">
                                    <Input disabled value={g?.ipv6Dest || '未配置'} />
                                  </Form.Item>
                                  <Form.Item label="IPv6 网关">
                                    <Input disabled value={g?.ipv6Via || '未配置'} />
                                  </Form.Item>
                                </div>
                              ),
                            }));
                          })()}
                        />
                      </>
                    ) : (
                      <>
                    <div style={{ color: '#1677ff', margin: '4px 0 12px 0', borderBottom: '1px solid #e8e8e8', paddingBottom: 6 }}>WAN 侧配置（PE to PE）</div>
                    <Form.Item name="wanDev" label="WAN 侧接口"> 
                      <Select
                      placeholder="未配置"
                      showSearch
                      loading={ifaceLoading}
                      options={[
                        ...(mirrorForm.getFieldValue('wanDev') ? [{ label: String(mirrorForm.getFieldValue('wanDev')), value: String(mirrorForm.getFieldValue('wanDev')) }] : []),
                        ...ifaceOptions.map(n => ({ label: n, value: n })),
                      ]}
                    />
                    </Form.Item>
                    <Form.Item name="wanIpv4" label="WAN 侧 IPv4 地址/掩码">
                      <Input placeholder="未配置" />
                    </Form.Item>
                    <Form.Item name="wanIpv6" label="WAN 侧 IPv6 地址/掩码">
                      <Input placeholder="未配置" />
                    </Form.Item>
                    <div style={{ height: 12 }} />
                    <div style={{ color: '#1677ff', margin: '4px 0 12px 0', borderBottom: '1px solid #e8e8e8', paddingBottom: 6 }}>BGP 配置（PE to PE）</div>
                    <Form.Item name="bgpAsn" label="ASN">
                      <InputNumber style={{ width: '100%' }} placeholder="未配置" />
                    </Form.Item>
                    <Form.Item name="bgpRouterId" label="Router-ID">
                      <Input placeholder="未配置" />
                    </Form.Item>
                    <div style={{ height: 12 }} />
                    <div style={{ color: '#1677ff', margin: '4px 0 12px 0', borderBottom: '1px solid #e8e8e8', paddingBottom: 6 }}>静态路由（WAN）</div>
                    <Form.Item name="wanRouteDest" label="IPv4 目的网段">
                      <Input placeholder="未配置" />
                    </Form.Item>
                    <Form.Item name="wanRoutePriority" label="IPv4 优先级">
                      <InputNumber style={{ width: '100%' }} placeholder="未配置" />
                    </Form.Item>
                    <Form.Item name="ipv6Dest" label="IPv6 目的网段"> 
                      <Input placeholder="未配置" />
                    </Form.Item>
                    <Form.Item name="ipv6Via" label="IPv6 网关"> 
                      <Input placeholder="未配置" />
                    </Form.Item>
                      </>
                    )}
                  </>
                )}
                {current === 1 && (
                  <>
                    <div style={{ color: '#1677ff', margin: '4px 0 12px 0', borderBottom: '1px solid #e8e8e8', paddingBottom: 6 }}>
                      {isHubPe ? 'LAN 侧配置（Hub-PE to CE）' : 'LAN 侧配置（PE to CE）'}
                    </div>
                    {(() => {
                      const groups: any[] = mirrorForm.getFieldValue('lanConfigs') || [{}];
                      const renderLanMirrorFields = (idx: number, g: any) => (
                        <div>
                          <Form.Item
                            name={['lanConfigs', idx, 'vrf']}
                            label={<>
                                VRF ID{isHubPe ? '' : '（可选）'}
                              </>}
                          >
                            <InputNumber style={{ width: '100%' }} placeholder="未配置" />
                          </Form.Item>
                          <Form.Item name={['lanConfigs', idx, 'ifName']} label="LAN 侧接口">
                            <Select
                              placeholder="未配置"
                              showSearch
                              loading={ifaceLoading}
                              options={[
                                ...(g?.ifName ? [{ label: String(g.ifName), value: String(g.ifName) }] : []),
                                ...ifaceOptions.map((n) => ({ label: n, value: n })),
                              ]}
                            />
                          </Form.Item>
                          <Form.Item name={['lanConfigs', idx, 'ipv4']} label="IPv4 地址/掩码">
                            <Input placeholder="未配置" />
                          </Form.Item>
                          <Form.Item name={['lanConfigs', idx, 'ipv6']} label="IPv6 地址/掩码">
                            <Input placeholder="未配置" />
                          </Form.Item>
                          <div style={{ height: 12 }} />
                          <div style={{ color: '#1677ff', margin: '4px 0 12px 0', borderBottom: '1px solid #e8e8e8', paddingBottom: 6 }}>
                            BGP 配置（LAN）
                          </div>
                          <Form.Item name={['lanConfigs', idx, 'asn']} label="BGP ASN">
                            <InputNumber style={{ width: '100%' }} placeholder="未配置" />
                          </Form.Item>
                          <Form.Item name={['lanConfigs', idx, 'routerId']} label="BGP Router-ID">
                            <Input placeholder="未配置" />
                          </Form.Item>
                          <Form.Item
                            name={['lanConfigs', idx, 'routeDistinguisher']}
                            label="Route Distinguisher（RD）"
                          >
                            <Input placeholder="未配置" />
                          </Form.Item>
                          <Form.Item
                            name={['lanConfigs', idx, 'routeTarget']}
                            label="Route Target（RT）"
                          >
                            <Input placeholder="未配置" />
                          </Form.Item>
                        </div>
                      );
                      // 与右侧配置编辑一致：Spoke 单行无 Tab；Hub 多 LAN 用卡片 Tab
                      if (!isHubPe) {
                        return renderLanMirrorFields(0, groups[0]);
                      }
                      return (
                        <Tabs
                          type="card"
                          size="small"
                          tabBarGutter={8}
                          activeKey={activeLanTabKey ?? (groups.length ? '0' : undefined)}
                          onChange={(key) => setActiveLanTabKey(String(key))}
                          items={groups.map((g, idx) => ({
                            key: String(idx),
                            label: `LAN 接口 #${idx + 1}`,
                            children: renderLanMirrorFields(idx, g),
                          }))}
                        />
                      );
                    })()}
                  </>
                )}
                {current === 2 && (
                  <>
                    <Descriptions column={1} bordered size="small">
                      <Descriptions.Item label="SRv6 Locator">{previewStr(mirrorForm.getFieldValue('locatorName'))}</Descriptions.Item>
                      <Descriptions.Item label="SRv6 SID Prefix">{previewStr(mirrorForm.getFieldValue('sidPrefix'))}</Descriptions.Item>
                      {isHubPe ? (
                        <>
                          {(mirrorForm.getFieldValue('hubWanInventory') || []).map((wan: any, idx: number) => (
                            <Descriptions.Item key={`hub-wan-${idx}`} label={`WAN 接口 #${idx + 1}`}>
                              {formatHubWanConfirmLine(wan)}
                            </Descriptions.Item>
                          ))}
                          <Descriptions.Item label="公网 BGP ASN">{previewNum(mirrorForm.getFieldValue('bgpAsn'))}</Descriptions.Item>
                          <Descriptions.Item label="公网 BGP Router-ID">{previewStr(mirrorForm.getFieldValue('bgpRouterId'))}</Descriptions.Item>
                        </>
                      ) : (
                        <>
                          <Descriptions.Item label="WAN 侧接口">{previewStr(mirrorForm.getFieldValue('wanDev'))}</Descriptions.Item>
                          <Descriptions.Item label="WAN 侧 IPv4">{previewStr(mirrorForm.getFieldValue('wanIpv4'))}</Descriptions.Item>
                          <Descriptions.Item label="WAN 侧 IPv6">{previewStr(mirrorForm.getFieldValue('wanIpv6'))}</Descriptions.Item>
                          <Descriptions.Item label="BGP ASN（WAN）">{previewNum(mirrorForm.getFieldValue('bgpAsn'))}</Descriptions.Item>
                          <Descriptions.Item label="BGP Router-ID（WAN）">{previewStr(mirrorForm.getFieldValue('bgpRouterId'))}</Descriptions.Item>
                          <Descriptions.Item label="IPv4 目的网段">{previewStr(mirrorForm.getFieldValue('wanRouteDest'))}</Descriptions.Item>
                          <Descriptions.Item label="IPv4 优先级">
                            {(() => {
                              const p = mirrorForm.getFieldValue('wanRoutePriority');
                              const d = mirrorForm.getFieldValue('wanRouteDest');
                              if (p != null && p !== '') return previewNum(p);
                              return d ? 100 : '-';
                            })()}
                          </Descriptions.Item>
                          <Descriptions.Item label="IPv6 目的网段">{previewStr(mirrorForm.getFieldValue('ipv6Dest'))}</Descriptions.Item>
                          <Descriptions.Item label="IPv6 网关">{previewStr(mirrorForm.getFieldValue('ipv6Via'))}</Descriptions.Item>
                        </>
                      )}
                    </Descriptions>
                    {(mirrorForm.getFieldValue('lanConfigs') || []).map((lan: any, idx: number) => (
                      <div key={idx} style={{ marginTop: 12 }}>
                        <div style={{ color: '#1677ff', margin: '4px 0 8px 0', borderBottom: '1px solid #e8e8e8', paddingBottom: 6 }}>LAN 接口 #{idx + 1}</div>
                        <Descriptions column={1} bordered size="small">
                          <Descriptions.Item label="VRF ID">{lan.vrf || '-'}</Descriptions.Item>
                          <Descriptions.Item label="LAN 侧接口">{lan.ifName || '-'}</Descriptions.Item>
                          <Descriptions.Item label="IPv4">{lan.ipv4 || '-'}</Descriptions.Item>
                          <Descriptions.Item label="IPv6">{lan.ipv6 || '-'}</Descriptions.Item>
                          <Descriptions.Item label="BGP ASN">{lan.asn || '-'}</Descriptions.Item>
                          <Descriptions.Item label="BGP Router-ID">{lan.routerId || '-'}</Descriptions.Item>
                          <Descriptions.Item label="RD">{lan.routeDistinguisher || '-'}</Descriptions.Item>
                          <Descriptions.Item label="RT">{lan.routeTarget || '-'}</Descriptions.Item>
                        </Descriptions>
                      </div>
                    ))}
                  </>
                )}
              </Form>
            ) : hasRoleConfig ? (
              <div style={{ padding: 12, background: '#f7f8fa', border: '1px dashed #d9d9d9', borderRadius: 6, color: '#4e5969', fontSize: 12 }}>
                请确认设备在线后再次点「刷新设备回读」。
              </div>
            ) : (
              <div style={{ padding: 12, background: '#f7f8fa', border: '1px dashed #d9d9d9', borderRadius: 6, color: '#4e5969', fontSize: 12 }}>
                请先完成「下发配置」，再点「刷新设备回读」。
              </div>
            )}
          </IbrWizardCard>
        }
        main={
          <IbrWizardStepPane
            title={ibrWizardStepCardTitle(current, wizardStepTitles[current], '配置编辑')}
            footerLeft={
              <>
                <Button onClick={() => navigate('/admin/interconnect/vr')}>返回列表</Button>
                {current > 0 && <Button onClick={prev}>上一步</Button>}
              </>
            }
            footerRight={
              <>
                {current < 2 && <Button type="primary" onClick={next}>下一步</Button>}
                {current === 2 && (
                  <Button
                    type="primary"
                    loading={loading}
                    onClick={() => {
                      setConfirmChecked(false);
                      setConfirmOpen(true);
                    }}
                  >
                    下发配置
                  </Button>
                )}
              </>
            }
          >
            {renderCoreContent()}
          </IbrWizardStepPane>
        }
        preview={
          <IbrWizardCard sticky title="配置 JSON预览">
            <pre style={{ fontSize: 12, lineHeight: '18px', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
              {JSON.stringify(uuid ? { uuid, ...configPreview } : configPreview, null, 2)}
            </pre>
          </IbrWizardCard>
        }
    >
      <Modal
        title="重要提示：配置下发为全量覆盖"
        open={confirmOpen}
        onCancel={() => setConfirmOpen(false)}
        onOk={async () => {
          if (!confirmChecked) return;
          setConfirmOpen(false);
          await handleDispatch();
        }}
        okButtonProps={{ disabled: !confirmChecked }}
        okText="我已阅读并理解，继续下发"
        cancelText="取消"
        width={680}
      >
        <div style={{ color: '#595959' }}>
          <div style={{ marginBottom: 12 }}>
            本次下发属于全量覆盖。设备当前配置将被完全替换为向导生成的配置，不进行保留或增量合并。
          </div>
          <div style={{ marginBottom: 12 }}>
            影响范围包括但不限于：接口与子接口、IPv4/IPv6 地址与状态、静态路由、NAT 设置、BGP/VRF、SRv6 参数及可能相关的策略项。已有的手工修改可能被覆盖。
          </div>
          <div style={{ marginBottom: 12 }}>
            风险提醒：若默认路由或公网网关设置不正确，设备可能出现短暂不可达；NAT 开关变更会影响内网出网；路由/BGP 变更可能导致业务中断。
          </div>
          <div style={{ marginBottom: 12 }}>
            建议在维护时段执行，并在下发前使用“刷新设备回读”确认当前状态，必要时通过专家模式备份配置，确保具备回滚方案。
          </div>
          <div style={{ marginBottom: 12 }}>
            适用范围：标准、PE、CE 模式的配置下发均为全量覆盖。
          </div>
          <Checkbox checked={confirmChecked} onChange={(e) => setConfirmChecked(e.target.checked)}>
            我已阅读并理解上述内容，确认继续执行全量覆盖下发
          </Checkbox>
        </div>
      </Modal>
    </IbrWizardPage>
  );
};

export default PEWizard;
