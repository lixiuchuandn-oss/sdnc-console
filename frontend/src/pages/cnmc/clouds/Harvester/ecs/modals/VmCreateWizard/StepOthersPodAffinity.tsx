/**
 * 创建向导 · 基本信息 · 节点标签、虚拟机间亲和/反亲和（折叠项）。
 */
import React, { useMemo, useRef } from 'react';
import { Collapse } from 'antd';
import PodAffinityEditor, {
  type PodAffinityEditorHandle,
} from '../../../containers/components/workloadForm/editors/PodAffinityEditor';
import {
  VM_ADVANCED_SCHEDULING_COLLAPSE,
  VM_ADVANCED_SCHEDULING_HINT,
  isVmAdvancedSchedulingAllowed,
} from '../../lib/vmAdvancedSchedulingLabels';
import { VmAdvancedSchedulingCollapseLabel } from '../../lib/VmAdvancedSchedulingCollapseLabel';
import VmNodeSelectorPairsEditor from '../../lib/VmNodeSelectorPairsEditor';

export type StepOthersPodAffinityProps = {
  hostModeState: string;
  namespacesOptions: string[];
  podAffinityRef: React.RefObject<PodAffinityEditorHandle>;
  podAntiAffinityRef: React.RefObject<PodAffinityEditorHandle>;
};

const StepOthersPodAffinity: React.FC<StepOthersPodAffinityProps> = ({
  hostModeState,
  namespacesOptions,
  podAffinityRef,
  podAntiAffinityRef,
}) => {
  const collapseItems = useMemo(() => {
    if (!isVmAdvancedSchedulingAllowed(hostModeState)) {
      return [];
    }

    const items: NonNullable<React.ComponentProps<typeof Collapse>['items']> = [];

    if (hostModeState === 'label') {
      items.push({
        key: 'nodeSelector',
        label: VM_ADVANCED_SCHEDULING_COLLAPSE.nodeLabels,
        children: <VmNodeSelectorPairsEditor />,
      });
    }

    items.push(
      {
        key: 'podAffinity',
        label: (
          <VmAdvancedSchedulingCollapseLabel
            title={VM_ADVANCED_SCHEDULING_COLLAPSE.podAffinity}
            hint={VM_ADVANCED_SCHEDULING_HINT.podAffinity}
          />
        ),
        children: (
          <PodAffinityEditor
            ref={podAffinityRef}
            name="podAffinity"
            label={VM_ADVANCED_SCHEDULING_COLLAPSE.podAffinity}
            namespacesOptions={namespacesOptions}
            compact
          />
        ),
      },
      {
        key: 'podAntiAffinity',
        label: (
          <VmAdvancedSchedulingCollapseLabel
            title={VM_ADVANCED_SCHEDULING_COLLAPSE.podAntiAffinity}
            hint={VM_ADVANCED_SCHEDULING_HINT.podAntiAffinity}
          />
        ),
        children: (
          <PodAffinityEditor
            ref={podAntiAffinityRef}
            name="podAntiAffinity"
            label={VM_ADVANCED_SCHEDULING_COLLAPSE.podAntiAffinity}
            namespacesOptions={namespacesOptions}
            compact
          />
        ),
      },
    );

    return items;
  }, [hostModeState, namespacesOptions, podAffinityRef, podAntiAffinityRef]);

  if (!isVmAdvancedSchedulingAllowed(hostModeState)) {
    return null;
  }

  return (
    <Collapse
      ghost
      defaultActiveKey={[]}
      className="wizard-collapse-nopad"
      items={collapseItems}
    />
  );
};

export function useStepOthersPodAffinityRefs() {
  const podAffinityRef = useRef<PodAffinityEditorHandle>(null);
  const podAntiAffinityRef = useRef<PodAffinityEditorHandle>(null);
  return { podAffinityRef, podAntiAffinityRef };
}

export default StepOthersPodAffinity;
