import React, { useEffect, useMemo, useState } from 'react';
import { Button, Card, Col, Descriptions, Divider, Form, Input, Radio, Row, Select, Space, Spin, Steps, Switch, Tabs, message } from 'antd';
import { useNavigate } from 'react-router-dom';
import PageContainer from '../../../components/PageContainer';
import { vrApi } from '../../../services/vrApi';
import { createIPsecVPN, API_BASE_URL } from '../../../services/api';
import { ReloadOutlined, CheckCircleOutlined, LoadingOutlined, ClockCircleOutlined } from '@ant-design/icons';

const { Option } = Select;
// Tabs 用于配置预览，保持与 SRv6 创建页一致

const IPsecVPNWizard: React.FC = () => {
  const navigate = useNavigate();
  const [form] = Form.useForm();
  const [current, setCurrent] = useState<number>(0);
  const [loading, setLoading] = useState(false);
  const [vrLoading, setVrLoading] = useState(false);
  const [vrs, setVrs] = useState<any[]>([]);
  const [ifaceLoading, setIfaceLoading] = useState<boolean>(false);
  const [peerPresetAvailable, setPeerPresetAvailable] = useState<boolean>(false);
  const [usePeerPreset, setUsePeerPreset] = useState<boolean>(false);
  const [localPreset, setLocalPreset] = useState<any>(null);
  const [peerPreset, setPeerPreset] = useState<any>(null);
  const [localPresetAvailable, setLocalPresetAvailable] = useState<boolean>(false);
  const [useLocalPreset, setUseLocalPreset] = useState<boolean>(false);
  const [progressSteps, setProgressSteps] = useState([
    { status: 'wait', description: '开始下发本端VR配置' },
    { status: 'wait', description: '本端VR配置下发成功' },
    { status: 'wait', description: '开始下发对端VR配置' },
    { status: 'wait', description: '对端VR配置下发成功' },
    { status: 'wait', description: '结束' },
  ]);

  const getAuthHeaders = () => {
    const token = localStorage.getItem('token');
    return {
      'Content-Type': 'application/json',
      'Authorization': token ? `Bearer ${token}` : '',
    };
  };

  const ipv4ToInt = (ip: string): number => {
    const parts = ip.split('.').map(p => parseInt(p, 10));
    if (parts.length !== 4 || parts.some(n => isNaN(n) || n < 0 || n > 255)) return NaN;
    return ((parts[0] << 24) >>> 0) + (parts[1] << 16) + (parts[2] << 8) + parts[3];
  };
  const intToIpv4 = (n: number): string => {
    return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.');
  };
  const cidrToNetwork = (cidr: string): string => {
    const s = String(cidr || '').trim();
    const [ip, maskStr] = s.split('/');
    const mask = parseInt(maskStr || '', 10);
    if (!ip || isNaN(mask) || mask < 0 || mask > 32) return s;
    const ipInt = ipv4ToInt(ip);
    if (isNaN(ipInt)) return s;
    const maskInt = mask === 0 ? 0 : (~0 << (32 - mask)) >>> 0;
    const networkInt = (ipInt & maskInt) >>> 0;
    return `${intToIpv4(networkInt)}/${mask}`;
  };

  useEffect(() => {
    (async () => {
      await fetchVRs();
      form.setFieldsValue({
        ikeVersion: 'v2',
        encryption: 'aes-256',
        authentication: 'sha256',
        dhGroup: '14',
        pfs: 'group14',
        mode: 'tunnel',
      });
    })();
  }, []);

  const fetchVRs = async () => {
    setVrLoading(true);
    try {
      const resp: any = await vrApi.getVRInstances(200, 1);
      const data: any = resp?.data ?? resp;
      let list: any[] = Array.isArray(data?.page)
        ? data.page
        : Array.isArray(data?.list)
        ? data.list
        : Array.isArray(data?.rows)
        ? data.rows
        : Array.isArray(data)
        ? (data as any[])
        : [];
      // 后备方案：沿用 VR 列表页的直连拉取与解析，提升兼容性
      if (!list || list.length === 0) {
        const accesskey = 'Cloudmap%23123';
        const secretkey = 'Cloudmap%23123';
        const path = '/V2/ctcontrol/VR1/pagelist';
        const method = 'GET';
        const other = `page_size=${200}&page_num=${1}`;
        const authUrl = `/api-proxy/api/sign?url=${encodeURIComponent(path)}&method=${method}&other=${encodeURIComponent(other)}&accessKey=${accesskey}&secretKey=${secretkey}`;
        const signResp = await fetch(authUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '' });
        const signJson = await signResp.json();
        const info = (signJson && (signJson as any).data) ? (signJson as any).data : signJson;
        const listUrl = `/api-proxy${path}?${other}`;
        const res2 = await fetch(listUrl, {
          method: 'GET',
          headers: { 'Content-Type': 'application/json', 'Authorization': info.Authorization, 'tonce': String(info.tonce) }
        });
        const response2 = await res2.json();
        const data2: any = (response2 && (response2 as any).data) ? (response2 as any).data : response2;
        list = Array.isArray(data2?.page)
          ? data2.page
          : Array.isArray(data2?.list)
          ? data2.list
          : Array.isArray(data2?.rows)
          ? data2.rows
          : Array.isArray(data2)
          ? (data2 as any[])
          : [];
      }
      setVrs(list || []);
    } catch (error: any) {
      console.error('获取VR列表失败:', error);
      message.error('获取VR列表失败');
    } finally {
      setVrLoading(false);
    }
  };

  const requestSign = async (path: string, method: 'GET' | 'POST', other: string, bodyRaw: string): Promise<{ Authorization: string; tonce: string }> => {
    const authUrl = `/api-proxy/api/sign?url=${encodeURIComponent(path)}&method=${method}&other=${encodeURIComponent(other)}&accessKey=Cloudmap%23123&secretKey=Cloudmap%23123`;
    const resp = await fetch(authUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: bodyRaw });
    const json = await resp.json();
    const info = (json && json.data) ? json.data : json;
    if (!resp.ok || !info?.Authorization || !info?.tonce) throw new Error('签名失败');
    return { Authorization: info.Authorization, tonce: String(info.tonce) };
  };

  // 辅助函数：解析网卡名称中的 PCI 编号并排序
  const getSortedPhysicalInterfaces = (interfaces: any[]) => {
    if (!Array.isArray(interfaces)) return [];
    
    return interfaces
      .filter(iface => {
        const name = String(iface?.name || '').toLowerCase();
        // 排除非物理接口
        return name.startsWith('gigabitethernet') || 
               name.startsWith('ethernet') || 
               name.startsWith('ge') ||
               name.startsWith('ten-gigabitethernet') ||
               name.startsWith('xe');
      })
      .sort((a, b) => {
        const extractPci = (name: string) => {
          const match = name.match(/[\d]+\/[\d]+\/[\d]+/);
          return match ? match[0] : '';
        };
        const pciA = extractPci(String(a.name || ''));
        const pciB = extractPci(String(b.name || ''));
        if (pciA && pciB) {
           return pciA.localeCompare(pciB, undefined, { numeric: true, sensitivity: 'base' });
        }
        return String(a.name).localeCompare(String(b.name), undefined, { numeric: true });
      });
  };

  const fetchVR3Interfaces = async (uuid: string) => {
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

      let wanIfObj: any = null;
      let lanIfObj: any = null;

      // 1. 尝试从 deviceCfg.interfaces 中获取并排序
      if (data.interfaces && Array.isArray(data.interfaces)) {
        const sorted = getSortedPhysicalInterfaces(data.interfaces);
        if (sorted.length > 0) wanIfObj = sorted[0]; // 第一块是 WAN
        if (sorted.length > 1) lanIfObj = sorted[1]; // 第二块是 LAN
      } 
      
      // 如果 interfaces 为空，尝试从其他 keys 收集 (兜底)
      if (!wanIfObj && !lanIfObj) {
          const all: any[] = [];
          Object.keys(data).forEach(k => {
              if ((k.startsWith('interfaces_') || k.startsWith('subinterfaces_')) && Array.isArray(data[k])) {
                  all.push(...data[k]);
              }
          });
          const sorted = getSortedPhysicalInterfaces(all);
          if (sorted.length > 0) wanIfObj = sorted[0];
          if (sorted.length > 1) lanIfObj = sorted[1];
      }

      const ipv4CidrPattern = /^(?:(?:[0-9]|[1-9][0-9]|1[0-9]{2}|2[0-4][0-9]|25[0-5])\.){3}(?:[0-9]|[1-9][0-9]|1[0-9]{2}|2[0-4][0-9]|25[0-5])\/([0-9]|[1-2]\d|3[0-2])$/;
      const getIp = (iface: any) => {
        if (!iface) return undefined;
        // ipv4_static 可能是 CIDR
        if (iface.ipv4_static && ipv4CidrPattern.test(iface.ipv4_static)) {
          return iface.ipv4_static.split('/')[0];
        }
        return iface.ipv4_static;
      };

      const getSubnet = (iface: any) => {
         if (!iface || !iface.ipv4_static) return undefined;
         if (ipv4CidrPattern.test(iface.ipv4_static)) {
             return cidrToNetwork(iface.ipv4_static);
         }
         return undefined;
      };

      return {
        wanIp: getIp(wanIfObj),
        lanIp: getIp(lanIfObj),
        wanSubnet: getSubnet(wanIfObj),
        lanSubnet: getSubnet(lanIfObj),
        wanIpCidr: wanIfObj?.ipv4_static,
        lanIpCidr: lanIfObj?.ipv4_static,
      };
    } catch (e) {
      console.error('Fetch VR3 failed:', e);
      return null;
    }
  };

  const prefillFromVrPreset = async (which: 'local' | 'remote', vrUuid: string) => {
    // 立即设置 ID，确保即使获取配置失败，表单也能记录选中状态
    if (which === 'local') {
      form.setFieldsValue({ vrId: vrUuid });
    } else {
      form.setFieldsValue({ peerVrId: vrUuid });
    }

    try {
      // 不再使用数据库预设，完全依赖 VR3 接口扫描
      // 1. 获取 VR3 接口信息 (包含 LAN IP 和 Subnet)
      const vr3Info = await fetchVR3Interfaces(vrUuid);
      
      const lanIp = vr3Info?.lanIpCidr;       // 例如 192.168.1.1/24 (保留原始IP)
      const lanSubnet = vr3Info?.lanSubnet;   // 例如 192.168.1.0/24 (生成网段)
      const wanIp = vr3Info?.wanIp;

      if (which === 'local') {
        if (lanSubnet || wanIp) {
            setLocalPresetAvailable(true);
            setUseLocalPreset(false);
            setLocalPreset(vr3Info); // Update debug view
            form.setFieldsValue({
              localSubnet: lanSubnet || form.getFieldValue('localSubnet'),
              localInterfaceIp: lanIp || form.getFieldValue('localInterfaceIp'), // 新增字段：保留 LAN 口 IP
              localPublicIp: wanIp || form.getFieldValue('localPublicIp'),
            });
            message.success('已从设备加载本端网络信息');
        } else {
             message.warning('无法从设备获取网络信息，请手动输入');
        }
      } else {
        if (lanSubnet || wanIp) {
            setPeerPresetAvailable(true);
            setUsePeerPreset(false);
            setPeerPreset(vr3Info); // Update debug view
            form.setFieldsValue({
              remoteSubnet: lanSubnet || form.getFieldValue('remoteSubnet'),
              remoteInterfaceIp: lanIp || form.getFieldValue('remoteInterfaceIp'), // 新增字段：保留 LAN 口 IP
              remoteGateway: wanIp || form.getFieldValue('remoteGateway'),
            });
            message.success('已从设备加载对端网络信息');
        } else {
             message.warning('无法从设备获取网络信息，请手动输入');
        }
      }
    } catch (e: any) {
      message.warning((e?.message || '读取VR配置失败') + ` (${which})`);
    }
  };

  const next = async () => {
    try {
      if (current === 0) {
        await form.validateFields(['name']);
      } else if (current === 1) {
        await form.validateFields(['vrId', 'peerVrId', 'localSubnet', 'remoteGateway', 'remoteSubnet', 'psk', 'localPublicIp']);
      }
      const n = Math.min(2, current + 1);
      setCurrent(n);
    } catch {}
  };
  const prev = () => setCurrent((c) => Math.max(0, c - 1));

  const handleCreate = async () => {
    try {
      const values = await form.validateFields();
      setLoading(true);
      
      const localVrName = vrs.find(v => (v.uuid || v.id) === values.vrId)?.name;
      const peerVrName = vrs.find(v => (v.uuid || v.id) === values.peerVrId)?.name;

      const payload = {
        ...values,
        localVrName,
        peerVrName,
        localSubnet: cidrToNetwork(values?.localSubnet),
        remoteSubnet: cidrToNetwork(values?.remoteSubnet),
        // 保留 LAN 口原始 IP
        localInterfaceIp: values?.localInterfaceIp,
        remoteInterfaceIp: values?.remoteInterfaceIp,
      };
      console.log('Creating IPsec VPN with payload:', payload);
      
      const response = await fetch(`${API_BASE_URL}/api/networks/ipsec?stream=1`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorText = await response.text();
        let errorMsg = 'Creation failed';
        try {
          const json = JSON.parse(errorText);
          errorMsg = json.message || errorMsg;
        } catch {
          errorMsg = `Request failed (${response.status}): ${errorText.slice(0, 100)}`;
        }
        throw new Error(errorMsg);
      }

      const reader = response.body?.getReader();
      const decoder = new TextDecoder('utf-8');

      let isFinished = false;
      if (reader) {
        setCurrent(3); // Enter step 4
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunks = decoder.decode(value).split('\n');
          for (const chunk of chunks) {
            if (chunk) {
              try {
                const data = JSON.parse(chunk);
                if (data.type === 'progress') {
                  setProgressSteps(prev => {
                    const newSteps = [...prev];
                    if (data.step <= newSteps.length) {
                         newSteps[data.step - 1] = { ...newSteps[data.step - 1], status: 'finish', description: data.message };
                         // If there is a next step, set it to process
                         if (data.step < newSteps.length) {
                             newSteps[data.step] = { ...newSteps[data.step], status: 'process' };
                         }
                    }
                    return newSteps;
                  });
                } else if (data.type === 'error') {
                  message.error(data.message);
                  setLoading(false);
                  isFinished = true;
                  return; 
                } else if (data.type === 'result') {
                  isFinished = true;
                  message.success('IPsec VPN 创建成功');
                  setTimeout(() => navigate('/admin/interconnect/ipsec'), 1000);
                }
              } catch (e) {
                console.error('Parse chunk error', e);
                // Try to see if it's an HTML error page or plain text
                if (chunk.trim().startsWith('<') || chunk.toLowerCase().includes('error')) {
                   message.error(`后端响应格式错误: ${chunk.slice(0, 100)}`);
                   setLoading(false);
                   isFinished = true;
                   return;
                }
              }
            }
          }
        }
        
        if (!isFinished) {
           message.error('连接异常断开，请检查后端日志或网络状态');
           // Set current spinning step to error?
           setProgressSteps(prev => {
              return prev.map(s => s.status === 'process' ? { ...s, status: 'error', description: '操作超时或中断' } : s);
           });
        }
      } else {
        // Fallback if no reader (should not happen in modern browsers)
        message.success('IPsec VPN 创建成功');
        navigate('/admin/interconnect/ipsec');
      }

    } catch (error: any) {
      console.error('Creation failed:', error);
      if (error.errorFields) {
        message.error('请检查表单填写是否完整');
      } else {
        message.error(error?.message || '创建失败');
      }
    } finally {
      setLoading(false);
    }
  };

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
  const localPreview = useMemo(() => {
    const v = form.getFieldsValue(true) || {};
    return {
      ipsec: [
        {
          ID: v.name,
          ike_local_ip: v.localPublicIp || '',
          ike_remote_ip: v.remoteGateway,
          ike_dpd_delay: 10,
          ike_dpd_timeout: 30,

          ike_proposal_local: v.vrId,
          ike_proposal_remote: {
            remote_id: v.peerVrId,
            pre_shared_key: v.psk ? '******' : undefined,
            pubkey: 'pre-shared-key'
          },
          traffic_selectors_local: cidrToNetwork(v.localSubnet),
          traffic_selectors_remote: cidrToNetwork(v.remoteSubnet),

          sa_dpd_action: 'restart',
          sa_esp_proposals: v.encryption === 'aes-256' ? 'aes256-sha256-modp3072' : 'aes128-sha256-modp3072',
          'sa-initiate': 'true',
          'sa-terminate': 'false'
        }
      ]
    };
  }, [form, current]);
  const remotePreview = useMemo(() => {
    const v = form.getFieldsValue(true) || {};
    if (!v.peerVrId) return {};
    return {
      ipsec: [
        {
          ID: v.name,
          ike_local_ip: v.remoteGateway,
          ike_remote_ip: v.localPublicIp || '',
          ike_dpd_delay: 10,
          ike_dpd_timeout: 30,

          ike_proposal_local: v.peerVrId,
          ike_proposal_remote: {
            remote_id: v.vrId,
            pre_shared_key: v.psk ? '******' : undefined,
            pubkey: 'pre-shared-key'
          },
          traffic_selectors_local: cidrToNetwork(v.remoteSubnet),
          traffic_selectors_remote: cidrToNetwork(v.localSubnet),

          sa_dpd_action: 'restart',
          sa_esp_proposals: v.encryption === 'aes-256' ? 'aes256-sha256-modp3072' : 'aes128-sha256-modp3072',
          'sa-initiate': 'true',
          'sa-terminate': 'false'
        }
      ]
    };
  }, [form, current]);

  return (
    <PageContainer
      title="创建 IPsecVPN（向导）"
      titleLevel={3}
      subtitle="按步骤选择本端/对端VR、子网与安全参数，完成创建。"
      extra={<Button icon={<ReloadOutlined />} onClick={fetchVRs}>刷新VR列表</Button>}
      onBack={() => navigate(-1)}
      asCard={false}
      contentPadding={16}
    >
      <Row gutter={16}>
        <Col span={5}>
          <Card size="small" title={<span style={{ fontSize: 13, fontWeight: 600 }}>步骤</span>} variant="outlined" style={{ position: 'sticky', top: 16 }}>
            <Steps
              direction="vertical"
              size="small"
              current={current}
              onChange={(idx) => {
                 if(current !== 3) setCurrent(idx); // Prevent changing step manually during execution
              }}
              items={[
                { title: '基础信息与模式' },
                { title: '选择本端与对端' },
                { title: '确认创建' },
                { title: '配置下发' },
              ]}
            />
          </Card>
        </Col>
        <Col span={12}>
          <Card size="small" title={<span style={{ fontSize: 13, color: '#000', fontWeight: 400 }}>{`第 ${current + 1} 步：${['基础信息与模式','选择本端与对端','确认创建','配置下发'][current]}`}</span>} variant="outlined">
            <Form layout="vertical" form={form} hideRequiredMark>
              <div style={{ display: current === 0 ? 'block' : 'none' }}>
                <Form.Item name="name" label={<span style={{ fontSize: 13, color: '#595959' }}>名称</span>} rules={[{ required: true, message: '请输入VPN名称' }]}>
                  <Input placeholder="请输入VPN名称" />
                </Form.Item>
                <Form.Item name="description" label={<span style={{ fontSize: 13, color: '#595959' }}>描述</span>}>
                  <Input.TextArea rows={2} placeholder="请输入描述信息" />
                </Form.Item>
              </div>
              <div style={{ display: current === 1 ? 'block' : 'none' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '4px 0 12px 0', borderBottom: '1px solid #e8e8e8', paddingBottom: 6 }}>
                  <span style={{ fontSize: 13, color: '#1677ff' }}>本端网关</span>
                  <Space size={4}>
                    <span style={{ fontSize: 12, color: '#595959' }}>使用 VR 预设</span>
                    <Switch size="small" checked={!useLocalPreset} onChange={(v) => setUseLocalPreset(!v)} disabled={!localPresetAvailable} />
                  </Space>
                </div>
                <Row gutter={12}>
                  <Col span={12}>
                    <Form.Item name="vrId" label={<span style={{ fontSize: 13, color: '#595959' }}>本端网关 (VR实例)</span>} rules={[{ required: true, message: '请选择VR实例' }]}>
                      <Select
                        placeholder="选择VR实例"
                        loading={vrLoading}
                        showSearch
                        onChange={(val: string) => prefillFromVrPreset('local', val)}
                        filterOption={(input, option) => (option?.children as unknown as string).toLowerCase().includes(input.toLowerCase())}
                      >
                        {vrs.map(vr => (
                          <Option key={vr.uuid || vr.id} value={vr.uuid || vr.id}>
                            {vr.name || vr.uuid || vr.id}
                          </Option>
                        ))}
                      </Select>
                    </Form.Item>
                  </Col>
                  <Col span={12}>
                    <Form.Item name="localPublicIp" label={<span style={{ fontSize: 13, color: '#595959' }}>本端 WAN 口 IP</span>} rules={[{ required: true, message: '请输入本端 WAN 口 IP' }]}>
                      <Input placeholder="自动读取" disabled={!useLocalPreset && localPresetAvailable} />
                    </Form.Item>
                  </Col>
                </Row>
                
                <Row gutter={12}>
                  <Col span={12}>
                    <Form.Item name="localSubnet" label={<span style={{ fontSize: 13, color: '#595959' }}>本端 LAN 口子网 (自动生成)</span>} rules={[{ required: true, message: '请输入本端 LAN 口 IP' }]}>
                      <Input placeholder="例如: 192.168.1.0/24" disabled={!useLocalPreset && localPresetAvailable} />
                    </Form.Item>
                  </Col>
                  <Col span={12}>
                    <Form.Item name="localInterfaceIp" label={<span style={{ fontSize: 13, color: '#595959' }}>本端 LAN 口 IP (保留)</span>}>
                      <Input placeholder="自动读取接口IP" disabled />
                    </Form.Item>
                  </Col>
                </Row>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '4px 0 12px 0', borderBottom: '1px solid #e8e8e8', paddingBottom: 6 }}>
        <span style={{ fontSize: 13, color: '#1677ff' }}>对端网关</span>
        <Space size={4}>
          <span style={{ fontSize: 12, color: '#595959' }}>使用 VR 预设</span>
          <Switch size="small" checked={!usePeerPreset} onChange={(v) => setUsePeerPreset(!v)} disabled={!peerPresetAvailable} />
        </Space>
      </div>
      <Row gutter={12}>
        <Col span={12}>
          <Form.Item name="peerVrId" label={<span style={{ fontSize: 13, color: '#595959' }}>对端网关 (VR实例)</span>} rules={[{ required: true, message: '请选择对端 VR 实例' }]}>
            <Select
              placeholder="选择对端 VR（可选）"
              loading={vrLoading}
              showSearch
              onChange={(val: string) => prefillFromVrPreset('remote', val)}
              filterOption={(input, option) => (option?.children as unknown as string).toLowerCase().includes(input.toLowerCase())}
            >
              {vrs.map(vr => (
                <Option key={vr.uuid || vr.id} value={vr.uuid || vr.id}>
                  {vr.name || vr.uuid || vr.id}
                </Option>
              ))}
            </Select>
          </Form.Item>
        </Col>
        <Col span={12}>
          <Form.Item name="remoteGateway" label={<span style={{ fontSize: 13, color: '#595959' }}>对端 WAN 口 IP</span>} rules={[{ required: usePeerPreset || !peerPresetAvailable, message: '请输入对端 WAN 口 IP' }]}>
            <Input placeholder="例如: 1.2.3.4" disabled={!usePeerPreset && peerPresetAvailable} />
          </Form.Item>
        </Col>
      </Row>
      
      <Row gutter={12} style={{ marginBottom: 8 }}>
        <Col span={12}>
          <Form.Item name="remoteSubnet" label={<span style={{ fontSize: 13, color: '#595959' }}>对端 LAN 口子网 (自动生成)</span>} rules={[{ required: usePeerPreset || !peerPresetAvailable, message: '请输入对端 LAN 口 IP' }]}>
            <Input placeholder="例如: 10.0.0.0/24" disabled={!usePeerPreset && peerPresetAvailable} />
          </Form.Item>
        </Col>
        <Col span={12}>
          <Form.Item name="remoteInterfaceIp" label={<span style={{ fontSize: 13, color: '#595959' }}>对端 LAN 口 IP (保留)</span>}>
            <Input placeholder="自动读取接口IP" disabled />
          </Form.Item>
        </Col>
      </Row>

                <div style={{ fontSize: 13, color: '#1677ff', margin: '4px 0 12px 0', borderBottom: '1px solid #e8e8e8', paddingBottom: 6 }}>高级参数配置</div>
                <Form.Item name="ikeVersion" label={<span style={{ fontSize: 13, color: '#595959' }}>IKE 版本</span>}>
                  <Radio.Group>
                    <Radio value="v1">IKEv1</Radio>
                    <Radio value="v2">IKEv2</Radio>
                  </Radio.Group>
                </Form.Item>
                <Form.Item name="psk" label={<span style={{ fontSize: 13, color: '#595959' }}>认证密钥 (PSK)</span>} rules={[{ required: true, message: '请输入预共享密钥' }]}>
                  <Input.Password placeholder="请输入预共享密钥" />
                </Form.Item>
                <Row gutter={12}>
                  <Col span={8}>
                    <Form.Item name="encryption" label={<span style={{ fontSize: 13, color: '#595959' }}>加密算法</span>}>
                      <Select>
                        <Option value="aes-128">AES-128</Option>
                        <Option value="aes-192">AES-192</Option>
                        <Option value="aes-256">AES-256</Option>
                        <Option value="3des">3DES</Option>
                      </Select>
                    </Form.Item>
                  </Col>
                  <Col span={8}>
                    <Form.Item name="authentication" label={<span style={{ fontSize: 13, color: '#595959' }}>认证算法</span>}>
                      <Select>
                        <Option value="sha1">SHA1</Option>
                        <Option value="sha256">SHA2-256</Option>
                        <Option value="sha384">SHA2-384</Option>
                        <Option value="sha512">SHA2-512</Option>
                        <Option value="md5">MD5</Option>
                      </Select>
                    </Form.Item>
                  </Col>
                  <Col span={8}>
                    <Form.Item name="dhGroup" label={<span style={{ fontSize: 13, color: '#595959' }}>DH 组</span>}>
                      <Select>
                        <Option value="2">Group 2</Option>
                        <Option value="5">Group 5</Option>
                        <Option value="14">Group 14</Option>
                        <Option value="19">Group 19</Option>
                      </Select>
                    </Form.Item>
                  </Col>
                </Row>
                <Form.Item name="mode" label={<span style={{ fontSize: 13, color: '#595959' }}>IPsec 模式</span>}>
                  <Radio.Group>
                    <Radio value="tunnel">隧道模式 (Tunnel)</Radio>
                    <Radio value="transport">传输模式 (Transport)</Radio>
                  </Radio.Group>
                </Form.Item>
                <Form.Item name="pfs" label={<span style={{ fontSize: 13, color: '#595959' }}>PFS (Perfect Forward Secrecy)</span>}>
                  <Select style={{ width: 200 }}>
                    <Option value="disable">不启用</Option>
                    <Option value="group2">Group 2</Option>
                    <Option value="group5">Group 5</Option>
                    <Option value="group14">Group 14</Option>
                  </Select>
                </Form.Item>
                <Space style={{ display: 'flex' }} align="baseline">
                  <Form.Item name="natTraversal" label={<span style={{ fontSize: 13, color: '#595959' }}>NAT 穿越 (NAT-T)</span>} valuePropName="checked">
                    <Switch />
                  </Form.Item>
                  <Form.Item name="dpd" label={<span style={{ fontSize: 13, color: '#595959' }}>DPD (死对端检测)</span>} valuePropName="checked">
                    <Switch />
                  </Form.Item>
                </Space>
              </div>
              <div style={{ display: current === 2 ? 'block' : 'none' }}>
                <Descriptions column={1} bordered size="small">
                  <Descriptions.Item label="名称">{form.getFieldValue('name') || '-'}</Descriptions.Item>
                  <Descriptions.Item label="本端VR">{form.getFieldValue('vrId') || '-'}</Descriptions.Item>
                  <Descriptions.Item label="本端子网">{form.getFieldValue('localSubnet') || '-'}</Descriptions.Item>
                  <Descriptions.Item label="对端VR">{form.getFieldValue('peerVrId') || '-'}</Descriptions.Item>
                  <Descriptions.Item label="对端网关">{form.getFieldValue('remoteGateway') || '-'}</Descriptions.Item>
                  <Descriptions.Item label="对端子网">{form.getFieldValue('remoteSubnet') || '-'}</Descriptions.Item>
                  <Descriptions.Item label="IKE">{form.getFieldValue('ikeVersion') || 'v2'}</Descriptions.Item>
                  <Descriptions.Item label="加密">{form.getFieldValue('encryption') || 'aes-256'}</Descriptions.Item>
                  <Descriptions.Item label="认证">{form.getFieldValue('authentication') || 'sha256'}</Descriptions.Item>
                  <Descriptions.Item label="DH">{form.getFieldValue('dhGroup') || '14'}</Descriptions.Item>
                  <Descriptions.Item label="PFS">{form.getFieldValue('pfs') || 'group14'}</Descriptions.Item>
                  <Descriptions.Item label="模式">{form.getFieldValue('mode') || 'tunnel'}</Descriptions.Item>
                  <Descriptions.Item label="NAT-T">{form.getFieldValue('natTraversal') ? '开启' : '关闭'}</Descriptions.Item>
                  <Descriptions.Item label="DPD">{form.getFieldValue('dpd') ? '开启' : '关闭'}</Descriptions.Item>
                  <Descriptions.Item label="描述">{form.getFieldValue('description') || '-'}</Descriptions.Item>
                </Descriptions>
              </div>
              <div style={{ display: current === 3 ? 'block' : 'none' }}>
                <Card size="small" title="配置下发进度" bordered={false}>
                  <ul style={{ listStyle: 'none', padding: 0 }}>
                    {progressSteps.map((step, index) => (
                      <li key={index} style={{ display: 'flex', alignItems: 'center', margin: '12px 0' }}>
                        {step.status === 'finish' ? (
                          <CheckCircleOutlined style={{ color: '#52c41a', marginRight: '8px', fontSize: 16 }} />
                        ) : step.status === 'process' ? (
                          <LoadingOutlined style={{ color: '#1677ff', marginRight: '8px', fontSize: 16 }} />
                        ) : (
                          <ClockCircleOutlined style={{ color: '#00000040', marginRight: '8px', fontSize: 16 }} />
                        )}
                        <span style={{ 
                          color: step.status === 'finish' ? '#52c41a' : step.status === 'process' ? '#1677ff' : '#00000040',
                          fontWeight: step.status === 'process' ? 500 : 400
                        }}>
                          {step.description}
                        </span>
                      </li>
                    ))}
                  </ul>
                </Card>
              </div>
            </Form>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 16 }}>
              <Space>
                {current !== 3 && <Button onClick={() => navigate('/admin/interconnect/ipsec')}>返回列表</Button>}
                {current > 0 && current !== 3 && <Button onClick={prev}>上一步</Button>}
                {current === 3 && !loading && <Button onClick={prev}>返回修改</Button>}
              </Space>
              <Space>
                {current < 2 && <Button type="primary" onClick={next}>下一步</Button>}
                {current === 2 && (
                  <Button type="primary" onClick={handleCreate} loading={loading}>创建 VPN</Button>
                )}
              </Space>
            </div>
          </Card>
        </Col>
        <Col span={7}>
          <Card size="small" title={<span style={{ fontSize: 13, fontWeight: 600 }}>配置 JSON预览</span>} variant="outlined" style={{ position: 'sticky', top: 16 }}>
            <Tabs
              size="small"
              defaultActiveKey="local"
              items={[
                {
                  key: 'local',
                  label: '本端预览',
                  children: (
                    <pre style={{ fontSize: 12, lineHeight: '18px', whiteSpace: 'pre-wrap', wordBreak: 'break-word', overflowX: 'auto' }}>
                      {safeStringify({
                        ...localPreview,
                        localPublicIp: localPreset?.wanIp,
                      })}
                    </pre>
                  ),
                },
                {
                  key: 'remote',
                  label: '对端预览',
                  children: (
                    <pre style={{ fontSize: 12, lineHeight: '18px', whiteSpace: 'pre-wrap', wordBreak: 'break-word', overflowX: 'auto' }}>
                      {safeStringify({
                        ...remotePreview,
                        remotePublicIp: peerPreset?.wanIp,
                      })}
                    </pre>
                  ),
                },
                {
                  key: 'raw',
                  label: 'VR源数据',
                  children: (
                    <div style={{ maxHeight: 400, overflow: 'auto' }}>
                      <div style={{ marginBottom: 12 }}>
                        <div style={{ fontSize: 12, fontWeight: 600, color: '#1677ff' }}>本端 VR (VR3 Info)</div>
                        <pre style={{ fontSize: 11, background: '#f5f5f5', padding: 8, borderRadius: 4 }}>
                          {safeStringify(localPreset)}
                        </pre>
                      </div>
                      <div>
                        <div style={{ fontSize: 12, fontWeight: 600, color: '#1677ff' }}>对端 VR (VR3 Info)</div>
                        <pre style={{ fontSize: 11, background: '#f5f5f5', padding: 8, borderRadius: 4 }}>
                          {safeStringify(peerPreset)}
                        </pre>
                      </div>
                    </div>
                  ),
                },
              ]}
            />
          </Card>
        </Col>
      </Row>
    </PageContainer>
  );
};

export default IPsecVPNWizard;
