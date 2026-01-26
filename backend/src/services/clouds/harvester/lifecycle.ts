import { HarvesterTestParams } from './types';
import { requestJson, getJsonOnce } from './utils';
import { listHarvesterVMsStandard, getHarvesterVM } from './vm';

const resolveVmPath = async (
  { endpoint, token, insecure = false }: HarvesterTestParams,
  instanceId: string,
): Promise<{ namespace: string; name: string } | null> => {
  const s = String(instanceId || '');
  const sep = s.includes('/') ? '/' : s.includes(':') ? ':' : null;
  if (sep) {
    const [ns, nm] = s.split(sep);
    if (ns && nm) return { namespace: ns, name: nm };
  }
  const list = await listHarvesterVMsStandard({ endpoint, token, insecure });
  const hit = list.find((x: any) => x.InstanceId === s || x.InstanceName === s);
  if (hit && typeof hit.InstanceId === 'string' && hit.InstanceId.includes('/')) {
    const [ns, nm] = String(hit.InstanceId).split('/');
    if (ns && nm) return { namespace: ns, name: nm };
  }
  return null;
};

export const harvesterStartVM = async (
  { endpoint, token, insecure = false }: HarvesterTestParams,
  instanceId: string,
) => {
  const base = (endpoint || '').replace(/\/+$/, '');
  let origin = base;
  try {
    const u = new URL(base);
    origin = `${u.protocol}//${u.host}`;
  } catch {
    origin = base.replace(/\/v[0-9].*$/, '');
  }
  const path = await resolveVmPath({ endpoint, token, insecure }, instanceId);
  if (!path) throw new Error('无法解析实例标识');
  const url = `${origin}/v1/harvester/kubevirt.io.virtualmachines/${encodeURIComponent(path.namespace)}/${encodeURIComponent(path.name)}?action=start`;
  return await requestJson('POST', url, token, insecure, {});
};

export const harvesterStopVM = async (
  { endpoint, token, insecure = false }: HarvesterTestParams,
  instanceId: string,
  force: boolean = false,
) => {
  const base = (endpoint || '').replace(/\/+$/, '');
  let origin = base;
  try {
    const u = new URL(base);
    origin = `${u.protocol}//${u.host}`;
  } catch {
    origin = base.replace(/\/v[0-9].*$/, '');
  }
  const path = await resolveVmPath({ endpoint, token, insecure }, instanceId);
  if (!path) throw new Error('无法解析实例标识');
  const url = `${origin}/v1/harvester/kubevirt.io.virtualmachines/${encodeURIComponent(path.namespace)}/${encodeURIComponent(path.name)}?action=stop`;
  return await requestJson('POST', url, token, insecure, { force });
};

export const harvesterAddVolumeToVM = async (
  { endpoint, token, insecure = false }: HarvesterTestParams,
  instanceId: string,
  payload: { name: string; bus?: string; pvcNamespace: string; pvcName: string },
) => {
  const base = (endpoint || '').replace(/\/+$/, '');
  let origin = base;
  try {
    const u = new URL(base);
    origin = `${u.protocol}//${u.host}`;
  } catch {
    origin = base.replace(/\/v[0-9].*$/, '');
  }
  let path = await resolveVmPath({ endpoint, token, insecure }, instanceId);
  if (!path) {
    const guessNs = String(payload.pvcNamespace || '').trim();
    const guessName = String(instanceId || '').trim();
    if (guessNs && guessName) {
      try {
        const probe = await getJsonOnce(
          `${origin}/v1/harvester/kubevirt.io.virtualmachines/${encodeURIComponent(guessNs)}/${encodeURIComponent(guessName)}`,
          token,
          insecure,
        );
        if (probe && (probe?.metadata?.name || probe?.name)) {
          path = { namespace: guessNs, name: guessName };
        }
      } catch {}
    }
  }
  if (!path) throw new Error('无法解析实例标识');
  const url = `${origin}/v1/harvester/kubevirt.io.virtualmachines/${encodeURIComponent(path.namespace)}/${encodeURIComponent(path.name)}?action=addVolume`;
  let pvcName = String(payload.pvcName || '').trim();
  const volName = String(payload.name || '').trim();
  let pvName: string | undefined = undefined;
  if (!pvcName || pvcName.toLowerCase() === volName.toLowerCase()) {
    const ns = String(payload.pvcNamespace || '').trim();
    const candidates = [
      `${origin}/apis/longhorn.io/v1beta1/namespaces/${encodeURIComponent(ns)}/volumes/${encodeURIComponent(volName)}`,
      `${origin}/v1/harvester/longhorn.io.volumes/${encodeURIComponent(volName)}`,
      `${origin}/v1/longhorn.io.volumes/${encodeURIComponent(volName)}`,
    ];
    for (const p of candidates) {
      try {
        const j = await getJsonOnce(p, token, insecure);
        const k = j?.status?.kubernetesStatus?.pvcName || '';
        const pv = j?.status?.kubernetesStatus?.pvName || '';
        if (typeof k === 'string' && k.trim()) {
          pvcName = String(k).trim();
          pvName = typeof pv === 'string' && pv.trim() ? String(pv).trim() : pvName;
          break;
        }
      } catch {}
    }
  }
  if (!pvcName) throw new Error('该卷缺少 PVC 名称，无法挂载');
  if (!pvName) {
    try {
      const ns = String(payload.pvcNamespace || '').trim();
      const urls = [
        `${origin}/v1/harvester/persistentvolumeclaims/${encodeURIComponent(ns)}/${encodeURIComponent(pvcName)}`,
        `${origin}/api/v1/namespaces/${encodeURIComponent(ns)}/persistentvolumeclaims/${encodeURIComponent(pvcName)}`,
      ];
      for (const u of urls) {
        try {
          const j = await getJsonOnce(u, token, insecure);
          const pv = j?.spec?.volumeName || '';
          if (typeof pv === 'string' && pv.trim()) {
            pvName = String(pv).trim();
            break;
          }
        } catch {}
      }
    } catch {}
  }
  const bodies: any[] = [
    {
      diskName: volName,
      volumeSourceName: pvcName,
    },
    {
      name: volName,
      disk: { bus: payload.bus || 'virtio' },
      volumeSource: { persistentVolumeClaim: { claimName: pvcName } },
      diskName: volName,
      volumeName: pvName || volName,
    },
    {
      name: volName,
      disk: { bus: payload.bus || 'virtio' },
      volumeSource: { persistentVolumeClaim: { claimName: pvcName } },
      diskName: volName,
      volumeName: pvcName,
    },
    {
      name: volName,
      disk: { bus: payload.bus || 'virtio' },
      volumeSource: { persistentVolumeClaim: { claimName: pvcName } },
    },
  ];
  let lastErr: any = null;
  for (let i = 0; i < bodies.length; i++) {
    const body = bodies[i];
    try {
      const tag =
        i === 0
          ? 'harvester addVolume request'
          : i === 1
            ? 'harvester addVolume retry'
            : 'harvester addVolume fallback';
      console.info(tag, {
        url,
        name: body.name,
        diskBus: body.disk?.bus,
        diskName: body.diskName,
        volumeName: body.volumeName,
        volumeSourceName: body.volumeSourceName,
        claimName: body.volumeSource?.persistentVolumeClaim?.claimName,
        ...(lastErr
          ? { status: Number(lastErr?.status || 0), error: String(lastErr?.message || '') }
          : {}),
      });
      const res = await requestJson('POST', url, token, insecure, body);
      return res;
    } catch (e: any) {
      lastErr = e;
      const s = Number(e?.status || 0);
      const m = String(e?.message || '').toLowerCase();
      const needContinue =
        s === 422 ||
        m.includes('invalid') ||
        m.includes('required') ||
        s === 404 ||
        m.includes('not found');
      if (!needContinue) throw e;
    }
  }
  if (lastErr) throw lastErr;
};

export const harvesterAddVolumeToVMDirect = async (
  { endpoint, token, insecure = false }: HarvesterTestParams,
  namespace: string,
  name: string,
  payload: { name: string; bus?: string; pvcNamespace: string; pvcName: string },
) => {
  const base = (endpoint || '').replace(/\/+$/, '');
  let origin = base;
  try {
    const u = new URL(base);
    origin = `${u.protocol}//${u.host}`;
  } catch {
    origin = base.replace(/\/v[0-9].*$/, '');
  }
  const url = `${origin}/v1/harvester/kubevirt.io.virtualmachines/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}?action=addVolume`;
  let pvcName = String(payload.pvcName || '').trim();
  const volName = String(payload.name || '').trim() || String(pvcName || '').trim();
  if (!volName) throw new Error('参数缺失：磁盘设备名 diskName');
  let pvName: string | undefined = undefined;
  const needResolveFromLonghorn =
    !pvcName || pvcName.toLowerCase() === volName.toLowerCase() || !/^pvc-/.test(pvcName);
  if (needResolveFromLonghorn) {
    try {
      const candidatesAll = [
        `${origin}/v1/longhorn.io.volumes`,
        `${origin}/v1/harvester/longhorn.io.volumes`,
        `${origin}/apis/longhorn.io/v1beta1/volumes`,
      ];
      let listJson: any = null;
      for (const u of candidatesAll) {
        try {
          listJson = await getJsonOnce(u, token, insecure);
          if (listJson) break;
        } catch {}
      }
      const items: any[] = Array.isArray(listJson?.data)
        ? listJson?.data
        : Array.isArray(listJson?.items)
          ? listJson?.items
          : [];
      const hit = items.find((it: any) => {
        const ks = it?.status?.kubernetesStatus || {};
        const nm = it?.metadata?.name || it?.name || '';
        const vname = ks?.volumeName || '';
        return String(vname || '').trim() === volName || String(nm || '').trim() === volName;
      });
      if (hit) {
        const ks = hit?.status?.kubernetesStatus || {};
        const kPVC = ks?.pvcName || '';
        const kPV = ks?.pvName || '';
        if (typeof kPVC === 'string' && kPVC.trim()) pvcName = String(kPVC).trim();
        if (typeof kPV === 'string' && kPV.trim()) pvName = String(kPV).trim();
      }
    } catch {}
  }
  if (!pvcName || pvcName.toLowerCase() === volName.toLowerCase()) {
    const ns = String(payload.pvcNamespace || '').trim();
    const candidates = [
      `${origin}/apis/longhorn.io/v1beta1/namespaces/${encodeURIComponent(ns)}/volumes/${encodeURIComponent(volName)}`,
      `${origin}/v1/harvester/longhorn.io.volumes/${encodeURIComponent(volName)}`,
      `${origin}/v1/longhorn.io.volumes/${encodeURIComponent(volName)}`,
    ];
    for (const p of candidates) {
      try {
        const j = await getJsonOnce(p, token, insecure);
        const k = j?.status?.kubernetesStatus?.pvcName || '';
        const pv = j?.status?.kubernetesStatus?.pvName || '';
        if (typeof k === 'string' && k.trim()) {
          pvcName = String(k).trim();
          pvName = typeof pv === 'string' && pv.trim() ? String(pv).trim() : pvName;
          break;
        }
      } catch {}
    }
  }
  if (!pvcName) throw new Error('该卷缺少 PVC 名称，无法挂载');
  if (!pvName) {
    try {
      const ns = String(payload.pvcNamespace || '').trim();
      const urls = [
        `${origin}/v1/harvester/persistentvolumeclaims/${encodeURIComponent(ns)}/${encodeURIComponent(pvcName)}`,
        `${origin}/api/v1/namespaces/${encodeURIComponent(ns)}/persistentvolumeclaims/${encodeURIComponent(pvcName)}`,
      ];
      for (const u of urls) {
        try {
          const j = await getJsonOnce(u, token, insecure);
          const pv = j?.spec?.volumeName || '';
          if (typeof pv === 'string' && pv.trim()) {
            pvName = String(pv).trim();
            break;
          }
        } catch {}
      }
    } catch {}
  }
  const body = { diskName: volName, volumeSourceName: pvcName } as any;
  console.info('harvester addVolume direct', {
    url,
    diskName: body.diskName,
    volumeSourceName: body.volumeSourceName,
  });
  const res = await requestJson('POST', url, token, insecure, body);
  return res;
};

export const harvesterRemoveVolumeFromVM = async (
  { endpoint, token, insecure = false }: HarvesterTestParams,
  instanceId: string,
  payload: { name: string },
) => {
  const base = (endpoint || '').replace(/\/+$/, '');
  let origin = base;
  try {
    const u = new URL(base);
    origin = `${u.protocol}//${u.host}`;
  } catch {
    origin = base.replace(/\/v[0-9].*$/, '');
  }
  const path = await resolveVmPath({ endpoint, token, insecure }, instanceId);
  if (!path) throw new Error('无法解析实例标识');
  const url = `${origin}/v1/harvester/kubevirt.io.virtualmachines/${encodeURIComponent(path.namespace)}/${encodeURIComponent(path.name)}?action=removeVolume`;
  const body = { name: payload.name };
  return await requestJson('POST', url, token, insecure, body);
};

export const harvesterRebootVM = async (
  { endpoint, token, insecure = false }: HarvesterTestParams,
  instanceId: string,
  force: boolean = false,
) => {
  const base = (endpoint || '').replace(/\/+$/, '');
  let origin = base;
  try {
    const u = new URL(base);
    origin = `${u.protocol}//${u.host}`;
  } catch {
    origin = base.replace(/\/v[0-9].*$/, '');
  }
  const path = await resolveVmPath({ endpoint, token, insecure }, instanceId);
  if (!path) throw new Error('无法解析实例标识');
  const url = `${origin}/v1/harvester/kubevirt.io.virtualmachines/${encodeURIComponent(path.namespace)}/${encodeURIComponent(path.name)}?action=restart`;
  return await requestJson('POST', url, token, insecure, { force });
};

export const harvesterDeleteVM = async (
  { endpoint, token, insecure = false }: HarvesterTestParams,
  instanceId: string,
  deleteImage: boolean = false,
) => {
  const base = (endpoint || '').replace(/\/+$/, '');
  let origin = base;
  try {
    const u = new URL(base);
    origin = `${u.protocol}//${u.host}`;
  } catch {
    origin = base.replace(/\/v[0-9].*$/, '');
  }
  const path = await resolveVmPath({ endpoint, token, insecure }, instanceId);
  if (!path) throw new Error('无法解析实例标识');

  if (deleteImage) {
    try {
      const vm = await getHarvesterVM({ endpoint, token, insecure }, path.namespace, path.name);
      const findImageId = (v: any) => {
        // 1. Check DataVolumeTemplates
        const dvts = Array.isArray(v?.spec?.dataVolumeTemplates) ? v.spec.dataVolumeTemplates : [];
        for (const d of dvts) {
          const id = d?.metadata?.annotations?.['harvesterhci.io/imageId'];
          if (id) return id;
        }
        // 2. Check VolumeClaimTemplates in annotation
        try {
          const vctStr = v?.metadata?.annotations?.['harvesterhci.io/volumeClaimTemplates'];
          if (vctStr) {
            const vct = JSON.parse(vctStr);
            if (Array.isArray(vct)) {
              for (const d of vct) {
                const id = d?.metadata?.annotations?.['harvesterhci.io/imageId'];
                if (id) return id;
              }
            }
          }
        } catch {}
        return null;
      };
      const imageId = findImageId(vm);
      if (imageId) {
        const parts = String(imageId).split('/');
        const imgNs = parts.length > 1 ? parts[0] : path.namespace;
        const imgName = parts.length > 1 ? parts[1] : parts[0];
        try {
          const delUrl = `${origin}/apis/harvesterhci.io/v1/namespaces/${encodeURIComponent(imgNs)}/virtualmachineimages/${encodeURIComponent(imgName)}`;
          await requestJson('DELETE', delUrl, token, insecure);
        } catch (e: any) {
          if (parts.length === 1 && imgNs !== 'harvester-public') {
            try {
              const delUrl2 = `${origin}/apis/harvesterhci.io/v1/namespaces/harvester-public/virtualmachineimages/${encodeURIComponent(imgName)}`;
              await requestJson('DELETE', delUrl2, token, insecure);
            } catch {}
          }
        }
      }
    } catch {}
  }

  const url = `${origin}/v1/harvester/kubevirt.io.virtualmachines/${encodeURIComponent(path.namespace)}/${encodeURIComponent(path.name)}`;
  return await requestJson('DELETE', url, token, insecure);
};
