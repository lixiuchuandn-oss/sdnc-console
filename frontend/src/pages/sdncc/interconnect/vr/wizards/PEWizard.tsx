import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, Card, Descriptions, Form, Input, InputNumber, Space, Steps, message, Row, Col, Select, Tabs, Spin, Modal, Checkbox } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { useNavigate, useParams } from 'react-router-dom';
import PageContainer from '../../../../../components/PageContainer';
import { getVRConfig, saveVRConfig, setVRRole, fetchVrCacheMerged } from '../../../../../services/virtualRouterApi';
import { proxyApiRequest } from '../../../../../services/api';
import { collectIfaceNamesForSelect, pickDeviceBlobForLookup } from '../vrMergedHelpers';
import { renderIfaceWizardSelectLabel } from '../vrWizardIfaceSelect';

/** 平台已存 pe：公网侧元数据（新：pe.publicConfig；旧：扁平字段） */
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

/** 内网组列表：新 pe.lanConfig；旧 pe.lanConfigs；曾误写为 pe.LanConfig 的也兼容 */
function readLanListFromPe(pe: any): any[] {
  if (!pe || typeof pe !== 'object') return [];
  if (Array.isArray((pe as any).lanConfig)) return (pe as any).lanConfig;
  if (Array.isArray((pe as any).LanConfig)) return (pe as any).LanConfig;
  if (Array.isArray((pe as any).lanConfigs)) return (pe as any).lanConfigs;
  return [];
}

/** 公网 BGP（PE–PE）元数据；兼容旧版顶层 bgpAsn / bgpRouterId */
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

/** 平台已存 lanConfig / lanConfigs 一行 → 表单内网组（兼容 lanBgp 与旧字段 bgpAsn等） */
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
  const { uuid } = useParams();
  const [form] = Form.useForm();
  const [mirrorForm] = Form.useForm();
  const [current, setCurrent] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(false);
  const [existingCfg, setExistingCfg] = useState<any>({});
  const [ifaceOptions, setIfaceOptions] = useState<string[]>([]);
  const [ifaceLoading, setIfaceLoading] = useState<boolean>(false);
  const [csmctlCfg, setCsmctlCfg] = useState<any | null>(null);
  /** 聚合接口中的 vr3_info：仅用户主动改公网口 Select 时用其跟 IP（接口权威） */
  const [vr3Info, setVr3Info] = useState<any | null>(null);
  const [activeLanTabKey, setActiveLanTabKey] = useState<string>('0');
  const [confirmOpen, setConfirmOpen] = useState<boolean>(false);
  const [confirmChecked, setConfirmChecked] = useState<boolean>(false);
  /** 用户点击「刷新设备回读」后仅下一帧合并里跳过对右翼 form 的覆盖，左翼 mirror 仍更新 */
  const skipEditFormOnNextDeviceReadRef = useRef(false);

  const watchWanDev = Form.useWatch('wanDev', form);
  const watchLanConfigs = Form.useWatch('lanConfigs', form);

  const peWanIfaceSelectOptions = useMemo(() => {
    const rows = Array.isArray(watchLanConfigs) ? watchLanConfigs : [];
    return ifaceOptions.map((n) => {
      const hits: string[] = [];
      rows.forEach((row: any, i: number) => {
        const ifn = String(row?.ifName || '').trim();
        if (ifn && ifn === n) hits.push(`内网组#${i + 1}`);
      });
      return {
        value: n,
        label: renderIfaceWizardSelectLabel(n, hits.length ? hits.join('、') : undefined),
      };
    });
  }, [ifaceOptions, watchLanConfigs]);

  const peLanIfaceSelectLabel = useCallback(
    (iface: string, rowIndex: number) => {
      const wan = String(watchWanDev || '').trim();
      if (wan && iface === wan) return renderIfaceWizardSelectLabel(iface, '公网口');
      const rows = Array.isArray(watchLanConfigs) ? watchLanConfigs : [];
      const hits: string[] = [];
      rows.forEach((row: any, i: number) => {
        if (i === rowIndex) return;
        const ifn = String(row?.ifName || '').trim();
        if (ifn && ifn === iface) hits.push(`内网组#${i + 1}`);
      });
      return renderIfaceWizardSelectLabel(iface, hits.length ? hits.join('、') : undefined);
    },
    [watchWanDev, watchLanConfigs],
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
  /** 从 IPv6 地址字段值中剔除链路本地地址（fe80:: 前缀），返回第一个有效全局地址 */
  const filterLinkLocal = (raw: string): string => {
    const s = String(raw; \'\').trim();
    // 按换行或空漈分割多地址（VR3 回��可能返回多行）
    const parts = s.split(/\\s+/).filter(Boolean);
    const global = parts.find((p) => !p.toLowerCase().startsWith(\'fe80\'));
    return global; \'\';
  };

  const pickIfaceIpv6 = (iface: any) =>
    filterLinkLocal(
      iface?.ipv6_static ??
      iface?.ipv6Static ??
      iface?.ipv6 ??
      iface?.ipv6_address ??
      iface?.ipv6Address ?? \'\'
    );

  /** 公网口 IPv4/IPv6 仅允许用 VR3 回填；无则置空。 */
  const autoFillWanFromIface = (ifaceName: string, opts?: { force?: boolean }) => {
    const force = opts?.force ?? false;
    const obj = findInterfaceInDevice(vr3Info, ifaceName);
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

  const prevWanDevRef = useRef<string | undefined>(undefined);
  const hadVr3InfoRef = useRef(false);
  /** 公网口名未变、仅 vr3 因刷新被替换时，不覆盖 wanIpv4/6 */
  const prevVr3InfoForPeWanRef = useRef<any>(null);

  useEffect(() => {
    hadVr3InfoRef.current = false;
    prevWanDevRef.current = undefined;
    prevVr3InfoForPeWanRef.current = null;
    skipEditFormOnNextDeviceReadRef.current = false;
  }, [uuid]);

  /** 聚合 /api/vr-instances/:uuid；公网口网卡 IP 仅 VR3 回填 */
  const fetchInterfaces = useCallback(async (silent = false) => {
    if (!uuid) return;
    setIfaceLoading(true);
    try {
      const merged = await fetchVrCacheMerged(uuid);
      if (!merged || typeof merged !== 'object') {
        if (!silent) message.warning('未获取到聚合数据，请先同步 VR 缓存');
        setCsmctlCfg(null);
        setVr3Info(null);
        return;
      }
      let savedCfg: any = {};
      try {
        savedCfg = (await getVRConfig(uuid)) || {};
      } catch (e) {
        console.warn('获取本地配置失败', e);
      }
      if (!silent) {
        skipEditFormOnNextDeviceReadRef.current = true;
      }
      const unique = collectIfaceNamesForSelect(merged as Record<string, any>);
      if (unique.length) setIfaceOptions(unique);
      setCsmctlCfg(pickDeviceBlobForLookup(merged));
      setVr3Info(merged.vr3_info && typeof merged.vr3_info === 'object' ? merged.vr3_info : null);
      setExistingCfg(savedCfg);
      if (!silent) message.success('设备数据已刷新');
    } catch (err) {
      console.warn('[PEWizard] fetchVrCacheMerged:', (err as any)?.message || err);
      if (!silent) message.error('刷新失败');
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
      });
    };

    // vr2_info 为 null/undefined 时 csmctlCfg 为空：不能从设备推断，但仍应回填 Tower 已保存的 pe 元数据
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

    // 右翼编辑：vr2 无 ipv4_route/ipv6_route 时，下面路由字段为向导内置默认值，并非设备回读
    const inferredTop = {
      locatorName: (dev as any)?.segment_routing_srv6?.locator,
      sidPrefix: (dev as any)?.segment_routing_srv6?.prefix,
      wanDev: wanDevCandidate,
      wanIpv4: v4Wan || undefined,
      wanIpv6: v6Wan || undefined,
      wanRouteDest: ipv4RouteTop?.destination || '0.0.0.0/0',
      wanRoutePriority: ipv4RouteTop?.priority ?? 100,
      // 注意：IPv6 默认路由应为 ::/0；0::0/0 不是合法 IPv6 前缀写法（会触发控制器校验错误）
      ipv6Dest: (() => {
        const raw = String(ipv6RouteTop?.destination || '').trim();
        if (!raw) return '::/0';
        if (raw.includes('/')) return raw;
        // 设备侧若回读未带掩码，按单地址补 /128，避免下发时报错
        return `${raw}/128`;
      })(),
      ipv6Via: ipv6RouteTop?.via || '500::1',
      bgpAsn: bgpTop?.asn,
      bgpRouterId: bgpTop?.router_id,
      bgpNetworkIpv4: nets4,
      bgpNetworkIpv6: nets6,
    };

    // 左翼「设备回读」：字段全部仅来自 vr2_info（dev），不 spread 右翼推断（避免把向导默认值当成设备数据）
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
    // 顶层 interfaces[]（VR3/合并接口常见）与 interfaces_XXX 分桶并存
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

    // 无内网组时：右翼给 [{}] 便于编辑；左翼同样给 [{}] 仅作布局占位（字段全空，不表示 vr2 有数据）
    const lanConfigsForForm = groups.length > 0 ? groups : [{}];
    const lanConfigsForMirror = lanConfigsForForm;

    const fullInferredForForm = { ...inferredTop, lanConfigs: lanConfigsForForm };
    const fullInferredForMirror = { ...mirrorInferredTop, lanConfigs: lanConfigsForMirror };
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
      const wanIpv6Mapped = wanVr3ForMap ? String(pickIfaceIpv6(wanVr3ForMap) || '').trim() || undefined : undefined;
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
    
    // 递归处理子对象（深层排序）
    const copy = { ...obj };
    Object.keys(copy).forEach(k => {
      copy[k] = sortJsonKeys(copy[k]);
    });

    // 对最外层进行排序：uuid, role, pe 优先
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
    // IPv6 CIDR：宽松校验（交给控制器做最终校验），这里只保证“像 IPv6 且带掩码”
    // 例如：2408:3333:1002::/64、::1/128、::/0
    const ipv6CidrPattern = /^[0-9a-fA-F:]+\/([0-9]|[1-9]\d|1[01]\d|12[0-8])$/;
    const normalizeIPv4Cidr = (s: any) => {
      const t = String(s || '').trim();
      return ipv4CidrPattern.test(t) ? t : undefined;
    };
    const normalizeIPv6Cidr = (s: any) => {
      const t = String(s || '').trim();
      if (!t) return undefined;
      // 快速排除 IPv4
      if (t.includes('.')) return undefined;
      // 允许 ::/0 等合法前缀（简化校验）
      return ipv6CidrPattern.test(t) ? t : undefined;
    };
    const sid = String(v?.sidPrefix || '').trim();
    if (sid || v?.locatorName) {
      cfg.segment_routing_srv6 = { locator: v?.locatorName, prefix: sid || undefined };
    }
    const ifaceObjs: any[] = [];
    if (v?.wanDev) {
      const item: any = { name: String(v.wanDev).trim(), status: 'up' };
      const ipv4Wan = normalizeIPv4Cidr(v.wanIpv4);
      if (ipv4Wan) item.ipv4_static = ipv4Wan;
      const wan6 = normalizeIPv6Cidr(v?.wanIpv6);
      if (wan6) item.ipv6_static = wan6;
      ifaceObjs.push(item);
    }
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
      if (g?.ipv6) item.ipv6_static = String(g.ipv6).trim();
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
    if (v?.wanDev) {
      const dest = normalizeIPv4Cidr(v?.wanRouteDest || '0.0.0.0/0');
      const prio = Number(v?.wanRoutePriority ?? 100);
      if (dest) cfg.ipv4_route = [{ destination: dest, dev: String(v.wanDev).trim(), priority: prio }];
    }
    // 固定生成 IPv6 静态路由（展示但不可编辑）
    {
      const v6dest = String(v?.ipv6Dest || '').trim();
      const v6via = String(v?.ipv6Via || '500::1').trim();
      const dest = normalizeIPv6Cidr(v6dest);
      if (dest) {
        const route6: any = { destination: dest };
        if (v6via) route6.via = v6via;
        // 与 pe2 专家一致：不写 priority；此为公网侧 IPv6 静态路由，不写 vrf（避免误挂到切片 VRF）
        cfg.ipv6_route = [route6];
      }
    }
    if (vrfSet.size > 0) {
      cfg.vrf = Array.from(vrfSet);
    }
    if (groups.length) {
      const bgpArr: any[] = [];
      // 1. 优先保留现有的 Global BGP 配置（VRF 为空或 0 的）
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
      // 2. 追加 LAN 侧的 VRF BGP 配置
      groups.forEach((g) => {
        if (g?.asn || g?.routerId) {
          const vrfNum = g?.vrf != null && String(g.vrf).trim() !== '' ? Number(g.vrf) : undefined;
          const enableAutoSid = Number.isFinite(vrfNum as any) && (vrfNum as number) >= 4001;
          const asnRaw = Number(g?.asn);
          const asn = Number.isFinite(asnRaw) ? asnRaw : undefined;
          bgpArr.push({
            ...(asn != null ? { asn } : {}),
            ...(enableAutoSid ? { vrf: vrfNum } : {}), // 没有私网 VRF 时不要下发 vrf，避免被当作私网策略
            router_id: g?.routerId,
            bgp_ebgp_requires_policy: 'disable',
            address_family: [
              {
                address_family: 'ipv4',
                modifiler: 'unicast',
                export_route: 'enable',
                import_route: 'enable',
                // 控制器约束：auto_assign_sid 只能在“私网（VRF）”下开启
                ...(enableAutoSid ? { auto_assign_sid: 'enable' } : { auto_assign_sid: 'disable' }),
              },
            ],
          });
        }
      });
      if (bgpArr.length) {
        // 与 pe2 专家一致：公网 BGP（无 vrf）内嵌 segment_routing_srv6；写入公网 ASN / router_id（第一步表单）
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
    cfg.role = 'PE';
    cfg.pe = {
      publicConfig: {
        publicBgpIndex: 0,
        locatorName: v.locatorName,
        sidPrefix: v.sidPrefix,
        wanName: v.wanDev,
        wanIpv4: v.wanIpv4,
        wanIpv6: v.wanIpv6,
        wanRouteDest: v.wanRouteDest,
        wanRoutePriority: v.wanRoutePriority,
        ipv6Dest: v.ipv6Dest,
        ipv6Via: v.ipv6Via,
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
    
    return sortJsonKeys(cfg);
  };

  const watchedValues = Form.useWatch([], form);
  const configPreview = useMemo(
    () => buildConfigFromValues(watchedValues || form.getFieldsValue(true) || {}),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [watchedValues, form],
  );

  const next = async () => {
    try { await form.validateFields(); setCurrent((c) => Math.min(2, c + 1)); } catch {}
  };
  const prev = () => setCurrent((c) => Math.max(0, c - 1));

  /** 点击左侧步骤：后退不校验；前进需通过校验，避免绕过「下一步」直达确认页 */
  const handleStepsChange = async (idx: number) => {
    if (idx === current) return;
    if (idx < current) {
      setCurrent(idx);
      return;
    }
    try {
      await form.validateFields();
      setCurrent(idx);
    } catch {
      /* 保留在当前步 */
    }
  };

  const handleDispatch = async () => {
    if (!uuid) {
      message.error('缺少 VR 的 UUID，无法下发配置');
      return;
    }
    try {
      await form.validateFields();
    } catch {
      message.warning('请先修正表单校验错误后再下发');
      return;
    }
    try {
      setLoading(true);
      const values = form.getFieldsValue(true);
      const cfg = buildConfigFromValues(values);
      if (uuid) cfg.uuid = uuid;
      
      // 1. 同步保存到本地数据库（专家模式数据源）
      try {
        await saveVRConfig(uuid, cfg);
        await setVRRole(uuid, 'PE');
      } catch (e) {
        console.warn('保存到本地数据库失败（仅影响专家模式回读，不影响下发）:', e);
      }

      const method = 'POST';
      const other = `uuid=${uuid}`;
      const path = '/V2/ctcontrol/VR2/VRConfig';
      const data = await proxyApiRequest(path, method, other, cfg);
      if (data && typeof data.code === 'number' && data.code !== 200) {
        throw new Error(data?.msg || `下发失败: ${JSON.stringify(data)}`);
      }
      message.success('配置已下发到设备');
    } catch (e: any) {
      message.error(e?.message || '下发失败');
    } finally {
      setLoading(false);
    }
  };

  /** 确认页展示：空则「-」，不用常数冒充有值 */
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
          <div style={{ fontSize: 13, color: '#1677ff', margin: '4px 0 12px 0', borderBottom: '1px solid #e8e8e8', paddingBottom: 6 }}>设定SRv6标识</div>
          <Form.Item name="locatorName" label={<span style={{ fontSize: 13, color: '#595959' }}>SRv6 Locator 名称</span>}> 
            <Input placeholder="例如：default" />
          </Form.Item>
          <Form.Item
            name="sidPrefix"
            label={<span style={{ fontSize: 13, color: '#595959' }}>SRv6 SID 前缀</span>}
            rules={[
              {
                validator: (_, value) => {
                  const s = String(value ?? '').trim();
                  if (!s) return Promise.resolve();
                  if (s.includes('/')) return Promise.reject(new Error('SID 前缀不允许包含/掩码，请只填写地址部分'));
                  return Promise.resolve();
                },
              },
            ]}
          >
            <Input placeholder="例如：2400:1234::1（不含 /xx）" />
          </Form.Item>
          <div style={{ fontSize: 13, color: '#1677ff', margin: '4px 0 12px 0', borderBottom: '1px solid #e8e8e8', paddingBottom: 6 }}>设定公网口</div>
          <Form.Item name="wanDev" label={<span style={{ fontSize: 13, color: '#595959' }}>公网口设备</span>} rules={[{ required: true, message: '请选择公网口设备' }]}> 
            <Select
              placeholder="请选择网卡"
              showSearch
              loading={ifaceLoading}
              options={peWanIfaceSelectOptions}
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
          <Form.Item name="wanIpv4" label={<span style={{ fontSize: 13, color: '#595959' }}>公网口 IPv4 地址</span>}>
            <Input placeholder="例如：200.1.1.2/24（可选）" />
          </Form.Item>
          <Form.Item
            name="wanIpv6"
            label={<span style={{ fontSize: 13, color: '#595959' }}>公网口 IPv6 地址</span>}
            rules={[
              { required: true, message: '请输入公网口 IPv6 地址（必须带掩码）' },
              { pattern: /^[0-9a-fA-F:]+\/([0-9]|[1-9]\d|1[01]\d|12[0-8])$/, message: '格式示例：2408:3333:1002::1/64（必须是 IPv6 且带掩码）' },
            ]}
          >
            <Input placeholder="例如：2408:3333:1002::1/64（必填）" />
          </Form.Item>
          <div style={{ height: 12 }} />
          <div style={{ fontSize: 13, color: '#1677ff', margin: '4px 0 12px 0', borderBottom: '1px solid #e8e8e8', paddingBottom: 6 }}>公网 BGP（PE to PE）</div>
          <Form.Item name="bgpAsn" label={<span style={{ fontSize: 13, color: '#595959' }}>ASN</span>} rules={[{ required: true, message: '请输入公网 BGP ASN' }]}>
            <InputNumber style={{ width: '100%' }} min={1} placeholder="例如：100" />
          </Form.Item>
          <Form.Item name="bgpRouterId" label={<span style={{ fontSize: 13, color: '#595959' }}>Router-ID</span>} rules={[{ required: true, message: '请输入公网 BGP Router-ID' }]}>
            <Input placeholder="例如：200.1.1.2" />
          </Form.Item>
          <div style={{ height: 12 }} />
          <div style={{ fontSize: 13, color: '#1677ff', margin: '4px 0 12px 0', borderBottom: '1px solid #e8e8e8', paddingBottom: 6 }}>设定静态路由</div>
          <Form.Item name="wanRouteDest" label={<span style={{ fontSize: 13, color: '#595959' }}>默认路由目的</span>}>
            <Input placeholder="例如：0.0.0.0/0" />
          </Form.Item>
          <Form.Item name="wanRoutePriority" label={<span style={{ fontSize: 13, color: '#595959' }}>路由优先级</span>}> 
            <InputNumber style={{ width: '100%' }} placeholder="例如：100" />
          </Form.Item>
          <Form.Item
            name="ipv6Dest"
            label={<span style={{ fontSize: 13, color: '#595959' }}>IPv6 静态路由目的</span>}
            rules={[
              { required: true, message: '请输入 IPv6 静态路由目的（必须带掩码）' },
              { pattern: /^[0-9a-fA-F:]+\/([0-9]|[1-9]\d|1[01]\d|12[0-8])$/, message: '格式示例：2408:3333:1002::/64（必须是 IPv6 且带掩码）' },
            ]}
          >
            <Input placeholder="例如：2408:3333:1002::/64（必须带掩码）" />
          </Form.Item>
          <Form.Item name="ipv6Via" label={<span style={{ fontSize: 13, color: '#595959' }}>IPv6 静态路由 next-hop</span>}>
            <Input placeholder="例如：500::1" />
          </Form.Item>
        </div>

        {/* Step 2 Content */}
        <div style={{ display: current === 1 ? 'block' : 'none' }}>
          <div style={{ fontSize: 13, color: '#1677ff', margin: '4px 0 12px 0', borderBottom: '1px solid #e8e8e8', paddingBottom: 6 }}>内网配置（PE to CE）</div>
          <Form.List name="lanConfigs" initialValue={[{}]}> 
            {(fields) => {
              const items = fields.map((field, idx) => ({
                key: String(field.name),
                label: `内网配置组 #${idx + 1}`,
                children: (
                  <div>
                    <Form.Item {...field} name={[field.name, 'vrf']} label={<span style={{ fontSize: 13, color: '#595959' }}>网络切片（VRF ID）</span>} rules={[{ type: 'number', min: 4001, message: 'VRF ID 必须大于等于 4001' }]}> 
                      <InputNumber style={{ width: '100%' }} placeholder={"例如：9999 (4001+)"} min={4001} />
                    </Form.Item>
                    <Form.Item {...field} name={[field.name, 'ifName']} label={<span style={{ fontSize: 13, color: '#595959' }}>接口名称</span>}> 
                      <Select
                        placeholder="请选择网卡"
                        showSearch
                        loading={ifaceLoading}
                        options={ifaceOptions.map((n) => ({ value: n, label: peLanIfaceSelectLabel(n, idx) }))}
                        filterOption={(input: string, option?: { value?: string }) =>
                          String(option?.value || '')
                            .toLowerCase()
                            .includes(input.toLowerCase())
                        }
                      />
                    </Form.Item>
                    <Form.Item {...field} name={[field.name, 'ipv4']} label={<span style={{ fontSize: 13, color: '#595959' }}>IPv4 地址/掩码</span>}>
                      <Input placeholder="例如：130.1.1.1/24（可选）" />
                    </Form.Item>
                    <Form.Item {...field} name={[field.name, 'ipv6']} label={<span style={{ fontSize: 13, color: '#595959' }}>IPv6 地址/掩码</span>}> 
                      <Input placeholder="例如：2408:3333:1002::1/64" />
                    </Form.Item>
                    <div style={{ height: 12 }} />
                    <div style={{ fontSize: 13, color: '#1677ff', margin: '4px 0 12px 0', borderBottom: '1px solid #e8e8e8', paddingBottom: 6 }}>设定BGP路由</div>
                    <Form.Item {...field} name={[field.name, 'asn']} label={<span style={{ fontSize: 13, color: '#595959' }}>BGP ASN</span>}> 
                      <InputNumber style={{ width: '100%' }} placeholder="例如：100" />
                    </Form.Item>
                    <Form.Item {...field} name={[field.name, 'routerId']} label={<span style={{ fontSize: 13, color: '#595959' }}>BGP Router-ID</span>}> 
                      <Input placeholder="例如：130.1.1.1" />
                    </Form.Item>
                  </div>
                ),
              }));
              return (
                <Tabs
                  type="card"
                  items={items}
                  tabBarGutter={8}
                  size="small"
                  activeKey={activeLanTabKey ?? (items.length ? String(0) : undefined)}
                  onChange={(key) => {
                    setActiveLanTabKey(String(key));
                  }}
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
            <Descriptions.Item label="公网口设备">{values.wanDev || '-'}</Descriptions.Item>
            <Descriptions.Item label="默认路由目的">{previewStr(values.wanRouteDest)}</Descriptions.Item>
            <Descriptions.Item label="路由优先级">{previewNum(values.wanRoutePriority)}</Descriptions.Item>
            <Descriptions.Item label="公网口 IPv4">{previewStr(values.wanIpv4)}</Descriptions.Item>
            <Descriptions.Item label="公网口 IPv6">{previewStr(values.wanIpv6)}</Descriptions.Item>
            <Descriptions.Item label="公网 BGP ASN">{previewNum(values.bgpAsn)}</Descriptions.Item>
            <Descriptions.Item label="公网 BGP Router-ID">{previewStr(values.bgpRouterId)}</Descriptions.Item>
            <Descriptions.Item label="IPv6 路由目的">{previewStr(values.ipv6Dest)}</Descriptions.Item>
            <Descriptions.Item label="IPv6 next-hop">{previewStr(values.ipv6Via)}</Descriptions.Item>
          </Descriptions>
          {(values.lanConfigs || []).map((lan: any, idx: number) => (
            <div key={idx} style={{ marginTop: 12 }}>
              <div style={{ fontSize: 13, color: '#1677ff', margin: '4px 0 8px 0', borderBottom: '1px solid #e8e8e8', paddingBottom: 6 }}>内网配置 #{idx + 1}</div>
              <Descriptions column={1} bordered size="small">
                <Descriptions.Item label="VRF ID">{lan.vrf || '-'}</Descriptions.Item>
                <Descriptions.Item label="接口名称">{lan.ifName || '-'}</Descriptions.Item>
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
            <Steps direction="vertical" size="small" current={current} onChange={handleStepsChange} items={[{ title: '公网配置（PE to PE）' }, { title: '内网配置（PE to CE）' }, { title: '确认下发' }]} />
          </Card>
        </Col>
        <Col span={7}>
          <Card size="small" title={<span style={{ fontSize: 13, color: '#000', fontWeight: 400 }}>
            {`第 ${current + 1} 步：${['公网配置（PE to PE）','内网配置（PE to CE）','确认下发'][current]} 设备回读`}
          </span>} variant="outlined">
            {ifaceLoading ? (
              <div style={{ textAlign: 'center', padding: '32px 0' }}>
                <Spin />
              </div>
            ) : csmctlCfg ? (
              <Form layout="vertical" form={mirrorForm} disabled>
                {current === 0 && (
                  <>
                    <div style={{ fontSize: 13, color: '#1677ff', margin: '4px 0 12px 0', borderBottom: '1px solid #e8e8e8', paddingBottom: 6 }}>设定SRv6标识</div>
                    <Form.Item name="locatorName" label={<span style={{ fontSize: 13, color: '#595959' }}>SRv6 Locator 名称</span>}> 
                      <Input placeholder="未配置" />
                    </Form.Item>
                    <Form.Item name="sidPrefix" label={<span style={{ fontSize: 13, color: '#595959' }}>SRv6 SID 前缀</span>}>
                      <Input placeholder="未配置" />
                    </Form.Item>
                    <div style={{ fontSize: 13, color: '#1677ff', margin: '4px 0 12px 0', borderBottom: '1px solid #e8e8e8', paddingBottom: 6 }}>设定公网口</div>
                    <Form.Item name="wanDev" label={<span style={{ fontSize: 13, color: '#595959' }}>公网口设备</span>}> 
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
                    <Form.Item name="wanIpv4" label={<span style={{ fontSize: 13, color: '#595959' }}>公网口 IPv4 地址</span>}>
                      <Input placeholder="未配置" />
                    </Form.Item>
                    <Form.Item name="wanIpv6" label={<span style={{ fontSize: 13, color: '#595959' }}>公网口 IPv6 地址</span>}>
                      <Input placeholder="未配置" />
                    </Form.Item>
                    <div style={{ height: 12 }} />
                    <div style={{ fontSize: 13, color: '#1677ff', margin: '4px 0 12px 0', borderBottom: '1px solid #e8e8e8', paddingBottom: 6 }}>公网 BGP（PE to PE）</div>
                    <Form.Item name="bgpAsn" label={<span style={{ fontSize: 13, color: '#595959' }}>ASN</span>}>
                      <InputNumber style={{ width: '100%' }} placeholder="未配置" />
                    </Form.Item>
                    <Form.Item name="bgpRouterId" label={<span style={{ fontSize: 13, color: '#595959' }}>Router-ID</span>}>
                      <Input placeholder="未配置" />
                    </Form.Item>
                    <div style={{ height: 12 }} />
                    <div style={{ fontSize: 13, color: '#1677ff', margin: '4px 0 12px 0', borderBottom: '1px solid #e8e8e8', paddingBottom: 6 }}>设定静态路由</div>
                    <Form.Item name="wanRouteDest" label={<span style={{ fontSize: 13, color: '#595959' }}>默认路由目的</span>}>
                      <Input placeholder="未配置" />
                    </Form.Item>
                    <Form.Item name="wanRoutePriority" label={<span style={{ fontSize: 13, color: '#595959' }}>路由优先级</span>}> 
                      <InputNumber style={{ width: '100%' }} placeholder="未配置" />
                    </Form.Item>
                    <Form.Item name="ipv6Dest" label={<span style={{ fontSize: 13, color: '#595959' }}>IPv6 静态路由目的</span>}> 
                      <Input placeholder="未配置" />
                    </Form.Item>
                    <Form.Item name="ipv6Via" label={<span style={{ fontSize: 13, color: '#595959' }}>IPv6 静态路由 next-hop</span>}> 
                      <Input placeholder="未配置" />
                    </Form.Item>
                  </>
                )}
                {current === 1 && (
                  <>
                    <div style={{ fontSize: 13, color: '#1677ff', margin: '4px 0 12px 0', borderBottom: '1px solid #e8e8e8', paddingBottom: 6 }}>内网配置（PE to CE）</div>
                    <Tabs
                      type="card"
                      items={(() => {
                        const groups: any[] = mirrorForm.getFieldValue('lanConfigs') || [{}];
                        return groups.map((g, idx) => ({
                          key: String(idx),
                          label: `内网配置组 #${idx + 1}`,
                          children: (
                            <div>
                              <Form.Item name={['lanConfigs', idx, 'vrf']} label={<span style={{ fontSize: 13, color: '#595959' }}>网络切片（VRF ID）</span>}> 
                                <InputNumber style={{ width: '100%' }} placeholder={"未配置"} />
                              </Form.Item>
                              <Form.Item name={['lanConfigs', idx, 'ifName']} label={<span style={{ fontSize: 13, color: '#595959' }}>接口名称</span>}> 
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
                              <div style={{ fontSize: 13, color: '#1677ff', margin: '4px 0 12px 0', borderBottom: '1px solid #e8e8e8', paddingBottom: 6 }}>设定BGP路由</div>
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
                      <Descriptions.Item label="公网口设备">{previewStr(mirrorForm.getFieldValue('wanDev'))}</Descriptions.Item>
                      <Descriptions.Item label="默认路由目的">{previewStr(mirrorForm.getFieldValue('wanRouteDest'))}</Descriptions.Item>
                      <Descriptions.Item label="路由优先级">{previewNum(mirrorForm.getFieldValue('wanRoutePriority'))}</Descriptions.Item>
                      <Descriptions.Item label="公网口 IPv4">{previewStr(mirrorForm.getFieldValue('wanIpv4'))}</Descriptions.Item>
                      <Descriptions.Item label="公网口 IPv6">{previewStr(mirrorForm.getFieldValue('wanIpv6'))}</Descriptions.Item>
                      <Descriptions.Item label="公网 BGP ASN">{previewNum(mirrorForm.getFieldValue('bgpAsn'))}</Descriptions.Item>
                      <Descriptions.Item label="公网 BGP Router-ID">{previewStr(mirrorForm.getFieldValue('bgpRouterId'))}</Descriptions.Item>
                      <Descriptions.Item label="IPv6 路由目的">{previewStr(mirrorForm.getFieldValue('ipv6Dest'))}</Descriptions.Item>
                      <Descriptions.Item label="IPv6 next-hop">{previewStr(mirrorForm.getFieldValue('ipv6Via'))}</Descriptions.Item>
                    </Descriptions>
                    {(mirrorForm.getFieldValue('lanConfigs') || []).map((lan: any, idx: number) => (
                      <div key={idx} style={{ marginTop: 12 }}>
                        <div style={{ fontSize: 13, color: '#1677ff', margin: '4px 0 8px 0', borderBottom: '1px solid #e8e8e8', paddingBottom: 6 }}>内网配置回读 #{idx + 1}</div>
                        <Descriptions column={1} bordered size="small">
                          <Descriptions.Item label="VRF ID">{lan.vrf || '-'}</Descriptions.Item>
                          <Descriptions.Item label="接口名称">{lan.ifName || '-'}</Descriptions.Item>
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
                未获取到设备配置（设备回读为空）
              </div>
            )}
          </Card>
        </Col>
        <Col span={8}>
          <Card size="small" title={<span style={{ fontSize: 13, color: '#000', fontWeight: 400 }}>
            {`第 ${current + 1} 步：${['公网配置（PE to PE）','内网配置（PE to CE）','确认下发'][current]} 配置编辑`}
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
