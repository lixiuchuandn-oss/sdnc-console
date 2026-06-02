import { checkSubnetStaticIP } from '../../../../../../../../services/harvesterApi';
import { isIpInCidr } from '../networkIpUtils';
import type { WorkloadFormSubnetOption } from '../hooks/useWorkloadFormNetworkOptions';
import type { WorkloadContainerFormValue, WorkloadFormValues } from '../types';
import type { WorkloadEditorRefValidation, WorkloadSubmitFailure } from './types';

export function validateContainerImages(
  containers: WorkloadContainerFormValue[],
): WorkloadSubmitFailure | null {
  const invalidContainerIndex = containers.findIndex((container) => !container.image);
  if (invalidContainerIndex < 0) return null;
  return {
    severity: 'error',
    message: `请完善容器 ${invalidContainerIndex + 1} 的镜像地址`,
    action: {
      type: 'set_step_and_container',
      step: 1,
      containerIndex: invalidContainerIndex,
      container: containers[invalidContainerIndex],
    },
  };
}

export function validateDuplicateContainerNames(
  containers: WorkloadContainerFormValue[],
): WorkloadSubmitFailure | null {
  const containerNames = containers
    .map((c) => c.containerName)
    .filter((name) => name && name.trim());
  const duplicateNames = containerNames.filter(
    (name, index) => containerNames.indexOf(name) !== index,
  );
  if (duplicateNames.length === 0) return null;
  return {
    severity: 'error',
    message: `容器名称重复: ${[...new Set(duplicateNames)].join(', ')}，请使用不同的容器名称`,
    action: { type: 'set_step', step: 1 },
  };
}

export function validateVolumesHaveMounts(syncedValues: WorkloadFormValues): WorkloadSubmitFailure | null {
  const volumes = syncedValues.volumes || [];
  const volumeMounts = syncedValues.volumeMounts || [];
  if (volumes.length > 0 && volumeMounts.length === 0) {
    return {
      severity: 'warning',
      message: '已定义存储卷，请配置至少一个卷挂载',
      action: { type: 'set_step', step: 3 },
    };
  }
  return null;
}

export function validateWorkloadEditorRefs(
  refs: WorkloadEditorRefValidation,
): WorkloadSubmitFailure | null {
  const hasErrors =
    refs.nodeAffinity ||
    refs.nodeAntiAffinity ||
    refs.podAffinity ||
    refs.podAntiAffinity ||
    refs.tolerations;
  if (!hasErrors) return null;
  return {
    severity: 'error',
    message: '',
    action: { type: 'set_step', step: 4 },
  };
}

function resolveSubnetCidr(params: {
  syncedValues: WorkloadFormValues;
  flatSubnetOptions: WorkloadFormSubnetOption[];
  kubeSubnets: unknown[];
}): string | undefined {
  const { syncedValues, flatSubnetOptions, kubeSubnets } = params;
  const networkType = syncedValues.networkType;

  if (networkType === 'flat_subnet' && syncedValues.flatSubnet) {
    const flatSubnetOption = flatSubnetOptions.find((opt) => opt.value === syncedValues.flatSubnet);
    return flatSubnetOption?.subnet?.cidr || flatSubnetOption?.subnet?.spec?.cidrBlock;
  }

  if (networkType === 'vpc' && syncedValues.vpcSubnet) {
    const parts = syncedValues.vpcSubnet.split('/');
    const subnetName = parts.length === 2 ? parts[1] : parts[0];
    const subnet = kubeSubnets.find((item) => {
      const s = item as Record<string, unknown>;
      const spec = (s.spec ?? {}) as Record<string, unknown>;
      const name = (s.name as string | undefined) ?? (s.metadata as { name?: string } | undefined)?.name;
      const vpc = (s.vpc as string | undefined) ?? spec.vpc;
      return name === subnetName && vpc === syncedValues.vpcName;
    }) as Record<string, unknown> | undefined;
    const spec = (subnet?.spec ?? {}) as Record<string, unknown>;
    return (subnet?.cidr as string | undefined) ?? (spec.cidrBlock as string | undefined);
  }

  return undefined;
}

function resolveSubnetNameAndNamespace(syncedValues: WorkloadFormValues): {
  subnetName?: string;
  subnetNs: string;
} {
  const networkType = syncedValues.networkType;
  let subnetName: string | undefined;
  let subnetNs = 'default';

  if (networkType === 'flat_subnet' && syncedValues.flatSubnet) {
    const flatParts = syncedValues.flatSubnet.split('/');
    if (flatParts.length === 2) {
      subnetNs = flatParts[0];
      subnetName = flatParts[1];
    } else {
      subnetName = syncedValues.flatSubnet;
    }
  } else if (networkType === 'vpc' && syncedValues.vpcSubnet) {
    const vpcParts = syncedValues.vpcSubnet.split('/');
    if (vpcParts.length === 2) {
      subnetNs = vpcParts[0];
      subnetName = vpcParts[1];
    } else {
      subnetName = syncedValues.vpcSubnet;
    }
  }

  return { subnetName, subnetNs };
}

export async function validateWorkloadStaticIp(params: {
  cloudId: string;
  syncedValues: WorkloadFormValues;
  flatSubnetOptions: WorkloadFormSubnetOption[];
  kubeSubnets: unknown[];
  confirmOnApiFailure: (staticIP: string) => Promise<boolean>;
}): Promise<WorkloadSubmitFailure | null> {
  const { cloudId, syncedValues, flatSubnetOptions, kubeSubnets, confirmOnApiFailure } = params;
  if (!syncedValues.enableStaticIP || !syncedValues.staticIP) {
    return null;
  }

  const subnetCidr = resolveSubnetCidr({ syncedValues, flatSubnetOptions, kubeSubnets });
  if (subnetCidr && !isIpInCidr(syncedValues.staticIP, subnetCidr)) {
    return {
      severity: 'error',
      message: `静态 IP ${syncedValues.staticIP} 不在子网 CIDR 范围 ${subnetCidr} 内，请检查`,
      action: { type: 'set_step', step: 2 },
    };
  }

  const { subnetName, subnetNs } = resolveSubnetNameAndNamespace(syncedValues);
  if (!subnetName) {
    return null;
  }

  try {
    const ipCheckRes = await checkSubnetStaticIP(
      cloudId,
      subnetNs,
      subnetName,
      syncedValues.staticIP,
    );
    const ipCheckData = (ipCheckRes as { data?: { used?: boolean; usedBy?: string } })?.data ?? ipCheckRes;
    if ((ipCheckData as { used?: boolean })?.used === true) {
      const usedBy = (ipCheckData as { usedBy?: string }).usedBy || '其他工作负载';
      return {
        severity: 'error',
        message: `静态 IP ${syncedValues.staticIP} 已被使用（被 ${usedBy} 占用）`,
        action: { type: 'set_step', step: 2 },
      };
    }
  } catch (e: unknown) {
    console.warn('静态IP检测API调用失败:', e);
    const confirmed = await confirmOnApiFailure(syncedValues.staticIP);
    if (!confirmed) {
      return {
        severity: 'error',
        message: '已取消提交',
        action: { type: 'set_step', step: 2 },
      };
    }
  }

  return null;
}
