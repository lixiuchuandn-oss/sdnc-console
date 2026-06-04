import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Descriptions, Form, Modal, Radio, Select, Spin, Typography } from 'antd';
import {
  fetchAvailableResourcePools,
  repairTenantsFromCrd,
  repairTenantsFromCsm,
} from '../../../services/api';
import {
  getCloudPoolDisplayProvider,
  getCloudPoolProviderRaw,
  isHarvesterLikeOperator,
} from '../lib/orgManagePoolHelpers';

export type TenantRepairEntityCounter = {
  created: number;
  updated: number;
  skipped: number;
};

export type TenantCrdRepairResultPayload = {
  cloudId: string;
  cloudName: string;
  tenants: TenantRepairEntityCounter;
  organizations: TenantRepairEntityCounter;
  userSpaces: TenantRepairEntityCounter;
  resourcePoolAssignments: TenantRepairEntityCounter;
  userSpaceAllocations: TenantRepairEntityCounter;
  warnings: string[];
};

export type TenantCsmRepairResultPayload = {
  cloudId: string;
  cloudName: string;
  tenants: TenantRepairEntityCounter;
  organizations: TenantRepairEntityCounter;
  securityDomains: TenantRepairEntityCounter;
  leasedLines: TenantRepairEntityCounter;
  resourcePoolAssignments: TenantRepairEntityCounter;
  warnings: string[];
};

type RepairSource = 'csm' | 'crd';

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

function sumApplied(counter: TenantRepairEntityCounter): number {
  return counter.created + counter.updated;
}

function poolMatchesSource(pool: CloudPoolOption, source: RepairSource): boolean {
  const pv = getCloudPoolProviderRaw(pool);
  if (source === 'csm') return pv === 'cloudmap.csm';
  return isHarvesterLikeOperator(pv);
}

/** 租户列表 · 从 Cloudmap CRD 或 CSM API 恢复租户及相关数据 */
export default function TenantRepairModal({ open, onClose, onRepaired }: TenantRepairModalProps) {
  const [form] = Form.useForm<{ source: RepairSource; cloudId: string }>();
  const source = Form.useWatch('source', form) ?? 'csm';
  const [loadingPools, setLoadingPools] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [allPools, setAllPools] = useState<CloudPoolOption[]>([]);
  const [repairMessage, setRepairMessage] = useState<string | null>(null);
  const [crdResult, setCrdResult] = useState<TenantCrdRepairResultPayload | null>(null);
  const [csmResult, setCsmResult] = useState<TenantCsmRepairResultPayload | null>(null);
  const [errorText, setErrorText] = useState<string | null>(null);

  const loadPools = useCallback(async () => {
    setLoadingPools(true);
    try {
      const data = await fetchAvailableResourcePools();
      setAllPools((Array.isArray(data) ? data : []) as CloudPoolOption[]);
    } catch {
      setAllPools([]);
    } finally {
      setLoadingPools(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    setRepairMessage(null);
    setCrdResult(null);
    setCsmResult(null);
    setErrorText(null);
    form.setFieldsValue({ source: 'csm', cloudId: undefined });
    void loadPools();
  }, [open, form, loadPools]);

  const filteredPools = useMemo(
    () => allPools.filter((p) => poolMatchesSource(p, source)),
    [allPools, source],
  );

  const poolOptions = useMemo(
    () =>
      filteredPools.map((p) => ({
        value: p.id,
        label: `${p.name} (${getCloudPoolDisplayProvider(p)})`,
        disabled: p.status === 'offline',
      })),
    [filteredPools],
  );

  const repairDone = !!(crdResult || csmResult);

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();
      setSubmitting(true);
      setErrorText(null);
      setRepairMessage(null);
      setCrdResult(null);
      setCsmResult(null);

      if (values.source === 'csm') {
        const resp = (await repairTenantsFromCsm(values.cloudId)) as {
          message?: string;
          result?: TenantCsmRepairResultPayload;
        };
        setRepairMessage(resp?.message || 'CSM 租户数据恢复完成');
        setCsmResult(resp?.result ?? null);
      } else {
        const resp = (await repairTenantsFromCrd(values.cloudId)) as {
          message?: string;
          result?: TenantCrdRepairResultPayload;
        };
        setRepairMessage(resp?.message || '租户数据修复完成');
        setCrdResult(resp?.result ?? null);
      }
      onRepaired?.();
    } catch (error: unknown) {
      const err = error as { message?: string };
      setErrorText(err?.message || '租户数据恢复失败');
    } finally {
      setSubmitting(false);
    }
  };

  const alertCopy =
    source === 'csm'
      ? {
          message: '从 CSM 资源池恢复（SQLite 灾难恢复）',
          description:
            '将调用 CSM 租户分页与安全域查询接口，写回 Tower 本地库：租户、根组织、安全域（含 networkCidrs）、专线 IP 记录，并为组织绑定该 CSM 池。不会删除本地已有记录；可重复执行以增量对齐。',
        }
      : {
          message: '从 Cloudmap / Harvester 资源池恢复（IAM CRD）',
          description:
            '从所选计算类资源池读取 iam.tower.io 租户域 CRD（Tenant / Organization / UserSpace），写回 Tower 本地数据库。仅恢复在该资源池上有 UserSpace 绑定的租户；不会删除本地已有记录。',
        };

  return (
    <Modal
      open={open}
      title="租户数据修复"
      okText="开始恢复"
      cancelText={repairDone ? '关闭' : '取消'}
      width={680}
      destroyOnHidden
      confirmLoading={submitting}
      onCancel={onClose}
      onOk={() => {
        if (repairDone) {
          onClose();
          return;
        }
        void handleSubmit();
      }}
    >
      <Alert type="info" showIcon style={{ marginBottom: 16 }} {...alertCopy} />

      {loadingPools ? (
        <div style={{ textAlign: 'center', padding: 24 }}>
          <Spin />
        </div>
      ) : (
        <Form form={form} layout="vertical" preserve={false} initialValues={{ source: 'csm' }}>
          <Form.Item label="恢复来源" name="source" rules={[{ required: true }]}>
            <Radio.Group
              disabled={repairDone || submitting}
              onChange={() => form.setFieldValue('cloudId', undefined)}
            >
              <Radio.Button value="csm">CSM 资源池（API）</Radio.Button>
              <Radio.Button value="crd">Cloudmap / Harvester（CRD）</Radio.Button>
            </Radio.Group>
          </Form.Item>
          <Form.Item
            label="数据来源资源池"
            name="cloudId"
            rules={[{ required: true, message: '请选择资源池' }]}
          >
            <Select
              placeholder={
                source === 'csm'
                  ? '选择 CSM（cloudmap.csm）安全资源池'
                  : '选择已绑定过租户的 Cloudmap / Harvester 资源池'
              }
              options={poolOptions}
              showSearch
              optionFilterProp="label"
              disabled={repairDone || submitting}
              notFoundContent={filteredPools.length ? undefined : '暂无符合该恢复方式的资源池'}
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

      {crdResult ? (
        <Descriptions bordered size="small" column={2} style={{ marginTop: 16 }}>
          <Descriptions.Item label="资源池" span={2}>
            {crdResult.cloudName}
          </Descriptions.Item>
          <Descriptions.Item label="租户">
            新增 {crdResult.tenants.created} / 更新 {crdResult.tenants.updated}
          </Descriptions.Item>
          <Descriptions.Item label="组织">
            新增 {crdResult.organizations.created} / 更新 {crdResult.organizations.updated}
          </Descriptions.Item>
          <Descriptions.Item label="资源空间">
            新增 {crdResult.userSpaces.created} / 更新 {crdResult.userSpaces.updated}
          </Descriptions.Item>
          <Descriptions.Item label="资源池分配">
            {sumApplied(crdResult.resourcePoolAssignments)} 条
          </Descriptions.Item>
        </Descriptions>
      ) : null}

      {csmResult ? (
        <Descriptions bordered size="small" column={2} style={{ marginTop: 16 }}>
          <Descriptions.Item label="CSM 资源池" span={2}>
            {csmResult.cloudName}
          </Descriptions.Item>
          <Descriptions.Item label="租户">
            新增 {csmResult.tenants.created} / 更新 {csmResult.tenants.updated}
          </Descriptions.Item>
          <Descriptions.Item label="组织">
            新增 {csmResult.organizations.created} / 更新 {csmResult.organizations.updated}
          </Descriptions.Item>
          <Descriptions.Item label="安全域">
            新增 {csmResult.securityDomains.created} / 更新 {csmResult.securityDomains.updated}
          </Descriptions.Item>
          <Descriptions.Item label="专线 IP">
            新增 {csmResult.leasedLines.created} / 更新 {csmResult.leasedLines.updated}
          </Descriptions.Item>
          <Descriptions.Item label="CSM 池分配">
            {sumApplied(csmResult.resourcePoolAssignments)} 条
          </Descriptions.Item>
        </Descriptions>
      ) : null}

      {(crdResult?.warnings?.length || csmResult?.warnings?.length) ? (
        <div style={{ marginTop: 12 }}>
          <Typography.Text type="secondary">部分条目已跳过：</Typography.Text>
          <ul style={{ margin: '8px 0 0', paddingLeft: 20 }}>
            {(crdResult?.warnings ?? csmResult?.warnings ?? []).map((w) => (
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
