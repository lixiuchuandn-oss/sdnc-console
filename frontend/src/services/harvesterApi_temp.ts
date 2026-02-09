import { API_BASE_URL, apiRequest, apiPost, apiDelete, apiPatch } from './api';

export const fetchHarvesterSnapshots = async (cloudId: string) => {
  const token = localStorage.getItem('token');
  const res = await fetch(`${API_BASE_URL}/api/clouds/${cloudId}/resources/harvester/snapshots`, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json', 'Authorization': token ? `Bearer ${token}` : '' },
    credentials: 'include',
  });
  if (!res.ok) throw new Error(await res.text());
  return await res.json();
};

export const fetchHarvesterBackups = async (cloudId: string) => {
  const token = localStorage.getItem('token');
  const res = await fetch(`${API_BASE_URL}/api/clouds/${cloudId}/resources/harvester/backups`, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json', 'Authorization': token ? `Bearer ${token}` : '' },
    credentials: 'include',
  });
  if (!res.ok) throw new Error(await res.text());
  return await res.json();
};

export const fetchHarvesterSshKeys = async (cloudId: string) => {
  const token = localStorage.getItem('token');
  const res = await fetch(`${API_BASE_URL}/api/clouds/${cloudId}/resources/harvester/sshkeys`, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json', 'Authorization': token ? `Bearer ${token}` : '' },
    credentials: 'include',
  });
  if (!res.ok) throw new Error(await res.text());
  return await res.json();
};

export const fetchHarvesterCloudInits = async (cloudId: string) => {
  const token = localStorage.getItem('token');
  const res = await fetch(`${API_BASE_URL}/api/clouds/${cloudId}/resources/harvester/cloudinits`, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json', 'Authorization': token ? `Bearer ${token}` : '' },
    credentials: 'include',
  });
  if (!res.ok) throw new Error(await res.text());
  return await res.json();
};

export const fetchHarvesterIngresses = async (cloudId: string) => {
  const token = localStorage.getItem('token');
  const res = await fetch(`${API_BASE_URL}/api/clouds/${cloudId}/resources/harvester/ingresses`, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json', 'Authorization': token ? `Bearer ${token}` : '' },
    credentials: 'include',
  });
  if (!res.ok) throw new Error(await res.text());
  return await res.json();
};

export const fetchHarvesterNads = (cloudId: string, force = false) => apiRequest(`/api/clouds/${cloudId}/resources/nads${force ? '?force=true' : ''}`);

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

export const fetchHarvesterNamespaces = async (cloudId: string) => {
  const token = localStorage.getItem('token');
  const res = await fetch(`${API_BASE_URL}/api/clouds/${cloudId}/resources/harvester/namespaces`, {
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

export const fetchHarvesterVolumes = async (cloudId: string) => {
  const token = localStorage.getItem('token');
  const res = await fetch(`${API_BASE_URL}/api/clouds/${cloudId}/resources/harvester/volumes`, {
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

export const fetchHarvesterStorageClasses = async (cloudId: string) => {
  const token = localStorage.getItem('token');
  const res = await fetch(`${API_BASE_URL}/api/clouds/${cloudId}/resources/harvester/storage-classes`, {
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

export const fetchHarvesterImages = async (cloudId: string) => {
  const token = localStorage.getItem('token');
  const res = await fetch(`${API_BASE_URL}/api/clouds/${cloudId}/resources/harvester/images`, {
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

export const exportHarvesterImageFromVolume = async (cloudId: string, namespace: string, pvcName: string, payload: { displayName?: string; targetStorageClassName?: string }) => {
  const token = localStorage.getItem('token');
  const res = await fetch(`${API_BASE_URL}/api/clouds/${cloudId}/resources/harvester/volumes/${encodeURIComponent(namespace)}/${encodeURIComponent(pvcName)}/export-image`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': token ? `Bearer ${token}` : '' }, body: JSON.stringify(payload||{}), credentials: 'include'
  });
  if (!res.ok) { const t=await res.text(); try{ const j=JSON.parse(t); throw new Error(String(j?.message||j?.error||t)); }catch{ throw new Error(t);} }
  return await res.json();
};

export const createHarvesterVolumeSnapshot = async (cloudId: string, namespace: string, pvcName: string, payload: { name?: string; snapshotClassName?: string }) => {
  const token = localStorage.getItem('token');
  const res = await fetch(`${API_BASE_URL}/api/clouds/${cloudId}/resources/harvester/volumes/${encodeURIComponent(namespace)}/${encodeURIComponent(pvcName)}/snapshots`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': token ? `Bearer ${token}` : '' }, body: JSON.stringify(payload||{}), credentials: 'include'
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


export const createHarvesterVolume = async (cloudId: string, payload: { namespace: string; name: string; sizeGi?: number; size?: string; accessModes?: string[]; volumeMode?: string; storageClassName?: string }) => {
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

export const fetchHarvesterNodes = async (cloudId: string) => {
  const token = localStorage.getItem('token');
  try {
    const res = await fetch(`${API_BASE_URL}/api/clouds/${cloudId}/resources/harvester/nodes`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json', 'Authorization': token ? `Bearer ${token}` : '' },
      credentials: 'include',
    });
    if (!res.ok) {
      const errorText = await res.text();
      console.error('Harvester nodes fetch failed', res.status, errorText);
      throw new Error(`Harvester 节点查询失败：${res.status} ${errorText}`);
    }
    return await res.json();
  } catch (e: any) {
    console.error('Harvester nodes fetch error', e);
    throw e;
  }
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

export const fetchKubeOvnVpcs = async (cloudId: string) => {
  const token = localStorage.getItem('token');
  const res = await fetch(`${API_BASE_URL}/api/clouds/${cloudId}/resources/vpcs`, {
    method: 'GET', headers: { 'Content-Type': 'application/json', 'Authorization': token ? `Bearer ${token}` : '' }, credentials: 'include'
  });
  if (!res.ok) throw new Error(await res.text());
  return await res.json();
};

export const fetchKubeOvnSubnets = async (cloudId: string) => {
  const token = localStorage.getItem('token');
  const res = await fetch(`${API_BASE_URL}/api/clouds/${cloudId}/resources/subnets`, {
    method: 'GET', headers: { 'Content-Type': 'application/json', 'Authorization': token ? `Bearer ${token}` : '' }, credentials: 'include'
  });
  if (!res.ok) throw new Error(await res.text());
  return await res.json();
};

export const fetchHarvesterGpuResources = async (cloudId: string) => {
  const token = localStorage.getItem('token');
  const res = await fetch(`${API_BASE_URL}/api/clouds/${cloudId}/resources/harvester/gpus`, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json', 'Authorization': token ? `Bearer ${token}` : '' },
    credentials: 'include',
  });
  if (!res.ok) throw new Error(await res.text());
  return await res.json();
};

export const fetchHarvesterVncUrl = async (cloudId: string, instanceId: string) => {
  const token = localStorage.getItem('token');
  const res = await fetch(`${API_BASE_URL}/api/clouds/${cloudId}/resources/ecs/${encodeURIComponent(instanceId)}/vnc-url`, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json', 'Authorization': token ? `Bearer ${token}` : '' },
    credentials: 'include',
  });
  if (!res.ok) { throw new Error(await res.text()); }
  return await res.json();
};

export const fetchHarvesterUsbResources = async (cloudId: string) => {
  const token = localStorage.getItem('token');
  const res = await fetch(`${API_BASE_URL}/api/clouds/${cloudId}/resources/harvester/usb`, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json', 'Authorization': token ? `Bearer ${token}` : '' },
    credentials: 'include',
  });
  if (!res.ok) { throw new Error(await res.text()); }
  return await res.json();
};

export const fetchHarvesterSystemPods = async (cloudId: string) => {
  const token = localStorage.getItem('token');
  const res = await fetch(`${API_BASE_URL}/api/clouds/${cloudId}/resources/harvester/system-pods`, {
    method: 'GET', headers: { 'Content-Type': 'application/json', 'Authorization': token ? `Bearer ${token}` : '' }, credentials: 'include'
  });
  if (!res.ok) throw new Error(await res.text());
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

export const fetchCloudProviderOvnEips = async (cloudId: string) => {
  const token = localStorage.getItem('token');
  const res = await fetch(`${API_BASE_URL}/api/clouds/${cloudId}/resources/ovneips`, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json', 'Authorization': token ? `Bearer ${token}` : '' },
    credentials: 'include'
  });
  if (!res.ok) throw new Error(await res.text());
  return await res.json();
};

export const createKubeOvnSubnet = async (cloudId: string, payload: any) => {
  const token = localStorage.getItem('token');
  const res = await fetch(`${API_BASE_URL}/api/clouds/${cloudId}/resources/subnets`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': token ? `Bearer ${token}` : '' },
    body: JSON.stringify(payload),
    credentials: 'include'
  });
  if (!res.ok) throw new Error(await res.text());
  return await res.json();
};

export const deleteKubeOvnSubnet = async (cloudId: string, name: string) => {
  const token = localStorage.getItem('token');
  const res = await fetch(`${API_BASE_URL}/api/clouds/${cloudId}/resources/subnets/${name}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json', 'Authorization': token ? `Bearer ${token}` : '' },
    credentials: 'include'
  });
  if (!res.ok) throw new Error(await res.text());
  return await res.json();
};

export const updateKubeOvnSubnet = async (cloudId: string, name: string, payload: any) => {
  const token = localStorage.getItem('token');
  const res = await fetch(`${API_BASE_URL}/api/clouds/${cloudId}/resources/subnets/${name}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'Authorization': token ? `Bearer ${token}` : '' },
    body: JSON.stringify(payload),
    credentials: 'include'
  });
  if (!res.ok) throw new Error(await res.text());
  return await res.json();
};

export const createCloudProviderOvnEip = async (cloudId: string, payload: { name: string, externalSubnet: string, v4Ip?: string, type?: string }) => {
  const token = localStorage.getItem('token');
  const res = await fetch(`${API_BASE_URL}/api/clouds/${cloudId}/resources/ovneips`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': token ? `Bearer ${token}` : '' },
    body: JSON.stringify(payload),
    credentials: 'include'
  });
  if (!res.ok) throw new Error(await res.text());
  return await res.json();
};

export const fetchCloudProviderOvnFips = async (cloudId: string) => {
  const token = localStorage.getItem('token');
  const res = await fetch(`${API_BASE_URL}/api/clouds/${cloudId}/resources/ovnfips`, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json', 'Authorization': token ? `Bearer ${token}` : '' },
    credentials: 'include'
  });
  if (!res.ok) throw new Error(await res.text());
  return await res.json();
};

export const fetchCloudProviderOvnSnatRules = async (cloudId: string) => {
  const token = localStorage.getItem('token');
  const res = await fetch(`${API_BASE_URL}/api/clouds/${cloudId}/resources/ovnsnatrules`, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json', 'Authorization': token ? `Bearer ${token}` : '' },
    credentials: 'include'
  });
  if (!res.ok) throw new Error(await res.text());
  return await res.json();
};

export const fetchCloudProviderOvnDnatRules = async (cloudId: string) => {
  const token = localStorage.getItem('token');
  const res = await fetch(`${API_BASE_URL}/api/clouds/${cloudId}/resources/ovndnatrules`, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json', 'Authorization': token ? `Bearer ${token}` : '' },
    credentials: 'include'
  });
  if (!res.ok) throw new Error(await res.text());
  return await res.json();
};

export const fetchCloudProviderSwitchLbRules = async (cloudId: string) => {
  const token = localStorage.getItem('token');
  const res = await fetch(`${API_BASE_URL}/api/clouds/${cloudId}/resources/switch-lbrules`, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json', 'Authorization': token ? `Bearer ${token}` : '' },
    credentials: 'include'
  });
  if (!res.ok) throw new Error(await res.text());
  return await res.json();
};

export const fetchHarvesterEvents = async (
  cloudId: string,
  namespace?: string,
  uid?: string,
  name?: string,
  kind?: string
) => {
  const params = new URLSearchParams();
  if (namespace) params.append('namespace', namespace);
  if (uid) params.append('uid', uid);
  if (name) params.append('name', name);
  if (kind) params.append('kind', kind);
  
  return await apiRequest(`/api/clouds/${cloudId}/resources/harvester/events?${params.toString()}`);
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

export const fetchHarvesterVmVncUrl = async (cloudId: string, namespace: string, name: string) => {
  const token = localStorage.getItem('token');
  const res = await fetch(`${API_BASE_URL}/api/clouds/${cloudId}/resources/harvester/vms/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}/vnc-url`, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json', 'Authorization': token ? `Bearer ${token}` : '' },
    credentials: 'include',
  });
  if (!res.ok) { throw new Error(await res.text()); }
  return await res.json();
};

export const updateHarvesterVmSpec = async (
  cloudId: string,
  namespace: string,
  name: string,
  payload: { cpu?: number; memory?: string; runStrategy?: 'Always'|'Manual'|'RerunOnFailure'|'Halted'; cpuSockets?: number; cpuCores?: number; cpuThreads?: number; dedicatedCPUPlacement?: boolean; cpuRequest?: number; cpuLimit?: number; memoryLimit?: string; gpuMode?: 'passthrough'|'vgpu'|'sriov'; gpuResourceName?: string; gpuCount?: number }
) => {
  const token = localStorage.getItem('token');
  const res = await fetch(`${API_BASE_URL}/api/clouds/${cloudId}/resources/harvester/vms/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}/spec`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', 'Authorization': token ? `Bearer ${token}` : '' },
    body: JSON.stringify(payload || {}),
    credentials: 'include',
  });
  if (!res.ok) { const t = await res.text(); try { const j = JSON.parse(t); throw new Error(String(j?.message || j?.error || t)); } catch { throw new Error(t); } }
  return await res.json();
};

export const createHarvesterVm = async (
  cloudId: string,
  payload: {
    namespace: string;
    name: string;
    cpu: number;
    memory: string;
    image: string;
    networks?: string[];
    userData?: string;
    systemDiskSize?: string;
    storageClassName?: string;
    nodeName?: string;
    nodeSelector?: Record<string,string>;
    diskBus?: string;
    runStrategy?: 'Always'|'Manual'|'RerunOnFailure'|'Halted';
    bootUseEfi?: boolean;
    efiPersistent?: boolean;
    efiSecureBoot?: boolean;
    tpmEnabled?: boolean;
    tpmPersistent?: boolean;
    useUsbTablet?: boolean;
    installGuestAgent?: boolean;
    gpuMode?: 'passthrough'|'vgpu'|'sriov';
    gpuResourceName?: string;
    gpuCount?: number;
    usbDevices?: string[];
    cpuSockets?: number;
    cpuCores?: number;
    cpuThreads?: number;
    cpuModel?: string;
    cpuModelCustom?: string;
    dedicatedCPUPlacement?: boolean;
    isolateEmulatorThread?: boolean;
    cpuRequest?: number;
    cpuLimit?: number;
    memoryLimit?: string;
    memoryRequestGi?: number;
    hotExpandEnabled?: boolean;
    sshNames?: string[];
    extraDisks?: Array<{ name: string; size?: string; bus?: string; storageClassName?: string; type?: 'disk'; image?: string; sourceType?: 'new'|'existing'; pvc?: string }>;
    netIfaces?: Array<{ name: string; type?: string; model?: string }>;
    rootSourceType?: 'image'|'existing';
    rootImage?: string;
    rootPvc?: string;
    rootName?: string;
    rootBus?: string;
    rootDeviceType?: 'disk'|'cdrom';
    rootSize?: string;
  }
) => {
  const token = localStorage.getItem('token');
  const res = await fetch(`${API_BASE_URL}/api/clouds/${cloudId}/resources/ecs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': token ? `Bearer ${token}` : '' },
    body: JSON.stringify(payload),
    credentials: 'include',
  });
  if (!res.ok) { throw new Error(await res.text()); }
  return await res.json();
};

export const previewHarvesterVm = async (
  cloudId: string,
  payload: any
) => {
  const token = localStorage.getItem('token');
  const res = await fetch(`${API_BASE_URL}/api/clouds/${cloudId}/resources/harvester/vms/preview`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': token ? `Bearer ${token}` : '' },
    body: JSON.stringify(payload),
    credentials: 'include',
  });
  if (!res.ok) { throw new Error(await res.text()); }
  return await res.json();
};


