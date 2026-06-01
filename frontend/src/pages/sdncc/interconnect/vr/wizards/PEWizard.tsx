import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, Card, Descriptions, Form, Input, InputNumber, Space, Steps, message, Row, Col, Select, Tabs, Spin, Modal, Checkbox } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { useNavigate, useParams } from 'react-router-dom';
import PageContainer from '../../../../../components/PageContainer';
import { getVRConfig, saveVRConfig, setVRRole, fetchVrCacheMerged } from '../../../../../services/virtualRouterApi';
import { proxyApiRequest } from '../../../../../services/api';
import { collectIfaceNamesForSelect, pickDeviceBlobForLookup } from '../vrMergedHelpers';
import { renderIfaceWizardSelectLabel } from '../vrWizardIfaceSelect';

/** å¹³å°å·²å­? peï¼?å?¬ç½?ä¾§å??æ?°æ®ï¼?æ?°ï¼?pe.publicConfigï¼?æ?§ï¼?æ?å¹³å­?æ®µï¼? */
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

/** å??ç½?ç»?å??è¡¨ï¼?æ?° pe.lanConfigï¼?æ?§ pe.lanConfigsï¼?æ?¾è¯¯å??ä¸º pe.LanConfig ç??ä¹?å?¼å®¹ */
function readLanListFromPe(pe: any): any[] {
  if (!pe || typeof pe !== 'object') return [];
  if (Array.isArray((pe as any).lanConfig)) return (pe as any).lanConfig;
  if (Array.isArray((pe as any).LanConfig)) return (pe as any).LanConfig;
  if (Array.isArray((pe as any).lanConfigs)) return (pe as any).lanConfigs;
  return [];
}

/** å?¬ç½? BGPï¼?PEâ??PEï¼?å??æ?°æ®ï¼?å?¼å®¹æ?§ç??é¡¶å±? bgpAsn / bgpRouterId */
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

/** å¹³å°å·²å­? lanConfig / lanConfigs ä¸?è¡? â?? è¡¨å?å??ç½?ç»?ï¼?å?¼å®¹ lanBgp ä¸?æ?§å­?æ®µ bgpAsnç­?ï¼? */
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
  /** è?å?æ?¥å£ä¸­ç?? vr3_infoï¼?ä»?ç?¨æ?·ä¸»å?¨æ?¹å?¬ç½?å£ Select æ?¶ç?¨å?¶è·? IPï¼?æ?¥å£æ?å¨ï¼? */
  const [vr3Info, setVr3Info] = useState<any | null>(null);
  const [activeLanTabKey, setActiveLanTabKey] = useState<string>('0');
  const [confirmOpen, setConfirmOpen] = useState<boolean>(false);
  const [confirmChecked, setConfirmChecked] = useState<boolean>(false);
  /** ç?¨æ?·ç?¹å?»ã??å?·æ?°è®¾å¤?å??è¯»ã?å?ä»?ä¸?ä¸?å¸§å?å¹¶é??è·³è¿?å¯¹å³ç¿¼ form ç??è¦?ç??ï¼?å·¦ç¿¼ mirror ä»æ?´æ?° */
  const skipEditFormOnNextDeviceReadRef = useRef(false);

  const watchWanDev = Form.useWatch('wanDev', form);
  const watchLanConfigs = Form.useWatch('lanConfigs', form);

  const peWanIfaceSelectOptions = useMemo(() => {
    const rows = Array.isArray(watchLanConfigs) ? watchLanConfigs : [];
    return ifaceOptions.map((n) => {
      const hits: string[] = [];
      rows.forEach((row: any, i: number) => {
        const ifn = String(row?.ifName || '').trim();
        if (ifn && ifn === n) hits.push(`å??ç½?ç»?#${i + 1}`);
      });
      return {
        value: n,
        label: renderIfaceWizardSelectLabel(n, hits.length ? hits.join('ã?') : undefined),
      };
    });
  }, [ifaceOptions, watchLanConfigs]);

  const peLanIfaceSelectLabel = useCallback(
    (iface: string, rowIndex: number) => {
      const wan = String(watchWanDev || '').trim();
      if (wan && iface === wan) return renderIfaceWizardSelectLabel(iface, 'å?¬ç½?å£');
      const rows = Array.isArray(watchLanConfigs) ? watchLanConfigs : [];
      const hits: string[] = [];
      rows.forEach((row: any, i: number) => {
        if (i === rowIndex) return;
        const ifn = String(row?.ifName || '').trim();
        if (ifn && ifn === iface) hits.push(`å??ç½?ç»?#${i + 1}`);
      });
      return renderIfaceWizardSelectLabel(iface, hits.length ? hits.join('ã?') : undefined);
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
  /** ? IPv6 ???????????????fe80:: ??????????????? */
  const filterLinkLocal = (raw: string): string => {
    const s = String(raw ?? '').trim();
    const parts = s.split(/\s+/).filter(Boolean);
    const global = parts.find((p) => !p.toLowerCase().startsWith('fe80'));
    return global ?? '';
  };

  const pickIfaceIpv6 = (iface: any) =>
    filterLinkLocal(
      iface?.ipv6_static ??
        iface?.ipv6Static ??
        iface?.ipv6 ??
        iface?.ipv6_address ??
        iface?.ipv6Address ??
        '',
    );

  /** å?¬ç½?å£ IPv4/IPv6 ä»?å?è®¸ç?¨ VR3 å??å¡«ï¼?æ? å??ç½®ç©ºã?? */
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
  /** å?¬ç½?å£åæ?ªå?ã?ä»? vr3 å? å?·æ?°è¢«æ?¿æ¢æ?¶ï¼?ä¸è¦?ç?? wanIpv4/6 */
  const prevVr3InfoForPeWanRef = useRef<any>(null);

  useEffect(() => {
    hadVr3InfoRef.current = false;
    prevWanDevRef.current = undefined;
    prevVr3InfoForPeWanRef.current = null;
    skipEditFormOnNextDeviceReadRef.current = false;
  }, [uuid]);

  /** è?å? /api/vr-instances/:uuidï¼?å?¬ç½?å£ç½?å¡ IP ä»? VR3 å??å¡« */
  const fetchInterfaces = useCallback(async (silent = false) => {
    if (!uuid) return;
    setIfaceLoading(true);
    try {
      const merged = await fetchVrCacheMerged(uuid);
      if (!merged || typeof merged !== 'object') {
        if (!silent) message.warning('æ?ªè?·å?å?°è?å?æ?°æ®ï¼?è¯·å??å?æ­¥ VR ç¼?å­?');
        setCsmctlCfg(null);
        setVr3Info(null);
        return;
      }
      let savedCfg: any = {};
      try {
        savedCfg = (await getVRConfig(uuid)) || {};
      } catch (e) {
        console.warn('è?·å?æ?¬å?°é?ç½®å¤±è´¥', e);
      }
      if (!silent) {
        skipEditFormOnNextDeviceReadRef.current = true;
      }
      const unique = collectIfaceNamesForSelect(merged as Record<string, any>);
      if (unique.length) setIfaceOptions(unique);
      setCsmctlCfg(pickDeviceBlobForLookup(merged));
      setVr3Info(merged.vr3_info && typeof merged.vr3_info === 'object' ? merged.vr3_info : null);
      setExistingCfg(savedCfg);
      if (!silent) message.success('è®¾å¤?æ?°æ®å·²å?·æ?°');
    } catch (err) {
      console.warn('[PEWizard] fetchVrCacheMerged:', (err as any)?.message || err);
      if (!silent) message.error('å?·æ?°å¤±è´¥');
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

    // vr2_info ä¸º null/undefined æ?¶ csmctlCfg ä¸ºç©ºï¼?ä¸è?½ä»?è®¾å¤?æ?¨æ?­ï¼?ä½?ä»åº?å??å¡« Tower å·²ä¿å­?ç?? pe å??æ?°æ®
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

    // å³ç¿¼ç¼?è¾?ï¼?vr2 æ?  ipv4_route/ipv6_route æ?¶ï¼?ä¸?é¢è·¯ç?±å­?æ®µä¸ºå?å¯¼å??ç½®é»?è®¤å?¼ï¼?å¹¶é?è®¾å¤?å??è¯»
    const inferredTop = {
      locatorName: (dev as any)?.segment_routing_srv6?.locator,
      sidPrefix: (dev as any)?.segment_routing_srv6?.prefix,
      wanDev: wanDevCandidate,
      wanIpv4: v4Wan || undefined,
      wanIpv6: v6Wan || undefined,
      wanRouteDest: ipv4RouteTop?.destination || '0.0.0.0/0',
      wanRoutePriority: ipv4RouteTop?.priority ?? 100,
      // æ³¨æ?ï¼?IPv6 é»?è®¤è·¯ç?±åº?ä¸º ::/0ï¼?0::0/0 ä¸æ?¯å?æ³? IPv6 å?ç¼?å??æ³?ï¼?ä¼?è§¦å?æ?§å?¶å?¨æ ¡éª?é??è¯¯ï¼?
      ipv6Dest: (() => {
        const raw = String(ipv6RouteTop?.destination || '').trim();
        if (!raw) return '::/0';
        if (raw.includes('/')) return raw;
        // è®¾å¤?ä¾§è?¥å??è¯»æ?ªå¸¦æ?©ç ï¼?æ??å?å?°å?è¡¥ /128ï¼?é¿å?ä¸?å?æ?¶æ?¥é??
        return `${raw}/128`;
      })(),
      ipv6Via: ipv6RouteTop?.via || '500::1',
      bgpAsn: bgpTop?.asn,
      bgpRouterId: bgpTop?.router_id,
      bgpNetworkIpv4: nets4,
      bgpNetworkIpv6: nets6,
    };

    // å·¦ç¿¼ã??è®¾å¤?å??è¯»ã?ï¼?å­?æ®µå?¨é?¨ä»?æ¥è?ª vr2_infoï¼?devï¼?ï¼?ä¸ spread å³ç¿¼æ?¨æ?­ï¼?é¿å?æ??å?å¯¼é»?è®¤å?¼å½?æ?è®¾å¤?æ?°æ®ï¼?
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
    // é¡¶å±? interfaces[]ï¼?VR3/å?å¹¶æ?¥å£å¸¸è§ï¼?ä¸? interfaces_XXX å??æ¡¶å¹¶å­?
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

    // æ? å??ç½?ç»?æ?¶ï¼?å³ç¿¼ç»? [{}] ä¾¿äº?ç¼?è¾?ï¼?å·¦ç¿¼å?æ ·ç»? [{}] ä»?ä½?å¸?å±?å ä½ï¼?å­?æ®µå?¨ç©ºï¼?ä¸è¡¨ç¤º vr2 æ??æ?°æ®ï¼?
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
    
    // é??å½?å¤?ç?å­å¯¹è±¡ï¼?æ·±å±?æ??åºï¼?
    const copy = { ...obj };
    Object.keys(copy).forEach(k => {
      copy[k] = sortJsonKeys(copy[k]);
    });

    // å¯¹æ??å¤?å±?è¿?è¡?æ??åºï¼?uuid, role, pe ä¼?å??
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
    // IPv6 CIDRï¼?å®½æ¾æ ¡éª?ï¼?äº¤ç»?æ?§å?¶å?¨å?æ??ç»?æ ¡éª?ï¼?ï¼?è¿?é??åªä¿è¯â??å? IPv6 ä¸?å¸¦æ?©ç â?
    // ä¾?å¦?ï¼?2408:3333:1002::/64ã?::1/128ã?::/0
    const ipv6CidrPattern = /^[0-9a-fA-F:]+\/([0-9]|[1-9]\d|1[01]\d|12[0-8])$/;
    const normalizeIPv4Cidr = (s: any) => {
      const t = String(s || '').trim();
      return ipv4CidrPattern.test(t) ? t : undefined;
    };
    const normalizeIPv6Cidr = (s: any) => {
      const t = String(s || '').trim();
      if (!t) return undefined;
      // å¿«é??æ??é?¤ IPv4
      if (t.includes('.')) return undefined;
      // å?è®¸ ::/0 ç­?å?æ³?å?ç¼?ï¼?ç®?å??æ ¡éª?ï¼?
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
    // å?ºå®?ç??æ? IPv6 é?æ?è·¯ç?±ï¼?å±?ç¤ºä½?ä¸å¯ç¼?è¾?ï¼?
    {
      const v6dest = String(v?.ipv6Dest || '').trim();
      const v6via = String(v?.ipv6Via || '500::1').trim();
      const dest = normalizeIPv6Cidr(v6dest);
      if (dest) {
        const route6: any = { destination: dest };
        if (v6via) route6.via = v6via;
        // ä¸? pe2 ä¸?å®¶ä¸?è?´ï¼?ä¸å?? priorityï¼?æ­¤ä¸ºå?¬ç½?ä¾§ IPv6 é?æ?è·¯ç?±ï¼?ä¸å?? vrfï¼?é¿å?è¯¯æ??å?°å??ç?? VRFï¼?
        cfg.ipv6_route = [route6];
      }
    }
    if (vrfSet.size > 0) {
      cfg.vrf = Array.from(vrfSet);
    }
    if (groups.length) {
      const bgpArr: any[] = [];
      // 1. ä¼?å??ä¿ç??ç?°æ??ç?? Global BGP é?ç½®ï¼?VRF ä¸ºç©ºæ?? 0 ç??ï¼?
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
      // 2. è¿½å?  LAN ä¾§ç?? VRF BGP é?ç½®
      groups.forEach((g) => {
        if (g?.asn || g?.routerId) {
          const vrfNum = g?.vrf != null && String(g.vrf).trim() !== '' ? Number(g.vrf) : undefined;
          const enableAutoSid = Number.isFinite(vrfNum as any) && (vrfNum as number) >= 4001;
          const asnRaw = Number(g?.asn);
          const asn = Number.isFinite(asnRaw) ? asnRaw : undefined;
          bgpArr.push({
            ...(asn != null ? { asn } : {}),
            ...(enableAutoSid ? { vrf: vrfNum } : {}), // æ²¡æ??ç§ç½? VRF æ?¶ä¸è¦ä¸?å? vrfï¼?é¿å?è¢«å½?ä½?ç§ç½?ç­?ç?¥
            router_id: g?.routerId,
            bgp_ebgp_requires_policy: 'disable',
            address_family: [
              {
                address_family: 'ipv4',
                modifiler: 'unicast',
                export_route: 'enable',
                import_route: 'enable',
                // æ?§å?¶å?¨çº¦æ?ï¼?auto_assign_sid åªè?½å?¨â??ç§ç½?ï¼?VRFï¼?â?ä¸?å¼?å¯
                ...(enableAutoSid ? { auto_assign_sid: 'enable' } : { auto_assign_sid: 'disable' }),
              },
            ],
          });
        }
      });
      if (bgpArr.length) {
        // ä¸? pe2 ä¸?å®¶ä¸?è?´ï¼?å?¬ç½? BGPï¼?æ?  vrfï¼?å??åµ? segment_routing_srv6ï¼?å??å?¥å?¬ç½? ASN / router_idï¼?ç¬¬ä¸?æ­¥è¡¨å?ï¼?
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

  /** ç?¹å?»å·¦ä¾§æ­¥éª¤ï¼?å?é??ä¸æ ¡éª?ï¼?å?è¿?é??é??è¿?æ ¡éª?ï¼?é¿å?ç»?è¿?ã??ä¸?ä¸?æ­¥ã?ç?´è¾¾ç¡®è®¤é¡µ */
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
      /* ä¿ç??å?¨å½?å?æ­¥ */
    }
  };

  const handleDispatch = async () => {
    if (!uuid) {
      message.error('ç¼ºå°? VR ç?? UUIDï¼?æ? æ³?ä¸?å?é?ç½®');
      return;
    }
    try {
      await form.validateFields();
    } catch {
      message.warning('è¯·å??ä¿®æ­£è¡¨å?æ ¡éª?é??è¯¯å?å?ä¸?å?');
      return;
    }
    try {
      setLoading(true);
      const values = form.getFieldsValue(true);
      const cfg = buildConfigFromValues(values);
      if (uuid) cfg.uuid = uuid;
      
      // 1. å?æ­¥ä¿å­?å?°æ?¬å?°æ?°æ®åº?ï¼?ä¸?å®¶æ¨¡å¼æ?°æ®æºï¼?
      try {
        await saveVRConfig(uuid, cfg);
        await setVRRole(uuid, 'PE');
      } catch (e) {
        console.warn('ä¿å­?å?°æ?¬å?°æ?°æ®åº?å¤±è´¥ï¼?ä»?å½±å?ä¸?å®¶æ¨¡å¼å??è¯»ï¼?ä¸å½±å?ä¸?å?ï¼?:', e);
      }

      const method = 'POST';
      const other = `uuid=${uuid}`;
      const path = '/V2/ctcontrol/VR2/VRConfig';
      const data = await proxyApiRequest(path, method, other, cfg);
      if (data && typeof data.code === 'number' && data.code !== 200) {
        throw new Error(data?.msg || `ä¸?å?å¤±è´¥: ${JSON.stringify(data)}`);
      }
      message.success('é?ç½®å·²ä¸?å?å?°è®¾å¤?');
    } catch (e: any) {
      message.error(e?.message || 'ä¸?å?å¤±è´¥');
    } finally {
      setLoading(false);
    }
  };

  /** ç¡®è®¤é¡µå±?ç¤ºï¼?ç©ºå??ã??-ã?ï¼?ä¸ç?¨å¸¸æ?°å??å??æ??å?¼ */
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
          <div style={{ fontSize: 13, color: '#1677ff', margin: '4px 0 12px 0', borderBottom: '1px solid #e8e8e8', paddingBottom: 6 }}>è®¾å®?SRv6æ ?è¯?</div>
          <Form.Item name="locatorName" label={<span style={{ fontSize: 13, color: '#595959' }}>SRv6 Locator åç§°</span>}> 
            <Input placeholder="ä¾?å¦?ï¼?default" />
          </Form.Item>
          <Form.Item
            name="sidPrefix"
            label={<span style={{ fontSize: 13, color: '#595959' }}>SRv6 SID å?ç¼?</span>}
            rules={[
              {
                validator: (_, value) => {
                  const s = String(value ?? '').trim();
                  if (!s) return Promise.resolve();
                  if (s.includes('/')) return Promise.reject(new Error('SID å?ç¼?ä¸å?è®¸å??å«/æ?©ç ï¼?è¯·åªå¡«å??å?°å?é?¨å??'));
                  return Promise.resolve();
                },
              },
            ]}
          >
            <Input placeholder="ä¾?å¦?ï¼?2400:1234::1ï¼?ä¸å« /xxï¼?" />
          </Form.Item>
          <div style={{ fontSize: 13, color: '#1677ff', margin: '4px 0 12px 0', borderBottom: '1px solid #e8e8e8', paddingBottom: 6 }}>è®¾å®?å?¬ç½?å£</div>
          <Form.Item name="wanDev" label={<span style={{ fontSize: 13, color: '#595959' }}>å?¬ç½?å£è®¾å¤?</span>} rules={[{ required: true, message: 'è¯·é??æ?©å?¬ç½?å£è®¾å¤?' }]}> 
            <Select
              placeholder="è¯·é??æ?©ç½?å¡"
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
          <Form.Item name="wanIpv4" label={<span style={{ fontSize: 13, color: '#595959' }}>å?¬ç½?å£ IPv4 å?°å?</span>}>
            <Input placeholder="ä¾?å¦?ï¼?200.1.1.2/24ï¼?å¯é??ï¼?" />
          </Form.Item>
          <Form.Item
            name="wanIpv6"
            label={<span style={{ fontSize: 13, color: '#595959' }}>å?¬ç½?å£ IPv6 å?°å?</span>}
            rules={[
              { required: true, message: 'è¯·è¾?å?¥å?¬ç½?å£ IPv6 å?°å?ï¼?å¿?é¡»å¸¦æ?©ç ï¼?' },
              { pattern: /^[0-9a-fA-F:]+\/([0-9]|[1-9]\d|1[01]\d|12[0-8])$/, message: 'æ ¼å¼ç¤ºä¾?ï¼?2408:3333:1002::1/64ï¼?å¿?é¡»æ?¯ IPv6 ä¸?å¸¦æ?©ç ï¼?' },
            ]}
          >
            <Input placeholder="ä¾?å¦?ï¼?2408:3333:1002::1/64ï¼?å¿?å¡«ï¼?" />
          </Form.Item>
          <div style={{ height: 12 }} />
          <div style={{ fontSize: 13, color: '#1677ff', margin: '4px 0 12px 0', borderBottom: '1px solid #e8e8e8', paddingBottom: 6 }}>å?¬ç½? BGPï¼?PE to PEï¼?</div>
          <Form.Item name="bgpAsn" label={<span style={{ fontSize: 13, color: '#595959' }}>ASN</span>} rules={[{ required: true, message: 'è¯·è¾?å?¥å?¬ç½? BGP ASN' }]}>
            <InputNumber style={{ width: '100%' }} min={1} placeholder="ä¾?å¦?ï¼?100" />
          </Form.Item>
          <Form.Item name="bgpRouterId" label={<span style={{ fontSize: 13, color: '#595959' }}>Router-ID</span>} rules={[{ required: true, message: 'è¯·è¾?å?¥å?¬ç½? BGP Router-ID' }]}>
            <Input placeholder="ä¾?å¦?ï¼?200.1.1.2" />
          </Form.Item>
          <div style={{ height: 12 }} />
          <div style={{ fontSize: 13, color: '#1677ff', margin: '4px 0 12px 0', borderBottom: '1px solid #e8e8e8', paddingBottom: 6 }}>è®¾å®?é?æ?è·¯ç?±</div>
          <Form.Item name="wanRouteDest" label={<span style={{ fontSize: 13, color: '#595959' }}>é»?è®¤è·¯ç?±ç?®ç??</span>}>
            <Input placeholder="ä¾?å¦?ï¼?0.0.0.0/0" />
          </Form.Item>
          <Form.Item name="wanRoutePriority" label={<span style={{ fontSize: 13, color: '#595959' }}>è·¯ç?±ä¼?å??çº§</span>}> 
            <InputNumber style={{ width: '100%' }} placeholder="ä¾?å¦?ï¼?100" />
          </Form.Item>
          <Form.Item
            name="ipv6Dest"
            label={<span style={{ fontSize: 13, color: '#595959' }}>IPv6 é?æ?è·¯ç?±ç?®ç??</span>}
            rules={[
              { required: true, message: 'è¯·è¾?å?¥ IPv6 é?æ?è·¯ç?±ç?®ç??ï¼?å¿?é¡»å¸¦æ?©ç ï¼?' },
              { pattern: /^[0-9a-fA-F:]+\/([0-9]|[1-9]\d|1[01]\d|12[0-8])$/, message: 'æ ¼å¼ç¤ºä¾?ï¼?2408:3333:1002::/64ï¼?å¿?é¡»æ?¯ IPv6 ä¸?å¸¦æ?©ç ï¼?' },
            ]}
          >
            <Input placeholder="ä¾?å¦?ï¼?2408:3333:1002::/64ï¼?å¿?é¡»å¸¦æ?©ç ï¼?" />
          </Form.Item>
          <Form.Item name="ipv6Via" label={<span style={{ fontSize: 13, color: '#595959' }}>IPv6 é?æ?è·¯ç?± next-hop</span>}>
            <Input placeholder="ä¾?å¦?ï¼?500::1" />
          </Form.Item>
        </div>

        {/* Step 2 Content */}
        <div style={{ display: current === 1 ? 'block' : 'none' }}>
          <div style={{ fontSize: 13, color: '#1677ff', margin: '4px 0 12px 0', borderBottom: '1px solid #e8e8e8', paddingBottom: 6 }}>å??ç½?é?ç½®ï¼?PE to CEï¼?</div>
          <Form.List name="lanConfigs" initialValue={[{}]}> 
            {(fields) => {
              const items = fields.map((field, idx) => ({
                key: String(field.name),
                label: `å??ç½?é?ç½®ç»? #${idx + 1}`,
                children: (
                  <div>
                    <Form.Item {...field} name={[field.name, 'vrf']} label={<span style={{ fontSize: 13, color: '#595959' }}>ç½?ç»?å??ç??ï¼?VRF IDï¼?</span>} rules={[{ type: 'number', min: 4001, message: 'VRF ID å¿?é¡»å¤§äº?ç­?äº? 4001' }]}> 
                      <InputNumber style={{ width: '100%' }} placeholder={"ä¾?å¦?ï¼?9999 (4001+)"} min={4001} />
                    </Form.Item>
                    <Form.Item {...field} name={[field.name, 'ifName']} label={<span style={{ fontSize: 13, color: '#595959' }}>æ?¥å£åç§°</span>}> 
                      <Select
                        placeholder="è¯·é??æ?©ç½?å¡"
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
                    <Form.Item {...field} name={[field.name, 'ipv4']} label={<span style={{ fontSize: 13, color: '#595959' }}>IPv4 å?°å?/æ?©ç </span>}>
                      <Input placeholder="ä¾?å¦?ï¼?130.1.1.1/24ï¼?å¯é??ï¼?" />
                    </Form.Item>
                    <Form.Item {...field} name={[field.name, 'ipv6']} label={<span style={{ fontSize: 13, color: '#595959' }}>IPv6 å?°å?/æ?©ç </span>}> 
                      <Input placeholder="ä¾?å¦?ï¼?2408:3333:1002::1/64" />
                    </Form.Item>
                    <div style={{ height: 12 }} />
                    <div style={{ fontSize: 13, color: '#1677ff', margin: '4px 0 12px 0', borderBottom: '1px solid #e8e8e8', paddingBottom: 6 }}>è®¾å®?BGPè·¯ç?±</div>
                    <Form.Item {...field} name={[field.name, 'asn']} label={<span style={{ fontSize: 13, color: '#595959' }}>BGP ASN</span>}> 
                      <InputNumber style={{ width: '100%' }} placeholder="ä¾?å¦?ï¼?100" />
                    </Form.Item>
                    <Form.Item {...field} name={[field.name, 'routerId']} label={<span style={{ fontSize: 13, color: '#595959' }}>BGP Router-ID</span>}> 
                      <Input placeholder="ä¾?å¦?ï¼?130.1.1.1" />
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
            <Descriptions.Item label="å?¬ç½?å£è®¾å¤?">{values.wanDev || '-'}</Descriptions.Item>
            <Descriptions.Item label="é»?è®¤è·¯ç?±ç?®ç??">{previewStr(values.wanRouteDest)}</Descriptions.Item>
            <Descriptions.Item label="è·¯ç?±ä¼?å??çº§">{previewNum(values.wanRoutePriority)}</Descriptions.Item>
            <Descriptions.Item label="å?¬ç½?å£ IPv4">{previewStr(values.wanIpv4)}</Descriptions.Item>
            <Descriptions.Item label="å?¬ç½?å£ IPv6">{previewStr(values.wanIpv6)}</Descriptions.Item>
            <Descriptions.Item label="å?¬ç½? BGP ASN">{previewNum(values.bgpAsn)}</Descriptions.Item>
            <Descriptions.Item label="å?¬ç½? BGP Router-ID">{previewStr(values.bgpRouterId)}</Descriptions.Item>
            <Descriptions.Item label="IPv6 è·¯ç?±ç?®ç??">{previewStr(values.ipv6Dest)}</Descriptions.Item>
            <Descriptions.Item label="IPv6 next-hop">{previewStr(values.ipv6Via)}</Descriptions.Item>
          </Descriptions>
          {(values.lanConfigs || []).map((lan: any, idx: number) => (
            <div key={idx} style={{ marginTop: 12 }}>
              <div style={{ fontSize: 13, color: '#1677ff', margin: '4px 0 8px 0', borderBottom: '1px solid #e8e8e8', paddingBottom: 6 }}>å??ç½?é?ç½® #{idx + 1}</div>
              <Descriptions column={1} bordered size="small">
                <Descriptions.Item label="VRF ID">{lan.vrf || '-'}</Descriptions.Item>
                <Descriptions.Item label="æ?¥å£åç§°">{lan.ifName || '-'}</Descriptions.Item>
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
      extra={<Button icon={<ReloadOutlined />} onClick={() => fetchInterfaces()}>å?·æ?°è®¾å¤?å??è¯»</Button>}
      onBack={() => navigate(-1)}
      asCard={false}
    >
      <Row gutter={16}>
        <Col span={4}>
          <Card size="small" title={<span style={{ fontSize: 13, color: '#000', fontWeight: 400 }}>æ­¥éª¤</span>} variant="outlined" style={{ position: 'sticky', top: 16 }}>
            <Steps direction="vertical" size="small" current={current} onChange={handleStepsChange} items={[{ title: 'å?¬ç½?é?ç½®ï¼?PE to PEï¼?' }, { title: 'å??ç½?é?ç½®ï¼?PE to CEï¼?' }, { title: 'ç¡®è®¤ä¸?å?' }]} />
          </Card>
        </Col>
        <Col span={7}>
          <Card size="small" title={<span style={{ fontSize: 13, color: '#000', fontWeight: 400 }}>
            {`ç¬¬ ${current + 1} æ­¥ï¼?${['å?¬ç½?é?ç½®ï¼?PE to PEï¼?','å??ç½?é?ç½®ï¼?PE to CEï¼?','ç¡®è®¤ä¸?å?'][current]} è®¾å¤?å??è¯»`}
          </span>} variant="outlined">
            {ifaceLoading ? (
              <div style={{ textAlign: 'center', padding: '32px 0' }}>
                <Spin />
              </div>
            ) : csmctlCfg ? (
              <Form layout="vertical" form={mirrorForm} disabled>
                {current === 0 && (
                  <>
                    <div style={{ fontSize: 13, color: '#1677ff', margin: '4px 0 12px 0', borderBottom: '1px solid #e8e8e8', paddingBottom: 6 }}>è®¾å®?SRv6æ ?è¯?</div>
                    <Form.Item name="locatorName" label={<span style={{ fontSize: 13, color: '#595959' }}>SRv6 Locator åç§°</span>}> 
                      <Input placeholder="æ?ªé?ç½®" />
                    </Form.Item>
                    <Form.Item name="sidPrefix" label={<span style={{ fontSize: 13, color: '#595959' }}>SRv6 SID å?ç¼?</span>}>
                      <Input placeholder="æ?ªé?ç½®" />
                    </Form.Item>
                    <div style={{ fontSize: 13, color: '#1677ff', margin: '4px 0 12px 0', borderBottom: '1px solid #e8e8e8', paddingBottom: 6 }}>è®¾å®?å?¬ç½?å£</div>
                    <Form.Item name="wanDev" label={<span style={{ fontSize: 13, color: '#595959' }}>å?¬ç½?å£è®¾å¤?</span>}> 
                      <Select
                      placeholder="æ?ªé?ç½®"
                      showSearch
                      loading={ifaceLoading}
                      options={[
                        ...(mirrorForm.getFieldValue('wanDev') ? [{ label: String(mirrorForm.getFieldValue('wanDev')), value: String(mirrorForm.getFieldValue('wanDev')) }] : []),
                        ...ifaceOptions.map(n => ({ label: n, value: n })),
                      ]}
                    />
                    </Form.Item>
                    <Form.Item name="wanIpv4" label={<span style={{ fontSize: 13, color: '#595959' }}>å?¬ç½?å£ IPv4 å?°å?</span>}>
                      <Input placeholder="æ?ªé?ç½®" />
                    </Form.Item>
                    <Form.Item name="wanIpv6" label={<span style={{ fontSize: 13, color: '#595959' }}>å?¬ç½?å£ IPv6 å?°å?</span>}>
                      <Input placeholder="æ?ªé?ç½®" />
                    </Form.Item>
                    <div style={{ height: 12 }} />
                    <div style={{ fontSize: 13, color: '#1677ff', margin: '4px 0 12px 0', borderBottom: '1px solid #e8e8e8', paddingBottom: 6 }}>å?¬ç½? BGPï¼?PE to PEï¼?</div>
                    <Form.Item name="bgpAsn" label={<span style={{ fontSize: 13, color: '#595959' }}>ASN</span>}>
                      <InputNumber style={{ width: '100%' }} placeholder="æ?ªé?ç½®" />
                    </Form.Item>
                    <Form.Item name="bgpRouterId" label={<span style={{ fontSize: 13, color: '#595959' }}>Router-ID</span>}>
                      <Input placeholder="æ?ªé?ç½®" />
                    </Form.Item>
                    <div style={{ height: 12 }} />
                    <div style={{ fontSize: 13, color: '#1677ff', margin: '4px 0 12px 0', borderBottom: '1px solid #e8e8e8', paddingBottom: 6 }}>è®¾å®?é?æ?è·¯ç?±</div>
                    <Form.Item name="wanRouteDest" label={<span style={{ fontSize: 13, color: '#595959' }}>é»?è®¤è·¯ç?±ç?®ç??</span>}>
                      <Input placeholder="æ?ªé?ç½®" />
                    </Form.Item>
                    <Form.Item name="wanRoutePriority" label={<span style={{ fontSize: 13, color: '#595959' }}>è·¯ç?±ä¼?å??çº§</span>}> 
                      <InputNumber style={{ width: '100%' }} placeholder="æ?ªé?ç½®" />
                    </Form.Item>
                    <Form.Item name="ipv6Dest" label={<span style={{ fontSize: 13, color: '#595959' }}>IPv6 é?æ?è·¯ç?±ç?®ç??</span>}> 
                      <Input placeholder="æ?ªé?ç½®" />
                    </Form.Item>
                    <Form.Item name="ipv6Via" label={<span style={{ fontSize: 13, color: '#595959' }}>IPv6 é?æ?è·¯ç?± next-hop</span>}> 
                      <Input placeholder="æ?ªé?ç½®" />
                    </Form.Item>
                  </>
                )}
                {current === 1 && (
                  <>
                    <div style={{ fontSize: 13, color: '#1677ff', margin: '4px 0 12px 0', borderBottom: '1px solid #e8e8e8', paddingBottom: 6 }}>å??ç½?é?ç½®ï¼?PE to CEï¼?</div>
                    <Tabs
                      type="card"
                      items={(() => {
                        const groups: any[] = mirrorForm.getFieldValue('lanConfigs') || [{}];
                        return groups.map((g, idx) => ({
                          key: String(idx),
                          label: `å??ç½?é?ç½®ç»? #${idx + 1}`,
                          children: (
                            <div>
                              <Form.Item name={['lanConfigs', idx, 'vrf']} label={<span style={{ fontSize: 13, color: '#595959' }}>ç½?ç»?å??ç??ï¼?VRF IDï¼?</span>}> 
                                <InputNumber style={{ width: '100%' }} placeholder={"æ?ªé?ç½®"} />
                              </Form.Item>
                              <Form.Item name={['lanConfigs', idx, 'ifName']} label={<span style={{ fontSize: 13, color: '#595959' }}>æ?¥å£åç§°</span>}> 
                                <Select
                                  placeholder="æ?ªé?ç½®"
                                  showSearch
                                  loading={ifaceLoading}
                                  options={[
                                    ...(g?.ifName ? [{ label: String(g.ifName), value: String(g.ifName) }] : []),
                                    ...ifaceOptions.map(n => ({ label: n, value: n })),
                                  ]}
                                />
                              </Form.Item>
                              <Form.Item name={['lanConfigs', idx, 'ipv4']} label={<span style={{ fontSize: 13, color: '#595959' }}>IPv4 å?°å?/æ?©ç </span>}>
                                <Input placeholder="æ?ªé?ç½®" />
                              </Form.Item>
                              <Form.Item name={['lanConfigs', idx, 'ipv6']} label={<span style={{ fontSize: 13, color: '#595959' }}>IPv6 å?°å?/æ?©ç </span>}> 
                                <Input placeholder="æ?ªé?ç½®" />
                              </Form.Item>
                              <div style={{ height: 12 }} />
                              <div style={{ fontSize: 13, color: '#1677ff', margin: '4px 0 12px 0', borderBottom: '1px solid #e8e8e8', paddingBottom: 6 }}>è®¾å®?BGPè·¯ç?±</div>
                              <Form.Item name={['lanConfigs', idx, 'asn']} label={<span style={{ fontSize: 13, color: '#595959' }}>BGP ASN</span>}> 
                                <InputNumber style={{ width: '100%' }} placeholder="æ?ªé?ç½®" />
                              </Form.Item>
                              <Form.Item name={['lanConfigs', idx, 'routerId']} label={<span style={{ fontSize: 13, color: '#595959' }}>BGP Router-ID</span>}> 
                                <Input placeholder="æ?ªé?ç½®" />
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
                      <Descriptions.Item label="å?¬ç½?å£è®¾å¤?">{previewStr(mirrorForm.getFieldValue('wanDev'))}</Descriptions.Item>
                      <Descriptions.Item label="é»?è®¤è·¯ç?±ç?®ç??">{previewStr(mirrorForm.getFieldValue('wanRouteDest'))}</Descriptions.Item>
                      <Descriptions.Item label="è·¯ç?±ä¼?å??çº§">{previewNum(mirrorForm.getFieldValue('wanRoutePriority'))}</Descriptions.Item>
                      <Descriptions.Item label="å?¬ç½?å£ IPv4">{previewStr(mirrorForm.getFieldValue('wanIpv4'))}</Descriptions.Item>
                      <Descriptions.Item label="å?¬ç½?å£ IPv6">{previewStr(mirrorForm.getFieldValue('wanIpv6'))}</Descriptions.Item>
                      <Descriptions.Item label="å?¬ç½? BGP ASN">{previewNum(mirrorForm.getFieldValue('bgpAsn'))}</Descriptions.Item>
                      <Descriptions.Item label="å?¬ç½? BGP Router-ID">{previewStr(mirrorForm.getFieldValue('bgpRouterId'))}</Descriptions.Item>
                      <Descriptions.Item label="IPv6 è·¯ç?±ç?®ç??">{previewStr(mirrorForm.getFieldValue('ipv6Dest'))}</Descriptions.Item>
                      <Descriptions.Item label="IPv6 next-hop">{previewStr(mirrorForm.getFieldValue('ipv6Via'))}</Descriptions.Item>
                    </Descriptions>
                    {(mirrorForm.getFieldValue('lanConfigs') || []).map((lan: any, idx: number) => (
                      <div key={idx} style={{ marginTop: 12 }}>
                        <div style={{ fontSize: 13, color: '#1677ff', margin: '4px 0 8px 0', borderBottom: '1px solid #e8e8e8', paddingBottom: 6 }}>å??ç½?é?ç½®å??è¯» #{idx + 1}</div>
                        <Descriptions column={1} bordered size="small">
                          <Descriptions.Item label="VRF ID">{lan.vrf || '-'}</Descriptions.Item>
                          <Descriptions.Item label="æ?¥å£åç§°">{lan.ifName || '-'}</Descriptions.Item>
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
                æ?ªè?·å?å?°è®¾å¤?é?ç½®ï¼?è®¾å¤?å??è¯»ä¸ºç©ºï¼?
              </div>
            )}
          </Card>
        </Col>
        <Col span={8}>
          <Card size="small" title={<span style={{ fontSize: 13, color: '#000', fontWeight: 400 }}>
            {`ç¬¬ ${current + 1} æ­¥ï¼?${['å?¬ç½?é?ç½®ï¼?PE to PEï¼?','å??ç½?é?ç½®ï¼?PE to CEï¼?','ç¡®è®¤ä¸?å?'][current]} é?ç½®ç¼?è¾?`}
          </span>} variant="outlined">
            {renderCoreContent()}
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 16 }}>
              <Space>
                <Button onClick={() => navigate('/admin/interconnect/vr')}>è¿?å??å??è¡¨</Button>
                {current > 0 && <Button onClick={prev}>ä¸?ä¸?æ­¥</Button>}
              </Space>
              <Space>
                {current < 2 && <Button type="primary" onClick={next}>ä¸?ä¸?æ­¥</Button>}
                {current === 2 && (
                  <Button
                    type="primary"
                    loading={loading}
                    onClick={() => {
                      setConfirmChecked(false);
                      setConfirmOpen(true);
                    }}
                  >
                    ä¸?å?é?ç½®
                  </Button>
                )}
              </Space>
            </div>
          </Card>
        </Col>
        <Col span={5}>
          <Card size="small" title={<span style={{ fontSize: 13, color: '#000', fontWeight: 400 }}>é?ç½® JSONé¢?è§?</span>} variant="outlined" style={{ position: 'sticky', top: 16 }}>
            <pre style={{ fontSize: 12, lineHeight: '18px', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
              {JSON.stringify(uuid ? { uuid, ...configPreview } : configPreview, null, 2)}
            </pre>
          </Card>
        </Col>
      </Row>
      <Modal
        title="é?è¦æç¤ºï¼?é?ç½®ä¸?å?ä¸ºå?¨é?è¦?ç??"
        open={confirmOpen}
        onCancel={() => setConfirmOpen(false)}
        onOk={async () => {
          if (!confirmChecked) return;
          setConfirmOpen(false);
          await handleDispatch();
        }}
        okButtonProps={{ disabled: !confirmChecked }}
        okText="æ??å·²é??è¯»å¹¶ç?è§£ï¼?ç»§ç»­ä¸?å?"
        cancelText="å?æ¶?"
        width={680}
      >
        <div style={{ fontSize: 13, color: '#595959' }}>
          <div style={{ marginBottom: 12 }}>
            æ?¬æ¬¡ä¸?å?å±?äº?å?¨é?è¦?ç??ã??è®¾å¤?å½?å?é?ç½®å°?è¢«å®?å?¨æ?¿æ¢ä¸ºå?å¯¼ç??æ?ç??é?ç½®ï¼?ä¸è¿?è¡?ä¿ç??æ??å¢?é?å?å¹¶ã??
          </div>
          <div style={{ marginBottom: 12 }}>
            å½±å?è??å?´å??æ?¬ä½?ä¸é?äº?ï¼?æ?¥å£ä¸?å­æ?¥å£ã?IPv4/IPv6 å?°å?ä¸?ç?¶æ?ã?é?æ?è·¯ç?±ã?NAT è®¾ç½®ã?BGP/VRFã?SRv6 å?æ?°å?å¯è?½ç?¸å?³ç??ç­?ç?¥é¡¹ã??å·²æ??ç??æ??å·¥ä¿®æ?¹å¯è?½è¢«è¦?ç??ã??
          </div>
          <div style={{ marginBottom: 12 }}>
            é£?é?©æé??ï¼?è?¥é»?è®¤è·¯ç?±æ??å?¬ç½?ç½?å?³è®¾ç½®ä¸æ­£ç¡®ï¼?è®¾å¤?å¯è?½å?ºç?°ç?­æ??ä¸å¯è¾¾ï¼?NAT å¼?å?³å?æ?´ä¼?å½±å?å??ç½?å?ºç½?ï¼?è·¯ç?±/BGP å?æ?´å¯è?½å¯¼è?´ä¸?å?¡ä¸­æ?­ã??
          </div>
          <div style={{ marginBottom: 12 }}>
            å»ºè®®å?¨ç»´æ?¤æ?¶æ®µæ?§è¡?ï¼?å¹¶å?¨ä¸?å?å?ä½¿ç?¨â??å?·æ?°è®¾å¤?å??è¯»â?ç¡®è®¤å½?å?ç?¶æ?ï¼?å¿?è¦æ?¶é??è¿?ä¸?å®¶æ¨¡å¼å¤?ä»½é?ç½®ï¼?ç¡®ä¿å?·å¤?å??æ»?æ?¹æ¡?ã??
          </div>
          <div style={{ marginBottom: 12 }}>
            é??ç?¨è??å?´ï¼?æ ?å??ã?PEã?CE æ¨¡å¼ç??é?ç½®ä¸?å?å?ä¸ºå?¨é?è¦?ç??ã??
          </div>
          <Checkbox checked={confirmChecked} onChange={(e) => setConfirmChecked(e.target.checked)}>
            æ??å·²é??è¯»å¹¶ç?è§£ä¸?è¿°å??å®¹ï¼?ç¡®è®¤ç»§ç»­æ?§è¡?å?¨é?è¦?ç??ä¸?å?
          </Checkbox>
        </div>
      </Modal>
    </PageContainer>
  );
};

export default PEWizard;
