import yaml from 'js-yaml';

/**
 * 从 VM 的 cloud-init volume 中解析 `networkData`（YAML），失败时返回空 ethernets 结构。
 * 用于读写静态 IP、网关、DNS 等。
 */
export function parseVmCloudInitNetworkData(vm: any) {
  try {
    const volumes = vm?.spec?.template?.spec?.volumes || [];
    const ciVol = volumes.find((v: any) => v.cloudInitNoCloud);
    if (ciVol && ciVol.cloudInitNoCloud.networkData) {
      return yaml.load(ciVol.cloudInitNoCloud.networkData) as any;
    }
  } catch (e) {
    console.warn('Failed to parse existing networkData', e);
  }
  return { network: { version: 2, ethernets: {} } };
}

/** 生成随机本地管理 MAC（52:54:00 前缀），用于静态 IP 且未指定 MAC 的网卡。 */
export function generateMacAddressForStaticNic() {
  const hex = '0123456789ABCDEF';
  let mac = '52:54:00';
  for (let i = 0; i < 3; i++) {
    mac += ':' + hex[Math.floor(Math.random() * 16)] + hex[Math.floor(Math.random() * 16)];
  }
  return mac;
}
