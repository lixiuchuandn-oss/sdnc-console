import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, Card, Descriptions, Divider, Form, Input, InputNumber, Space, Steps, message, Row, Col, Select, Tabs, Spin, Modal, Checkbox } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import PageContainer from '../../../../../components/PageContainer';
import { getVRConfig, saveVRConfig, setVRRole, fetchVrCacheMerged } from '../../../../../services/virtualRouterApi';
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
import {
  assertUniqueHubInventoryIfNames,
  buildHubWanMirrorRowsFromDevice,
  buildWanStaticRoutesFromRows,
  enrichHubWanRowsFromDeviceRoutes,
  resolveHubWanRowsForPeWizardForm,
  type WanRouteFormRow,
} from '../peWizardWanRoutes';

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
  const {
    lanBgp: _lb,
    lanBgpAsn: _la,
    lanBgpRouterId: _lr,
    bgpAsn: _ba,
    bgpRouterId: _br,
    asn: _a,
    routerId: _r,
    ifName,
    lanName,
    ...rest
  } = l;
  return {
    ...rest,
    ifName: lanName || ifName,
    ...(Number.isFinite(asnNum) ? { asn: asnNum } : {}),
    ...(routerId ? { routerId } : {}),
  };
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

  const prevWanDevRef = useRef<string | undefined>(undefined);
  const hadVr3InfoRef = useRef(false);
  /** 记录上一轮 vr3：未改 WAN 口名时勿用新 vr3 覆盖用户已编辑的 wanIpv4/6 */
  const prevVr3InfoForPeWanRef = useRef<any>(null);

  useEffect(() => {
    hadVr3InfoRef.current = false;
    prevWanDevRef.current = undefined;
    prevVr3InfoForPeWanRef.current = null;
    skipEditFormOnNextDeviceReadRef.current = false;
    setActiveLanTabKey('0');
    setActiveWanTabKey('0');
  }, [uuid]);

  /** 拉取 VR 缓存合并数据，解析接口列表与 VR3 网卡 IP */
  const fetchInterfaces = useCallback(async (silent = false) => {
    if (!uuid) return;
    setIfaceLoading(true);
    try {
      const merged = await fetchVrCacheMerged(uuid);
      if (!merged || typeof merged !== 'object') {
        if (!silent) message.warning('未获取到设备回读数据，请先确认 VR 设备在线/已接入。');
        setCsmctlCfg(null);
        setVr3Info(null);
        return;
      }
      let savedCfg: any = {};
      try {
        savedCfg = (await getVRConfig(uuid)) || {};
      } catch (e) {
        console.warn('fetchInterfaces: getVRConfig failed:', e);
      }
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
      console.warn('[PEWizard] fetchVrCacheMerged:', (err as any)?.message || err);
      if (!silent) message.error('设备回读失败');
    } finally {
      setIfaceLoading(false);
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
      lanConfigs = lanConfigs.map((r: any) => ({ ...r, ipv4: undefined, ipv6: undefined }));
      const pbg = readPublicBgpMetaFromPe(pe);
      form.setFieldsValue({
        locatorName: pcfg.locatorName,
        sidPrefix: pcfg.sidPrefix,
        wanDev: pcfg.wanName || pcfg.wanDev,
        wanIpv4: undefined,
        wanIpv6: undefined,
        wanRouteDest: pcfg.wanRouteDest,
        wanRoutePriority: pcfg.wanRoutePriority,
        ipv6Dest: pcfg.ipv6Dest,
        ipv6Via: pcfg.ipv6Via,
        bgpNetworkIpv4: pcfg.bgpNetworkIpv4,
        bgpNetworkIpv6: pcfg.bgpNetworkIpv6,
        bgpAsn: pbg.asn,
        bgpRouterId: pbg.routerId,
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
                hubWanInventory: resolveHubWanRowsForPeWizardForm(
                  hubForm.hubWanInventory,
                  [],
                  existingCfg,
                ),
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
    const wanIfVr3 = wanDevStr && vr3Info ? findInterfaceInDevice(vr3Info, wanDevStr) : null;
    const v4Wan = wanIfVr3 ? String(pickIfaceIpv4(wanIfVr3) || '').trim() : '';
    const v6Wan = wanIfVr3 ? String(pickIfaceIpv6(wanIfVr3) || '').trim() : '';
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
      wanRouteDest: ipv4RouteTop?.destination || '0.0.0.0/0',
      wanRoutePriority: ipv4RouteTop?.priority ?? 100,
      // ipv6 route destination：无掩码时默认 ::/0；设备可能返回主机地址
      ipv6Dest: (() => {
        const raw = String(ipv6RouteTop?.destination || '').trim();
        if (!raw) return '::/0';
        if (raw.includes('/')) return raw;
        // 设备仅返回主机地址时补 /128，便于表单展示为 CIDR
        return `${raw}/128`;
      })(),
      ipv6Via: ipv6RouteTop?.via || '500::1',
      bgpAsn: bgpTop?.asn,
      bgpRouterId: bgpTop?.router_id,
      bgpNetworkIpv4: nets4,
      bgpNetworkIpv6: nets6,
    };

    // mirror 侧：ipv6Dest 与 vr2 原始 destination 对齐（避免 spread 推断偏差）
    const ipv6DestMirror =
      ipv6RouteTop &&
      (() => {
        const raw = String(ipv6RouteTop.destination || '').trim();
        if (!raw) return undefined;
        if (raw.includes('/')) return raw;
        return `${raw}/128`;
      })();
    const mirrorInferredTop = {
      locatorName: (dev as any)?.segment_routing_srv6?.locator,
      sidPrefix: (dev as any)?.segment_routing_srv6?.prefix,
      wanDev: wanDevCandidate,
      wanIpv4: v4Wan || undefined,
      wanIpv6: v6Wan || undefined,
      wanRouteDest: ipv4RouteTop?.destination,
      wanRoutePriority: ipv4RouteTop?.priority,
      ipv6Dest: ipv6DestMirror,
      ipv6Via: ipv6RouteTop?.via,
      bgpAsn: bgpTop?.asn,
      bgpRouterId: bgpTop?.router_id,
      bgpNetworkIpv4: nets4,
      bgpNetworkIpv6: nets6,
    };

    const ifaceItems: Array<{ name?: string; ipv4_static?: string; ipv6_static?: string; vrf?: any }> = [];
    const lanIpFromVr3 = (ifName?: string) => {
      const n = String(ifName || '').trim();
      if (!n || !vr3Info) return { ipv4: undefined as string | undefined, ipv6: undefined as string | undefined };
      const o = findInterfaceInDevice(vr3Info, n);
      if (!o) return { ipv4: undefined, ipv6: undefined };
      const ipv4 = String(pickIfaceIpv4(o) || '').trim() || undefined;
      const ipv6 = String(pickIfaceIpv6(o) || '').trim() || undefined;
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
    const bgpByVrf = new Map<any, { asn?: number; routerId?: string }>();
    topBgpArr.forEach((b) => {
      if (b && typeof b === 'object' && 'vrf' in b && b.vrf != null) {
        bgpByVrf.set(b.vrf, { asn: b.asn, routerId: b.router_id });
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
        const ipVr3 = lanIpFromVr3(ifn);
        groups.push({
          vrf: vrfVal,
          ifName: ifn,
          ipv4: ipVr3.ipv4,
          ipv6: ipVr3.ipv6,
          asn: bgpMatch?.asn,
          routerId: bgpMatch?.routerId,
        });
      });
    } else if (ifaceItems.length) {
      const first = ifaceItems[0];
      const ifn = first?.name;
      const ipVr3 = lanIpFromVr3(ifn);
      groups.push({
        vrf: first?.vrf,
        ifName: ifn,
        ipv4: ipVr3.ipv4,
        ipv6: ipVr3.ipv6,
        asn: bgpTop?.asn,
        routerId: bgpTop?.router_id,
      });
    }

    // LAN 分组为空时仍保留 [{}]，避免 Form.List 无行；与 vr2 推断一致
    const lanConfigsForForm = groups.length > 0 ? groups : [{}];
    const lanConfigsForMirror = lanConfigsForForm;

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
    const fullInferredForMirror = {
      ...mirrorInferredTop,
      lanConfigs: lanConfigsForMirror,
      ...(isHubPe
        ? {
            hubWanInventory: buildHubWanMirrorRowsFromDevice(ifaceItems, {
              ipv4_route: (dev as any)?.ipv4_route,
              ipv6_route: (dev as any)?.ipv6_route,
            }),
          }
        : {}),
    };
    mirrorForm.setFieldsValue(fullInferredForMirror);

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
      const wanVr3ForMap =
        wanDevMapped && vr3Info ? findInterfaceInDevice(vr3Info, String(wanDevMapped)) : null;
      const wanIpv4Mapped = wanVr3ForMap ? String(pickIfaceIpv4(wanVr3ForMap) || '').trim() || undefined : undefined;
      const wanIpv6Mapped = (() => {
        const fromVr3 = wanVr3ForMap ? String(pickIfaceIpv6(wanVr3ForMap) || '').trim() : '';
        const fromSaved = filterLinkLocalIpv6(pcfg.wanIpv6);
        const merged = fromVr3 || fromSaved;
        return merged || undefined;
      })();
      const lanConfigsVr3 = (lanConfigs || []).map((row: any) => {
        const ifn = row?.ifName;
        const ip = lanIpFromVr3(ifn);
        return { ...row, ipv4: ip.ipv4, ipv6: ip.ipv6 };
      });
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
        bgpNetworkIpv4: pcfg.bgpNetworkIpv4 ?? inferredTop.bgpNetworkIpv4,
        bgpNetworkIpv6: pcfg.bgpNetworkIpv6 ?? inferredTop.bgpNetworkIpv6,
        lanConfigs: lanConfigsVr3,
        bgpAsn: pbg.asn ?? inferredTop.bgpAsn,
        bgpRouterId: pbg.routerId ?? inferredTop.bgpRouterId,
        ...(isHubPe
          ? (() => {
              const hubForm = hubInventoryToPeWizardForm(existingCfg, {
                wanDev: wanDevMapped,
                wanIpv4: wanIpv4Mapped,
                wanIpv6: wanIpv6Mapped,
                lanConfigs: lanConfigsVr3,
              });
              return {
                hubWanInventory: resolveHubWanRowsForPeWizardForm(
                  hubForm.hubWanInventory,
                  ifaceItems,
                  dev,
                ),
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
    if (prevVr3InfoForPeWanRef.current != null && vr3Info != null) {
      const nicUnchanged = (prevWanDevRef.current ?? '') === wan;
      if (nicUnchanged) {
        prevVr3InfoForPeWanRef.current = vr3Info;
        return;
      }
    }
    if (vr3Info) prevVr3InfoForPeWanRef.current = vr3Info;

    const vr3JustArrived = !!vr3Info && !hadVr3InfoRef.current;
    if (vr3Info) hadVr3InfoRef.current = true;
    if (wan) {
      const nicChanged = prevWanDevRef.current !== wan;
      prevWanDevRef.current = wan || undefined;
      autoFillWanFromIface(wan, { force: nicChanged || vr3JustArrived });
    } else {
      prevWanDevRef.current = undefined;
      autoFillWanFromIface('', { force: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [watchedWanDev, vr3Info]);

  const sortJsonKeys = (obj: any): any => {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return obj;
    
    // 递归排序 JSON 键（展示/对比用）
    const copy = { ...obj };
    Object.keys(copy).forEach(k => {
      copy[k] = sortJsonKeys(copy[k]);
    });

    // 关键字段 uuid、role、pe 等优先排序
    const keys = Object.keys(copy).sort((a, b) => {
       const prio = (k: string) => {
         if (k === 'uuid') return -1;
         if (k === 'role') return 0;
         if (k === 'pe') return 1;
         if (k === 'segment_routing_srv6') return 2;
         if (k === 'vrf') return 3;
         if (k.startsWith('interfaces_')) return 10;
         if (k.startsWith('subinterfaces_')) return 11;
         if (k.startsWith('ipv4_')) return 15;
         if (k.startsWith('ipv6_')) return 16;
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

  const buildConfigFromValues = (v: any) => {
    const cfg: any = {};
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
      const dest = normalizeIPv4Cidr(v?.wanRouteDest || '0.0.0.0/0');
      const prio = Number(v?.wanRoutePriority ?? 100);
      if (dest) cfg.ipv4_route = [{ destination: dest, dev: primaryWanDev, priority: prio }];
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
        if (g?.asn || g?.routerId) {
          const vrfNum = g?.vrf != null && String(g.vrf).trim() !== '' ? Number(g.vrf) : undefined;
          const enableAutoSid = Number.isFinite(vrfNum as any) && (vrfNum as number) >= 4001;
          const asnRaw = Number(g?.asn);
          const asn = Number.isFinite(asnRaw) ? asnRaw : undefined;
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
        const { ifName, asn, routerId, ...rest } = l;
        const asnN = Number(asn);
        const rid = String(routerId || '').trim();
        const row: any = {
          ...rest,
          lanName: ifName,
        };
        if (Number.isFinite(asnN) || rid) {
          row.lanBgp = {
            ...(Number.isFinite(asnN) ? { asn: asnN } : {}),
            ...(rid ? { routerId: rid } : {}),
          };
        }
        return row;
      }),
    };

    if (isHubPe) {
      const inventory = buildHubInventoryFromPeWizardValues(v, existingHubInventory);
      attachHubInventoryToConfig(cfg, inventory);
    }

    return sortJsonKeys(cfg);
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

  const next = async () => {
    try {
      await form.validateFields();
      if (!ensureUniqueHubIfNames()) return;
      setCurrent((c) => Math.min(2, c + 1));
    } catch {}
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
      await form.validateFields();
      if (!ensureUniqueHubIfNames()) return;
      setCurrent(idx);
    } catch {
      /* 校验未通过，留在当前步 */
    }
  };

  const handleDispatch = async () => {
    if (!uuid) {
      message.error('缺少 VR 实例 UUID，无法继续');
      return;
    }
    try {
      const refs = await fetchSrv6VrReferences(uuid);
      if (refs?.count && refs.count > 0) {
        const names = Array.from(new Set((refs.refs || []).map((r) => r.tunnelName).filter(Boolean)));
        const namesPart = names.length ? `引用隧道：${names.join('、')}` : '当前 VR 已被 SRv6 隧道引用';
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
          <div style={{ fontSize: 13, color: '#1677ff', margin: '4px 0 12px 0', borderBottom: '1px solid #e8e8e8', paddingBottom: 6 }}>SRv6 配置</div>
          <Form.Item name="locatorName" label={<span style={{ fontSize: 13, color: '#595959' }}>SRv6 Locator 名称</span>}> 
            <Input placeholder="例如 default" />
          </Form.Item>
          <Form.Item
            name="sidPrefix"
            label={<span style={{ fontSize: 13, color: '#595959' }}>SRv6 SID 前缀</span>}
            rules={[
              {
                validator: (_, value) => {
                  const s = String(value ?? '').trim();
                  if (!s) return Promise.resolve();
                  if (s.includes('/')) return Promise.reject(new Error('SID 前缀无需填写掩码（/xx），系统会自动处理'));
                  return Promise.resolve();
                },
              },
            ]}
          >
            <Input placeholder="例如 2400:1234::1（不带 /xx）" />
          </Form.Item>
          {isHubPe ? (
            <>
              <div style={{ fontSize: 13, color: '#1677ff', margin: '4px 0 12px 0', borderBottom: '1px solid #e8e8e8', paddingBottom: 6 }}>
                Hub 公网 BGP（进程级 · bgp[0]）
              </div>
              <Form.Item name="bgpAsn" label={<span style={{ fontSize: 13, color: '#595959' }}>ASN</span>} rules={[{ required: true, message: '请输入 BGP ASN' }]}>
                <InputNumber style={{ width: '100%' }} min={1} placeholder="例如 100" />
              </Form.Item>
              <Form.Item name="bgpRouterId" label={<span style={{ fontSize: 13, color: '#595959' }}>Router-ID</span>} rules={[{ required: true, message: '请输入 BGP Router-ID' }]}>
                <Input placeholder="例如 200.1.1.2" />
              </Form.Item>
              <Divider style={{ margin: '16px 0' }} />
            </>
          ) : null}
          {isHubPe ? (
            <>
            <div style={{ fontSize: 13, color: '#1677ff', margin: '4px 0 12px 0', borderBottom: '1px solid #e8e8e8', paddingBottom: 6 }}>
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
                        label={<span style={{ fontSize: 13, color: '#595959' }}>WAN 侧接口</span>}
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
                        label={<span style={{ fontSize: 13, color: '#595959' }}>WAN 侧 IPv4 地址/掩码</span>}
                      >
                        <Input placeholder="例如 200.1.1.2/24" />
                      </Form.Item>
                      <Form.Item
                        {...field}
                        name={[field.name, 'ipv6']}
                        label={<span style={{ fontSize: 13, color: '#595959' }}>WAN 侧 IPv6 地址/掩码</span>}
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
                      <div style={{ fontSize: 13, color: '#1677ff', margin: '4px 0 12px 0', borderBottom: '1px solid #e8e8e8', paddingBottom: 6 }}>
                        静态路由（本 WAN 口）
                      </div>
                      <Form.Item
                        {...field}
                        name={[field.name, 'ipv4RouteDest']}
                        label={<span style={{ fontSize: 13, color: '#595959' }}>IPv4 目的网段</span>}
                      >
                        <Input placeholder="例如 0.0.0.0/0" />
                      </Form.Item>
                      <Form.Item
                        {...field}
                        name={[field.name, 'ipv4RoutePriority']}
                        label={<span style={{ fontSize: 13, color: '#595959' }}>优先级</span>}
                      >
                        <InputNumber style={{ width: '100%' }} placeholder="例如 100" />
                      </Form.Item>
                      <Form.Item
                        {...field}
                        name={[field.name, 'ipv6Dest']}
                        label={<span style={{ fontSize: 13, color: '#595959' }}>IPv6 目的网段</span>}
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
                        label={<span style={{ fontSize: 13, color: '#595959' }}>IPv6 网关</span>}
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
          <div style={{ fontSize: 13, color: '#1677ff', margin: '4px 0 12px 0', borderBottom: '1px solid #e8e8e8', paddingBottom: 6 }}>
            WAN 侧配置（PE to PE）
          </div>
          <Form.Item name="wanDev" label={<span style={{ fontSize: 13, color: '#595959' }}>WAN 侧接口</span>} rules={[{ required: true, message: '请选择 WAN 侧接口' }]}> 
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
          <Form.Item name="wanIpv4" label={<span style={{ fontSize: 13, color: '#595959' }}>WAN 侧 IPv4 地址/掩码</span>}>
            <Input placeholder="例如 200.1.1.2/24" />
          </Form.Item>
          <Form.Item
            name="wanIpv6"
            label={<span style={{ fontSize: 13, color: '#595959' }}>WAN 侧 IPv6 地址/掩码</span>}
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
          <div style={{ fontSize: 13, color: '#1677ff', margin: '4px 0 12px 0', borderBottom: '1px solid #e8e8e8', paddingBottom: 6 }}>BGP 配置（PE to PE）</div>
          <Form.Item name="bgpAsn" label={<span style={{ fontSize: 13, color: '#595959' }}>ASN</span>} rules={[{ required: true, message: '请输入 BGP ASN' }]}>
            <InputNumber style={{ width: '100%' }} min={1} placeholder="例如 100" />
          </Form.Item>
          <Form.Item name="bgpRouterId" label={<span style={{ fontSize: 13, color: '#595959' }}>Router-ID</span>} rules={[{ required: true, message: '请输入 BGP Router-ID' }]}>
            <Input placeholder="例如 200.1.1.2" />
          </Form.Item>
          <div style={{ height: 12 }} />
          <div style={{ fontSize: 13, color: '#1677ff', margin: '4px 0 12px 0', borderBottom: '1px solid #e8e8e8', paddingBottom: 6 }}>静态路由（WAN）</div>
          <Form.Item name="wanRouteDest" label={<span style={{ fontSize: 13, color: '#595959' }}>IPv4 目的网段</span>}>
            <Input placeholder="例如 0.0.0.0/0" />
          </Form.Item>
          <Form.Item name="wanRoutePriority" label={<span style={{ fontSize: 13, color: '#595959' }}>优先级</span>}> 
            <InputNumber style={{ width: '100%' }} placeholder="例如 100" />
          </Form.Item>
          <Form.Item
            name="ipv6Dest"
            label={<span style={{ fontSize: 13, color: '#595959' }}>IPv6 目的网段</span>}
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
            label={<span style={{ fontSize: 13, color: '#595959' }}>IPv6 网关</span>}
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
          <div style={{ fontSize: 13, color: '#1677ff', margin: '4px 0 12px 0', borderBottom: '1px solid #e8e8e8', paddingBottom: 6 }}>
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
                      label={<span style={{ fontSize: 13, color: '#595959' }}>VRF ID{isHubPe ? '' : '（可选）'}</span>}
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
                    <Form.Item {...field} name={[field.name, 'ifName']} label={<span style={{ fontSize: 13, color: '#595959' }}>LAN 侧接口</span>}>
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
                      />
                    </Form.Item>
                    <Form.Item {...field} name={[field.name, 'ipv4']} label={<span style={{ fontSize: 13, color: '#595959' }}>IPv4 地址/掩码</span>}>
                      <Input placeholder="例如 130.1.1.1/24" />
                    </Form.Item>
                    <Form.Item {...field} name={[field.name, 'ipv6']} label={<span style={{ fontSize: 13, color: '#595959' }}>IPv6 地址/掩码</span>}>
                      <Input placeholder="例如 2408:3333:1002::1/64" />
                    </Form.Item>
                    {isHubPe ? (
                      <>
                        <div style={{ height: 12 }} />
                        <div style={{ fontSize: 13, color: '#1677ff', margin: '4px 0 12px 0', borderBottom: '1px solid #e8e8e8', paddingBottom: 6 }}>BGP 配置（LAN）</div>
                        <Form.Item {...field} name={[field.name, 'asn']} label={<span style={{ fontSize: 13, color: '#595959' }}>BGP ASN</span>} rules={[{ required: true, message: '请输入 BGP ASN' }]}>
                          <InputNumber style={{ width: '100%' }} placeholder="例如 100" />
                        </Form.Item>
                        <Form.Item {...field} name={[field.name, 'routerId']} label={<span style={{ fontSize: 13, color: '#595959' }}>BGP Router-ID</span>} rules={[{ required: true, message: '请输入 BGP Router-ID' }]}>
                          <Input placeholder="例如 130.1.1.1" />
                        </Form.Item>
                      </>
                    ) : (
                      <>
                        <div style={{ height: 12 }} />
                        <div style={{ fontSize: 13, color: '#1677ff', margin: '4px 0 12px 0', borderBottom: '1px solid #e8e8e8', paddingBottom: 6 }}>BGP 配置（LAN）</div>
                        <Form.Item {...field} name={[field.name, 'asn']} label={<span style={{ fontSize: 13, color: '#595959' }}>BGP ASN</span>}>
                          <InputNumber style={{ width: '100%' }} placeholder="例如 100" />
                        </Form.Item>
                        <Form.Item {...field} name={[field.name, 'routerId']} label={<span style={{ fontSize: 13, color: '#595959' }}>BGP Router-ID</span>}>
                          <Input placeholder="例如 130.1.1.1" />
                        </Form.Item>
                      </>
                    )}
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
                <Descriptions.Item key={`wan-${idx}`} label={`Hub WAN #${idx + 1}`}>
                  {[wan.ifName, wan.ipv6, wan.ipv6Via ? `gw ${wan.ipv6Via}` : '']
                    .filter(Boolean)
                    .join(' · ') || '-'}
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
                <Descriptions.Item label="公网 BGP ASN（Hub 级）">{previewNum(values.bgpAsn)}</Descriptions.Item>
                <Descriptions.Item label="公网 BGP Router-ID（Hub 级）">{previewStr(values.bgpRouterId)}</Descriptions.Item>
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
                <Descriptions.Item label="优先级">{previewNum(values.wanRoutePriority)}</Descriptions.Item>
                <Descriptions.Item label="IPv6 目的网段">{previewStr(values.ipv6Dest)}</Descriptions.Item>
                <Descriptions.Item label="IPv6 网关">{previewStr(values.ipv6Via)}</Descriptions.Item>
              </>
            )}
          </Descriptions>
          {(values.lanConfigs || []).map((lan: any, idx: number) => (
            <div key={idx} style={{ marginTop: 12 }}>
              <div style={{ fontSize: 13, color: '#1677ff', margin: '4px 0 8px 0', borderBottom: '1px solid #e8e8e8', paddingBottom: 6 }}>LAN 接口 #{idx + 1}</div>
              <Descriptions column={1} bordered size="small">
                <Descriptions.Item label="VRF ID">{lan.vrf || '-'}</Descriptions.Item>
                <Descriptions.Item label="LAN 侧接口">{lan.ifName || '-'}</Descriptions.Item>
                <Descriptions.Item label="IPv4">{lan.ipv4 || '-'}</Descriptions.Item>
                <Descriptions.Item label="IPv6">{lan.ipv6 || '-'}</Descriptions.Item>
                <Descriptions.Item label="BGP ASN">{lan.asn || '-'}</Descriptions.Item>
                <Descriptions.Item label="BGP Router-ID">{lan.routerId || '-'}</Descriptions.Item>
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
    <PageContainer
      titleLevel={3}
      extra={<Button icon={<ReloadOutlined />} onClick={() => fetchInterfaces()}>刷新设备回读</Button>}
      onBack={() => navigate(-1)}
      asCard={false}
    >
      <Row gutter={16}>
        <Col span={4}>
          <Card size="small" title={<span style={{ fontSize: 13, color: '#000', fontWeight: 400 }}>步骤</span>} variant="outlined" style={{ position: 'sticky', top: 16 }}>
            <Steps direction="vertical" size="small" current={current} onChange={handleStepsChange} items={wizardStepTitles.map((title) => ({ title }))} />
          </Card>
        </Col>
        <Col span={7}>
          <Card size="small" title={<span style={{ fontSize: 13, color: '#000', fontWeight: 400 }}>
            {`第 ${current + 1} 步：${wizardStepTitles[current]} 设备回读`}
          </span>} variant="outlined">
            {ifaceLoading ? (
              <div style={{ textAlign: 'center', padding: '32px 0' }}>
                <Spin />
              </div>
            ) : csmctlCfg ? (
              <Form layout="vertical" form={mirrorForm} disabled>
                {current === 0 && (
                  <>
                    <div style={{ fontSize: 13, color: '#1677ff', margin: '4px 0 12px 0', borderBottom: '1px solid #e8e8e8', paddingBottom: 6 }}>SRv6 配置</div>
                    <Form.Item name="locatorName" label={<span style={{ fontSize: 13, color: '#595959' }}>SRv6 Locator 名称</span>}> 
                      <Input placeholder="未配置" />
                    </Form.Item>
                    <Form.Item name="sidPrefix" label={<span style={{ fontSize: 13, color: '#595959' }}>SRv6 SID 前缀</span>}>
                      <Input placeholder="未配置" />
                    </Form.Item>
                    {isHubPe ? (
                      <>
                        <div style={{ fontSize: 13, color: '#1677ff', margin: '4px 0 12px 0', borderBottom: '1px solid #e8e8e8', paddingBottom: 6 }}>
                          Hub 公网 BGP（进程级 · bgp[0]）
                        </div>
                        <Form.Item name="bgpAsn" label={<span style={{ fontSize: 13, color: '#595959' }}>ASN</span>}>
                          <InputNumber style={{ width: '100%' }} placeholder="未配置" />
                        </Form.Item>
                        <Form.Item name="bgpRouterId" label={<span style={{ fontSize: 13, color: '#595959' }}>Router-ID</span>}>
                          <Input placeholder="未配置" />
                        </Form.Item>
                        <div style={{ height: 12 }} />
                        <div style={{ fontSize: 13, color: '#1677ff', margin: '4px 0 12px 0', borderBottom: '1px solid #e8e8e8', paddingBottom: 6 }}>
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
                                  <Form.Item label={<span style={{ fontSize: 13, color: '#595959' }}>WAN 侧接口</span>}>
                                    <Input disabled value={g?.ifName || '未配置'} />
                                  </Form.Item>
                                  <Form.Item label={<span style={{ fontSize: 13, color: '#595959' }}>WAN 侧 IPv4 地址/掩码</span>}>
                                    <Input disabled value={g?.ipv4 || '未配置'} />
                                  </Form.Item>
                                  <Form.Item label={<span style={{ fontSize: 13, color: '#595959' }}>WAN 侧 IPv6 地址/掩码</span>}>
                                    <Input disabled value={g?.ipv6 || '未配置'} />
                                  </Form.Item>
                                  <div style={{ height: 8 }} />
                                  <div style={{ fontSize: 13, color: '#1677ff', margin: '4px 0 12px 0', borderBottom: '1px solid #e8e8e8', paddingBottom: 6 }}>
                                    静态路由（本 WAN 口）
                                  </div>
                                  <Form.Item label={<span style={{ fontSize: 13, color: '#595959' }}>IPv4 目的网段</span>}>
                                    <Input disabled value={g?.ipv4RouteDest || '未配置'} />
                                  </Form.Item>
                                  <Form.Item label={<span style={{ fontSize: 13, color: '#595959' }}>优先级</span>}>
                                    <Input disabled value={g?.ipv4RoutePriority ?? '未配置'} />
                                  </Form.Item>
                                  <Form.Item label={<span style={{ fontSize: 13, color: '#595959' }}>IPv6 目的网段</span>}>
                                    <Input disabled value={g?.ipv6Dest || '未配置'} />
                                  </Form.Item>
                                  <Form.Item label={<span style={{ fontSize: 13, color: '#595959' }}>IPv6 网关</span>}>
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
                    <div style={{ fontSize: 13, color: '#1677ff', margin: '4px 0 12px 0', borderBottom: '1px solid #e8e8e8', paddingBottom: 6 }}>WAN 侧配置（PE to PE）</div>
                    <Form.Item name="wanDev" label={<span style={{ fontSize: 13, color: '#595959' }}>WAN 侧接口</span>}> 
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
                    <Form.Item name="wanIpv4" label={<span style={{ fontSize: 13, color: '#595959' }}>WAN 侧 IPv4 地址/掩码</span>}>
                      <Input placeholder="未配置" />
                    </Form.Item>
                    <Form.Item name="wanIpv6" label={<span style={{ fontSize: 13, color: '#595959' }}>WAN 侧 IPv6 地址/掩码</span>}>
                      <Input placeholder="未配置" />
                    </Form.Item>
                    <div style={{ height: 12 }} />
                    <div style={{ fontSize: 13, color: '#1677ff', margin: '4px 0 12px 0', borderBottom: '1px solid #e8e8e8', paddingBottom: 6 }}>BGP 配置（PE to PE）</div>
                    <Form.Item name="bgpAsn" label={<span style={{ fontSize: 13, color: '#595959' }}>ASN</span>}>
                      <InputNumber style={{ width: '100%' }} placeholder="未配置" />
                    </Form.Item>
                    <Form.Item name="bgpRouterId" label={<span style={{ fontSize: 13, color: '#595959' }}>Router-ID</span>}>
                      <Input placeholder="未配置" />
                    </Form.Item>
                    <div style={{ height: 12 }} />
                    <div style={{ fontSize: 13, color: '#1677ff', margin: '4px 0 12px 0', borderBottom: '1px solid #e8e8e8', paddingBottom: 6 }}>静态路由（WAN）</div>
                    <Form.Item name="wanRouteDest" label={<span style={{ fontSize: 13, color: '#595959' }}>IPv4 目的网段</span>}>
                      <Input placeholder="未配置" />
                    </Form.Item>
                    <Form.Item name="wanRoutePriority" label={<span style={{ fontSize: 13, color: '#595959' }}>优先级</span>}> 
                      <InputNumber style={{ width: '100%' }} placeholder="未配置" />
                    </Form.Item>
                    <Form.Item name="ipv6Dest" label={<span style={{ fontSize: 13, color: '#595959' }}>IPv6 目的网段</span>}> 
                      <Input placeholder="未配置" />
                    </Form.Item>
                    <Form.Item name="ipv6Via" label={<span style={{ fontSize: 13, color: '#595959' }}>IPv6 网关</span>}> 
                      <Input placeholder="未配置" />
                    </Form.Item>
                      </>
                    )}
                  </>
                )}
                {current === 1 && (
                  <>
                    <div style={{ fontSize: 13, color: '#1677ff', margin: '4px 0 12px 0', borderBottom: '1px solid #e8e8e8', paddingBottom: 6 }}>
                      {isHubPe ? 'LAN 侧配置（Hub-PE to CE）' : 'LAN 侧配置（PE to CE）'}
                    </div>
                    <Tabs
                      type="card"
                      items={(() => {
                        const groups: any[] = mirrorForm.getFieldValue('lanConfigs') || [{}];
                        return groups.map((g, idx) => ({
                          key: String(idx),
                          label: `LAN 接口 #${idx + 1}`,
                          children: (
                            <div>
                              <Form.Item name={['lanConfigs', idx, 'vrf']} label={<span style={{ fontSize: 13, color: '#595959' }}>VRF ID（可选）</span>}> 
                                <InputNumber style={{ width: '100%' }} placeholder={"未配置"} />
                              </Form.Item>
                              <Form.Item name={['lanConfigs', idx, 'ifName']} label={<span style={{ fontSize: 13, color: '#595959' }}>LAN 侧接口</span>}> 
                                <Select
                                  placeholder="未配置"
                                  showSearch
                                  loading={ifaceLoading}
                                  options={[
                                    ...(g?.ifName ? [{ label: String(g.ifName), value: String(g.ifName) }] : []),
                                    ...ifaceOptions.map(n => ({ label: n, value: n })),
                                  ]}
                                />
                              </Form.Item>
                              <Form.Item name={['lanConfigs', idx, 'ipv4']} label={<span style={{ fontSize: 13, color: '#595959' }}>IPv4 地址/掩码</span>}>
                                <Input placeholder="未配置" />
                              </Form.Item>
                              <Form.Item name={['lanConfigs', idx, 'ipv6']} label={<span style={{ fontSize: 13, color: '#595959' }}>IPv6 地址/掩码</span>}> 
                                <Input placeholder="未配置" />
                              </Form.Item>
                              <div style={{ height: 12 }} />
                              <div style={{ fontSize: 13, color: '#1677ff', margin: '4px 0 12px 0', borderBottom: '1px solid #e8e8e8', paddingBottom: 6 }}>BGP 配置（LAN）</div>
                              <Form.Item name={['lanConfigs', idx, 'asn']} label={<span style={{ fontSize: 13, color: '#595959' }}>BGP ASN</span>}> 
                                <InputNumber style={{ width: '100%' }} placeholder="未配置" />
                              </Form.Item>
                              <Form.Item name={['lanConfigs', idx, 'routerId']} label={<span style={{ fontSize: 13, color: '#595959' }}>BGP Router-ID</span>}> 
                                <Input placeholder="未配置" />
                              </Form.Item>
                            </div>
                          ),
                        }));
                      })()}
                      tabBarGutter={8}
                      size="small"
                      activeKey={activeLanTabKey ?? '0'}
                      onChange={(key) => {
                        setActiveLanTabKey(String(key));
                      }}
                    />
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
                              {[wan?.ifName, wan?.ipv4, wan?.ipv6, wan?.ipv4RouteDest, wan?.ipv6Dest, wan?.ipv6Via ? `gw ${wan.ipv6Via}` : '']
                                .filter(Boolean)
                                .join(' · ') || '-'}
                            </Descriptions.Item>
                          ))}
                          <Descriptions.Item label="公网 BGP ASN（Hub 级）">{previewNum(mirrorForm.getFieldValue('bgpAsn'))}</Descriptions.Item>
                          <Descriptions.Item label="公网 BGP Router-ID（Hub 级）">{previewStr(mirrorForm.getFieldValue('bgpRouterId'))}</Descriptions.Item>
                        </>
                      ) : (
                        <>
                          <Descriptions.Item label="WAN 侧接口">{previewStr(mirrorForm.getFieldValue('wanDev'))}</Descriptions.Item>
                          <Descriptions.Item label="IPv4 目的网段">{previewStr(mirrorForm.getFieldValue('wanRouteDest'))}</Descriptions.Item>
                          <Descriptions.Item label="优先级">{previewNum(mirrorForm.getFieldValue('wanRoutePriority'))}</Descriptions.Item>
                          <Descriptions.Item label="WAN 侧 IPv4">{previewStr(mirrorForm.getFieldValue('wanIpv4'))}</Descriptions.Item>
                          <Descriptions.Item label="WAN 侧 IPv6">{previewStr(mirrorForm.getFieldValue('wanIpv6'))}</Descriptions.Item>
                          <Descriptions.Item label="BGP ASN（WAN）">{previewNum(mirrorForm.getFieldValue('bgpAsn'))}</Descriptions.Item>
                          <Descriptions.Item label="BGP Router-ID（WAN）">{previewStr(mirrorForm.getFieldValue('bgpRouterId'))}</Descriptions.Item>
                          <Descriptions.Item label="IPv6 目的网段">{previewStr(mirrorForm.getFieldValue('ipv6Dest'))}</Descriptions.Item>
                          <Descriptions.Item label="IPv6 网关">{previewStr(mirrorForm.getFieldValue('ipv6Via'))}</Descriptions.Item>
                        </>
                      )}
                    </Descriptions>
                    {(mirrorForm.getFieldValue('lanConfigs') || []).map((lan: any, idx: number) => (
                      <div key={idx} style={{ marginTop: 12 }}>
                        <div style={{ fontSize: 13, color: '#1677ff', margin: '4px 0 8px 0', borderBottom: '1px solid #e8e8e8', paddingBottom: 6 }}>LAN 接口 #{idx + 1}</div>
                        <Descriptions column={1} bordered size="small">
                          <Descriptions.Item label="VRF ID">{lan.vrf || '-'}</Descriptions.Item>
                          <Descriptions.Item label="LAN 侧接口">{lan.ifName || '-'}</Descriptions.Item>
                          <Descriptions.Item label="IPv4">{lan.ipv4 || '-'}</Descriptions.Item>
                          <Descriptions.Item label="IPv6">{lan.ipv6 || '-'}</Descriptions.Item>
                          <Descriptions.Item label="BGP ASN">{lan.asn || '-'}</Descriptions.Item>
                          <Descriptions.Item label="BGP Router-ID">{lan.routerId || '-'}</Descriptions.Item>
                        </Descriptions>
                      </div>
                    ))}
                  </>
                )}
              </Form>
            ) : (
              <div style={{ padding: 12, background: '#fffbe6', border: '1px dashed #faad14', borderRadius: 6, color: '#faad14', fontSize: 12 }}>
                未能读取设备回读数据，请先检查设备连接状态或稍后重试。
              </div>
            )}
          </Card>
        </Col>
        <Col span={8}>
          <Card size="small" title={<span style={{ fontSize: 13, color: '#000', fontWeight: 400 }}>
            {`第 ${current + 1} 步：${wizardStepTitles[current]} 配置编辑`}
          </span>} variant="outlined">
            {renderCoreContent()}
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 16 }}>
              <Space>
                <Button onClick={() => navigate('/admin/interconnect/vr')}>返回列表</Button>
                {current > 0 && <Button onClick={prev}>上一步</Button>}
              </Space>
              <Space>
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
              </Space>
            </div>
          </Card>
        </Col>
        <Col span={5}>
          <Card size="small" title={<span style={{ fontSize: 13, color: '#000', fontWeight: 400 }}>配置 JSON预览</span>} variant="outlined" style={{ position: 'sticky', top: 16 }}>
            <pre style={{ fontSize: 12, lineHeight: '18px', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
              {JSON.stringify(uuid ? { uuid, ...configPreview } : configPreview, null, 2)}
            </pre>
          </Card>
        </Col>
      </Row>
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
        <div style={{ fontSize: 13, color: '#595959' }}>
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
    </PageContainer>
  );
};

export default PEWizard;
