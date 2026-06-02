import React from 'react';
import { Collapse, Divider, Form } from 'antd';

import {
  DnsConfigEditor,
  HostAliasesEditor,
  LabelEditor,
  NodeAffinityEditor,
  PodAffinityEditor,
  TolerationsEditor,
} from '../editors';
import type {
  NodeAffinityEditorHandle,
  PodAffinityEditorHandle,
  TolerationsEditorHandle,
} from '../editors';

export interface WorkloadFormStepAdvancedProps {
  namespacesOptions: string[];
  nodeAffinityEditorRef: React.RefObject<NodeAffinityEditorHandle>;
  nodeAntiAffinityEditorRef: React.RefObject<NodeAffinityEditorHandle>;
  podAffinityEditorRef: React.RefObject<PodAffinityEditorHandle>;
  podAntiAffinityEditorRef: React.RefObject<PodAffinityEditorHandle>;
  tolerationsEditorRef: React.RefObject<TolerationsEditorHandle>;
}

const WorkloadFormStepAdvanced: React.FC<WorkloadFormStepAdvancedProps> = ({
  namespacesOptions,
  nodeAffinityEditorRef,
  nodeAntiAffinityEditorRef,
  podAffinityEditorRef,
  podAntiAffinityEditorRef,
  tolerationsEditorRef,
}) => {
  const form = Form.useFormInstance();
  const nodeAffinity = form.getFieldValue('nodeAffinity');
  const nodeAntiAffinity = form.getFieldValue('nodeAntiAffinity');
  const podAffinity = form.getFieldValue('podAffinity');
  const podAntiAffinity = form.getFieldValue('podAntiAffinity');
  const tolerations = form.getFieldValue('tolerations') || [];
  const hostAliases = form.getFieldValue('hostAliases') || [];

  const nodeAffinityCount =
    (nodeAffinity?.required?.nodeSelectorTerms?.length || 0) +
    (nodeAffinity?.preferred?.length || 0);
  const nodeAntiAffinityCount =
    (nodeAntiAffinity?.required?.nodeSelectorTerms?.length || 0) +
    (nodeAntiAffinity?.preferred?.length || 0);
  const podAffinityCount =
    (podAffinity?.required?.length || 0) + (podAffinity?.preferred?.length || 0);
  const podAntiAffinityCount =
    (podAntiAffinity?.required?.length || 0) + (podAntiAffinity?.preferred?.length || 0);
  const tolerationsCount = tolerations.length;
  const hostAliasesCount = hostAliases.length;

  return (
    <div>
      <Divider orientation="left">调度策略</Divider>
      <LabelEditor name="nodeSelector" label="节点选择器" />

      <Collapse
        ghost
        defaultActiveKey={[]}
        items={[
          {
            key: 'nodeAffinity',
            label: `节点亲和性 (${nodeAffinityCount})`,
            children: (
              <NodeAffinityEditor
                ref={nodeAffinityEditorRef}
                name="nodeAffinity"
                label="节点亲和性"
              />
            ),
          },
          {
            key: 'nodeAntiAffinity',
            label: `节点反亲和性 (${nodeAntiAffinityCount})`,
            children: (
              <NodeAffinityEditor
                ref={nodeAntiAffinityEditorRef}
                name="nodeAntiAffinity"
                label="节点反亲和性"
              />
            ),
          },
          {
            key: 'podAffinity',
            label: `Pod 亲和性 (${podAffinityCount})`,
            children: (
              <PodAffinityEditor
                ref={podAffinityEditorRef}
                name="podAffinity"
                label="Pod 亲和性"
                namespacesOptions={namespacesOptions}
              />
            ),
          },
          {
            key: 'podAntiAffinity',
            label: `Pod 反亲和性 (${podAntiAffinityCount})`,
            children: (
              <PodAffinityEditor
                ref={podAntiAffinityEditorRef}
                name="podAntiAffinity"
                label="Pod 反亲和性"
                namespacesOptions={namespacesOptions}
              />
            ),
          },
          {
            key: 'tolerations',
            label: `污点容忍 (${tolerationsCount})`,
            children: <TolerationsEditor ref={tolerationsEditorRef} />,
          },
          {
            key: 'hostAliases',
            label: `域名映射 (${hostAliasesCount})`,
            children: <HostAliasesEditor />,
          },
          {
            key: 'dnsConfig',
            label: 'DNS 配置',
            children: <DnsConfigEditor />,
          },
        ]}
      />
    </div>
  );
};

export default WorkloadFormStepAdvanced;
