/**
 * 由「主网卡 + 辅卡行」表单值计算 interfaces / networks，并合并 cloud-init networkData（添加辅卡抽屉复用）。
 */
import { expectedMultusNadRefForSubnet } from '../../../lib/kubeOvnMultusNadRef';
import { allocateSecondaryNicNames } from '../../../lib/harvesterVmNetwork';
import { netModeUsesCloudInitEthernet } from '../../../lib/vmNicManageLogic';
import { passthroughKubevirtIfaceTypeFromNad } from '../../../modals/VmCreateWizard/harvesterVmIfaceTypeOptions';
import { isWizardPciPassthroughNetMode } from '../../../lib/passthroughNicSelectOptions';

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
  model: string | undefined,
  mac?: string,
): any {
  const iface: any = { name: ifaceName };
  const mModel = String(model ?? '').trim();
  if (mModel) iface.model = mModel;
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

function nadHitForMultusPassthrough(nads: any[], multusName: string): any {
  const m = String(multusName || '').trim();
  if (!m) return undefined;
  const list = Array.isArray(nads) ? nads : [];
  for (const n of list) {
    const ns = n?.metadata?.namespace || n?.namespace || '';
    const nm = n?.metadata?.name || n?.name || '';
    const v = ns && nm ? `${ns}/${nm}` : String(nm || '');
    if (v === m) {
      let type = '';
      try {
        const cfg = JSON.parse(n?.spec?.config || '{}');
        type = String(cfg?.type || '').toLowerCase();
      } catch {
        /* ignore */
      }
      return { _type: type };
    }
  }
  return undefined;
}

function passthroughIfaceTypeFromRowOrNad(row: any, nads: any[]): string {
  const fromRow = String(row?.type || '').trim().toLowerCase();
  if (fromRow === 'sriov' || fromRow === 'macvtap') return fromRow;
  const multus = String(row?.name || '').trim();
  return passthroughKubevirtIfaceTypeFromNad(nadHitForMultusPassthrough(nads, multus));
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
  if (isWizardPciPassthroughNetMode(mode)) {
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
 *
 * 主网卡为整卡 PCI 直通时，KubeVirt 可能仅有 hostDevices、无 domain.devices.interfaces（与创建向导一致），
 * 此时仍须能合并「仅辅卡行 + 新 Multus/PCI」的计算，不得因 curIf 为空直接失败。
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
  if (!Array.isArray(curIf)) return null;

  const hasKubevirtPrimary = curIf.length > 0;
  let primaryIface: any = null;
  let primaryNet: any = null;
  let primaryName = "";

  if (hasKubevirtPrimary) {
    primaryIface = deepClone(curIf[0]);
    const primaryNetModeEarly = String(values?.netMode || "").trim();
    if (primaryNetModeEarly === "flat" || isWizardPciPassthroughNetMode(primaryNetModeEarly)) {
      delete primaryIface.macAddress;
    }
    primaryName = String(primaryIface?.name || "").trim();
    primaryNet = deepClone(
      curNet.find((n: any) => n?.name === primaryName) || {
        name: primaryName,
        pod: {},
      },
    );
  }

  const secondaryRows = Array.isArray(values?.secondaryNics) ? values.secondaryNics : [];
  const rowsWithIface = secondaryRows.filter(
    (row: any) =>
      !(
        isWizardPciPassthroughNetMode(String(row?.mode || "")) &&
        String(row?.passthroughSource || "") === "pci-host"
      ),
  );
  const names = hasKubevirtPrimary
    ? allocateSecondaryNicNames(primaryName, rowsWithIface.length)
    : Array.from({ length: rowsWithIface.length }, (_, i) => `nic-${i}`);

  const secondaryIf: any[] = [];
  const secondaryNw: any[] = [];
  let nameIdx = 0;
  secondaryRows.forEach((row: any) => {
    const mode = String(row?.mode || "flat");
    const isPciPassthrough =
      isWizardPciPassthroughNetMode(mode) &&
      String(row?.passthroughSource || "") === "pci-host";
    if (isPciPassthrough) {
      return;
    }

    const ifaceName = names[nameIdx];
    nameIdx += 1;
    const multus = resolveMultusForSecondary(mode, row, subnets, nads);
    const omitMac = mode === "flat" || isWizardPciPassthroughNetMode(mode);
    const isPassthroughMultus = isWizardPciPassthroughNetMode(mode);
    const ifaceType = isPassthroughMultus
      ? passthroughIfaceTypeFromRowOrNad(row, nads)
      : String(row.type || "bridge").toLowerCase();
    const ifaceModel = isPassthroughMultus
      ? undefined
      : String(row.model || "virtio").trim() || "virtio";
    const iface = buildKubevirtIface(
      ifaceType,
      ifaceName,
      ifaceModel,
      omitMac ? undefined : row.macAddress,
    );
    const net = buildNetworkEntry(ifaceName, multus);
    secondaryIf.push(iface);
    secondaryNw.push(net);
  });

  const interfaces = hasKubevirtPrimary ? [primaryIface, ...secondaryIf] : [...secondaryIf];
  const networks = hasKubevirtPrimary ? [primaryNet, ...secondaryNw] : [...secondaryNw];

  let networkDataObj = ensureNetworkDataShape(getParsedNetworkData(record));
  const beforeSnap = deepClone(networkDataObj);

  const primaryPnic = values?.primaryNic || {};
  const primaryNetMode = String(values?.netMode || "").trim();
  const primaryMacForCloud =
    String(
      primaryPnic.macAddress || (hasKubevirtPrimary ? primaryIface?.macAddress : "") || "",
    ).trim();

  if (netModeUsesCloudInitEthernet(primaryNetMode)) {
    const primaryEtherKey = pickPrimaryEthernetKey(
      networkDataObj,
      primaryName,
      primaryMacForCloud,
    );
    const primaryApply = applyNicToEthernet(
      networkDataObj,
      primaryEtherKey,
      primaryPnic,
      primaryMacForCloud || undefined,
      generateMacAddress,
    );
    networkDataObj = primaryApply.next;
    if (primaryApply.macAssigned && interfaces[0] && !interfaces[0].macAddress) {
      interfaces[0].macAddress = primaryApply.macAssigned;
    }
  } else {
    const primaryEtherKey = pickPrimaryEthernetKey(networkDataObj, primaryName, primaryMacForCloud);
    const ethernets = networkDataObj.network.ethernets;
    if (ethernets && ethernets[primaryEtherKey]) {
      delete ethernets[primaryEtherKey];
    }
  }

  let ethIdx = 0;
  secondaryRows.forEach((row: any) => {
    const mode = String(row?.mode || "flat");
    const isPciPassthrough =
      isWizardPciPassthroughNetMode(mode) &&
      String(row?.passthroughSource || "") === "pci-host";
    if (isPciPassthrough) {
      return;
    }

    const ifaceName = names[ethIdx];
    const iface = secondaryIf[ethIdx];
    ethIdx += 1;

    if (netModeUsesCloudInitEthernet(mode)) {
      const gen = () => generateMacAddress();
      const { next, macAssigned } = applyNicToEthernet(
        networkDataObj,
        ifaceName,
        row,
        String(row?.macAddress || iface.macAddress || "").trim() || undefined,
        gen,
      );
      networkDataObj = next;
      if (macAssigned && !iface.macAddress) {
        iface.macAddress = macAssigned;
      }
    } else {
      const ethernets = networkDataObj.network.ethernets;
      if (ethernets && ethernets[ifaceName]) {
        delete ethernets[ifaceName];
      }
    }
  });

  const hasNetworkDataChange = !networkDataYamlEquivalent(beforeSnap, networkDataObj);

  return { interfaces, networks, networkDataObj, hasNetworkDataChange };
}
