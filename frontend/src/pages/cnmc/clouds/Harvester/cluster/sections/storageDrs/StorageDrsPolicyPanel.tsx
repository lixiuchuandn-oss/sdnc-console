import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Col,
  Descriptions,
  Form,
  InputNumber,
  Row,
  Select,
  Switch,
  Tag,
  Typography,
  message,
} from 'antd';
import FormSection from '../../../ceph/sections/harvesterAddon/FormSection';
import HarvesterAddonOperateTabShell, {
  OperateTabRefreshButton,
} from '../../../ceph/sections/harvesterAddon/HarvesterAddonOperateTabShell';
import {
  OPERATE_TAB_EXTRA_ALERT_STYLE,
  OPERATE_TAB_FIELD_COL_PROPS,
  OPERATE_TAB_FIELD_ROW_GUTTER,
} from '../../../ceph/sections/harvesterAddon/addonUiConstants';
import {
  SDRS_MODE_LABELS,
  updateSdrsPolicy,
  type SdrsMode,
  type SdrsPolicy,
  type SdrsOverview,
} from 'services/harvester/storageDrs';
import { confirmHighRiskOperation } from '../../../shared/lib/highRiskConfirm';
import { SDRS_POLICY_RISK_ITEMS } from '../../../shared/lib/highRiskOperationPresets';

export type StorageDrsPolicyPanelProps = {
  cloudId: string;
  canWrite: boolean;
  loading: boolean;
  overview: SdrsOverview | null;
  onRefresh: (force?: boolean) => void | Promise<void>;
};

const StorageDrsPolicyPanel: React.FC<StorageDrsPolicyPanelProps> = ({
  cloudId,
  canWrite,
  loading,
  overview,
  onRefresh,
}) => {
  const [policySaving, setPolicySaving] = useState(false);
  const [form] = Form.useForm<SdrsPolicy>();

  const policy = overview?.policy;
  const cephReady = overview?.cephReady;

  useEffect(() => {
    if (!policy) return;
    form.setFieldsValue(policy);
  }, [policy, form]);

  const handleRefresh = useCallback(() => {
    void onRefresh(true);
  }, [onRefresh]);

  const handleSavePolicyClick = useCallback(async () => {
    if (!canWrite) return;
    try {
      const values = await form.validateFields();
      void confirmHighRiskOperation({
        title: '确认保存策略',
        description: '保存后将更新存储智能调度策略，请确认参数无误并了解以下风险：',
        riskItems: SDRS_POLICY_RISK_ITEMS,
        confirmDanger: false,
        confirmText: '保存策略',
        impactAckLabel: '我已阅读并理解上述风险',
        onConfirm: async () => {
          setPolicySaving(true);
          try {
            await updateSdrsPolicy(cloudId, values);
            message.success('策略已保存');
            void onRefresh(true);
          } catch (e: unknown) {
            const err = e as { message?: string };
            message.error(err?.message || '保存失败');
            throw e;
          } finally {
            setPolicySaving(false);
          }
        },
      }).catch(() => {
        /* 用户取消 */
      });
    } catch (e: unknown) {
      const err = e as { errorFields?: unknown[] };
      if (err?.errorFields) return;
    }
  }, [canWrite, cloudId, form, onRefresh]);

  const extraAlerts = useMemo(() => {
    if (!cephReady || cephReady.toolboxAvailable) return null;
    return (
      <Alert
        type="warning"
        showIcon
        style={OPERATE_TAB_EXTRA_ALERT_STYLE}
        message={cephReady.message || '存储运维工具未就绪，手动迁盘可能失败'}
      />
    );
  }, [cephReady]);

  return (
    <HarvesterAddonOperateTabShell
      infoMessage="配置存储智能调度开关、触发阈值与迁盘条件。"
      alertActions={
        <OperateTabRefreshButton loading={loading} onClick={handleRefresh} />
      }
      extraAlerts={extraAlerts}
      submit={{
        label: '保存策略',
        loading: policySaving,
        canWrite,
        onClick: () => void handleSavePolicyClick(),
      }}
    >
      <Form form={form} layout="vertical" disabled={!canWrite} requiredMark={false}>
        <FormSection title="基本设置">
          <Row gutter={OPERATE_TAB_FIELD_ROW_GUTTER}>
            <Col {...OPERATE_TAB_FIELD_COL_PROPS}>
              <Form.Item
                name="enabled"
                label="启用存储智能调度"
                valuePropName="checked"
                tooltip="关闭后仅保留任务记录与手动迁移，不触发自动调度"
              >
                <Switch checkedChildren="开" unCheckedChildren="关" />
              </Form.Item>
            </Col>
            <Col {...OPERATE_TAB_FIELD_COL_PROPS}>
              <Form.Item
                name="mode"
                label="调度模式"
                tooltip="M1 支持手动与策略配置；全自动调度将在后续版本开放"
              >
                <Select
                  options={(Object.entries(SDRS_MODE_LABELS) as [SdrsMode, string][]).map(
                    ([value, label]) => ({ value, label }),
                  )}
                />
              </Form.Item>
            </Col>
          </Row>
        </FormSection>

        <FormSection title="触发阈值">
          <Row gutter={OPERATE_TAB_FIELD_ROW_GUTTER}>
            <Col {...OPERATE_TAB_FIELD_COL_PROPS}>
              <Form.Item
                name="capacityThresholdPct"
                label="容量阈值"
                tooltip="存储池使用率超过该比例时可触发迁盘建议（半自动/自动模式）"
              >
                <InputNumber min={50} max={99} precision={0} suffix="%" />
              </Form.Item>
            </Col>
            <Col {...OPERATE_TAB_FIELD_COL_PROPS}>
              <Form.Item
                name="latencyThresholdMs"
                label="时延阈值"
                tooltip="块设备 IO 时延超过该值时可触发迁盘建议（半自动/自动模式）"
              >
                <InputNumber min={1} max={500} precision={0} suffix="ms" />
              </Form.Item>
            </Col>
          </Row>
        </FormSection>

        <FormSection
          title="存储就绪状态"
          extra={
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              迁盘所需集群组件是否可用
            </Typography.Text>
          }
        >
          <Descriptions column={{ xs: 1, sm: 2 }} size="small">
            <Descriptions.Item label="存储监控">
              {cephReady?.dashboardAvailable ? (
                <Tag color="success">可用</Tag>
              ) : (
                <Tag>不可用</Tag>
              )}
            </Descriptions.Item>
            <Descriptions.Item label="迁盘工具">
              {cephReady?.toolboxAvailable ? (
                <Typography.Text>
                  {cephReady.toolboxNamespace}/{cephReady.toolboxPod}
                </Typography.Text>
              ) : (
                <Typography.Text type="secondary">未检测到运维工具 Pod</Typography.Text>
              )}
            </Descriptions.Item>
            <Descriptions.Item label="存储池数量">{overview?.pools?.length ?? 0}</Descriptions.Item>
          </Descriptions>
        </FormSection>
      </Form>
    </HarvesterAddonOperateTabShell>
  );
};

export default StorageDrsPolicyPanel;
