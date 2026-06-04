/**
 * 虚拟机 · 部署集选择（创建向导 / 变配共用）
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Form, Select } from 'antd';
import {
  fetchDeploymentSetOverview,
  type DeploymentSetRow,
} from 'services/harvester/deploymentSets';
import {
  applyDeploymentSetToWizardForm,
  buildDeploymentSetSelectOptions,
  findDeploymentSetById,
} from '../lib/vmDeploymentSet';
import { applyDeploymentSetExclusive } from '../lib/vmSchedulingExclusion';

export type VmDeploymentSetFieldProps = {
  cloudId: string | undefined;
  form: { setFieldsValue: (v: Record<string, unknown>) => void; getFieldValue?: (name: string) => unknown };
  /** 指定主机、指标自动调度等场景下不可用 */
  disabled?: boolean;
  disabledReason?: string;
  /** 变配时传入，用于初始化 */
  initialSetId?: string;
  onSetsLoaded?: (sets: DeploymentSetRow[]) => void;
};

const VmDeploymentSetField: React.FC<VmDeploymentSetFieldProps> = ({
  cloudId,
  form,
  disabled = false,
  disabledReason = '当前模式下不支持部署集',
  initialSetId,
  onSetsLoaded,
}) => {
  const [sets, setSets] = useState<DeploymentSetRow[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!cloudId || cloudId === 'all') {
      setSets([]);
      applyDeploymentSetToWizardForm(form, null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    void fetchDeploymentSetOverview(cloudId)
      .then((json: unknown) => {
        if (cancelled) return;
        const deploymentSets = (json as { data?: { deploymentSets?: DeploymentSetRow[] } })?.data
          ?.deploymentSets;
        const list = Array.isArray(deploymentSets) ? deploymentSets : [];
        setSets(list);
        onSetsLoaded?.(list);
      })
      .catch(() => {
        if (!cancelled) setSets([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [cloudId, onSetsLoaded, form]);

  useEffect(() => {
    if (!disabled) return;
    applyDeploymentSetToWizardForm(form, null);
  }, [disabled, form]);

  useEffect(() => {
    if (disabled || !initialSetId || !sets.length) return;
    const current = form.getFieldValue?.('deploymentSetId');
    if (current) return;
    form.setFieldsValue({ deploymentSetId: initialSetId });
  }, [initialSetId, sets, form]);

  const options = useMemo(() => buildDeploymentSetSelectOptions(sets), [sets]);

  if (disabled) {
    return (
      <Form.Item name="deploymentSetId" label="部署集" preserve>
        <Select disabled placeholder={disabledReason} options={[]} />
      </Form.Item>
    );
  }

  return (
    <Form.Item name="deploymentSetId" label="部署集" preserve>
      <Select
        allowClear
        showSearch
        loading={loading}
        placeholder="未选择部署集"
        options={options}
        optionFilterProp="label"
        onChange={(value) => {
          const set = findDeploymentSetById(sets, value as string | undefined);
          applyDeploymentSetExclusive(form, set);
        }}
      />
    </Form.Item>
  );
};

export default VmDeploymentSetField;
