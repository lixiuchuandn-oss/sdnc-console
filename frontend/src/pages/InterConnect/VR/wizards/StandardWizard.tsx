import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Card, Descriptions, Form, Input, message, Row, Col, Space, Steps, Spin, Select, Switch, Modal, Checkbox } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { useNavigate, useParams } from 'react-router-dom';
import PageContainer from '../../../../components/PageContainer';
import { getVRConfig, saveVRConfig, setVRRole, getVR2Config } from '../../../../services/virtualRouterApi';
import { proxyApiRequest } from '../../../../services/api';

const StandardWizard: React.FC = () => {
  const navigate = useNavigate();
  const { uuid } = useParams();
  const [form] = Form.useForm();
  const [mirrorForm] = Form.useForm();
  const [current, setCurrent] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(false);
  const [existingCfg, setExistingCfg] = useState<any>({});
  const [deviceCfg, setDeviceCfg] = useState<any>(null);
  const [ifaceOptions, setIfaceOptions] = useState<string[]>([]);
  const [ifaceLoading, setIfaceLoading] = useState<boolean>(false);
  const [confirmOpen, setConfirmOpen] = useState<boolean>(false);
  const [confirmChecked, setConfirmChecked] = useState<boolean>(false);

  // ... (keep existing code)

  useEffect(() => {
    if (!deviceCfg) return;
    
    // 辅助函数：在 deviceCfg 中查找接口信息
    const findInterfaceInDevice = (dev: any, ifaceName: string) => {
      if (!dev || !ifaceName) return null;
      let found: any = null;
      Object.keys(dev).forEach(key => {
        if (found) return;
        if ((key.startsWith('interfaces_') || key.startsWith('subinterfaces_')) && Array.isArray(dev[key])) {
           found = dev[key].find((item: any) => item.name === ifaceName);
        }
      });
      return found;
    };

    // 辅助函数：查找默认路由网关
    const findDefaultGateway = (dev: any) => {
      if (!dev || !Array.isArray(dev.ipv4_route)) return undefined;
      const route = dev.ipv4_route.find((r: any) => r.destination === '0.0.0.0/0');
      return route ? (route.via || route.dev) : undefined;
    };

    const wanIfName = existingCfg?.ipsec_preset?.wan_interface;
    const lanIfName = existingCfg?.ipsec_preset?.lan_interface;
    const wanIfObj = findInterfaceInDevice(deviceCfg, wanIfName);
    const lanIfObj = findInterfaceInDevice(deviceCfg, lanIfName);
    const gateway = findDefaultGateway(deviceCfg);
    const wanNat = wanIfObj?.nat;
    const isNatEnabled = !!(wanNat && wanNat.type && wanNat.type !== '');

    mirrorForm.setFieldsValue({
      wanInterface: wanIfName,
      wanIpv4: wanIfObj?.ipv4_static,
      wanIpv6: wanIfObj?.ipv6_static,
      ipsecPublicIp: gateway,
      enableNat: isNatEnabled,
      lanInterface: lanIfName,
      lanIpv4: lanIfObj?.ipv4_static,
      lanIpv6: lanIfObj?.ipv6_static,
    });
  }, [existingCfg, deviceCfg, mirrorForm]);

  const fetchInterfaces = useCallback(async (silent = false) => {
    if (!uuid) return;
    setIfaceLoading(true);
    try {
      // 1. 获取接口列表 (参考 PEWizard)
      const method = 'GET';
      const other = `uuid=${uuid}`;
      const path = '/V2/ctcontrol/VR3/VRConfig/list';
      const raw = await proxyApiRequest(path, method, other);
      const unwrapData = (obj: any) => {
        let cur = obj;
        while (cur && typeof cur === 'object' && 'data' in cur) cur = (cur as any).data;
        return cur;
      };
      const data = unwrapData(raw);
      
      const names: string[] = [];
      const collectFromArray = (arr?: any[]) => { (arr || []).forEach((it) => { if (it && typeof it === 'object' && it.name) names.push(String(it.name)); }); };
      if (data && typeof data === 'object') {
        collectFromArray((data as any).interfaces);
        Object.keys(data).forEach((key) => {
          if (key.startsWith('interfaces_') || key.startsWith('subinterfaces_')) collectFromArray((data as any)[key]);
        });
      }
      const unique = Array.from(new Set(names)).filter((n) => !!n);
      if (unique.length) setIfaceOptions(unique);

      // 2. 获取完整配置 (用于回读显示)
      const dev2 = await getVR2Config(uuid);
      setDeviceCfg(dev2 || null);
      
      if (!silent) message.success('设备数据已刷新');
    } catch (err) {
      console.error(err);
      if (!silent) message.error('刷新失败');
    } finally {
      setIfaceLoading(false);
    }
  }, [uuid]);

  const refreshDeviceData = useCallback(
    async (silent = false) => {
      await fetchInterfaces(silent);
    },
    [fetchInterfaces],
  );

  useEffect(() => {
    if (!uuid) return;
    (async () => {
      try {
        const cfg = await getVRConfig(uuid);
        setExistingCfg(cfg || {});
        const preset = cfg?.ipsec_preset || {};
        // 判定版本: version >= 2 为新版 (public_ip 存设备IP, gateway 存网关)
        const isV2 = (preset?.version || 0) >= 2;
        
        form.setFieldsValue({
          ipsecLocalSubnet: preset?.local_subnet, // 兼容旧字段，实际对应 lanIpv4
          // 如果是新版，仅读取 gateway；如果是旧版，优先读取 gateway，否则回退到 public_ip
          ipsecPublicIp: isV2 ? preset?.gateway : (preset?.gateway || preset?.public_ip),
          wanInterface: preset?.wan_interface,
          wanIpv4: preset?.wan_ipv4,
          wanIpv6: preset?.wan_ipv6,
          enableNat: preset?.enable_nat,          // 加载 NAT 开关状态
          lanInterface: preset?.lan_interface,
          lanIpv4: preset?.lan_ipv4 || preset?.local_subnet, // 优先取新字段
          lanIpv6: preset?.lan_ipv6,
        });
        // 初始加载设备数据
        refreshDeviceData(true);
      } catch {}
    })();
  }, [uuid, form, refreshDeviceData]);

  const buildConfigFromValues = (v: any) => {
    // 兼容旧字段名
    const wanGateway = String(v?.ipsecPublicIp || '').trim();
    
    const wanInterface = String(v?.wanInterface || '').trim();
    const wanIpv4 = String(v?.wanIpv4 || '').trim();
    const wanIpv6 = String(v?.wanIpv6 || '').trim();
    const enableNat = !!v?.enableNat;
    
    const lanInterface = String(v?.lanInterface || '').trim();
    const lanIpv4 = String(v?.lanIpv4 || '').trim();
    const lanIpv6 = String(v?.lanIpv6 || '').trim();
    
    const cfg: any = {};
    // 保留 Standard Mode 特有的预置参数，用于回读
    // 从 wanIpv4 提取纯 IP 地址 (去除 CIDR 掩码) 作为 public_ip
    const wanIpOnly = wanIpv4 ? wanIpv4.split('/')[0] : undefined;

    cfg.ipsec_preset = {
      version: 2,                         // 标识元数据版本 (v2: public_ip 为设备IP, gateway 为网关)
      wan_interface: wanInterface || undefined,
      wan_ipv4: wanIpv4 || undefined,
      wan_ipv6: wanIpv6 || undefined,
      gateway: wanGateway || undefined,   // 新增：明确存储网关地址
      public_ip: wanIpOnly,               // 修改：存储设备公网 IP (不含掩码)，供 IPsec 使用
      enable_nat: enableNat,              // 保存 NAT 开关状态
      lan_interface: lanInterface || undefined,
      lan_ipv4: lanIpv4 || undefined,
      lan_ipv6: lanIpv6 || undefined,
      local_subnet: lanIpv4 || undefined, // 同时也作为 local_subnet
    };

    // 构建符合 VR 接口规范的配置 (interfaces, routes)
    const ipv4CidrPattern = /^(?:(?:[0-9]|[1-9][0-9]|1[0-9]{2}|2[0-4][0-9]|25[0-5])\.){3}(?:[0-9]|[1-9][0-9]|1[0-9]{2}|2[0-4][0-9]|25[0-5])\/([0-9]|[1-2]\d|3[0-2])$/;
    const normalizeIPv4Cidr = (s: any) => {
      const t = String(s || '').trim();
      return ipv4CidrPattern.test(t) ? t : undefined;
    };

    const ifaceObjs: any[] = [];
    
    // 1. WAN 接口配置
    if (wanInterface) {
      const item: any = { name: wanInterface, status: 'up' };
      const w4 = normalizeIPv4Cidr(wanIpv4);
      if (w4) item.ipv4_static = w4;
      if (wanIpv6) item.ipv6_static = wanIpv6;
      
      // 如果开启 NAT，配置为 outside
      if (enableNat) {
        item.nat = { type: 'outside' };
      }
      
      ifaceObjs.push(item);
    }

    // 2. LAN 接口配置
    if (lanInterface) {
      const item: any = { name: lanInterface, status: 'up' };
      const l4 = normalizeIPv4Cidr(lanIpv4);
      if (l4) item.ipv4_static = l4;
      if (lanIpv6) item.ipv6_static = lanIpv6;
      
      // 如果开启 NAT，配置为 inside
      if (enableNat) {
        item.nat = { type: 'inside' };
      }

      ifaceObjs.push(item);
    }

    // 3. 将接口分类放入 buckets (参考 PEWizard)
    if (ifaceObjs.length) {
      const buckets: Record<string, any[]> = {
        interfaces_GigabitEthernet: [],
        subinterfaces_GigabitEthernet: [],
        interfaces_lo: [],
        interfaces_Tunnel: [],
        subinterfaces_Tunnel: [],
      };
      ifaceObjs.forEach((item) => {
        const name: string = String(item?.name || '');
        let bucketKey = 'interfaces_GigabitEthernet';
        const isSub = name.includes('.');
        
        if (name.startsWith('GigabitEthernet') || name.startsWith('GE')) {
          bucketKey = isSub ? 'subinterfaces_GigabitEthernet' : 'interfaces_GigabitEthernet';
        } else if (name.startsWith('lo') || name.startsWith('Loopback')) {
          bucketKey = 'interfaces_lo';
        } else if (name.startsWith('Tunnel')) {
          bucketKey = isSub ? 'subinterfaces_Tunnel' : 'interfaces_Tunnel';
        } else {
          bucketKey = isSub ? 'subinterfaces_GigabitEthernet' : 'interfaces_GigabitEthernet';
        }
        (buckets[bucketKey] || (buckets[bucketKey] = [])).push(item);
      });
      Object.keys(buckets).forEach((k) => { if ((buckets as any)[k]?.length) (cfg as any)[k] = (buckets as any)[k]; });
    }

    // 4. 路由配置
    // 如果填写了 "公网网关地址"，则生成默认路由
    if (wanInterface && wanGateway && ipv4CidrPattern.test(wanGateway + '/32') ) { 
      // 0.0.0.0/0 via wanGateway
      cfg.ipv4_route = [{ destination: '0.0.0.0/0', via: wanGateway, priority: 100 }];
    }

    return cfg;
  };

  // 使用 useWatch 实时预览
  const watchedValues = Form.useWatch([], form);
  const configPreview = useMemo(
    () => buildConfigFromValues(watchedValues || form.getFieldsValue(true) || {}),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [watchedValues, form],
  );

  const next = async () => {
    try {
      if (current === 0) {
        // 校验 WAN 侧
        await form.validateFields(['wanInterface', 'wanIpv4', 'wanIpv6', 'ipsecPublicIp']);
      } else if (current === 1) {
        // 校验 LAN 侧
        await form.validateFields(['lanInterface', 'lanIpv4', 'lanIpv6']);
      }
      const newCurrent = Math.min(2, current + 1);
      setCurrent(newCurrent);
      if (newCurrent === 2) {
        await refreshDeviceData(true);
      }
    } catch {}
  };
  const prev = () => setCurrent((c) => Math.max(0, c - 1));

  const sortJsonKeys = (obj: any): any => {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return obj;
    
    // 递归处理子对象（深层排序）
    const copy = { ...obj };
    Object.keys(copy).forEach(k => {
      copy[k] = sortJsonKeys(copy[k]);
    });

    // 对最外层进行排序：uuid, role, ipsec_preset 优先
    const keys = Object.keys(copy).sort((a, b) => {
       const prio = (k: string) => {
         if (k === 'uuid') return -1;
         if (k === 'role') return 0;
         if (k === 'ipsec_preset') return 1;
         if (k === 'ce') return 2;
         if (k === 'pe') return 3;
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

  const handleSave = async () => {
    if (!uuid) {
      message.error('缺少 VR 的 UUID，无法下发配置');
      return;
    }
    try {
      setLoading(true);
      const values = form.getFieldsValue(true);
      let cfg = buildConfigFromValues(values);
      if (uuid) cfg.uuid = uuid;
      cfg.role = '标准'; // 确保 role 存在

      // 1. 同步保存到本地数据库 (包含 ipsec_preset)
      try {
        const existing = await getVRConfig(uuid);
        // 合并并排序，确保本地存储也是有序的
        const newCfg = sortJsonKeys({ ...(existing || {}), ...cfg });
        await saveVRConfig(uuid, newCfg);
        await setVRRole(uuid, '标准');
      } catch (e) {
        console.warn('保存到本地数据库失败:', e);
      }

      // 2. 下发配置到设备 (专家模式接口)
      let deviceCfg = { ...cfg };
      
      // 剔除元数据
      // delete deviceCfg.ipsec_preset; // 保留 ipsec_preset 以便从设备回读
      delete deviceCfg.ce;
      delete deviceCfg.pe;
      
      // 对下发配置进行排序
      deviceCfg = sortJsonKeys(deviceCfg);

      const method = 'POST';
      const other = `uuid=${uuid}`;
      const path = '/V2/ctcontrol/VR2/VRConfig';
      const bodyStr = JSON.stringify(deviceCfg);
      
      const data = await proxyApiRequest(path, method, other, JSON.parse(bodyStr));
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

  const renderDeviceStatus = (cfg: any) => {
    if (!cfg || Object.keys(cfg).length === 0) {
      return <div style={{ padding: 12, background: '#fffbe6', border: '1px dashed #faad14', borderRadius: 6, color: '#faad14', fontSize: 12 }}>未获取到设备配置（设备回读为空）</div>;
    }

    if (current === 0) {
      return (
        <Form form={mirrorForm} layout="vertical" disabled>
          <div style={{ fontSize: 13, color: '#1677ff', margin: '4px 0 12px 0', borderBottom: '1px solid #e8e8e8', paddingBottom: 6 }}>WAN 侧配置</div>
          <Form.Item label="外网接口 (WAN)" name="wanInterface"><Input /></Form.Item>
          <Form.Item label="外网 IPv4 (CIDR)" name="wanIpv4"><Input /></Form.Item>
          <Form.Item label="外网 IPv6 (CIDR)" name="wanIpv6"><Input /></Form.Item>
          <Form.Item label="公网网关 (IPv4)" name="ipsecPublicIp"><Input /></Form.Item>
          <Form.Item label="开启 NAT (SNAT)" name="enableNat" valuePropName="checked"><Switch /></Form.Item>
        </Form>
      );
    }
    
    if (current === 1) {
      return (
        <Form form={mirrorForm} layout="vertical" disabled>
          <div style={{ fontSize: 13, color: '#1677ff', margin: '4px 0 12px 0', borderBottom: '1px solid #e8e8e8', paddingBottom: 6 }}>LAN 侧配置</div>
          <Form.Item label="内网接口 (LAN)" name="lanInterface"><Input /></Form.Item>
          <Form.Item label="内网 IPv4 (CIDR)" name="lanIpv4"><Input /></Form.Item>
          <Form.Item label="内网 IPv6 (CIDR)" name="lanIpv6"><Input /></Form.Item>
        </Form>
      );
    }

    if (current === 2) {
      const values = mirrorForm.getFieldsValue(true);
      return (
        <div style={{ display: 'block' }}>
          <div style={{ fontSize: 13, color: '#1677ff', margin: '4px 0 12px 0', borderBottom: '1px solid #e8e8e8', paddingBottom: 6 }}>WAN 侧配置确认</div>
          <Descriptions column={1} bordered size="small">
            <Descriptions.Item label="外网接口 (WAN)">{values.wanInterface || '-'}</Descriptions.Item>
            <Descriptions.Item label="外网 IPv4">{values.wanIpv4 || '-'}</Descriptions.Item>
            <Descriptions.Item label="外网 IPv6">{values.wanIpv6 || '-'}</Descriptions.Item>
            <Descriptions.Item label="公网网关">{values.ipsecPublicIp || '-'}</Descriptions.Item>
            <Descriptions.Item label="NAT (SNAT)">{values.enableNat ? '开启' : '关闭'}</Descriptions.Item>
          </Descriptions>

          <div style={{ height: 16 }} />

          <div style={{ fontSize: 13, color: '#1677ff', margin: '4px 0 12px 0', borderBottom: '1px solid #e8e8e8', paddingBottom: 6 }}>LAN 侧配置确认</div>
          <Descriptions column={1} bordered size="small">
            <Descriptions.Item label="内网接口 (LAN)">{values.lanInterface || '-'}</Descriptions.Item>
            <Descriptions.Item label="内网 IPv4">{values.lanIpv4 || '-'}</Descriptions.Item>
            <Descriptions.Item label="内网 IPv6">{values.lanIpv6 || '-'}</Descriptions.Item>
          </Descriptions>
        </div>
      );
    }

    return null;
  };

  const renderCoreContent = () => {
    // 3. 确认保存 - 准备预览数据
    const values = form.getFieldsValue(true);

    return (
      <Form form={form} layout="vertical">
        {/* Step 1: WAN 侧配置 */}
        <div style={{ display: current === 0 ? 'block' : 'none' }}>
          <div style={{ fontSize: 13, color: '#1677ff', margin: '4px 0 12px 0', borderBottom: '1px solid #e8e8e8', paddingBottom: 6 }}>WAN 侧配置</div>
          <div style={{ marginBottom: 16 }}>
            <Form.Item
              name="wanInterface"
              label={<span style={{ fontSize: 13, color: '#595959' }}>外网接口 (WAN)</span>}
              tooltip="用于建立隧道的接口（通常连接公网）"
              rules={[{ required: true, message: '请选择外网接口' }]}
            >
              <Select placeholder="请选择接口" showSearch allowClear>
                {ifaceOptions.map((n) => (
                  <Select.Option key={n} value={n}>{n}</Select.Option>
                ))}
              </Select>
            </Form.Item>
            <Form.Item
              name="wanIpv4"
              label={<span style={{ fontSize: 13, color: '#595959' }}>外网 IPv4 (CIDR)</span>}
              rules={[{ pattern: /^(?:(?:[0-9]|[1-9][0-9]|1[0-9]{2}|2[0-4][0-9]|25[0-5])\.){3}(?:[0-9]|[1-9][0-9]|1[0-9]{2}|2[0-4][0-9]|25[0-5])\/([0-9]|[1-2]\d|3[0-2])$/, message: 'IPv4 CIDR 示例：1.2.3.4/24' }]}
            >
              <Input placeholder="例如：1.2.3.4/24" />
            </Form.Item>
            <Form.Item
              name="wanIpv6"
              label={<span style={{ fontSize: 13, color: '#595959' }}>外网 IPv6 (CIDR)</span>}
            >
              <Input placeholder="例如：2001:db8::1/64" />
            </Form.Item>
            <Form.Item
              name="ipsecPublicIp"
              label={<span style={{ fontSize: 13, color: '#595959' }}>公网网关 (IPv4)</span>}
              tooltip="用于生成默认路由 (0.0.0.0/0 via Gateway)"
              rules={[{ pattern: /^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/, message: '请输入合法的 IPv4 地址' }]}
            >
              <Input placeholder="例如：1.2.3.1（网关地址）" />
            </Form.Item>
            
            <Form.Item
              name="enableNat"
              valuePropName="checked"
              label={<span style={{ fontSize: 13, color: '#595959' }}>开启 NAT (SNAT)</span>}
              tooltip="开启后，LAN 侧访问外网时将自动进行源地址转换 (Masquerade)"
            >
              <Switch checkedChildren="开启" unCheckedChildren="关闭" />
            </Form.Item>
          </div>
        </div>

        {/* Step 2: LAN 侧配置 */}
        <div style={{ display: current === 1 ? 'block' : 'none' }}>
          <div style={{ fontSize: 13, color: '#1677ff', margin: '4px 0 12px 0', borderBottom: '1px solid #e8e8e8', paddingBottom: 6 }}>LAN 侧配置</div>
          <div>
            <Form.Item
              name="lanInterface"
              label={<span style={{ fontSize: 13, color: '#595959' }}>内网接口 (LAN)</span>}
              tooltip="用于连接内部网络的接口"
              rules={[{ required: true, message: '请选择内网接口' }]}
            >
              <Select placeholder="请选择接口" showSearch allowClear>
                {ifaceOptions.map((n) => (
                  <Select.Option key={n} value={n}>{n}</Select.Option>
                ))}
              </Select>
            </Form.Item>
            <Form.Item
              name="lanIpv4"
              label={<span style={{ fontSize: 13, color: '#595959' }}>内网 IPv4 (CIDR)</span>}
              rules={[{ required: true, message: '请输入内网 IPv4' }, { pattern: /^(?:(?:[0-9]|[1-9][0-9]|1[0-9]{2}|2[0-4][0-9]|25[0-5])\.){3}(?:[0-9]|[1-9][0-9]|1[0-9]{2}|2[0-4][0-9]|25[0-5])\/([0-9]|[1-2]\d|3[0-2])$/, message: 'IPv4 CIDR 示例：192.168.1.1/24' }]}
            >
              <Input placeholder="例如：192.168.1.1/24" />
            </Form.Item>
            <Form.Item
              name="lanIpv6"
              label={<span style={{ fontSize: 13, color: '#595959' }}>内网 IPv6 (CIDR)</span>}
            >
              <Input placeholder="例如：fd00::1/64" />
            </Form.Item>
          </div>
        </div>

        {/* Step 3: 确认下发 */}
        <div style={{ display: current === 2 ? 'block' : 'none' }}>
          <div style={{ fontSize: 13, color: '#1677ff', margin: '4px 0 12px 0', borderBottom: '1px solid #e8e8e8', paddingBottom: 6 }}>WAN 侧配置确认</div>
          <Descriptions column={1} bordered size="small">
            <Descriptions.Item label="外网接口 (WAN)">{values.wanInterface || '-'}</Descriptions.Item>
            <Descriptions.Item label="外网 IPv4">{values.wanIpv4 || '-'}</Descriptions.Item>
            <Descriptions.Item label="外网 IPv6">{values.wanIpv6 || '-'}</Descriptions.Item>
            <Descriptions.Item label="公网网关">{values.ipsecPublicIp || '-'}</Descriptions.Item>
            <Descriptions.Item label="NAT (SNAT)">{values.enableNat ? '开启' : '关闭'}</Descriptions.Item>
          </Descriptions>

          <div style={{ height: 16 }} />

          <div style={{ fontSize: 13, color: '#1677ff', margin: '4px 0 12px 0', borderBottom: '1px solid #e8e8e8', paddingBottom: 6 }}>LAN 侧配置确认</div>
          <Descriptions column={1} bordered size="small">
            <Descriptions.Item label="内网接口 (LAN)">{values.lanInterface || '-'}</Descriptions.Item>
            <Descriptions.Item label="内网 IPv4">{values.lanIpv4 || '-'}</Descriptions.Item>
            <Descriptions.Item label="内网 IPv6">{values.lanIpv6 || '-'}</Descriptions.Item>
          </Descriptions>
        </div>
      </Form>
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
            <Steps direction="vertical" size="small" current={current} onChange={(idx) => setCurrent(idx)} items={[{ title: 'WAN 侧配置' }, { title: 'LAN 侧配置' }, { title: '确认下发' }]} />
          </Card>
        </Col>
        <Col span={7}>
          <Card size="small" title={<span style={{ fontSize: 13, color: '#000', fontWeight: 400 }}>{`第 ${current + 1} 步：${['WAN 侧配置', 'LAN 侧配置', '确认下发'][current]} 设备回读`}</span>} variant="outlined">
            {ifaceLoading ? (
              <div style={{ textAlign: 'center', padding: '32px 0' }}>
                <Spin />
              </div>
            ) : renderDeviceStatus(deviceCfg)}
          </Card>
        </Col>
        <Col span={8}>
          <Card size="small" title={<span style={{ fontSize: 13, color: '#000', fontWeight: 400 }}>{`第 ${current + 1} 步：${['WAN 侧配置', 'LAN 侧配置', '确认下发'][current]} 配置编辑`}</span>} variant="outlined">
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
          await handleSave();
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

export default StandardWizard;
