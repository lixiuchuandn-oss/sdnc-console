import { HarvesterTestParams } from './types';
import { getJsonOnce, requestJson, requestOnce } from './utils';

// ==================================================================================
// VM List (Direct API - Auto Discovery)
// ==================================================================================
export const listKubevirtVMsRaw = async ({
  endpoint,
  token,
  insecure = false,
}: HarvesterTestParams): Promise<any[]> => {
  const base = (endpoint || '').replace(/\/+$/, '');
  let origin = base;
  try {
    const u = new URL(base);
    origin = `${u.protocol}//${u.host}`;
  } catch {
    origin = base.replace(/\/v[0-9].*$/, '');
  }

  // Common Kubevirt API paths
  // Use Harvester API strict mode for now to ensure cleaner code structure
  // as requested by user.
  const candidates = [
    `${origin}/apis/kubevirt.io/v1/virtualmachines`,
    `${origin}/v1/harvester/kubevirt.io.virtualmachines`, // Harvester/Steve API (Has links/actions)
  ];

  for (const url of candidates) {
    try {
      const json = await getJsonOnce(url, token, insecure);
      if (json && (Array.isArray(json.items) || Array.isArray(json.data))) {
        const items = json.items || json.data;
        return items;
      }
    } catch (e: any) {
      console.warn(`[Harvester-API] 虚拟机获取失败: 请求地址=${url} 错误=${e.message}`);
      // Continue to next candidate
    }
  }
  
  console.warn(`[Harvester-API] 虚拟机所有地址获取失败或为空`);
  return [];
};

export const listKubevirtVMsRawWithMeta = async ({
  endpoint,
  token,
  insecure = false,
}: HarvesterTestParams): Promise<{ items: any[]; resourceVersion: string; url: string } | null> => {
  const base = (endpoint || '').replace(/\/+$/, '');
  let origin = base;
  try {
    const u = new URL(base);
    origin = `${u.protocol}//${u.host}`;
  } catch {
    origin = base.replace(/\/v[0-9].*$/, '');
  }

  const candidates = [
    `${origin}/apis/kubevirt.io/v1/virtualmachines`,
    `${origin}/v1/harvester/kubevirt.io.virtualmachines`, // Harvester/Steve API (Has links/actions)
  ];

  for (const url of candidates) {
    try {
      const json = await getJsonOnce(url, token, insecure);
      if (json && (Array.isArray(json.items) || Array.isArray(json.data))) {
        return {
          items: json.items || json.data,
          resourceVersion: json.metadata?.resourceVersion || json.resourceVersion || '',
          url
        };
      }
    } catch (e: any) {
      // Continue
    }
  }
  return null;
};

// ==================================================================================
// VMI List (Direct API - Auto Discovery)
// ==================================================================================
export const listKubevirtVMIsRaw = async ({
  endpoint,
  token,
  insecure = false,
}: HarvesterTestParams): Promise<any[]> => {
  const base = (endpoint || '').replace(/\/+$/, '');
  let origin = base;
  try {
    const u = new URL(base);
    origin = `${u.protocol}//${u.host}`;
  } catch {
    origin = base.replace(/\/v[0-9].*$/, '');
  }

  const candidates = [
    `${origin}/apis/kubevirt.io/v1/virtualmachineinstances`,
    `${origin}/v1/harvester/kubevirt.io.virtualmachineinstances`,
  ];

  for (const url of candidates) {
    try {
      const json = await getJsonOnce(url, token, insecure);
      if (json && Array.isArray(json.items)) return json.items;
      if (json && Array.isArray(json.data)) return json.data;
    } catch (e: any) {
      // Continue
    }
  }
  console.warn(`[Harvester-API] 虚拟机实例所有地址获取失败或为空`);
  return [];
};

export const listKubevirtVMIsRawWithMeta = async ({
  endpoint,
  token,
  insecure = false,
}: HarvesterTestParams): Promise<{ items: any[]; resourceVersion: string; url: string } | null> => {
  const base = (endpoint || '').replace(/\/+$/, '');
  let origin = base;
  try {
    const u = new URL(base);
    origin = `${u.protocol}//${u.host}`;
  } catch {
    origin = base.replace(/\/v[0-9].*$/, '');
  }

  const candidates = [
    `${origin}/apis/kubevirt.io/v1/virtualmachineinstances`,
    `${origin}/v1/harvester/kubevirt.io.virtualmachineinstances`,
  ];

  for (const url of candidates) {
    try {
      const json = await getJsonOnce(url, token, insecure);
      if (json && (Array.isArray(json.items) || Array.isArray(json.data))) {
        return {
          items: json.items || json.data,
          resourceVersion: json.metadata?.resourceVersion || json.resourceVersion || '',
          url
        };
      }
    } catch (e: any) {
      // Continue
    }
  }
  return null;
};

// ==================================================================================
// Legacy / Standard Functions (Maintained for compatibility if needed, but simplified)
// ==================================================================================

export const listHarvesterVMsStandard = async ({
  endpoint,
  token,
  insecure = false,
}: HarvesterTestParams): Promise<any[]> => {
  const base = (endpoint || '').replace(/\/+$/, '');
  let origin = base;
  try {
    const u = new URL(base);
    origin = `${u.protocol}//${u.host}`;
  } catch {
    origin = base.replace(/\/v[0-9].*$/, '');
  }

  // Reuse the raw functions for VM/VMI to ensure consistency with user request
  const [vms, vmis] = await Promise.all([
    listKubevirtVMsRaw({ endpoint, token, insecure }),
    listKubevirtVMIsRaw({ endpoint, token, insecure }),
  ]);

  const vmiMap = new Map<string, any>();
  for (const vmi of vmis) {
    const nm = vmi?.metadata?.name || vmi?.name || '';
    const ns = vmi?.metadata?.namespace || vmi?.namespace || '';
    const key = ns && nm ? `${ns}/${nm}` : vmi?.metadata?.uid || '';
    if (key) vmiMap.set(key, vmi);
  }

  // Simplified mapping (stripping complex logic if possible, but basic fields are needed)
  return vms.map((vm: any) => {
    const name = vm?.metadata?.name || vm?.name || '';
    const namespace = vm?.metadata?.namespace || vm?.namespace || '';
    const uid = vm?.metadata?.uid || vm?.id || name;
    const vmi = vmiMap.get(namespace && name ? `${namespace}/${name}` : uid);
    
    // Simple Status
    const status = vm?.status?.printableStatus || vm?.status?.phase || 'Unknown';
    
    // IP/Mac resolution (Merge VM Status & VMI Status)
    const ips: string[] = [];
    const macs: string[] = [];
    const addIp = (s: any) => {
      const v = String(s || '').trim();
      if (v && !ips.includes(v)) ips.push(v);
    };
    
    // From VM status
    if (vm?.status?.vmIp) addIp(vm.status.vmIp);
    if (Array.isArray(vm?.status?.interfaces)) {
      vm.status.interfaces.forEach((i: any) => {
        addIp(i.ipAddress || i.ip);
        if (i.mac || i.macAddress) macs.push(i.mac || i.macAddress);
      });
    }
    // From VMI status (More real-time)
    if (vmi) {
      if (Array.isArray(vmi.status?.interfaces)) {
        vmi.status.interfaces.forEach((i: any) => {
          if (i.ipAddress || i.ip) addIp(i.ipAddress || i.ip);
          if (i.mac || i.macAddress) macs.push(i.mac || i.macAddress);
        });
      }
    }

    // Node
    const nodeName = vm?.status?.nodeName || vmi?.status?.nodeName || '';

    // Networks (Parse Multus annotations)
    const networksArr: any[] = Array.isArray(vm?.spec?.template?.spec?.networks)
      ? vm?.spec?.template?.spec?.networks
      : [];
    const networks: string[] = networksArr
      .map((n: any) => n?.multus?.networkName || (n?.name ? String(n.name) : 'pod'))
      .filter((s: string) => !!s);

    // CPU/Memory
    const cpu =
      vm?.spec?.template?.spec?.domain?.cpu?.cores ||
      vm?.spec?.template?.spec?.domain?.cpu?.sockets ||
      undefined;
    const memory =
      vm?.spec?.template?.spec?.domain?.resources?.requests?.memory ||
      vm?.spec?.template?.spec?.domain?.memory?.guest ||
      undefined;

    // Volume Claims (PVCs)
    const volumes = vm?.spec?.template?.spec?.volumes || [];
    const volumeClaims = volumes
      .map((v: any) => v?.persistentVolumeClaim?.claimName)
      .filter((n: string) => !!n);

    const creationTimestamp = vm?.metadata?.creationTimestamp;
    const description = vm?.metadata?.annotations?.description || '';
    const creator = vm?.metadata?.labels?.['harvesterhci.io/creator'] || '';
    const conditions = vm?.status?.conditions || [];

    const viewUrl = `${origin}/apis/kubevirt.io/v1/namespaces/${namespace}/virtualmachines/${name}`;

    return {
      ...vm,
      links: { view: viewUrl },
      id: uid, // Use K8s UID as ID
      name,
      namespace,
      status,
      description,
      creator,
      conditions,
      createdAt: creationTimestamp,
      ips,
      macAddresses: Array.from(new Set(macs)),
      nodeName,
      networks,
      vpcName: networks.find(n => n !== 'pod' && n !== 'default'),
      volumeClaims,
      cpu,
      memoryGb: memory,
      // Include raw VMI if needed
      vmiRaw: vmi,
      
      // Legacy fields for compatibility (if any other consumers exist)
      Uid: uid,
      InstanceId: namespace && name ? `${namespace}/${name}` : uid,
      InstanceName: name,
      Status: status,
      VpcAttributes: {
        PrivateIpAddress: {
          IpAddress: ips,
        },
      },
    };
  });
};

export const getHarvesterVM = async (
  { endpoint, token, insecure = false }: HarvesterTestParams,
  namespace: string,
  name: string,
): Promise<any> => {
  const base = (endpoint || '').replace(/\/+$/, '');
  let origin = base;
  try {
    const u = new URL(base);
    origin = `${u.protocol}//${u.host}`;
  } catch {
    origin = base.replace(/\/v[0-9].*$/, '');
  }

  const candidates = [
    `${origin}/apis/kubevirt.io/v1/namespaces/${encodeURIComponent(namespace)}/virtualmachines/${encodeURIComponent(name)}`,
    `${base}/gateway/apis/kubevirt.io/v1/namespaces/${encodeURIComponent(namespace)}/virtualmachines/${encodeURIComponent(name)}`,
    `${base}/k8s/clusters/local/apis/kubevirt.io/v1/namespaces/${encodeURIComponent(namespace)}/virtualmachines/${encodeURIComponent(name)}`
  ];

  let lastError: any = null;
  for (const url of candidates) {
    try {
      const res = await getJsonOnce(url, token, insecure);
      if (res && (res.metadata?.name || res.name)) {
        return res;
      }
    } catch (e: any) {
      lastError = e;
    }
  }
  
  if (lastError) throw lastError;
  throw new Error(`VM ${namespace}/${name} not found in any candidate paths`);
};

export const createHarvesterVM = async (
  { endpoint, token, insecure = false }: HarvesterTestParams,
  namespace: string,
  payload: any,
): Promise<any> => {
  const base = (endpoint || '').replace(/\/+$/, '');
  let origin = base;
  try {
    const u = new URL(base);
    origin = `${u.protocol}//${u.host}`;
  } catch {
    origin = base.replace(/\/v[0-9].*$/, '');
  }
  const url = `${origin}/apis/kubevirt.io/v1/namespaces/${encodeURIComponent(namespace)}/virtualmachines`;
  return await requestJson('POST', url, token, insecure, payload);
};

export const updateHarvesterVMSpec = async (
  { endpoint, token, insecure = false }: HarvesterTestParams,
  namespace: string,
  name: string,
  spec: any,
): Promise<any> => {
  const base = (endpoint || '').replace(/\/+$/, '');
  let origin = base;
  try {
    const u = new URL(base);
    origin = `${u.protocol}//${u.host}`;
  } catch {
    origin = base.replace(/\/v[0-9].*$/, '');
  }
  // Fetch current to get resourceVersion
  const current = await getHarvesterVM({ endpoint, token, insecure }, namespace, name);
  
  // Create a deep clone of the current spec to modify
  const newSpec = current.spec ? JSON.parse(JSON.stringify(current.spec)) : {};
  
  // Ensure structure exists
  if (!newSpec.template) newSpec.template = {};
  if (!newSpec.template.spec) newSpec.template.spec = {};
  if (!newSpec.template.spec.domain) newSpec.template.spec.domain = {};
  const domain = newSpec.template.spec.domain;
  
  const ensureResources = () => {
      if (!domain.resources) domain.resources = {};
      if (!domain.resources.requests) domain.resources.requests = {};
      if (!domain.resources.limits) domain.resources.limits = {};
  };
  const ensureCpu = () => {
      if (!domain.cpu) domain.cpu = {};
  };

  // --- 1. Simple CPU/Memory Change ---
  if (spec.cpu !== undefined) {
      ensureResources();
      domain.resources.requests.cpu = String(spec.cpu);
      // Default topology for simple mode to avoid mismatch
      ensureCpu();
      domain.cpu.sockets = 1;
      domain.cpu.cores = Number(spec.cpu);
      domain.cpu.threads = 1;
  }
  
  if (spec.memory !== undefined) {
      ensureResources();
      domain.resources.requests.memory = spec.memory;
      domain.resources.limits.memory = spec.memory;
  }

  // --- 2. Advanced CPU ---
  if (spec.cpuSockets || spec.cpuCores || spec.cpuThreads) {
      ensureCpu();
      if (spec.cpuSockets) domain.cpu.sockets = Number(spec.cpuSockets);
      if (spec.cpuCores) domain.cpu.cores = Number(spec.cpuCores);
      if (spec.cpuThreads) domain.cpu.threads = Number(spec.cpuThreads);
  }
  
  if (spec.dedicatedCPUPlacement !== undefined) {
      ensureCpu();
      domain.cpu.dedicatedCpuPlacement = !!spec.dedicatedCPUPlacement;
  }
  
  if (spec.cpuRequest !== undefined) {
      ensureResources();
      domain.resources.requests.cpu = String(spec.cpuRequest);
  }
  
  if (spec.cpuLimit !== undefined) {
      ensureResources();
      domain.resources.limits.cpu = String(spec.cpuLimit);
  }
  
  // --- 3. Advanced Memory ---
  if (spec.memoryLimit !== undefined) {
      ensureResources();
      domain.resources.limits.memory = spec.memoryLimit;
  }

  // --- 4. GPU ---
  if (spec.gpuResourceName !== undefined) {
      if (!domain.devices) domain.devices = {};
      // If resourceName is empty, remove GPU
      if (!spec.gpuResourceName) {
          delete domain.devices.gpus;
      } else {
          domain.devices.gpus = [
              {
                  name: 'gpu-1',
                  deviceName: spec.gpuResourceName
              }
          ];
      }
  }

  const body = {
    ...current,
    spec: newSpec,
  };
  const url = `${origin}/apis/kubevirt.io/v1/namespaces/${encodeURIComponent(namespace)}/virtualmachines/${encodeURIComponent(name)}`;
  return await requestJson('PUT', url, token, insecure, body);
};

export const getHarvesterVmVncUrl = async (
  { endpoint, token, insecure = false }: HarvesterTestParams,
  namespace: string,
  name: string,
): Promise<string> => {
  const base = (endpoint || '').replace(/\/+$/, '');
  let origin = base;
  try {
    const u = new URL(base);
    origin = `${u.protocol}//${u.host}`;
  } catch {
    origin = base.replace(/\/v[0-9].*$/, '');
  }
  return `${origin}/apis/subresources.kubevirt.io/v1/namespaces/${encodeURIComponent(namespace)}/virtualmachineinstances/${encodeURIComponent(name)}/vnc`;
};