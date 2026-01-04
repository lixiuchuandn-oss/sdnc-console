import React from 'react';
import { 
  SafetyCertificateOutlined, 
  ScanOutlined, 
  RadarChartOutlined, 
  BugOutlined, 
  FireOutlined, 
  FileProtectOutlined, 
  CloudServerOutlined, 
  ApartmentOutlined, 
  ThunderboltOutlined, 
  GatewayOutlined, 
  AuditOutlined,
  GlobalOutlined,
  DatabaseOutlined
} from '@ant-design/icons';
import { Node } from 'react-flow-renderer';
import type { TransferItem } from 'antd/es/transfer';

// Import assets
import smGz from '../../../../../assets/sm-gz.png';
import gmGz from '../../../../../assets/gm-gz.png';
import smToGm from '../../../../../assets/sm-to-gm.png';
import gmToSm from '../../../../../assets/gm-to-sm.png';
import std from '../../../../../assets/std.png';
import wan from '../../../../../assets/wan.png';
import lanSm from '../../../../../assets/lan-sm.png';
import lanGm from '../../../../../assets/lan-gm.png';

export const SECURITY_SERVICES = [
  { type: 'waf', label: 'WAF', icon: <SafetyCertificateOutlined />, color: '#1677ff' },
  { type: 'ips', label: 'IPS', icon: <ScanOutlined />, color: '#2f54eb' },
  { type: 'ids', label: 'IDS', icon: <RadarChartOutlined />, color: '#d4b106' },
  { type: 'av', label: 'Anti-Virus', icon: <BugOutlined />, color: '#ff4d4f' },
  { type: 'fw', label: 'Firewall', icon: <FireOutlined />, color: '#fa541c' },
  { type: 'dlp', label: 'DLP', icon: <FileProtectOutlined />, color: '#722ed1' },
  { type: 'casb', label: 'CASB', icon: <CloudServerOutlined />, color: '#13c2c2' },
  { type: 'lb', label: 'Load Balancer', icon: <ApartmentOutlined />, color: '#08979c' },
  { type: 'ddos', label: 'DDoS', icon: <ThunderboltOutlined />, color: '#eb2f96' },
  { type: 'vpn', label: 'VPN', icon: <GatewayOutlined />, color: '#531dab' },
  { type: 'audit', label: 'Audit', icon: <AuditOutlined />, color: '#096dd9' },
];

export const SERVICE_TYPES = ['waf','ips','ids','av','fw','dlp','casb','lb','ddos','vpn','audit'];

export const groupsByTypeInit = Object.fromEntries(SERVICE_TYPES.map(t => [t, [] as { id: string; name: string; description: string; count: number; tags: string[]; cpu: number; mem: number }[]]));

export const initialNodes: Node[] = [
  { 
    id: 'in', 
    type: 'startNode', 
    data: { label: '互联网', icon: <GlobalOutlined /> }, 
    position: { x: 50, y: 150 }, 
  },
  { 
    id: 'out', 
    type: 'endNode', 
    data: { label: '防护对象', icon: <DatabaseOutlined /> }, 
    position: { x: 750, y: 150 }, 
  }
];

export interface CustomTransferItem extends TransferItem {
  key: string;
  title: string;
  description: string;
  type: 'IP' | 'Network' | 'VSW' | 'VM';
  ports?: string;
}

export const mockTransferData: CustomTransferItem[] = [
  { key: '192.168.1.10', title: 'Web Server', description: '192.168.1.10', type: 'IP', ports: '全部' },
  { key: '192.168.1.11', title: 'DB Server', description: '192.168.1.11', type: 'IP', ports: '全部' },
  { key: '192.168.1.0/24', title: 'Office Network', description: '192.168.1.0/24', type: 'Network', ports: '全部' },
  { key: '10.0.0.0/16', title: 'Core Network', description: '10.0.0.0/16', type: 'Network', ports: '全部' },
  { key: 'vsw-001', title: 'VSW-001', description: 'Core VSW', type: 'VSW', ports: '全部' },
  { key: 'vsw-002', title: 'VSW-002', description: 'Backup VSW', type: 'VSW', ports: '全部' },
  { key: 'vm-001', title: 'VM-Frontend-01', description: '172.16.0.5', type: 'VM', ports: '80,443' },
  { key: 'vm-002', title: 'VM-Frontend-02', description: '172.16.0.6', type: 'VM', ports: '80,443' },
];

export const mockSecurityZones = [
  { id: 'zone-1', name: 'sase2', subType: '公有云VPC网络', provider: 'huaweicloud', region: 'cn-east-3', cidr: '192.168.0.0/16', vrName: '测试PE-B' },
  { id: 'zone-2', name: '勇敢牛牛', subType: '公有云VPC网络', provider: 'aliyun', region: 'cn-hangzhou', cidr: '-', vrName: 'vrouter-openl-x86' },
];

export const SCENARIOS: Record<string, any> = {
  detection: {
    label: '流量检测/防护模式',
    value: 'detection',
    options: [
      { 
        value: 'std', 
        label: '明文流量检测', 
        image: std,
        description: '对未加密的普通流量进行深度包检测（DPI）和入侵防御，适用于内部网络互信区域。'
      },
      { 
        value: 'wan', 
        label: 'WAN 加密流量检测', 
        image: wan,
        description: '针对广域网传输的加密流量（HTTPS/TLS）进行解密并检测，识别隐藏威胁。'
      },
      { 
        value: 'lan-sm', 
        label: 'LAN 商密流量检测', 
        image: lanSm,
        description: '针对局域网内采用商用密码算法加密的流量进行合规性检测与审计。'
      },
      { 
        value: 'lan-gm', 
        label: 'LAN 国密流量检测', 
        image: lanGm,
        description: '针对符合国家密码标准的国密流量进行合规检测，确保自主可控。'
      },
    ]
  },
  encryption: {
    label: '应用加密改造模式',
    value: 'encryption',
    options: [
      { 
        value: 'sm-gz', 
        label: '商密改造', 
        image: smGz,
        description: '对原有应用系统进行商用密码算法升级，满足合规性要求。'
      },
      { 
        value: 'gm-gz', 
        label: '国密改造', 
        image: gmGz,
        description: '将现有系统全面升级为支持国产密码算法（SM2/SM3/SM4），符合信创标准。'
      },
      { 
        value: 'sm-to-gm', 
        label: '商密应用改国密', 
        image: smToGm,
        description: '实现商用密码系统向国产密码系统的平滑迁移与协议转换。'
      },
      { 
        value: 'gm-to-sm', 
        label: '国密应用改商密', 
        image: gmToSm,
        description: '实现国产密码系统与传统商用密码系统的互联互通与协议兼容。'
      },
    ]
  }
};
