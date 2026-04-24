import React from 'react';
import { EdgeProps, Position, Handle } from 'react-flow-renderer';
import { FullscreenOutlined, ClusterOutlined, AppstoreOutlined, SafetyCertificateOutlined } from '@ant-design/icons';
import { Badge, Tag } from 'antd';

// --- Types ---
export interface TopologyDataProps {
  doms: any[];
  apps: any[];
  services: any[];
  domainServiceChainMap: Record<string, boolean>;
  ecsIpMap: Record<string, string>;
  topologyType: string;
  hubId?: string;
}

// --- Components ---

export const SvcEdge: React.FC<EdgeProps> = ({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  style = {},
}) => {
  const edgePath = `M ${sourceX},${sourceY} L ${targetX},${targetY}`;
  const reverseEdgePath = `M ${targetX},${targetY} L ${sourceX},${sourceY}`;
  const color = style.stroke || '#8c8c8c';
  return (
    <>
      <defs>
        <marker id={`svc-arrow-${id}`} markerWidth="10" markerHeight="10" viewBox="0 0 10 10" refX="8" refY="5" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" fill={color} />
        </marker>
      </defs>
      <path
        id={id}
        className="react-flow__edge-path"
        d={edgePath}
        style={{ stroke: color, strokeWidth: 2, ...(style as any) }}
        markerEnd={`url(#svc-arrow-${id})`}
      />
      <circle r="3" fill={color}>
        <animateMotion dur="2s" repeatCount="indefinite" path={edgePath} />
      </circle>
      <circle r="3" fill={color}>
        <animateMotion dur="2s" repeatCount="indefinite" path={reverseEdgePath} />
      </circle>
    </>
  );
};

export const NodeTypes = {
  mainNode: (props: any) => (
    <div style={{ width: 120, height: 88, padding: '8px 12px', boxSizing: 'border-box', borderRadius: 12, background: '#fff', border: '1px solid #e5e5e5', boxShadow: '0 4px 12px rgba(0,0,0,0.06)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 0, position: 'relative' }}>
      <div style={{ width: 22, height: 22, borderRadius: '50%', border: '2px solid #1677ff', display: 'flex', alignItems: 'center', justifyContent: 'center', boxSizing: 'border-box' }}>
        <FullscreenOutlined style={{ fontSize: 14, color: '#1677ff' }} />
      </div>
      <label style={{ fontSize: 12, color: '#1f1f1f', fontWeight: 600, width: '100%', boxSizing: 'border-box', textAlign: 'center', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: 4 }}>
        {props?.data?.title || '-'}
      </label>
      <div style={{ fontSize: 12, color: '#8c8c8c', width: '100%', boxSizing: 'border-box', textAlign: 'center', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{props?.data?.eip || '-'}</div>
      <Handle type="source" position={Position.Top} id="pub" style={{ opacity: 0, left: '50%', top: '50%', transform: 'translate(-50%, -50%)' }} />
      <Handle type="target" position={Position.Top} id="pub" style={{ opacity: 0, left: '50%', top: '50%', transform: 'translate(-50%, -50%)' }} />
    </div>
  ),
  domainCard: (props: any) => (
    <div style={{ width: 160, height: 80, borderRadius: 10, background: '#fff', border: '1px solid #e5e5e5', boxShadow: '0 3px 10px rgba(0,0,0,0.05)', display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 6, padding: '8px 12px', position: 'relative' }}>
      <div style={{ fontSize: 12, color: '#1f1f1f', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{props?.data?.title || '-'}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap', overflow: 'hidden' }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 6px', borderRadius: 8, border: '1px solid #e6f0ff', background: '#f7f9ff', maxWidth: 120 }}>
          <ClusterOutlined style={{ fontSize: 12, color: '#fa8c16' }} />
          <span style={{ fontSize: 12, color: '#3a3a3a', overflow: 'hidden', textOverflow: 'ellipsis' }}>{props?.data?.vpcCidr || '-'}</span>
        </span>
      </div>
      <Handle type="source" position={Position.Top} id="card" style={{ opacity: 0, left: '50%', top: '50%', transform: 'translate(-50%, -50%)' }} />
      <Handle type="target" position={Position.Top} id="card" style={{ opacity: 0, left: '50%', top: '50%', transform: 'translate(-50%, -50%)' }} />
    </div>
  ),
  appCard: (props: any) => (
    <div style={{ width: 160, height: props?.data?.ipInfo ? 80 : 60, borderRadius: 10, background: '#fff', border: '1px solid #e5e5e5', boxShadow: '0 3px 10px rgba(0,0,0,0.05)', display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 4, padding: '8px 12px', position: 'relative' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <AppstoreOutlined style={{ color: '#1677ff' }} />
        <div style={{ fontSize: 12, color: '#1f1f1f', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{props?.data?.title || '-'}</div>
      </div>
      <div style={{ fontSize: 12, color: '#888', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{props?.data?.subTitle || '-'}</div>
      {props?.data?.ipInfo && (
        <div style={{ fontSize: 11, color: '#666', background: '#f5f5f5', borderRadius: 4, padding: '2px 4px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'center' }}>
          {props.data.ipInfo}
        </div>
      )}
      <Handle type="source" position={Position.Top} id="app" style={{ opacity: 0, left: '50%', top: '50%', transform: 'translate(-50%, -50%)' }} />
      <Handle type="target" position={Position.Top} id="app" style={{ opacity: 0, left: '50%', top: '50%', transform: 'translate(-50%, -50%)' }} />
    </div>
  ),
  securityServiceCard: (props: any) => (
    <div style={{ width: 160, height: 'auto', minHeight: 70, borderRadius: 10, background: '#fff', border: '1px solid #e5e5e5', boxShadow: '0 3px 10px rgba(0,0,0,0.05)', display: 'flex', flexDirection: 'column', gap: 8, padding: '10px 12px', position: 'relative' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flex: '0 0 auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Badge count={Number(props?.data?.count || 0)} size="small" overflowCount={999} color="#1677ff">
            <SafetyCertificateOutlined style={{ color: '#1677ff' }} />
          </Badge>
          <div style={{ fontSize: 12, color: '#1f1f1f', fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{props?.data?.title || '-'}</div>
        </div>
        {props?.data?.hasChains === false && (
          <Tag color="orange" style={{ marginLeft: 'auto', padding: '0 6px', fontSize: 10, lineHeight: '18px', borderRadius: 10 }}>
            未编排
          </Tag>
        )}
      </div>
      <div style={{ flex: '1 1 auto', display: 'flex', flexWrap: 'wrap', gap: 4, alignContent: 'flex-start' }}>
        {(Array.isArray(props?.data?.services) ? props.data.services : []).map((name: any, idx: number) => (
          <Tag key={`${String(name)}-${idx}`} color="blue" style={{ margin: 0, maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', display: 'flex', alignItems: 'center', lineHeight: '20px' }}>
            {String(name)}
          </Tag>
        ))}
      </div>
      <Handle type="source" position={Position.Top} id="svc" style={{ opacity: 0, left: '50%', top: '50%', transform: 'translate(-50%, -50%)' }} />
      <Handle type="target" position={Position.Top} id="svc" style={{ opacity: 0, left: '50%', top: '50%', transform: 'translate(-50%, -50%)' }} />
    </div>
  )
};

// --- Logic ---

export function calculateTopology({
  doms,
  apps,
  services,
  domainServiceChainMap,
  ecsIpMap,
  topologyType,
  hubId,
}: TopologyDataProps) {
  const nodes: any[] = [];
  const edges: any[] = [];

  // 1. Group domains by VR (Main Nodes)
  const vrGroups = new Map<string, { vr: any; domains: any[] }>();
  
  doms.forEach((item: any) => {
    const vrKey = item.dom?.vrUuid || `vr-${item.dom?.id}`;
    if (!vrGroups.has(vrKey)) {
      vrGroups.set(vrKey, { 
        vr: {
            id: vrKey,
            name: item.dom?.vrName || item.dom?.vrUuid || '未命名VR',
            eip: item.dom?.vrPublicIp || '-',
            privateIp: item.dom?.vrPrivateIp || '-'
        }, 
        domains: [] 
      });
    }
    vrGroups.get(vrKey)!.domains.push(item);
  });

  const vrList = Array.from(vrGroups.values());
  const totalVRs = vrList.length;
  const centerX = 520;
  const centerY = 300;
  const vrRadius = 250;

  // 2. Layout VR Nodes (Level 1)
  vrList.forEach((group, idx) => {
    const angle = totalVRs > 1 ? (idx * 2 * Math.PI) / totalVRs : -Math.PI / 2;
    const x = totalVRs > 1 ? centerX + Math.cos(angle) * vrRadius : centerX;
    const y = totalVRs > 1 ? centerY + Math.sin(angle) * vrRadius : centerY;
    
    const vrNodeId = `vr-${group.vr.id}`;
    nodes.push({
      id: vrNodeId,
      type: 'mainNode',
      position: { x: x - 60, y: y - 44 }, // Center node (120x88, matches mainNode)
      data: { 
        title: group.vr.name,
        eip: group.vr.eip
      }
    });

    // 3. Layout Domain Nodes (Level 2)
    const domains = group.domains;
    if (domains.length > 0) {
        // Vector from Center to VR
        const dx = x - centerX;
        const dy = y - centerY;
        const len = Math.sqrt(dx * dx + dy * dy) || 1;
        // Outward direction
        const ux = dx / len;
        const uy = dy / len;
        const outwardAngle = Math.atan2(uy, ux);

        const domainRadius = 220;
        // Fan arc
        const arc = totalVRs > 1 ? Math.min(Math.PI * 1.5, domains.length * Math.PI / 4) : 2 * Math.PI;
        const startAngle = totalVRs > 1 ? (outwardAngle - arc / 2) : 0;
        const step = domains.length > 1 ? (totalVRs > 1 ? arc / (domains.length - 1) : 2 * Math.PI / domains.length) : 0;

        domains.forEach((dItem: any, dIdx: number) => {
          const ang = domains.length > 1 ? (startAngle + dIdx * step) : outwardAngle;
          
          const dist = domainRadius;
          const domX = x + Math.cos(ang) * dist;
          const domY = y + Math.sin(ang) * dist;
          
          const domNodeId = `domain-${dItem.dom.id}`;
          nodes.push({
            id: domNodeId,
            type: 'domainCard',
            position: { x: domX - 80, y: domY - 40 }, // 160x80
            data: {
              title: dItem.dom.name || dItem.att.vpcName || '安全域',
              vpcCidr: dItem.dom.cidr || dItem.att.vpcCidr || '-',
              region: dItem.dom.region || dItem.att.region || '-'
            }
          });

          edges.push({
            id: `${vrNodeId}-${domNodeId}`,
            source: vrNodeId,
            target: domNodeId,
            sourceHandle: 'pub',
            targetHandle: 'card',
            type: 'straight',
            style: { stroke: '#bfbfbf', strokeWidth: 1.5 }
          });

          // 4. Layout App & Security Service Nodes (Level 3)
          const domainId = String(dItem.dom.id);
          const myApps = apps.filter(a => String(a.domainId) === domainId);
          const myServices = services.filter((s: any) => String(s.domainId) === domainId);
          
          const level3Nodes: any[] = [
            ...myApps.map(a => ({ ...a, _kind: 'app' }))
          ];

          if (myServices.length > 0) {
            const svcNames = myServices
              .map((s: any) => s?.name || s?.title || s?.displayName || s?.id)
              .filter((x: any) => x !== undefined && x !== null && String(x).trim());
            
            level3Nodes.push({
              _kind: 'serviceGroup',
              id: `svc-group-${domainId}`,
              count: myServices.length,
              services: svcNames,
              title: '安全服务',
              hasChains: domainServiceChainMap[String(domainId)] === undefined ? undefined : domainServiceChainMap[String(domainId)]
            });
          }

          if (level3Nodes.length > 0) {
            // Vector from VR to Domain
            const vDx = domX - x;
            const vDy = domY - y;
            const vLen = Math.sqrt(vDx * vDx + vDy * vDy) || 1;
            const vUx = vDx / vLen;
            const vUy = vDy / vLen;
            const domOutwardAngle = Math.atan2(vUy, vUx);
            
            const leafRadius = 220;
            const leafArc = Math.min(Math.PI * 1.5, level3Nodes.length * Math.PI / 5);
            const leafStartAngle = domOutwardAngle - leafArc / 2;
            const leafStep = level3Nodes.length > 1 ? leafArc / (level3Nodes.length - 1) : 0;

            level3Nodes.forEach((item, lIdx) => {
              const lAng = level3Nodes.length > 1 ? (leafStartAngle + lIdx * leafStep) : domOutwardAngle;
              const lDist = leafRadius;
              const leafX = domX + Math.cos(lAng) * lDist;
              const leafY = domY + Math.sin(lAng) * lDist;

              if (item._kind === 'app') {
                const appId = `app-${item.id}`;
                
                let ipInfo = '';
                if (item.type === 'service_address') {
                    let addrs: any[] = [];
                    if (Array.isArray(item.serviceAddresses) && item.serviceAddresses.length > 0) {
                      addrs = item.serviceAddresses;
                    } else if (Array.isArray(item.instances) && item.instances.length > 0) {
                      addrs = item.instances;
                    }

                    if (addrs.length > 0) {
                      const first = addrs[0];
                      if (first && first.ip && first.port) {
                        ipInfo = `${first.protocol ? first.protocol + '://' : ''}${first.ip}:${first.port}`;
                        if (addrs.length > 1) ipInfo += ` (+${addrs.length - 1})`;
                      }
                    }
                } else if (item.type === 'vm' || item.type === 'container') {
                  const instIds = item.instances || [];
                  const ips = instIds.map((id: string) => ecsIpMap[id]).filter(Boolean);
                  
                  let portStr = '';
                  if (item.servicePorts && item.servicePorts.length > 0) {
                      const p = item.servicePorts[0];
                      portStr = `${p.protocol}:${p.port}`;
                      if (item.servicePorts.length > 1) portStr += '...';
                  }

                  const ipStr = ips.length > 0 ? (ips[0] + (ips.length > 1 ? ` (+${ips.length-1})` : '')) : '';
                  
                  if (portStr && ipStr) ipInfo = `${portStr} | ${ipStr}`;
                  else if (portStr) ipInfo = portStr;
                  else if (ipStr) ipInfo = ipStr;
                }

                nodes.push({
                  id: appId,
                  type: 'appCard',
                  position: { x: leafX - 80, y: leafY - 30 }, // 160x60
                  data: {
                    title: item.name,
                    subTitle: `${item.type === 'vm' ? '虚机' : item.type === 'container' ? '容器' : item.type === 'service_address' ? '服务地址' : '混合'} · ${item.status}`,
                    ipInfo
                  }
                });

                edges.push({
                  id: `${domNodeId}-${appId}`,
                  source: domNodeId,
                  target: appId,
                  sourceHandle: 'card',
                  targetHandle: 'app',
                  type: 'straight',
                  style: { stroke: '#bfbfbf', strokeWidth: 1.5 }
                });
              } else if (item._kind === 'serviceGroup') {
                const svcId = item.id;
                nodes.push({
                  id: svcId,
                  type: 'securityServiceCard',
                  position: { x: leafX - 80, y: leafY - 35 }, // 160x70+
                  data: {
                    title: item.title,
                    count: item.count,
                    services: item.services,
                    hasChains: item.hasChains
                  }
                });

                edges.push({
                  id: `${domNodeId}-${svcId}`,
                  source: domNodeId,
                  target: svcId,
                  sourceHandle: 'card',
                  targetHandle: 'svc',
                  type: 'svcEdge',
                  style: { stroke: '#1677ff' }
                });
              }
            });
          }
        });
    }
  });

  // VR Interconnections (Mesh / Hub-Spoke)
  if (totalVRs >= 2) {
      if (topologyType === 'Mesh') {
        for (let i = 0; i < vrList.length; i++) {
          for (let j = i + 1; j < vrList.length; j++) {
            const a = `vr-${vrList[i].vr.id}`;
            const b = `vr-${vrList[j].vr.id}`;
            edges.push({ id: `${a}-${b}`, source: a, target: b, sourceHandle: 'pub', targetHandle: 'pub', type: 'svcEdge', style: { stroke: '#1677ff', strokeWidth: 2 } });
          }
        }
      } else {
        // Hub-Spoke
        const hubIdStr = hubId ? String(hubId) : undefined;
        const hubIdx = hubIdStr ? vrList.findIndex(g => String(g.vr.id).includes(hubIdStr)) : 0;
        const safeHubIdx = hubIdx >= 0 ? hubIdx : 0;
        const hubNodeId = `vr-${vrList[safeHubIdx].vr.id}`;
        
        for (let i = 0; i < vrList.length; i++) {
          if (i === safeHubIdx) continue;
          const spokeNodeId = `vr-${vrList[i].vr.id}`;
          edges.push({ id: `${hubNodeId}-${spokeNodeId}`, source: hubNodeId, target: spokeNodeId, sourceHandle: 'pub', targetHandle: 'pub', type: 'svcEdge', style: { stroke: '#1677ff', strokeWidth: 2 } });
        }
      }
  }

  return { nodes, edges };
}
