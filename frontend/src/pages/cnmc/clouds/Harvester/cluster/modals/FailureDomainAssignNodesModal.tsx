import React, { useEffect, useMemo } from 'react';
import { Form, Modal, Select } from 'antd';
import type { FailureDomainRow } from 'services/harvester/failureDomains';

type Props = {
  open: boolean;
  domain: FailureDomainRow | null;
  /** 未分配节点 + 当前故障域已分配节点（不含其他故障域中的节点） */
  selectableNodeNames: string[];
  onClose: () => void;
  onSubmit: (nodeNames: string[]) => Promise<void>;
  saving: boolean;
};

const FailureDomainAssignNodesModal: React.FC<Props> = ({
  open,
  domain,
  selectableNodeNames,
  onClose,
  onSubmit,
  saving,
}) => {
  const [form] = Form.useForm<{ nodeNames: string[] }>();

  useEffect(() => {
    if (!open || !domain) return;
    form.setFieldsValue({ nodeNames: domain.nodeNames || [] });
  }, [open, domain, form]);

  const options = useMemo(
    () => selectableNodeNames.map((n) => ({ value: n, label: n })),
    [selectableNodeNames],
  );

  return (
    <Modal
      title={domain ? `分配节点 · ${domain.name}` : '分配节点'}
      open={open}
      onCancel={onClose}
      confirmLoading={saving}
      destroyOnClose
      width={560}
      onOk={() => {
        void form
          .validateFields()
          .then((v) => onSubmit(v.nodeNames || []))
          .catch(() => undefined);
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
            notFoundContent="暂无可分配节点（未分配节点或已归属其他故障域的节点不会显示）"
          />
        </Form.Item>
      </Form>
      <p style={{ margin: 0, color: 'rgba(0,0,0,.45)', fontSize: 12 }}>
        每个节点只能归属一个故障域；下拉仅显示未分配节点及已归属本故障域的节点。保存后将写入节点标签{' '}
        <code>topology.cloudmap.io/failure-domain</code>，供调度与 DRS 识别故障域分布。
      </p>
    </Modal>
  );
};

export default FailureDomainAssignNodesModal;
