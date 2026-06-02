import React, { useEffect } from 'react';
import { Form, Modal, Select } from 'antd';
import type { FailureDomainRow } from 'services/harvester/failureDomains';

type Props = {
  open: boolean;
  domain: FailureDomainRow | null;
  allNodeNames: string[];
  onClose: () => void;
  onSubmit: (nodeNames: string[]) => Promise<void>;
  saving: boolean;
};

const FailureDomainAssignNodesModal: React.FC<Props> = ({
  open,
  domain,
  allNodeNames,
  onClose,
  onSubmit,
  saving,
}) => {
  const [form] = Form.useForm<{ nodeNames: string[] }>();

  useEffect(() => {
    if (!open || !domain) return;
    form.setFieldsValue({ nodeNames: domain.nodeNames || [] });
  }, [open, domain, form]);

  const options = allNodeNames.map((n) => ({ value: n, label: n }));

  return (
    <Modal
      title={domain ? `分配节点 · ${domain.name}` : '分配节点'}
      open={open}
      onCancel={onClose}
      confirmLoading={saving}
      destroyOnClose
      width={560}
      onOk={() => {
        void form.validateFields().then((v) => onSubmit(v.nodeNames || []));
      }}
    >
      <Form form={form} layout="vertical">
        <Form.Item name="nodeNames" label="物理节点">
          <Select
            mode="multiple"
            allowClear
            showSearch
            placeholder="选择归属本故障域的节点"
            options={options}
            optionFilterProp="label"
          />
        </Form.Item>
      </Form>
      <p style={{ margin: 0, color: 'rgba(0,0,0,.45)', fontSize: 12 }}>
        保存后将写入节点标签 <code>topology.cloudmap.io/failure-domain</code>，供调度与 DRS 识别故障域分布。
      </p>
    </Modal>
  );
};

export default FailureDomainAssignNodesModal;
