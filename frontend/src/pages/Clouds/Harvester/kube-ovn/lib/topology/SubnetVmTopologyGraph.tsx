/**
 * 子网（逻辑交换机）→ 虚拟机：布局与样式对齐物理网络 ProviderNetworkTopologyGraph（React Flow + 点阵背景 + 缩放控件）。
 */
import React, { useMemo } from 'react';
import ReactFlow, {
  Background,
  BackgroundVariant,
  Controls,
  Position,
  type Edge,
  type Node,
} from 'react-flow-renderer';
import 'react-flow-renderer/dist/style.css';
import { Spin } from 'antd';
import { ACCENT, edgeDefault, flowChromeStyles, LabelBlock, safeNodeId, TopoNodeCard } from './kubeOvnTopoPrimitives';

export type SubnetVmTopoVm = {
  key: string;
  alias: string;
  name: string;
  namespace: string;
  ips: string[];
};

export type SubnetVmTopologyGraphProps = {
  subnetDisplay: string;
  subnetName: string;
  /** 展示 CIDR，如 10.0.1.0/24 */
  cidr?: string;
  vms: SubnetVmTopoVm[];
  /** 首次拉取 ECS 列表时为 true */
  loading: boolean;
};

const LAYER_SUBNET = 0;
const LAYER_VM = 300;
const VM_STEP = 92;
const START_Y = 40;

const SubnetVmTopologyGraph: React.FC<SubnetVmTopologyGraphProps> = ({
  subnetDisplay,
  subnetName,
  cidr,
  vms,
  loading,
}) => {
  const { nodes, edges, flowKey } = useMemo(() => {
    const nodesOut: Node[] = [];
    const edgesOut: Edge[] = [];
    const subnetNodeId = 'topo_subnet_main';

    const cidrText = cidr && String(cidr).trim() ? String(cidr).trim() : '';
    const subnetTitle = subnetDisplay || subnetName || '—';
    const subnetDetail = cidrText
      ? `CIDR ${cidrText}`
      : subnetName
        ? `资源名 ${subnetName}`
        : undefined;

    const vmCount = vms.length;
    const subnetY =
      vmCount === 0 ? START_Y : START_Y + ((Math.max(vmCount, 1) - 1) * VM_STEP) / 2;

    nodesOut.push({
      id: subnetNodeId,
      position: { x: LAYER_SUBNET, y: subnetY },
      data: {
        label: (
          <LabelBlock kicker="逻辑交换机" title={subnetTitle} detail={subnetDetail} accent={ACCENT.hub} />
        ),
      },
      sourcePosition: Position.Right,
    });

    if (loading && vmCount === 0) {
      const loadingId = 'topo_vm_loading';
      nodesOut.push({
        id: loadingId,
        position: { x: LAYER_VM, y: START_Y },
        data: {
          label: (
            <TopoNodeCard accent={ACCENT.hub}>
              <div style={{ padding: '28px 24px', minHeight: 78, textAlign: 'left' }}>
                <Spin size="small" />
                <div style={{ marginTop: 10, fontSize: 12, color: '#8c8c8c', fontWeight: 500 }}>加载虚拟机…</div>
              </div>
            </TopoNodeCard>
          ),
        },
        targetPosition: Position.Left,
      });
      edgesOut.push({ id: `e_${subnetNodeId}_${loadingId}`, source: subnetNodeId, target: loadingId, ...edgeDefault });
    } else if (vmCount === 0) {
      const emptyId = 'topo_vm_empty';
      nodesOut.push({
        id: emptyId,
        position: { x: LAYER_VM, y: START_Y },
        data: {
          label: (
            <LabelBlock
              kicker="虚拟机"
              title="暂无接入"
              detail="当前没有引用该子网的云主机"
              tone="muted"
              accent={ACCENT.hub}
              dashed
            />
          ),
        },
        targetPosition: Position.Left,
      });
      edgesOut.push({ id: `e_${subnetNodeId}_${emptyId}`, source: subnetNodeId, target: emptyId, ...edgeDefault });
    } else {
      vms.forEach((vm, index) => {
        const vmId = safeNodeId('topo_vm', vm.key);
        const title = vm.alias || vm.name || '—';
        const ipLine = vm.ips.length ? vm.ips.join(', ') : '无 IP';
        const detail = `${vm.namespace}/${vm.name} · ${ipLine}`;
        nodesOut.push({
          id: vmId,
          position: { x: LAYER_VM, y: START_Y + index * VM_STEP },
          data: {
            label: <LabelBlock kicker="虚拟机" title={title} detail={detail} accent={ACCENT.nicDefault} />,
          },
          targetPosition: Position.Left,
        });
        edgesOut.push({ id: `e_${subnetNodeId}_${vmId}`, source: subnetNodeId, target: vmId, ...edgeDefault });
      });
    }

    const flowKey = `${subnetName}_${vms.map((v) => v.key).join('|')}_${loading ? 1 : 0}`;
    return { nodes: nodesOut, edges: edgesOut, flowKey };
  }, [subnetDisplay, subnetName, cidr, vms, loading]);

  return (
    <div
      className="pn-provider-topology-flow"
      style={{
        flex: 1,
        minHeight: 280,
        width: '100%',
        display: 'flex',
        flexDirection: 'column',
        borderRadius: 10,
        border: '1px solid #e8e8e8',
        background: '#f5f7fa',
        overflow: 'hidden',
        boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.85)',
      }}
    >
      <style>{flowChromeStyles}</style>
      <ReactFlow
        key={flowKey}
        style={{ flex: 1, minHeight: 0, width: '100%' }}
        nodes={nodes}
        edges={edges}
        fitView
        fitViewOptions={{ padding: 0.2, maxZoom: 1.05 }}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        zoomOnDoubleClick={false}
        panOnScroll
        preventScrolling={false}
        minZoom={0.32}
        maxZoom={1.2}
        defaultEdgeOptions={edgeDefault}
      >
        <Background id="subnet-vm-topo-bg" variant={BackgroundVariant.Dots} gap={22} size={1.15} color="#d9dee8" />
        <Controls
          showInteractive={false}
          style={{
            position: 'absolute',
            top: 10,
            right: 10,
            bottom: 'auto',
            left: 'auto',
            display: 'flex',
            flexDirection: 'row',
          }}
        />
      </ReactFlow>
    </div>
  );
};

export default SubnetVmTopologyGraph;
