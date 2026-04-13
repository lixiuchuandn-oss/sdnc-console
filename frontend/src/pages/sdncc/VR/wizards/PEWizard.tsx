import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, Card, Descriptions, Form, Input, InputNumber, Space, Steps, message, Row, Col, Select, Tabs, Spin, Modal, Checkbox } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { useNavigate, useParams } from 'react-router-dom';
import PageContainer from '../../../../components/PageContainer';
import { getVRConfig, saveVRConfig, setVRRole, fetchVrCacheMerged } from '../../../../services/virtualRouterApi';
import { proxyApiRequest } from '../../../../services/api';
import { collectIfaceNamesForSelect, pickDeviceBlobForLookup } from '../vrMergedHelpers';

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
  const pickIfaceIpv6 = (iface: any) =>
    iface?.ipv6_static ??
    iface?.ipv6Static ??
    iface?.ipv6 ??
    iface?.ipv6_address ??
    iface?.ipv6Address ??
    '';

  /**
   * 右翼默认跟 vr2；仅 dataSource==='vr3' 时跟 vr3（用户主动改公网口 Select）。
   * force：换网卡或设备初到时应为 true，否则 isFieldTouched 会挡住 IP 更新。
   */
  const autoFillWanFromIface = (
    ifaceName: string,
    opts?: { force?: boolean; dataSource?: 'vr2' | 'vr3' },
  ) => {
    const force = opts?.force ?? false;
    const dataSource = opts?.dataSource ?? 'vr2';
    const obj =
      dataSource === 'vr3'
        ? findInterfaceInDevice(vr3Info, ifaceName)
        : findInterfaceInDevice(csmctlCfg, ifaceName);
    if (!obj) return;
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
  /** 仅 vr2：首次拉到 csmctlCfg 时要 force 跟公网 IP（与 vr3 晚到无关） */
  const hadVr2LookupRef = useRef(false);

  useEffect(() => {
    hadVr2LookupRef.current = false;
    prevWanDevRef.current = undefined;
  }, [uuid]);

  /** 聚合 /api/vr-instances/:uuid → vr1/2/3；左翼 mirror 与右翼默认推断用 vr2，公网口选项与手动改口跟 vr3 */
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
      const unique = collectIfaceNamesForSelect(merged as Record<string, any>);
      if (unique.length) setIfaceOptions(unique);
      setCsmctlCfg(pickDeviceBlobForLookup(merged));
      setVr3Info(merged.vr3_info && typeof merged.vr3_info === 'object' ? merged.vr3_info : null);
      try {
        const saved = await getVRConfig(uuid);
        setExistingCfg(saved || {});
      } catch (e) {
        console.warn('获取本地配置失败', e);
      }
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
      let lanConfigs = (pe.lanConfigs || []).map((l: any) => ({
        ...l,
        ifName: l.lanName || l.ifName,
        asn: l.bgpAsn || l.asn,
        routerId: l.bgpRouterId || l.routerId,
      }));
      if (!lanConfigs.length) lanConfigs = [{}];
      form.setFieldsValue({
        ...pe,
        wanDev: pe.wanName || pe.wanDev,
        lanConfigs,
      });
    };

    // vr2_info 为 null/undefined 时 csmctlCfg 为空：不能从设备推断，但仍应回填 Tower 已保存的 pe 元数据
    if (!csmctlCfg) {
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
    const wanIfaceResolved = wanDevCandidate
      ? findInterfaceInDevice(dev, String(wanDevCandidate))
      : undefined;
    const ifaceForWanIp = wanIfaceResolved || anyIface;
    const v4Wan = String(pickIfaceIpv4(ifaceForWanIp) || '').trim();
    const v6Wan = String(pickIfaceIpv6(ifaceForWanIp) || '').trim();
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
        vrf: first?.vrf,
        ifName: first?.name,
        ipv4: first?.ipv4_static,
        ipv6: first?.ipv6_static,
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

    if (existingCfg && existingCfg.pe && Object.keys(existingCfg.pe).length > 0) {
      const pe = existingCfg.pe;
      let lanConfigs = (pe.lanConfigs || []).map((l: any) => ({
        ...l,
        ifName: l.lanName || l.ifName,
        asn: l.bgpAsn || l.asn,
        routerId: l.bgpRouterId || l.routerId
      }));
      if (!lanConfigs.length) {
        lanConfigs = [{}];
      }
      const mapped = {
        ...pe,
        wanDev: pe.wanName || pe.wanDev,
        lanConfigs,
      };
      form.setFieldsValue(mapped);
    } else {
      form.setFieldsValue(fullInferredForForm);
    }
  }, [csmctlCfg, existingCfg, mirrorForm, form]);

  const watchedWanDev = Form.useWatch('wanDev', form);
  useEffect(() => {
    const vr2JustArrived = !!csmctlCfg && !hadVr2LookupRef.current;
    if (csmctlCfg) hadVr2LookupRef.current = true;

    const wan = watchedWanDev ? String(watchedWanDev) : '';
    if (wan) {
      const nicChanged = prevWanDevRef.current !== wan;
      prevWanDevRef.current = wan || undefined;
      autoFillWanFromIface(wan, { force: nicChanged || vr2JustArrived, dataSource: 'vr2' });
    } else {
      prevWanDevRef.current = undefined;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 右翼公网 IP 默认仅随 vr2 与当前公网口变化
  }, [watchedWanDev, csmctlCfg]);

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
      if (v?.wanIpv6) item.ipv6_static = String(v.wanIpv6).trim();
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
        route6.priority = 100;
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
                modifier: 'unicast',
                export_route: 'enable',
                import_route: 'enable',
                // 控制器约束：auto_assign_sid 只能在“私网（VRF）”下开启
                ...(enableAutoSid ? { auto_assign_sid: 'enable' } : { auto_assign_sid: 'disable' }),
              },
            ],
          });
        }
      });
      if (bgpArr.length) cfg.bgp = bgpArr;
    }
    
    // Metadata for PE Wizard
    cfg.role = 'PE';
    cfg.pe = {
      locatorName: v.locatorName,
      sidPrefix: v.sidPrefix,
      wanName: v.wanDev,
      wanIpv4: v.wanIpv4,
      wanIpv6: v.wanIpv6,
      wanRouteDest: v.wanRouteDest,
      wanRoutePriority: v.wanRoutePriority,
      ipv6Dest: v.ipv6Dest,
      ipv6Via: v.ipv6Via,
      lanConfigs: (v.lanConfigs || []).map((l: any) => {
        const { ifName, asn, routerId, ...rest } = l;
        return {
          ...rest,
          lanName: ifName,
          bgpAsn: asn,
          bgpRouterId: routerId
        };
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
          <Form.Item name="sidPrefix" label={<span style={{ fontSize: 13, color: '#595959' }}>SRv6 SID 前缀</span>}>
            <Input placeholder="例如：2400:1234::1（不能包含/掩码）" />
          </Form.Item>
          <div style={{ fontSize: 13, color: '#1677ff', margin: '4px 0 12px 0', borderBottom: '1px solid #e8e8e8', paddingBottom: 6 }}>设定公网口</div>
          <Form.Item name="wanDev" label={<span style={{ fontSize: 13, color: '#595959' }}>公网口设备</span>} rules={[{ required: true, message: '请选择公网口设备' }]}> 
            <Select
              placeholder="请选择网卡"
              showSearch
              loading={ifaceLoading}
              options={ifaceOptions.map(n => ({ label: n, value: n }))}
              filterOption={(input: string, option?: { label?: string; value?: string }) => ((option?.label || '').toLowerCase().includes(input.toLowerCase()))}
              onChange={(val) =>
                autoFillWanFromIface(String(val || ''), { force: true, dataSource: 'vr3' })
              }
            />
          </Form.Item>
          <Form.Item name="wanIpv4" label={<span style={{ fontSize: 13, color: '#595959' }}>公网口 IPv4 地址</span>}>
            <Input placeholder="例如：200.1.1.2/24（可选）" />
          </Form.Item>
          <Form.Item name="wanIpv6" label={<span style={{ fontSize: 13, color: '#595959' }}>公网口 IPv6 地址</span>}>
            <Input placeholder="例如：2408:3333:1002::1/64（可选）" />
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
                        options={ifaceOptions.map(n => ({ label: n, value: n }))}
                        filterOption={(input: string, option?: { label?: string; value?: string }) => ((option?.label || '').toLowerCase().includes(input.toLowerCase()))}
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
