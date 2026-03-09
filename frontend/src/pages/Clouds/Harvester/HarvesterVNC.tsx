import React, { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import { Button, Dropdown, MenuProps, Space, Spin, message } from 'antd';
import { 
  PoweroffOutlined, 
  ReloadOutlined, 
  FullscreenOutlined, 
  SettingOutlined,
  CodeOutlined 
} from '@ant-design/icons';
import PageContainer from '../../../components/PageContainer';
import { API_BASE_URL } from '../../../services/api';
import { fetchHarvesterVmDetail, fetchHarvesterVMAggregated, fetchHarvesterResourceByLink } from '../../../services/harvesterApi';
import { fetchMetricRange } from '../../../services/monitoringApi';
import { getToken } from '../../../utils/tokenStorage';
// Try to use the newer library if available, otherwise fall back to what was working or common
// Kubevirt uses @novnc/novnc
import RFB from '@novnc/novnc/lib/rfb'; 

/**
 * ==============================================================================
 * 模块名称: Harvester 虚拟机 VNC 控制台 (Harvester VM VNC Console)
 * 文件路径: src/pages/Clouds/Harvester/HarvesterVNC.tsx
 * ==============================================================================
 * 
 * [功能描述]
 * 提供基于 Web 的 VNC 客户端，允许用户通过 WebSocket 连接并控制 Harvester 虚拟机。
 * 集成了 noVNC 库，实现了 RFB (Remote Frame Buffer) 协议的客户端功能。
 * 
 * [核心逻辑]
 * 1. [VNC 连接]: 
 *    - 使用 @novnc/novnc 库通过 WebSocket 建立连接。
 *    - 处理 RFB 握手、鉴权、画面渲染和输入事件。
 * 2. [交互控制]: 
 *    - 提供发送特殊组合键 (Ctrl+Alt+Del) 和功能键 (F1-F12) 的能力。
 *    - 支持全屏切换和连接状态管理。
 * 3. [状态监控]: 
 *    - 实时显示 VM 的 CPU/内存使用率（目前为演示数据）和 IP 地址。
 * 
 * ------------------------------------------------------------------------------
 * [交互/依赖说明]
 * ------------------------------------------------------------------------------
 * 1. 数据流向:
 *    [用户操作] -> [noVNC Client] -> [WebSocket Proxy] -> [KubeVirt VNC Server] -> [QEMU]
 * 
 * 2. 关键依赖:
 *    - @novnc/novnc (RFB 协议实现)
 *    - API: /ws/kv-vnc (WebSocket 代理接口)
 * 
 * ==============================================================================
 */

// Key codes for special keys
// 定义 VNC 协议中使用的特殊按键编码 (X11 keysyms)
const KEY_CODES = {
  Delete: 0xFF9F,
  Enter: 0xFF0D,
  Backspace: 0xFF08,
  Tab: 0xFF09,
  Esc: 0xFF1B,
  Ctrl: 0xFFE3,
  Alt: 0xFFE9,
  Shift: 0xFFE1,
  F1: 0xFFBE,
  F2: 0xFFBF,
  F3: 0xFFC0,
  F4: 0xFFC1,
  F5: 0xFFC2,
  F6: 0xFFC3,
  F7: 0xFFC4,
  F8: 0xFFC5,
  F9: 0xFFC6,
  F10: 0xFFC7,
  F11: 0xFFC8,
  F12: 0xFFC9,
};

// [辅助函数] 构建 KubeVirt VNC WebSocket URL
// 构造带有鉴权 Token 和目标 VM 坐标的 WebSocket 连接地址。
// 参数包含 cloudId, namespace, name 用于后端路由定位目标虚拟机。
function kvWsUrlFromBase(baseHttp: string, cloudId: string, namespace: string, name: string, token: string): string {
  const base = baseHttp.replace(/^http/, 'ws');
  const sep = base.endsWith('/') ? '' : '/';
  const q = `token=${encodeURIComponent(token)}&cloudId=${encodeURIComponent(cloudId)}&namespace=${encodeURIComponent(namespace)}&name=${encodeURIComponent(name)}`;
  return `${base}${sep}ws/kv-vnc?${q}`;
}

const HarvesterVNCPage: React.FC = () => {
  const navigate = useNavigate();
  const { id } = useParams();
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  const cloudId = params.get('cloudId') || id || '';
  const namespace = params.get('namespace') || '';
  const name = params.get('name') || '';
  
  const [connecting, setConnecting] = useState(false);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [vmDetail, setVmDetail] = useState<any>(null);
  const [vmiDetail, setVmiDetail] = useState<any>(null);
  const [stats, setStats] = useState({ cpu: 0, mem: 0 });

  useEffect(() => {
    let timer: any;
    
    const fetchStats = async () => {
        if (!cloudId || !namespace || !name) return;
        
        // Use VMPerformance.tsx query logic exactly
        // Query last 5 minutes data to ensure we have points
        const end = Math.floor(Date.now() / 1000);
        const start = end - 5 * 60; 
        const step = 60; 

        // CPU Usage: Based on VMPerformance.tsx
        // sum(avg(rate(kubevirt_vmi_vcpu_seconds_total{namespace="${namespace}", name="${name}"}[5m])) by (domain, name)) / 1000
        const cpuQuery = `sum(avg(rate(kubevirt_vmi_vcpu_seconds_total{namespace="${namespace}", name="${name}"}[5m])) by (domain, name)) / 1000`;
        
        // Memory Usage: Based on VMPerformance.tsx
        // sum((kubevirt_vmi_memory_available_bytes - kubevirt_vmi_memory_unused_bytes) / kubevirt_vmi_memory_available_bytes)
        const memQuery = `sum((kubevirt_vmi_memory_available_bytes{namespace="${namespace}", name="${name}"} - kubevirt_vmi_memory_unused_bytes{namespace="${namespace}", name="${name}"}) / kubevirt_vmi_memory_available_bytes{namespace="${namespace}", name="${name}"})`;

        try {
            const [cpuRes, memRes] = await Promise.all([
                fetchMetricRange(cloudId, { query: cpuQuery, start, end, step }),
                fetchMetricRange(cloudId, { query: memQuery, start, end, step })
            ]);

            // Extract the latest value from result
            // result structure: data.data.result[0].values[[timestamp, "value"], ...]
            const getVal = (res: any) => {
                const values = res?.data?.data?.result?.[0]?.values;
                if (values && values.length > 0) {
                    const last = values[values.length - 1];
                    const val = parseFloat(last[1]);
                    return isNaN(val) ? 0 : val;
                }
                return 0;
            };

            const cpuVal = getVal(cpuRes);
            const memVal = getVal(memRes);
            
            // VMPerformance.tsx logic: result is 0-1 (or similar), multiply by 100 for display
            setStats({ 
                cpu: Math.round(Math.max(0, Math.min(100, cpuVal * 100))), 
                mem: Math.round(Math.max(0, Math.min(100, memVal * 100))) 
            });
        } catch (e) {
            console.warn('Failed to fetch metrics', e);
        }
    };

    if (cloudId && namespace && name) {
        fetchStats();
        timer = setInterval(fetchStats, 15000); // Refresh every 15s
    }

    return () => {
        if (timer) clearInterval(timer);
    };
  }, [cloudId, namespace, name]);

  const vmInfo = React.useMemo(() => {
    if (!vmDetail && !vmiDetail) return null;
    
    // vmDetail may be { vm, vmi, related } or just VM object
    const vm = vmDetail?.vm || vmDetail;
    // Prefer explicitly fetched VMI, fallback to aggregated VMI if available
    const vmi = vmiDetail || vmDetail?.vmi;

    const spec = vm?.spec?.template?.spec;
    const domain = spec?.domain;
    
    const cpu = domain?.cpu?.cores;
    const memory = domain?.resources?.requests?.memory || domain?.memory?.guest;
    
    // Image
    const volumes = spec?.volumes || [];
    const imageVol = volumes.find((v: any) => v.containerDisk);
    const image = imageVol?.containerDisk?.image || '-';
    
    // IP: Try to find in status.interfaces (Note: often requires VMI, but checking VM status just in case)
    // Support both ipAddress (string) and ipAddresses (array)
    // Collect all IPs from all interfaces
    const allIps: string[] = [];
    
    // 1. Try VMI status (Most reliable for running VMs)
    if (vmi?.status?.interfaces) {
        vmi.status.interfaces.forEach((i: any) => {
            if (i.ipAddress) allIps.push(i.ipAddress);
            if (Array.isArray(i.ipAddresses)) allIps.push(...i.ipAddresses);
        });
    }

    // 2. Fallback to VM status (sometimes populated)
    if (allIps.length === 0 && vm?.status?.interfaces) {
        vm.status.interfaces.forEach((i: any) => {
            if (i.ipAddress) allIps.push(i.ipAddress);
            if (Array.isArray(i.ipAddresses)) allIps.push(...i.ipAddresses);
        });
    }
    
    // Fallback: Check annotations
    if (allIps.length === 0) {
      try {
         const annot = vm?.metadata?.annotations?.['network.harvesterhci.io/ips'];
         if (annot) {
             const ips = JSON.parse(annot);
             if (Array.isArray(ips)) allIps.push(...ips);
         }
      } catch (e) {}
    }
    
    // Deduplicate and join
    const uniqueIps = Array.from(new Set(allIps));
    const ip = uniqueIps.length > 0 ? uniqueIps.join(', ') : '-';
    
    // Alias from annotation
    const alias = vm?.metadata?.annotations?.['tower.io/alias'] || '';

    return { cpu, memory, image, ip, alias };
  }, [vmDetail, vmiDetail]);
  
  const screenRef = useRef<HTMLDivElement | null>(null);
  const rfbRef = useRef<any>(null);

  useEffect(() => {
    if (cloudId && namespace && name) {
      // 1. Fetch VM Aggregated (includes VM spec, related resources)
      fetchHarvesterVMAggregated(cloudId, namespace, name)
        .then((res: any) => {
           const data = res?.data || res;
           setVmDetail(data);
        })
        .catch((e: any) => {
             console.error('Failed to fetch VM detail', e);
             // Fallback to basic fetch if aggregated fails
             fetchHarvesterVmDetail(cloudId, namespace, name)
                .then((res: any) => setVmDetail(res?.data || res))
                .catch(() => {});
        });

      // 2. Fetch VMI (VirtualMachineInstance) specifically for runtime status (IP, Node, etc.)
      // Path: /apis/kubevirt.io/v1/namespaces/{namespace}/virtualmachineinstances/{name}
      const vmiPath = `/apis/kubevirt.io/v1/namespaces/${namespace}/virtualmachineinstances/${name}`;
      fetchHarvesterResourceByLink(cloudId, vmiPath)
        .then((res: any) => {
            setVmiDetail(res);
        })
        .catch((e: any) => {
            console.warn('Failed to fetch VMI detail', e);
        });
    }
  }, [cloudId, namespace, name]);

  useEffect(() => {
    connect();
    return () => {
      disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cloudId, namespace, name]);

  const disconnect = () => {
    try {
      if (rfbRef.current) {
        rfbRef.current.disconnect();
      }
    } catch (e) {
      console.warn('Disconnect error:', e);
    }
    rfbRef.current = null;
    setConnected(false);
    setConnecting(false);
  };

  // [核心逻辑] 建立 VNC 连接
  // 1. 校验必要参数 (cloudId, namespace, name) 和 Token。
  // 2. 清理旧的 Canvas 元素，确保 DOM 干净。
  // 3. 初始化 RFB 实例，配置 WebSocket 协议和显示参数。
  // 4. 绑定连接状态事件 (connect, disconnect, securityfailure)。
  const connect = () => {
    disconnect();
    setError(null);
    if (!cloudId || !namespace || !name) { 
      setError('缺少必要参数 (cloudId, namespace, name)'); 
      return; 
    }

    const token = getToken() || '';
    if (!token) {
      setError('未登录');
      return;
    }

    setConnecting(true);

    // Build WebSocket URL
    const origin = API_BASE_URL.startsWith('http') ? API_BASE_URL : window.location.origin;
    const url = kvWsUrlFromBase(origin, cloudId, namespace, name, token);

    try {
      if (!screenRef.current) return;

      // Clean up previous canvas if any
      while (screenRef.current.firstChild) {
        screenRef.current.removeChild(screenRef.current.firstChild);
      }

      const rfb = new RFB(screenRef.current, url, {
        shared: true,
        wsProtocols: ['binary.kubevirt.io', 'binary'],
      });

      rfb.viewOnly = false;
      rfb.scaleViewport = false;
      rfb.clipViewport = false;
      rfb.resizeSession = false; 
      rfb.showDotCursor = true;
      rfb.background = '#000000'; // Ensure black background
      rfb.qualityLevel = 6;
      rfb.compressionLevel = 2;

      rfb.addEventListener('connect', () => {
        setConnected(true);
        setConnecting(false);
        setError(null);
        // Force focus and layout update
        setTimeout(() => {
            rfb.focus();
        }, 100);
      });

      rfb.addEventListener('disconnect', (e: any) => {
        setConnected(false);
        setConnecting(false);
        const reason = e?.detail?.reason || '连接已断开';
        if (reason !== 'Normal disconnect') {
          setError(reason);
        }
      });

      rfb.addEventListener('securityfailure', (e: any) => {
        setConnected(false);
        setConnecting(false);
        setError(`安全验证失败: ${e?.detail?.reason || '未知原因'}`);
      });

      rfbRef.current = rfb;
    } catch (err: any) {
      setConnecting(false);
      setError(`初始化 VNC 失败: ${err.message}`);
    }
  };

  const sendCtrlAltDel = () => {
    if (!rfbRef.current || !connected) return;
    try {
      rfbRef.current.sendCtrlAltDel();
      message.success('已发送 Ctrl+Alt+Del');
    } catch (e) {
      message.error('发送指令失败');
    }
  };

  // [交互逻辑] 发送按键序列
  // 模拟按键按下 (down=1) 和释放 (up=0) 的过程。
  // 对于组合键，先顺序按下，再逆序释放，确保虚拟机正确识别。
  const sendKey = (keys: number[]) => {
    if (!rfbRef.current || !connected) return;
    try {
        for (const k of keys) {
            rfbRef.current.sendKey(k, 1); // down
        }
        for (const k of keys.reverse()) {
            rfbRef.current.sendKey(k, 0); // up
        }
    } catch (e) {}
  };

  const keyMenu: MenuProps['items'] = [
    { key: 'cad', label: 'Ctrl + Alt + Delete', onClick: sendCtrlAltDel },
    { key: 'esc', label: 'Esc', onClick: () => sendKey([KEY_CODES.Esc]) },
    { key: 'tab', label: 'Tab', onClick: () => sendKey([KEY_CODES.Tab]) },
    { type: 'divider' },
    { key: 'f1', label: 'F1', onClick: () => sendKey([KEY_CODES.F1]) },
    { key: 'f2', label: 'F2', onClick: () => sendKey([KEY_CODES.F2]) },
    { key: 'f5', label: 'F5', onClick: () => sendKey([KEY_CODES.F5]) },
    { key: 'f12', label: 'F12', onClick: () => sendKey([KEY_CODES.F12]) },
  ];

  return (
    <PageContainer 
      title={null} 
      hideHeader
      asCard={false} 
      contentPadding={0} 
      pagePadding={0}
      style={{ height: '100vh', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%'}}>
        {/* 
          ========================================
          1. 顶部工具栏 (Header Toolbar)
          ========================================
        */}
        <div style={{ 
          height: 48, 
          background: '#2d2d2d', 
          borderBottom: `1px solid ${connected ? '#52c41a' : (connecting ? '#faad14' : '#ff4d4f')}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 16px',
          color: '#e0e0e0',
          flexShrink: 0,

        }}>
          <div style={{ display: 'flex', alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', marginRight: 16 , borderRight: '1px solid #444' }}>
              <div style={{ fontWeight: 600, marginRight: 16, display: 'flex', alignItems: 'baseline' }}>
                 {vmInfo?.alias ? (
                    <>
                       <span>{vmInfo.alias}</span>
                       <span style={{ fontSize: 12, color: '#aaa', marginLeft: 8, fontWeight: 400 }}>{name}</span>
                    </>
                 ) : (
                    <span>{name}</span>
                 )}
              </div>
            </div>

            <Space>
            {connected ? (
              <Button 
                danger 
                ghost
                size="small" 
                icon={<PoweroffOutlined />} 
                onClick={disconnect}
              >
                断开
              </Button>
            ) : (
              <Button 
                type="primary" 
                size="small" 
                icon={<ReloadOutlined />} 
                onClick={connect} 
                loading={connecting}
              >
                {connecting ? '连接中' : '连接'}
              </Button>
            )}
            <Dropdown menu={{ items: keyMenu }}>
              <Button 
                size="small" 
                icon={<CodeOutlined />} 
                disabled={!connected}
                ghost
                style={!connected ? { color: 'rgba(255,255,255,0.4)', borderColor: 'rgba(255,255,255,0.4)' } : {}}
              >
                发送指令
              </Button>
            </Dropdown>
            </Space>
          </div>

          <div style={{ display: 'flex', alignItems: 'center' }}>
            {vmInfo && (
              <div style={{ display: 'flex', alignItems: 'baseline', fontSize: 12, color: '#aaa', gap: 12, borderRight: '1px solid #444', paddingRight: 16, marginRight: 16 }}>
                 <span>CPU: <span style={{ color: '#ccc' }}>{vmInfo.cpu || '-'} <span style={{color: '#87d068'}}>({stats.cpu}%)</span></span></span>
                 <span>Mem: <span style={{ color: '#ccc' }}>{vmInfo.memory || '-'} <span style={{color: '#87d068'}}>({stats.mem}%)</span></span></span>
                 <span>IP: <span style={{ color: '#ccc' }}>{vmInfo.ip}</span></span>
              </div>
            )}
            <Space>
             {error && <span style={{ color: '#ff4d4f' }}>{error}</span>}
             <span style={{ 
               display: 'inline-block', 
               width: 8, 
               height: 8, 
               borderRadius: '50%', 
               background: connected ? '#52c41a' : (connecting ? '#faad14' : '#ff4d4f'),
               marginRight: 8
             }} />
             <span style={{ color: '#aaa', fontSize: 12 }}>
               {connected ? 'Connected' : (connecting ? 'Connecting...' : 'Disconnected')}
             </span>
          </Space>
          </div>
        </div>

        {/* 
          ========================================
          2. VNC 画面显示区域 (VNC Canvas Area)
          ========================================
        */}
        <div 
          style={{ 
            flex: 1, 
            background: '#000000', 
            overflow: 'hidden', 
            position: 'relative',
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            minHeight: 0
          }}
        >
          {/* Force VNC canvas to scale down via CSS instead of JS to ensure it fits exactly without overflow */}
          <style>
            {`
              #vnc-screen canvas {
                max-width: 100% !important;
                max-height: 100% !important;
                object-fit: contain !important;
                width: auto !important;
                height: auto !important;
              }
            `}
          </style>
          <div id="vnc-screen" ref={screenRef} style={{ width: '100%', height: '100%', background: '#000000', display: 'flex', justifyContent: 'center', alignItems: 'center' }} />
          
          {!connected && !connecting && !error && (
            <div style={{ position: 'absolute', color: '#666' }}>
              等待连接...
            </div>
          )}
        </div>
      </div>
    </PageContainer>
  );
};

export default HarvesterVNCPage;
