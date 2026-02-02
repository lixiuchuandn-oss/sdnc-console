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
  const candidates = [
    `${origin}/apis/kubevirt.io/v1/virtualmachines`, // Cluster scope (most common)
    `${origin}/apis/kubevirt.io/v1/namespaces/default/virtualmachines`,
    `${base}/gateway/apis/kubevirt.io/v1/virtualmachines`, // Rancher proxy
    `${base}/k8s/clusters/local/apis/kubevirt.io/v1/virtualmachines`
  ];

  for (const url of candidates) {
    try {
      const json = await getJsonOnce(url, token, insecure);
      if (json && Array.isArray(json.items)) return json.items;
      if (json && Array.isArray(json.data)) return json.data;
    } catch (e: any) {
      // Continue to next candidate
    }
  }
  
  // If all failed, try the strict default path but return empty array instead of throwing
  // to avoid blocking the whole UI if just one API is weird.
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
    `${origin}/apis/kubevirt.io/v1/virtualmachines`, // Cluster scope (most common)
    `${origin}/apis/kubevirt.io/v1/namespaces/default/virtualmachines`,
    `${base}/gateway/apis/kubevirt.io/v1/virtualmachines`, // Rancher proxy
    `${base}/k8s/clusters/local/apis/kubevirt.io/v1/virtualmachines`
  ];

  for (const url of candidates) {
    try {
      const json = await getJsonOnce(url, token, insecure);
      if (json && (Array.isArray(json.items) || Array.isArray(json.data))) {
        return {
          items: json.items || json.data,
          resourceVersion: json.metadata?.resourceVersion || '',
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
    `${origin}/apis/kubevirt.io/v1/namespaces/default/virtualmachineinstances`,
    `${base}/gateway/apis/kubevirt.io/v1/virtualmachineinstances`,
    `${base}/k8s/clusters/local/apis/kubevirt.io/v1/virtualmachineinstances`
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
    `${origin}/apis/kubevirt.io/v1/namespaces/default/virtualmachineinstances`,
    `${base}/gateway/apis/kubevirt.io/v1/virtualmachineinstances`,
    `${base}/k8s/clusters/local/apis/kubevirt.io/v1/virtualmachineinstances`
  ];

  for (const url of candidates) {
    try {
      const json = await getJsonOnce(url, token, insecure);
      if (json && (Array.isArray(json.items) || Array.isArray(json.data))) {
        return {
          items: json.items || json.data,
          resourceVersion: json.metadata?.resourceVersion || '',
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
    
    // Simple IP
    let ip = '';
    const ips: string[] = [];
    
    // Extract IPs simply
    if (vmi?.status?.interfaces) {
        vmi.status.interfaces.forEach((i: any) => {
            if (i.ipAddress) ips.push(i.ipAddress);
        });
    }
    if (ips.length > 0) ip = ips[0];

    const viewUrl = `${origin}/apis/kubevirt.io/v1/namespaces/${namespace}/virtualmachines/${name}`;

    return {
      links: { view: viewUrl },
      Uid: uid,
      InstanceId: namespace && name ? `${namespace}/${name}` : uid,
      InstanceName: name,
      Status: status,
      VpcAttributes: {
        PrivateIpAddress: {
          IpAddress: ips,
        },
      },
      Extra: {
        Namespace: namespace,
        IpAddresses: ips,
        NodeName: vmi?.status?.nodeName || '',
      }
    };
  });
};

export const buildHarvesterVMManifest = (payload: any) => {
  // If payload already looks like a manifest (has apiVersion and kind), return it
  if (payload?.apiVersion && payload?.kind) {
      return payload;
  }

  // Simplistic manifest builder if missing
  return {
    apiVersion: 'kubevirt.io/v1',
    kind: 'VirtualMachine',
    metadata: {
      name: payload.name,
      namespace: payload.namespace || 'default',
    },
    spec: {
      running: true,
      template: {
        spec: {
          domain: {
            devices: {
              disks: payload.disks || [],
              interfaces: payload.interfaces || [],
            },
            resources: {
              requests: {
                memory: payload.memory || '2Gi',
                cpu: payload.cpu ? String(payload.cpu) : undefined
              },
            },
          },
          networks: payload.networks || [],
          volumes: payload.volumes || []
        },
      },
    },
  };
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
  const body = {
    ...current,
    spec: spec,
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
