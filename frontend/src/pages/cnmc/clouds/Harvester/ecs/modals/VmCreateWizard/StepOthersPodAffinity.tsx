/**
 * 创建向导 · 其它选项 · 虚拟机间亲和/反亲和（可选）。
 */
import React, { useRef } from 'react';
import { Collapse, Typography } from 'antd';
import PodAffinityEditor, {
  type PodAffinityEditorHandle,
} from '../../../containers/components/workloadForm/editors/PodAffinityEditor';

export type StepOthersPodAffinityProps = {
  namespacesOptions: string[];
  podAffinityRef: React.RefObject<PodAffinityEditorHandle>;
  podAntiAffinityRef: React.RefObject<PodAffinityEditorHandle>;
};

const StepOthersPodAffinity: React.FC<StepOthersPodAffinityProps> = ({
  namespacesOptions,
  podAffinityRef,
  podAntiAffinityRef,
}) => {
  return (
    <>
      <div className="wizard-group-title">虚拟机间调度（可选）</div>
      <Typography.Paragraph type="secondary" style={{ marginBottom: 12 }}>
        与宿主机调度（运行位置 / 节点亲和）独立。常用拓扑域{' '}
        <Typography.Text code>kubernetes.io/hostname</Typography.Text> 表示同机或分机部署。
      </Typography.Paragraph>
      <Collapse
        defaultActiveKey={[]}
        items={[
          {
            key: 'podAffinity',
            label: '虚拟机亲和性',
            children: (
              <PodAffinityEditor
                ref={podAffinityRef}
                name="podAffinity"
                label="虚拟机亲和性"
                namespacesOptions={namespacesOptions}
              />
            ),
          },
          {
            key: 'podAntiAffinity',
            label: '虚拟机反亲和性',
            children: (
              <PodAffinityEditor
                ref={podAntiAffinityRef}
                name="podAntiAffinity"
                label="虚拟机反亲和性"
                namespacesOptions={namespacesOptions}
              />
            ),
          },
        ]}
      />
    </>
  );
};

export function useStepOthersPodAffinityRefs() {
  const podAffinityRef = useRef<PodAffinityEditorHandle>(null);
  const podAntiAffinityRef = useRef<PodAffinityEditorHandle>(null);
  return { podAffinityRef, podAntiAffinityRef };
}

export default StepOthersPodAffinity;
