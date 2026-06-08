/**
 * 虚拟机 · 部署集选择（创建向导 / 变配共用）
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Form, Select } from 'antd';
import type { FormInstance } from 'antd/es/form';
import {
  fetchDeploymentSetOverview,
  type DeploymentSetRow,
} from 'services/harvester/deploymentSets';
import {
  applyDeploymentSetToWizardForm,
  buildDeploymentSetSelectOptions,
  filterDeploymentSetsByProjectNamespace,
  findDeploymentSetById,
} from '../lib/vmDeploymentSet';
import { applyDeploymentSetExclusive } from '../lib/vmSchedulingExclusion';

export type VmDeploymentSetFieldProps = {
  cloudId: string | undefined;
  form: FormInstance;
  /** 业务项目（namespace）；未传时从表单 namespace 字段读取 */
  projectNamespace?: string;
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
  projectNamespace: projectNamespaceProp,
  disabled = false,
  disabledReason = '当前模式下不支持部署集',
  initialSetId,
  onSetsLoaded,
}) => {
  const [sets, setSets] = useState<DeploymentSetRow[]>([]);
  const [loading, setLoading] = useState(false);
  const watchedNamespace = Form.useWatch('namespace', form);
  const effectiveProjectNamespace = String(
    projectNamespaceProp ?? watchedNamespace ?? '',
  ).trim();
  const visibleSets = useMemo(
    () => filterDeploymentSetsByProjectNamespace(sets, effectiveProjectNamespace),
    [sets, effectiveProjectNamespace],
  );

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
    if (disabled || !initialSetId || !visibleSets.length) return;
    const current = form.getFieldValue?.('deploymentSetId');
    if (current) return;
    if (!findDeploymentSetById(visibleSets, initialSetId)) return;
    form.setFieldsValue({ deploymentSetId: initialSetId });
  }, [disabled, initialSetId, visibleSets, form]);

  useEffect(() => {
    if (disabled) return;
    const currentId = form.getFieldValue?.('deploymentSetId');
    if (!currentId) return;
    if (!findDeploymentSetById(visibleSets, String(currentId))) {
      applyDeploymentSetToWizardForm(form, null);
    }
  }, [disabled, visibleSets, form]);

  const options = useMemo(
    () => buildDeploymentSetSelectOptions(visibleSets),
    [visibleSets],
  );

  const selectPlaceholder = !effectiveProjectNamespace
    ? '请先选择项目'
    : visibleSets.length
      ? '未选择部署集'
      : '当前项目下暂无可用部署集';

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
        placeholder={selectPlaceholder}
        options={options}
        optionFilterProp="label"
        onChange={(value) => {
          const set = findDeploymentSetById(visibleSets, value as string | undefined);
          applyDeploymentSetExclusive(form, set);
        }}
      />
    </Form.Item>
  );
};

export default VmDeploymentSetField;
