/**
 * 由「主网卡 + 辅卡行」表单值计算 interfaces / networks，并合并 cloud-init networkData（添加辅卡抽屉复用）。
 */
import { expectedMultusNadRefForSubnet } from '../../../lib/kubeOvnMultusNadRef';
import { allocateSecondaryNicNames } from '../../../lib/harvesterVmNetwork';

export type NicRecomputeResult = {
  interfaces: any[];
  networks: any[];
  /** 供 yaml.dump 写入 update-spec；结构与 parseVmCloudInitNetworkData 一致 */
  networkDataObj: any;
  hasNetworkDataChange: boolean;
};

function deepClone<T>(x: T): T {
  return JSON.parse(JSON.stringify(x)) as T;
}

function nadOptionsFromList(nads: any[]): { value: string }[] {
  return (Array.isArray(nads) ? nads : [])
    .map((n: any) => ({
      value: `${n?.metadata?.namespace || 'default'}/${n?.metadata?.name || ''}`,
    }))
    .filter((o) => o.value.length > 1 && !o.value.endsWith('/'));
}

function buildKubevirtIface(
  type: string,
  ifaceName: string,
  model?: string,
  mac?: string,
): any {
  const iface: any = {
    name: ifaceName,
    model: model || 'virtio',
  };
  const m = String(mac || '').trim();
  if (m) iface.macAddress = m;
  const t = String(type || 'bridge').toLowerCase();
  if (t === 'managedtap') iface.binding = { name: 'managedtap' };
  else if (t === 'bridge') iface.bridge = {};
  else if (t === 'masquerade') iface.masquerade = {};
  else if (t === 'sriov') iface.sriov = {};
  else if (t === 'macvtap') iface.macvtap = {};
  else iface.bridge = {};
  return iface;
}

/** multusName 为 null 时使用 Pod 网络 */
function buildNetworkEntry(ifaceName: string, multusName: string | null): any {
  if (!multusName) {
    return { name: ifaceName, pod: {} };
  }
  return { name: ifaceName, multus: { networkName: multusName } };
}

function resolveMultusForSecondary(
  mode: string,
  row: any,
  subnets: any[],
  nads: any[],
): string | null {
  const r = row || {};
  if (mode === 'flat') {
    const n = String(r.name || '').trim();
    return n || null;
  }
  if (mode === 'passthrough') {
    return String(r.name || '').trim() || null;
  }
  const subnetName = String(r.subnet || '').trim();
  if (!subnetName) return String(r.name || '').trim() || null;
  const vpc = r.vpc;
  const subnetObj = (subnets || []).find((s: any) => {
    const nm = s?.metadata?.name || s?.name;
    if (nm !== subnetName) return false;
    if (mode === 'vpc' && vpc != null && vpc !== '') {
      return String(s?.spec?.vpc || s?.vpc) === String(vpc);
    }
    return true;
  });
  const ref = subnetObj
    ? expectedMultusNadRefForSubnet(subnetObj, vpc, nadOptionsFromList(nads))
    : undefined;
  if (ref) return ref;
  return String(r.name || '').trim() || null;
}

function ensureNetworkDataShape(parsed: any): any {
  const base = deepClone(parsed || {});
  if (!base.network) base.network = {};
  if (base.network.version == null) base.network.version = 2;
  if (!base.network.ethernets || typeof base.network.ethernets !== 'object') {
    base.network.ethernets = {};
  }
  return base;
}

function pickPrimaryEthernetKey(
  networkDataObj: any,
  primaryIfaceName: string,
  mac?: string,
): string {
  const eth = networkDataObj?.network?.ethernets || {};
  if (eth[primaryIfaceName]) return primaryIfaceName;
  if (eth['nic-0']) return 'nic-0';
  if (eth.nic0) return 'nic0';
  if (mac) {
    const found = Object.keys(eth).find((k) => {
      const e = eth[k];
      return (
        String(e?.match?.macaddress || '').toLowerCase() === String(mac).toLowerCase()
      );
    });
    if (found) return found;
  }
  return primaryIfaceName;
}

function applyNicToEthernet(
  networkDataObj: any,
  etherKey: string,
  nic: any,
  macOnIface: string | undefined,
  genMac: () => string,
): { next: any; macAssigned: string | undefined } {
  const nd = ensureNetworkDataShape(networkDataObj);
  const ethernets = nd.network.ethernets;
  let mac = String(macOnIface || '').trim();
  const ip = String(nic?.ipAddress || '').trim();
  const hasStatic = Boolean(ip);
  if (hasStatic && !mac) mac = genMac();

  if (!hasStatic && !gatewayOrDns(nic)) {
    delete ethernets[etherKey];
    return { next: nd, macAssigned: mac || undefined };
  }

  const eth: any = {
    match: { macaddress: (mac || macOnIface || '').toLowerCase() },
    dhcp4: !hasStatic,
  };
  if (hasStatic) {
    eth.addresses = [ip];
    if (nic.gateway) eth.gateway4 = String(nic.gateway).trim();
    if (nic.dns) {
      const dnsList = String(nic.dns)
        .split(/[,;\s]+/)
        .map((d: string) => d.trim())
        .filter(Boolean);
      if (dnsList.length) eth.nameservers = { addresses: dnsList };
    }
  }
  ethernets[etherKey] = eth;
  return { next: nd, macAssigned: mac || macOnIface };
}

function gatewayOrDns(nic: any): boolean {
  return Boolean(String(nic?.gateway || '').trim() || String(nic?.dns || '').trim());
}

function networkDataYamlEquivalent(a: any, b: any): boolean {
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

/**
 * 保留主网卡，按表单重建其余 interface/network；合并辅卡 networkData。
 */
export function computeSecondaryNicsPayload(
  record: any,
  values: any,
  subnets: any[],
  nads: any[],
  getParsedNetworkData: (vm: any) => any,
  generateMacAddress: () => string,
): NicRecomputeResult | null {
  const curIf = record?.spec?.template?.spec?.domain?.devices?.interfaces || [];
  const curNet = record?.spec?.template?.spec?.networks || [];
  if (!Array.isArray(curIf) || curIf.length === 0) return null;

  const primaryIface = deepClone(curIf[0]);
  const primaryName = primaryIface.name;
  const primaryNet = deepClone(
    curNet.find((n: any) => n?.name === primaryName) || {
      name: primaryName,
      pod: {},
    },
  );

  const secondaryRows = Array.isArray(values?.secondaryNics) ? values.secondaryNics : [];
  const names = allocateSecondaryNicNames(primaryName, secondaryRows.length);

  const secondaryIf: any[] = [];
  const secondaryNw: any[] = [];
  secondaryRows.forEach((row: any, idx: number) => {
    const ifaceName = names[idx];
    const mode = String(row?.mode || 'flat');
    const multus = resolveMultusForSecondary(mode, row, subnets, nads);
    const iface = buildKubevirtIface(
      row.type,
      ifaceName,
      row.model,
      row.macAddress,
    );
    const net = buildNetworkEntry(ifaceName, multus);
    secondaryIf.push(iface);
    secondaryNw.push(net);
  });

  const interfaces = [primaryIface, ...secondaryIf];
  const networks = [primaryNet, ...secondaryNw];

  let networkDataObj = ensureNetworkDataShape(getParsedNetworkData(record));
  const beforeSnap = deepClone(networkDataObj);

  const primaryPnic = values?.primaryNic || {};
  const primaryEtherKey = pickPrimaryEthernetKey(
    networkDataObj,
    primaryName,
    String(primaryPnic.macAddress || primaryIface.macAddress || '').trim(),
  );
  const primaryApply = applyNicToEthernet(
    networkDataObj,
    primaryEtherKey,
    primaryPnic,
    String(primaryPnic.macAddress || primaryIface.macAddress || '').trim() || undefined,
    generateMacAddress,
  );
  networkDataObj = primaryApply.next;
  if (primaryApply.macAssigned && !interfaces[0].macAddress) {
    interfaces[0].macAddress = primaryApply.macAssigned;
  }

  secondaryRows.forEach((row: any, idx: number) => {
    const ifaceName = names[idx];
    const iface = secondaryIf[idx];
    const gen = () => generateMacAddress();
    const { next, macAssigned } = applyNicToEthernet(
      networkDataObj,
      ifaceName,
      row,
      String(row?.macAddress || iface.macAddress || '').trim() || undefined,
      gen,
    );
    networkDataObj = next;
    if (macAssigned && !iface.macAddress) {
      iface.macAddress = macAssigned;
    }
  });

  const hasNetworkDataChange = !networkDataYamlEquivalent(beforeSnap, networkDataObj);

  return { interfaces, networks, networkDataObj, hasNetworkDataChange };
}
