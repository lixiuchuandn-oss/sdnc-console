import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Card, Descriptions, Form, Input, InputNumber, Select, Space, Steps, message, Row, Col, Spin, Modal, Checkbox } from 'antd';
import { SettingOutlined, ReloadOutlined } from '@ant-design/icons';
import { useNavigate, useParams } from 'react-router-dom';
import PageContainer from '../../../components/PageContainer';
import { getVRConfig, saveVRConfig, setVRRole, getVR2Config } from '../../../services/virtualRouterApi';

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
  const [confirmOpen, setConfirmOpen] = useState<boolean>(false);
  const [confirmChecked, setConfirmChecked] = useState<boolean>(false);

  const requestSign = async (path: string, method: 'GET' | 'POST', other: string, bodyRaw: string): Promise<{ Authorization: string; tonce: string }> => {
    const authUrl = `/api-proxy/api/sign?url=${encodeURIComponent(path)}&method=${method}&other=${encodeURIComponent(other)}&accessKey=Cloudmap%23123&secretKey=Cloudmap%23123`;
    const resp = await fetch(authUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: bodyRaw });
    const json = await resp.json();
    const info = (json && json.data) ? json.data : json;
    if (!resp.ok || !info?.Authorization || !info?.tonce) throw new Error('签名失败');
    return { Authorization: info.Authorization, tonce: String(info.tonce) };
  };

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
        form.setFieldsValue({
          lanName: cfg?.ce?.lanName || cfg?.ce?.ifName,
          lanIpv4: cfg?.ce?.lanIpv4 || cfg?.ce?.ifIpv4,
          lanIpv6: cfg?.ce?.lanIpv6 || cfg?.ce?.ifIpv6,
          wanName: cfg?.ce?.wanName || cfg?.ce?.wanDev,
          wanIpv4: cfg?.ce?.wanIpv4,
          wanIpv6: cfg?.ce?.wanIpv6,
          bgpAsn: cfg?.ce?.bgpAsn ?? bgpTop?.asn,
          bgpRouterId: cfg?.ce?.bgpRouterId ?? bgpTop?.router_id,
        });
      } catch {}
    })();
  }, [uuid, form]);

  const refreshDeviceData = async (silent = false) => {
    if (!uuid) return;
    setIfaceLoading(true);
    try {
      const method = 'GET';
      const other = `uuid=${uuid}`;
      const path = '/V2/ctcontrol/VR3/VRConfig/list';
      const info = await requestSign(path, method, other, '');
      const queryUrl = `/api-proxy${path}?${other}`;
      const resp = await fetch(queryUrl, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json', 'Authorization': info.Authorization, 'tonce': String(info.tonce) },
      });
      const raw = await resp.json().catch(async () => ({ raw: await resp.text() }));
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

      const dev2 = await getVR2Config(uuid);
      setCsmctlCfg(dev2 || data || null);

      if (dev2 && typeof dev2 === 'object') {
        collectFromArray((dev2 as any).interfaces);
        Object.keys(dev2).forEach((key) => {
          if (key.startsWith('interfaces_') || key.startsWith('subinterfaces_')) collectFromArray((dev2 as any)[key]);
        });
      }

      const unique = Array.from(new Set(names)).filter((n) => !!n);
      if (unique.length) setIfaceOptions(unique);

      if (!silent) message.success('设备数据已刷新');
    } catch (err) {
      console.warn('[CEWizard] 获取设备接口列表失败：', (err as any)?.message || err);
      if (!silent) message.error('刷新失败');
    } finally {
      setIfaceLoading(false);
    }
  };

  useEffect(() => {
    refreshDeviceData(true);
  }, [uuid]);

  useEffect(() => {
    if (!csmctlCfg) return;
    
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

    const wanDevName = existingCfg?.ce?.wanName || existingCfg?.ce?.wanDev;
    const lanDevName = existingCfg?.ce?.lanName || existingCfg?.ce?.ifName;
    
    const wanObj = findInterfaceInDevice(csmctlCfg, wanDevName);
    const lanObj = findInterfaceInDevice(csmctlCfg, lanDevName);
    
    const bgpTop = Array.isArray(csmctlCfg?.bgp) ? csmctlCfg.bgp[0] : undefined;

    mirrorForm.setFieldsValue({
      wanName: wanDevName,
      wanIpv4: wanObj?.ipv4_static,
      wanIpv6: wanObj?.ipv6_static,
      bgpAsn: bgpTop?.asn,
      bgpRouterId: bgpTop?.router_id,
      lanName: lanDevName,
      lanIpv4: lanObj?.ipv4_static,
      lanIpv6: lanObj?.ipv6_static,
    });
  }, [existingCfg, csmctlCfg, mirrorForm]);

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
      bgpArr.push({
        asn: Number(v.bgpAsn),
        router_id: String(v.bgpRouterId || '').trim(),
        bgp_ebgp_requires_policy: 'disable',
      });
      if (bgpArr.length) cfg.bgp = bgpArr;
    }

    // CE Metadata with strict order
    const ceMeta = {
        wanName: v.wanName,
        wanIpv4: v.wanIpv4,
        wanIpv6: v.wanIpv6,
        bgpAsn: v.bgpAsn,
        bgpRouterId: v.bgpRouterId,
        lanName: v.lanName,
        lanIpv4: v.lanIpv4,
        lanIpv6: v.lanIpv6
    };
    cfg.role = 'CE';
    cfg.ce = ceMeta;

    return sortJsonKeys(cfg);
  };

  const sortJsonKeys = (obj: any): any => {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return obj;
    
    // 递归处理子对象（深层排序）
    const copy = { ...obj };
    Object.keys(copy).forEach(k => {
      copy[k] = sortJsonKeys(copy[k]);
    });

    // 对最外层进行排序：uuid, role, ce 优先
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
  const configPreview = useMemo(() => buildConfigFromValues(form.getFieldsValue(true) || {}), [watchedValues, form]);

  const next = async () => {
    try { await form.validateFields(); setCurrent((c) => Math.min(2, c + 1)); } catch {}
  };
  const prev = () => setCurrent((c) => Math.max(0, c - 1));

  const handleSave = async () => {
    if (!uuid) {
      message.error('缺少 VR 的 UUID，无法保存');
      return;
    }
    try {
      setLoading(true);
      const values = form.getFieldsValue(true);
      const cfg = buildConfigFromValues(values);
      const existing = await getVRConfig(uuid);
      
      // Remove existing ce/role to ensure they are sorted correctly
      const cleanExisting = { ...(existing || {}) };
      delete cleanExisting.ce;
      delete cleanExisting.role;

      const newCfg = sortJsonKeys({ ...cleanExisting, ...cfg });
      await saveVRConfig(uuid, newCfg);
      await setVRRole(uuid, 'CE');
      message.success('CE模式配置已保存');
      navigate('/admin/interconnect/vr');
    } catch (e: any) {
      message.error(e?.message || '保存失败');
    } finally {
      setLoading(false);
    }
  };
  const handleDispatch = async () => {
    if (!uuid) {
      message.error('缺少 VR 的 UUID，无法下发');
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
          message.error(`下发失败：外网口设备“${selectedWan}”不在设备已上报的接口中。可选：${listStr}`);
          return;
        }
        if (selectedLan && !reported.has(selectedLan)) {
          const listStr = reportedArr.join(', ');
          message.error(`下发失败：内网接口“${selectedLan}”不在设备已上报的接口中。可选：${listStr}`);
          return;
        }
      }
      const cfg = buildConfigFromValues(values);
      if (!cfg || (typeof cfg === 'object' && Object.keys(cfg).length === 0)) {
        message.warning('拼装结果为空，请检查第1、2步是否已填写必要字段');
        return;
      }
      setLoading(true);

      // 1. 同步保存到本地数据库（与专家模式一致，保留非向导配置）
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
        console.warn('保存到本地数据库失败:', e);
      }

      const path = '/V2/ctcontrol/VR2/VRConfig';
      const method = 'POST';
      const other = '';
      const bodyRaw = JSON.stringify({ uuid, ...cfg });
      const info = await requestSign(path, method, other, bodyRaw);
      const postUrl = `/api-proxy${path}`;
      const resp = await fetch(postUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': info.Authorization,
          'tonce': String(info.tonce),
        },
        body: bodyRaw,
      });
      const text = await resp.text();
      let data: any;
      try { data = JSON.parse(text); } catch { data = { msg: text }; }
      if (resp.ok) {
        message.success(data?.msg || '配置已下发');
      } else {
        throw new Error(data?.msg || `设备返回错误: ${resp.status}`);
      }
    } catch (err: any) {
      message.error(`下发失败：${err?.message || '请稍后重试'}`);
    } finally {
      setLoading(false);
    }
  };

  const renderCoreContent = () => {
    if (current === 0) {
      return (
        <Form form={form} layout="vertical">
          <div style={{ fontSize: 13, color: '#1677ff', margin: '4px 0 12px 0', borderBottom: '1px solid #e8e8e8', paddingBottom: 6 }}>设定外网口</div>
          <Form.Item name="wanName" label={<span style={{ fontSize: 13, color: '#595959' }}>外网口设备</span>} rules={[{ required: true, message: '请选择外网口设备' }]}> 
            <Select
              placeholder="请选择网卡"
              showSearch
              loading={ifaceLoading}
              options={ifaceOptions.map(n => ({ label: n, value: n }))}
              filterOption={(input: string, option?: { label?: string; value?: string }) => ((option?.label || '').toLowerCase().includes(input.toLowerCase()))}
            />
          </Form.Item>
          <Form.Item name="wanIpv4" label={<span style={{ fontSize: 13, color: '#595959' }}>外网口 IPv4 地址</span>}>
            <Input placeholder="例如：200.1.1.2/24（可选）" />
          </Form.Item>
          <Form.Item name="wanIpv6" label={<span style={{ fontSize: 13, color: '#595959' }}>外网口 IPv6 地址</span>} rules={[{ required: true, message: '请输入外网口 IPv6 地址/掩码' }]}>
            <Input placeholder="例如：2408:3333:1002::1/64（必填）" />
          </Form.Item>
          <div style={{ height: 12 }} />
          <div style={{ fontSize: 13, color: '#1677ff', margin: '4px 0 12px 0', borderBottom: '1px solid #e8e8e8', paddingBottom: 6 }}>设定BGP路由(CE to PE)</div>
          <Form.Item name="bgpAsn" label={<span style={{ fontSize: 13, color: '#595959' }}>BGP ASN</span>} rules={[{ required: true, message: '请输入 BGP ASN' }]}> 
            <InputNumber style={{ width: '100%' }} placeholder="例如：100" min={1} max={4294967295} />
          </Form.Item>
          <Form.Item name="bgpRouterId" label={<span style={{ fontSize: 13, color: '#595959' }}>BGP Router-ID</span>} rules={[{ required: true, message: '请输入 Router-ID' }, { pattern: /^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/, message: '请输入合法的 IPv4 地址' }]}> 
            <Input placeholder="例如：200.1.1.2" />
          </Form.Item>
        </Form>
      );
    }
    if (current === 1) {
      return (
        <Form form={form} layout="vertical">
          <div style={{ fontSize: 13, color: '#1677ff', margin: '4px 0 12px 0', borderBottom: '1px solid #e8e8e8', paddingBottom: 6 }}>设定内网口</div>
          <Form.Item name="lanName" label={<span style={{ fontSize: 13, color: '#595959' }}>接口名称</span>} rules={[{ required: true, message: '请选择接口名称' }]}> 
            <Select
              placeholder="请选择网卡"
              showSearch
              loading={ifaceLoading}
              options={ifaceOptions.map(n => ({ label: n, value: n }))}
              filterOption={(input: string, option?: { label?: string; value?: string }) => ((option?.label || '').toLowerCase().includes(input.toLowerCase()))}
            />
          </Form.Item>
          <Form.Item name="lanIpv4" label={<span style={{ fontSize: 13, color: '#595959' }}>IPv4 地址/掩码</span>}>
            <Input placeholder="例如：130.1.1.1/24（可选）" />
          </Form.Item>
          <Form.Item name="lanIpv6" label={<span style={{ fontSize: 13, color: '#595959' }}>IPv6 地址/掩码</span>}>
            <Input placeholder="例如：2408:3333:1002::1/64" />
          </Form.Item>
        </Form>
      );
    }
    const values = form.getFieldsValue(true);
    return (
      <div>
        <Descriptions column={1} bordered size="small">
          <Descriptions.Item label="外网口设备">{values.wanName || '-'}</Descriptions.Item>
          <Descriptions.Item label="外网口 IPv4">{values.wanIpv4 || '-'}</Descriptions.Item>
          <Descriptions.Item label="外网口 IPv6">{values.wanIpv6 || '-'}</Descriptions.Item>
          <Descriptions.Item label="BGP ASN">{values.bgpAsn || '-'}</Descriptions.Item>
          <Descriptions.Item label="BGP Router-ID">{values.bgpRouterId || '-'}</Descriptions.Item>
          <Descriptions.Item label="内网接口">{values.lanName || '-'}</Descriptions.Item>
          <Descriptions.Item label="内网 IPv4">{values.lanIpv4 || '-'}</Descriptions.Item>
          <Descriptions.Item label="内网 IPv6">{values.lanIpv6 || '-'}</Descriptions.Item>
        </Descriptions>
      </div>
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
            <Steps direction="vertical" size="small" current={current} onChange={(idx) => setCurrent(idx)} items={[{ title: '外网配置(CE to PE)' }, { title: '内网配置(CE to local)' }, { title: '确认下发' }]} />
          </Card>
        </Col>
        <Col span={7}>
          <Card size="small" title={<span style={{ fontSize: 13, color: '#000', fontWeight: 400 }}>
            {`第 ${current + 1} 步：${['外网配置(CE to PE)','内网配置(CE to local)','确认下发'][current]} 设备回读`}
          </span>} variant="outlined">
            {ifaceLoading ? (
              <div style={{ textAlign: 'center', padding: '32px 0' }}>
                <Spin />
              </div>
            ) : csmctlCfg ? (
              <>
                {current === 0 && (
                  <>
                    <div style={{ fontSize: 13, color: '#1677ff', margin: '4px 0 12px 0', borderBottom: '1px solid #e8e8e8', paddingBottom: 6 }}>外网配置(CE to PE)</div>
                    <Form layout="vertical" form={mirrorForm} disabled>
                      <Form.Item name="wanName" label={<span style={{ fontSize: 13, color: '#595959' }}>外网口设备</span>}>
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
                      <Form.Item name="wanIpv4" label={<span style={{ fontSize: 13, color: '#595959' }}>外网口 IPv4 地址</span>}>
                        <Input placeholder="未配置" />
                      </Form.Item>
                      <Form.Item name="wanIpv6" label={<span style={{ fontSize: 13, color: '#595959' }}>外网口 IPv6 地址</span>}>
                        <Input placeholder="未配置" />
                      </Form.Item>
                      <div style={{ height: 12 }} />
                      <div style={{ fontSize: 13, color: '#1677ff', margin: '4px 0 12px 0', borderBottom: '1px solid #e8e8e8', paddingBottom: 6 }}>设定BGP路由(CE to PE)</div>
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
                    <div style={{ fontSize: 13, color: '#1677ff', margin: '4px 0 12px 0', borderBottom: '1px solid #e8e8e8', paddingBottom: 6 }}>内网配置(CE to local)</div>
                    <Form layout="vertical" form={mirrorForm} disabled>
                      <Form.Item name="lanName" label={<span style={{ fontSize: 13, color: '#595959' }}>接口名称</span>}>
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
                      <Form.Item name="lanIpv4" label={<span style={{ fontSize: 13, color: '#595959' }}>IPv4 地址/掩码</span>}>
                        <Input placeholder="未配置" />
                      </Form.Item>
                      <Form.Item name="lanIpv6" label={<span style={{ fontSize: 13, color: '#595959' }}>IPv6 地址/掩码</span>}>
                        <Input placeholder="未配置" />
                      </Form.Item>
                    </Form>
                  </>
                )}
                {current === 2 && (
                  <>
                    <Descriptions column={1} bordered size="small">
                      <Descriptions.Item label="外网口设备">{mirrorForm.getFieldValue('wanName') || '-'}</Descriptions.Item>
                      <Descriptions.Item label="外网口 IPv4">{mirrorForm.getFieldValue('wanIpv4') || '-'}</Descriptions.Item>
                      <Descriptions.Item label="外网口 IPv6">{mirrorForm.getFieldValue('wanIpv6') || '-'}</Descriptions.Item>
                      <Descriptions.Item label="BGP ASN">{mirrorForm.getFieldValue('bgpAsn') || '-'}</Descriptions.Item>
                      <Descriptions.Item label="BGP Router-ID">{mirrorForm.getFieldValue('bgpRouterId') || '-'}</Descriptions.Item>
                      <Descriptions.Item label="接口名称">{mirrorForm.getFieldValue('lanName') || '-'}</Descriptions.Item>
                      <Descriptions.Item label="内网 IPv4">{mirrorForm.getFieldValue('lanIpv4') || '-'}</Descriptions.Item>
                      <Descriptions.Item label="内网 IPv6">{mirrorForm.getFieldValue('lanIpv6') || '-'}</Descriptions.Item>
                    </Descriptions>
                  </>
                )}
              </>
            ) : (
              <div style={{ padding: 12, background: '#fffbe6', border: '1px dashed #faad14', borderRadius: 6, color: '#faad14', fontSize: 12 }}>
                未获取到设备配置（设备回读为空）
              </div>
            )}
          </Card>
        </Col>
        <Col span={8}>
          <Card size="small" title={<span style={{ fontSize: 13, color: '#000', fontWeight: 400 }}>
            {`第 ${current + 1} 步：${['外网配置(CE to PE)','内网配置(CE to local)','确认下发'][current]} 配置编辑`}
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
