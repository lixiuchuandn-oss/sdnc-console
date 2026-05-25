/**
 * Harvester 集群 · 命名空间（项目）创建/编辑侧滑表单。
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  Button,
  Card,
  Col,
  Drawer,
  Flex,
  Form,
  Input,
  Row,
} from 'antd';
import { MinusCircleOutlined, PlusOutlined } from '@ant-design/icons';
import { getHarvesterDrawerSectionCardProps } from '../../shared/drawerSectionCard';
import {
  namespaceRecordToFormValues,
  submitNamespaceForm,
  validateNamespacePairKeyField,
  type NamespaceFormValues,
} from '../lib/submitNamespaceForm';

export type NamespaceFormDrawerProps = {
  open: boolean;
  onClose: () => void;
  cloudId: string;
  /** null：新建；非 null：编辑对应列表行记录 */
  editingRecord: unknown | null;
  /** 成功后由父级刷新列表（建议使用 onRefresh(true, true)） */
  onCommitted?: () => void;
};

const NamespaceFormDrawer: React.FC<NamespaceFormDrawerProps> = ({
  open,
  onClose,
  cloudId,
  editingRecord,
  onCommitted,
}) => {
  const [form] = Form.useForm();
  const [submitting, setSubmitting] = useState(false);
  const isEdit = Boolean(editingRecord);

  useEffect(() => {
    if (!open) return;
    if (editingRecord) {
      form.setFieldsValue(namespaceRecordToFormValues(editingRecord));
    } else {
      form.resetFields();
      form.setFieldsValue({
        labelPairs: [{ key: '', value: '' }],
        annotationPairs: [{ key: '', value: '' }],
      });
    }
  }, [open, editingRecord, form]);

  const handleFinish = useCallback(
    async (values: NamespaceFormValues) => {
      setSubmitting(true);
      try {
        const result = await submitNamespaceForm({ cloudId, isEdit, values });
        if (!result.ok) return;
        onCommitted?.();
        form.resetFields();
        onClose();
      } finally {
        setSubmitting(false);
      }
    },
    [cloudId, form, isEdit, onClose, onCommitted],
  );

  return (
    <Drawer
      title={isEdit ? '编辑项目' : '创建项目'}
      width={800}
      open={open}
      onClose={onClose}
      destroyOnHidden
      footer={
        <Flex justify="flex-end" gap="small">
          <Button onClick={onClose}>取消</Button>
          <Button type="primary" loading={submitting} onClick={() => form.submit()}>
            {isEdit ? '保存' : '创建'}
          </Button>
        </Flex>
      }
    >
      <Form form={form} layout="vertical" onFinish={handleFinish}>
        <Flex vertical gap="middle" style={{ width: '100%' }}>
          <Card title="基本信息" size="small" {...getHarvesterDrawerSectionCardProps()}>
            <Form.Item
              label="项目名称"
              name="name"
              rules={[
                { required: true, message: '请输入名称' },
                {
                  pattern: /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/,
                  message: '仅允许小写字母、数字与连字符，且首尾为字母或数字',
                },
                { max: 63, message: '最长 63 个字符' },
              ]}
            >
              <Input placeholder="例如：default 或 my-space" disabled={isEdit} />
            </Form.Item>
          </Card>

          <Card size="small" title="标签" {...getHarvesterDrawerSectionCardProps()}>
            <Form.List name="labelPairs">
              {(fields, { add, remove }) => (
                <Flex vertical gap="middle">
                  {fields.map(({ key, name: rowName }) => (
                    <Row key={key} gutter={8} align="middle" wrap={false}>
                      <Col flex="1 1 0">
                        <Form.Item
                          name={[rowName, 'key']}
                          rules={[{ validator: validateNamespacePairKeyField }]}
                          noStyle
                        >
                          <Input placeholder="键，如 env 或 example.com/name" allowClear />
                        </Form.Item>
                      </Col>
                      <Col flex="1 1 0">
                        <Form.Item name={[rowName, 'value']} noStyle>
                          <Input placeholder="值" allowClear />
                        </Form.Item>
                      </Col>
                      <Col flex="none">
                        <Button
                          type="text"
                          danger
                          icon={<MinusCircleOutlined />}
                          disabled={fields.length <= 1}
                          onClick={() => remove(rowName)}
                          aria-label="删除此行标签"
                        />
                      </Col>
                    </Row>
                  ))}
                  <Button type="dashed" onClick={() => add({ key: '', value: '' })} block icon={<PlusOutlined />}>
                    添加标签
                  </Button>
                </Flex>
              )}
            </Form.List>
          </Card>

          <Card size="small" title="注解" {...getHarvesterDrawerSectionCardProps()}>
            <Form.List name="annotationPairs">
              {(fields, { add, remove }) => (
                <Flex vertical gap="middle">
                  {fields.map(({ key, name: rowName }) => (
                    <Row key={key} gutter={8} align="top" wrap={false}>
                      <Col flex="1 1 0">
                        <Form.Item
                          name={[rowName, 'key']}
                          rules={[{ validator: validateNamespacePairKeyField }]}
                          noStyle
                        >
                          <Input placeholder="键，如 description 或 example.com/note" allowClear />
                        </Form.Item>
                      </Col>
                      <Col flex="1 1 0">
                        <Form.Item name={[rowName, 'value']} noStyle>
                          <Input.TextArea placeholder="值（可多行）" allowClear autoSize={{ minRows: 1, maxRows: 8 }} />
                        </Form.Item>
                      </Col>
                      <Col flex="none">
                        <Button
                          type="text"
                          danger
                          icon={<MinusCircleOutlined />}
                          disabled={fields.length <= 1}
                          onClick={() => remove(rowName)}
                          aria-label="删除此行注解"
                        />
                      </Col>
                    </Row>
                  ))}
                  <Button type="dashed" onClick={() => add({ key: '', value: '' })} block icon={<PlusOutlined />}>
                    添加注解
                  </Button>
                </Flex>
              )}
            </Form.List>
          </Card>
        </Flex>
      </Form>
    </Drawer>
  );
};

export default NamespaceFormDrawer;
