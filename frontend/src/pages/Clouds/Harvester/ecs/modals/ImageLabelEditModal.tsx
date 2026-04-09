import React, { useState, useEffect } from 'react';
import { Modal, Form, Input, Button, Space, message, Row, Col } from 'antd';
import { PlusOutlined, MinusCircleOutlined } from '@ant-design/icons';
import { patchHarvesterImage } from '../../../../../services/harvesterApi';

type Props = {
  open: boolean;
  onClose: () => void;
  cloudId: string;
  resource: any;
  onSuccess: () => void;
};

const ImageLabelEditModal: React.FC<Props> = ({ open, onClose, cloudId, resource, onSuccess }) => {
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

      // Using JSON Patch format instead of merge-patch+json
      const patchOps: any[] = [];
      
      // Original labels - remove them if they don't exist in new form
      const originalLabels = resource?.metadata?.labels || {};
      
      // We will replace the entire labels object to ensure consistency
      // and avoid dealing with complex escaping in JSON patch paths
      const newLabels: Record<string, string> = {};
      
      if (values.labels && Array.isArray(values.labels)) {
        values.labels.forEach((item: any) => {
          if (item && item.key && item.key.trim() !== '') {
            newLabels[item.key.trim()] = item.value !== undefined && item.value !== null ? String(item.value).trim() : '';
          }
        });
      }
      
      if (Object.keys(originalLabels).length === 0) {
          // If no labels existed before, we need to add the object first
          patchOps.push({ op: 'add', path: '/metadata/labels', value: newLabels });
      } else {
          // Replace the entire labels object
          patchOps.push({ op: 'replace', path: '/metadata/labels', value: newLabels });
      }

      const ns = resource?.metadata?.namespace || resource?.namespace || 'default';
      const name = resource?.metadata?.name || resource?.name;

      if (!name) throw new Error('镜像资源缺少名称');

      // Use application/json-patch+json
      await patchHarvesterImage(cloudId, ns, name, patchOps, 'application/json-patch+json');
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
      title="编辑镜像标签"
      open={open}
      onCancel={onClose}
      onOk={handleSubmit}
      confirmLoading={submitting}
      destroyOnClose
      width={600}
    >
      <div style={{ marginBottom: 16, color: 'rgba(0, 0, 0, 0.45)' }}>
        您可以通过添加特定的标签来控制镜像的行为。例如，添加 <span style={{ fontFamily: 'monospace', background: '#f5f5f5', padding: '2px 4px', borderRadius: 4 }}>tower.io/rds: true</span> 可以将其标记为云数据库镜像。
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
                          pattern: /^([A-Za-z0-9][-A-Za-z0-9_.]*[A-Za-z0-9]\/)?([A-Za-z0-9][-A-Za-z0-9_.]*[A-Za-z0-9])$/, 
                          message: '必须是合法的Kubernetes标签键名' 
                        }
                      ]}
                    >
                      <Input placeholder="Key (例如: tower.io/rds)" />
                    </Form.Item>
                  </Col>
                  <Col span={11}>
                    <Form.Item
                      {...restField}
                      name={[name, 'value']}
                      style={{ marginBottom: 0 }}
                    >
                      <Input placeholder="Value (例如: true)" />
                    </Form.Item>
                  </Col>
                  <Col span={2} style={{ textAlign: 'center' }}>
                    <MinusCircleOutlined onClick={() => remove(name)} style={{ color: '#ff4d4f', cursor: 'pointer' }} />
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

export default ImageLabelEditModal;