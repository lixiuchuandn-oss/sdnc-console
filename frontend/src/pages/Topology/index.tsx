import React, { useCallback, useEffect, useRef, useState } from 'react';
import ReactFlow, {
  Controls,
  Background,
  Handle,
  Position,
  NodeProps,
  Node,
  Edge,
  useNodesState,
  useEdgesState
} from 'react-flow-renderer';
import { ClusterOutlined, DatabaseOutlined, GlobalOutlined, CodepenOutlined } from '@ant-design/icons';
import axios from 'axios';

const getField = (data: Record<string, any>, keys: string[]): string => {
  for (const k of keys) {
    if (data[k] !== undefined && data[k] !== null && data[k] !== '') return data[k];
    const found = Object.keys(data).find(key => key.toLowerCase() === k.toLowerCase());
    if (found && data[found] !== undefined && data[found] !== null && data[found] !== '') return data[found];
  }
  return '-';
};

const nodeTypes = {
  platform: (props: NodeProps) => {
    const isOnline = true;
    return (
      <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 16 }}>
        <div
          style={{
            position: 'relative',
            width: 100,
            height: 100,
            borderRadius: '50%',
            background: 'linear-gradient(135deg, #722ed1 0%, #531dab 100%)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 12px 48px rgba(83, 29, 171, 0.35), 0 0 30px rgba(114, 46, 209, 0.3)',
            border: '4px solid white',
            zIndex: 3
          }}
        >
          <ClusterOutlined style={{ fontSize: 48, color: 'white' }} />
          <Handle type="source" position={Position.Top} id="center-out" style={{ opacity: 0, top: '58%', left: '50%', transform: 'translate(-50%,-50%)' }} />
          <Handle type="target" position={Position.Top} id="center-in" style={{ opacity: 0, top: '58%', left: '50%', transform: 'translate(-50%,-50%)' }} />
          <Handle type="source" position={Position.Top} id="top-out" style={{ opacity: 0 }} />
          <Handle type="source" position={Position.Bottom} id="bottom-out" style={{ opacity: 0 }} />
          <Handle type="source" position={Position.Left} id="left-out" style={{ opacity: 0 }} />
          <Handle type="source" position={Position.Right} id="right-out" style={{ opacity: 0 }} />
          <Handle type="target" position={Position.Top} id="top-in" style={{ opacity: 0 }} />
          <Handle type="target" position={Position.Bottom} id="bottom-in" style={{ opacity: 0 }} />
          <Handle type="target" position={Position.Left} id="left-in" style={{ opacity: 0 }} />
          <Handle type="target" position={Position.Right} id="right-in" style={{ opacity: 0 }} />
        </div>
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
          padding: '8px 12px',
          background: 'rgba(255,255,255,0.95)',
          borderRadius: 12,
          boxShadow: '0 4px 16px rgba(0,0,0,0.08)',
          border: '1px solid #f0f0f0'
        }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: '#262626' }}>
            Compute.Tower 平台
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 12, color: '#666' }}>纳管中心</span>
            <div style={{
              width: 8, height: 8, borderRadius: '50%',
              background: isOnline ? '#52c41a' : '#ff4d4f',
              boxShadow: isOnline ? '0 0 8px rgba(82, 196, 26, 0.4)' : '0 0 8px rgba(255, 77, 79, 0.4)'
            }} />
          </div>
        </div>
      </div>
    );
  },
  cloud: (props: NodeProps) => {
    const platformKeys = [
      'platform', 'provider', 'cloudPlatform', 'vendor', 'cloud_vendor', 'cloudProvider', 'cloud_platform', 'platformName', 'platform_name'
    ];
    let platformValue = '';
    if (props.data.config && typeof props.data.config === 'object') {
      for (const k of platformKeys) {
        if (props.data.config[k] && typeof props.data.config[k] === 'string' && props.data.config[k].trim() !== '') {
          platformValue = props.data.config[k];
          break;
        }
      }
    }
    if (!platformValue) {
      for (const k of platformKeys) {
        if (props.data[k] && typeof props.data[k] === 'string' && props.data[k].trim() !== '') {
          platformValue = props.data[k];
          break;
        }
      }
    }

    const providerMap: Record<string, string> = {
      aliyun: '阿里云',
      aws: 'AWS',
      azure: 'Azure',
      huaweicloud: '华为云',
      tencentcloud: '腾讯云',
      ucloud: 'UCloud',
      google: 'Google Cloud',
      tianyi: '天翼云',
      yidong: '移动云',
      vmware: 'VMware',
      openstack: 'OpenStack',
      dstack: 'DStack',
      zstack: 'ZStack',
      feitiancloud: '飞天',
      s3: 'S3',
      ceph: 'Ceph',
      sky: 'SKY',
      builtinprivate: '内置私有云',
      kvm: 'KVM',
      rancher: 'Rancher',
    };

    const typeMap: Record<string, string> = {
      central: '公有云',
      edge: '边缘云',
      hybrid: '混合云',
    };

    const isOnline = getField(props.data, ['status', 'state', 'online']) === 'online';
    const cloudName = getField(props.data, ['name', 'label', 'title']);
    const cloudType = getField(props.data, ['type', 'cloudType', 'category', 'platformType', 'platform_type']);
    const cloudRegion = getField(props.data, ['region', 'location', 'area']);
    const provider = providerMap[platformValue] || platformValue || '-';

    const cx = (props.data && props.data.center && typeof props.data.center.x === 'number') ? props.data.center.x : ((typeof window !== 'undefined' && window.innerWidth) ? Math.round(window.innerWidth / 2) : 600);
    const cy = (props.data && props.data.center && typeof props.data.center.y === 'number') ? props.data.center.y : ((typeof window !== 'undefined' && window.innerHeight) ? Math.round(window.innerHeight / 2) : 400);
    const nodeX = props.xPos || 0;
    const nodeY = props.yPos || 0;
    
    const isLeftSide = nodeX < cx;
    const isTopSide = nodeY < cy;
    
    const cardDirection = 'bottom'; // 注释卡片统一在主节点下方

    return (
      <div style={{ 
        position: 'relative', 
        display: 'flex', 
        alignItems: 'center', 
        justifyContent: 'center',
        gap: 12,
        flexDirection: 'column'
      }}>
        {/* 主图标节点 */}
        <div
          style={{
            position: 'relative',
            width: 80,
            height: 80,
            borderRadius: '50%',
            background: isOnline 
              ? 'linear-gradient(135deg, #1890ff 0%, #40a9ff 100%)'
              : 'linear-gradient(135deg, #d9d9d9 0%, #bfbfbf 100%)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: isOnline 
              ? '0 8px 32px rgba(24, 144, 255, 0.3), 0 0 20px rgba(24, 144, 255, 0.2)'
              : '0 8px 32px rgba(0, 0, 0, 0.1)',
            transition: 'all 0.3s ease',
            cursor: 'pointer',
            zIndex: 2,
            border: '3px solid white',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.transform = 'scale(1.1)';
            e.currentTarget.style.boxShadow = isOnline 
              ? '0 12px 48px rgba(24, 144, 255, 0.4), 0 0 30px rgba(24, 144, 255, 0.3)'
              : '0 12px 48px rgba(0, 0, 0, 0.15)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.transform = 'scale(1)';
            e.currentTarget.style.boxShadow = isOnline 
              ? '0 8px 32px rgba(24, 144, 255, 0.3), 0 0 20px rgba(24, 144, 255, 0.2)'
              : '0 8px 32px rgba(0, 0, 0, 0.1)';
          }}
        >
          <CodepenOutlined style={{ fontSize: 40, color: 'white' }} />

          {/* 连接点 - 隐藏但保持功能 */}
          <Handle 
            type="source" 
            position={Position.Top} 
            id="center-out"
            style={{ 
              opacity: 0,
              left: '50%',
              top: '50%',
              transform: 'translate(-50%, -50%)'
            }} 
          />
          <Handle 
            type="target" 
            position={Position.Top} 
            id="center-in"
            style={{ 
              opacity: 0,
              left: '50%',
              top: '50%',
              transform: 'translate(-50%, -50%)'
            }} 
          />
          <Handle 
            type="source" 
            position={Position.Bottom} 
            id="bottom-out"
            style={{ 
              opacity: 0,
              left: '45%'
            }} 
          />
          <Handle 
            type="target" 
            position={Position.Bottom} 
            id="bottom-in"
            style={{ 
              opacity: 0,
              left: '55%'
            }} 
          />
          <Handle 
            type="source" 
            position={Position.Top} 
            id="top-out"
            style={{ 
              opacity: 0,
              left: '45%'
            }} 
          />
          <Handle 
            type="target" 
            position={Position.Top} 
            id="top-in"
            style={{ 
              opacity: 0,
              left: '55%'
            }} 
          />
          <Handle 
            type="source" 
            position={Position.Left} 
            id="left-out"
            style={{ 
              opacity: 0,
              top: '45%'
            }} 
          />
          <Handle 
            type="target" 
            position={Position.Left} 
            id="left-in"
            style={{ 
              opacity: 0,
              top: '55%'
            }} 
          />
          <Handle 
            type="source" 
            position={Position.Right} 
            id="right-out"
            style={{ 
              opacity: 0,
              top: '45%'
            }} 
          />
          <Handle 
            type="target" 
            position={Position.Right} 
            id="right-in"
            style={{ 
              opacity: 0,
              top: '55%'
            }} 
          />
        </div>

        {/* 描述卡片 */}
        <div
          style={{
            background: '#ffffff',
            borderRadius: 16,
            padding: 20,
            minWidth: 220,
            minHeight: 140,
            boxShadow: '0 4px 20px rgba(0, 0, 0, 0.08)',
            border: '1px solid #e8e8e8',
            transition: 'all 0.3s ease',
            cursor: 'pointer',
            zIndex: 1,
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.transform = 'translateY(-2px)';
            e.currentTarget.style.boxShadow = '0 8px 30px rgba(0, 0, 0, 0.12)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.transform = 'translateY(0)';
            e.currentTarget.style.boxShadow = '0 4px 20px rgba(0, 0, 0, 0.08)';
          }}
        >
          {/* 顶部状态栏 */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <ClusterOutlined style={{ fontSize: 16, color: '#1890ff' }} />
              <span style={{ 
                fontSize: 11, 
                color: '#666', 
                fontWeight: 500,
                textTransform: 'uppercase',
                letterSpacing: 0.5
              }}>
                {typeMap[cloudType] || cloudType}
              </span>
            </div>
            <div style={{
              width: 10,
              height: 10,
              borderRadius: '50%',
              background: isOnline ? '#52c41a' : '#ff4d4f',
              boxShadow: isOnline ? '0 0 8px rgba(82, 196, 26, 0.4)' : '0 0 8px rgba(255, 77, 79, 0.4)',
              animation: isOnline ? 'pulse 2s infinite' : 'none',
            }} />
          </div>

          {/* 主标题 */}
          <div style={{ 
            fontSize: 16, 
            fontWeight: 600, 
            color: '#262626',
            marginBottom: 8,
            lineHeight: 1.2
          }}>
            {cloudName}
          </div>

          {/* 云厂商 */}
          <div style={{ 
            fontSize: 13, 
            color: '#1890ff',
            fontWeight: 500,
            marginBottom: 12
          }}>
            {provider}
          </div>

          {/* 信息网格 */}
          <div style={{ 
            display: 'grid', 
            gridTemplateColumns: '1fr 1fr',
            gap: 8,
            fontSize: 12,
            color: '#666'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <GlobalOutlined style={{ fontSize: 12, color: '#999' }} />
              <span>{cloudRegion}</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <DatabaseOutlined style={{ fontSize: 12, color: '#999' }} />
              <span style={{ color: isOnline ? '#52c41a' : '#ff4d4f', fontWeight: 500 }}>
                {isOnline ? '在线' : '离线'}
              </span>
            </div>
          </div>
        </div>
      </div>
    );
  },
};

const TopologyPage: React.FC = () => {
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [cloudStats, setCloudStats] = useState({ total: 0, online: 0 });
  const mainRef = useRef<HTMLDivElement>(null);
  const [canvasHeight, setCanvasHeight] = useState<number>(600);

  useEffect(() => {
    const calc = () => {
      const rectTop = mainRef.current ? mainRef.current.getBoundingClientRect().top : 0;
      const bottomPadding = 24;
      const h = Math.max(300, Math.floor((typeof window !== 'undefined' ? window.innerHeight : 800) - rectTop - bottomPadding));
      setCanvasHeight(h);
    };
    calc();
    window.addEventListener('resize', calc);
    return () => window.removeEventListener('resize', calc);
  }, []);

  useEffect(() => {
    const fetchClouds = async () => {
      try {
        const token = localStorage.getItem('token');
        const res = await axios.get('/api/clouds', {
            headers: { Authorization: `Bearer ${token}` }
          });
        const clouds = res.data || [];
        
        const total = clouds.length;
        const online = clouds.filter((c: any) => c.status === 'online').length;
        setCloudStats({ total, online });
        
        const W = (typeof window !== 'undefined' && window.innerWidth) ? window.innerWidth : 1200;
        const H = (typeof window !== 'undefined' && window.innerHeight) ? window.innerHeight : 800;
        const centerX = Math.round(W / 2);
        const platformY = Math.round(H * 0.22);
        const minDim = Math.min(W, H);
        const platformNode: Node = {
          id: 'platform-center',
          type: 'platform',
          position: { x: centerX, y: platformY },
          data: { name: 'Compute.Tower 平台' },
        };

        const totalNodes = clouds.length;
        const tileWidth = 260;
        const tileHeight = 160;
        const baseSpacing = 48;
        const availWidth = Math.floor(W * 0.86);
        let spacing = baseSpacing;
        let totalWidth = totalNodes * tileWidth + Math.max(0, totalNodes - 1) * spacing;
        let rows = 1;
        if (totalWidth > availWidth) {
          rows = Math.ceil(totalWidth / availWidth);
        }
        const perRowCap = Math.max(1, Math.ceil(totalNodes / rows));
        const nodeList: Node[] = [];
        let index = 0;
        for (let r = 0; r < rows; r++) {
          const remaining = totalNodes - index;
          const count = Math.min(perRowCap, remaining);
          const rowWidth = count * tileWidth + Math.max(0, count - 1) * spacing;
          const startX = centerX - Math.floor(rowWidth / 2) + Math.floor(tileWidth / 2);
          const y = platformY + 220 + r * (tileHeight + 80);
          for (let k = 0; k < count; k++) {
            const cloud = clouds[index];
            const x = startX + k * (tileWidth + spacing);
            nodeList.push({
              id: `cloud-${cloud.id}`,
              type: 'cloud',
              position: { x, y },
              data: { ...cloud, center: { x: centerX, y: platformY } },
            });
            index += 1;
          }
        }
        
        setNodes([platformNode, ...nodeList]);
        
        const edgeList: Edge[] = nodeList.map((cloudNode) => {
          return {
            id: `platform-center-${cloudNode.id}`,
            source: 'platform-center',
            target: cloudNode.id,
            sourceHandle: 'center-out',
            targetHandle: 'center-in',
            type: 'bezier',
            style: {
              stroke: '#1890ff',
              strokeWidth: 3,
              strokeDasharray: '8,4'
            },
            animated: true
          };
        });
        setEdges(edgeList);
      } catch (e) {
        setCloudStats({ total: 0, online: 0 });
        setNodes([]);
        setEdges([]);
      }
    };
    fetchClouds();
  }, [setNodes, setEdges]);

  const onConnect = useCallback(
    (params: any) => setEdges((eds) => [...eds, { 
      ...params, 
      id: `${params.source}-${params.target}`, 
      type: 'bezier',
      style: { 
        stroke: '#1890ff', 
        strokeWidth: 2,
        strokeDasharray: '5,5',
      },
      animated: true
    }]),
    [setEdges]
  );

  return (
    <div style={{
      width: '100%', 
      minHeight: '100vh', 
      background: 'linear-gradient(135deg, #f0f2f5 0%, #ffffff 100%)',
      position: 'relative'
    }}>
      {/* 背景装饰 */}
      <div style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: `
          radial-gradient(circle at 20% 20%, rgba(24, 144, 255, 0.03) 0%, transparent 50%),
          radial-gradient(circle at 80% 80%, rgba(24, 144, 255, 0.03) 0%, transparent 50%),
          radial-gradient(circle at 40% 60%, rgba(24, 144, 255, 0.02) 0%, transparent 50%)
        `,
        pointerEvents: 'none'
      }} />

      {/* 主内容区域 */}
      <div style={{ position: 'relative', width: '100%' }} ref={mainRef}>
                {/* 标题和统计 - 漂浮在左上角 */}
        <div style={{
          position: 'absolute',
          top: 24,
          left: 32,
          zIndex: 10,
          display: 'flex',
          alignItems: 'flex-start',
          gap: 40
        }}>
          {/* 标题区域 */}
      <div style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 8
          }}>
        <div style={{ 
              fontSize: 24,
              fontWeight: 700,
              color: '#262626',
              letterSpacing: 1,
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              textShadow: '0 2px 4px rgba(255, 255, 255, 0.8)'
            }}>
              <ClusterOutlined style={{ fontSize: 28, color: '#1890ff' }} />
              算力网络拓扑
            </div>
            <div style={{ 
              fontSize: 13,
              color: '#8c8c8c',
              textShadow: '0 1px 2px rgba(255, 255, 255, 0.8)',
              marginLeft: 40
            }}>
              实时监控云资源池状态
            </div>
          </div>

          {/* 统计面板 */}
          <div style={{
            display: 'flex',
            gap: 24,
            alignItems: 'center',
            marginTop: 8
          }}>
            {/* 总数统计 */}
            <div style={{ 
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 4
            }}>
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6
              }}>
                <div style={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  background: '#1890ff'
                }} />
                <span style={{
                  fontSize: 12,
                  color: '#8c8c8c',
                  fontWeight: 500,
                  textShadow: '0 1px 2px rgba(255, 255, 255, 0.8)'
                }}>
                  总数
                </span>
              </div>
              <div style={{ 
                color: '#262626', 
                fontSize: 28, 
                fontWeight: 700,
                lineHeight: 1,
                textShadow: '0 2px 4px rgba(255, 255, 255, 0.8)'
              }}>
                {cloudStats.total}
              </div>
            </div>

            {/* 分隔线 */}
            <div style={{
              width: 1,
              height: 40,
              background: 'linear-gradient(to bottom, transparent, #e0e0e0, transparent)'
            }} />

            {/* 在线统计 */}
            <div style={{ 
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 4
            }}>
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6
              }}>
                <div style={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  background: '#52c41a',
                  boxShadow: '0 0 8px rgba(82, 196, 26, 0.4)'
                }} />
                <span style={{
                  fontSize: 12,
                  color: '#8c8c8c',
                  fontWeight: 500,
                  textShadow: '0 1px 2px rgba(255, 255, 255, 0.8)'
                }}>
                  在线
                </span>
            </div>
              <div style={{ 
                color: '#52c41a', 
                fontSize: 28, 
                fontWeight: 700,
                lineHeight: 1,
                textShadow: '0 2px 4px rgba(255, 255, 255, 0.8)'
              }}>
                {cloudStats.online}
          </div>
        </div>

            {/* 分隔线 */}
        <div style={{ 
              width: 1,
              height: 40,
              background: 'linear-gradient(to bottom, transparent, #e0e0e0, transparent)'
            }} />

            {/* 健康度统计 */}
          <div style={{ 
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 4
            }}>
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6
              }}>
                <div style={{
                  width: 8,
                  height: 8,
                borderRadius: '50%',
                  background: 'linear-gradient(90deg, #52c41a, #73d13d)'
                }} />
                <span style={{
                  fontSize: 12,
                  color: '#8c8c8c',
                  fontWeight: 500,
                  textShadow: '0 1px 2px rgba(255, 255, 255, 0.8)'
                }}>
                  健康度
                </span>
            </div>
              <div style={{
                color: '#262626', 
                fontSize: 28, 
                fontWeight: 700,
                lineHeight: 1,
                textShadow: '0 2px 4px rgba(255, 255, 255, 0.8)'
              }}>
                {cloudStats.total > 0 ? Math.round((cloudStats.online / cloudStats.total) * 100) : 0}%
              </div>
          </div>
        </div>
      </div>

        {/* 拓扑画布 */}
        <div style={{ height: canvasHeight }}>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            nodeTypes={nodeTypes}
            fitView
            fitViewOptions={{ padding: 0.2, maxZoom: 1.0 }}
            minZoom={0.3}
            maxZoom={1.5}
        style={{
              background: 'transparent',
          width: '100%',
              height: '100%' 
            }}
          >

            <Controls 
              showInteractive={false}
              style={{ 
                background: 'rgba(255, 255, 255, 0.9)',
                border: '1px solid #e8e8e8',
                borderRadius: 8
              }} 
            />
            <Background 
              color="rgba(0, 0, 0, 0.05)" 
              gap={20} 
              size={1}
            />
          </ReactFlow>
        </div>
      </div>
    </div>
  );
};

export default TopologyPage;
