import { KUBE_OVN_FLAT_VPC } from '../../../../../kube-ovn/lib/kubeOvnSubnetConstants';
import { parseVmCloudInitNetworkData } from '../../lib/vmReconfigureCloudInit';
import type { VmReconfigureMenuInitCtx } from '../vmReconfigureMenuInitContext';

function buildPrimaryNicFormSlice(record: any, loadedSubnets: any[]) {
  const networks = record?.spec?.template?.spec?.networks || [];
  const interfaces = record?.spec?.template?.spec?.domain?.devices?.interfaces || [];
  if (interfaces.length === 0) return {};

  const iface = interfaces[0];
  const net = networks.find((n: any) => n.name === iface.name);
  const networkName = net?.multus?.networkName || '';
  const subnetName =
    networkName && String(networkName).includes('/') ? String(networkName).split('/').pop() : networkName;
  let type = 'bridge';
  if (String(iface?.binding?.name ?? '').toLowerCase() === 'managedtap') type = 'managedtap';
  else if (iface.masquerade) type = 'masquerade';
  else if (iface.sriov) type = 'sriov';
  else if (iface.macvtap) type = 'macvtap';
  const targetSubnet = (loadedSubnets || []).find((s: any) => s?.metadata?.name === subnetName);
  const subnetType = String(targetSubnet?.metadata?.annotations?.['tower.io/subnet-type'] || '')
    .trim()
    .toLowerCase();
  const isVpc = subnetType === 'vpc';
  const netMode =
    type === 'managedtap'
      ? isVpc
        ? 'vpc'
        : 'flat_subnet'
      : type === 'sriov' || type === 'macvtap'
        ? 'passthrough'
        : isVpc
          ? 'vpc'
          : 'flat';
  const networkDataObj = parseVmCloudInitNetworkData(record);
  let eth = networkDataObj?.network?.ethernets?.['nic-0'] || networkDataObj?.network?.ethernets?.['nic0'];
  if (!eth && iface.macAddress && networkDataObj?.network?.ethernets) {
    eth = Object.values(networkDataObj.network.ethernets).find(
      (e: any) => e?.match?.macaddress?.toLowerCase() === iface.macAddress.toLowerCase(),
    );
  }
  let ipAddress = undefined;
  let gateway = undefined;
  let dns = undefined;
  if (eth) {
    if (eth.addresses && eth.addresses.length > 0) ipAddress = eth.addresses[0];
    if (eth.gateway4) gateway = eth.gateway4;
    if (eth.nameservers?.addresses) dns = eth.nameservers.addresses.join(', ');
  }
  return {
    netMode,
    primaryNic: {
      name: networkName,
      type,
      model: iface.model || 'virtio',
      macAddress: iface.macAddress,
      vpc:
        netMode === 'vpc'
          ? targetSubnet?.spec?.vpc
          : netMode === 'flat_subnet'
            ? String(targetSubnet?.spec?.vpc || targetSubnet?.vpc || KUBE_OVN_FLAT_VPC).trim() ||
              KUBE_OVN_FLAT_VPC
            : undefined,
      subnet: subnetName,
      ipAddress,
      gateway,
      dns,
    },
  };
}

export async function initChangePrimaryNicMenu(ctx: VmReconfigureMenuInitCtx): Promise<void> {
  const { form, record, reloadNads, reloadVpcs, reloadSubnets } = ctx;
  const loadedSubnets = (await Promise.all([reloadNads(), reloadVpcs(), reloadSubnets()]))[2];
  const patch = buildPrimaryNicFormSlice(record, loadedSubnets || []);
  if (Object.keys(patch).length > 0) {
    form.setFieldsValue(patch);
  }
}

export async function initChangeSecondaryNicMenu(ctx: VmReconfigureMenuInitCtx): Promise<void> {
  const { form, record, reloadNads, reloadVpcs, reloadSubnets } = ctx;
  const loadedSubnets = (await Promise.all([reloadNads(), reloadVpcs(), reloadSubnets()]))[2];
  const networks = record?.spec?.template?.spec?.networks || [];
  const interfaces = record?.spec?.template?.spec?.domain?.devices?.interfaces || [];
  const networkDataObj = parseVmCloudInitNetworkData(record);

  const primaryForm = buildPrimaryNicFormSlice(record, loadedSubnets || []);

  const secondaries = interfaces.slice(1).map((iface: any, idx: number) => {
    const net = networks.find((n: any) => n.name === iface.name);
    const networkName = net?.multus?.networkName || '';
    const subnetName =
      networkName && String(networkName).includes('/') ? String(networkName).split('/').pop() : networkName;
    let type = 'bridge';
    if (String(iface?.binding?.name ?? '').toLowerCase() === 'managedtap') type = 'managedtap';
    else if (iface.masquerade) type = 'masquerade';
    else if (iface.sriov) type = 'sriov';
    else if (iface.macvtap) type = 'macvtap';
    const targetSubnet = (loadedSubnets || []).find((s: any) => s?.metadata?.name === subnetName);
    const subnetType = String(targetSubnet?.metadata?.annotations?.['tower.io/subnet-type'] || '')
      .trim()
      .toLowerCase();
    const isVpc = subnetType === 'vpc';
    const mode =
      type === 'managedtap'
        ? isVpc
          ? 'vpc'
          : 'flat_subnet'
        : type === 'sriov' || type === 'macvtap'
          ? 'passthrough'
          : isVpc
            ? 'vpc'
            : 'flat';
    const ifaceKey = iface.name || `nic-${idx + 1}`;
    let eth = networkDataObj?.network?.ethernets?.[ifaceKey];
    if (!eth && iface.macAddress && networkDataObj?.network?.ethernets) {
      eth = Object.values(networkDataObj.network.ethernets).find(
        (e: any) => e?.match?.macaddress?.toLowerCase() === iface.macAddress.toLowerCase(),
      );
    }
    let ipAddress = undefined;
    let gateway = undefined;
    let dns = undefined;
    if (eth) {
      if (eth.addresses && eth.addresses.length > 0) ipAddress = eth.addresses[0];
      if (eth.gateway4) gateway = eth.gateway4;
      if (eth.nameservers?.addresses) dns = eth.nameservers.addresses.join(', ');
    }
    return {
      mode,
      name: networkName,
      type,
      model: iface.model || 'virtio',
      macAddress: iface.macAddress,
      vpc:
        mode === 'vpc'
          ? targetSubnet?.spec?.vpc
          : mode === 'flat_subnet'
            ? String(targetSubnet?.spec?.vpc || targetSubnet?.vpc || KUBE_OVN_FLAT_VPC).trim() ||
              KUBE_OVN_FLAT_VPC
            : undefined,
      subnet: subnetName,
      ipAddress,
      gateway,
      dns,
    };
  });
  form.setFieldsValue({ ...primaryForm, secondaryNics: secondaries });
}
