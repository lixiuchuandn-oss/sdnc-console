import React, { useState, useCallback } from 'react';
import { Button, Card, Col, Form, Input, Row, Select, Space, Steps, message, Tag, Transfer, Segmented, Radio, Popover, Table, Tooltip, Modal, List, Badge, Progress } from 'antd';
import type { TransferItem, TransferProps } from 'antd/es/transfer';
import type { ColumnsType, TableProps } from 'antd/es/table';
import { useNavigate } from 'react-router-dom';
import PageContainer from '../../../../../components/PageContainer';
import ReactFlow, {
  addEdge,
  Controls,
  Background,
  Node,
  Edge,
  Connection,
  useNodesState,
  useEdgesState,
  BackgroundVariant,
  Handle,
  Position,
  getBezierPath,
  EdgeProps,
  ControlButton,
} from 'react-flow-renderer';
import { 
  DeleteOutlined, 
  SettingOutlined, 
  LayoutOutlined,
  CheckCircleFilled, 
  SafetyCertificateOutlined, 
  ScanOutlined, 
  BugOutlined, 
  GlobalOutlined, 
  DatabaseOutlined,
  FileProtectOutlined,
  CloudServerOutlined,
  FireOutlined,
  ApartmentOutlined,
  ThunderboltOutlined,
  GatewayOutlined,
  AuditOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  ClusterOutlined,
  DeploymentUnitOutlined,
  DesktopOutlined,
  PartitionOutlined,
  EnvironmentOutlined,
  AppstoreOutlined,
  CodeOutlined,
  QuestionCircleOutlined,
} from '@ant-design/icons';

// Import assets
import smGz from '../../../../../assets/sm-gz.png';
import gmGz from '../../../../../assets/gm-gz.png';
import smToGm from '../../../../../assets/sm-to-gm.png';
import gmToSm from '../../../../../assets/gm-to-sm.png';
import std from '../../../../../assets/std.png';
import wan from '../../../../../assets/wan.png';
import lanSm from '../../../../../assets/lan-sm.png';
import lanGm from '../../../../../assets/lan-gm.png';

const SECURITY_SERVICES = [
  { type: 'waf', label: 'WAF', icon: <SafetyCertificateOutlined />, color: '#1677ff' },
  { type: 'ips', label: 'IPS', icon: <ScanOutlined />, color: '#2f54eb' },
  { type: 'av', label: 'Anti-Virus', icon: <BugOutlined />, color: '#ff4d4f' },
  { type: 'fw', label: 'Firewall', icon: <FireOutlined />, color: '#fa541c' },
  { type: 'dlp', label: 'DLP', icon: <FileProtectOutlined />, color: '#722ed1' },
  { type: 'casb', label: 'CASB', icon: <CloudServerOutlined />, color: '#13c2c2' },
  { type: 'lb', label: 'Load Balancer', icon: <ApartmentOutlined />, color: '#08979c' },
  { type: 'ddos', label: 'DDoS', icon: <ThunderboltOutlined />, color: '#eb2f96' },
  { type: 'vpn', label: 'VPN', icon: <GatewayOutlined />, color: '#531dab' },
  { type: 'audit', label: 'Audit', icon: <AuditOutlined />, color: '#096dd9' },
];

const SERVICE_GROUPS: Record<string, { id: string; name: string; description: string; count: number; tags: string[]; cpu: number; mem: number }[]> = {
  waf: [
    { id: 'waf-g1', name: 'WAF-核心业务集群', description: '基于高性能硬件节点的独享集群，提供最高级别的防护能力，适用于金融、支付等关键业务场景。', count: 4, tags: ['高性能', '独享资源', '低延迟'], cpu: 45, mem: 60 },
    { id: 'waf-g2', name: 'WAF-边缘业务集群', description: '基于容器技术的共享集群，弹性伸缩能力强，适用于一般Web业务或突发流量场景。', count: 2, tags: ['弹性伸缩', '高性价比'], cpu: 70, mem: 50 },
    { id: 'waf-g3', name: 'WAF-测试环境集群', description: '单节点实例，仅用于开发测试环境的功能验证，不建议用于生产环境。', count: 1, tags: ['开发测试', '低成本'], cpu: 20, mem: 30 },
  ],
  ips: [
    { id: 'ips-g1', name: 'IPS-高防集群', description: '集成深度包检测(DPI)引擎，支持数万种攻击特征识别，高吞吐量设计。', count: 3, tags: ['深度检测', '高吞吐'], cpu: 55, mem: 75 },
    { id: 'ips-g2', name: 'IPS-标准集群', description: '提供基础的入侵防御能力，平衡性能与防护效果，适用于大多数企业内部业务。', count: 2, tags: ['标准防护', '通用'], cpu: 40, mem: 40 },
  ],
  fw: [
    { id: 'fw-g1', name: 'FW-互联网边界墙', description: '部署于互联网出口，专注于南北向流量控制与NAT转换，具备高并发连接处理能力。', count: 2, tags: ['边界防护', '高并发', 'NAT'], cpu: 80, mem: 65 },
    { id: 'fw-g2', name: 'FW-数据中心内网墙', description: '部署于VPC内部，专注于东西向微隔离，支持精细化的访问控制策略。', count: 4, tags: ['微隔离', '内网安全'], cpu: 30, mem: 45 },
  ]
};

const initialNodes: Node[] = [
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

// Custom edge with particle animation
const ParticleEdge = ({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style = {},
  markerEnd,
}: EdgeProps) => {
  const edgePath = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  return (
    <>
      <path
        id={id}
        style={style}
        className="react-flow__edge-path"
        d={edgePath}
        markerEnd={markerEnd}
      />
      <circle r="3" fill="#1890ff" filter={`url(#glow-${id})`}>
        <animateMotion dur="1.5s" repeatCount="indefinite" path={edgePath} />
      </circle>
      <defs>
        <filter id={`glow-${id}`} x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="2" result="coloredBlur" />
          <feMerge>
            <feMergeNode in="coloredBlur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
    </>
  );
};

const edgeTypes = {
  particle: ParticleEdge,
};

// Custom Node Component
const StartNode = ({ data }: any) => {
  return (
    <div style={{ 
      background: '#fff', 
      border: '1px solid #4096ff', 
      borderRadius: 4,
      padding: '4px 8px',
      boxShadow: '0 2px 10px rgba(24, 144, 255, 0.15), inset 0 0 8px rgba(24, 144, 255, 0.05)',
      fontWeight: 500,
      color: '#1677ff',
      width: 140,
      height: 80,
      fontSize: 13,
      textAlign: 'center',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 4,
      position: 'relative'
    }}>
      {/* Tech decoration lines */}
      <div style={{ position: 'absolute', top: -1, left: -1, width: 8, height: 8, borderTop: '2px solid #4096ff', borderLeft: '2px solid #4096ff', borderTopLeftRadius: 4 }} />
      <div style={{ position: 'absolute', bottom: -1, right: -1, width: 8, height: 8, borderBottom: '2px solid #4096ff', borderRight: '2px solid #4096ff', borderBottomRightRadius: 4 }} />

      <div style={{ fontSize: 24, lineHeight: 1, filter: 'drop-shadow(0 2px 4px rgba(24, 144, 255, 0.2))' }}>{data.icon}</div>
      <div>{data.label}</div>
      <Handle type="source" position={Position.Right} style={{ background: '#1677ff', width: 6, height: 12, right: -3, border: 'none', borderRadius: 1, boxShadow: '0 0 4px rgba(24, 144, 255, 0.6)' }} />
    </div>
  );
};

const EndNode = ({ data }: any) => {
  const protectedObjects = data.protectedObjects || [];
  
  const content = (
    <div style={{ width: 240 }}>
      <div style={{ 
        padding: '8px 12px', 
        background: 'linear-gradient(to right, rgba(22, 119, 255, 0.1), transparent)',
        borderBottom: '1px solid rgba(22, 119, 255, 0.1)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between'
      }}>
        <div style={{ fontWeight: 600, fontSize: 12, color: '#1677ff', display: 'flex', alignItems: 'center', gap: 6 }}>
          <div style={{ width: 3, height: 12, background: '#1677ff', borderRadius: 1.5 }} />
          防护对象
        </div>
        <div style={{ fontSize: 10, color: '#1677ff', background: 'rgba(22, 119, 255, 0.1)', padding: '1px 6px', borderRadius: 10, fontWeight: 500 }}>
          {protectedObjects.length}
        </div>
      </div>
      <div style={{ maxHeight: 200, overflowY: 'auto', padding: '4px' }}>
        {protectedObjects.map((obj: any, index: number) => (
          <div key={obj.key} style={{ 
            display: 'flex', 
            alignItems: 'center', 
            padding: '6px 8px', 
            marginBottom: 2,
            borderRadius: 4,
            background: index % 2 === 0 ? 'rgba(0,0,0,0.01)' : 'transparent',
            fontSize: 12 
          }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 500, lineHeight: 1.2, color: '#262626' }}>{obj.title}</div>
              <div style={{ color: '#8c8c8c', fontSize: 10, lineHeight: 1.2, marginTop: 2 }}>{obj.description}</div>
            </div>
            <div style={{ flexShrink: 0, marginLeft: 8 }}>
              <Tag color="blue" style={{ margin: 0, fontSize: 10, padding: '0 4px', lineHeight: '16px', border: 'none', background: 'rgba(22, 119, 255, 0.1)', color: '#1677ff' }}>{obj.type}</Tag>
            </div>
          </div>
        ))}
        {protectedObjects.length === 0 && <div style={{ color: '#999', textAlign: 'center', padding: '12px 0', fontSize: 12 }}>暂无对象</div>}
      </div>
    </div>
  );

  return (
      <div style={{ 
        background: '#fff', 
        border: '1px solid #4096ff', 
        borderRadius: 4,
        padding: '4px 8px',
        boxShadow: '0 2px 10px rgba(24, 144, 255, 0.15), inset 0 0 8px rgba(24, 144, 255, 0.05)',
        fontWeight: 500,
        color: '#1677ff',
        width: 140,
        height: 80,
        fontSize: 13,
        textAlign: 'center',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 4,
        cursor: 'pointer',
        position: 'relative'
      }}>
        {/* Protected Object Count Badge absolute top-right */}
        <Popover content={content} title={null} trigger="hover" placement="bottom" overlayInnerStyle={{ padding: 0, borderRadius: 8, overflow: 'hidden' }}>
            <div style={{ 
                position: 'absolute', 
                top: 4, 
                right: 4, 
                cursor: 'pointer', 
                zIndex: 10, 
                background: 'rgba(0,0,0,0.05)',
                color: '#8c8c8c',
                fontSize: 10,
                padding: '1px 4px',
                borderRadius: 4,
                lineHeight: 1,
                border: '1px solid rgba(0,0,0,0.05)'
            }} onClick={(e) => e.stopPropagation()}>
                {protectedObjects.length}
            </div>
        </Popover>

        {/* Tech decoration lines */}
        <div style={{ position: 'absolute', top: -1, left: -1, width: 8, height: 8, borderTop: '2px solid #4096ff', borderLeft: '2px solid #4096ff', borderTopLeftRadius: 4 }} />
        <div style={{ position: 'absolute', bottom: -1, right: -1, width: 8, height: 8, borderBottom: '2px solid #4096ff', borderRight: '2px solid #4096ff', borderBottomRightRadius: 4 }} />

        <Handle type="target" position={Position.Left} style={{ background: '#1677ff', width: 6, height: 12, left: -3, border: 'none', borderRadius: 1, boxShadow: '0 0 4px rgba(24, 144, 255, 0.6)' }} />
        <div style={{ fontSize: 24, lineHeight: 1, filter: 'drop-shadow(0 2px 4px rgba(24, 144, 255, 0.2))' }}>{data.icon}</div>
        <div>{data.label}</div>
      </div>
  );
};

const ServiceNode = ({ data }: any) => {
  const instanceCount = data.instanceCount || 1;
  
  const content = (
    <div style={{ width: 260 }}>
      <div style={{ 
        padding: '8px 12px', 
        background: `linear-gradient(to right, ${data.color}15, rgba(255,255,255,0))`,
        borderBottom: `1px solid ${data.color}20`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between'
      }}>
        <div style={{ fontWeight: 600, fontSize: 12, color: data.color, display: 'flex', alignItems: 'center', gap: 6 }}>
          <div style={{ width: 3, height: 12, background: data.color, borderRadius: 1.5 }} />
          实例列表
        </div>
        <div style={{ fontSize: 10, color: data.color, background: `${data.color}15`, padding: '1px 6px', borderRadius: 10, fontWeight: 500 }}>
          {instanceCount}
        </div>
      </div>
      <div style={{ maxHeight: 200, overflowY: 'auto', padding: '4px' }}>
        {(data.instances || []).map((inst: any, index: number) => (
          <div key={inst.id} style={{ 
            display: 'flex', 
            alignItems: 'center', 
            padding: '6px 8px', 
            marginBottom: 2,
            borderRadius: 4,
            background: index % 2 === 0 ? 'rgba(0,0,0,0.01)' : 'transparent',
            fontSize: 12 
          }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 500, lineHeight: 1.2, color: '#262626' }}>{inst.id}</div>
              <div style={{ color: '#8c8c8c', fontSize: 10, lineHeight: 1.2, marginTop: 2, fontFamily: 'monospace' }}>{inst.ip}</div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <div style={{ width: 4, height: 4, borderRadius: '50%', background: inst.status === 'normal' ? '#52c41a' : '#ff4d4f', boxShadow: `0 0 4px ${inst.status === 'normal' ? '#52c41a' : '#ff4d4f'}` }} />
                <span style={{ fontSize: 10, color: inst.status === 'normal' ? '#52c41a' : '#ff4d4f' }}>{inst.status === 'normal' ? '正常' : '异常'}</span>
              </div>
              <span style={{ color: '#8c8c8c', fontSize: 10, fontFamily: 'monospace' }}>{inst.load}%</span>
            </div>
          </div>
        ))}
        {(!data.instances || data.instances.length === 0) && <div style={{ color: '#999', textAlign: 'center', padding: '12px 0', fontSize: 12 }}>暂无实例</div>}
      </div>
    </div>
  );

  return (
    <div style={{ position: 'relative', width: 140, height: 80 }}>
      <div style={{ 
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        borderRadius: 2, 
        background: 'rgba(255, 255, 255, 0.9)', 
        border: `1px solid ${data.color}40`,
        boxShadow: `0 2px 12px ${data.color}15`,
        overflow: 'hidden',
        transition: 'all 0.2s ease-in-out',
        cursor: 'pointer',
        display: 'flex',
        flexDirection: 'column',
        backdropFilter: 'blur(4px)'
      }}>
        
        {/* Top Color Bar */}
        <div style={{ height: 2, background: data.color, width: '100%', boxShadow: `0 0 8px ${data.color}40` }} />

        <div style={{ padding: '8px 10px', flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
            
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1, minWidth: 0 }}>
                    <span style={{ color: data.color, fontSize: 14, display: 'flex', filter: `drop-shadow(0 0 2px ${data.color}40)`, flexShrink: 0 }}>{data.icon}</span>
                    <span style={{ fontWeight: 600, fontSize: 13, color: '#262626', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={data.label}>{data.label}</span>
                </div>
                {/* Status Badge & Info */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
            <Popover content={content} title={null} trigger="hover" placement="bottom" overlayInnerStyle={{ padding: 0, borderRadius: 8, overflow: 'hidden' }}>
                <div style={{ 
                    display: 'flex', 
                            alignItems: 'center', 
                            gap: 4,
                            background: 'rgba(82, 196, 26, 0.1)',
                            padding: '2px 6px',
                            borderRadius: 12,
                            border: '1px solid rgba(82, 196, 26, 0.2)',
                            cursor: 'pointer'
                        }} onClick={(e) => e.stopPropagation()}>
                            <div style={{ width: 5, height: 5, borderRadius: '50%', background: '#52c41a', boxShadow: '0 0 3px #52c41a' }} />
                            <span style={{ fontSize: 10, color: '#52c41a', fontWeight: 500, lineHeight: 1 }}>正常</span>
                        </div>
                    </Popover>
                </div>
            </div>

            {/* Metrics */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
                {/* Instance Count Row */}
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#8c8c8c' }}>
                    <span style={{ color: '#595959' }}>实例数</span>
                    <div style={{ display: 'flex', gap: 2, fontFamily: 'monospace' }}>
                        <span style={{ fontWeight: 500, color: '#595959' }} title="总数">{data.instanceCount || 1}</span>
                        <span style={{ color: '#d9d9d9' }}>/</span>
                        <span style={{ fontWeight: 500, color: '#52c41a' }} title="运行中">{data.instanceCount || 1}</span>
                        <span style={{ color: '#d9d9d9' }}>/</span>
                        <span style={{ fontWeight: 500, color: '#ff4d4f' }} title="异常">0</span>
                    </div>
                </div>

                {/* Load Bar Row */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 4 }}>
                     <span style={{ fontSize: 11, color: '#595959' }}>总负载</span>
                     <div style={{ display: 'flex', alignItems: 'center' }}>
                        <div style={{ width: 40, height: 8, background: '#f0f0f0', borderRadius: 4, overflow: 'hidden' }}>
                            <div style={{ 
                                width: `${data.load || 30}%`, 
                                height: '100%', 
                                background: '#91caff', 
                                borderRadius: 4
                            }} />
                        </div>
                        <span style={{ fontSize: 10, color: '#8c8c8c', width: 24, textAlign: 'right', fontFamily: 'monospace', lineHeight: 1 }}>{data.load || 30}%</span>
                     </div>
                </div>
            </div>
        </div>
      </div>
      <Handle type="target" position={Position.Left} style={{ background: '#1677ff', width: 6, height: 12, left: -3, border: 'none', borderRadius: 1, boxShadow: '0 0 4px rgba(24, 144, 255, 0.6)', zIndex: 1 }} />
      <Handle type="source" position={Position.Right} style={{ background: '#1677ff', width: 6, height: 12, right: -3, border: 'none', borderRadius: 1, boxShadow: '0 0 4px rgba(24, 144, 255, 0.6)', zIndex: 1 }} />
    </div>
  );
};

const nodeTypes = {
  serviceNode: ServiceNode,
  startNode: StartNode,
  endNode: EndNode,
};

interface CustomTransferItem extends TransferItem {
  key: string;
  title: string;
  description: string;
  type: 'IP' | 'Network' | 'VSW' | 'VM';
}

const mockTransferData: CustomTransferItem[] = [
  { key: '192.168.1.10', title: 'Web Server', description: '192.168.1.10', type: 'IP' },
  { key: '192.168.1.11', title: 'DB Server', description: '192.168.1.11', type: 'IP' },
  { key: '192.168.1.0/24', title: 'Office Network', description: '192.168.1.0/24', type: 'Network' },
  { key: '10.0.0.0/16', title: 'Core Network', description: '10.0.0.0/16', type: 'Network' },
  { key: 'vsw-001', title: 'VSW-001', description: 'Core VSW', type: 'VSW' },
  { key: 'vsw-002', title: 'VSW-002', description: 'Backup VSW', type: 'VSW' },
  { key: 'vm-001', title: 'VM-Frontend-01', description: '172.16.0.5', type: 'VM' },
  { key: 'vm-002', title: 'VM-Frontend-02', description: '172.16.0.6', type: 'VM' },
];

interface TableTransferProps extends TransferProps<CustomTransferItem> {
  dataSource: CustomTransferItem[];
  leftColumns: ColumnsType<CustomTransferItem>;
  rightColumns: ColumnsType<CustomTransferItem>;
}

const TableTransfer = ({ leftColumns, rightColumns, ...restProps }: TableTransferProps) => (
  <Transfer {...restProps}>
    {({
      direction,
      filteredItems,
      onItemSelectAll,
      onItemSelect,
      selectedKeys: listSelectedKeys,
      disabled: listDisabled,
    }) => {
      const columns = direction === 'left' ? leftColumns : rightColumns;

      const rowSelection: TableProps<CustomTransferItem>['rowSelection'] = {
        getCheckboxProps: (item) => ({ disabled: listDisabled || item.disabled }),
        onSelectAll(selected, selectedRows) {
          const treeSelectedKeys = selectedRows
            .filter((item) => !item.disabled)
            .map(({ key }) => key);
          const diffKeys = selected
            ? treeSelectedKeys.filter((key) => !listSelectedKeys.includes(key as string))
            : listSelectedKeys.filter((key) => treeSelectedKeys.includes(key as string));
          onItemSelectAll(diffKeys as string[], selected);
        },
        onSelect({ key }, selected) {
          if (key !== undefined) {
            onItemSelect(key as string, selected);
          }
        },
        selectedRowKeys: listSelectedKeys,
      };

      return (
        <Table
          rowSelection={rowSelection}
          columns={columns}
          dataSource={filteredItems}
          size="small"
          pagination={false}
          scroll={{ y: 245 }}
          style={{ pointerEvents: listDisabled ? 'none' : undefined }}
          onRow={({ key, disabled: itemDisabled }) => ({
            onClick: () => {
              if (listDisabled || itemDisabled) return;
              onItemSelect(key as string, !listSelectedKeys.includes(key as string));
            },
          })}
        />
      );
    }}
  </Transfer>
);

const SCENARIOS = {
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

const CreateServiceChainWizard: React.FC = () => {
  const navigate = useNavigate();
  const [current, setCurrent] = useState(0);
  const [form] = Form.useForm();
  const [scenarioType, setScenarioType] = useState<'detection' | 'encryption'>('detection');
  const [selectedTemplate, setSelectedTemplate] = useState<string>('std');
  const [hoveredTemplate, setHoveredTemplate] = useState<string | null>(null);
  
  // React Flow State
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [nodeId, setNodeId] = useState(1);
  const [collapsed, setCollapsed] = useState(false);

  // Group Selection State
  const [groupSelectionVisible, setGroupSelectionVisible] = useState(false);
  const [pendingService, setPendingService] = useState<{type: string, label: string, icon: React.ReactNode, color: string} | null>(null);
  const [selectedGroup, setSelectedGroup] = useState<string>('');

  const onConnect = useCallback((params: Connection) => setEdges((eds) => addEdge({ 
    ...params, 
    type: 'particle', 
    animated: false, 
    style: { stroke: '#adc6ff', strokeWidth: 2 },
  }, eds)), [setEdges]);

  const addNode = (type: string, label: string, icon: React.ReactNode, color: string, groupInfo?: any) => {
    // Check if service type already exists
    if (nodes.some(n => n.data.serviceType === type)) {
      message.warning(`${label} 服务已存在，不能重复添加`);
      return;
    }

    // Check if group selection is needed
    if (SERVICE_GROUPS[type] && !groupInfo) {
      setPendingService({ type, label, icon, color });
      setSelectedGroup(SERVICE_GROUPS[type][0].id);
      setGroupSelectionVisible(true);
      return;
    }

    // Mock data for group instances
    let instanceCount = 1;
    let groupLoad = 30;
    
    if (groupInfo) {
      instanceCount = groupInfo.count;
      groupLoad = Math.floor(Math.random() * 60) + 20;
    } else {
      instanceCount = Math.floor(Math.random() * 3) + 1; // 1-3 instances
      groupLoad = Math.floor(Math.random() * 60) + 20; // 20-80% load
    }
    
    const instances = Array.from({ length: instanceCount }).map((_, i) => ({
      id: `${label}-${nodeId}-${i + 1}`,
      ip: `10.0.${nodeId}.${10 + i}`,
      status: Math.random() > 0.1 ? 'normal' : 'abnormal',
      load: Math.floor(Math.random() * 40) + 20 // Individual load
    }));

    const newNode: Node = {
      id: `node-${nodeId}`,
      type: 'serviceNode',
      position: { x: 250 + (nodeId * 50), y: 150 + (nodeId * 30) },
      data: { 
        label: groupInfo ? groupInfo.name : `${label}-${nodeId}`, 
        typeLabel: label,
        serviceType: type,
        icon: icon,
        color: color,
        instanceCount,
        load: groupLoad,
        instances
      },
    };
    setNodes((nds) => {
      // Insert before the last node (Traffic Out) if possible, or just append
      const outNode = nds.find(n => n.id === 'out');
      const otherNodes = nds.filter(n => n.id !== 'out');
      return outNode ? [...otherNodes, newNode, outNode] : [...nds, newNode];
    });
    setNodeId(nodeId + 1);
  };

  const handleGroupSelectionConfirm = () => {
    if (pendingService && selectedGroup) {
      const groups = SERVICE_GROUPS[pendingService.type];
      const group = groups.find(g => g.id === selectedGroup);
      if (group) {
        addNode(pendingService.type, pendingService.label, pendingService.icon, pendingService.color, group);
      }
    }
    setGroupSelectionVisible(false);
    setPendingService(null);
  };


  const onLayout = useCallback(() => {
    // Topological Sort (Kahn's Algorithm) to linearize the graph
    // This ensures all nodes are on the same horizontal line (y=200) without overlapping,
    // and follows the flow direction.

    const adj = new Map<string, string[]>();
    const inDegree = new Map<string, number>();
    
    // Initialize
    nodes.forEach(n => {
      adj.set(n.id, []);
      inDegree.set(n.id, 0);
    });
    
    // Build Graph
    edges.forEach(e => {
      if (adj.has(e.source) && adj.has(e.target)) {
        adj.get(e.source)!.push(e.target);
        inDegree.set(e.target, (inDegree.get(e.target) || 0) + 1);
      }
    });

    // Initialize queue with nodes having in-degree 0
    const queue: string[] = [];
    const sortedIds: string[] = [];
    
    // Prioritize 'in' node
    if (inDegree.get('in') === 0) {
       queue.push('in');
    }
    
    // Add other 0 in-degree nodes (excluding 'in' which is already handled)
    nodes.forEach(n => {
      if (n.id !== 'in' && inDegree.get(n.id) === 0) {
        queue.push(n.id);
      }
    });

    // Process queue
    while (queue.length > 0) {
      const u = queue.shift()!;
      sortedIds.push(u);
      
      const neighbors = adj.get(u) || [];
      neighbors.forEach(v => {
        inDegree.set(v, (inDegree.get(v)! - 1));
        if (inDegree.get(v) === 0) {
          queue.push(v);
        }
      });
    }

    // Handle cycles or remaining disconnected nodes (append them)
    if (sortedIds.length < nodes.length) {
      const visited = new Set(sortedIds);
      nodes.forEach(n => {
        if (!visited.has(n.id)) {
          sortedIds.push(n.id);
        }
      });
    }

    setNodes((nds) => {
      const layoutMap = new Map<string, number>();
      sortedIds.forEach((id, index) => layoutMap.set(id, index));
      
      return nds.map(node => {
        const index = layoutMap.has(node.id) ? layoutMap.get(node.id)! : 0;
        
        return { 
          ...node, 
          position: { 
            x: 50 + index * 250, 
            y: 150
          } 
        };
      });
    });
  }, [nodes, edges, setNodes]);

  const clearFlow = () => {
    setNodes(initialNodes);
    setEdges([]);
    setNodeId(1);
  };

  const handleFinish = async () => {
    try {
      const values = await form.validateFields();
      console.log('Wizard Finished', { ...values, nodes, edges });
      message.success('服务链创建成功');
      navigate('/admin/security/traffic/service-chains');
    } catch (error) {
      console.error('Validation failed:', error);
    }
  };

  const next = async () => {
    try {
      if (current === 0) {
        await form.validateFields(['name', 'cluster']);
      } else if (current === 1) {
        await form.validateFields(['protectedObjects']);
        
        // Update 'out' node with selected protected objects
        const selectedKeys = form.getFieldValue('protectedObjects') || [];
        const selectedObjects = mockTransferData.filter(item => selectedKeys.includes(item.key));
        
        setNodes((nds) => nds.map(node => {
          if (node.id === 'out') {
            return {
              ...node,
              data: {
                ...node.data,
                protectedObjects: selectedObjects
              }
            };
          }
          return node;
        }));
      }
      setCurrent(current + 1);
    } catch (error) {
      console.error('Validation failed:', error);
    }
  };

  const prev = () => {
    setCurrent(current - 1);
  };

  const steps = [
    { title: '基本信息' },
    { title: '防护对象' },
    { title: '服务链编排' },
    { title: '确认创建' },
  ];

  const renderContent = () => {
    // Step 1: Basic Info
    if (current === 0) {
      return (
        <div style={{ maxWidth: 900, margin: '0' }}>
          
            <div style={{ paddingBottom: 16 }}>
              <div style={{ fontSize: 20, fontWeight: 500, color: '#1f1f1f', display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ width: 4, height: 20, background: '#1677ff', borderRadius: 2 }} />
                设定服务链的应用场景
              </div>
              <div style={{ marginTop: 8, color: '#8c8c8c', fontSize: 14, marginLeft: 14 }}>
                定义服务链的基础属性与运行模式，支持根据业务需求灵活选择流量检测或加密改造场景，构建安全可靠的流量编排基石。
              </div>
            </div>

            <Form form={form} layout="vertical" >
              <Form.Item >
                 <div style={{ display: 'flex', flexDirection: 'column' }}>
                   <Segmented 
                     options={[
                       { label: '流量检测/防护模式', value: 'detection', icon: <SafetyCertificateOutlined /> },
                       { label: '应用加密改造模式', value: 'encryption', icon: <FileProtectOutlined /> }
                     ]}
                     value={scenarioType}
                     onChange={(val) => {
                        setScenarioType(val as 'detection' | 'encryption');
                        setSelectedTemplate(SCENARIOS[val as 'detection' | 'encryption'].options[0].value);
                     }}
                     block
                     style={{ marginBottom: 24, padding: 4, background: '#f5f7fa' }}
                     size="middle"
                   />
                   
                   <Row gutter={[24, 24]}>
                     {SCENARIOS[scenarioType].options.map(option => {
                       const isSelected = selectedTemplate === option.value;
                       const isHovered = hoveredTemplate === option.value;
                       
                       const popoverContent = (
                          <div style={{ width: 750, padding: 0}}>
                              <div style={{ 
                                background: '#f0f5ff', 
                                padding: 50, 
                                display: 'flex', 
                                justifyContent: 'center',
                                borderBottom: '1px solid #1165ff'
                              }}>
                                  <img 
                                    src={option.image} 
                                    alt={option.label} 
                                    style={{ 
                                      width: '100%', 
                                      height: 240, 
                                      objectFit: 'contain',
                                      filter: 'drop-shadow(0 4px 12px rgba(0,0,0,0.1))',
                                      transform: 'scale(1.1)',
                                      transition: 'transform 0.3s'
                                    }} 
                                  />
                              </div>
                              <div style={{ padding: '16px 20px' }}>
                                  <div style={{ fontSize: 16, fontWeight: 600, color: '#1f1f1f', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 12 }}>
                                      {option.label}
                                      <Tag color="blue" style={{ margin: 0, fontSize: 12, lineHeight: '20px' }}>模式详情</Tag>
                                  </div>
                                  <div style={{ fontSize: 14, color: '#666', textAlign: 'justify' }}>
                                      {option.description}
                                  </div>
                              </div>
                          </div>
                        );

                       return (
                         <Col span={6} key={option.value}>
                           <Popover 
                             content={popoverContent} 
                             placement="right" 
                             overlayInnerStyle={{ padding: 0, borderRadius: 12, overflow: 'hidden', boxShadow: '0 8px 32px rgba(0,0,0,0.12)' }}
                             mouseEnterDelay={0.2}
                           >
                             <div
                               onClick={() => setSelectedTemplate(option.value)}
                               onMouseEnter={() => setHoveredTemplate(option.value)}
                               onMouseLeave={() => setHoveredTemplate(null)}
                               style={{ 
                                 cursor: 'pointer',
                                 borderRadius: 12,
                                 border: isSelected ? '2px solid #1677ff' : (isHovered ? '1px solid #1677ff' : '1px solid #e8e8e8'),
                                 background: isSelected ? '#f0f5ff' : '#fff',
                                 overflow: 'hidden',
                                 transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                                 position: 'relative',
                                 height: '100%',
                                 boxShadow: isSelected 
                                   ? '0 8px 20px rgba(22, 119, 255, 0.15)' 
                                   : (isHovered ? '0 8px 20px rgba(0,0,0,0.08)' : '0 2px 8px rgba(0,0,0,0.02)'),
                                 transform: isSelected || isHovered ? 'translateY(-4px)' : 'none'
                               }}
                             >
                               {isSelected && (
                                 <div style={{ 
                                   position: 'absolute', top: 0, right: 0, 
                                   width: 0, height: 0, 
                                   borderTop: '40px solid #1677ff', 
                                   borderLeft: '40px solid transparent',
                                   zIndex: 1
                                 }}>
                                   <CheckCircleFilled style={{ position: 'absolute', top: -34, right: 6, color: '#fff', fontSize: 16 }} />
                                 </div>
                               )}
                               
                               <div style={{ padding: 4 }}>
                                 <div style={{ 
                                   background: isSelected ? '#fff' : '#f5f7fa',
                                   borderRadius: 8,
                                   height: 120,
                                   display: 'flex',
                                   alignItems: 'center',
                                   justifyContent: 'center',
                                   overflow: 'hidden',
                                   transition: 'all 0.3s'
                                 }}>
                                   <img 
                                     alt={option.label} 
                                     src={option.image} 
                                     style={{ 
                                       maxWidth: '80%', 
                                       maxHeight: '80%', 
                                       objectFit: 'contain',
                                       filter: isSelected ? 'none' : 'grayscale(100%) opacity(0.7)',
                                       transition: 'all 0.3s'
                                     }} 
                                   />
                                 </div>
                               </div>
                               
                               <div style={{ padding: '12px 16px', textAlign: 'center' }}>
                                 <div style={{ fontWeight: isSelected ? 600 : 500, color: isSelected ? '#1677ff' : '#595959', fontSize: 14 }}>
                                   {option.label}
                                 </div>
                               </div>
                             </div>
                           </Popover>
                         </Col>
                       );
                     })}
                   </Row>
                 </div>
              </Form.Item>

              <div>
                  <Row gutter={24}>
                    <Col span={12}>
                      <Form.Item name="name" label="服务链名称" rules={[{ required: true, message: '请输入名称' }]}>
                        <Input 
                          placeholder="请输入服务链名称" 
                          prefix={<CodeOutlined style={{ color: '#bfbfbf' }} />}
                          size="middle"
                          style={{ borderRadius: 6 }}
                        />
                      </Form.Item>
                    </Col>
                    <Col span={12}>
                      <Form.Item name="cluster" label="所属集群" rules={[{ required: true, message: '请选择集群' }]}>
                        <Select 
                          placeholder="请选择集群" 
                          size="middle"
                          suffixIcon={<AppstoreOutlined style={{ color: '#bfbfbf' }} />}
                          style={{ borderRadius: 6 }}
                        >
                          <Select.Option value="Cluster-A">
                             <Space><CloudServerOutlined /> Cluster-A (高性能)</Space>
                          </Select.Option>
                          <Select.Option value="Cluster-B">
                             <Space><CloudServerOutlined /> Cluster-B (标准型)</Space>
                          </Select.Option>
                        </Select>
                      </Form.Item>
                    </Col>
                  </Row>
                  
                  <Form.Item name="description" label="描述" style={{ marginBottom: 0 }}>
                    <Input.TextArea 
                      rows={3} 
                      placeholder="请输入描述信息" 
                      style={{ borderRadius: 6 }}
                      showCount
                      maxLength={200}
                    />
                  </Form.Item>
              </div>
            </Form>
          
        </div>
      );
    }

    // Step 2: Protection Objects
    if (current === 1) {
      return (
        <div >
      
            <div style={{paddingBottom: 16 }}>
              <div style={{ fontSize: 20, fontWeight: 500, color: '#1f1f1f', display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ width: 4, height: 20, background: '#1677ff', borderRadius: 2 }} />
                设定服务链的防护对象
              </div>
              <div style={{ marginTop: 8, color: '#8c8c8c', fontSize: 14, marginLeft: 14 }}>
                选择需接入服务链的核心资产对象，支持多维度资源（云主机、网络、IP）的混合编排，通过智能引流技术实现对业务流量的全方位安全覆盖。
              </div>
            </div>


            <Form form={form} layout="vertical">
              <Form.Item 
                name="protectedObjects" 
                valuePropName="targetKeys"
                rules={[{ required: true, message: '请至少选择一个防护对象' }]}

              >
                <TableTransfer
                  style={{ width: '100%' }}
                  listStyle={{ 
                    height: 400,
                    borderRadius: 8,
                    border: '1px solid #f0f0f0'
                  }}
                  dataSource={mockTransferData}
                  titles={[
                    <div style={{ color: '#595959' }}>待选对象</div>, 
                    <div style={{ color: '#1677ff' }}>已选对象</div>
                  ]}
                  targetKeys={form.getFieldValue('protectedObjects')}
                  leftColumns={[
                    { 
                      dataIndex: 'title', 
                      title: '防护对象',
                      render: (text, record) => (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                           <div style={{ 
                             width: 32, height: 32, 
                             background: '#f5f7fa', 
                             borderRadius: 6, 
                             display: 'flex', alignItems: 'center', justifyContent: 'center',
                             color: '#1677ff'
                           }}>
                             {record.type === 'VM' && <CloudServerOutlined />}
                             {record.type === 'Network' && <GlobalOutlined />}
                             {record.type === 'VSW' && <PartitionOutlined />}
                             {record.type === 'IP' && <EnvironmentOutlined />}
                           </div>
                           <div style={{ display: 'flex', flexDirection: 'column' }}>
                             <span>{text}</span>
                           </div>
                        </div>
                      )
                    },
                    { 
                      dataIndex: 'type', 
                      title: '类型',
                      width: 100,
                      render: (text) => <Tag color="blue">{text}</Tag>,
                      filters: [
                        { text: 'IP', value: 'IP' },
                        { text: 'Network', value: 'Network' },
                        { text: 'VSW', value: 'VSW' },
                        { text: 'VM', value: 'VM' },
                      ],
                      onFilter: (value: boolean | React.Key, item: CustomTransferItem) => item.type === value,
                    },
                    { 
                      dataIndex: 'title', 
                      title: '防护范围',
                      render: (text, record) => (
                        <div>
                           <div style={{ display: 'flex', flexDirection: 'column' }}>
                             <span>{record.key}</span>
                           </div>
                        </div>
                      )
                    },
                  ]}
                  rightColumns={[
                    { 
                      dataIndex: 'title', 
                      title: '防护对象',
                      render: (text, record) => (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                           <div style={{ 
                             width: 32, height: 32, 
                             background: '#e6f7ff', 
                             borderRadius: 6, 
                             display: 'flex', alignItems: 'center', justifyContent: 'center',
                             color: '#1677ff'
                           }}>
                             {record.type === 'VM' && <CloudServerOutlined />}
                             {record.type === 'Network' && <GlobalOutlined />}
                             {record.type === 'VSW' && <PartitionOutlined />}
                             {record.type === 'IP' && <EnvironmentOutlined />}
                           </div>
                           <div style={{ display: 'flex', flexDirection: 'column' }}>
                             <span style={{ fontWeight: 500, color: '#1677ff' }}>{text}</span>
                             <span style={{ fontSize: 10, color: '#8c8c8c' }}>{record.key}</span>
                           </div>
                        </div>
                      )
                    },
                    { dataIndex: 'type', title: '类型', width: 100, render: (text) => <Tag>{text}</Tag> },
                  ]}
                  filterOption={(inputValue, item) =>
                    (item.title?.indexOf(inputValue) ?? -1) > -1 || (item.description?.indexOf(inputValue) ?? -1) > -1
                  }
                  showSearch
                />
              </Form.Item>
              
              <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
                <Popover
                  content={
                    <div style={{ maxWidth: 500 }}>
                      <ol style={{ margin: 0, paddingLeft: 20, color: 'rgba(0, 0, 0)', lineHeight: 1.8, fontSize: 13 }}>
                        <li>您可以将已创建的 防护目标 添加到安全域，或者点击右上角创建新防护目标。</li>
                        <li>支持多选不同类型的资源对象（云主机、子网、弹性公网IP等）进行混合编排。</li>
                        <li>选中的对象将作为流量入口，自动引流至后续配置的安全服务链中。</li>
                      </ol>
                    </div>
                  }
                  title={null}
                  trigger="hover"
                  placement="topRight"
                >
                  <span style={{ 
                    cursor: 'pointer', 
                    color: '#8c8c8c', 
                    fontSize: 14, 
                    display: 'flex', 
                    alignItems: 'center', 
                    gap: 6,
                    transition: 'color 0.3s'
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.color = '#1677ff'}
                  onMouseLeave={(e) => e.currentTarget.style.color = '#8c8c8c'}
                  >
                    <QuestionCircleOutlined />
                    <span style={{ fontSize: 13 }}>如何选择防护对象？</span>
                  </span>
                </Popover>
              </div>
            </Form>
          
        </div>
      );
    }

    // Step 3: Orchestration
    if (current === 2) {
      return (
        <>
        <div style={{ height: 600, display: 'flex', border: '1px solid #e8e8e8', borderRadius: 8, overflow: 'hidden', background: '#fff' }}>
          {/* Component Library Sidebar */}
          <div style={{ width: collapsed ? 64 : 200, borderRight: '1px solid #e8e8e8', display: 'flex', flexDirection: 'column', background: '#fff', transition: 'width 0.2s' }}>
            <div style={{ height: 46, padding: collapsed ? '0' : '0 16px', fontWeight: 600, fontSize: 14, borderBottom: '1px solid #f0f0f0', display: 'flex', alignItems: 'center', justifyContent: collapsed ? 'center' : 'flex-start', gap: 8 }}>
               {collapsed ? (
                 <div onClick={() => setCollapsed(false)} style={{ cursor: 'pointer', display: 'flex', justifyContent: 'center', width: '100%' }}>
                   <Tooltip title="展开" placement="right">
                     <MenuUnfoldOutlined style={{ fontSize: 16, color: '#666' }} />
                   </Tooltip>
                 </div>
               ) : (
                 <div style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%' }}>
                   <MenuFoldOutlined 
                     onClick={() => setCollapsed(true)} 
                     style={{ cursor: 'pointer', color: '#666', fontSize: 16 }} 
                   />
                   <span>组件库</span>
                 </div>
               )}
            </div>
            
            <div style={{ flex: 1, overflowY: 'auto', padding: collapsed ? '12px 0' : 12, display: 'flex', flexDirection: 'column', alignItems: collapsed ? 'center' : 'stretch' }}>
               {!collapsed && <div style={{ marginBottom: 8, fontSize: 12, color: '#999' }}>点击添加服务节点：</div>}
               
               {collapsed ? (
                 <div style={{ display: 'flex', flexDirection: 'column', gap: 8, width: '100%', alignItems: 'center' }}>
                   {SECURITY_SERVICES.map(service => (
                     <Tooltip title={service.label} placement="right" key={service.type}>
                       <div 
                         onClick={() => addNode(service.type, service.label, service.icon, service.color)}
                         style={{ 
                           width: 40,
                           height: 40,
                           borderRadius: 6, 
                           cursor: 'pointer',
                           display: 'flex', 
                           alignItems: 'center',
                           justifyContent: 'center',
                           transition: 'all 0.2s',
                           fontSize: 20,
                           color: service.color,
                           background: '#fff',
                           border: '1px solid transparent'
                         }}
                         onMouseEnter={(e) => {
                           e.currentTarget.style.background = `${service.color}15`;
                           e.currentTarget.style.border = `1px solid ${service.color}`;
                         }}
                         onMouseLeave={(e) => {
                           e.currentTarget.style.background = '#fff';
                           e.currentTarget.style.border = '1px solid transparent';
                         }}
                       >
                         {service.icon}
                       </div>
                     </Tooltip>
                   ))}
                 </div>
               ) : (
                 <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                   {SECURITY_SERVICES.map(service => (
                     <div 
                       key={service.type}
                       onClick={() => addNode(service.type, service.label, service.icon, service.color)}
                       style={{ 
                         border: '1px solid #d9d9d9', 
                         borderRadius: 4, 
                         cursor: 'pointer',
                         display: 'flex', 
                         flexDirection: 'column',
                         alignItems: 'center',
                         justifyContent: 'center',
                         padding: '12px 4px',
                         transition: 'all 0.2s',
                         background: '#fff',
                         fontSize: 12
                       }}
                       onMouseEnter={(e) => {
                         e.currentTarget.style.borderColor = service.color;
                         e.currentTarget.style.color = service.color;
                         e.currentTarget.style.background = `${service.color}08`;
                       }}
                       onMouseLeave={(e) => {
                         e.currentTarget.style.borderColor = '#d9d9d9';
                         e.currentTarget.style.color = 'inherit';
                         e.currentTarget.style.background = '#fff';
                       }}
                     >
                       <div style={{ fontSize: 20, marginBottom: 4, color: service.color }}>{service.icon}</div>
                       <div>{service.label}</div>
                     </div>
                   ))}
                 </div>
               )}
            </div>

            <div style={{ borderTop: '1px solid #f0f0f0', background: '#fafafa' }}>
               <div style={{ padding: collapsed ? '6px 0' : '6px 12px', display: 'flex', justifyContent: 'center' }}>
                 {collapsed ? (
                  <Tooltip title="重置画布" placement="right">
                    <Button danger type="text" icon={<DeleteOutlined />} onClick={clearFlow} style={{ height: 32 }} />
                  </Tooltip>
                ) : (
                  <Button danger block type="text" icon={<DeleteOutlined />} onClick={clearFlow} style={{ height: 32 }}>重置画布</Button>
                )}
               </div>
            </div>
          </div>

          {/* Canvas Area */}
          <div style={{ flex: 1, background: '#f5f7fa', position: 'relative' }}>
             {/* Decorative Background */}
             <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 0 }}>
               {/* Grid Pattern Overlay */}
               <div style={{ 
                 position: 'absolute', 
                 inset: 0, 
                 backgroundImage: 'radial-gradient(#e6f7ff 1px, transparent 1px)', 
                 backgroundSize: '20px 20px', 
                 opacity: 0.5 
               }} />
               {/* Subtle Vignette */}
               <div style={{ 
                 position: 'absolute', 
                 inset: 0, 
                 background: 'radial-gradient(circle at center, transparent 0%, rgba(240, 245, 255, 0.4) 100%)',
                 pointerEvents: 'none'
               }} />
               {/* Watermark */}
               <div style={{
                 position: 'absolute',
                 bottom: 20,
                 right: 20,
                 fontSize: 100,
                 fontWeight: 900,
                 color: 'rgba(22, 119, 255, 0.03)',
                 pointerEvents: 'none',
                 userSelect: 'none',
                 fontFamily: 'Arial Black, sans-serif',
                 zIndex: 0
               }}>
                 SECURITY
               </div>
             </div>

             <ReactFlow
              nodes={nodes}
              edges={edges}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              nodeTypes={nodeTypes}
              edgeTypes={edgeTypes}
              fitView
              style={{ background: 'transparent' }}
            >
               <Background color="#1677ff" gap={24} size={1} variant={BackgroundVariant.Dots} style={{ opacity: 0.1 }} />
               <Controls 
                 style={{ 
                   bottom: 20, 
                   left: '50%', 
                   transform: 'translateX(-50%)', 
                   display: 'flex', 
                   gap: 8, 
                   padding: 6, 
                   background: 'rgba(255, 255, 255, 0.8)', 
                   backdropFilter: 'blur(8px)', 
                   borderRadius: 12, 
                   border: '1px solid rgba(255, 255, 255, 0.3)',
                   boxShadow: '0 4px 12px rgba(0, 0, 0, 0.08)'
                 }} 
                 showInteractive={false}
               >
                 <ControlButton onClick={onLayout} title="整理节点" style={{ border: 'none', background: 'transparent', color: '#595959' }}>
                   <LayoutOutlined />
                 </ControlButton>
               </Controls>
             </ReactFlow>
          </div>
        </div>
        <Modal
            title={
              <div style={{ display: 'flex', alignItems: 'center'}}>
                <span>选择 {pendingService?.label} 网元组</span>
              </div>
            }
            open={groupSelectionVisible}
            onCancel={() => {
              setGroupSelectionVisible(false);
              setPendingService(null);
            }}
            onOk={handleGroupSelectionConfirm}
            width={640}
            centered
            okText="确认添加"
            cancelText="取消"
          >
            <div style={{ marginTop: 16 }}>
              <Table
                dataSource={pendingService ? SERVICE_GROUPS[pendingService.type] : []}
                rowKey="id"
                columns={[
                  { 
                    title: '集群名称', 
                    dataIndex: 'name', 
                    width: 180, 
                    render: (t) => <span>{t}</span> 
                  },
                  { 
                    title: '节点数量', 
                    dataIndex: 'count',
                    width: 100,
                    render: (count) => <span>{count} 节点</span>
                  },
                  { 
                    title: '总负载', 
                    width: 180, 
                    render: (_, r) => {
                      const load = Math.round((r.cpu + r.mem) / 2);
                      return (
                        <div style={{ width: 140 }}>
                          <Progress 
                            percent={load} 
                            size="small" 
                            status={load > 80 ? 'exception' : 'normal'}
                            strokeColor={load > 80 ? '#ff4d4f' : '#52c41a'}
                          />
                        </div>
                      );
                    }
                  },
                ]}
                rowSelection={{
                  type: 'radio',
                  selectedRowKeys: selectedGroup ? [selectedGroup] : [],
                  onChange: (keys) => setSelectedGroup(keys[0] as string)
                }}
                onRow={(record) => ({
                  onClick: () => setSelectedGroup(record.id),
                  style: { cursor: 'pointer' }
                })}
                pagination={false}
                size="small"
                style={{ border: '1px solid #f0f0f0', borderRadius: 8 }}
              />
            </div>
          </Modal>
        </>
      );
    }

    // Step 4: Review
    if (current === 3) {
      const values = form.getFieldsValue(true);
      
      // Map keys to titles for better display
      const selectedObjects = (values.protectedObjects || []).map((key: string) => {
        const item = mockTransferData.find((d: CustomTransferItem) => d.key === key);
        return item ? `${item.title} (${item.key})` : key;
      });

      const scenarioLabel = SCENARIOS[scenarioType].label;
      const templateLabel = SCENARIOS[scenarioType].options.find(o => o.value === selectedTemplate)?.label;

      return (
        <div style={{ padding: 24 }}>
          <Card title="基本信息" size="small" bordered={false}>
            <p><strong>场景模式:</strong> {scenarioLabel} - {templateLabel}</p>
            <p><strong>名称:</strong> {values.name}</p>
            <p><strong>集群:</strong> {values.cluster}</p>
            <p><strong>描述:</strong> {values.description || '-'}</p>
          </Card>
          <Card title="防护对象" size="small" bordered={false} style={{ marginTop: 16 }}>
            <p>{selectedObjects.join(', ') || '未选择'}</p>
          </Card>
          <Card title="编排拓扑" size="small" bordered={false} style={{ marginTop: 16 }}>
             <p>包含 {nodes.length} 个节点，{edges.length} 条连接。</p>
             {/* Small preview could go here if we had a non-interactive mode */}
          </Card>
        </div>
      );
    }
  };

  return (
    <PageContainer
      title={<span>创建服务链向导</span>}
      titleLevel={3}
      subtitle="分步配置服务链的基本信息、防护对象及流量编排策略"
      onBack={() => navigate('/admin/security/traffic/service-chains')}
      asCard={false}
    >
      <Row gutter={16}>
        <Col span={5}>
          <Card size="small" title="步骤" variant="outlined" style={{ position: 'sticky', top: 16 }}>
            <Steps 
              direction="vertical" 
              size="small" 
              current={current} 
              items={steps} 
            />
          </Card>
        </Col>
        <Col span={19}>
          <Card size="small" title={`第 ${current + 1} 步：${steps[current].title}`} variant="outlined">
            <div style={{ minHeight: 400 }}>
              {renderContent()}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 24, paddingTop: 16, borderTop: '1px solid #f0f0f0' }}>
              <Button onClick={() => navigate('/admin/security/traffic/service-chains')}>取消</Button>
              <Space>
                {current > 0 && <Button onClick={prev}>上一步</Button>}
                {current < steps.length - 1 && <Button type="primary" onClick={next}>下一步</Button>}
                {current === steps.length - 1 && (
                  <Button type="primary" onClick={handleFinish}>
                    提交创建
                  </Button>
                )}
              </Space>
            </div>
          </Card>
        </Col>
      </Row>
    </PageContainer>
  );
};

export default CreateServiceChainWizard;