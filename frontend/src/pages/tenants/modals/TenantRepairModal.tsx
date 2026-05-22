import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Descriptions, Form, Modal, Select, Spin, Typography } from 'antd';
import { fetchAvailableResourcePools, repairTenantsFromCrd } from '../../../services/api';
import { getCloudPoolDisplayProvider, isHarvesterLikeOperator } from '../lib/orgManagePoolHelpers';

export type TenantCrdRepairEntityCounter = {
  created: number;
  updated: number;
  skipped: number;
};

export type TenantCrdRepairResultPayload = {
  cloudId: string;
  cloudName: string;
  tenants: TenantCrdRepairEntityCounter;
  organizations: TenantCrdRepairEntityCounter;
  userSpaces: TenantCrdRepairEntityCounter;
  resourcePoolAssignments: TenantCrdRepairEntityCounter;
  userSpaceAllocations: TenantCrdRepairEntityCounter;
  warnings: string[];
};

type CloudPoolOption = {
  id: string;
  name: string;
  config?: { provider?: string };
  type?: string;
  status?: string;
};

export interface TenantRepairModalProps {
  open: boolean;
  onClose: () => void;
  onRepaired?: () => void;
}

function sumApplied(counter: TenantCrdRepairEntityCounter): number {
  return counter.created + counter.updated;
}

/** 租户列表 · 从 Cloudmap 资源池 IAM CRD 恢复租户数据 */
export default function TenantRepairModal({ open, onClose, onRepaired }: TenantRepairModalProps) {
  const [form] = Form.useForm<{ cloudId: string }>();
  const [loadingPools, setLoadingPools] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [pools, setPools] = useState<CloudPoolOption[]>([]);
  const [repairMessage, setRepairMessage] = useState<string | null>(null);
  const [repairResult, setRepairResult] = useState<TenantCrdRepairResultPayload | null>(null);
  const [errorText, setErrorText] = useState<string | null>(null);

  const loadPools = useCallback(async () => {
    setLoadingPools(true);
    try {
      const data = await fetchAvailableResourcePools();
      const list = (Array.isArray(data) ? data : []) as CloudPoolOption[];
      setPools(
        list.filter((p) => {
          const pv = String(p?.config?.provider ?? p?.type ?? '').trim().toLowerCase();
          return isHarvesterLikeOperator(pv) || pv === 'cloudmap.csm';
        }),
      );
    } catch {
      setPools([]);
    } finally {
      setLoadingPools(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    setRepairMessage(null);
    setRepairResult(null);
    setErrorText(null);
    form.resetFields();
    void loadPools();
  }, [open, form, loadPools]);

  const poolOptions = useMemo(
    () =>
      pools.map((p) => ({
        value: p.id,
        label: `${p.name} (${getCloudPoolDisplayProvider(p)})`,
        disabled: p.status === 'offline',
      })),
    [pools],
  );

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();
      setSubmitting(true);
      setErrorText(null);
      setRepairMessage(null);
      setRepairResult(null);

      const resp = (await repairTenantsFromCrd(values.cloudId)) as {
        message?: string;
        result?: TenantCrdRepairResultPayload;
      };

      setRepairMessage(resp?.message || '租户数据修复完成');
      setRepairResult(resp?.result ?? null);
      onRepaired?.();
    } catch (error: unknown) {
      const err = error as { message?: string };
      setErrorText(err?.message || '租户数据修复失败');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={open}
      title="租户数据修复"
      okText="开始恢复"
      cancelText={repairResult ? '关闭' : '取消'}
      width={640}
      destroyOnHidden
      confirmLoading={submitting}
      onCancel={onClose}
      onOk={() => {
        if (repairResult) {
          onClose();
          return;
        }
        void handleSubmit();
      }}
    >
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="从 Cloudmap 资源池恢复"
        description="将从所选资源池集群读取 iam.tower.io 租户域 CRD（Tenant / Organization / UserSpace），写回 Tower 本地数据库。仅恢复在该资源池上有 UserSpace 绑定的租户数据；不会删除本地已有记录。"
      />

      {loadingPools ? (
        <div style={{ textAlign: 'center', padding: 24 }}>
          <Spin />
        </div>
      ) : (
        <Form form={form} layout="vertical" preserve={false}>
          <Form.Item
            label="数据来源资源池"
            name="cloudId"
            rules={[{ required: true, message: '请选择资源池' }]}
          >
            <Select
              placeholder="选择已绑定过租户的 Cloudmap / Harvester 资源池"
              options={poolOptions}
              showSearch
              optionFilterProp="label"
              disabled={!!repairResult || submitting}
            />
          </Form.Item>
        </Form>
      )}

      {errorText ? (
        <Alert type="error" showIcon message={errorText} style={{ marginTop: 8 }} />
      ) : null}

      {repairMessage ? (
        <Alert type="success" showIcon message={repairMessage} style={{ marginTop: 8 }} />
      ) : null}

      {repairResult ? (
        <Descriptions bordered size="small" column={2} style={{ marginTop: 16 }}>
          <Descriptions.Item label="资源池" span={2}>
            {repairResult.cloudName}
          </Descriptions.Item>
          <Descriptions.Item label="租户">
            新增 {repairResult.tenants.created} / 更新 {repairResult.tenants.updated}
          </Descriptions.Item>
          <Descriptions.Item label="组织">
            新增 {repairResult.organizations.created} / 更新 {repairResult.organizations.updated}
          </Descriptions.Item>
          <Descriptions.Item label="资源空间">
            新增 {repairResult.userSpaces.created} / 更新 {repairResult.userSpaces.updated}
          </Descriptions.Item>
          <Descriptions.Item label="资源池分配">
            {sumApplied(repairResult.resourcePoolAssignments)} 条
          </Descriptions.Item>
        </Descriptions>
      ) : null}

      {repairResult?.warnings?.length ? (
        <div style={{ marginTop: 12 }}>
          <Typography.Text type="secondary">部分条目已跳过：</Typography.Text>
          <ul style={{ margin: '8px 0 0', paddingLeft: 20 }}>
            {repairResult.warnings.map((w) => (
              <li key={w}>
                <Typography.Text type="warning">{w}</Typography.Text>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </Modal>
  );
}
