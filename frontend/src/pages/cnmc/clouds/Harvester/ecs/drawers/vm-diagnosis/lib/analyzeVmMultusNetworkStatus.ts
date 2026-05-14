import type { DiagnosisResult } from "./diagnosisTypes";

/** 从 VM spec 提取 Multus 网络配置摘要 */
export function analyzeVmMultusNetworkStatus(
  vm: any,
): DiagnosisResult["networkStatus"] {
  if (!vm?.spec?.template?.spec?.networks) {
    return {
      multusNetworks: [],
      message: "未配置网络",
    };
  }

  const multusNetworks = vm.spec.template.spec.networks
    .filter((n: any) => n.multus)
    .map((n: any) => ({
      name: n.name,
      networkName: n.multus.networkName,
    }));

  return {
    multusNetworks,
    message:
      multusNetworks.length > 0
        ? `配置了 ${multusNetworks.length} 个 Multus 网络`
        : "未配置 Multus 网络",
  };
}
