/**
 * 变配提交：主网卡 / 辅助网卡（`updateHarvesterVmSpec` + networkData）。
 */
import { message } from 'antd';
import yaml from 'js-yaml';
import { updateHarvesterVmSpec } from '../../../../../../../../services/harvesterApi';
import {
  allocateSecondaryNicNames,
  getMissingNadsFromNetworks,
  hasDuplicateFlatSubnetsInNetworks,
} from '../lib/vmReconfigureNetwork';
import type { VmReconfigureSubmitCtx } from './vmReconfigureSubmitContext';
import { VmReconfigureSubmitSkipFinalize } from './vmReconfigureSubmitTypes';

export async function submitVmReconfigureChangePrimaryNic(
  ctx: VmReconfigureSubmitCtx,
  values: any,
  vmName: string,
  namespace: string,
): Promise<void> {
  const {
    cloudId,
    record,
    subnets,
    nads,
    ensureNadsLoaded,
    openRestartConfirm,
    getParsedNetworkData,
  } = ctx;
         // Construct new networks list with modified primary
         const nic = values.primaryNic;
         const netMode = values.netMode || 'flat';
         // We need to fetch current VM state to be safe, but using record is okay for now
         const networks = [...(record?.spec?.template?.spec?.networks || [])];
         const interfaces = [...(record?.spec?.template?.spec?.domain?.devices?.interfaces || [])];
         
         if (interfaces.length > 0) {
            // Update interface[0]
            const interfaceConfig: any = {
               name: networks[0]?.name || 'default', // Keep link name
               model: nic.model || 'virtio',
            };
            
            // Set MAC address if provided
            if (nic.macAddress) {
               interfaceConfig.macAddress = nic.macAddress;
            }
            
            // Set interface type (managedtap binding, bridge, masquerade, sriov, macvtap)
            if (nic.type === 'managedtap') {
               interfaceConfig.binding = { name: 'managedtap' };
            } else if (nic.type === 'masquerade') {
               interfaceConfig.masquerade = {};
            } else if (nic.type === 'sriov') {
               interfaceConfig.sriov = {};
            } else if (nic.type === 'macvtap') {
               interfaceConfig.macvtap = {};
            } else {
               interfaceConfig.bridge = {};
            }
            
            interfaces[0] = interfaceConfig;
            
            // Update network[0]
            let pNetName = nic.name;
            
            // Handle different network modes
            if (netMode === 'vpc') {
               // VPC network: subnet name is the network name
               const subnetName = nic.subnet || nic.name || '';
               if (subnetName) {
                  const subnet = subnets.find((s: any) => s?.metadata?.name === subnetName);
                  if (subnet?.metadata?.namespace) {
                     pNetName = `${subnet.metadata.namespace}/${subnetName}`;
                  } else {
                     const nad = nads.find((n: any) => n?.metadata?.name === subnetName);
                     if (nad?.metadata?.namespace) {
                        pNetName = `${nad.metadata.namespace}/${subnetName}`;
                     } else {
                        pNetName = subnetName;
                     }
                  }
               } else {
                  pNetName = '';
               }
            } else if (netMode === 'flat_subnet') {
               const raw = nic.name || '';
               const subnetName =
                  nic.subnet ||
                  (raw && String(raw).includes('/') ? String(raw).split('/').pop() : raw) ||
                  '';
               if ((!pNetName || !String(pNetName).includes('/')) && subnetName) {
                  const subnet = subnets.find((s: any) => s?.metadata?.name === subnetName);
                  let ns = subnet?.metadata?.namespace;
                  if (!ns && subnet?.spec?.provider) {
                     const parts = String(subnet.spec.provider).split('.');
                     if (parts.length >= 2) ns = parts[parts.length - 2];
                  }
                  if (ns) {
                     pNetName = `${ns}/${subnetName}`;
                  } else {
                     const nad = nads.find((n: any) => n?.metadata?.name === subnetName);
                     if (nad?.metadata?.namespace) {
                        pNetName = `${nad.metadata.namespace}/${subnetName}`;
                     } else {
                        pNetName = subnetName;
                     }
                  }
               } else if (!subnetName) {
                  pNetName = '';
               }
            } else if (netMode === 'flat') {
               // Flat network: NAD name (namespace/name format)
               if (!pNetName) {
                  // If no name selected, use pod network
                  pNetName = 'default/pod';
               } else if (!pNetName.includes('/')) {
                  // If name doesn't have namespace, try to resolve it from loaded NADs
                  const found = nads.find((n: any) => n.metadata.name === pNetName);
                  if (found) {
                     pNetName = `${found.metadata.namespace}/${found.metadata.name}`;
                  } else {
                     // Fallback: assume it's in default namespace
                     pNetName = `default/${pNetName}`;
                  }
               }
            } else if (netMode === 'passthrough') {
               // Passthrough network: SR-IOV/Macvtap NAD
               if (!pNetName) {
                  pNetName = 'default/pod';
               } else if (!pNetName.includes('/')) {
                  const found = nads.find((n: any) => n.metadata.name === pNetName);
                  if (found) {
                     pNetName = `${found.metadata.namespace}/${found.metadata.name}`;
                  } else {
                     pNetName = `default/${pNetName}`;
                  }
               }
            } else {
               pNetName = pNetName || 'default/pod';
            }

            // Build network configuration
            if (pNetName === 'default/pod' || !pNetName) {
               // Pod network: no multus needed
               networks[0] = {
                  name: networks[0]?.name || 'default',
               };
            } else {
               // Multus network: NAD or VPC subnet
               networks[0] = {
                  name: networks[0]?.name || 'default',
                  multus: { networkName: pNetName }
               };
            }

            if (hasDuplicateFlatSubnetsInNetworks(networks, subnets)) {
              message.error('同一扁平子网在同一云主机内只能使用一次');
              throw new VmReconfigureSubmitSkipFinalize();
            }

            const payload: any = { networks, interfaces };

            // --- Static IP Handling (NetworkData) ---
            let networkDataObj = getParsedNetworkData(record);
            let hasNetworkDataChange = false;
            const ifaceName = 'nic-0'; // Primary NIC

            if (nic.ipAddress) {
               hasNetworkDataChange = true;
               if (!networkDataObj.network) networkDataObj.network = { version: 2, ethernets: {} };
               if (!networkDataObj.network.ethernets) networkDataObj.network.ethernets = {};
               
               const mac = nic.macAddress || interfaces[0].macAddress;
               const ethConfig: any = {
                   addresses: [nic.ipAddress]
               };
               
               if (mac) {
                   ethConfig.match = { macaddress: mac };
               } else {
                   ethConfig.match = { name: 'e*' };
               }

               if (nic.gateway) ethConfig.gateway4 = nic.gateway;
               if (nic.dns) {
                  const dnsList = nic.dns.split(/[,;\s]+/).filter((d: string) => d.trim());
                  if (dnsList.length > 0) {
                      ethConfig.nameservers = { addresses: dnsList };
                  }
               }
               // Use nic-0 as key
               networkDataObj.network.ethernets[ifaceName] = ethConfig;
               
               // Clean up legacy 'nic0' key if it exists to avoid duplicates/confusion
               if (networkDataObj.network.ethernets['nic0']) {
                   delete networkDataObj.network.ethernets['nic0'];
               }
            } else {
               // Remove static config if exists
               if (networkDataObj?.network?.ethernets?.[ifaceName]) {
                   delete networkDataObj.network.ethernets[ifaceName];
                   hasNetworkDataChange = true;
               }
               if (networkDataObj?.network?.ethernets?.['nic0']) {
                   delete networkDataObj.network.ethernets['nic0'];
                   hasNetworkDataChange = true;
               }
            }
               
            if (hasNetworkDataChange) {
               payload.networkData = yaml.dump(networkDataObj);
            }
            
            {
              const nadList = await ensureNadsLoaded();
              const missing = getMissingNadsFromNetworks(networks, String(namespace || 'default'), nadList);
              if (missing.length > 0) {
                message.error(`更新失败：引用的 NAD 不存在：${missing.join(', ')}。请更换为存在的网络后再提交。`);
                throw new VmReconfigureSubmitSkipFinalize();
              }
            }

            await updateHarvesterVmSpec(cloudId, namespace, vmName, payload);
            openRestartConfirm(namespace, vmName, false);
         }
}


export async function submitVmReconfigureChangeSecondaryNic(
  ctx: VmReconfigureSubmitCtx,
  values: any,
  vmName: string,
  namespace: string,
): Promise<void> {
  const {
    cloudId,
    record,
    subnets,
    nads,
    ensureNadsLoaded,
    openRestartConfirm,
    getParsedNetworkData,
    generateMacAddress,
  } = ctx;
         const secondaryNics = values.secondaryNics || [];
         
         // Fetch current state
         const currentNetworks = record?.spec?.template?.spec?.networks || [];
         const currentInterfaces = record?.spec?.template?.spec?.domain?.devices?.interfaces || [];
         
         // Keep Primary NIC (index 0) if exists
         const newNetworks = currentNetworks.length > 0 ? [currentNetworks[0]] : [];
         const newInterfaces = currentInterfaces.length > 0 ? [currentInterfaces[0]] : [];
         
         let networkDataObj = getParsedNetworkData(record);
         let hasNetworkDataChange = false;

         const primaryIfaceName =
           String(currentInterfaces[0]?.name || currentNetworks[0]?.name || '').trim() || 'default';
         const secondaryIfaceNames = allocateSecondaryNicNames(primaryIfaceName, secondaryNics.length);

         // Append Secondary NICs
         secondaryNics.forEach((nic: any, idx: number) => {
            const ifaceName = secondaryIfaceNames[idx];
            let mac = nic.macAddress;

            // Auto-generate MAC if Static IP is used but MAC is missing
            if (nic.ipAddress && !mac) {
                mac = generateMacAddress();
            }

            // Interface
            const ifaceRow: any = {
               name: ifaceName,
               model: nic.model || 'virtio',
               macAddress: mac,
            };
            const nt = nic.type || 'bridge';
            if (nt === 'managedtap') ifaceRow.binding = { name: 'managedtap' };
            else if (nt === 'masquerade') ifaceRow.masquerade = {};
            else if (nt === 'sriov') ifaceRow.sriov = {};
            else if (nt === 'macvtap') ifaceRow.macvtap = {};
            else ifaceRow.bridge = {};
            newInterfaces.push(ifaceRow);
            
            // Network
            let sNetName = nic.name;
            // Handle flat network name resolution
            if (nic.mode === 'flat' && sNetName && !sNetName.includes('/')) {
                const found = nads.find((n: any) => n.metadata.name === sNetName);
                if (found) sNetName = `${found.metadata.namespace}/${found.metadata.name}`;
            }
            if (nic.mode === 'passthrough' && sNetName && !sNetName.includes('/')) {
                const found = nads.find((n: any) => n.metadata.name === sNetName);
                if (found) sNetName = `${found.metadata.namespace}/${found.metadata.name}`;
            }
            // Handle VPC network name (subnet name -> NAD name)
            // For Kube-OVN VPC, subnet name should match NAD name, but networkName needs namespace/name format
            if (nic.mode === 'vpc') {
                const subnetName = nic.subnet;
                if (subnetName) {
                    // 按子网名 + VPC 查找，避免跨 VPC 同名子网误匹配
                    const subnet = subnets.find(
                      (s: any) =>
                        s?.metadata?.name === subnetName &&
                        String(s?.spec?.vpc || s?.vpc || '').trim() === String(nic?.vpc || '').trim(),
                    );
                    if (subnet?.metadata?.namespace) {
                        sNetName = `${subnet.metadata.namespace}/${subnetName}`;
                    } else {
                        // Fallback: try to find NAD with same name
                        const nad = nads.find((n: any) => n.metadata.name === subnetName);
                        if (nad) {
                            sNetName = `${nad.metadata.namespace}/${subnetName}`;
                        } else {
                            // Last resort: use subnet name only (may fail if NAD not found)
                            sNetName = subnetName;
                        }
                    }
                }
            }
            if (nic.mode === 'flat_subnet') {
                const raw = nic.name || '';
                const subnetName =
                    nic.subnet ||
                    (raw && String(raw).includes('/') ? String(raw).split('/').pop() : raw) ||
                    '';
                if ((!sNetName || !String(sNetName).includes('/')) && subnetName) {
                    const subnet = subnets.find((s: any) => {
                      if (s?.metadata?.name !== subnetName) return false;
                      const st = String(s?.metadata?.annotations?.['tower.io/subnet-type'] || '')
                        .trim()
                        .toLowerCase();
                      return st === 'flat';
                    });
                    let ns = subnet?.metadata?.namespace;
                    if (!ns && subnet?.spec?.provider) {
                        const parts = String(subnet.spec.provider).split('.');
                        if (parts.length >= 2) ns = parts[parts.length - 2];
                    }
                    if (ns) {
                        sNetName = `${ns}/${subnetName}`;
                    } else {
                        const nad = nads.find((n: any) => n?.metadata?.name === subnetName);
                        if (nad?.metadata?.namespace) {
                            sNetName = `${nad.metadata.namespace}/${subnetName}`;
                        } else {
                            sNetName = subnetName;
                        }
                    }
                }
            }

            newNetworks.push({
               name: ifaceName,
               multus: { networkName: sNetName }
            });

            // Update NetworkData for Static IP
            if (nic.ipAddress) {
                hasNetworkDataChange = true;
                if (!networkDataObj.network) networkDataObj.network = { version: 2, ethernets: {} };
                if (!networkDataObj.network.ethernets) networkDataObj.network.ethernets = {};
                
                const ethConfig: any = {
                    match: { macaddress: mac },
                    addresses: [nic.ipAddress]
                };
                if (nic.gateway) ethConfig.gateway4 = nic.gateway;
                if (nic.dns) {
                    const dnsList = nic.dns.split(/[,;\s]+/).filter((d: string) => d.trim());
                    if (dnsList.length > 0) {
                        ethConfig.nameservers = { addresses: dnsList };
                    }
                }
                networkDataObj.network.ethernets[ifaceName] = ethConfig;
            } else {
                // If switching back to DHCP, remove static config for this interface
                if (networkDataObj?.network?.ethernets?.[ifaceName]) {
                    delete networkDataObj.network.ethernets[ifaceName];
                    hasNetworkDataChange = true;
                }
            }
         });

         if (hasDuplicateFlatSubnetsInNetworks(newNetworks, subnets)) {
             message.error('同一扁平子网在同一云主机内只能使用一次');
             throw new VmReconfigureSubmitSkipFinalize();
         }

         // 删除 cloud-init 中已无对应网卡的 ethernets 条目（与当前 interfaces[].name 对齐）
         const ifaceNamesInSpec = new Set(
           newInterfaces.map((i: any) => String(i?.name || '').trim()).filter(Boolean),
         );
         if (networkDataObj?.network?.ethernets) {
           Object.keys(networkDataObj.network.ethernets).forEach((key) => {
             if (!ifaceNamesInSpec.has(key)) {
               delete networkDataObj.network.ethernets[key];
               hasNetworkDataChange = true;
             }
           });
         }

         const payload: any = {
            networks: newNetworks,
            interfaces: newInterfaces
         };

         if (hasNetworkDataChange) {
             payload.networkData = yaml.dump(networkDataObj);
         }

         {
           const nadList = await ensureNadsLoaded();
           const missing = getMissingNadsFromNetworks(newNetworks, String(namespace || 'default'), nadList);
           if (missing.length > 0) {
             message.error(`更新失败：引用的 NAD 不存在：${missing.join(', ')}。请更换为存在的网络后再提交。`);
             throw new VmReconfigureSubmitSkipFinalize();
           }
         }

         await updateHarvesterVmSpec(cloudId, namespace, vmName, payload);
         openRestartConfirm(namespace, vmName, false);
}
