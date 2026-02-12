import { API_BASE_URL, apiRequest } from './api';

export const fetchHarvesterSnapshots = async (cloudId: string, force = false) => {
  const token = localStorage.getItem('token');
  const url = `${API_BASE_URL}/api/clouds/${cloudId}/resources/harvester/snapshots${force ? '?force=true' : ''}`;
  const res = await fetch(url, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json', 'Authorization': token ? `Bearer ${token}` : '' },
    credentials: 'include',
  });
  if (!res.ok) throw new Error(await res.text());
  return await res.json();
};

export const deleteHarvesterLonghornVolume = async (cloudId: string, namespace: string, name: string) => {
  const token = localStorage.getItem('token');
  const res = await fetch(`${API_BASE_URL}/api/clouds/${cloudId}/resources/harvester/longhorn/volumes/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json', 'Authorization': token ? `Bearer ${token}` : '' },
    credentials: 'include',
  });
  if (!res.ok) { throw new Error(await res.text()); }
  return await res.json();
};

export const deleteHarvesterPVC = async (cloudId: string, namespace: string, name: string) => {
  const token = localStorage.getItem('token');
  const res = await fetch(`${API_BASE_URL}/api/clouds/${cloudId}/resources/harvester/volumes/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json', 'Authorization': token ? `Bearer ${token}` : '' },
    credentials: 'include',
  });
  if (!res.ok) { throw new Error(await res.text()); }
  return await res.json();
};

export const fetchHarvesterScheduleVmBackups = async (cloudId: string, force = false) => {
  const token = localStorage.getItem('token');
  const url = `${API_BASE_URL}/api/clouds/${cloudId}/resources/harvester/schedulevmbackups${force ? '?force=true' : ''}`;
  const res = await fetch(url, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json', 'Authorization': token ? `Bearer ${token}` : '' },
    credentials: 'include',
  });
  if (!res.ok) throw new Error(await res.text());
  return await res.json();
};

export const createHarvesterScheduleVmBackup = async (cloudId: string, payload: any) => {
  const token = localStorage.getItem('token');
  const res = await fetch(`${API_BASE_URL}/api/clouds/${cloudId}/resources/harvester/schedulevmbackups`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': token ? `Bearer ${token}` : '' },
    body: JSON.stringify(payload),
    credentials: 'include',
  });
  if (!res.ok) { 
    const t = await res.text(); 
    try { 
      const j = JSON.parse(t); 
      // Prefer detailed error message if available
      const detail = j?.error ? (typeof j.error === 'string' ? j.error : JSON.stringify(j.error)) : '';
      const msg = j?.message || '请求失败';
      // Construct a composite error message that contains both summary and detail
      throw new Error(detail ? `${msg} | ${detail}` : msg); 
    } catch (e: any) { 
      // If it's already our composite error, rethrow it
      if (e.message && e.message.includes('|')) throw e;
      throw new Error(t); 
    } 
  }
  return await res.json();
};

export const deleteHarvesterScheduleVmBackup = async (cloudId: string, namespace: string, name: string) => {
  const token = localStorage.getItem('token');
  const res = await fetch(`${API_BASE_URL}/api/clouds/${cloudId}/resources/harvester/schedulevmbackups/${namespace}/${name}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json', 'Authorization': token ? `Bearer ${token}` : '' },
    credentials: 'include',
  });
  if (!res.ok) throw new Error(await res.text());
  return await res.json();
};

export const updateHarvesterScheduleVmBackup = async (cloudId: string, namespace: string, name: string, payload: any) => {
  const token = localStorage.getItem('token');
  const res = await fetch(`${API_BASE_URL}/api/clouds/${cloudId}/resources/harvester/schedulevmbackups/${namespace}/${name}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'Authorization': token ? `Bearer ${token}` : '' },
    body: JSON.stringify(payload),
    credentials: 'include',
  });
  if (!res.ok) throw new Error(await res.text());
  return await res.json();
};

export const fetchHarvesterBackups = async (cloudId: string, force = false) => {
  const token = localStorage.getItem('token');
  const url = `${API_BASE_URL}/api/clouds/${cloudId}/resources/harvester/backups${force ? '?force=true' : ''}`;
  const res = await fetch(url, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json', 'Authorization': token ? `Bearer ${token}` : '' },
    credentials: 'include',
  });
  if (!res.ok) throw new Error(await res.text());
  return await res.json();
};

export const fetchHarvesterSshKeys = async (cloudId: string, force = false) => {
  const token = localStorage.getItem('token');
  const res = await fetch(`${API_BASE_URL}/api/clouds/${cloudId}/resources/harvester/sshkeys${force ? '?force=true' : ''}`, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json', 'Authorization': token ? `Bearer ${token}` : '' },
    credentials: 'include',
  });
  if (!res.ok) throw new Error(await res.text());
  return await res.json();
};



export const fetchHarvesterCloudInits = async (cloudId: string, force = false) => {
  const token = localStorage.getItem('token');
  const res = await fetch(`${API_BASE_URL}/api/clouds/${cloudId}/resources/harvester/cloudinits${force ? '?force=true' : ''}`, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json', 'Authorization': token ? `Bearer ${token}` : '' },
    credentials: 'include',
  });
  if (!res.ok) throw new Error(await res.text());
  return await res.json();
};

export const fetchHarvesterIngresses = async (cloudId: string, force = false) => {
  const token = localStorage.getItem('token');
  const res = await fetch(`${API_BASE_URL}/api/clouds/${cloudId}/resources/harvester/ingresses${force ? '?force=true' : ''}`, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json', 'Authorization': token ? `Bearer ${token}` : '' },
    credentials: 'include',
  });
  if (!res.ok) throw new Error(await res.text());
  return await res.json();
};

export const fetchHarvesterServices = async (cloudId: string, force = false) => {
  const token = localStorage.getItem('token');
  const res = await fetch(`${API_BASE_URL}/api/clouds/${cloudId}/resources/harvester/services${force ? '?force=true' : ''}`, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json', 'Authorization': token ? `Bearer ${token}` : '' },
    credentials: 'include',
  });
  if (!res.ok) throw new Error(await res.text());
  return await res.json();
};

export const fetchHarvesterLoadBalancers = async (cloudId: string, force = false) => {
  const token = localStorage.getItem('token');
  const res = await fetch(`${API_BASE_URL}/api/clouds/${cloudId}/resources/harvester-loadbalancers${force ? '?force=true' : ''}`, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json', 'Authorization': token ? `Bearer ${token}` : '' },
    credentials: 'include',
  });
  if (!res.ok) throw new Error(await res.text());
  return await res.json();
};

export const fetchHarvesterTemplates = async (cloudId: string, force = false) => {
  const token = localStorage.getItem('token');
  const res = await fetch(`${API_BASE_URL}/api/clouds/${cloudId}/resources/harvester/templates${force ? '?force=true' : ''}`, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json', 'Authorization': token ? `Bearer ${token}` : '' },
    credentials: 'include',
  });
  if (!res.ok) throw new Error(await res.text());
  return await res.json();
};

export const fetchHarvesterIPPools = async (cloudId: string, force = false) => {
  const token = localStorage.getItem('token');
  const res = await fetch(`${API_BASE_URL}/api/clouds/${cloudId}/resources/ippools${force ? '?force=true' : ''}`, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json', 'Authorization': token ? `Bearer ${token}` : '' },
    credentials: 'include',
  });
  if (!res.ok) throw new Error(await res.text());
  return await res.json();
};

export const fetchHarvesterNads = (cloudId: string, force = false) => apiRequest(`/api/clouds/${cloudId}/resources/nads${force ? '?force=true' : ''}`);

export const fetchHarvesterClusterNetworks = async (cloudId: string, force = false) => {
  const token = localStorage.getItem('token');
  const res = await fetch(`${API_BASE_URL}/api/clouds/${cloudId}/resources/cluster_networks${force ? '?force=true' : ''}`, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json', 'Authorization': token ? `Bearer ${token}` : '' },
    credentials: 'include',
  });
  if (!res.ok) throw new Error(await res.text());
  return await res.json();
};

export const fetchHarvesterNadDetail = async (cloudId: string, namespace: string, name: string) => {
  const token = localStorage.getItem('token');
  const res = await fetch(`${API_BASE_URL}/api/clouds/${cloudId}/resources/harvester/nads/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}`, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json', 'Authorization': token ? `Bearer ${token}` : '' },
    credentials: 'include',
  });
  if (!res.ok) { throw new Error(await res.text()); }
  return await res.json();
};

export const createHarvesterNad = async (cloudId: string, payload: any) => {
  const token = localStorage.getItem('token');
  const res = await fetch(`${API_BASE_URL}/api/clouds/${cloudId}/resources/harvester/nads`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': token ? `Bearer ${token}` : '' },
    body: JSON.stringify(payload),
    credentials: 'include',
  });
  if (!res.ok) {
    const t = await res.text();
    try {
      const j = JSON.parse(t);
      const msg = j?.message || '请求失败';
      const detail = j?.error ? (typeof j.error === 'string' ? j.error : JSON.stringify(j.error)) : '';
      throw new Error(detail ? `${msg} | ${detail}` : msg);
    } catch (e: any) {
      if (e.message && e.message.includes('|')) throw e;
      throw new Error(t);
    }
  }
  return await res.json();
};

export const deleteHarvesterNad = async (cloudId: string, namespace: string, name: string) => {
  const token = localStorage.getItem('token');
  const res = await fetch(`${API_BASE_URL}/api/clouds/${cloudId}/resources/harvester/nads/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json', 'Authorization': token ? `Bearer ${token}` : '' },
    credentials: 'include',
  });
  if (!res.ok) {
    const t = await res.text();
    try {
      const j = JSON.parse(t);
      const msg = j?.message || '删除失败';
      const detail = j?.error ? (typeof j.error === 'string' ? j.error : JSON.stringify(j.error)) : '';
      throw new Error(detail ? `${msg} | ${detail}` : msg);
    } catch (e: any) {
      if (e.message && e.message.includes('|')) throw e;
      throw new Error(t);
    }
  }
  return await res.json();
};

export const createHarvesterVirtualMachineBackup = async (cloudId: string, namespace: string, payload: { name: string; vmName: string; type: 'backup' | 'snapshot'; alias?: string }) => {
  const token = localStorage.getItem('token');
  const res = await fetch(`${API_BASE_URL}/api/clouds/${cloudId}/resources/harvester/virtualmachinebackups/${encodeURIComponent(namespace)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': token ? `Bearer ${token}` : '' },
    body: JSON.stringify(payload),
    credentials: 'include',
  });
  if (!res.ok) {
    const t = await res.text();
    try {
      const j = JSON.parse(t);
      const msg = j?.message || '请求失败';
      const detail = j?.error ? (typeof j.error === 'string' ? j.error : JSON.stringify(j.error)) : '';
      throw new Error(detail ? `${msg} | ${detail}` : msg);
    } catch (e: any) {
      if (e.message && e.message.includes('|')) throw e;
      throw new Error(t);
    }
  }
  return await res.json();
};

export const createHarvesterVirtualMachineRestore = async (cloudId: string, namespace: string, payload: any) => {
  const token = localStorage.getItem('token');
  const res = await fetch(`${API_BASE_URL}/api/clouds/${cloudId}/resources/harvester/virtualmachinerestores/${encodeURIComponent(namespace)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': token ? `Bearer ${token}` : '' },
    body: JSON.stringify(payload),
    credentials: 'include',
  });
  if (!res.ok) {
    const t = await res.text();
    try {
      const j = JSON.parse(t);
      const msg = j?.message || '请求失败';
      const detail = j?.error ? (typeof j.error === 'string' ? j.error : JSON.stringify(j.error)) : '';
      throw new Error(detail ? `${msg} | ${detail}` : msg);
    } catch (e: any) {
      if (e.message && e.message.includes('|')) throw e;
      throw new Error(t);
    }
  }
  return await res.json();
};

export const fetchHarvesterResourceByLink = async (cloudId: string, path: string) => {
  const token = localStorage.getItem('token');
  const res = await fetch(`${API_BASE_URL}/api/clouds/${cloudId}/resources/harvester/proxy?path=${encodeURIComponent(path)}`, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json', 'Authorization': token ? `Bearer ${token}` : '' },
    credentials: 'include',
  });
  if (!res.ok) throw new Error(await res.text());
  return await res.json();
};

export const fetchHarvesterUsbResources = async (cloudId: string) => {
  const token = localStorage.getItem('token');
  const res = await fetch(`${API_BASE_URL}/api/clouds/${cloudId}/resources/harvester/usb-devices`, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json', 'Authorization': token ? `Bearer ${token}` : '' },
    credentials: 'include',
  });
  if (!res.ok) { throw new Error(await res.text()); }
  return await res.json();
};

export const fetchHarvesterNodeDetail = async (cloudId: string, name: string) => {
  const token = localStorage.getItem('token');
  const res = await fetch(`${API_BASE_URL}/api/clouds/${cloudId}/resources/harvester/nodes/${encodeURIComponent(name)}`, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json', 'Authorization': token ? `Bearer ${token}` : '' },
    credentials: 'include',
  });
  if (!res.ok) { throw new Error(await res.text()); }
  return await res.json();
};

export const fetchHarvesterSystemPods = async (cloudId: string, params: { page: number; pageSize: number; keyword?: string; namespace?: string; status?: string } = { page: 1, pageSize: 1000 }) => {
  const token = localStorage.getItem('token');
  const query = new URLSearchParams({
    page: params.page.toString(),
    pageSize: params.pageSize.toString(),
    ...(params.keyword && { keyword: params.keyword }),
    ...(params.namespace && { namespace: params.namespace }),
    ...(params.status && { status: params.status }),
  }).toString();
  const res = await fetch(`${API_BASE_URL}/api/clouds/${cloudId}/resources/harvester/pods?${query}`, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json', 'Authorization': token ? `Bearer ${token}` : '' },
    credentials: 'include',
  });
  if (!res.ok) { throw new Error(await res.text()); }
  return await res.json();
};

export const fetchCloudProviderOvnEips = async (cloudId: string, force = false) => {
  const token = localStorage.getItem('token');
  const res = await fetch(`${API_BASE_URL}/api/clouds/${cloudId}/resources/ovneips${force ? '?force=true' : ''}`, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json', 'Authorization': token ? `Bearer ${token}` : '' },
    credentials: 'include',
  });
  if (!res.ok) { throw new Error(await res.text()); }
  return await res.json();
};

export const fetchCloudProviderOvnFips = async (cloudId: string, force = false) => {
  const token = localStorage.getItem('token');
  const res = await fetch(`${API_BASE_URL}/api/clouds/${cloudId}/resources/ovnfips${force ? '?force=true' : ''}`, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json', 'Authorization': token ? `Bearer ${token}` : '' },
    credentials: 'include',
  });
  if (!res.ok) { throw new Error(await res.text()); }
  return await res.json();
};

export const fetchCloudProviderOvnSnatRules = async (cloudId: string, force = false) => {
  const token = localStorage.getItem('token');
  const res = await fetch(`${API_BASE_URL}/api/clouds/${cloudId}/resources/ovnsnatrules${force ? '?force=true' : ''}`, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json', 'Authorization': token ? `Bearer ${token}` : '' },
    credentials: 'include',
  });
  if (!res.ok) { throw new Error(await res.text()); }
  return await res.json();
};

export const fetchCloudProviderOvnDnatRules = async (cloudId: string, force = false) => {
  const token = localStorage.getItem('token');
  const res = await fetch(`${API_BASE_URL}/api/clouds/${cloudId}/resources/ovndnatrules${force ? '?force=true' : ''}`, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json', 'Authorization': token ? `Bearer ${token}` : '' },
    credentials: 'include',
  });
  if (!res.ok) { throw new Error(await res.text()); }
  return await res.json();
};

export const createCloudProviderOvnEip = async (cloudId: string, payload: any) => {
  const token = localStorage.getItem('token');
  const res = await fetch(`${API_BASE_URL}/api/clouds/${cloudId}/resources/ovneips`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': token ? `Bearer ${token}` : '' },
    body: JSON.stringify(payload),
    credentials: 'include',
  });
  if (!res.ok) { throw new Error(await res.text()); }
  return await res.json();
};

export const createCloudProviderOvnFip = async (cloudId: string, payload: any) => {
  const token = localStorage.getItem('token');
  const res = await fetch(`${API_BASE_URL}/api/clouds/${cloudId}/resources/ovnfips`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': token ? `Bearer ${token}` : '' },
    body: JSON.stringify(payload),
    credentials: 'include',
  });
  if (!res.ok) { throw new Error(await res.text()); }
  return await res.json();
};

export const createCloudProviderOvnSnatRule = async (cloudId: string, payload: any) => {
  const token = localStorage.getItem('token');
  const res = await fetch(`${API_BASE_URL}/api/clouds/${cloudId}/resources/ovnsnatrules`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': token ? `Bearer ${token}` : '' },
    body: JSON.stringify(payload),
    credentials: 'include',
  });
  if (!res.ok) { throw new Error(await res.text()); }
  return await res.json();
};

export const createCloudProviderOvnDnatRule = async (cloudId: string, payload: any) => {
  const token = localStorage.getItem('token');
  const res = await fetch(`${API_BASE_URL}/api/clouds/${cloudId}/resources/ovndnatrules`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': token ? `Bearer ${token}` : '' },
    body: JSON.stringify(payload),
    credentials: 'include',
  });
  if (!res.ok) { throw new Error(await res.text()); }
  return await res.json();
};

export const deleteCloudProviderOvnEip = async (cloudId: string, name: string) => {
  const token = localStorage.getItem('token');
  const res = await fetch(`${API_BASE_URL}/api/clouds/${cloudId}/resources/ovneips/${encodeURIComponent(name)}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json', 'Authorization': token ? `Bearer ${token}` : '' },
    credentials: 'include',
  });
  if (!res.ok) { throw new Error(await res.text()); }
  return await res.json();
};

export const deleteCloudProviderOvnFip = async (cloudId: string, name: string) => {
  const token = localStorage.getItem('token');
  const res = await fetch(`${API_BASE_URL}/api/clouds/${cloudId}/resources/ovnfips/${encodeURIComponent(name)}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json', 'Authorization': token ? `Bearer ${token}` : '' },
    credentials: 'include',
  });
  if (!res.ok) { throw new Error(await res.text()); }
  return await res.json();
};

export const deleteCloudProviderOvnSnatRule = async (cloudId: string, name: string) => {
  const token = localStorage.getItem('token');
  const res = await fetch(`${API_BASE_URL}/api/clouds/${cloudId}/resources/ovnsnatrules/${encodeURIComponent(name)}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json', 'Authorization': token ? `Bearer ${token}` : '' },
    credentials: 'include',
  });
  if (!res.ok) { throw new Error(await res.text()); }
  return await res.json();
};

export const deleteCloudProviderOvnDnatRule = async (cloudId: string, name: string) => {
  const token = localStorage.getItem('token');
  const res = await fetch(`${API_BASE_URL}/api/clouds/${cloudId}/resources/ovndnatrules/${encodeURIComponent(name)}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json', 'Authorization': token ? `Bearer ${token}` : '' },
    credentials: 'include',
  });
  if (!res.ok) { throw new Error(await res.text()); }
  return await res.json();
};

export const fetchHarvesterEvents = async (cloudId: string, namespace: string, uid: string, name: string, kind: string) => {
  const token = localStorage.getItem('token');
  const query = new URLSearchParams({
    namespace,
    uid,
    name,
    kind,
  }).toString();
  const res = await fetch(`${API_BASE_URL}/api/clouds/${cloudId}/resources/harvester/events?${query}`, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json', 'Authorization': token ? `Bearer ${token}` : '' },
    credentials: 'include',
  });
  if (!res.ok) { throw new Error(await res.text()); }
  return await res.json();
};

export const fetchHarvesterVncUrl = async (cloudId: string, id: string) => {
  const token = localStorage.getItem('token');
  let namespace = 'default';
  let name = id;
  if (id.includes('/')) {
    [namespace, name] = id.split('/');
  }
  const res = await fetch(`${API_BASE_URL}/api/clouds/${cloudId}/resources/harvester/vms/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}/vnc-url`, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json', 'Authorization': token ? `Bearer ${token}` : '' },
    credentials: 'include',
  });
  if (!res.ok) { throw new Error(await res.text()); }
  return await res.json();
};

export const createKubeOvnSubnet = async (cloudId: string, payload: any) => {
  const token = localStorage.getItem('token');
  const res = await fetch(`${API_BASE_URL}/api/clouds/${cloudId}/resources/subnets`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': token ? `Bearer ${token}` : '' },
    body: JSON.stringify(payload),
    credentials: 'include',
  });
  if (!res.ok) { throw new Error(await res.text()); }
  return await res.json();
};

export const updateKubeOvnSubnet = async (cloudId: string, name: string, payload: any) => {
  const token = localStorage.getItem('token');
  const res = await fetch(`${API_BASE_URL}/api/clouds/${cloudId}/resources/subnets/${encodeURIComponent(name)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'Authorization': token ? `Bearer ${token}` : '' },
    body: JSON.stringify(payload),
    credentials: 'include',
  });
  if (!res.ok) { throw new Error(await res.text()); }
  return await res.json();
};

export const deleteKubeOvnSubnet = async (cloudId: string, name: string) => {
  const token = localStorage.getItem('token');
  const res = await fetch(`${API_BASE_URL}/api/clouds/${cloudId}/resources/subnets/${encodeURIComponent(name)}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json', 'Authorization': token ? `Bearer ${token}` : '' },
    credentials: 'include',
  });
  if (!res.ok) { throw new Error(await res.text()); }
  return await res.json();
};

export const fetchHarvesterNamespaces = async (cloudId: string, force = false) => {
  const token = localStorage.getItem('token');
  const res = await fetch(`${API_BASE_URL}/api/clouds/${cloudId}/resources/harvester/namespaces${force ? '?force=true' : ''}`, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json', 'Authorization': token ? `Bearer ${token}` : '' },
    credentials: 'include',
  });
  if (!res.ok) { throw new Error(await res.text()); }
  return await res.json();
};

export const createHarvesterNamespace = async (cloudId: string, payload: { name: string; labels?: Record<string,string>; annotations?: Record<string,string> }) => {
  const token = localStorage.getItem('token');
  const res = await fetch(`${API_BASE_URL}/api/clouds/${cloudId}/resources/harvester/namespaces`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': token ? `Bearer ${token}` : '' },
    body: JSON.stringify(payload || {}),
    credentials: 'include',
  });
  const text = await res.text();
  let json: any = text;
  try { json = JSON.parse(text); } catch {}
  if (!res.ok) {
    throw new Error(typeof json === 'string' ? json : (json?.error || json?.message || '请求失败'));
  }
  return json;
};

export const updateHarvesterNamespace = async (cloudId: string, name: string, payload: { labels?: Record<string,string>; annotations?: Record<string,string> }) => {
  const token = localStorage.getItem('token');
  const res = await fetch(`${API_BASE_URL}/api/clouds/${cloudId}/resources/harvester/namespaces/${encodeURIComponent(name)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', 'Authorization': token ? `Bearer ${token}` : '' },
    body: JSON.stringify(payload || {}),
    credentials: 'include',
  });
  const text = await res.text();
  let json: any = text;
  try { json = JSON.parse(text); } catch {}
  if (!res.ok) {
    throw new Error(typeof json === 'string' ? json : (json?.error || json?.message || '请求失败'));
  }
  return json;
};

export const deleteHarvesterNamespace = async (cloudId: string, name: string) => {
  const token = localStorage.getItem('token');
  const res = await fetch(`${API_BASE_URL}/api/clouds/${cloudId}/resources/harvester/namespaces/${encodeURIComponent(name)}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json', 'Authorization': token ? `Bearer ${token}` : '' },
    credentials: 'include',
  });
  if (!res.ok) {
    const text = await res.text();
    try {
      const json = JSON.parse(text);
      throw new Error(json?.message || json?.error || text);
    } catch {
      throw new Error(text);
    }
  }
  return await res.json();
};

export const fetchHarvesterVolumes = async (cloudId: string, force = false) => {
  const token = localStorage.getItem('token');
  const url = `${API_BASE_URL}/api/clouds/${cloudId}/resources/harvester/volumes${force ? '?force=true' : ''}`;
  const res = await fetch(url, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json', 'Authorization': token ? `Bearer ${token}` : '' },
    credentials: 'include',
  });
  if (!res.ok) { throw new Error(await res.text()); }
  return await res.json();
};

export const fetchHarvesterAvailableVolumes = async (cloudId: string, namespace?: string) => {
  const token = localStorage.getItem('token');
  const qs = namespace ? `?namespace=${encodeURIComponent(namespace)}` : '';
  const res = await fetch(`${API_BASE_URL}/api/clouds/${cloudId}/resources/harvester/available-volumes${qs}`, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json', 'Authorization': token ? `Bearer ${token}` : '' },
    credentials: 'include',
  });
  if (!res.ok) { throw new Error(await res.text()); }
  return await res.json();
};

export const fetchHarvesterStorageClasses = async (cloudId: string, force = false) => {
  const token = localStorage.getItem('token');
  const res = await fetch(`${API_BASE_URL}/api/clouds/${cloudId}/resources/harvester/storage-classes${force ? '?force=true' : ''}`, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json', 'Authorization': token ? `Bearer ${token}` : '' },
    credentials: 'include',
  });
  if (!res.ok) { throw new Error(await res.text()); }
  return await res.json();
};

export const fetchHarvesterStorageClassDetail = async (cloudId: string, name: string) => {
  const token = localStorage.getItem('token');
  const res = await fetch(`${API_BASE_URL}/api/clouds/${cloudId}/resources/harvester/storage-classes/${encodeURIComponent(name)}`, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json', 'Authorization': token ? `Bearer ${token}` : '' },
    credentials: 'include',
  });
  if (!res.ok) { throw new Error(await res.text()); }
  return await res.json();
};

export const fetchHarvesterImages = async (cloudId: string, force = false) => {
  const token = localStorage.getItem('token');
  const url = `${API_BASE_URL}/api/clouds/${cloudId}/resources/harvester/images${force ? '?force=true' : ''}`;
  const res = await fetch(url, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json', 'Authorization': token ? `Bearer ${token}` : '' },
    credentials: 'include',
  });
  if (!res.ok) { throw new Error(await res.text()); }
  return await res.json();
};

export const fetchHarvesterImageDetail = async (cloudId: string, namespace: string, name: string) => {
  const token = localStorage.getItem('token');
  const res = await fetch(`${API_BASE_URL}/api/clouds/${cloudId}/resources/harvester/images/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}`, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json', 'Authorization': token ? `Bearer ${token}` : '' },
    credentials: 'include',
  });
  if (!res.ok) { throw new Error(await res.text()); }
  return await res.json();
};

export const attachHarvesterVolumeToVm = async (
  cloudId: string,
  instanceId: string,
  payload: { name: string; bus?: string; pvcNamespace: string; pvcName: string }
) => {
  const token = localStorage.getItem('token');
  const res = await fetch(`${API_BASE_URL}/api/clouds/${cloudId}/resources/harvester/vms/${encodeURIComponent(instanceId)}/add-volume`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': token ? `Bearer ${token}` : '' },
    body: JSON.stringify(payload),
    credentials: 'include',
  });
  if (!res.ok) { throw new Error(await res.text()); }
  return await res.json();
};

export const fetchHarvesterVolume = async (cloudId: string, namespace: string, name: string) => {
  const token = localStorage.getItem('token');
  const res = await fetch(`${API_BASE_URL}/api/clouds/${cloudId}/resources/harvester/volumes/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}`, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json', 'Authorization': token ? `Bearer ${token}` : '' },
    credentials: 'include',
  });
  if (!res.ok) { throw new Error(await res.text()); }
  return await res.json();
};

export const attachHarvesterVolumeToVmByName = async (
  cloudId: string,
  vmNamespace: string,
  vmName: string,
  payload: { name?: string; diskName?: string; bus?: string; pvcNamespace: string; pvcName: string }
) => {
  const token = localStorage.getItem('token');
  const res = await fetch(`${API_BASE_URL}/api/clouds/${cloudId}/resources/harvester/vms/${encodeURIComponent(vmNamespace)}/${encodeURIComponent(vmName)}/add-volume`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': token ? `Bearer ${token}` : '' },
    body: JSON.stringify(payload),
    credentials: 'include',
  });
  if (!res.ok) { const t=await res.text(); try{ const j=JSON.parse(t); throw new Error(String(j?.message||j?.error||t)); }catch{ throw new Error(t);} }
  return await res.json();
};

export const exportHarvesterImageFromVolume = async (cloudId: string, namespace: string, pvcName: string, payload: { displayName?: string; targetStorageClassName?: string; namespace?: string }) => {
  const token = localStorage.getItem('token');
  const res = await fetch(`${API_BASE_URL}/api/clouds/${cloudId}/resources/harvester/volumes/${encodeURIComponent(namespace)}/${encodeURIComponent(pvcName)}/export-image`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': token ? `Bearer ${token}` : '' }, body: JSON.stringify(payload||{}), credentials: 'include'
  });
  if (!res.ok) { const t=await res.text(); try{ const j=JSON.parse(t); throw new Error(String(j?.message||j?.error||t)); }catch{ throw new Error(t);} }
  return await res.json();
};

export const createHarvesterVolumeSnapshot = async (cloudId: string, namespace: string, pvcName: string, payload: { name?: string; snapshotClassName?: string; alias?: string }) => {
  const token = localStorage.getItem('token');
  const res = await fetch(`${API_BASE_URL}/api/clouds/${cloudId}/resources/harvester/volumes/${encodeURIComponent(namespace)}/${encodeURIComponent(pvcName)}/snapshots`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': token ? `Bearer ${token}` : '' }, body: JSON.stringify(payload||{}), credentials: 'include'
  });
  if (!res.ok) { const t=await res.text(); try{ const j=JSON.parse(t); throw new Error(String(j?.message||j?.error||t)); }catch{ throw new Error(t);} }
  return await res.json();
};

export const restoreHarvesterVolumeSnapshot = async (cloudId: string, namespace: string, snapshotName: string, payload: { name: string; storageClassName?: string; size?: string; accessModes?: string[]; volumeMode?: string }) => {
  const token = localStorage.getItem('token');
  const res = await fetch(`${API_BASE_URL}/api/clouds/${cloudId}/resources/harvester/snapshots/${encodeURIComponent(namespace)}/${encodeURIComponent(snapshotName)}/restore`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': token ? `Bearer ${token}` : '' }, body: JSON.stringify(payload||{}), credentials: 'include'
  });
  if (!res.ok) { const t=await res.text(); try{ const j=JSON.parse(t); throw new Error(String(j?.message||j?.error||t)); }catch{ throw new Error(t);} }
  return await res.json();
};

export const listHarvesterSnapshotClasses = async (cloudId: string) => {
  const token = localStorage.getItem('token');
  const res = await fetch(`${API_BASE_URL}/api/clouds/${cloudId}/resources/harvester/snapshot-classes`, {
    headers: { 'Authorization': token ? `Bearer ${token}` : '' }, credentials: 'include'
  });
  if (!res.ok) { const t=await res.text(); try{ const j=JSON.parse(t); throw new Error(String(j?.message||j?.error||t)); }catch{ throw new Error(t);} }
  return await res.json();
};

export const updateHarvesterVolume = async (cloudId: string, namespace: string, pvcName: string, payload: { sizeGi?: number; size?: string; accessModes?: string[]; volumeMode?: string; storageClassName?: string; annotations?: Record<string,string>; labels?: Record<string,string> }) => {
  const token = localStorage.getItem('token');
  const res = await fetch(`${API_BASE_URL}/api/clouds/${cloudId}/resources/harvester/volumes/${encodeURIComponent(namespace)}/${encodeURIComponent(pvcName)}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json', 'Authorization': token ? `Bearer ${token}` : '' }, body: JSON.stringify(payload||{}), credentials: 'include'
  });
  if (!res.ok) { const t=await res.text(); try{ const j=JSON.parse(t); throw new Error(String(j?.message||j?.error||t)); }catch{ throw new Error(t);} }
  return await res.json();
};

export const cloneHarvesterVolume = async (cloudId: string, namespace: string, pvcName: string, payload: { targetNamespace?: string; newName: string; sizeGi?: number; size?: string; storageClassName?: string; fromSnapshotName?: string; accessModes?: string[]; volumeMode?: string }) => {
  const token = localStorage.getItem('token');
  const res = await fetch(`${API_BASE_URL}/api/clouds/${cloudId}/resources/harvester/volumes/${encodeURIComponent(namespace)}/${encodeURIComponent(pvcName)}/clone`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': token ? `Bearer ${token}` : '' }, body: JSON.stringify(payload||{}), credentials: 'include'
  });
  if (!res.ok) { const t=await res.text(); try{ const j=JSON.parse(t); throw new Error(String(j?.message||j?.error||t)); }catch{ throw new Error(t);} }
  return await res.json();
};

export const detachHarvesterVolumeFromVm = async (
  cloudId: string,
  instanceId: string,
  payload: { name: string }
) => {
  const token = localStorage.getItem('token');
  const res = await fetch(`${API_BASE_URL}/api/clouds/${cloudId}/resources/harvester/vms/${encodeURIComponent(instanceId)}/remove-volume`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': token ? `Bearer ${token}` : '' },
    body: JSON.stringify(payload),
    credentials: 'include',
  });
  if (!res.ok) { throw new Error(await res.text()); }
  return await res.json();
};

export const deleteHarvesterVolume = async (cloudId: string, namespace: string, name: string) => {
  const token = localStorage.getItem('token');
  const res = await fetch(`${API_BASE_URL}/api/clouds/${cloudId}/resources/harvester/volumes/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json', 'Authorization': token ? `Bearer ${token}` : '' },
    credentials: 'include',
  });
  if (!res.ok) {
    const text = await res.text();
    try {
      const json = JSON.parse(text);
      throw new Error(String(json?.message || json?.error || text));
    } catch {
      throw new Error(text);
    }
  }
  return await res.json();
};

export const deleteHarvesterImage = async (cloudId: string, namespace: string, name: string) => {
  const token = localStorage.getItem('token');
  const res = await fetch(`${API_BASE_URL}/api/clouds/${cloudId}/resources/harvester/images/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json', 'Authorization': token ? `Bearer ${token}` : '' },
    credentials: 'include',
  });
  if (!res.ok) { throw new Error(await res.text()); }
  return await res.json();
};


export const createHarvesterVolume = async (cloudId: string, payload: { namespace: string; name: string; sizeGi?: number; size?: string; accessModes?: string[]; volumeMode?: string; storageClassName?: string; annotations?: Record<string,string> }) => {
  const token = localStorage.getItem('token');
  const res = await fetch(`${API_BASE_URL}/api/clouds/${cloudId}/resources/harvester/volumes`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': token ? `Bearer ${token}` : '' }, body: JSON.stringify(payload), credentials: 'include'
  });
  if (!res.ok) {
    const text = await res.text();
    try { const json = JSON.parse(text); throw new Error(String(json?.message || json?.error || text)); } catch { throw new Error(text); }
  }
  return await res.json();
};

export const createHarvesterImage = async (cloudId: string, payload: { namespace: string; name?: string; displayName?: string; sourceType?: string; url?: string; targetStorageClassName?: string; storageClassParameters?: Record<string,string> }) => {
  const token = localStorage.getItem('token');
  const res = await fetch(`${API_BASE_URL}/api/clouds/${cloudId}/resources/harvester/images`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': token ? `Bearer ${token}` : '' },
    body: JSON.stringify(payload),
    credentials: 'include',
  });
  if (!res.ok) { throw new Error(await res.text()); }
  return await res.json();
};

export const updateHarvesterImage = async (cloudId: string, namespace: string, name: string, payload: { displayName?: string; retry?: number; targetStorageClassName?: string; storageClassParameters?: Record<string,string> }) => {
  const token = localStorage.getItem('token');
  const res = await fetch(`${API_BASE_URL}/api/clouds/${cloudId}/resources/harvester/images/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'Authorization': token ? `Bearer ${token}` : '' },
    body: JSON.stringify(payload),
    credentials: 'include',
  });
  if (!res.ok) { throw new Error(await res.text()); }
  return await res.json();
};

export const fetchHarvesterNodes = async (cloudId: string, force = false) => {
  const token = localStorage.getItem('token');
  const res = await fetch(`${API_BASE_URL}/api/clouds/${cloudId}/resources/harvester/nodes${force ? '?force=true' : ''}`, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json', 'Authorization': token ? `Bearer ${token}` : '' },
    credentials: 'include',
  });
  if (!res.ok) { throw new Error(await res.text()); }
  return await res.json();
};

export const fetchHarvesterHealth = async (cloudId: string) => {
  const token = localStorage.getItem('token');
  const res = await fetch(`${API_BASE_URL}/api/clouds/${cloudId}/resources/harvester/health`, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json', 'Authorization': token ? `Bearer ${token}` : '' },
    credentials: 'include',
  });
  if (!res.ok) { throw new Error(await res.text()); }
  return await res.json();
};

export const fetchHarvesterVmDetail = async (cloudId: string, namespace: string, name: string) => {
  const token = localStorage.getItem('token');
  const res = await fetch(`${API_BASE_URL}/api/clouds/${cloudId}/resources/harvester/vms/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}`, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json', 'Authorization': token ? `Bearer ${token}` : '' },
    credentials: 'include',
  });
  if (!res.ok) { throw new Error(await res.text()); }
  return await res.json();
};

export const fetchKubeOvnVpcs = async (cloudId: string, force = false) => {
  const token = localStorage.getItem('token');
  const res = await fetch(`${API_BASE_URL}/api/clouds/${cloudId}/resources/vpcs${force ? '?force=true' : ''}`, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json', 'Authorization': token ? `Bearer ${token}` : '' },
    credentials: 'include',
  });
  if (!res.ok) { throw new Error(await res.text()); }
  return await res.json();
};

export const fetchKubeOvnSubnets = async (cloudId: string, force = false) => {
  const token = localStorage.getItem('token');
  const res = await fetch(`${API_BASE_URL}/api/clouds/${cloudId}/resources/subnets${force ? '?force=true' : ''}`, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json', 'Authorization': token ? `Bearer ${token}` : '' },
    credentials: 'include',
  });
  if (!res.ok) { throw new Error(await res.text()); }
  return await res.json();
};

export const fetchHarvesterGpuResources = async (cloudId: string, force = false) => {
  const token = localStorage.getItem('token');
  const res = await fetch(`${API_BASE_URL}/api/clouds/${cloudId}/resources/harvester/gpus${force ? '?force=true' : ''}`, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json', 'Authorization': token ? `Bearer ${token}` : '' },
    credentials: 'include',
  });
  if (!res.ok) { throw new Error(await res.text()); }
  return await res.json();
};

export const fetchHarvesterCapabilities = async (cloudId: string) => {
  const token = localStorage.getItem('token');
  const res = await fetch(`${API_BASE_URL}/api/clouds/${cloudId}/resources/harvester/capabilities`, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json', 'Authorization': token ? `Bearer ${token}` : '' },
    credentials: 'include',
  });
  if (!res.ok) { throw new Error(await res.text()); }
  return await res.json();
};

export const updateHarvesterVmSpec = async (cloudId: string, namespace: string, name: string, payload: any) => {
  const token = localStorage.getItem('token');
  const res = await fetch(`${API_BASE_URL}/api/clouds/${cloudId}/resources/harvester/vms/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}/update-spec`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': token ? `Bearer ${token}` : '' },
    body: JSON.stringify(payload),
    credentials: 'include',
  });
  if (!res.ok) { throw new Error(await res.text()); }
  return await res.json();
};

export const createHarvesterVm = async (cloudId: string, payload: any) => {
  const token = localStorage.getItem('token');
  const res = await fetch(`${API_BASE_URL}/api/clouds/${cloudId}/resources/harvester/vms`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': token ? `Bearer ${token}` : '' },
    body: JSON.stringify(payload),
    credentials: 'include',
  });
  if (!res.ok) { 
    const t = await res.text(); 
    try { const j = JSON.parse(t); throw new Error(String(j?.message || j?.error || t)); } catch { throw new Error(t); } 
  }
  return await res.json();
};

export const patchHarvesterVm = async (cloudId: string, namespace: string, name: string, payload: any) => {
  const token = localStorage.getItem('token');
  const res = await fetch(`${API_BASE_URL}/api/clouds/${cloudId}/resources/harvester/vms/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', 'Authorization': token ? `Bearer ${token}` : '' },
    body: JSON.stringify(payload),
    credentials: 'include',
  });
  if (!res.ok) { throw new Error(await res.text()); }
  return await res.json();
};

export const stopHarvesterVm = async (cloudId: string, namespace: string, name: string, force = false) => {
  const token = localStorage.getItem('token');
  const res = await fetch(`${API_BASE_URL}/api/clouds/${cloudId}/resources/harvester/vms/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}/stop`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': token ? `Bearer ${token}` : '' },
    body: JSON.stringify({ force }),
    credentials: 'include',
  });
  if (!res.ok) { throw new Error(await res.text()); }
  return await res.json();
};

export const startHarvesterVm = async (cloudId: string, namespace: string, name: string) => {
  const token = localStorage.getItem('token');
  const res = await fetch(`${API_BASE_URL}/api/clouds/${cloudId}/resources/harvester/vms/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': token ? `Bearer ${token}` : '' },
    credentials: 'include',
  });
  if (!res.ok) { throw new Error(await res.text()); }
  return await res.json();
};

// --- Added Delete Functions ---

export const deleteHarvesterBackup = async (cloudId: string, namespace: string, name: string) => {
  const token = localStorage.getItem('token');
  const res = await fetch(`${API_BASE_URL}/api/clouds/${cloudId}/resources/harvester/backups/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json', 'Authorization': token ? `Bearer ${token}` : '' },
    credentials: 'include',
  });
  if (!res.ok) { throw new Error(await res.text()); }
  return await res.json();
};

export const deleteHarvesterSnapshot = async (cloudId: string, namespace: string, name: string) => {
  const token = localStorage.getItem('token');
  const res = await fetch(`${API_BASE_URL}/api/clouds/${cloudId}/resources/harvester/snapshots/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json', 'Authorization': token ? `Bearer ${token}` : '' },
    credentials: 'include',
  });
  if (!res.ok) { throw new Error(await res.text()); }
  return await res.json();
};

export const deleteHarvesterSshKey = async (cloudId: string, namespace: string, name: string) => {
  const token = localStorage.getItem('token');
  const res = await fetch(`${API_BASE_URL}/api/clouds/${cloudId}/resources/harvester/sshkeys/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json', 'Authorization': token ? `Bearer ${token}` : '' },
    credentials: 'include',
  });
  if (!res.ok) { throw new Error(await res.text()); }
  return await res.json();
};

export const deleteHarvesterCloudInit = async (cloudId: string, namespace: string, name: string) => {
  const token = localStorage.getItem('token');
  const res = await fetch(`${API_BASE_URL}/api/clouds/${cloudId}/resources/harvester/cloudinits/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json', 'Authorization': token ? `Bearer ${token}` : '' },
    credentials: 'include',
  });
  if (!res.ok) { throw new Error(await res.text()); }
  return await res.json();
};

export const deleteHarvesterIngress = async (cloudId: string, namespace: string, name: string) => {
  const token = localStorage.getItem('token');
  const res = await fetch(`${API_BASE_URL}/api/clouds/${cloudId}/resources/harvester/ingresses/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json', 'Authorization': token ? `Bearer ${token}` : '' },
    credentials: 'include',
  });
  if (!res.ok) { throw new Error(await res.text()); }
  return await res.json();
};

export const deleteHarvesterService = async (cloudId: string, namespace: string, name: string) => {
  const token = localStorage.getItem('token');
  const res = await fetch(`${API_BASE_URL}/api/clouds/${cloudId}/resources/harvester/services/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json', 'Authorization': token ? `Bearer ${token}` : '' },
    credentials: 'include',
  });
  if (!res.ok) { throw new Error(await res.text()); }
  return await res.json();
};

export const createHarvesterIPPool = async (cloudId: string, payload: any) => {
  const token = localStorage.getItem('token');
  const res = await fetch(`${API_BASE_URL}/api/clouds/${cloudId}/resources/ippools`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': token ? `Bearer ${token}` : '' },
    body: JSON.stringify(payload),
    credentials: 'include',
  });
  if (!res.ok) {
    const text = await res.text();
    let json: any = text;
    try { json = JSON.parse(text); } catch {}
    throw new Error(typeof json === 'string' ? json : (json?.message || json?.error || '创建失败'));
  }
  return await res.json();
};

export const deleteHarvesterIpPool = async (cloudId: string, name: string) => {
  const token = localStorage.getItem('token');
  // IpPool is usually cluster-scoped (no namespace in URL usually, but check Harvester API)
  // Harvester IPPool: apis/loadbalancer.harvesterhci.io/v1beta1/ippools/{name}
  // Our backend likely maps it. Assuming standard resource path structure.
  // Note: IpPools are cluster scoped.
  const res = await fetch(`${API_BASE_URL}/api/clouds/${cloudId}/resources/ippools/${encodeURIComponent(name)}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json', 'Authorization': token ? `Bearer ${token}` : '' },
    credentials: 'include',
  });
  if (!res.ok) {
    const text = await res.text();
    try {
      const json = JSON.parse(text);
      // Backend returns { message: "...", error: "..." }
      // If error is a stringified JSON, we might want to keep it or parse it, but here we just throw the best message we have.
      throw new Error(json?.error || json?.message || text);
    } catch (e: any) {
      // If we just threw an error above, rethrow it
      if (e.message !== text && (e.message === JSON.parse(text)?.error || e.message === JSON.parse(text)?.message)) {
         throw e;
      }
      throw new Error(text);
    }
  }
  return await res.json();
};
