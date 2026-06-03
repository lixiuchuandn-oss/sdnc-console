import React from 'react';
import { Alert } from 'antd';
import type { HarvesterAddonFormValues } from '../../hooks/harvesterAddonFormTypes';
import ConfigSummaryDescriptions from './ConfigSummaryDescriptions';

export type AddonSubmitConfirmExtraProps = {
  values: HarvesterAddonFormValues;
  blockDevicesRaw: unknown;
};

export function AddonSubmitConfirmExtra({ values, blockDevicesRaw }: AddonSubmitConfirmExtraProps) {
  const hasExpertYaml = !!String(values.valuesContentOverride || '').trim();
  if (hasExpertYaml) {
    return (
      <Alert
        type="warning"
        showIcon
        style={{ marginBottom: 16 }}
        message="将使用专家模式 YAML 提交"
        description="向导中的选项将被忽略，请确认 YAML 内容正确。"
      />
    );
  }
  return (
    <div style={{ marginBottom: 16 }}>
      <ConfigSummaryDescriptions values={values} blockDevicesRaw={blockDevicesRaw} column={1} />
    </div>
  );
}

export function buildAddonSubmitConfirmExtra(
  values: HarvesterAddonFormValues,
  blockDevicesRaw: unknown,
): React.ReactNode {
  return <AddonSubmitConfirmExtra values={values} blockDevicesRaw={blockDevicesRaw} />;
}
