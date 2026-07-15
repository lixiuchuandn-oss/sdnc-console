import React, { useCallback, useEffect, useState } from 'react';
import { Button, Col, Descriptions, Form, Input, Radio, Row, Select, Space, Steps, Switch, message, Checkbox } from 'antd';
import { useNavigate, useParams } from 'react-router-dom';
import { fetchVrCachePageList } from '../../../../services/virtualRouterApi';
import { apiPost, apiRequest, createIPsecVPN, getApiErrorMessage, updateIPsecVPN } from '../../../../services/api';
import { useAuth } from '../../../../contexts/AuthContext';
import { hasPermissionForAction } from '../../../../utils/accessMapping';
import IbrDeployWizardPanel from '../lib/IbrDeployWizardPanel';
import IbrWizardCard, { ibrWizardStepCardTitle } from '../lib/IbrWizardCard';
import IbrWizardPage from '../lib/IbrWizardPage';
import IbrWizardStepPane from '../lib/IbrWizardStepPane';
import { useIbrDeployWizard } from '../lib/useIbrDeployWizard';
import { ReloadOutlined, CheckCircleOutlined } from '@ant-design/icons';
import {
  handleWizardStepsChange,
  validateWizardStepsThrough,
  warnFormValidationFailure,
} from '../routers/vrWizardFormUtils';

const { Option } = Select;

const IPsecVPNWizard: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const perms = Array.isArray(user?.permissions) ? user?.permissions ?? [] : [];
  const canWrite =
    user?.role === 'super_admin' || hasPermissionForAction(perms, 'networks.ipsec:write');
  const { id } = useParams();

  useEffect(() => {
    if (!canWrite) {
      message.warning('无 IPsec 写权限，无法创建或编辑连接');
      navigate('/admin/interconnect/ipsec', { replace: true });
    }
  }, [canWrite, navigate]);

  const [form] = Form.useForm();
  const [current, setCurrent] = useState<number>(0);
  const [loading, setLoading] = useState(false);
  const [vrLoading, setVrLoading] = useState(false);
  const [vrs, setVrs] = useState<any[]>([]);
  const [peerPresetAvailable, setPeerPresetAvailable] = useState<boolean>(false);
  const [usePeerPreset, setUsePeerPreset] = useState<boolean>(false);
  const [localPreset, setLocalPreset] = useState<any>(null);
  const [peerPreset, setPeerPreset] = useState<any>(null);
  const [localPresetAvailable, setLocalPresetAvailable] = useState<boolean>(false);
  const [useLocalPreset, setUseLocalPreset] = useState<boolean>(false);
  const [, setRefreshKey] = useState(0);
  const [previewTabKey, setPreviewTabKey] = useState<string>('local');
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [deployRunSeq, setDeployRunSeq] = useState(0);
  const prevWizardStepRef = React.useRef(current);

  const resolveIpsecDeployEndpoints = useCallback(
    () => [
      { label: '本端', vrId: String(form.getFieldValue('localVrId') || '').trim() },
      { label: '对端', vrId: String(form.getFieldValue('peerVrId') || '').trim() },
    ],
    [form],
  );

  const ipsecDeployWizard = useIbrDeployWizard({
    feature: 'ipsec',
    includeVerify: true,
    resolveEndpoints: resolveIpsecDeployEndpoints,
    onAllFinished: () => message.success('全部流程结束'),
  });

  // 进入第 4 步或用户重新点击「开始下发」时，启动统一下发向导。
  useEffect(() => {
    const prevStep = prevWizardStepRef.current;
    prevWizardStepRef.current = current;

    if (current !== 3) {
      if (prevStep === 3) ipsecDeployWizard.cancel();
      return;
    }
    if (deployRunSeq === 0) return;

    ipsecDeployWizard.startAuto();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 下发会话由 current + deployRunSeq 显式驱动
  }, [current, deployRunSeq]);

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
      fetchVPN(id);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const fetchVRs = async (opts?: { sync?: boolean }) => {
    setVrLoading(true);
    try {
      if (opts?.sync) {
        try {
          await apiPost('/api/vr-instances/refresh', {});
        } catch {
          message.warning('从对端同步 IBR 缓存失败，仍将拉取当前列表');
        }
      }
      const resp = await fetchVrCachePageList(1000, 1, { skipCache: true });
      const data = resp?.data || resp;
      const list = Array.isArray(data?.page)
        ? data.page
        : Array.isArray(data?.list)
        ? data.list
        : Array.isArray(data?.items)
        ? data.items
        : [];
      setVrs(list);
      if (opts?.sync) message.success('IBR 列表已刷新');
    } catch (e) {
      console.error('Failed to fetch VR list from cache', e);
      message.error('获取IBR列表失败');
    } finally {
      setVrLoading(false);
    }
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
      message.warning((e?.message || '读取IBR配置失败') + ` (${which})`);
    }
  };

  const IPSEC_STEP0_FIELDS = ['name'];
  const IPSEC_STEP1_FIELDS = [
    'localVrId',
    'peerVrId',
    'localVrLanSubnet',
    'peerVrWanIP',
    'peerVrLanSubnet',
    'psk',
    'localVrWanIP',
  ];

  const ipsecFieldsForStep = (step: number) =>
    step === 0 ? IPSEC_STEP0_FIELDS : step === 1 ? IPSEC_STEP1_FIELDS : [];

  const validateIpsecStepsThrough = (from: number, to: number) =>
    validateWizardStepsThrough(form, from, to, ipsecFieldsForStep);

  const next = async () => {
    try {
      const ok = await validateIpsecStepsThrough(current, current + 1);
      if (!ok) return;
      setCurrent(Math.min(2, current + 1));
    } catch (err) {
      warnFormValidationFailure(err);
    }
  };
  const prev = () => setCurrent((c) => Math.max(0, c - 1));

  const handleStepsChange = (idx: number) => {
    if (current === 3) return;
    void handleWizardStepsChange(idx, current, setCurrent, validateIpsecStepsThrough);
  };

  const startDeploy = () => {
    ipsecDeployWizard.cancel();
    setDeployRunSeq((seq) => seq + 1);
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

      if (id) {
        await updateIPsecVPN(id, payload);
      } else {
        await createIPsecVPN(payload);
      }
      message.success('配置已保存到本地缓存');
      setSaveSuccess(true);
    } catch (error: any) {
      console.error('Creation failed:', error);
      if (error.errorFields) {
        message.error('请检查表单填写是否完整');
      } else {
        message.error(getApiErrorMessage(error, id ? '保存失败' : '创建失败'));
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

  const previewContentByTab: Record<string, React.ReactNode> = {
    local: (
      <pre style={{ fontSize: 12, lineHeight: '18px', whiteSpace: 'pre-wrap', wordBreak: 'break-word', overflowX: 'auto', margin: 0 }}>
        {safeStringify(localPreview)}
      </pre>
    ),
    remote: (
      <pre style={{ fontSize: 12, lineHeight: '18px', whiteSpace: 'pre-wrap', wordBreak: 'break-word', overflowX: 'auto', margin: 0 }}>
        {safeStringify(remotePreview)}
      </pre>
    ),
    raw: (
      <div style={{ maxHeight: 400, overflow: 'auto' }}>
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#1677ff' }}>本端 VR (VR3 Info)</div>
          <pre style={{ fontSize: 11, background: '#f5f5f5', padding: 8, borderRadius: 4, margin: 0 }}>
            {safeStringify(localPreset)}
          </pre>
        </div>
        <div>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#1677ff' }}>对端 VR (VR3 Info)</div>
          <pre style={{ fontSize: 11, background: '#f5f5f5', padding: 8, borderRadius: 4, margin: 0 }}>
            {safeStringify(peerPreset)}
          </pre>
        </div>
      </div>
    ),
  };

  return (
    <IbrWizardPage
      subtitle="按步骤选择本端/对端IBR、子网与安全参数，完成创建。"
      onBack={() => navigate('/admin/interconnect/ipsec')}
      extra={<Button icon={<ReloadOutlined />} onClick={() => void fetchVRs({ sync: true })}>刷新IBR列表</Button>}
      layout="linear"
      steps={
          <Steps
            direction="vertical"
            size="small"
            current={current}
            onChange={handleStepsChange}
            items={[
              { title: '基础信息与模式' },
              { title: '选择本端与对端' },
              { title: '确认创建' },
              { title: '配置下发' },
            ]}
          />
        }
        main={
          <IbrWizardStepPane
            title={ibrWizardStepCardTitle(current, ['基础信息与模式','选择本端与对端','确认创建','配置下发'][current])}
            footerLeft={
              <>
                {current !== 3 && <Button onClick={() => navigate('/admin/interconnect/ipsec')}>返回列表</Button>}
                {current > 0 && <Button onClick={prev} disabled={loading && current === 3}>上一步</Button>}
              </>
            }
            footerRight={
              <>
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
                    <Button type="primary" onClick={startDeploy} disabled={!saveSuccess || loading}>
                      开始下发
                    </Button>
                  </>
                )}
                {current === 3 && (
                  <Button type="primary" onClick={() => navigate('/admin/interconnect/ipsec')} disabled={loading}>
                    关闭向导
                  </Button>
                )}
              </>
            }
          >
            <Form 
              layout="vertical" 
              form={form} 
              hideRequiredMark
              onValuesChange={() => {
                setRefreshKey(k => k + 1);
                setSaveSuccess(false);
              }}
            >
              <div style={{ display: current === 0 ? 'block' : 'none' }}>
                <Form.Item 
                  name="name" 
                  label="名称" 
                  rules={[
                    { required: true, message: '请输入VPN名称' },
                    {
                      validator: async (_, value) => {
                        if (!value) return Promise.resolve();
                        try {
                          const exclude = id ? `&excludeId=${encodeURIComponent(id)}` : '';
                          const json = await apiRequest(
                            `/api/networks/ipsec/check-name?name=${encodeURIComponent(value)}${exclude}`,
                          );
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
                <Form.Item name="description" label="描述">
                  <Input.TextArea rows={2} placeholder="请输入描述信息" />
                </Form.Item>
              </div>
              <div style={{ display: current === 1 ? 'block' : 'none' }}>
                {/* Local Gateway Section */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '4px 0 12px 0', borderBottom: '1px solid #e8e8e8', paddingBottom: 6 }}>
                  <span style={{ color: '#1677ff' }}>本端网关</span>
                  <Space size={4}>
                    <span style={{ fontSize: 12, color: '#595959' }}>使用 IBR 预设</span>
                    <Switch size="small" checked={!useLocalPreset} onChange={(v) => setUseLocalPreset(!v)} disabled={!localPresetAvailable} />
                  </Space>
                </div>
                <Row gutter={16}>
                  {/* Row 1 */}
                  <Col span={12}>
                    <Form.Item name="localVrId" label="本端网关 (IBR实例)" rules={[{ required: true, message: '请选择IBR实例' }]}>
                      <Select
                        placeholder="选择IBR实例"
                        loading={vrLoading}
                        showSearch
                        onChange={(val: string) => prefillFromVrPreset('local', val)}
                        filterOption={(input, option) => (option?.children as unknown as string).toLowerCase().includes(input.toLowerCase())}
                      >
                        {vrs.map(vr => {
                          const vid = String(vr.uuid || vr.id || '').trim();
                          return (
                            <Option key={vid} value={vid}>
                              {vr.name || vid}
                            </Option>
                          );
                        })}
                      </Select>
                    </Form.Item>
                  </Col>
                  <Col span={12}>
                    <Form.Item name="localVrWanIP" label="本端 WAN 口 IP" rules={[{ required: true, message: '请输入本端 WAN 口 IP' }]}>
                      <Input placeholder="自动读取" disabled={!useLocalPreset && localPresetAvailable} />
                    </Form.Item>
                  </Col>
                  
                  {/* Row 2 */}
                  <Col span={12}>
                    <Form.Item name="localVrLanSubnet" label="本端 LAN 口子网 (自动生成)" rules={[{ required: true, message: '请输入本端 LAN 口 IP' }]}>
                      <Input placeholder="例如: 192.168.1.0/24" disabled={!useLocalPreset && localPresetAvailable} />
                    </Form.Item>
                  </Col>
                  <Col span={12}>
                    <Form.Item name="localVrLanIP" label="本端 LAN 口 IP (保留)">
                      <Input placeholder="自动读取接口IP" disabled />
                    </Form.Item>
                    <Form.Item name="localVrName" hidden><Input /></Form.Item>
                    <Form.Item name="localVrWanName" hidden><Input /></Form.Item>
                    <Form.Item name="localVrLanName" hidden><Input /></Form.Item>
                  </Col>
                  
                  {/* Row 3 */}
                  
                    <Col span={12}>
                      <Form.Item label="本端WAN口 EIP / NAT_IP">
                        <div style={{ display: 'flex', alignItems: 'center' }}>
                          <Form.Item name="enableLocalEip" valuePropName="checked" noStyle>
                             <Checkbox style={{ marginRight: 8 }}>启用</Checkbox>
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
                        label="允许任意远程IP地址链接"
                        valuePropName="checked"
                      >
                        <Checkbox>
                          启用
                          <span style={{ fontSize: 12, color: '#8c8c8c', marginLeft: 8 }}>(勾选后将本端配置中的 ike_remote_ip 设为 0.0.0.0)</span>
                        </Checkbox>
                      </Form.Item>
                    </Col>
                </Row>

                {/* Remote Gateway Section */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '4px 0 12px 0', borderBottom: '1px solid #e8e8e8', paddingBottom: 6 }}>
                  <span style={{ color: '#1677ff' }}>对端网关</span>
                  <Space size={4}>
                    <span style={{ fontSize: 12, color: '#595959' }}>使用 IBR 预设</span>
                    <Switch size="small" checked={!usePeerPreset} onChange={(v) => setUsePeerPreset(!v)} disabled={!peerPresetAvailable} />
                  </Space>
                </div>
                <Row gutter={16}>
                  {/* Row 1 */}
                  <Col span={12}>
                    <Form.Item name="peerVrId" label="对端网关 (IBR实例)" rules={[{ required: true, message: '请选择对端 IBR实例' }]}>
                      <Select
                        placeholder="选择对端 IBR（可选）"
                        loading={vrLoading}
                        showSearch
                        onChange={(val: string) => prefillFromVrPreset('remote', val)}
                        filterOption={(input, option) => (option?.children as unknown as string).toLowerCase().includes(input.toLowerCase())}
                      >
                        {vrs.map(vr => {
                          const vid = String(vr.uuid || vr.id || '').trim();
                          return (
                            <Option key={vid} value={vid}>
                              {vr.name || vid}
                            </Option>
                          );
                        })}
                      </Select>
                    </Form.Item>
                  </Col>
                  <Col span={12}>
                    <Form.Item name="peerVrWanIP" label="对端 WAN 口 IP" rules={[{ required: usePeerPreset || !peerPresetAvailable, message: '请输入对端 WAN 口 IP' }]}>
                      <Input placeholder="例如: 1.2.3.4" disabled={!usePeerPreset && peerPresetAvailable} />
                    </Form.Item>
                  </Col>

                  {/* Row 2 */}
                  <Col span={12}>
                    <Form.Item name="peerVrLanSubnet" label="对端 LAN 口子网 (自动生成)" rules={[{ required: usePeerPreset || !peerPresetAvailable, message: '请输入对端 LAN 口 IP' }]}>
                      <Input placeholder="例如: 10.0.0.0/24" disabled={!usePeerPreset && peerPresetAvailable} />
                    </Form.Item>
                  </Col>
                  <Col span={12}>
                    <Form.Item name="peerVrLanIP" label="对端 LAN 口 IP (保留)">
                      <Input placeholder="自动读取接口IP" disabled />
                    </Form.Item>
                    <Form.Item name="peerVrName" hidden><Input /></Form.Item>
                    <Form.Item name="peerVrWanName" hidden><Input /></Form.Item>
                    <Form.Item name="peerVrLanName" hidden><Input /></Form.Item>
                  </Col>

                  {/* Row 3 */}
                    <Col span={12}>
                      <Form.Item label="对端WAN口 EIP / NAT_IP">
                        <div style={{ display: 'flex', alignItems: 'center' }}>
                          <Form.Item name="enableRemoteEip" valuePropName="checked" noStyle>
                             <Checkbox style={{ marginRight: 8 }}>启用</Checkbox>
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
                        label="允许任意远程IP地址链接"
                      >
                        <Checkbox>
                          启用
                          <span style={{ fontSize: 12, color: '#8c8c8c', marginLeft: 8 }}>(勾选后将对端配置中的 ike_remote_ip 设为 0.0.0.0)</span>
                        </Checkbox>
                      </Form.Item>
                    </Col>
                </Row>

                <div style={{ color: '#1677ff', margin: '4px 0 12px 0', borderBottom: '1px solid #e8e8e8', paddingBottom: 6 }}>高级参数配置</div>
                <Form.Item name="ikeVersion" label="IKE 版本">
                  <Radio.Group>
                    <Radio value="v1">IKEv1</Radio>
                    <Radio value="v2">IKEv2</Radio>
                  </Radio.Group>
                </Form.Item>
                <Form.Item name="psk" label="认证密钥 (PSK)" rules={[{ required: true, message: '请输入预共享密钥' }]}>
                  <Input.Password placeholder="请输入预共享密钥" />
                </Form.Item>
                <Row gutter={12}>
                  <Col span={8}>
                    <Form.Item name="encryption" label="加密算法">
                      <Select>
                        <Option value="aes-128">AES-128</Option>
                        <Option value="aes-192">AES-192</Option>
                        <Option value="aes-256">AES-256</Option>
                        <Option value="3des">3DES</Option>
                      </Select>
                    </Form.Item>
                  </Col>
                  <Col span={8}>
                    <Form.Item name="authentication" label="认证算法">
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
                    <Form.Item name="dhGroup" label="DH 组">
                      <Select>
                        <Option value="2">Group 2</Option>
                        <Option value="5">Group 5</Option>
                        <Option value="14">Group 14</Option>
                        <Option value="19">Group 19</Option>
                      </Select>
                    </Form.Item>
                  </Col>
                </Row>
                <Form.Item name="mode" label="IPsec 模式">
                  <Radio.Group>
                    <Radio value="tunnel">隧道模式 (Tunnel)</Radio>
                    <Radio value="transport">传输模式 (Transport)</Radio>
                  </Radio.Group>
                </Form.Item>
                <Form.Item name="pfs" label="PFS (Perfect Forward Secrecy)">
                  <Select style={{ width: 200 }}>
                    <Option value="disable">不启用</Option>
                    <Option value="group2">Group 2</Option>
                    <Option value="group5">Group 5</Option>
                    <Option value="group14">Group 14</Option>
                  </Select>
                </Form.Item>
                <Space style={{ display: 'flex' }} align="baseline">
                  <Form.Item name="natTraversal" label="NAT 穿越 (NAT-T)" valuePropName="checked">
                    <Switch />
                  </Form.Item>
                  <Form.Item name="dpd" label="DPD (死对端检测)" valuePropName="checked">
                    <Switch />
                  </Form.Item>
                </Space>
              </div>
              <div style={{ display: current === 2 ? 'block' : 'none' }}>
                <Descriptions column={1} bordered size="small">
                  <Descriptions.Item label="名称">{form.getFieldValue('name') || '-'}</Descriptions.Item>
                  <Descriptions.Item label="本端IBR">{form.getFieldValue('localVrId') || '-'}</Descriptions.Item>
                  <Descriptions.Item label="本端WAN IP">{form.getFieldValue('localVrWanIP') || '-'}</Descriptions.Item>
                  <Descriptions.Item label="本端EIP">{form.getFieldValue('enableLocalEip') ? form.getFieldValue('localVrWanEIP') : '未启用'}</Descriptions.Item>
                  <Descriptions.Item label="本端允许任意远程IP">{form.getFieldValue('localIkeRemoteIpAny') ? '是' : '否'}</Descriptions.Item>
                  <Descriptions.Item label="本端子网">{form.getFieldValue('localVrLanSubnet') || '-'}</Descriptions.Item>
                  <Descriptions.Item label="对端IBR">{form.getFieldValue('peerVrId') || '-'}</Descriptions.Item>
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
                <IbrDeployWizardPanel
                  title="下发向导"
                  steps={ipsecDeployWizard.steps}
                  activeStep={ipsecDeployWizard.activeStep}
                  logs={ipsecDeployWizard.logs}
                  status={ipsecDeployWizard.status}
                  onRunStep={(idx) => void ipsecDeployWizard.runStep(idx)}
                />
              </div>
            </Form>
          </IbrWizardStepPane>
        }
        preview={
          <IbrWizardCard
            sticky
            style={{ width: '100%' }}
            tabList={[
              { key: 'local', tab: '本端预览' },
              { key: 'remote', tab: '对端预览' },
              { key: 'raw', tab: 'IBR源数据' },
            ]}
            activeTabKey={previewTabKey}
            onTabChange={setPreviewTabKey}
            tabBarExtraContent={
              <Button type="text" icon={<ReloadOutlined />} size="small" onClick={refreshPreview} title="刷新预览数据" />
            }
            tabProps={{ size: 'middle' }}
          >
            {previewContentByTab[previewTabKey]}
          </IbrWizardCard>
        }
    />
  );
};

export default IPsecVPNWizard;
