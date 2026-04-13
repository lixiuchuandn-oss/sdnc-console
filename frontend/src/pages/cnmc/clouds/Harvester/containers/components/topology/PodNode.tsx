import React from 'react';
import { Handle, Position, NodeProps } from 'reactflow';
import { AppstoreOutlined, CheckCircleOutlined, ExclamationCircleOutlined, ClockCircleOutlined, PauseCircleOutlined } from '@ant-design/icons';
import './TopologyNodeStyles.css';

export interface PodNodeData {
  name: string;
  namespace: string;
  status?: string;
  ip?: string;
  labels?: Record<string, string>;
  rawData?: any;
}

const getPodStatus = (status?: string): { icon: React.ReactNode; text: string; color: string } => {
  switch (status) {
    case 'Running':
      return { icon: <CheckCircleOutlined />, text: '运行中', color: '#52c41a' };
    case 'Pending':
      return { icon: <ClockCircleOutlined />, text: '等待中', color: '#faad14' };
    case 'Failed':
    case 'Error':
      return { icon: <ExclamationCircleOutlined />, text: '错误', color: '#ff4d4f' };
    case 'Succeeded':
      return { icon: <CheckCircleOutlined />, text: '完成', color: '#1890ff' };
    case 'Terminating':
      return { icon: <PauseCircleOutlined />, text: '终止中', color: '#722ed1' };
    default:
      return { icon: <ClockCircleOutlined />, text: '未知', color: '#8c8c8c' };
  }
};

const PodNode: React.FC<NodeProps<PodNodeData>> = ({ data, selected }) => {
  const statusInfo = getPodStatus(data.status);
  
  return (
    <div className={`topology-node pod-node ${selected ? 'selected' : ''} pod-${data.status?.toLowerCase()}`}>
      <Handle type="target" position={Position.Top} />
      
      <div className="node-header">
        <AppstoreOutlined className="node-icon" />
        <span className="node-type">Pod</span>
      </div>
      
      <div className="node-content">
        <div className="node-name" title={data.name}>
          {data.name}
        </div>
        {data.ip && (
          <div className="node-ip">
            IP: {data.ip}
          </div>
        )}
      </div>
      
      <div className="node-status">
        <span style={{ color: statusInfo.color }}>
          {statusInfo.icon}
        </span>
        <span style={{ color: statusInfo.color }}>
          {statusInfo.text}
        </span>
      </div>
      
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
};

export default PodNode;
