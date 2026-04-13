import React, { useState, useEffect } from 'react';
import { Modal, Form, Input, Button, message, Row, Col, Typography } from 'antd';
import { PlusOutlined, MinusCircleOutlined } from '@ant-design/icons';
import { patchHarvesterVm } from '../../../../../services/harvesterApi';

type Props = {
  open: boolean;
  onClose: () => void;
  cloudId: string;
  /** KubeVirt VirtualMachine 形态（与列表 vms 项一致） */
  resource: any;
  onSuccess: () => void;
};

const RdsInstanceLabelEditModal: React.FC<Props> = ({
  open,
  onClose,
  cloudId,
  resource,
  onSuccess,
}) => {
  const [form] = Form.useForm();
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open || !resource) {
      form.resetFields();
      return;
    }

    const labels = resource?.metadata?.labels || {};
    const labelList = Object.entries(labels).map(([key, value]) => ({ key, value }));

    form.setFieldsValue({
      labels: labelList,
    });
  }, [open, resource, form]);

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();
      setSubmitting(true);

      const patchOps: any[] = [];

      const originalLabels = resource?.metadata?.labels || {};

      const newLabels: Record<string, string> = {};

      if (values.labels && Array.isArray(values.labels)) {
        values.labels.forEach((item: any) => {
          if (item && item.key && item.key.trim() !== '') {
            newLabels[item.key.trim()] =
              item.value !== undefined && item.value !== null ? String(item.value).trim() : '';
          }
        });
      }

      if (Object.keys(originalLabels).length === 0) {
        patchOps.push({ op: 'add', path: '/metadata/labels', value: newLabels });
      } else {
        patchOps.push({ op: 'replace', path: '/metadata/labels', value: newLabels });
      }

      const ns = resource?.metadata?.namespace || resource?.namespace || 'default';
      const name = resource?.metadata?.name || resource?.name;

      if (!name) throw new Error('虚拟机缺少 metadata.name');

      await patchHarvesterVm(cloudId, ns, name, patchOps, 'application/json-patch+json');
      message.success('更新标签成功');
      onSuccess();
      onClose();
    } catch (e: any) {
      if (e?.errorFields) return;
      message.error(e?.message || '更新标签失败');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      title="编辑云数据库标签"
      open={open}
      onCancel={onClose}
      onOk={handleSubmit}
      confirmLoading={submitting}
      destroyOnHidden
      width={600}
    >
      <div style={{ marginBottom: 16, color: 'rgba(0, 0, 0, 0.45)' }}>
        与镜像编辑标签方式相同。云数据库实例常用标签示例：
        <span style={{ fontFamily: 'monospace', background: '#f5f5f5', padding: '2px 4px', borderRadius: 4, marginLeft: 4 }}>
          tower.io/rds
        </span>
        、
        <span style={{ fontFamily: 'monospace', background: '#f5f5f5', padding: '2px 4px', borderRadius: 4 }}>
          tower.io/paas-type
        </span>
        、
        <span style={{ fontFamily: 'monospace', background: '#f5f5f5', padding: '2px 4px', borderRadius: 4 }}>
          tower.io/paas-ver
        </span>
        。请勿随意删除 <Typography.Text code>harvesterhci.io/*</Typography.Text> 等系统标签，以免影响调度与展示。
      </div>

      <Form form={form} layout="vertical">
        <Form.List name="labels">
          {(fields, { add, remove }) => (
            <>
              {fields.map(({ key, name, ...restField }) => (
                <Row key={key} gutter={8} align="middle" style={{ marginBottom: 8 }}>
                  <Col span={11}>
                    <Form.Item
                      {...restField}
                      name={[name, 'key']}
                      style={{ marginBottom: 0 }}
                      rules={[
                        { required: true, message: '请输入键名' },
                        {
                          pattern:
                            /^([A-Za-z0-9][-A-Za-z0-9_.]*[A-Za-z0-9]\/)?([A-Za-z0-9][-A-Za-z0-9_.]*[A-Za-z0-9])$/,
                          message: '必须是合法的 Kubernetes 标签键名',
                        },
                      ]}
                    >
                      <Input placeholder="Key (例如: tower.io/paas-type)" />
                    </Form.Item>
                  </Col>
                  <Col span={11}>
                    <Form.Item
                      {...restField}
                      name={[name, 'value']}
                      style={{ marginBottom: 0 }}
                    >
                      <Input placeholder="Value (例如: mysql)" />
                    </Form.Item>
                  </Col>
                  <Col span={2} style={{ textAlign: 'center' }}>
                    <MinusCircleOutlined
                      onClick={() => remove(name)}
                      style={{ color: '#ff4d4f', cursor: 'pointer' }}
                    />
                  </Col>
                </Row>
              ))}
              <Form.Item style={{ marginTop: 16 }}>
                <Button type="dashed" onClick={() => add()} block icon={<PlusOutlined />}>
                  添加标签
                </Button>
              </Form.Item>
            </>
          )}
        </Form.List>
      </Form>
    </Modal>
  );
};

export default RdsInstanceLabelEditModal;
