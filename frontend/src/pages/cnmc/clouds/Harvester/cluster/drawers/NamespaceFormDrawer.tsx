/**
 * Harvester 集群 · 命名空间（项目）创建/编辑侧滑表单。
 */
import React, { useEffect, useState } from 'react';
import {
  Button,
  Card,
  Col,
  Drawer,
  Flex,
  Form,
  Input,
  Row,
  message,
} from 'antd';
import { MinusCircleOutlined, PlusOutlined } from '@ant-design/icons';
import { createHarvesterNamespace, updateHarvesterNamespace } from '../../../../../../services/harvesterApi';
import { isSystemNamespace } from '../../../../../../utils/harvesterUtils';
import { clearGetCacheForPath } from '../../../../../../utils/requestManager';
import { getHarvesterDrawerSectionCardProps } from '../../shared/drawerSectionCard';

/** 表单「键值对」转为 K8s labels/annotations（忽略空键） */
function labelPairsToRecord(
  pairs: Array<{ key?: string; value?: string } | undefined> | undefined,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of pairs || []) {
    const k = String(p?.key ?? '').trim();
    if (!k) continue;
    out[k] = String(p?.value ?? '').trim();
  }
  return out;
}

/** 收集重复的键 */
function collectDuplicatePairKeys(pairs: Array<{ key?: string } | undefined> | undefined): string[] {
  const keys = (pairs || []).map((p) => String(p?.key ?? '').trim()).filter(Boolean);
  const seen = new Set<string>();
  const dup = new Set<string>();
  for (const k of keys) {
    if (seen.has(k)) dup.add(k);
    seen.add(k);
  }
  return [...dup];
}

export type NamespaceFormDrawerProps = {
  open: boolean;
  onClose: () => void;
  cloudId: string;
  /** null：新建；非 null：编辑对应列表行记录 */
  editingRecord: unknown | null;
  /** 成功后由父级刷新列表（建议使用 onRefresh(true, true)） */
  onCommitted?: () => void;
};

function recordToPairs(record: unknown): {
  name?: string;
  labelPairs: Array<{ key?: string; value?: string }>;
  annotationPairs: Array<{ key?: string; value?: string }>;
} {
  const r = record as {
    metadata?: { name?: string; labels?: Record<string, string>; annotations?: Record<string, string> };
    name?: string;
  };
  const name = r?.metadata?.name || r?.name;
  const labels = r?.metadata?.labels || {};
  const annotations = r?.metadata?.annotations || {};
  const labelPairs = Object.keys(labels)
    .sort()
    .map((k) => ({ key: k, value: String(labels[k] ?? '') }));
  const annotationPairs = Object.keys(annotations)
    .sort()
    .map((k) => ({ key: k, value: String(annotations[k] ?? '') }));

  return {
    name,
    labelPairs: labelPairs.length ? labelPairs : [{ key: '', value: '' }],
    annotationPairs: annotationPairs.length ? annotationPairs : [{ key: '', value: '' }],
  };
}

export const NamespaceFormDrawer: React.FC<NamespaceFormDrawerProps> = ({
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
      form.setFieldsValue(recordToPairs(editingRecord));
    } else {
      form.resetFields();
      form.setFieldsValue({
        labelPairs: [{ key: '', value: '' }],
        annotationPairs: [{ key: '', value: '' }],
      });
    }
  }, [open, editingRecord, form]);

  const handleFinish = async (values: {
    name?: string;
    labelPairs?: Array<{ key?: string; value?: string }>;
    annotationPairs?: Array<{ key?: string; value?: string }>;
  }) => {
    const name = String(values.name || '').trim();

    if (isSystemNamespace(name)) {
      message.error('禁止创建系统或受保护的项目');
      return;
    }

    const labelDups = collectDuplicatePairKeys(values.labelPairs);
    if (labelDups.length > 0) {
      message.error(`标签键不能重复：${labelDups.join(', ')}`);
      return;
    }
    const annotationDups = collectDuplicatePairKeys(values.annotationPairs);
    if (annotationDups.length > 0) {
      message.error(`注解键不能重复：${annotationDups.join(', ')}`);
      return;
    }

    const parsedLabels = labelPairsToRecord(values.labelPairs);
    const parsedAnnotations = labelPairsToRecord(values.annotationPairs);

    // 新建时写入 Tower 管理标签（与租户分配 scenario 区分）
    const labels = isEdit
      ? parsedLabels
      : {
          ...parsedLabels,
          'kubernetes.io/metadata.name': name,
          'tower.io/managed': 'true',
          'tower.io/creator': 'compute-tower',
          'tower.io/scenario': 'admin',
        };

    const payload = {
      apiVersion: 'v1',
      kind: 'Namespace',
      metadata: {
        name,
        labels,
        annotations: parsedAnnotations,
      },
    };

    setSubmitting(true);
    try {
      if (isEdit) {
        await updateHarvesterNamespace(cloudId, name, payload);
        message.success('更新成功');
      } else {
        await createHarvesterNamespace(cloudId, payload);
        message.success('创建成功');
      }
      clearGetCacheForPath(`/api/clouds/${cloudId}/resources/harvester/namespaces`);
      onCommitted?.();
      form.resetFields();
      onClose();
    } catch (e: unknown) {
      const err = e as { message?: string };
      message.error(err?.message || (isEdit ? '更新失败' : '创建失败'));
    } finally {
      setSubmitting(false);
    }
  };

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
                          rules={[
                            {
                              validator: async (_, value) => {
                                const k = String(value || '').trim();
                                if (!k) return;
                                if (k.length > 253) throw new Error('键最长 253 个字符');
                                if (/[\s=]/.test(k)) throw new Error('键不能包含空格或 =');
                              },
                            },
                          ]}
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
                          rules={[
                            {
                              validator: async (_, value) => {
                                const k = String(value || '').trim();
                                if (!k) return;
                                if (k.length > 253) throw new Error('键最长 253 个字符');
                                if (/[\s=]/.test(k)) throw new Error('键不能包含空格或 =');
                              },
                            },
                          ]}
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
