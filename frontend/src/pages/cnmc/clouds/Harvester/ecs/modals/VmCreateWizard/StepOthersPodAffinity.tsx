/**
 * 创建向导 · 基本信息 · 虚拟机间亲和/反亲和（可选）。
 * 置于「信息」名称/描述之后，独立分组（非「信息」节内容）。
 */
import React, { useRef } from 'react';
import { Collapse } from 'antd';
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
      <div className="wizard-group-title">亲和性（可选）</div>
      <Collapse
        ghost
        defaultActiveKey={[]}
        className="wizard-collapse-nopad"
        items={[
          {
            key: 'podAffinity',
            label: '虚拟机亲和性（尽量/必须同域部署）',
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
            label: '虚拟机反亲和性（尽量/必须分散部署）',
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
