import React, { useState } from 'react';
import { Button, Input, Popover, Tag, Select } from 'antd';
import { 
  EditOutlined, 
  GlobalOutlined, 
  DatabaseOutlined,
  CloudServerOutlined,
  PartitionOutlined,
  EnvironmentOutlined,
  MoreOutlined,
  DeleteOutlined
} from '@ant-design/icons';
import { 
  Handle, 
  Position, 
  getBezierPath, 
  EdgeProps,
  Node
} from 'react-flow-renderer';

// Custom edge with particle animation
export const ParticleEdge = ({
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

// Custom Node Component
export const StartNode = ({ data }: any) => {
  const [editOpen, setEditOpen] = useState(false);
  const [tempLabel, setTempLabel] = useState<string>(String(data.label || ''));
  const save = () => { data.onEditLabel?.(tempLabel); setEditOpen(false); };
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
      {data.decryptEnabled && (
        <div style={{ 
          position: 'absolute',
          top: 6,
          left: 8,
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          background: 'rgba(22, 119, 255, 0.1)',
          padding: '2px 6px',
          borderRadius: 12,
          border: '1px solid rgba(22, 119, 255, 0.2)',
          pointerEvents: 'none',
          zIndex: 2
        }}>
          <div style={{ width: 5, height: 5, borderRadius: '50%', background: '#1677ff', boxShadow: '0 0 3px #1677ff' }} />
          <span style={{ fontSize: 10, color: '#1677ff', fontWeight: 500, lineHeight: 1 }}>解密</span>
        </div>
      )}
      {/* Tech decoration lines */}
      <div style={{ position: 'absolute', top: -1, left: -1, width: 8, height: 8, borderTop: '2px solid #4096ff', borderLeft: '2px solid #4096ff', borderTopLeftRadius: 4 }} />
      <div style={{ position: 'absolute', bottom: -1, right: -1, width: 8, height: 8, borderBottom: '2px solid #4096ff', borderRight: '2px solid #4096ff', borderBottomRightRadius: 4 }} />

      <div style={{ fontSize: 24, lineHeight: 1, filter: 'drop-shadow(0 2px 4px rgba(24, 144, 255, 0.2))' }}>{data.icon}</div>
      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' }}>
        <span style={{ lineHeight: 1 }}>{data.label}</span>
        <Popover
          open={editOpen}
          onOpenChange={setEditOpen}
          trigger="click"
          placement="bottom"
          title={null}
          content={(
            <div style={{ display: 'flex', gap: 6 }}>
              <Input size="small" value={tempLabel} onChange={(e)=> setTempLabel(e.target.value)} style={{ width: 140 }} />
              <Button size="small" type="primary" onClick={save}>保存</Button>
              <Button size="small" onClick={()=> setEditOpen(false)}>取消</Button>
            </div>
          )}
        >
          <Button
            size="small"
            type="text"
            icon={<EditOutlined style={{ fontSize: 12, color: '#8c8c8c' }} />}
            style={{ padding: 0, height: 18, width: 18, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
            onMouseEnter={(e) => { const icon = e.currentTarget.querySelector('.anticon'); if (icon) (icon as HTMLElement).style.color = '#1677ff'; }}
            onMouseLeave={(e) => { const icon = e.currentTarget.querySelector('.anticon'); if (icon) (icon as HTMLElement).style.color = '#8c8c8c'; }}
          />
        </Popover>
      </div>
      <Handle type="source" position={Position.Right} style={{ background: '#1677ff', width: 6, height: 12, right: -3, border: 'none', borderRadius: 1, boxShadow: '0 0 4px rgba(24, 144, 255, 0.6)' }} />
    </div>
  );
};

export const EndNode = ({ data }: any) => {
  const protectedObjects = data.protectedObjects || [];
  const [editOpen, setEditOpen] = useState(false);
  const [tempLabel, setTempLabel] = useState<string>(String(data.label || ''));
  const [selectedObjKey, setSelectedObjKey] = useState<string>('');
  const save = () => {
    if (selectedObjKey) {
      const found = protectedObjects.find((o: any) => String(o.key) === String(selectedObjKey));
      if (found) { data.onEditLabel?.(found.title || selectedObjKey); setEditOpen(false); return; }
    }
    data.onEditLabel?.(tempLabel);
    setEditOpen(false);
  };
  
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
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' }}>
          <span style={{ lineHeight: 1 }}>{data.label}</span>
          <Popover
            open={editOpen}
            onOpenChange={setEditOpen}
            trigger="click"
            placement="bottom"
            title={null}
            content={(
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, width: 260 }}>
                <Input size="small" value={tempLabel} onChange={(e)=> setTempLabel(e.target.value)} placeholder="自定义名称" />
                <Select
                  size="small"
                  allowClear
                  placeholder="或从已选对象中选择"
                  value={selectedObjKey || undefined}
                  onChange={(v: any)=> setSelectedObjKey(String(v || ''))}
                  options={(protectedObjects || []).map((o: any) => ({ value: o.key, label: o.title }))}
                />
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                  <Button size="small" onClick={()=> setEditOpen(false)}>取消</Button>
                  <Button size="small" type="primary" onClick={save}>保存</Button>
                </div>
              </div>
            )}
          >
            <Button
              size="small"
              type="text"
              icon={<EditOutlined style={{ fontSize: 12, color: '#8c8c8c' }} />}
              style={{ padding: 0, height: 18, width: 18, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
              onMouseEnter={(e) => { const icon = e.currentTarget.querySelector('.anticon'); if (icon) (icon as HTMLElement).style.color = '#1677ff'; }}
              onMouseLeave={(e) => { const icon = e.currentTarget.querySelector('.anticon'); if (icon) (icon as HTMLElement).style.color = '#8c8c8c'; }}
            />
          </Popover>
        </div>
      </div>
  );
};

export const ServiceNode = ({ data }: any) => {
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
                {/* Actions */}
                <Popover 
                  content={
                    <div 
                      style={{ cursor: 'pointer', padding: '4px 8px', display: 'flex', alignItems: 'center', gap: 8, color: '#ff4d4f' }}
                      onClick={(e) => {
                        e.stopPropagation();
                        data.onDelete?.();
                      }}
                    >
                      <DeleteOutlined /> 删除节点
                    </div>
                  } 
                  trigger="click" 
                  placement="bottomRight"
                  overlayInnerStyle={{ padding: 4 }}
                >
                  <div 
                    onClick={(e) => e.stopPropagation()}
                    style={{ 
                      cursor: 'pointer', 
                      padding: 2, 
                      display: 'flex', 
                      alignItems: 'center', 
                      justifyContent: 'center',
                      borderRadius: 4,
                      color: '#8c8c8c',
                      transition: 'all 0.2s'
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(0,0,0,0.05)'; e.currentTarget.style.color = '#595959'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#8c8c8c'; }}
                  >
                    <MoreOutlined style={{ fontSize: 14 }} />
                  </div>
                </Popover>
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

export const edgeTypes = {
  particle: ParticleEdge,
};

export const nodeTypes = {
  serviceNode: ServiceNode,
  startNode: StartNode,
  endNode: EndNode,
};
