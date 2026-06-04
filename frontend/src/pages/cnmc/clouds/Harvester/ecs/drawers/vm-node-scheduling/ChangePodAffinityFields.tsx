/**
 * 虚拟机 · 部署集变配表单。
 */
import React, { useEffect } from 'react';
import { Alert } from 'antd';
import VmDeploymentSetField from '../../lib/VmDeploymentSetField';
import { isVmFixedHostScheduling, readVmDeploymentSetId } from '../../lib/vmDeploymentSet';
import { readVmMetricAutoScheduled } from '../../lib/vmSchedulingExclusion';
import type { DeploymentSetRow } from 'services/harvester/deploymentSets';

type Props = {
  form: any;
  record: any;
  cloudId: string;
  onDeploymentSetsLoaded?: (sets: DeploymentSetRow[]) => void;
};

const ChangePodAffinityFields: React.FC<Props> = ({
  form,
  record,
  cloudId,
  onDeploymentSetsLoaded,
}) => {
  const initialSetId = readVmDeploymentSetId(record);
  const fixedHost = isVmFixedHostScheduling(record);
  const metricAutoScheduled = readVmMetricAutoScheduled(record);

  useEffect(() => {
    if (!record) return;
    form.setFieldsValue({
      deploymentSetId: fixedHost ? undefined : initialSetId,
    });
  }, [record, form, initialSetId, fixedHost]);

  return (
    <>
      {metricAutoScheduled && !fixedHost ? (
        <Alert
          type="info"
          showIcon
          message="该虚拟机已参与指标自动调度。保存部署集后将自动移除指标自动调度配置。"
          style={{ marginBottom: 12 }}
        />
      ) : null}
      <VmDeploymentSetField
        cloudId={cloudId}
        form={form}
        disabled={fixedHost}
        disabledReason="指定主机模式下不支持部署集"
        initialSetId={fixedHost ? undefined : initialSetId}
        onSetsLoaded={onDeploymentSetsLoaded}
      />
    </>
  );
};

export default ChangePodAffinityFields;
