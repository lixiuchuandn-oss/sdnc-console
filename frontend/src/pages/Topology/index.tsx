import React, { useCallback, useEffect, useState } from 'react';
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

    // 动态计算卡片位置 - 让卡片在拓扑图外侧
    const canvasWidth = 1200; // 假设画布宽度
    const canvasHeight = 800;  // 假设画布高度
    const nodeX = props.xPos || 0;
    const nodeY = props.yPos || 0;
    
    // 判断节点在画布中的位置
    const isLeftSide = nodeX < canvasWidth / 2;
    const isTopSide = nodeY < canvasHeight / 2;
    
    // 根据位置决定卡片方向 - 朝向画布外侧
    let cardDirection = 'right'; // 默认右侧
    if (isLeftSide) {
      cardDirection = 'left'; // 左侧节点，卡片在左（朝向外侧）
    } else {
      cardDirection = 'right'; // 右侧节点，卡片在右（朝向外侧）
    }

    return (
      <div style={{ 
        position: 'relative', 
        display: 'flex', 
        alignItems: 'center', 
        gap: 16,
        flexDirection: cardDirection === 'left' ? 'row-reverse' : 'row'
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
        
        // 分散布局算法 - 圆形和随机分布
        const nodeList: Node[] = clouds.map((cloud: any, idx: number) => {
          const totalNodes = clouds.length;
          let x, y;
          
          if (totalNodes <= 6) {
            // 少量节点时使用圆形布局
            const angle = (idx * 2 * Math.PI) / totalNodes;
            const radius = 300;
            const centerX = 600;
            const centerY = 400;
            x = centerX + Math.cos(angle) * radius;
            y = centerY + Math.sin(angle) * radius;
          } else {
            // 多节点时使用分散网格 + 随机偏移
            const cols = Math.ceil(Math.sqrt(totalNodes));
            const row = Math.floor(idx / cols);
            const col = idx % cols;
            const baseX = 200 + col * 400;
            const baseY = 250 + row * 300;
            // 添加随机偏移让分布更自然
            const offsetX = (Math.random() - 0.5) * 100;
            const offsetY = (Math.random() - 0.5) * 100;
            x = baseX + offsetX;
            y = baseY + offsetY;
          }
          
          return {
            id: `cloud-${cloud.id}`,
            type: 'cloud',
            position: { x, y },
            data: { ...cloud },
          };
        });
        
        setNodes(nodeList);
        
        // 创建双向全连接边 - 使用相邻连接点避免交叉
        const edgeList: Edge[] = [];
        for (let i = 0; i < nodeList.length; i++) {
          for (let j = i + 1; j < nodeList.length; j++) {
            const node1 = nodeList[i];
            const node2 = nodeList[j];
            
            // 计算两个节点的相对位置来选择最佳连接方向
            const dx = node2.position.x - node1.position.x;
            const dy = node2.position.y - node1.position.y;
            
            let sourceHandle1, targetHandle1, sourceHandle2, targetHandle2;
            
            // 根据相对位置选择连接点，使用同一路径避免交叉
            if (Math.abs(dx) > Math.abs(dy)) {
              // 水平方向为主
              if (dx > 0) {
                // node2 在 node1 右侧 - 都使用右-左连接
                sourceHandle1 = 'right-out';    // node1 右侧输出
                targetHandle1 = 'left-in';      // node2 左侧输入
                sourceHandle2 = 'left-out';     // node2 左侧输出
                targetHandle2 = 'right-in';     // node1 右侧输入
              } else {
                // node2 在 node1 左侧 - 都使用左-右连接
                sourceHandle1 = 'left-out';     // node1 左侧输出
                targetHandle1 = 'right-in';     // node2 右侧输入
                sourceHandle2 = 'right-out';    // node2 右侧输出
                targetHandle2 = 'left-in';      // node1 左侧输入
              }
            } else {
              // 垂直方向为主
              if (dy > 0) {
                // node2 在 node1 下方 - 都使用上-下连接
                sourceHandle1 = 'bottom-out';   // node1 底部输出
                targetHandle1 = 'top-in';       // node2 顶部输入
                sourceHandle2 = 'top-out';      // node2 顶部输出
                targetHandle2 = 'bottom-in';    // node1 底部输入
              } else {
                // node2 在 node1 上方 - 都使用下-上连接
                sourceHandle1 = 'top-out';      // node1 顶部输出
                targetHandle1 = 'bottom-in';    // node2 底部输入
                sourceHandle2 = 'bottom-out';   // node2 底部输出
                targetHandle2 = 'top-in';       // node1 顶部输入
              }
            }
            
            // 第一条边：从 i 到 j (蓝色实线，直角连接)
            edgeList.push({
              id: `${node1.id}-${node2.id}`,
              source: node1.id,
              target: node2.id,
              sourceHandle: sourceHandle1,
              targetHandle: targetHandle1,
              type: 'step',
              style: {
                stroke: '#1890ff',
                strokeWidth: 3,
                zIndex: 1,
              },
              animated: true
            });
            
            // 第二条边：从 j 到 i (绿色虚线，直角连接)
            edgeList.push({
              id: `${node2.id}-${node1.id}`,
              source: node2.id,
              target: node1.id,
              sourceHandle: sourceHandle2,
              targetHandle: targetHandle2,
              type: 'step',
              style: {
                stroke: '#52c41a',
                strokeWidth: 2,
                strokeDasharray: '8,4',
                zIndex: 0,
              },
              animated: true
            });
          }
        }
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
      type: 'step',
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
      <div style={{ position: 'relative', width: '100%', height: '100vh' }}>
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
        <div style={{ height: '100%' }}>
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