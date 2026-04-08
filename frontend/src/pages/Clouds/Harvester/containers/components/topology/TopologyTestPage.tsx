import React from 'react';
import { ServiceTopologyExample } from './index';

/**
 * 拓扑图测试页面
 * 用于验证服务拓扑图组件是否正常工作
 */
const TopologyTestPage: React.FC = () => {
  return (
    <div style={{ padding: 24, background: '#f0f2f5', minHeight: '100vh' }}>
      <ServiceTopologyExample />
    </div>
  );
};

export default TopologyTestPage;
