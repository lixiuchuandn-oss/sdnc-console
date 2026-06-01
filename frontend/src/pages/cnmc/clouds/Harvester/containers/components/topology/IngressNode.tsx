import React from 'react';
import { Handle, Position, NodeProps } from 'reactflow';
import { GlobalOutlined, CheckCircleOutlined } from '@ant-design/icons';
import './TopologyNodeStyles.css';

export interface IngressNodeData {
  name: string;
  namespace: string;
  host?: string;
  labels?: Record<string, string>;
  rawData?: any;
}

const IngressNode: React.FC<NodeProps<IngressNodeData>> = ({ data, selected }) => {
  return (
    <div className={`topology-node ingress-node ${selected ? 'selected' : ''}`}>
      <Handle type="target" position={Position.Top} />
      
      <div className="node-header">
        <GlobalOutlined className="node-icon" />
        <span className="node-type">Ingress</span>
      </div>
      
      <div className="node-content">
        <div className="node-name" title={data.host || data.name}>
          {data.host || data.name}
        </div>
        <div className="node-namespace">
          {data.namespace}
        </div>
      </div>
      
      <div className="node-status">
        <CheckCircleOutlined style={{ color: '#52c41a' }} />
        <span>正常</span>
      </div>
      
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
};

export default IngressNode;
