import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, Card, Descriptions, Form, Input, InputNumber, Select, Space, Steps, message, Row, Col, Spin, Modal, Checkbox } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { useNavigate, useParams } from 'react-router-dom';
import PageContainer from '../../../../../components/PageContainer';
import { getVRConfig, saveVRConfig, setVRRole, fetchVrCacheMerged } from '../../../../../services/virtualRouterApi';
import { fetchSrv6VrReferences, proxyApiRequest } from '../../../../../services/api';
import { collectIfaceNamesForSelect, looksLikeIfaceName, pickDeviceBlobForLookup } from '../vrMergedHelpers';
import { renderIfaceWizardSelectLabel } from '../vrWizardIfaceSelect';
import { pickIfaceIpv6FromDevice } from '../vrIpv6Utils';
import {
  handleWizardStepsChange,
  validateWizardStepsThrough,
  warnFormValidationFailure,
} from '../vrWizardFormUtils';
import { sortVrConfigJsonKeys } from '../vrConfigJsonSort';

/** 读取平台侧 ce 配置；优先 ce.publicConfig，否则从根级扁平字段组装 */
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

/** 读取 LAN 列表：ce.lanConfig[]，映射 lanName/lanIpv4 等 */
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
  /** vr3_info 设备回读：用于在接口选择后反查 IP 等字段 */
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
  /** IPv6 字段回读：过滤 fe80:: link-local 地址 */
  const pickIfaceIpv6 = pickIfaceIpv6FromDevice;

  /**
   * WAN/LAN IPv4/IPv6 仅从 VR3（vr3_info）回填；force 为 true 时忽略 isFieldTouched
   * force：强制用 VR3 覆盖；否则用户已 touch 的 IP 字段不覆盖
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
  /** 记录上一轮 vr3：未改口名时勿用新 vr3Info 覆盖用户已编辑的 WAN/LAN IP */
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
        setIfaceOptions(Array.from(new Set(names)).filter((n) => looksLikeIfaceName(n)));
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

  /** 拉取 VR 缓存合并数据；网卡 IP 供 autoFillFromIface / mirror 使用 */
  const refreshDeviceData = useCallback(async (silent = false) => {
    if (!uuid) return;
    setIfaceLoading(true);
    try {
      const merged = await fetchVrCacheMerged(uuid);
      if (!merged || typeof merged !== 'object') {
        if (!silent) message.warning('未获取到设备回读数据，请先确认 IBR 设备在线/已接入。');
        setCsmctlCfg(null);
        setVr3Info(null);
        return;
      }
      setIfaceOptions(collectIfaceNamesForSelect(merged as Record<string, any>).filter(looksLikeIfaceName));
      setCsmctlCfg(pickDeviceBlobForLookup(merged));
      setVr3Info(merged.vr3_info && typeof merged.vr3_info === 'object' ? merged.vr3_info : null);
      if (!silent) message.success('设备回读已刷新');
    } catch (err) {
      console.warn('[CEWizard] fetchVrCacheMerged:', (err as any)?.message || err);
      if (!silent) message.error('设备回读失败');
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

  /** 将 host IPv4 CIDR 转为网段，如 130.1.1.9/24 → 130.1.1.0/24 */
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

  const buildConfigFromValues = (v: any): Record<string, unknown> => {
    const cfg: Record<string, unknown> = {};
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

    return sortVrConfigJsonKeys(cfg, 'ce');
  };

  const watchedValues = Form.useWatch([], form);
  const configPreview = useMemo(
    () => buildConfigFromValues(form.getFieldsValue(true) || {}),
    // buildConfigFromValues 使用当前 watchedValues 快照
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [watchedValues, form],
  );

  const CE_STEP0_FIELDS: string[] = ['wanName', 'wanIpv4', 'wanIpv6', 'bgpAsn', 'bgpRouterId'];
  const CE_STEP1_FIELDS: string[] = ['lanName', 'lanIpv4', 'lanIpv6'];

  const ceFieldsForStep = (step: number) => (step === 0 ? CE_STEP0_FIELDS : step === 1 ? CE_STEP1_FIELDS : []);

  const validateCeStepsThrough = (from: number, to: number) =>
    validateWizardStepsThrough(form, from, to, ceFieldsForStep);

  const next = async () => {
    try {
      const ok = await validateCeStepsThrough(current, current + 1);
      if (!ok) return;
      setCurrent((c) => Math.min(2, c + 1));
    } catch (err) {
      warnFormValidationFailure(err);
    }
  };
  const prev = () => setCurrent((c) => Math.max(0, c - 1));

  const handleStepsChange = (idx: number) => {
    void handleWizardStepsChange(idx, current, setCurrent, validateCeStepsThrough);
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
      console.warn('CEWizard: fetchSrv6VrReferences failed:', e);
    }
    try {
      await form.validateFields();
    } catch {
      message.warning('请先完善表单必填项');
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
          message.error(`WAN 侧接口“${selectedWan}”不在设备回读列表中，请重新选择。可用接口：${listStr}`);
          return;
        }
        if (selectedLan && !reported.has(selectedLan)) {
          const listStr = reportedArr.join(', ');
          message.error(`LAN 侧接口“${selectedLan}”不在设备回读列表中，请重新选择。可用接口：${listStr}`);
          return;
        }
      }
      const cfg = buildConfigFromValues(values);
      if (!cfg || (typeof cfg === 'object' && Object.keys(cfg).length === 0)) {
        message.warning('配置为空，请先完成第 1/2 步配置后再下发。');
        return;
      }
      if (uuid) cfg.uuid = uuid;
      setLoading(true);

      // 1. 先保存到平台（saveVRConfig + setVRRole），失败则中止设备下发
      let finalCfg = cfg;
      try {
        const existing = await getVRConfig(uuid);

        // Remove existing ce/role to ensure they are sorted correctly
        const cleanExisting: Record<string, unknown> = {
          ...(existing && typeof existing === 'object' && !Array.isArray(existing)
            ? (existing as Record<string, unknown>)
            : {}),
        };
        delete cleanExisting.ce;
        delete cleanExisting.role;

        finalCfg = sortVrConfigJsonKeys({ ...cleanExisting, ...cfg }, 'ce');
        await saveVRConfig(uuid, finalCfg);
        await setVRRole(uuid, 'CE');
      } catch (e: any) {
        console.warn('handleDispatch: saveVRConfig/setVRRole failed:', e);
        throw new Error(e?.message || '保存到平台失败，已中止设备下发');
      }

      // 2. 再经代理 POST /V2/ctcontrol/VR2/VRConfig，other 为 uuid=...
      const path = '/V2/ctcontrol/VR2/VRConfig';
      const method = 'POST';
      const other = `uuid=${uuid}`;
      const data = await proxyApiRequest(path, method, other, cfg);
      if (data && typeof data.code === 'number' && data.code !== 200) {
        throw new Error(data?.msg || `下发失败: ${JSON.stringify(data)}`);
      }
      message.success(data?.msg || '配置已下发');
    } catch (err: any) {
      message.error(`下发失败：${err?.message || '未知错误'}`);
    } finally {
      setLoading(false);
    }
  };

  const renderCoreContent = () => {
    // 左侧 Form 编辑 + 右侧 mirror；步骤 0/1 用 display 切换，避免卸载 form 丢值
    const summaryValues = form.getFieldsValue(true);
    return (
      <>
        <Form
          form={form}
          layout="vertical"
          style={{ display: current === 2 ? 'none' : undefined }}
        >
          <div style={{ display: current === 0 ? 'block' : 'none' }}>
            <div style={{ fontSize: 13, color: '#1677ff', margin: '4px 0 12px 0', borderBottom: '1px solid #e8e8e8', paddingBottom: 6 }}>WAN 侧配置（CE to PE）</div>
            <Form.Item name="wanName" label={<span style={{ fontSize: 13, color: '#595959' }}>WAN 侧接口</span>} rules={[{ required: true, message: '请选择 WAN 侧接口' }]} preserve>
              <Select
                placeholder="请选择接口"
                showSearch
                loading={ifaceLoading}
                options={ifaceOptions.map((n) => ({
                  value: n,
                  label: renderIfaceWizardSelectLabel(n, lanIfaceTrim && n === lanIfaceTrim ? '已用于 LAN' : undefined),
                }))}
                filterOption={(input: string, option?: { value?: string }) =>
                  String(option?.value || '')
                    .toLowerCase()
                    .includes(input.toLowerCase())
                }
                onChange={(val) => autoFillFromIface('wan', String(val || ''), { force: true })}
              />
            </Form.Item>
            <Form.Item name="wanIpv4" label={<span style={{ fontSize: 13, color: '#595959' }}>WAN 侧 IPv4 地址/掩码</span>} preserve>
              <Input placeholder="例如 200.1.1.2/24" />
            </Form.Item>
            <Form.Item name="wanIpv6" label={<span style={{ fontSize: 13, color: '#595959' }}>WAN 侧 IPv6 地址/掩码</span>} preserve>
              <Input placeholder="例如 2408:3333:1002::1/64" />
            </Form.Item>
            <div style={{ height: 12 }} />
            <div style={{ fontSize: 13, color: '#1677ff', margin: '4px 0 12px 0', borderBottom: '1px solid #e8e8e8', paddingBottom: 6 }}>BGP 配置（CE to PE）</div>
            <Form.Item name="bgpAsn" label={<span style={{ fontSize: 13, color: '#595959' }}>BGP ASN</span>} rules={[{ required: true, message: '请输入 BGP ASN' }]} preserve>
              <InputNumber style={{ width: '100%' }} placeholder="例如 100" min={1} max={4294967295} />
            </Form.Item>
            <Form.Item
              name="bgpRouterId"
              label={<span style={{ fontSize: 13, color: '#595959' }}>BGP Router-ID</span>}
              rules={[
                { required: true, message: '请输入 Router-ID' },
                { pattern: /^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/, message: '请输入有效的 IPv4 地址' },
              ]}
              preserve
            >
              <Input placeholder="例如 200.1.1.2" />
            </Form.Item>
          </div>
          <div style={{ display: current === 1 ? 'block' : 'none' }}>
            <div style={{ fontSize: 13, color: '#1677ff', margin: '4px 0 12px 0', borderBottom: '1px solid #e8e8e8', paddingBottom: 6 }}>LAN 侧配置（CE to local）</div>
            <Form.Item name="lanName" label={<span style={{ fontSize: 13, color: '#595959' }}>LAN 侧接口</span>} rules={[{ required: true, message: '请选择 LAN 侧接口' }]} preserve>
              <Select
                placeholder="请选择接口"
                showSearch
                loading={ifaceLoading}
                options={ifaceOptions.map((n) => ({
                  value: n,
                  label: renderIfaceWizardSelectLabel(n, wanIfaceTrim && n === wanIfaceTrim ? '已用于 WAN' : undefined),
                }))}
                filterOption={(input: string, option?: { value?: string }) =>
                  String(option?.value || '')
                    .toLowerCase()
                    .includes(input.toLowerCase())
                }
                onChange={(val) => autoFillFromIface('lan', String(val || ''), { force: true })}
              />
            </Form.Item>
            <Form.Item name="lanIpv4" label={<span style={{ fontSize: 13, color: '#595959' }}>LAN 侧 IPv4 地址/掩码</span>} preserve>
              <Input placeholder="例如 130.1.1.1/24" />
            </Form.Item>
            <Form.Item name="lanIpv6" label={<span style={{ fontSize: 13, color: '#595959' }}>LAN 侧 IPv6 地址/掩码</span>} preserve>
              <Input placeholder="例如 2408:3333:1002::1/64" />
            </Form.Item>
          </div>
        </Form>
        {current === 2 && (
          <div>
            <Descriptions column={1} bordered size="small">
              <Descriptions.Item label="WAN 侧接口">{summaryValues.wanName || '-'}</Descriptions.Item>
              <Descriptions.Item label="WAN 侧 IPv4">{summaryValues.wanIpv4 || '-'}</Descriptions.Item>
              <Descriptions.Item label="WAN 侧 IPv6">{summaryValues.wanIpv6 || '-'}</Descriptions.Item>
              <Descriptions.Item label="BGP ASN">{summaryValues.bgpAsn || '-'}</Descriptions.Item>
              <Descriptions.Item label="BGP Router-ID">{summaryValues.bgpRouterId || '-'}</Descriptions.Item>
              <Descriptions.Item label="LAN 侧接口">{summaryValues.lanName || '-'}</Descriptions.Item>
              <Descriptions.Item label="LAN 侧 IPv4">{summaryValues.lanIpv4 || '-'}</Descriptions.Item>
              <Descriptions.Item label="LAN 侧 IPv6">{summaryValues.lanIpv6 || '-'}</Descriptions.Item>
            </Descriptions>
          </div>
        )}
      </>
    );
  };

  return (
    <PageContainer
      titleLevel={3}
      extra={<Button icon={<ReloadOutlined />} onClick={() => refreshDeviceData()}>刷新设备回读</Button>}
      onBack={() => navigate(-1)}
      asCard={false}
    >
      <Row gutter={16}>
        <Col span={4}>
          <Card size="small" title={<span style={{ fontSize: 13, color: '#000', fontWeight: 400 }}>步骤</span>} variant="outlined" style={{ position: 'sticky', top: 16 }}>
            <Steps direction="vertical" size="small" current={current} onChange={handleStepsChange} items={[{ title: 'WAN 侧配置（CE to PE）' }, { title: 'LAN 侧配置（CE to local）' }, { title: '确认下发' }]} />
          </Card>
        </Col>
        <Col span={7}>
          <Card size="small" title={<span style={{ fontSize: 13, color: '#000', fontWeight: 400 }}>
            {`第 ${current + 1} 步：${['WAN 侧配置（CE to PE）','LAN 侧配置（CE to local）','确认下发'][current]} 设备回读`}
          </span>} variant="outlined">
            {ifaceLoading ? (
              <div style={{ textAlign: 'center', padding: '32px 0' }}>
                <Spin />
              </div>
            ) : csmctlCfg ? (
              <>
                {current === 0 && (
                  <>
                    <div style={{ fontSize: 13, color: '#1677ff', margin: '4px 0 12px 0', borderBottom: '1px solid #e8e8e8', paddingBottom: 6 }}>WAN 侧配置（CE to PE）</div>
                    <Form layout="vertical" form={mirrorForm} disabled>
                      <Form.Item name="wanName" label={<span style={{ fontSize: 13, color: '#595959' }}>WAN 侧接口</span>}>
                        <Select
                          placeholder="未配置"
                          showSearch
                          loading={ifaceLoading}
                          options={[
                            ...(mirrorForm.getFieldValue('wanName') ? [{ label: String(mirrorForm.getFieldValue('wanName')), value: String(mirrorForm.getFieldValue('wanName')) }] : []),
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
                      <div style={{ fontSize: 13, color: '#1677ff', margin: '4px 0 12px 0', borderBottom: '1px solid #e8e8e8', paddingBottom: 6 }}>BGP 配置（CE to PE）</div>
                      <Form.Item name="bgpAsn" label={<span style={{ fontSize: 13, color: '#595959' }}>BGP ASN</span>}>
                        <InputNumber style={{ width: '100%' }} placeholder="未配置" />
                      </Form.Item>
                      <Form.Item name="bgpRouterId" label={<span style={{ fontSize: 13, color: '#595959' }}>BGP Router-ID</span>}>
                        <Input placeholder="未配置" />
                      </Form.Item>
                    </Form>
                  </>
                )}
                {current === 1 && (
                  <>
                    <div style={{ fontSize: 13, color: '#1677ff', margin: '4px 0 12px 0', borderBottom: '1px solid #e8e8e8', paddingBottom: 6 }}>LAN 侧配置（CE to local）</div>
                    <Form layout="vertical" form={mirrorForm} disabled>
                      <Form.Item name="lanName" label={<span style={{ fontSize: 13, color: '#595959' }}>LAN 侧接口</span>}>
                        <Select
                          placeholder="未配置"
                          showSearch
                          loading={ifaceLoading}
                          options={[
                            ...(mirrorForm.getFieldValue('lanName') ? [{ label: String(mirrorForm.getFieldValue('lanName')), value: String(mirrorForm.getFieldValue('lanName')) }] : []),
                            ...ifaceOptions.map(n => ({ label: n, value: n })),
                          ]}
                        />
                      </Form.Item>
                      <Form.Item name="lanIpv4" label={<span style={{ fontSize: 13, color: '#595959' }}>LAN 侧 IPv4 地址/掩码</span>}>
                        <Input placeholder="未配置" />
                      </Form.Item>
                      <Form.Item name="lanIpv6" label={<span style={{ fontSize: 13, color: '#595959' }}>LAN 侧 IPv6 地址/掩码</span>}>
                        <Input placeholder="未配置" />
                      </Form.Item>
                    </Form>
                  </>
                )}
                {current === 2 && (
                  <>
                    <Descriptions column={1} bordered size="small">
                      <Descriptions.Item label="WAN 侧接口">{mirrorForm.getFieldValue('wanName') || '-'}</Descriptions.Item>
                      <Descriptions.Item label="WAN 侧 IPv4">{mirrorForm.getFieldValue('wanIpv4') || '-'}</Descriptions.Item>
                      <Descriptions.Item label="WAN 侧 IPv6">{mirrorForm.getFieldValue('wanIpv6') || '-'}</Descriptions.Item>
                      <Descriptions.Item label="BGP ASN">{mirrorForm.getFieldValue('bgpAsn') || '-'}</Descriptions.Item>
                      <Descriptions.Item label="BGP Router-ID">{mirrorForm.getFieldValue('bgpRouterId') || '-'}</Descriptions.Item>
                      <Descriptions.Item label="LAN 侧接口">{mirrorForm.getFieldValue('lanName') || '-'}</Descriptions.Item>
                      <Descriptions.Item label="LAN 侧 IPv4">{mirrorForm.getFieldValue('lanIpv4') || '-'}</Descriptions.Item>
                      <Descriptions.Item label="LAN 侧 IPv6">{mirrorForm.getFieldValue('lanIpv6') || '-'}</Descriptions.Item>
                    </Descriptions>
                  </>
                )}
              </>
            ) : (
              <div style={{ padding: 12, background: '#fffbe6', border: '1px dashed #faad14', borderRadius: 6, color: '#faad14', fontSize: 12 }}>
                未能读取设备回读数据，请先检查设备连接状态或稍后重试。
              </div>
            )}
          </Card>
        </Col>
        <Col span={8}>
          <Card size="small" title={<span style={{ fontSize: 13, color: '#000', fontWeight: 400 }}>
            {`第 ${current + 1} 步：${['WAN 侧配置（CE to PE）','LAN 侧配置（CE to local）','确认下发'][current]} 配置编辑`}
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
                  <>
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
                  </>
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

export default CEWizard;
