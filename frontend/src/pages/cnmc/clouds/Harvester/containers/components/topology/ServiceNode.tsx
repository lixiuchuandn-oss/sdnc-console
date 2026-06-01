import React from 'react';
import { Handle, Position, NodeProps } from 'reactflow';
import { CloudServerOutlined } from '@ant-design/icons';
import './TopologyNodeStyles.css';

export interface ServiceNodeData {
  name: string;
  namespace: string;
  port?: number;
  type?: string; // ClusterIP, NodePort, LoadBalancer
  clusterIP?: string;
  labels?: Record<string, string>;
  rawData?: any;
}

const ServiceNode: React.FC<NodeProps<ServiceNodeData>> = ({ data, selected }) => {
  return (
    <div className={`topology-node service-node ${selected ? 'selected' : ''}`}>
      <Handle type="target" position={Position.Top} />
      
      <div className="node-header">
        <CloudServerOutlined className="node-icon" />
        <span className="node-type">Service</span>
      </div>
      
      <div className="node-content">
        <div className="node-name" title={data.name}>
          {data.name}
        </div>
        {data.port && (
          <div className="node-port">
            端口: {data.port}
          </div>
        )}
        <div className="node-namespace">
          {data.namespace}
        </div>
      </div>
      
      {data.type && (
        <div className="node-type-tag">
          <span className={`type-tag ${data.type.toLowerCase()}`}>
            {data.type}
          </span>
        </div>
      )}
      
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
};

export default ServiceNode;
