import React, { useEffect, useMemo, useState } from 'react';
import { Button, Card, Col, Descriptions, Divider, Form, Input, Radio, Row, Select, Space, Spin, Steps, Switch, Tabs, message, Checkbox } from 'antd';
import { useNavigate, useParams } from 'react-router-dom';
import PageContainer from '../../../components/PageContainer';
import { fetchVrCachePageList } from '../../../services/virtualRouterApi';
import { createIPsecVPN, API_BASE_URL, apiRequest, apiPost, apiPatch, getAuthHeaders } from '../../../services/api';
import { ReloadOutlined, CheckCircleOutlined, LoadingOutlined, ClockCircleOutlined } from '@ant-design/icons';

const { Option } = Select;
// Tabs 用于配置预览，保持与 SRv6 创建页一致

const IPsecVPNWizard: React.FC = () => {
  const navigate = useNavigate();
  const { id } = useParams();
  const [isEdit, setIsEdit] = useState(false);
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
  const [refreshKey, setRefreshKey] = useState(0);
  const [canDeploy, setCanDeploy] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [fullLocalConfig, setFullLocalConfig] = useState<any>(null);
  const [fullPeerConfig, setFullPeerConfig] = useState<any>(null);
  const deployedRef = React.useRef(false);

  // Manual Step State
  const [manualStep, setManualStep] = useState(0);
  const [manualLogs, setManualLogs] = useState<Record<number, string>>({});
  const [manualStatus, setManualStatus] = useState<Record<number, 'wait' | 'process' | 'finish' | 'error'>>({});

  const manualStepsDef = [
    { title: '读取本端配置', desc: '从本地缓存读取并预览本端待下发配置' },
    { title: '下发本端配置', desc: '推送配置到本端 CSMCTL' },
    { title: '回查本端结果', desc: '验证本端设备是否成功加载配置' },
    { title: '读取对端配置', desc: '从本地缓存读取并预览对端待下发配置' },
    { title: '下发对端配置', desc: '推送配置到对端 CSMCTL' },
    { title: '回查对端结果', desc: '验证对端设备是否成功加载配置' }
  ];

  const executeManualStep = async (stepIndex: number) => {
    const vrId = form.getFieldValue('localVrId');
    const peerVrId = form.getFieldValue('peerVrId');
    
    setManualStatus(prev => ({ ...prev, [stepIndex]: 'process' }));
    setManualLogs(prev => ({ ...prev, [stepIndex]: 'Executing...' }));

    try {
      let res: any;
      let logMsg = '';

      switch (stepIndex) {
        case 0: // Preview Local
          res = await apiRequest(`/api/networks/ipsec/deploy/preview?vrId=${vrId}`);
          logMsg = `[Local Config Preview]\n${JSON.stringify(res.config, null, 2)}`;
          break;
        
        case 1: // Push Local
          res = await apiPost(`/api/networks/ipsec/deploy/push`, { vrId });
          
          if (res.error) throw new Error(res.error);
          logMsg = `[Local Push Response]\nStatus: ${res.status}\nBody: ${JSON.stringify(res.data, null, 2)}`;
          
          if (res.status !== 200 && res.status !== 201) throw new Error(`Device returned status ${res.status}`);
          break;

        case 2: // Verify Local
          res = await apiRequest(`/api/networks/ipsec/deploy/verify?vrId=${vrId}`);
          if (res.error) throw new Error(res.error);
          logMsg = `[Local Verify]\nIPsec Count: ${res.ipsecCount}\nConfig: ${JSON.stringify(res.config, null, 2)}`;
          if (res.ipsecCount === 0) throw new Error('Verification failed: No IPsec connections found on device.');
          break;

        case 3: // Preview Peer
          if (!peerVrId) {
             logMsg = 'No Peer VR selected, skipping.';
             break;
          }
          res = await apiRequest(`/api/networks/ipsec/deploy/preview?vrId=${peerVrId}`);
          logMsg = `[Peer Config Preview]\n${JSON.stringify(res.config, null, 2)}`;
          break;

        case 4: // Push Peer
          if (!peerVrId) {
             logMsg = 'No Peer VR selected, skipping.';
             break;
          }
          res = await apiPost(`/api/networks/ipsec/deploy/push`, { vrId: peerVrId });
          
          if (res.error) throw new Error(res.error);
          logMsg = `[Peer Push Response]\nStatus: ${res.status}\nBody: ${JSON.stringify(res.data, null, 2)}`;
          if (res.status !== 200 && res.status !== 201) throw new Error(`Device returned status ${res.status}`);
          break;

        case 5: // Verify Peer
           if (!peerVrId) {
             logMsg = 'No Peer VR selected, skipping.';
             break;
          }
          res = await apiRequest(`/api/networks/ipsec/deploy/verify?vrId=${peerVrId}`);
          if (res.error) throw new Error(res.error);
          logMsg = `[Peer Verify]\nIPsec Count: ${res.ipsecCount}\nConfig: ${JSON.stringify(res.config, null, 2)}`;
          if (res.ipsecCount === 0) throw new Error('Verification failed: No IPsec connections found on peer device.');
          break;
      }

      setManualLogs(prev => ({ ...prev, [stepIndex]: logMsg }));
      setManualStatus(prev => ({ ...prev, [stepIndex]: 'finish' }));
      setManualStep(stepIndex + 1);

      // Auto-execute next step
      if (stepIndex < 5) {
        setTimeout(() => executeManualStep(stepIndex + 1), 500);
      } else {
        message.success('全部流程结束');
      }

    } catch (e: any) {
      console.error(e);
      setManualLogs(prev => ({ ...prev, [stepIndex]: `[Error] ${e.message}` }));
      setManualStatus(prev => ({ ...prev, [stepIndex]: 'error' }));
    }
  };

  // Reset manual state when entering step 4
  useEffect(() => {
    if (current === 3) {
      setManualStep(0);
      setManualLogs({});
      setManualStatus({
        0: 'wait', 1: 'wait', 2: 'wait', 3: 'wait', 4: 'wait', 5: 'wait'
      });
      // Auto-start
      setTimeout(() => executeManualStep(0), 500);
    }
  }, [current]);

  // 1. 精确监听 Checkbox 状态，确保 React 能够感知变化
  const localIkeAny = Form.useWatch('localIkeRemoteIpAny', form);
  const remoteIkeAny = Form.useWatch('remoteIkeRemoteIpAny', form);
  const enableLocalEip = Form.useWatch('enableLocalEip', form);
  const enableRemoteEip = Form.useWatch('enableRemoteEip', form);


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
    if (id) {
      setIsEdit(true);
      fetchVPN(id);
    }
  }, [id]);

  const fetchVPN = async (vpnId: string) => {
    setLoading(true);
    try {
      const res = await apiRequest(`/api/networks/ipsec/${vpnId}`);
      if (res.error) throw new Error(res.error);
      if (!res.id) throw new Error('VPN not found');
      
      // Populate form
      form.setFieldsValue({
        name: res.name,
        description: res.description,
        localVrId: res.localVrId,
        localVrName: res.localVrName,
        peerVrId: res.peerVrId,
        peerVrName: res.peerVrName,
        localVrLanSubnet: res.localVrLanSubnet,
        peerVrWanIP: res.peerVrWanIP,
        peerVrLanSubnet: res.peerVrLanSubnet,
        psk: res.psk,
        ikeVersion: res.ikeVersion,
        encryption: res.encryption,
        authentication: res.authentication,
        dhGroup: res.dhGroup,
        pfs: res.pfs,
        mode: res.mode,
        natTraversal: res.natTraversal,
        dpd: res.dpd,
        localVrWanIP: res.localVrWanIP,
        localVrLanIP: res.localVrLanIP,
        localVrWanName: res.localVrWanName,
        localVrLanName: res.localVrLanName,
        peerVrLanIP: res.peerVrLanIP,
        peerVrWanName: res.peerVrWanName,
        peerVrLanName: res.peerVrLanName,
        
        // EIP related
        enableLocalEip: !!res.localVrWanEIP, 
        localVrWanEIP: res.localVrWanEIP,
        enableRemoteEip: !!res.peerVrWanEIP,
        peerVrWanEIP: res.peerVrWanEIP,
        localIkeRemoteIpAny: res.localIkeRemoteIpAny,
        remoteIkeRemoteIpAny: res.remoteIkeRemoteIpAny,
      });
      
    } catch (e: any) {
      console.error(e);
      message.error('Failed to load VPN details: ' + e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    (async () => {
      await fetchVRs();
      if (!id) {
        form.setFieldsValue({
          ikeVersion: 'v2',
          encryption: 'aes-256',
          authentication: 'sha256',
          dhGroup: '14',
          pfs: 'group14',
          mode: 'tunnel',
          dpd: true,
        });
      }
    })();
  }, [id]);

  const fetchVRs = async () => {
    setVrLoading(true);
    try {
      const resp = await fetchVrCachePageList(1000, 1);
      const data = resp?.data || resp;
      const list = Array.isArray(data?.page)
        ? data.page
        : Array.isArray(data?.list)
        ? data.list
        : [];
      setVrs(list);
    } catch (e) {
      console.error('Failed to fetch VR list from cache', e);
      message.error('获取VR列表失败');
    } finally {
      setVrLoading(false);
    }
  };

  const requestSign = async (path: string, method: 'GET' | 'POST', other: string, bodyRaw: string): Promise<{ Authorization: string; tonce: string }> => {
    const accessKey = 'Cloudmap#123';
    const secretKey = 'Cloudmap#123';
    const authUrl = `/api-proxy/api/sign?url=${encodeURIComponent(path)}&method=${method}&other=${encodeURIComponent(other)}&accessKey=${encodeURIComponent(accessKey)}&secretKey=${encodeURIComponent(secretKey)}`;
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
               name.startsWith('xe') ||
               name.startsWith('eth') ||
               name.startsWith('ens');
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

  const parseVrInterfaces = (data: any) => {
    let wanIfObj: any = null;
    let lanIfObj: any = null;

    // 1. 尝试从 deviceCfg.interfaces 中获取并排序
    if (data?.interfaces && Array.isArray(data.interfaces)) {
      const sorted = getSortedPhysicalInterfaces(data.interfaces);
      if (sorted.length > 0) wanIfObj = sorted[0]; // 第一块是 WAN
      if (sorted.length > 1) lanIfObj = sorted[1]; // 第二块是 LAN
    } 
    
    // 如果 interfaces 为空，尝试从其他 keys 收集 (兜底)
    if (!wanIfObj && !lanIfObj && data) {
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
      wanName: wanIfObj?.name,
      lanName: lanIfObj?.name,
      // 尝试提取 EIP/Floating IP (优先级高于 WAN IP)
      eip: data?.floating_ip || data?.public_ip || data?.eip || data?.external_ip || wanIfObj?.floating_ip || wanIfObj?.public_ip,
    };
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

      return parseVrInterfaces(data);
    } catch (e) {
      console.error('Fetch VR3 failed:', e);
      return null;
    }
  };

  const prefillFromVrPreset = async (which: 'local' | 'remote', vrUuid: string) => {
    // 立即设置 ID，确保即使获取配置失败，表单也能记录选中状态
    if (which === 'local') {
      form.setFieldsValue({ localVrId: vrUuid });
    } else {
      form.setFieldsValue({ peerVrId: vrUuid });
    }

    try {
      // 1. 优先尝试从缓存获取
      let vr3Info = null;
      const cachedVr = vrs.find(v => (v.uuid || v.id) === vrUuid);
      const vrName = cachedVr?.name || '';
      if (cachedVr) {
          // 直接使用 vrcache 聚合后的数据，不再进行多字段探测 (No Patch Logic)
          vr3Info = parseVrInterfaces(cachedVr);
      }
      
      const lanIp = vr3Info?.lanIpCidr;       // 例如 192.168.1.1/24 (保留原始IP)
      const lanSubnet = vr3Info?.lanSubnet;   // 例如 192.168.1.0/24 (生成网段)
      
      // 优先使用 EIP，其次是 WAN IP (Triple Check 逻辑的一部分)
      const eip = vr3Info?.eip;
      const wanIp = vr3Info?.wanIp;
      const wanName = vr3Info?.wanName;
      const lanName = vr3Info?.lanName;
  
      if (which === 'local') {
        if (lanSubnet || wanIp) {
            setLocalPresetAvailable(true);
            setUseLocalPreset(false);
            setLocalPreset(vr3Info); // Update debug view
            form.setFieldsValue({
              localVrName: vrName,
              localVrLanSubnet: lanSubnet || form.getFieldValue('localVrLanSubnet'),
              localVrLanIP: lanIp || form.getFieldValue('localVrLanIP'), // 新增字段：保留 LAN 口 IP
              localVrWanIP: wanIp || form.getFieldValue('localVrWanIP'),
              localVrWanName: wanName || form.getFieldValue('localVrWanName'),
              localVrLanName: lanName || form.getFieldValue('localVrLanName'),
              // 自动填充 EIP
              enableLocalEip: !!eip,
              localVrWanEIP: eip || '',
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
              peerVrName: vrName,
              peerVrLanSubnet: lanSubnet || form.getFieldValue('peerVrLanSubnet'),
              peerVrLanIP: lanIp || form.getFieldValue('peerVrLanIP'), // 新增字段：保留 LAN 口 IP
              peerVrWanIP: wanIp || form.getFieldValue('peerVrWanIP'),
              peerVrWanName: wanName || form.getFieldValue('peerVrWanName'),
              peerVrLanName: lanName || form.getFieldValue('peerVrLanName'),
              // 自动填充 EIP
              enableRemoteEip: !!eip,
              peerVrWanEIP: eip || '',
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
        await form.validateFields(['localVrId', 'peerVrId', 'localVrLanSubnet', 'peerVrWanIP', 'peerVrLanSubnet', 'psk', 'localVrWanIP']);
      }
      const n = Math.min(2, current + 1);
      setCurrent(n);
    } catch {}
  };
  const prev = () => setCurrent((c) => Math.max(0, c - 1));

  const startDeploy = () => {
    setCurrent(3);
  };



  const handleCreate = async () => {
    try {
      const values = await form.validateFields();
      setLoading(true);
      
      const payload = {
        ...values,
        localVrLanSubnet: cidrToNetwork(values?.localVrLanSubnet),
        peerVrLanSubnet: cidrToNetwork(values?.peerVrLanSubnet),
        // 保留 LAN 口原始 IP
        localVrLanIP: values?.localVrLanIP,
        peerVrLanIP: values?.peerVrLanIP,
      };

      // Do NOT change step. Just save.
      
      // 流式响应需要直接使用 fetch，但使用统一的认证头
      const method = id ? 'PUT' : 'POST';
      const url = id 
        ? `/api/networks/ipsec/${id}?stream=1`
        : `/api/networks/ipsec?stream=1`;

      const response = await fetch(`${API_BASE_URL}${url}`, {
        method,
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
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunks = decoder.decode(value).split('\n');
          for (const chunk of chunks) {
            if (chunk) {
              try {
                const data = JSON.parse(chunk);
                if (data.type === 'error') {
                  message.error(data.message);
                  setLoading(false);
                  isFinished = true;
                  return; 
                } else if (data.type === 'result') {
                  isFinished = true;
                  message.success('配置已保存到本地缓存');
                  setSaveSuccess(true);
                }
              } catch (e) {
                console.error('Parse chunk error', e);
              }
            }
          }
        }
        
        if (!isFinished) {
           message.error('连接异常断开');
        }
      } else {
        message.success('配置已保存到本地缓存');
        setSaveSuccess(true);
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
  const localPreview = (() => {
    // 获取当前表单值 (依靠 refreshKey 触发重绘)
    const v = form.getFieldsValue(true);
    // 优先使用 useWatch 监听到的值，确保响应性
    const isLocalAny = localIkeAny ?? v.localIkeRemoteIpAny;
    
    return {
      ipsec: [
        {
          ID: v.name,
          // ike_local_ip 必须绑定到真实的 WAN 口 IP，不能使用 EIP
          ike_local_ip: v.localVrWanIP || '',
          // ike_remote_ip 生成逻辑 (Triple Check):
          // 1. 最高优先级: 用户勾选 "允许任意远程IP" (Unknow NAT/No EIP) -> 0.0.0.0
          // 2. 次优先级: 对端 EIP (若启用并存在) -> peerVrWanEIP
          // 3. 默认: 对端 WAN IP (peerVrWanIP)
          ike_remote_ip: isLocalAny ? '0.0.0.0' : (v.enableRemoteEip ? v.peerVrWanEIP : v.peerVrWanIP),
          ...(v.dpd ? {
            ike_dpd_delay: 10,
            ike_dpd_timeout: 30,
          } : {}),

          ike_proposal_local: v.localVrId,
          ike_proposal_remote: {
            remote_id: v.peerVrId,
            pre_shared_key: v.psk ? '******' : undefined,
            pubkey: 'pre-shared-key'
          },
          traffic_selectors_local: cidrToNetwork(v.localVrLanSubnet),
          traffic_selectors_remote: cidrToNetwork(v.peerVrLanSubnet),

          sa_dpd_action: 'restart',
          sa_esp_proposals: v.encryption === 'aes-256' ? 'aes256-sha256-modp3072' : 'aes128-sha256-modp3072',
          'sa-initiate': 'true',
          'sa-terminate': 'false',
          'nat-traversal': v.natTraversal ? 'true' : 'false'
        }
      ]
    };
  })();
  const remotePreview = (() => {
    const v = form.getFieldsValue(true);
    // 优先使用 useWatch 监听到的值，确保响应性
    const isRemoteAny = remoteIkeAny ?? v.remoteIkeRemoteIpAny;

    if (!v.peerVrId) return {};
    return {
      ipsec: [
        {
          ID: v.name,
          // ike_local_ip 必须绑定到真实的 WAN 口 IP，不能使用 EIP
          ike_local_ip: v.peerVrWanIP,
          // 对端配置预览：ike_remote_ip 指向本端 IP
          // 1. 勾选 "允许任意" -> 0.0.0.0
          // 2. 否则 -> 本端 Public IP (EIP 优先)
          ike_remote_ip: isRemoteAny ? '0.0.0.0' : (v.enableLocalEip ? v.localVrWanEIP : (v.localVrWanIP || '')),
          ...(v.dpd ? {
            ike_dpd_delay: 10,
            ike_dpd_timeout: 30,
          } : {}),

          ike_proposal_local: v.peerVrId,
          ike_proposal_remote: {
            remote_id: v.localVrId,
            pre_shared_key: v.psk ? '******' : undefined,
            pubkey: 'pre-shared-key'
          },
          traffic_selectors_local: cidrToNetwork(v.peerVrLanSubnet),
          traffic_selectors_remote: cidrToNetwork(v.localVrLanSubnet),

          sa_dpd_action: 'restart',
          sa_esp_proposals: v.encryption === 'aes-256' ? 'aes256-sha256-modp3072' : 'aes128-sha256-modp3072',
          'sa-initiate': 'false',
          'sa-terminate': 'false',
          'nat-traversal': v.natTraversal ? 'true' : 'false'
        }
      ]
    };
  })();

  const refreshPreview = () => {
    setRefreshKey(k => k + 1);
    message.success('已刷新预览数据');
  };

  return (
    <PageContainer
        titleLevel={3}
        subtitle={<span style={{color: '#666'}}>按步骤选择本端/对端VR、子网与安全参数，完成创建。</span>}
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
            <Form 
              layout="vertical" 
              form={form} 
              hideRequiredMark
              onValuesChange={() => setRefreshKey(k => k + 1)}
            >
              <div style={{ display: current === 0 ? 'block' : 'none' }}>
                <Form.Item 
                  name="name" 
                  label={<span style={{ fontSize: 13, color: '#595959' }}>名称</span>} 
                  rules={[
                    { required: true, message: '请输入VPN名称' },
                    {
                      validator: async (_, value) => {
                        if (!value) return Promise.resolve();
                        try {
                          const json = await apiRequest(`/api/networks/ipsec/check-name?name=${encodeURIComponent(value)}`);
                          if (json.exists) {
                            return Promise.reject(new Error('该名称已存在'));
                          }
                          return Promise.resolve();
                        } catch (e) {
                          // Ignore network errors for validation or handle them
                          return Promise.resolve();
                        }
                      }
                    }
                  ]}
                >
                  <Input placeholder="请输入VPN名称" />
                </Form.Item>
                <Form.Item name="description" label={<span style={{ fontSize: 13, color: '#595959' }}>描述</span>}>
                  <Input.TextArea rows={2} placeholder="请输入描述信息" />
                </Form.Item>
              </div>
              <div style={{ display: current === 1 ? 'block' : 'none' }}>
                {/* Local Gateway Section */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '4px 0 12px 0', borderBottom: '1px solid #e8e8e8', paddingBottom: 6 }}>
                  <span style={{ fontSize: 13, color: '#1677ff' }}>本端网关</span>
                  <Space size={4}>
                    <span style={{ fontSize: 12, color: '#595959' }}>使用 VR 预设</span>
                    <Switch size="small" checked={!useLocalPreset} onChange={(v) => setUseLocalPreset(!v)} disabled={!localPresetAvailable} />
                  </Space>
                </div>
                <Row gutter={16}>
                  {/* Row 1 */}
                  <Col span={12}>
                    <Form.Item name="localVrId" label={<span style={{ fontSize: 13, color: '#595959' }}>本端网关 (VR实例)</span>} rules={[{ required: true, message: '请选择VR实例' }]}>
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
                    <Form.Item name="localVrWanIP" label={<span style={{ fontSize: 13, color: '#595959' }}>本端 WAN 口 IP</span>} rules={[{ required: true, message: '请输入本端 WAN 口 IP' }]}>
                      <Input placeholder="自动读取" disabled={!useLocalPreset && localPresetAvailable} />
                    </Form.Item>
                  </Col>
                  
                  {/* Row 2 */}
                  <Col span={12}>
                    <Form.Item name="localVrLanSubnet" label={<span style={{ fontSize: 13, color: '#595959' }}>本端 LAN 口子网 (自动生成)</span>} rules={[{ required: true, message: '请输入本端 LAN 口 IP' }]}>
                      <Input placeholder="例如: 192.168.1.0/24" disabled={!useLocalPreset && localPresetAvailable} />
                    </Form.Item>
                  </Col>
                  <Col span={12}>
                    <Form.Item name="localVrLanIP" label={<span style={{ fontSize: 13, color: '#595959' }}>本端 LAN 口 IP (保留)</span>}>
                      <Input placeholder="自动读取接口IP" disabled />
                    </Form.Item>
                    <Form.Item name="localVrName" hidden><Input /></Form.Item>
                    <Form.Item name="localVrWanName" hidden><Input /></Form.Item>
                    <Form.Item name="localVrLanName" hidden><Input /></Form.Item>
                  </Col>
                  
                  {/* Row 3 */}
                  
                    <Col span={12}>
                      <Form.Item label={<span style={{ fontSize: 13, color: '#595959' }}>本端WAN口 EIP / NAT_IP</span>}>
                        <div style={{ display: 'flex', alignItems: 'center' }}>
                          <Form.Item name="enableLocalEip" valuePropName="checked" noStyle>
                             <Checkbox style={{ marginRight: 8, fontSize: 13 }}>启用</Checkbox>
                          </Form.Item>
                          <Form.Item name="localVrWanEIP" noStyle rules={[{ required: enableLocalEip, message: '请输入EIP' }]}>
                             <Input style={{ flex: 1 }} disabled={!enableLocalEip} placeholder="请输入EIP" />
                          </Form.Item>
                        </div>
                      </Form.Item>
                    </Col>
                    <Col span={12}>
                      <Form.Item
                        name="localIkeRemoteIpAny"
                        label={<span style={{ fontSize: 13, color: '#595959' }}>允许任意远程IP地址链接</span>}
                        valuePropName="checked"
                      >
                        <Checkbox style={{ fontSize: 13 }}>
                          启用
                          <span style={{ fontSize: 12, color: '#8c8c8c', marginLeft: 8 }}>(勾选后将本端配置中的 ike_remote_ip 设为 0.0.0.0)</span>
                        </Checkbox>
                      </Form.Item>
                    </Col>
                </Row>

                {/* Remote Gateway Section */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '4px 0 12px 0', borderBottom: '1px solid #e8e8e8', paddingBottom: 6 }}>
                  <span style={{ fontSize: 13, color: '#1677ff' }}>对端网关</span>
                  <Space size={4}>
                    <span style={{ fontSize: 12, color: '#595959' }}>使用 VR 预设</span>
                    <Switch size="small" checked={!usePeerPreset} onChange={(v) => setUsePeerPreset(!v)} disabled={!peerPresetAvailable} />
                  </Space>
                </div>
                <Row gutter={16}>
                  {/* Row 1 */}
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
                    <Form.Item name="peerVrWanIP" label={<span style={{ fontSize: 13, color: '#595959' }}>对端 WAN 口 IP</span>} rules={[{ required: usePeerPreset || !peerPresetAvailable, message: '请输入对端 WAN 口 IP' }]}>
                      <Input placeholder="例如: 1.2.3.4" disabled={!usePeerPreset && peerPresetAvailable} />
                    </Form.Item>
                  </Col>

                  {/* Row 2 */}
                  <Col span={12}>
                    <Form.Item name="peerVrLanSubnet" label={<span style={{ fontSize: 13, color: '#595959' }}>对端 LAN 口子网 (自动生成)</span>} rules={[{ required: usePeerPreset || !peerPresetAvailable, message: '请输入对端 LAN 口 IP' }]}>
                      <Input placeholder="例如: 10.0.0.0/24" disabled={!usePeerPreset && peerPresetAvailable} />
                    </Form.Item>
                  </Col>
                  <Col span={12}>
                    <Form.Item name="peerVrLanIP" label={<span style={{ fontSize: 13, color: '#595959' }}>对端 LAN 口 IP (保留)</span>}>
                      <Input placeholder="自动读取接口IP" disabled />
                    </Form.Item>
                    <Form.Item name="peerVrName" hidden><Input /></Form.Item>
                    <Form.Item name="peerVrWanName" hidden><Input /></Form.Item>
                    <Form.Item name="peerVrLanName" hidden><Input /></Form.Item>
                  </Col>

                  {/* Row 3 */}
                    <Col span={12}>
                      <Form.Item label={<span style={{ fontSize: 13, color: '#595959' }}>对端WAN口 EIP / NAT_IP</span>}>
                        <div style={{ display: 'flex', alignItems: 'center' }}>
                          <Form.Item name="enableRemoteEip" valuePropName="checked" noStyle>
                             <Checkbox style={{ marginRight: 8, fontSize: 13 }}>启用</Checkbox>
                          </Form.Item>
                          <Form.Item name="peerVrWanEIP" noStyle rules={[{ required: enableRemoteEip, message: '请输入EIP' }]}>
                             <Input style={{ flex: 1 }} disabled={!enableRemoteEip} placeholder="请输入EIP" />
                          </Form.Item>
                        </div>
                      </Form.Item>
                    </Col>
                    <Col span={12}>
                      <Form.Item
                        name="remoteIkeRemoteIpAny"
                        valuePropName="checked"
                        label={<span style={{ fontSize: 13, color: '#595959' }}>允许任意远程IP地址链接</span>}
                      >
                        <Checkbox style={{ fontSize: 13 }}>
                          启用
                          <span style={{ fontSize: 12, color: '#8c8c8c', marginLeft: 8 }}>(勾选后将对端配置中的 ike_remote_ip 设为 0.0.0.0)</span>
                        </Checkbox>
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
                  <Descriptions.Item label="本端VR">{form.getFieldValue('localVrId') || '-'}</Descriptions.Item>
                  <Descriptions.Item label="本端WAN IP">{form.getFieldValue('localVrWanIP') || '-'}</Descriptions.Item>
                  <Descriptions.Item label="本端EIP">{form.getFieldValue('enableLocalEip') ? form.getFieldValue('localVrWanEIP') : '未启用'}</Descriptions.Item>
                  <Descriptions.Item label="本端允许任意远程IP">{form.getFieldValue('localIkeRemoteIpAny') ? '是' : '否'}</Descriptions.Item>
                  <Descriptions.Item label="本端子网">{form.getFieldValue('localVrLanSubnet') || '-'}</Descriptions.Item>
                  <Descriptions.Item label="对端VR">{form.getFieldValue('peerVrId') || '-'}</Descriptions.Item>
                  <Descriptions.Item label="对端WAN IP">{form.getFieldValue('peerVrWanIP') || '-'}</Descriptions.Item>
                  <Descriptions.Item label="对端EIP">{form.getFieldValue('enableRemoteEip') ? form.getFieldValue('peerVrWanEIP') : '未启用'}</Descriptions.Item>
                  <Descriptions.Item label="对端允许任意远程IP">{form.getFieldValue('remoteIkeRemoteIpAny') ? '是' : '否'}</Descriptions.Item>
                  <Descriptions.Item label="对端子网">{form.getFieldValue('peerVrLanSubnet') || '-'}</Descriptions.Item>
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
                <div style={{ marginBottom: 24, fontSize: 16, fontWeight: 600, color: '#1f1f1f' }}>手动下发流程</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                  {manualStepsDef.map((step, idx) => (
                    <Card key={idx} size="small" type="inner" title={
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <div style={{ width: 24, height: 24, borderRadius: '50%', background: manualStatus[idx] === 'finish' ? '#52c41a' : (manualStatus[idx] === 'error' ? '#ff4d4f' : (manualStatus[idx] === 'process' ? '#1677ff' : '#d9d9d9')), color: '#fff', textAlign: 'center', lineHeight: '24px', fontSize: 12 }}>
                          {idx + 1}
                        </div>
                        <span>{step.title}</span>
                        <span style={{ fontSize: 12, color: '#888', fontWeight: 'normal' }}>{step.desc}</span>
                      </div>
                    } extra={
                      <Button 
                        type="primary" 
                        size="small" 
                        disabled={idx !== manualStep} 
                        loading={manualStatus[idx] === 'process'}
                        onClick={() => executeManualStep(idx)}
                      >
                        执行
                      </Button>
                    }>
                      {manualLogs[idx] && (
                        <pre style={{ 
                           fontSize: 12, 
                           fontFamily: 'Menlo, Monaco, "Courier New", monospace',
                           background: '#1e1e1e', 
                           color: '#d4d4d4',
                           padding: 12, 
                           borderRadius: 6, 
                           overflow: 'auto', 
                           maxHeight: 200,
                           border: 'none',
                           marginTop: 0
                        }}>
                          {manualLogs[idx]}
                        </pre>
                      )}
                    </Card>
                  ))}
                </div>
              </div>
            </Form>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 16 }}>
              <Space>
                {current !== 3 && <Button onClick={() => navigate('/admin/interconnect/ipsec')}>返回列表</Button>}
                {current > 0 && <Button onClick={prev} disabled={loading && current === 3}>上一步</Button>}
              </Space>
              <Space>
                {current < 2 && <Button type="primary" onClick={next}>下一步</Button>}
                {current === 2 && (
                  <>
                    {saveSuccess && (
                       <span style={{ color: '#52c41a', display: 'inline-flex', alignItems: 'center', fontWeight: 500 }}>
                         <CheckCircleOutlined style={{ marginRight: 4 }} />
                         配置已保存
                       </span>
                    )}
                    <Button type="primary" onClick={handleCreate} loading={loading} disabled={saveSuccess}>
                      保存配置
                    </Button>
                    <Button type="primary" onClick={startDeploy} disabled={!saveSuccess}>
                      开始下发
                    </Button>
                  </>
                )}
                {current === 3 && (
                  <Button type="primary" onClick={() => navigate('/admin/interconnect/ipsec')} disabled={loading}>
                    关闭向导
                  </Button>
                )}
              </Space>
            </div>
          </Card>
        </Col>
        <Col span={7}>
          <Card 
            size="small" 
            title={<span style={{ fontSize: 13, fontWeight: 600 }}>配置 JSON预览</span>} 
            extra={<Button type="text" icon={<ReloadOutlined />} size="small" onClick={refreshPreview} title="刷新预览数据" />}
            variant="outlined" 
            style={{ position: 'sticky', top: 16 }}
          >
            <Tabs
              size="small"
              defaultActiveKey="local"
              items={[
                {
                  key: 'local',
                  label: '本端预览',
                  children: (
                    <pre style={{ fontSize: 12, lineHeight: '18px', whiteSpace: 'pre-wrap', wordBreak: 'break-word', overflowX: 'auto' }}>
                      {safeStringify(localPreview)}
                    </pre>
                  ),
                },
                {
                  key: 'remote',
                  label: '对端预览',
                  children: (
                    <pre style={{ fontSize: 12, lineHeight: '18px', whiteSpace: 'pre-wrap', wordBreak: 'break-word', overflowX: 'auto' }}>
                      {safeStringify(remotePreview)}
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
