/**
 * 虚拟机间亲和/反亲和表单区（复用容器域 PodAffinityEditor）。
 */
import React, { useEffect } from 'react';
import { Collapse, Typography } from 'antd';
import PodAffinityEditor, {
  type PodAffinityEditorHandle,
} from '../../../containers/components/workloadForm/editors/PodAffinityEditor';
import { parsePodAffinityFromK8s } from '../../lib/podAffinityK8s';
import {
  VM_ADVANCED_SCHEDULING_COLLAPSE,
  VM_ADVANCED_SCHEDULING_HINT,
} from '../../lib/vmAdvancedSchedulingLabels';
import { VmAdvancedSchedulingCollapseLabel } from '../../lib/VmAdvancedSchedulingCollapseLabel';

type Props = {
  form: any;
  record: any;
  namespacesOptions: string[];
  podAffinityRef: React.RefObject<PodAffinityEditorHandle>;
  podAntiAffinityRef: React.RefObject<PodAffinityEditorHandle>;
};

const ChangePodAffinityFields: React.FC<Props> = ({
  form,
  record,
  namespacesOptions,
  podAffinityRef,
  podAntiAffinityRef,
}) => {
  useEffect(() => {
    if (!record) return;
    const affinity = record?.spec?.template?.spec?.affinity;
    form.setFieldsValue({
      podAffinity: parsePodAffinityFromK8s(affinity?.podAffinity),
      podAntiAffinity: parsePodAffinityFromK8s(affinity?.podAntiAffinity),
    });
  }, [record, form]);

  return (
    <div>
      <Typography.Paragraph type="secondary" style={{ marginBottom: 16 }}>
        通过标签选择器约束本虚拟机与其它虚拟机（Pod）的调度关系。拓扑域常用{' '}
        <Typography.Text code>kubernetes.io/hostname</Typography.Text>（同/不同宿主机）或{' '}
        <Typography.Text code>topology.kubernetes.io/zone</Typography.Text>（可用区）。
        与「节点亲和性」（VM–宿主机）相互独立，可同时配置。
      </Typography.Paragraph>
      <Collapse
        defaultActiveKey={['podAffinity', 'podAntiAffinity']}
        items={[
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
        ]}
      />
    </div>
  );
};

export default ChangePodAffinityFields;
