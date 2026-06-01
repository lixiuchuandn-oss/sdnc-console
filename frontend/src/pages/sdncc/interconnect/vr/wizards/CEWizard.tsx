import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, Card, Descriptions, Form, Input, InputNumber, Select, Space, Steps, message, Row, Col, Spin, Modal, Checkbox } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { useNavigate, useParams } from 'react-router-dom';
import PageContainer from '../../../../../components/PageContainer';
import { getVRConfig, saveVRConfig, setVRRole, fetchVrCacheMerged } from '../../../../../services/virtualRouterApi';
import { proxyApiRequest } from '../../../../../services/api';
import { collectIfaceNamesForSelect, pickDeviceBlobForLookup } from '../vrMergedHelpers';
import { renderIfaceWizardSelectLabel } from '../vrWizardIfaceSelect';

/** å¹³å°å·²å­? ceï¼?å¤?ç½?ä¾§å??æ?°æ®ï¼?æ?°ï¼?ce.publicConfigï¼?æ?§ï¼?é¡¶å±?æ?å¹³ï¼? */
function getCePublicConfig(ce: any): Record<string, any> {
  if (!ce || typeof ce !== 'object') return {};
  if (ce.publicConfig && typeof ce.publicConfig === 'object') {
    return { ...ce.publicConfig };
  }
  const legacy: any = {};
  ['wanName', 'wanDev', 'wanIpv4', 'wanIpv6', 'bgpAsn', 'bgpRouterId'].forEach((k) => {
    if ((ce as any)[k] !== undefined) legacy[k] = (ce as any)[k];
  });
  return legacy;
}

/** å??ç½?ä¾§ï¼?æ?° ce.lanConfig[]ï¼?æ?§é¡¶å±? lanName/lanIpv4 ç­?å?è¡? */
function readLanListFromCe(ce: any): any[] {
  if (!ce || typeof ce !== 'object') return [];
  if (Array.isArray((ce as any).lanConfig)) return (ce as any).lanConfig;
  if (ce.lanName || ce.ifName || ce.lanIpv4 || ce.lanIpv6 || ce.ifIpv4 || ce.ifIpv6) {
    return [
      {
        lanName: ce.lanName ?? ce.ifName,
        lanIpv4: ce.lanIpv4 ?? ce.ifIpv4,
        lanIpv6: ce.lanIpv6 ?? ce.ifIpv6,
      },
    ];
  }
  return [];
}

function readCePublicBgpMeta(ce: any): { asn?: number; routerId?: string } {
  const pub = getCePublicConfig(ce);
  const pb = pub.publicBgp && typeof pub.publicBgp === 'object' ? pub.publicBgp : {};
  const root = ce && typeof ce === 'object' ? ce : {};
  const asnRaw = pb.asn ?? (pb as any).bgpAsn ?? pub.bgpAsn ?? (root as any).bgpAsn;
  const asnNum = Number(asnRaw);
  const routerId =
    String(
      pb.routerId ?? (pb as any).bgpRouterId ?? pub.bgpRouterId ?? (root as any).bgpRouterId ?? '',
    ).trim() || undefined;
  return {
    ...(Number.isFinite(asnNum) ? { asn: asnNum } : {}),
    ...(routerId ? { routerId } : {}),
  };
}

function normalizeCeLanRowForForm(l: any) {
  if (!l || typeof l !== 'object') return {};
  const { lanName, ifName, lanIpv4, ifIpv4, lanIpv6, ifIpv6, ...rest } = l;
  return {
    ...rest,
    lanName: lanName || ifName,
    lanIpv4: lanIpv4 ?? ifIpv4,
    lanIpv6: lanIpv6 ?? ifIpv6,
  };
}

const CEWizard: React.FC = () => {
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
  /** è?å? vr3_infoï¼?ä»?ç?¨æ?·ä¸»å?¨æ?¹ã??å¤?ç½?å£ã?Select æ?¶ç?¨å?¶è·? IPï¼?æ?¥å£æ?å¨ï¼? */
  const [vr3Info, setVr3Info] = useState<any | null>(null);
  const [confirmOpen, setConfirmOpen] = useState<boolean>(false);
  const [confirmChecked, setConfirmChecked] = useState<boolean>(false);

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

  /**
   * ç½?å¡ IPv4/IPv6 ä»?å?è®¸ç?¨ VR3ï¼?vr3_infoï¼?å??å¡«ï¼?VR3 æ? è¯¥å£æ??æ? å?°å?å??ç½®ç©ºã??
   * forceï¼?æ¢ç½?å¡æ?? VR3 é¦?æ¬¡å?°è¾¾æ?¶åº?ä¸º trueï¼?å¦å?? isFieldTouched ä¼?æ?¡ä½ IP æ?´æ?°ã??
   */
  const autoFillFromIface = (kind: 'wan' | 'lan', ifaceName: string, opts?: { force?: boolean }) => {
    const force = opts?.force ?? false;
    const obj = findInterfaceInDevice(vr3Info, ifaceName);
    if (!obj) {
      if (force) {
        if (kind === 'wan') {
          form.setFieldsValue({ wanIpv4: undefined, wanIpv6: undefined });
        } else {
          form.setFieldsValue({ lanIpv4: undefined, lanIpv6: undefined });
        }
      }
      return;
    }
    const v4 = String(pickIfaceIpv4(obj) || '').trim();
    const v6 = String(pickIfaceIpv6(obj) || '').trim();

    if (kind === 'wan') {
      const touchedV4 = form.isFieldTouched('wanIpv4');
      const touchedV6 = form.isFieldTouched('wanIpv6');
      form.setFieldsValue({
        ...(force || !touchedV4 ? { wanIpv4: v4 || undefined } : {}),
        ...(force || !touchedV6 ? { wanIpv6: v6 || undefined } : {}),
      });
    } else {
      const touchedV4 = form.isFieldTouched('lanIpv4');
      const touchedV6 = form.isFieldTouched('lanIpv6');
      form.setFieldsValue({
        ...(force || !touchedV4 ? { lanIpv4: v4 || undefined } : {}),
        ...(force || !touchedV6 ? { lanIpv6: v6 || undefined } : {}),
      });
    }
  };

  const prevWanNameRef = useRef<string | undefined>(undefined);
  const prevLanNameRef = useRef<string | undefined>(undefined);
  const hadVr3InfoRef = useRef(false);
  /** å·²æ?¿å?°è¿? vr3ï¼?è?¥ä»?å? ã??å?·æ?°è®¾å¤?å??è¯»ã?æ?¿æ¢ vr3Info è??ç½?å£åæ?ªå?ï¼?ä¸è¦?ç??å³ç¿¼ç¼?è¾?è¡¨ */
  const prevVr3InfoSnapshotRef = useRef<any>(null);

  useEffect(() => {
    hadVr3InfoRef.current = false;
    prevWanNameRef.current = undefined;
    prevLanNameRef.current = undefined;
    prevVr3InfoSnapshotRef.current = null;
  }, [uuid]);

  const watchedWanName = Form.useWatch('wanName', form);
  const watchedLanName = Form.useWatch('lanName', form);
  const wanIfaceTrim = watchedWanName ? String(watchedWanName).trim() : '';
  const lanIfaceTrim = watchedLanName ? String(watchedLanName).trim() : '';
  useEffect(() => {
    const wan0 = watchedWanName != null && watchedWanName !== '' ? String(watchedWanName) : '';
    const lan0 = watchedLanName != null && watchedLanName !== '' ? String(watchedLanName) : '';
    const nameUnchanged =
      (prevWanNameRef.current ?? '') === wan0 && (prevLanNameRef.current ?? '') === lan0;
    if (prevVr3InfoSnapshotRef.current != null && vr3Info != null && nameUnchanged) {
      prevVr3InfoSnapshotRef.current = vr3Info;
      return;
    }

    const vr3JustArrived = !!vr3Info && !hadVr3InfoRef.current;
    if (vr3Info) hadVr3InfoRef.current = true;
    if (vr3Info) prevVr3InfoSnapshotRef.current = vr3Info;

    const wan = watchedWanName ? String(watchedWanName) : '';
    if (wan) {
      const nicChanged = prevWanNameRef.current !== wan;
      prevWanNameRef.current = wan || undefined;
      autoFillFromIface('wan', wan, { force: nicChanged || vr3JustArrived });
    } else {
      prevWanNameRef.current = undefined;
      autoFillFromIface('wan', '', { force: true });
    }

    const lan = watchedLanName ? String(watchedLanName) : '';
    if (lan) {
      const nicChanged = prevLanNameRef.current !== lan;
      prevLanNameRef.current = lan || undefined;
      autoFillFromIface('lan', lan, { force: nicChanged || vr3JustArrived });
    } else {
      prevLanNameRef.current = undefined;
      autoFillFromIface('lan', '', { force: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [watchedWanName, watchedLanName, vr3Info]);

  useEffect(() => {
    if (!uuid) return;
    (async () => {
      try {
        const cfg = await getVRConfig(uuid);
        setExistingCfg(cfg || {});
        const names: string[] = [];
        const collectNames = (arr?: any[]) => { (arr || []).forEach((it) => { if (it?.name) names.push(String(it.name)); }); };
        if (cfg && typeof cfg === 'object') {
          Object.keys(cfg).forEach((key) => {
            if (key.startsWith('interfaces_') || key.startsWith('subinterfaces_')) {
              collectNames((cfg as any)[key]);
            }
          });
        }
        setIfaceOptions(Array.from(new Set(names)).filter(Boolean));
        const bgpTop = Array.isArray(cfg?.bgp) ? cfg.bgp[0] : undefined;
        const pcfg = getCePublicConfig(cfg?.ce);
        const lanRows = readLanListFromCe(cfg?.ce).map((x) => normalizeCeLanRowForForm(x));
        const firstLan = lanRows[0] || {};
        const pbg = readCePublicBgpMeta(cfg?.ce);
        form.setFieldsValue({
          lanName: firstLan.lanName,
          wanName: pcfg.wanName || pcfg.wanDev || (cfg?.ce as any)?.wanDev,
          bgpAsn: pbg.asn ?? bgpTop?.asn,
          bgpRouterId: pbg.routerId ?? bgpTop?.router_id,
        });
      } catch {}
    })();
  }, [uuid, form]);

  /** è?å? /api/vr-instances/:uuid â?? vr1/2/3ï¼?ç½?å¡ IP ä»? VR3 å??å¡«ï¼?è§ autoFillFromIface / mirrorï¼? */
  const refreshDeviceData = useCallback(async (silent = false) => {
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
      const unique = collectIfaceNamesForSelect(merged as Record<string, any>);
      if (unique.length) setIfaceOptions(unique);
      setCsmctlCfg(pickDeviceBlobForLookup(merged));
      setVr3Info(merged.vr3_info && typeof merged.vr3_info === 'object' ? merged.vr3_info : null);
      if (!silent) message.success('è®¾å¤?æ?°æ®å·²å?·æ?°');
    } catch (err) {
      console.warn('[CEWizard] fetchVrCacheMerged:', (err as any)?.message || err);
      if (!silent) message.error('å?·æ?°å¤±è´¥');
    } finally {
      setIfaceLoading(false);
    }
  }, [uuid]);

  useEffect(() => {
    refreshDeviceData(true);
  }, [refreshDeviceData]);

  useEffect(() => {
    const pce = existingCfg?.ce;
    if (!pce || typeof pce !== 'object') return;

    const pub = getCePublicConfig(pce);
    const wanDevName = pub.wanName || pub.wanDev || pce?.wanDev;
    const lanRows = readLanListFromCe(pce).map((x) => normalizeCeLanRowForForm(x));
    const firstLan = lanRows[0] || {};
    const lanDevName = firstLan.lanName;

    const wanObjVr3 = wanDevName && vr3Info ? findInterfaceInDevice(vr3Info, String(wanDevName)) : null;
    const lanObjVr3 = lanDevName && vr3Info ? findInterfaceInDevice(vr3Info, String(lanDevName)) : null;

    const bgpTop = Array.isArray(csmctlCfg?.bgp) ? csmctlCfg.bgp[0] : undefined;

    mirrorForm.setFieldsValue({
      wanName: wanDevName,
      wanIpv4: wanObjVr3?.ipv4_static,
      wanIpv6: wanObjVr3?.ipv6_static,
      bgpAsn: bgpTop?.asn,
      bgpRouterId: bgpTop?.router_id,
      lanName: lanDevName,
      lanIpv4: lanObjVr3?.ipv4_static,
      lanIpv6: lanObjVr3?.ipv6_static,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [existingCfg, csmctlCfg, vr3Info, mirrorForm]);

  /** ç?± host IPv4 CIDR æ?¨å¯¼ç½?æ®µï¼?å¦? 130.1.1.9/24 â?? 130.1.1.0/24ï¼? */
  const ipv4NetworkFromCidr = (cidr: string): string | undefined => {
    const s = String(cidr || '').trim();
    const [ip, maskStr] = s.split('/');
    if (!ip || maskStr === undefined || maskStr === '') return undefined;
    const mask = parseInt(maskStr, 10);
    if (!Number.isFinite(mask) || mask < 0 || mask > 32) return undefined;
    const parts = ip.split('.').map((x) => parseInt(x, 10));
    if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n) || n < 0 || n > 255)) return undefined;
    const num = ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
    const hostBits = 32 - mask;
    const netNum = hostBits === 32 ? 0 : (num >>> hostBits) << hostBits;
    const o0 = (netNum >>> 24) & 255;
    const o1 = (netNum >>> 16) & 255;
    const o2 = (netNum >>> 8) & 255;
    const o3 = netNum & 255;
    return `${o0}.${o1}.${o2}.${o3}/${mask}`;
  };

  const buildConfigFromValues = (v: any) => {
    const cfg: any = {};
    const ifaceMap = new Map<string, any>();

    // Helper to merge interface config
    const mergeIface = (name: string, data: any) => {
      const cleanName = String(name || '').trim();
      if (!cleanName) return;
      const existing = ifaceMap.get(cleanName) || { name: cleanName, status: 'up' };
      if (data.ipv4_static) existing.ipv4_static = data.ipv4_static;
      if (data.ipv6_static) existing.ipv6_static = data.ipv6_static;
      ifaceMap.set(cleanName, existing);
    };

    if (v?.wanName) {
      const item: any = {};
      const ipv4Wan = String(v?.wanIpv4 || '').trim();
      if (ipv4Wan) item.ipv4_static = ipv4Wan;
      if (v?.wanIpv6) item.ipv6_static = String(v.wanIpv6).trim();
      mergeIface(v.wanName, item);
    }

    if (v?.lanName) {
      const item: any = {};
      if (v?.lanIpv4) item.ipv4_static = String(v.lanIpv4).trim();
      if (v?.lanIpv6) item.ipv6_static = String(v.lanIpv6).trim();
      mergeIface(v.lanName, item);
    }

    if (ifaceMap.size > 0) {
      const buckets: Record<string, any[]> = {};
      
      ifaceMap.forEach((item) => {
        const name = item.name;
        const isSub = name.includes('.');
        // Simple heuristic for interface type, can be expanded
        let typePrefix = 'GigabitEthernet';
        if (name.toLowerCase().startsWith('lo')) typePrefix = 'lo';
        else if (name.toLowerCase().startsWith('tunnel')) typePrefix = 'Tunnel';
        else if (name.toLowerCase().startsWith('ethernet')) typePrefix = 'Ethernet';
        else if (name.includes(' ')) typePrefix = name.split(' ')[0]; // Try to guess from space separated name
        else {
             // Fallback: try to extract letters from start
             const match = name.match(/^([a-zA-Z]+)/);
             if (match) typePrefix = match[1];
        }

        const key = `${isSub ? 'subinterfaces_' : 'interfaces_'}${typePrefix}`;
        if (!buckets[key]) buckets[key] = [];
        buckets[key].push(item);
      });

      Object.keys(buckets).forEach(k => {
        cfg[k] = buckets[k];
      });
    }

    if (v?.bgpAsn || v?.bgpRouterId) {
      const bgpArr: any[] = [];
      const wanCidr = String(v?.wanIpv4 || '').trim();
      const lanCidr = String(v?.lanIpv4 || '').trim();
      const nets: string[] = [];
      const nwWan = ipv4NetworkFromCidr(wanCidr);
      const nwLan = ipv4NetworkFromCidr(lanCidr);
      if (nwWan) nets.push(nwWan);
      if (nwLan) nets.push(nwLan);
      const bgp0: any = {
        asn: Number(v.bgpAsn),
        router_id: String(v.bgpRouterId || '').trim(),
        bgp_ebgp_requires_policy: 'disable',
      };
      if (nets.length > 0) {
        bgp0.address_family = [
          {
            address_family: 'ipv4',
            modifiler: 'unicast',
            network: nets,
          },
        ];
      }
      bgpArr.push(bgp0);
      if (bgpArr.length) cfg.bgp = bgpArr;
    }

    cfg.role = 'CE';
    const wanIpv6Out = String(v?.wanIpv6 || '').trim() || undefined;
    const lanIpv6Out = String(v?.lanIpv6 || '').trim() || undefined;
    cfg.ce = {
      publicConfig: {
        wanName: v.wanName,
        wanIpv4: v.wanIpv4,
        ...(wanIpv6Out !== undefined ? { wanIpv6: wanIpv6Out } : {}),
        publicBgp: {
          asn: v.bgpAsn,
          routerId: v.bgpRouterId,
        },
      },
      lanConfig:
        v?.lanName && String(v.lanName).trim()
          ? [
              {
                lanName: v.lanName,
                lanIpv4: v.lanIpv4,
                ...(lanIpv6Out !== undefined ? { lanIpv6: lanIpv6Out } : {}),
              },
            ]
          : [],
    };

    return sortJsonKeys(cfg);
  };

  const sortJsonKeys = (obj: any): any => {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return obj;
    
    // é??å½?å¤?ç?å­å¯¹è±¡ï¼?æ·±å±?æ??åºï¼?
    const copy = { ...obj };
    Object.keys(copy).forEach(k => {
      copy[k] = sortJsonKeys(copy[k]);
    });

    // å¯¹æ??å¤?å±?è¿?è¡?æ??åºï¼?uuid, role, ce ä¼?å??
    const keys = Object.keys(copy).sort((a, b) => {
       const prio = (k: string) => {
         if (k === 'uuid') return -1;
         if (k === 'role') return 0;
         if (k === 'ce') return 1;
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

  const watchedValues = Form.useWatch([], form);
  const configPreview = useMemo(
    () => buildConfigFromValues(form.getFieldsValue(true) || {}),
    // buildConfigFromValues ä¸ºç»?ä»¶å??å?½æ?°ï¼?ä¸? watchedValues å?æ­¥å³å¯
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [watchedValues, form],
  );

  const CE_STEP0_FIELDS: string[] = ['wanName', 'wanIpv4', 'wanIpv6', 'bgpAsn', 'bgpRouterId'];
  const CE_STEP1_FIELDS: string[] = ['lanName', 'lanIpv4', 'lanIpv6'];

  const next = async () => {
    try {
      if (current === 0) {
        await form.validateFields(CE_STEP0_FIELDS);
      } else if (current === 1) {
        await form.validateFields(CE_STEP1_FIELDS);
      }
      setCurrent((c) => Math.min(2, c + 1));
    } catch {
      /* æ ¡éª?å¤±è´¥ç?±è¡¨å?é¡¹å±?ç¤º */
    }
  };
  const prev = () => setCurrent((c) => Math.max(0, c - 1));

  const handleDispatch = async () => {
    if (!uuid) {
      message.error('ç¼ºå°? VR ç?? UUIDï¼?æ? æ³?ä¸?å?');
      return;
    }
    try {
      await form.validateFields();
    } catch {
      message.warning('è¯·å??ä¿®æ­£è¡¨å?æ ¡éª?é??è¯¯å?å?ä¸?å?');
      return;
    }
    try {
      const values = form.getFieldsValue(true);
      const selectedWan = String(values?.wanName || '').trim();
      const selectedLan = String(values?.lanName || '').trim();
      const reportedArr = Array.isArray(ifaceOptions) ? ifaceOptions : [];
      const reported = new Set(reportedArr.map((n) => String(n).trim()));
      if (reportedArr.length > 0) {
        if (selectedWan && !reported.has(selectedWan)) {
          const listStr = reportedArr.join(', ');
          message.error(`ä¸?å?å¤±è´¥ï¼?å¤?ç½?å£è®¾å¤?â??${selectedWan}â?ä¸å?¨è®¾å¤?å·²ä¸?æ?¥ç??æ?¥å£ä¸­ã??å¯é??ï¼?${listStr}`);
          return;
        }
        if (selectedLan && !reported.has(selectedLan)) {
          const listStr = reportedArr.join(', ');
          message.error(`ä¸?å?å¤±è´¥ï¼?å??ç½?æ?¥å£â??${selectedLan}â?ä¸å?¨è®¾å¤?å·²ä¸?æ?¥ç??æ?¥å£ä¸­ã??å¯é??ï¼?${listStr}`);
          return;
        }
      }
      const cfg = buildConfigFromValues(values);
      if (!cfg || (typeof cfg === 'object' && Object.keys(cfg).length === 0)) {
        message.warning('æ?¼è£?ç»?æ??ä¸ºç©ºï¼?è¯·æ£?æ?¥ç¬¬1ã?2æ­¥æ?¯å¦å·²å¡«å??å¿?è¦å­?æ®µ');
        return;
      }
      if (uuid) (cfg as any).uuid = uuid;
      setLoading(true);

      // 1. å?æ­¥ä¿å­?å?°æ?¬å?°æ?°æ®åº?ï¼?ä¸?ä¸?å®¶æ¨¡å¼ä¸?è?´ï¼?ä¿ç??é?å?å¯¼é?ç½®ï¼?
      let finalCfg = cfg;
      try {
        const existing = await getVRConfig(uuid);

        // Remove existing ce/role to ensure they are sorted correctly
        const cleanExisting = { ...(existing || {}) };
        delete cleanExisting.ce;
        delete cleanExisting.role;

        finalCfg = sortJsonKeys({ ...cleanExisting, ...cfg });
        await saveVRConfig(uuid, finalCfg);
        await setVRRole(uuid, 'CE');
      } catch (e) {
        console.warn('ä¿å­?å?°æ?¬å?°æ?°æ®åº?å¤±è´¥:', e);
      }

      // 2. ä¸? PE/Standard/SASE å? vrController.updateVRConfig ä¸?è?´ï¼?å¿?é¡»å¸¦ ?uuid= ä¸?ç­¾åä¸­ other
      const path = '/V2/ctcontrol/VR2/VRConfig';
      const method = 'POST';
      const other = `uuid=${uuid}`;
      const data = await proxyApiRequest(path, method, other, cfg);
      if (data && typeof data.code === 'number' && data.code !== 200) {
        throw new Error(data?.msg || `ä¸?å?å¤±è´¥: ${JSON.stringify(data)}`);
      }
      message.success(data?.msg || 'é?ç½®å·²ä¸?å?å?°è®¾å¤?');
    } catch (err: any) {
      message.error(`ä¸?å?å¤±è´¥ï¼?${err?.message || 'è¯·ç¨å?é?è¯?'}`);
    } finally {
      setLoading(false);
    }
  };

  const renderCoreContent = () => {
    // å? Form å®?ä¾? + æ?¾é?å??æ¢æ­¥ï¼?é¿å?ç¬¬ 0/1 æ­¥å?å??ä¸?å±? <Form> å?¨å??æ­¥æ?¶å¸è½½å¯¼è?´å? form ä¸?å­?æ®µ/å?¼ä¸¢å¤±
    const summaryValues = form.getFieldsValue(true);
    return (
      <>
        <Form
          form={form}
          layout="vertical"
          style={{ display: current === 2 ? 'none' : undefined }}
        >
          <div style={{ display: current === 0 ? 'block' : 'none' }}>
            <div style={{ fontSize: 13, color: '#1677ff', margin: '4px 0 12px 0', borderBottom: '1px solid #e8e8e8', paddingBottom: 6 }}>è®¾å®?å¤?ç½?å£</div>
            <Form.Item name="wanName" label={<span style={{ fontSize: 13, color: '#595959' }}>å¤?ç½?å£è®¾å¤?</span>} rules={[{ required: true, message: 'è¯·é??æ?©å¤?ç½?å£è®¾å¤?' }]} preserve>
              <Select
                placeholder="è¯·é??æ?©ç½?å¡"
                showSearch
                loading={ifaceLoading}
                options={ifaceOptions.map((n) => ({
                  value: n,
                  label: renderIfaceWizardSelectLabel(n, lanIfaceTrim && n === lanIfaceTrim ? 'å??ç½?å£' : undefined),
                }))}
                filterOption={(input: string, option?: { value?: string }) =>
                  String(option?.value || '')
                    .toLowerCase()
                    .includes(input.toLowerCase())
                }
                onChange={(val) => autoFillFromIface('wan', String(val || ''), { force: true })}
              />
            </Form.Item>
            <Form.Item name="wanIpv4" label={<span style={{ fontSize: 13, color: '#595959' }}>å¤?ç½?å£ IPv4 å?°å?</span>} preserve>
              <Input placeholder="ä¾?å¦?ï¼?200.1.1.2/24ï¼?å¯é??ï¼?" />
            </Form.Item>
            <Form.Item name="wanIpv6" label={<span style={{ fontSize: 13, color: '#595959' }}>å¤?ç½?å£ IPv6 å?°å?</span>} preserve>
              <Input placeholder="ä¾?å¦?ï¼?2408:3333:1002::1/64ï¼?å¯é??ï¼?" />
            </Form.Item>
            <div style={{ height: 12 }} />
            <div style={{ fontSize: 13, color: '#1677ff', margin: '4px 0 12px 0', borderBottom: '1px solid #e8e8e8', paddingBottom: 6 }}>è®¾å®?BGPè·¯ç?±(CE to PE)</div>
            <Form.Item name="bgpAsn" label={<span style={{ fontSize: 13, color: '#595959' }}>BGP ASN</span>} rules={[{ required: true, message: 'è¯·è¾?å?¥ BGP ASN' }]} preserve>
              <InputNumber style={{ width: '100%' }} placeholder="ä¾?å¦?ï¼?100" min={1} max={4294967295} />
            </Form.Item>
            <Form.Item
              name="bgpRouterId"
              label={<span style={{ fontSize: 13, color: '#595959' }}>BGP Router-ID</span>}
              rules={[
                { required: true, message: 'è¯·è¾?å?¥ Router-ID' },
                { pattern: /^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/, message: 'è¯·è¾?å?¥å?æ³?ç?? IPv4 å?°å?' },
              ]}
              preserve
            >
              <Input placeholder="ä¾?å¦?ï¼?200.1.1.2" />
            </Form.Item>
          </div>
          <div style={{ display: current === 1 ? 'block' : 'none' }}>
            <div style={{ fontSize: 13, color: '#1677ff', margin: '4px 0 12px 0', borderBottom: '1px solid #e8e8e8', paddingBottom: 6 }}>è®¾å®?å??ç½?å£</div>
            <Form.Item name="lanName" label={<span style={{ fontSize: 13, color: '#595959' }}>æ?¥å£åç§°</span>} rules={[{ required: true, message: 'è¯·é??æ?©æ?¥å£åç§°' }]} preserve>
              <Select
                placeholder="è¯·é??æ?©ç½?å¡"
                showSearch
                loading={ifaceLoading}
                options={ifaceOptions.map((n) => ({
                  value: n,
                  label: renderIfaceWizardSelectLabel(n, wanIfaceTrim && n === wanIfaceTrim ? 'å¤?ç½?å£' : undefined),
                }))}
                filterOption={(input: string, option?: { value?: string }) =>
                  String(option?.value || '')
                    .toLowerCase()
                    .includes(input.toLowerCase())
                }
                onChange={(val) => autoFillFromIface('lan', String(val || ''), { force: true })}
              />
            </Form.Item>
            <Form.Item name="lanIpv4" label={<span style={{ fontSize: 13, color: '#595959' }}>IPv4 å?°å?/æ?©ç </span>} preserve>
              <Input placeholder="ä¾?å¦?ï¼?130.1.1.1/24ï¼?å¯é??ï¼?" />
            </Form.Item>
            <Form.Item name="lanIpv6" label={<span style={{ fontSize: 13, color: '#595959' }}>IPv6 å?°å?/æ?©ç </span>} preserve>
              <Input placeholder="ä¾?å¦?ï¼?2408:3333:1002::1/64ï¼?å¯é??ï¼?" />
            </Form.Item>
          </div>
        </Form>
        {current === 2 && (
          <div>
            <Descriptions column={1} bordered size="small">
              <Descriptions.Item label="å¤?ç½?å£è®¾å¤?">{summaryValues.wanName || '-'}</Descriptions.Item>
              <Descriptions.Item label="å¤?ç½?å£ IPv4">{summaryValues.wanIpv4 || '-'}</Descriptions.Item>
              <Descriptions.Item label="å¤?ç½?å£ IPv6">{summaryValues.wanIpv6 || '-'}</Descriptions.Item>
              <Descriptions.Item label="BGP ASN">{summaryValues.bgpAsn || '-'}</Descriptions.Item>
              <Descriptions.Item label="BGP Router-ID">{summaryValues.bgpRouterId || '-'}</Descriptions.Item>
              <Descriptions.Item label="å??ç½?æ?¥å£">{summaryValues.lanName || '-'}</Descriptions.Item>
              <Descriptions.Item label="å??ç½? IPv4">{summaryValues.lanIpv4 || '-'}</Descriptions.Item>
              <Descriptions.Item label="å??ç½? IPv6">{summaryValues.lanIpv6 || '-'}</Descriptions.Item>
            </Descriptions>
          </div>
        )}
      </>
    );
  };

  return (
    <PageContainer
      titleLevel={3}
      extra={<Button icon={<ReloadOutlined />} onClick={() => refreshDeviceData()}>å?·æ?°è®¾å¤?å??è¯»</Button>}
      onBack={() => navigate(-1)}
      asCard={false}
    >
      <Row gutter={16}>
        <Col span={4}>
          <Card size="small" title={<span style={{ fontSize: 13, color: '#000', fontWeight: 400 }}>æ­¥éª¤</span>} variant="outlined" style={{ position: 'sticky', top: 16 }}>
            <Steps direction="vertical" size="small" current={current} onChange={(idx) => setCurrent(idx)} items={[{ title: 'å¤?ç½?é?ç½®(CE to PE)' }, { title: 'å??ç½?é?ç½®(CE to local)' }, { title: 'ç¡®è®¤ä¸?å?' }]} />
          </Card>
        </Col>
        <Col span={7}>
          <Card size="small" title={<span style={{ fontSize: 13, color: '#000', fontWeight: 400 }}>
            {`ç¬¬ ${current + 1} æ­¥ï¼?${['å¤?ç½?é?ç½®(CE to PE)','å??ç½?é?ç½®(CE to local)','ç¡®è®¤ä¸?å?'][current]} è®¾å¤?å??è¯»`}
          </span>} variant="outlined">
            {ifaceLoading ? (
              <div style={{ textAlign: 'center', padding: '32px 0' }}>
                <Spin />
              </div>
            ) : csmctlCfg ? (
              <>
                {current === 0 && (
                  <>
                    <div style={{ fontSize: 13, color: '#1677ff', margin: '4px 0 12px 0', borderBottom: '1px solid #e8e8e8', paddingBottom: 6 }}>å¤?ç½?é?ç½®(CE to PE)</div>
                    <Form layout="vertical" form={mirrorForm} disabled>
                      <Form.Item name="wanName" label={<span style={{ fontSize: 13, color: '#595959' }}>å¤?ç½?å£è®¾å¤?</span>}>
                        <Select
                          placeholder="æ?ªé?ç½®"
                          showSearch
                          loading={ifaceLoading}
                          options={[
                            ...(mirrorForm.getFieldValue('wanName') ? [{ label: String(mirrorForm.getFieldValue('wanName')), value: String(mirrorForm.getFieldValue('wanName')) }] : []),
                            ...ifaceOptions.map(n => ({ label: n, value: n })),
                          ]}
                        />
                      </Form.Item>
                      <Form.Item name="wanIpv4" label={<span style={{ fontSize: 13, color: '#595959' }}>å¤?ç½?å£ IPv4 å?°å?</span>}>
                        <Input placeholder="æ?ªé?ç½®" />
                      </Form.Item>
                      <Form.Item name="wanIpv6" label={<span style={{ fontSize: 13, color: '#595959' }}>å¤?ç½?å£ IPv6 å?°å?</span>}>
                        <Input placeholder="æ?ªé?ç½®" />
                      </Form.Item>
                      <div style={{ height: 12 }} />
                      <div style={{ fontSize: 13, color: '#1677ff', margin: '4px 0 12px 0', borderBottom: '1px solid #e8e8e8', paddingBottom: 6 }}>è®¾å®?BGPè·¯ç?±(CE to PE)</div>
                      <Form.Item name="bgpAsn" label={<span style={{ fontSize: 13, color: '#595959' }}>BGP ASN</span>}>
                        <InputNumber style={{ width: '100%' }} placeholder="æ?ªé?ç½®" />
                      </Form.Item>
                      <Form.Item name="bgpRouterId" label={<span style={{ fontSize: 13, color: '#595959' }}>BGP Router-ID</span>}>
                        <Input placeholder="æ?ªé?ç½®" />
                      </Form.Item>
                    </Form>
                  </>
                )}
                {current === 1 && (
                  <>
                    <div style={{ fontSize: 13, color: '#1677ff', margin: '4px 0 12px 0', borderBottom: '1px solid #e8e8e8', paddingBottom: 6 }}>å??ç½?é?ç½®(CE to local)</div>
                    <Form layout="vertical" form={mirrorForm} disabled>
                      <Form.Item name="lanName" label={<span style={{ fontSize: 13, color: '#595959' }}>æ?¥å£åç§°</span>}>
                        <Select
                          placeholder="æ?ªé?ç½®"
                          showSearch
                          loading={ifaceLoading}
                          options={[
                            ...(mirrorForm.getFieldValue('lanName') ? [{ label: String(mirrorForm.getFieldValue('lanName')), value: String(mirrorForm.getFieldValue('lanName')) }] : []),
                            ...ifaceOptions.map(n => ({ label: n, value: n })),
                          ]}
                        />
                      </Form.Item>
                      <Form.Item name="lanIpv4" label={<span style={{ fontSize: 13, color: '#595959' }}>IPv4 å?°å?/æ?©ç </span>}>
                        <Input placeholder="æ?ªé?ç½®" />
                      </Form.Item>
                      <Form.Item name="lanIpv6" label={<span style={{ fontSize: 13, color: '#595959' }}>IPv6 å?°å?/æ?©ç </span>}>
                        <Input placeholder="æ?ªé?ç½®" />
                      </Form.Item>
                    </Form>
                  </>
                )}
                {current === 2 && (
                  <>
                    <Descriptions column={1} bordered size="small">
                      <Descriptions.Item label="å¤?ç½?å£è®¾å¤?">{mirrorForm.getFieldValue('wanName') || '-'}</Descriptions.Item>
                      <Descriptions.Item label="å¤?ç½?å£ IPv4">{mirrorForm.getFieldValue('wanIpv4') || '-'}</Descriptions.Item>
                      <Descriptions.Item label="å¤?ç½?å£ IPv6">{mirrorForm.getFieldValue('wanIpv6') || '-'}</Descriptions.Item>
                      <Descriptions.Item label="BGP ASN">{mirrorForm.getFieldValue('bgpAsn') || '-'}</Descriptions.Item>
                      <Descriptions.Item label="BGP Router-ID">{mirrorForm.getFieldValue('bgpRouterId') || '-'}</Descriptions.Item>
                      <Descriptions.Item label="æ?¥å£åç§°">{mirrorForm.getFieldValue('lanName') || '-'}</Descriptions.Item>
                      <Descriptions.Item label="å??ç½? IPv4">{mirrorForm.getFieldValue('lanIpv4') || '-'}</Descriptions.Item>
                      <Descriptions.Item label="å??ç½? IPv6">{mirrorForm.getFieldValue('lanIpv6') || '-'}</Descriptions.Item>
                    </Descriptions>
                  </>
                )}
              </>
            ) : (
              <div style={{ padding: 12, background: '#fffbe6', border: '1px dashed #faad14', borderRadius: 6, color: '#faad14', fontSize: 12 }}>
                æ?ªè?·å?å?°è®¾å¤?é?ç½®ï¼?è®¾å¤?å??è¯»ä¸ºç©ºï¼?
              </div>
            )}
          </Card>
        </Col>
        <Col span={8}>
          <Card size="small" title={<span style={{ fontSize: 13, color: '#000', fontWeight: 400 }}>
            {`ç¬¬ ${current + 1} æ­¥ï¼?${['å¤?ç½?é?ç½®(CE to PE)','å??ç½?é?ç½®(CE to local)','ç¡®è®¤ä¸?å?'][current]} é?ç½®ç¼?è¾?`}
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
                  <>
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
                  </>
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

export default CEWizard;
