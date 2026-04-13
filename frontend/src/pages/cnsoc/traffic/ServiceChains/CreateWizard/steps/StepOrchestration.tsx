import React, { useCallback } from 'react';
import { Button, Tooltip, Modal, Table, Progress, Tag } from 'antd';
import { 
  MenuUnfoldOutlined, 
  MenuFoldOutlined, 
  DeleteOutlined, 
  LayoutOutlined,
  InfoCircleFilled,
  ZoomInOutlined,
  ZoomOutOutlined,
  ExpandOutlined
} from '@ant-design/icons';
import ReactFlow, { 
  Background, 
  BackgroundVariant,
  useReactFlow,
  ReactFlowProvider
} from 'react-flow-renderer';
import { edgeTypes, nodeTypes } from '../components/FlowComponents';

interface StepOrchestrationProps {
  collapsed: boolean;
  setCollapsed: (collapsed: boolean) => void;
  sortedServices: any[];
  clusterId: string;
  form: any;
  groupsByType: any;
  addNode: (type: string, label: string, icon: React.ReactNode, color: string) => void;
  clearFlow: () => void;
  nodes: any[];
  edges: any[];
  onNodesChange: any;
  onEdgesChange: any;
  onConnect: any;
  onLayout: () => void;
  groupSelectionVisible: boolean;
  setGroupSelectionVisible: (visible: boolean) => void;
  pendingService: any;
  setPendingService: (service: any) => void;
  selectedGroup: string;
  setSelectedGroup: (id: string) => void;
  handleGroupSelectionConfirm: () => void;
}

const StepOrchestrationContent: React.FC<StepOrchestrationProps> = ({
  collapsed,
  setCollapsed,
  sortedServices,
  clusterId,
  form,
  groupsByType,
  addNode,
  clearFlow,
  nodes,
  edges,
  onNodesChange,
  onEdgesChange,
  onConnect,
  onLayout,
  groupSelectionVisible,
  setGroupSelectionVisible,
  pendingService,
  setPendingService,
  selectedGroup,
  setSelectedGroup,
  handleGroupSelectionConfirm,
}) => {
  const { zoomIn, zoomOut, fitView } = useReactFlow();

  // Handle node deletion from ServiceNode component
  const onNodeDelete = useCallback((id: string) => {
    onNodesChange([{
      type: 'remove',
      id: id,
    }]);
  }, [onNodesChange]);

  // Inject delete handler into nodes
  const nodesWithHandler = nodes.map(node => ({
    ...node,
    data: {
      ...node.data,
      onDelete: () => onNodeDelete(node.id)
    }
  }));

  return (
    <>
      <div style={{ height: '100%', display: 'flex', border: '1px solid #e8e8e8', borderRadius: 8, overflow: 'hidden', background: '#fff' }}>
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
          
          <div className="no-scrollbar" style={{ flex: 1, overflowY: 'auto', padding: collapsed ? '12px 0' : 12, display: 'flex', flexDirection: 'column', alignItems: collapsed ? 'center' : 'stretch' }}>
             {!collapsed && <div style={{ marginBottom: 8, fontSize: 12, color: '#999' }}>点击添加服务节点：</div>}
             
             {collapsed ? (
               <div style={{ display: 'flex', flexDirection: 'column', gap: 8, width: '100%', alignItems: 'center' }}>
                 {sortedServices.map(service => (
                  <Tooltip title={service.label} placement="right" key={service.type}>
                    <div 
                      onClick={() => {
                        const hasCluster = Boolean(clusterId || form.getFieldValue('cluster'));
                        const available = hasCluster && (groupsByType[service.type] && groupsByType[service.type].length > 0);
                        if (!available) return;
                        addNode(service.type, service.label, service.icon, service.color);
                      }}
                      style={{ 
                        width: 40,
                        height: 40,
                        borderRadius: 6, 
                        cursor: ((clusterId || form.getFieldValue('cluster')) && (groupsByType[service.type] || []).length > 0) ? 'pointer' : 'not-allowed',
                        display: 'flex', 
                        alignItems: 'center',
                        justifyContent: 'center',
                        transition: 'all 0.2s',
                        fontSize: 20,
                        color: ((clusterId || form.getFieldValue('cluster')) && (groupsByType[service.type] || []).length > 0) ? service.color : '#bfbfbf',
                        background: ((clusterId || form.getFieldValue('cluster')) && (groupsByType[service.type] || []).length > 0) ? '#fff' : '#fafafa',
                        border: ((clusterId || form.getFieldValue('cluster')) && (groupsByType[service.type] || []).length > 0) ? '1px solid transparent' : '1px solid #f0f0f0',
                        opacity: ((clusterId || form.getFieldValue('cluster')) && (groupsByType[service.type] || []).length > 0) ? 1 : 0.6
                      }}
                      onMouseEnter={(e) => {
                        const enabled = ((clusterId || form.getFieldValue('cluster')) && (groupsByType[service.type] || []).length > 0);
                        if (!enabled) return;
                        e.currentTarget.style.background = `${service.color}15`;
                        e.currentTarget.style.border = `1px solid ${service.color}`;
                      }}
                      onMouseLeave={(e) => {
                        const enabled = ((clusterId || form.getFieldValue('cluster')) && (groupsByType[service.type] || []).length > 0);
                        e.currentTarget.style.background = enabled ? '#fff' : '#fafafa';
                        e.currentTarget.style.border = enabled ? '1px solid transparent' : '1px solid #f0f0f0';
                      }}
                    >
                      {service.icon}
                    </div>
                  </Tooltip>
                ))}
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                {sortedServices.map(service => (
                  <div 
                    key={service.type}
                    onClick={() => {
                      const hasCluster = Boolean(clusterId || form.getFieldValue('cluster'));
                      const available = hasCluster && (groupsByType[service.type] && groupsByType[service.type].length > 0);
                      if (!available) return;
                      addNode(service.type, service.label, service.icon, service.color);
                    }}
                    style={{ 
                      border: ((clusterId || form.getFieldValue('cluster')) && (groupsByType[service.type] || []).length > 0) ? '1px solid #d9d9d9' : '1px solid #f0f0f0', 
                      borderRadius: 4, 
                      cursor: ((clusterId || form.getFieldValue('cluster')) && (groupsByType[service.type] || []).length > 0) ? 'pointer' : 'not-allowed',
                      display: 'flex', 
                      flexDirection: 'column',
                      alignItems: 'center',
                      justifyContent: 'center',
                      padding: '12px 4px',
                      transition: 'all 0.2s',
                      background: ((clusterId || form.getFieldValue('cluster')) && (groupsByType[service.type] || []).length > 0) ? '#fff' : '#fafafa',
                      fontSize: 12,
                      opacity: ((clusterId || form.getFieldValue('cluster')) && (groupsByType[service.type] || []).length > 0) ? 1 : 0.6
                    }}
                    onMouseEnter={(e) => {
                      const enabled = ((clusterId || form.getFieldValue('cluster')) && (groupsByType[service.type] || []).length > 0);
                      if (!enabled) return;
                      e.currentTarget.style.borderColor = service.color;
                      e.currentTarget.style.color = service.color;
                      e.currentTarget.style.background = `${service.color}08`;
                    }}
                    onMouseLeave={(e) => {
                      const enabled = ((clusterId || form.getFieldValue('cluster')) && (groupsByType[service.type] || []).length > 0);
                      e.currentTarget.style.borderColor = enabled ? '#d9d9d9' : '#f0f0f0';
                      e.currentTarget.style.color = 'inherit';
                      e.currentTarget.style.background = enabled ? '#fff' : '#fafafa';
                    }}
                  >
                    <div style={{ fontSize: 20, marginBottom: 4, color: ((clusterId || form.getFieldValue('cluster')) && (groupsByType[service.type] || []).length > 0) ? service.color : '#bfbfbf' }}>{service.icon}</div>
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
            nodes={nodesWithHandler}
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
             
             {/* Unified Top-Right Toolbar */}
             <div style={{ 
               position: 'absolute', 
               top: 16, 
               right: 16, 
               zIndex: 10, 
               display: 'flex', 
               alignItems: 'center',
               background: 'rgba(255, 255, 255, 0.9)', 
               backdropFilter: 'blur(8px)', 
               borderRadius: 6, 
               border: '1px solid rgba(255, 255, 255, 0.3)',
               boxShadow: '0 4px 12px rgba(0, 0, 0, 0.08)',
               padding: 4
             }}>
               {/* Algorithm Info Section */}
               <div style={{ 
                 display: 'flex', 
                 alignItems: 'center', 
                 gap: 8, 
                 padding: '0 12px', 
                 borderRight: '1px solid #f0f0f0',
                 height: 28,
                 marginRight: 4
               }}>
                 <InfoCircleFilled style={{ color: '#1677ff' }} />
                 <span style={{ fontWeight: 500, fontSize: 12, color: '#333' }}>当前服务链启用算法：</span>
                 <div style={{ display: 'flex', gap: 4 }}>
                   <Tag color="blue" style={{ margin: 0, fontSize: 10, lineHeight: '18px', padding: '0 4px', border: 'none', background: 'rgba(22, 119, 255, 0.1)', color: '#1677ff' }}>SM4-GCM</Tag>
                   <Tag color="blue" style={{ margin: 0, fontSize: 10, lineHeight: '18px', padding: '0 4px', border: 'none', background: 'rgba(22, 119, 255, 0.1)', color: '#1677ff' }}>SM3</Tag>
                 </div>
               </div>

               {/* Controls Section */}
               <div style={{ display: 'flex', gap: 0 }}>
                 <Tooltip title="放大">
                    <Button 
                      type="text" 
                      icon={<ZoomInOutlined />} 
                      onClick={() => zoomIn()} 
                      style={{ color: '#595959', width: 32, height: 32 }} 
                    />
                  </Tooltip>
                  <Tooltip title="缩小">
                    <Button 
                      type="text" 
                      icon={<ZoomOutOutlined />} 
                      onClick={() => zoomOut()} 
                      style={{ color: '#595959', width: 32, height: 32 }} 
                    />
                  </Tooltip>
                  <Tooltip title="适应画布">
                    <Button 
                      type="text" 
                      icon={<ExpandOutlined />} 
                      onClick={() => fitView()} 
                      style={{ color: '#595959', width: 32, height: 32 }} 
                    />
                  </Tooltip>
                 <div style={{ width: 1, height: 20, background: '#f0f0f0', margin: '6px 4px' }} />
                 <Tooltip title="整理布局">
                   <Button 
                     type="text" 
                     icon={<LayoutOutlined />} 
                     onClick={onLayout} 
                     style={{ color: '#595959', width: 32, height: 32 }} 
                   />
                 </Tooltip>
               </div>
             </div>
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
              dataSource={pendingService ? (groupsByType[pendingService.type] || []) : []}
              rowKey="id"
              columns={[
                { 
                  title: 'ID', 
                  dataIndex: 'id', 
                  width: 220, 
                  render: (t: any) => <span style={{ fontFamily: 'monospace' }}>{t}</span> 
                },
                { 
                  title: '集群名称', 
                  dataIndex: 'name', 
                  width: 180, 
                  render: (t: any) => <span>{t}</span> 
                },
                { 
                  title: '节点数量', 
                  dataIndex: 'count',
                  width: 100,
                  render: (count: any) => <span>{count} 节点</span>
                },
                { 
                  title: '总负载', 
                  width: 180, 
                  render: (_: any, r: any) => {
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
              onRow={(record: any) => ({
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
};

const StepOrchestration: React.FC<StepOrchestrationProps> = (props) => {
  return (
    <ReactFlowProvider>
      <StepOrchestrationContent {...props} />
    </ReactFlowProvider>
  );
};

export default StepOrchestration;
