/**
 * 虚拟机间亲和/反亲和表单区（复用容器域 PodAffinityEditor）。
 */
import React, { useEffect } from 'react';
import { Collapse, Typography } from 'antd';
import PodAffinityEditor, {
  type PodAffinityEditorHandle,
} from '../../../containers/components/workloadForm/editors/PodAffinityEditor';
import { parsePodAffinityFromK8s } from '../../lib/podAffinityK8s';

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
    </div>
  );
};

export default ChangePodAffinityFields;
