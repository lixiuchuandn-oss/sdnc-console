import React from 'react';
import { Card } from 'antd';
import { SCENARIOS, mockTransferData, CustomTransferItem } from '../constants';

interface StepReviewProps {
  form: any;
  scenarioType: string;
  selectedTemplate: string;
  user: any;
  tenants: any[];
  orgOptions: any[];
  nodes: any[];
  edges: any[];
}

const StepReview: React.FC<StepReviewProps> = ({
  form,
  scenarioType,
  selectedTemplate,
  user,
  tenants,
  orgOptions,
  nodes,
  edges,
}) => {
  const values = form.getFieldsValue(true);
  
  // Map keys to titles for better display
  const selectedObjects = (values.protectedObjects || []).map((key: string) => {
    const item = mockTransferData.find((d: CustomTransferItem) => d.key === key);
    return item ? `${item.title} (${item.key})` : key;
  });

  const scenarioLabel = SCENARIOS[scenarioType].label;
  const templateLabel = SCENARIOS[scenarioType].options.find((o: any) => o.value === selectedTemplate)?.label;

  return (
    <div style={{ padding: 24 }}>
      <Card title="基本信息" size="small" bordered={false}>
        <p><strong>场景模式:</strong> {scenarioLabel} - {templateLabel}</p>
        <p><strong>名称:</strong> {values.name}</p>
        <p><strong>集群:</strong> {values.cluster}</p>
        {user?.role === 'super_admin' && (
          <>
            <p><strong>租户:</strong> {tenants.find(t => t.id === values.tenantId)?.name || '-'}</p>
            <p><strong>组织:</strong> {(orgOptions.find((o: any) => o.value === values.organizationId) || { label: '-' }).label}</p>
          </>
        )}
        <p><strong>描述:</strong> {values.description || '-'}</p>
      </Card>
      <Card title="防护对象" size="small" bordered={false} style={{ marginTop: 16 }}>
        <p>{selectedObjects.join(', ') || '未选择'}</p>
      </Card>
      <Card title="编排拓扑" size="small" bordered={false} style={{ marginTop: 16 }}>
         <p>包含 {nodes.length} 个节点，{edges.length} 条连接。</p>
      </Card>
    </div>
  );
};

export default StepReview;
