/**
 * Ceph 专用存储网（Harvester Setting `ceph-storage-network`，名称固定）。
 * 未配置时部署统一存储走管理网 mgmt。
 */
import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useState } from 'react';
import {
  Button,
  Card,
  Col,
  Form,
  Input,
  InputNumber,
  Row,
  Select,
  Space,
  Switch,
  Tag,
  Typography,
  message,
} from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { fetchHarvesterClusterNetworks } from '../../../../../../../services/harvester/cluster';
import {
  applyCephStorageNetwork,
  fetchCephStorageNetwork,
  type CephStorageNetworkResponse,
} from '../../../../../../../services/cephApi';
import {
  clusterNetworkDisplayName,
  extractHarvesterClusterNetworkItems,
} from '../../../nad/lib/nadCreateModalUtils';
import {
  formValuesFromEffective,
  formValuesToConfig,
  storageNetworkModeLabel,
  storageNetworkModeTagColor,
  validateCephStorageNetworkForm,
  type CephStorageNetworkFormValues,
} from '../../lib/cephStorageNetwork';
import FormSection from './FormSection';

export type CephStorageNetworkEditorHandle = {
  validateAndSave: () => Promise<boolean>;
  reload: () => Promise<void>;
};

export type CephStorageNetworkCardProps = {
  cloudId: string;
  /** 已部署成功时只读展示 */
  readOnly?: boolean;
  /** card：页顶独立卡片；wizard：向导步骤内嵌 */
  variant?: 'card' | 'wizard';
  onSaved?: () => void;
};

const CephStorageNetworkCard = forwardRef<CephStorageNetworkEditorHandle, CephStorageNetworkCardProps>(
  ({ cloudId, readOnly = false, variant = 'card', onSaved }, ref) => {
    const [form] = Form.useForm<CephStorageNetworkFormValues>();
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [effective, setEffective] = useState<CephStorageNetworkResponse | null>(null);
    const [clusterNetworks, setClusterNetworks] = useState<{ label: string; value: string }[]>([]);

    const enabled = Form.useWatch('enabled', form);
    const isWizard = variant === 'wizard';

    const loadClusterNetworks = useCallback(async () => {
      if (!cloudId) return;
      try {
        const res = await fetchHarvesterClusterNetworks(cloudId, true);
        const items = extractHarvesterClusterNetworkItems(res);
        const options = items
          .map((cn) => {
            const o = cn as Record<string, unknown>;
            const md = (o.metadata || {}) as Record<string, unknown>;
            const name = String(md.name ?? o.name ?? '').trim();
            if (!name) return null;
            return { value: name, label: clusterNetworkDisplayName(name) };
          })
          .filter(Boolean) as { label: string; value: string }[];
        setClusterNetworks(options);
      } catch {
        setClusterNetworks([]);
      }
    }, [cloudId]);

    const load = useCallback(async () => {
      if (!cloudId) return;
      setLoading(true);
      try {
        const res = await fetchCephStorageNetwork(cloudId, { force: true });
        if (res.ok && res.data) {
          setEffective(res.data);
          form.setFieldsValue(formValuesFromEffective(res.data));
        } else {
          setEffective(null);
          form.setFieldsValue(formValuesFromEffective(null));
        }
      } finally {
        setLoading(false);
      }
    }, [cloudId, form]);

    useEffect(() => {
      void load();
      void loadClusterNetworks();
    }, [load, loadClusterNetworks]);

    const mode = effective?.mode ?? 'mgmt';

    const summaryExtra = useMemo(() => {
      if (mode !== 'configured' || !effective?.config) return null;
      const c = effective.config;
      return (
        <Typography.Text type="secondary" style={{ fontSize: 13 }}>
          VLAN {c.vlan} · {c.clusterNetwork} · {c.range}
        </Typography.Text>
      );
    }, [effective?.config, mode]);

    const validateAndSave = useCallback(async (): Promise<boolean> => {
      if (!cloudId || readOnly) return true;
      try {
        const enabledNow = !!form.getFieldValue('enabled');
        const values = enabledNow
          ? await form.validateFields()
          : ({ enabled: false } as CephStorageNetworkFormValues);
        const validationError = validateCephStorageNetworkForm(values);
        if (validationError) {
          message.warning(validationError);
          return false;
        }
        setSaving(true);
        const config = formValuesToConfig(values);
        const res = await applyCephStorageNetwork(cloudId, {
          enabled: !!values.enabled,
          config: values.enabled ? config : null,
        });
        if (!res.ok || !res.data) {
          message.error(res.error || '保存存储网配置失败');
          return false;
        }
        setEffective(res.data);
        form.setFieldsValue(formValuesFromEffective(res.data));
        if (!isWizard) {
          message.success(
            values.enabled ? '已保存专用存储网配置' : '已清除配置，部署时将使用默认管理网络',
          );
        }
        onSaved?.();
        return true;
      } catch {
        return false;
      } finally {
        setSaving(false);
      }
    }, [cloudId, form, isWizard, onSaved, readOnly]);

    useImperativeHandle(ref, () => ({ validateAndSave, reload: load }), [load, validateAndSave]);

    const statusExtra = (
      <Space wrap>
        <Tag color={storageNetworkModeTagColor(mode)}>{storageNetworkModeLabel(mode)}</Tag>
        <Button
          type="text"
          size="small"
          icon={<ReloadOutlined />}
          loading={loading}
          onClick={() => void load()}
        />
      </Space>
    );

    const formBody = (
      <>
        {summaryExtra ? <div style={{ marginBottom: 12 }}>{summaryExtra}</div> : null}
        <Form form={form} layout="vertical" disabled={readOnly || loading || saving}>
          <Form.Item
            name="enabled"
            valuePropName="checked"
            label="启用专用存储网"
            style={{ marginBottom: 12 }}
          >
            <Switch checkedChildren="是" unCheckedChildren="否" />
          </Form.Item>
          {enabled ? (
            <Row gutter={[16, 0]}>
              <Col xs={24} sm={8}>
                <Form.Item
                  name="vlan"
                  label="VLAN ID"
                  rules={[{ required: true, message: '请输入 VLAN' }]}
                >
                  <InputNumber min={1} max={4094} style={{ width: '100%' }} placeholder="如 100" />
                </Form.Item>
              </Col>
              <Col xs={24} sm={8}>
                <Form.Item
                  name="clusterNetwork"
                  label="集群网络"
                  rules={[{ required: true, message: '请选择集群网络' }]}
                >
                  <Select
                    showSearch
                    optionFilterProp="label"
                    placeholder="选择 ClusterNetwork"
                    options={clusterNetworks}
                    notFoundContent="请先在集群网络中创建"
                  />
                </Form.Item>
              </Col>
              <Col xs={24} sm={8}>
                <Form.Item
                  name="range"
                  label="IP 段（CIDR）"
                  rules={[{ required: true, message: '请输入 CIDR' }]}
                  extra="勿与 K8s 保留网段重叠"
                >
                  <Input placeholder="如 176.11.0.0/24" />
                </Form.Item>
              </Col>
            </Row>
          ) : (
            <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>
              未启用时，统一存储将使用默认管理网络。
            </Typography.Text>
          )}
          {!readOnly && !isWizard ? (
            <Button type="primary" loading={saving} onClick={() => void validateAndSave()}>
              保存存储网配置
            </Button>
          ) : null}
        </Form>
      </>
    );

    if (isWizard) {
      return (
        <FormSection
          title="专用存储网"
          description="可按需为统一存储单独规划网络；不启用则与集群管理网络共用。"
          extra={statusExtra}
        >
          {formBody}
        </FormSection>
      );
    }

    return (
      <Card
        size="small"
        title="专用存储网"
        style={{ marginBottom: 16 }}
        extra={statusExtra}
      >
        {formBody}
      </Card>
    );
  },
);

CephStorageNetworkCard.displayName = 'CephStorageNetworkCard';

export default CephStorageNetworkCard;
