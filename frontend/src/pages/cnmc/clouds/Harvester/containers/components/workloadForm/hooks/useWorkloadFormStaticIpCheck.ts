import { useCallback, useState } from 'react';
import { App } from 'antd';
import type { FormInstance } from 'antd/es/form';

import { checkSubnetStaticIP } from '../../../../../../../../services/harvesterApi';
import { checkIpAvailability } from '../networkIpUtils';
import type { WorkloadFormSubnetOption } from './useWorkloadFormNetworkOptions';

export interface StaticIpCheckResult {
  checked: boolean;
  available: boolean;
  reason: string;
}

type UseWorkloadFormStaticIpCheckParams = {
  cloudId: string;
  form: FormInstance;
  flatSubnetOptions: WorkloadFormSubnetOption[];
  kubeSubnets: unknown[];
  selectedVpc?: string;
};

export function useWorkloadFormStaticIpCheck({
  cloudId,
  form,
  flatSubnetOptions,
  kubeSubnets,
  selectedVpc,
}: UseWorkloadFormStaticIpCheckParams) {
  const { message } = App.useApp();
  const [checkingStaticIP, setCheckingStaticIP] = useState(false);
  const [staticIPCheckResult, setStaticIPCheckResult] = useState<StaticIpCheckResult | null>(null);

  const handleCheckStaticIP = useCallback(async () => {
    const staticIP = form.getFieldValue('staticIP');
    const networkType = form.getFieldValue('networkType');

    if (!staticIP) {
      message.warning('请先输入静态 IP 地址');
      return;
    }

    const ipPattern = /^((25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(25[0-5]|2[0-4]\d|[01]?\d\d?)$/;
    if (!ipPattern.test(staticIP)) {
      message.error('请输入有效的 IPv4 地址');
      return;
    }

    let subnetName: string | undefined;
    let subnetNs = 'default';

    if (networkType === 'flat_subnet') {
      const flatSubnetValue = form.getFieldValue('flatSubnet');
      if (flatSubnetValue) {
        const parts = flatSubnetValue.split('/');
        if (parts.length === 2) {
          subnetNs = parts[0];
          subnetName = parts[1];
        } else {
          subnetName = flatSubnetValue;
        }
      }
    } else if (networkType === 'vpc') {
      const vpcSubnetValue = form.getFieldValue('vpcSubnet');
      if (vpcSubnetValue) {
        const parts = vpcSubnetValue.split('/');
        if (parts.length === 2) {
          subnetNs = parts[0];
          subnetName = parts[1];
        } else {
          subnetName = vpcSubnetValue;
        }
      }
    }

    if (!subnetName) {
      message.warning('请先选择子网');
      return;
    }

    setCheckingStaticIP(true);

    try {
      const res = await checkSubnetStaticIP(cloudId, subnetNs, subnetName, staticIP);
      const data = (res as { data?: { used?: boolean; usedBy?: string } })?.data || res;
      const used = (data as { used?: boolean })?.used === true;
      const usedBy = (data as { usedBy?: string })?.usedBy || '';

      setStaticIPCheckResult({
        checked: true,
        available: !used,
        reason: used ? `IP 已被使用（被 ${usedBy} 占用）` : 'IP 可用，未被其他工作负载使用',
      });

      if (used) {
        message.error(`IP ${staticIP} 已被使用（被 ${usedBy} 占用）`);
      } else {
        message.success('IP 可用');
      }
    } catch (e: unknown) {
      console.warn('静态IP检测API调用失败，回退到本地检测:', e);
      let currentSubnet: unknown = null;

      if (networkType === 'flat_subnet') {
        const flatSubnetValue = form.getFieldValue('flatSubnet');
        const flatSubnetOption = flatSubnetOptions.find((opt) => opt.value === flatSubnetValue);
        currentSubnet = flatSubnetOption?.subnet;
      } else if (networkType === 'vpc') {
        const vpcSubnetValue = form.getFieldValue('vpcSubnet');
        if (vpcSubnetValue) {
          const parts = vpcSubnetValue.split('/');
          const sn = parts.length === 2 ? parts[1] : parts[0];
          currentSubnet = (kubeSubnets as Array<Record<string, unknown>>).find((s) => {
            const name = (s.name as string) || (s?.metadata as { name?: string })?.name;
            const vpc = (s.vpc as string) || (s?.spec as { vpc?: string })?.vpc;
            return name === sn && vpc === selectedVpc;
          });
        }
      }

      if (currentSubnet) {
        const result = checkIpAvailability(staticIP, currentSubnet);
        setStaticIPCheckResult({
          checked: true,
          available: result.available,
          reason: result.reason,
        });
        if (!result.available) {
          message.error(result.reason);
        } else {
          message.success(result.reason);
        }
      } else {
        setStaticIPCheckResult({
          checked: true,
          available: false,
          reason: '检测失败：无法获取子网信息',
        });
        message.error('IP检测失败：无法获取子网信息');
      }
    } finally {
      setCheckingStaticIP(false);
    }
  }, [cloudId, form, flatSubnetOptions, kubeSubnets, selectedVpc, message]);

  return {
    checkingStaticIP,
    staticIPCheckResult,
    setStaticIPCheckResult,
    handleCheckStaticIP,
  };
}
