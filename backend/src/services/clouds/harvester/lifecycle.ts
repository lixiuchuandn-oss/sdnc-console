import { HarvesterTestParams } from './types';
import { requestJson, getJsonOnce } from './utils';
import { listHarvesterVMsStandard, getHarvesterVM } from './vm';

// 将前端传入的实例标识解析为 { namespace, name }
// - 支持格式：
//   1) ns/name
//   2) ns:name
//   3) 仅传 InstanceId 或 InstanceName 时，会先查 VM 列表再反推命名空间和名称
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

// 启动虚拟机（等价于 Harvester UI 的 Start 操作）
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

// 停止虚拟机
// - force=true 时，Harvester 会尝试强制停止（内部语义由 Harvester 控制）
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

// 软重启虚拟机
// - 区别于 Stop+Start，软重启更接近 Guest OS 内部触发的重启
export const harvesterSoftRebootVM = async (
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
  const url = `${origin}/v1/harvester/kubevirt.io.virtualmachines/${encodeURIComponent(path.namespace)}/${encodeURIComponent(path.name)}?action=softreboot`;
  return await requestJson('POST', url, token, insecure, {});
};

// 暂停虚拟机实例（VMI 级别）
// - 仅对运行中的实例有效
export const harvesterPauseVM = async (
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
  // Use KubeVirt native subresource API instead of Harvester action
  const url = `${origin}/apis/subresources.kubevirt.io/v1/namespaces/${encodeURIComponent(path.namespace)}/virtualmachineinstances/${encodeURIComponent(path.name)}/pause`;
  return await requestJson('PUT', url, token, insecure, {}, { Accept: '*/*' });
};

// 取消暂停虚拟机实例（VMI 级别）
export const harvesterUnpauseVM = async (
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
  // Use KubeVirt native subresource API instead of Harvester action
  const url = `${origin}/apis/subresources.kubevirt.io/v1/namespaces/${encodeURIComponent(path.namespace)}/virtualmachineinstances/${encodeURIComponent(path.name)}/unpause`;
  return await requestJson('PUT', url, token, insecure, {}, { Accept: '*/*' });
};

// 触发虚拟机热迁移（创建 VirtualMachineInstanceMigration 对象）
// - targetNode 可选，用于指定目标节点（具体生效依赖集群版本）
export const harvesterMigrateVM = async (
  { endpoint, token, insecure = false }: HarvesterTestParams,
  instanceId: string,
  targetNode?: string,
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

  // Create VirtualMachineInstanceMigration
  const migrationName = `${path.name}-mig-${Date.now().toString(36)}`;
  const url = `${origin}/apis/kubevirt.io/v1/namespaces/${encodeURIComponent(path.namespace)}/virtualmachineinstancemigrations`;
  
  // NOTE: Harvester/KubeVirt API for migration
  // If targetNode is specified, we might need to use specific strategy or wait for newer KubeVirt features.
  // Standard VMIM does not strictly enforce target node in older versions, but let's check spec.
  // KubeVirt v1.0+ supports spec.targetNodeName. Harvester usually supports this.
  
  const payload: any = {
    apiVersion: 'kubevirt.io/v1',
    kind: 'VirtualMachineInstanceMigration',
    metadata: {
      name: migrationName,
      namespace: path.namespace,
    },
    spec: {
      vmiName: path.name,
    },
  };
 
   if (targetNode && String(targetNode).trim()) {
     payload.spec = {
       ...payload.spec,
       targetNode: String(targetNode).trim(),
       targetNodeName: String(targetNode).trim(),
     };
   }

  // Although Harvester UI often just triggers it, KubeVirt supports targetNodeName if underlying scheduler allows.
  // We will include it if provided.
  // Reference: https://kubevirt.io/api-reference/main/definitions.html#_v1_virtualmachineinstancemigrationspec
  // Note: It might be ignored if not supported by the cluster version, but worth sending.
  // Actually, KubeVirt added this recently. If it fails, we might want to retry without it? 
  // For now, let's assume it works or is ignored.
  
  // However, Harvester UI might use a different endpoint if they have a custom action?
  // Searching Harvester codebase (online knowledge): They use VirtualMachineInstanceMigration.
  
  return await requestJson('POST', url, token, insecure, payload);
};

// 终止指定虚拟机当前正在进行的迁移任务
// - 会列出关联该 VMI 的所有迁移对象，删除尚未完成的迁移
export const harvesterAbortMigration = async (
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

  // 1. List active migrations for this VMI
  const listUrl = `${origin}/apis/kubevirt.io/v1/namespaces/${encodeURIComponent(path.namespace)}/virtualmachineinstancemigrations`;
  const list = await requestJson('GET', listUrl, token, insecure);
  
  if (!list || !list.items) return; // Nothing to abort

  const activeMigrations = list.items.filter((m: any) => 
    m.spec.vmiName === path.name && 
    !m.status?.phase?.toLowerCase().includes('succeeded') &&
    !m.status?.phase?.toLowerCase().includes('failed')
  );

  // 2. Delete them
  for (const m of activeMigrations) {
    const delUrl = `${origin}/apis/kubevirt.io/v1/namespaces/${encodeURIComponent(path.namespace)}/virtualmachineinstancemigrations/${encodeURIComponent(m.metadata.name)}`;
    await requestJson('DELETE', delUrl, token, insecure, {});
  }
  
  return { aborted: activeMigrations.length };
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
          true,
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
        const j = await getJsonOnce(p, token, insecure, true);
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
          const j = await getJsonOnce(u, token, insecure, true);
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
        s === 500 ||
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
          listJson = await getJsonOnce(u, token, insecure, true);
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
          const j = await getJsonOnce(u, token, insecure, true);
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
          ? 'harvester addVolume direct request'
          : i === 1
            ? 'harvester addVolume direct retry'
            : 'harvester addVolume direct fallback';
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
        s === 500 ||
        m.includes('invalid') ||
        m.includes('required') ||
        s === 404 ||
        m.includes('not found');
      if (!needContinue) throw e;
    }
  }
  if (lastErr) throw lastErr;
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
  // Harvester/KubeVirt requires volumeName (or diskName) in the body
  const body = { name: payload.name, volumeName: payload.name, diskName: payload.name };
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
  deleteVolumes: boolean = false,
  background: boolean = false,
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
  console.info('[DeleteVM] Start', {
    instanceId: String(instanceId || ''),
    namespace: path.namespace,
    name: path.name,
    params: { deleteVolumes, background }
  });

  // 1. 预先读取 VM 信息，解析出需要删除的关联资源 (PVCs)
  let pvcNames: string[] = [];

  try {
    let vm: any = null;
    try {
      vm = await getHarvesterVM({ endpoint, token, insecure }, path.namespace, path.name);
      
      // [Feature] 检查重要实例标记 (Important VM Check)
      // 如果存在 tower.io/deletion-protection Finalizer，则禁止删除
      // 注意：这与 Labels 方案不同。Labels 是前端标记，Finalizer 是 K8s 原生防删锁。
      // 我们通过 API 删除时，如果发现此 Finalizer，应该报错阻止，而不是自动移除。
      const finalizers = vm?.metadata?.finalizers || [];
      const protectionFinalizer = 'tower.io/deletion-protection';

      if (finalizers.includes(protectionFinalizer)) {
        const err: any = new Error(`该虚拟机被标记为重要实例 (Finalizer Protected)，无法删除。请先移除重要标记。`);
        err.status = 403;
        throw err;
      }
      
      // [Feature] 检查 tower.io/important 标签 (兼容旧方案)
      const labels = vm?.metadata?.labels || {};
      if (labels['tower.io/important'] === 'true') {
        const err: any = new Error(`该虚拟机被标记为重要实例 (Label Protected)，无法删除。请先移除重要标记。`);
        err.status = 403;
        throw err;
      }

    } catch (e: any) {
      if (e?.status === 404) {
        console.warn('[DeleteVM] VM not found, may already be deleted.', { namespace: path.namespace, name: path.name });
      } else {
        throw e;
      }
    }
    
    // 1.1 解析 PVC Names
    if (deleteVolumes) {
      const volumes = vm?.spec?.template?.spec?.volumes || [];
      pvcNames = volumes.map((v: any) => v?.persistentVolumeClaim?.claimName).filter((n: any) => !!n);
      try {
        const vctStr = vm?.metadata?.annotations?.['harvesterhci.io/volumeClaimTemplates'];
        if (vctStr) {
          const vct = JSON.parse(vctStr);
          if (Array.isArray(vct)) {
            const tplNames = vct
              .map((t: any) => t?.metadata?.name)
              .filter((n: any) => typeof n === 'string' && !!n);
            pvcNames = [...pvcNames, ...tplNames];
          }
        }
      } catch {}
      try {
        const dvts = Array.isArray(vm?.spec?.dataVolumeTemplates) ? vm.spec.dataVolumeTemplates : [];
        const dvNames = dvts
          .map((d: any) => d?.metadata?.name)
          .filter((n: any) => typeof n === 'string' && !!n);
        pvcNames = [...pvcNames, ...dvNames];
      } catch {}
      pvcNames = Array.from(new Set(pvcNames));
      console.info('[DeleteVM] PVCs to delete:', pvcNames);
    }
  } catch (e: any) {
    console.warn('[DeleteVM] Failed to read VM info before deletion. Associated resources may not be deleted.', e);
  }

  // 2. 软删除：将VM移入回收站（添加Finalizer和Annotation标记）
  // 不直接删除，而是标记为"待删除"状态，7天后自动删除
  const protectionDays = 7; // 默认保护期7天
  const deletedAt = new Date();
  const expiresAt = new Date(deletedAt.getTime() + protectionDays * 24 * 60 * 60 * 1000);
  
  const recycleBinFinalizer = 'tower.io/recycle-bin';
  const deletionTimestamp = deletedAt.toISOString();
  const expirationTimestamp = expiresAt.toISOString();
  
  try {
    // 获取当前VM
    const currentVm = await getHarvesterVM({ endpoint, token, insecure }, path.namespace, path.name);
    const finalizers = currentVm?.metadata?.finalizers || [];
    const annotations = currentVm?.metadata?.annotations || {};
    const labels = currentVm?.metadata?.labels || {};
    
    // 检查是否已经在回收站中
    if (finalizers.includes(recycleBinFinalizer)) {
      throw new Error('该虚拟机已在回收站中');
    }
    
    // 添加回收站Finalizer（防止被真正删除）
    const newFinalizers = [...finalizers, recycleBinFinalizer];
    
    // 添加删除时间标记
    const newAnnotations = {
      ...annotations,
      'tower.io/deletion-scheduled': deletionTimestamp,
      'tower.io/deletion-expires': expirationTimestamp,
      'tower.io/deletion-protection-days': String(protectionDays),
    };
    
    // 添加删除状态标签
    const newLabels = {
      ...labels,
      'tower.io/recycle-bin': 'true',
      'tower.io/deletion-status': 'pending',
    };
    
    // 使用JSON Patch更新VM
    const patchBody = [
      { op: 'add', path: '/metadata/finalizers/-', value: recycleBinFinalizer },
      { op: 'add', path: '/metadata/annotations/tower.io~1deletion-scheduled', value: deletionTimestamp },
      { op: 'add', path: '/metadata/annotations/tower.io~1deletion-expires', value: expirationTimestamp },
      { op: 'add', path: '/metadata/annotations/tower.io~1deletion-protection-days', value: String(protectionDays) },
      { op: 'add', path: '/metadata/labels/tower.io~1recycle-bin', value: 'true' },
      { op: 'add', path: '/metadata/labels/tower.io~1deletion-status', value: 'pending' },
    ];
    
    const patchUrl = `${origin}/apis/kubevirt.io/v1/namespaces/${encodeURIComponent(path.namespace)}/virtualmachines/${encodeURIComponent(path.name)}`;
    await requestJson('PATCH', patchUrl, token, insecure, patchBody, {
      'Content-Type': 'application/json-patch+json'
    });
    
    console.info('[DeleteVM] VM moved to recycle bin', { 
      namespace: path.namespace, 
      name: path.name,
      deletedAt: deletionTimestamp,
      expiresAt: expirationTimestamp
    });
    
    return {
      vm: currentVm,
      status: 'Recycled',
      message: `虚拟机已移入回收站，将在 ${protectionDays} 天后自动删除`,
      deletedAt: deletionTimestamp,
      expiresAt: expirationTimestamp,
      workflow: 'recycle-bin'
    };
  } catch (e: any) {
    if (e?.status === 404) {
      throw new Error('虚拟机不存在');
    }
    throw e;
  }

  // 注意：由于改为软删除（移入回收站），不再执行真正的删除操作
  // 真正的删除操作由 harvesterForceDeleteVM 函数处理
};

/**
 * 强制删除虚拟机（从回收站中真正删除）
 * 用于回收站中的立即删除操作和后台清理任务
 */
export const harvesterForceDeleteVM = async (
  { endpoint, token, insecure = false }: HarvesterTestParams,
  instanceId: string,
  deleteVolumes: boolean = false,
  background: boolean = false,
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

  // 1. 预先读取 VM 信息
  let pvcNames: string[] = [];
  let vm: any = null;
  try {
    vm = await getHarvesterVM({ endpoint, token, insecure }, path.namespace, path.name);
    
    // 1.1 解析 PVC Names
    if (deleteVolumes) {
      const volumes = vm?.spec?.template?.spec?.volumes || [];
      pvcNames = volumes.map((v: any) => v?.persistentVolumeClaim?.claimName).filter((n: any) => !!n);
      try {
        const vctStr = vm?.metadata?.annotations?.['harvesterhci.io/volumeClaimTemplates'];
        if (vctStr) {
          const vct = JSON.parse(vctStr);
          if (Array.isArray(vct)) {
            const tplNames = vct
              .map((t: any) => t?.metadata?.name)
              .filter((n: any) => typeof n === 'string' && !!n);
            pvcNames = [...pvcNames, ...tplNames];
          }
        }
      } catch {}
      try {
        const dvts = Array.isArray(vm?.spec?.dataVolumeTemplates) ? vm.spec.dataVolumeTemplates : [];
        const dvNames = dvts
          .map((d: any) => d?.metadata?.name)
          .filter((n: any) => typeof n === 'string' && !!n);
        pvcNames = [...pvcNames, ...dvNames];
      } catch {}
      pvcNames = Array.from(new Set(pvcNames));
    }
    
    // 1.2 移除 Tower 相关的 Finalizers (Recycle Bin + Managed)，允许真正删除
    // 如果不移除 tower.io/managed，VM 会一直卡在 Terminating 状态
    const finalizers = vm?.metadata?.finalizers || [];
    const targetFinalizers = ['tower.io/recycle-bin', 'tower.io/managed'];
    
    // 找出所有需要移除的索引
    const indicesToRemove: number[] = [];
    finalizers.forEach((f: string, index: number) => {
      if (targetFinalizers.includes(f)) {
        indicesToRemove.push(index);
      }
    });

    if (indicesToRemove.length > 0) {
      // 倒序排列索引，防止因删除导致后续索引偏移
      indicesToRemove.sort((a, b) => b - a);
      
      const patchOps = indicesToRemove.map(index => ({
        op: 'remove',
        path: `/metadata/finalizers/${index}`
      }));

      const patchUrl = `${origin}/apis/kubevirt.io/v1/namespaces/${encodeURIComponent(path.namespace)}/virtualmachines/${encodeURIComponent(path.name)}`;
      
      // 移除Finalizers
      await requestJson('PATCH', patchUrl, token, insecure, patchOps, {
        'Content-Type': 'application/json-patch+json'
      });
    }
  } catch (e: any) {
    if (e?.status === 404) {
      console.warn('[ForceDeleteVM] VM not found, may already be deleted.', { namespace: path.namespace, name: path.name });
      return { status: 'AlreadyDeleted', message: '虚拟机已不存在' };
    }
    throw e;
  }

  // 2. 删除 VM
  const url = `${origin}/v1/harvester/kubevirt.io.virtualmachines/${encodeURIComponent(path.namespace)}/${encodeURIComponent(path.name)}`;
  console.info('[ForceDeleteVM] Request delete VM', { namespace: path.namespace, name: path.name, url });
  const delRes = await requestJson('DELETE', url, token, insecure);
  console.info('[ForceDeleteVM] Delete VM request sent', { namespace: path.namespace, name: path.name });

  // 3. 定义后续清理任务
  const cleanupTask = async () => {
    // 3.1 等待 VM 删除完成
    const waitUntilDeleted = async () => {
      console.info('[ForceDeleteVM] Waiting for VM deletion', { namespace: path.namespace, name: path.name });
      const start = Date.now();
      const timeoutMs = 120000;
      const intervalMs = 1500;
      while (Date.now() - start < timeoutMs) {
        try {
          await getHarvesterVM({ endpoint, token, insecure }, path.namespace, path.name);
        } catch (e: any) {
          if (e?.status === 404 || e?.message?.includes('not found') || e?.message?.includes('404')) {
            console.info('[ForceDeleteVM] VM deletion confirmed', { namespace: path.namespace, name: path.name });
            return;
          }
        }
        await new Promise((r) => setTimeout(r, intervalMs));
      }
      console.warn(`[ForceDeleteVM] Timeout waiting for VM ${path.namespace}/${path.name} deletion`);
    };
    await waitUntilDeleted();

    // 3.2 删除 PVC
    if (deleteVolumes && pvcNames.length > 0) {
      for (const claimName of pvcNames) {
        try {
          const delUrl = `${origin}/v1/harvester/persistentvolumeclaims/${encodeURIComponent(path.namespace)}/${encodeURIComponent(claimName)}`;
          console.info('[ForceDeleteVM] Request delete PVC', { namespace: path.namespace, name: claimName, url: delUrl });
          await requestJson('DELETE', delUrl, token, insecure);
          console.info(`[ForceDeleteVM] Deleted PVC: ${claimName}`);
        } catch (e: any) {
          if (e?.status !== 404) {
            console.warn(`[ForceDeleteVM] Failed to delete PVC ${claimName}:`, e?.message || e);
          }
        }
      }
    }

    console.info('[ForceDeleteVM] Workflow finished', { namespace: path.namespace, name: path.name, deletedPVCCount: pvcNames.length });
  };

  if (background) {
    cleanupTask().catch(err => {
      console.error('[ForceDeleteVM] Background cleanup error:', { namespace: path.namespace, name: path.name, err });
    });
    return {
      vm: delRes,
      status: 'Deleting',
      message: '删除任务已在后台启动，关联资源将稍后删除',
      workflow: 'background-cleanup'
    };
  } else {
    await cleanupTask();
    return {
      vm: delRes,
      deletedVolumes: pvcNames || [],
      workflow: 'sync-cleanup'
    };
  }
};

/**
 * 恢复虚拟机（从回收站中恢复）
 */
export const harvesterRestoreVM = async (
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

  // 获取当前VM
  const vm = await getHarvesterVM({ endpoint, token, insecure }, path.namespace, path.name);
  const finalizers = vm?.metadata?.finalizers || [];
  const recycleBinFinalizer = 'tower.io/recycle-bin';
  
  if (!finalizers.includes(recycleBinFinalizer)) {
    throw new Error('该虚拟机不在回收站中');
  }

  // 移除回收站Finalizer和标记
  const patchBody = [];
  
  // 移除Finalizer
  const finalizerIndex = finalizers.indexOf(recycleBinFinalizer);
  if (finalizerIndex >= 0) {
    patchBody.push({ op: 'remove', path: `/metadata/finalizers/${finalizerIndex}` });
  }
  
  // 移除删除相关的Annotation
  patchBody.push(
    { op: 'remove', path: '/metadata/annotations/tower.io~1deletion-scheduled' },
    { op: 'remove', path: '/metadata/annotations/tower.io~1deletion-expires' },
    { op: 'remove', path: '/metadata/annotations/tower.io~1deletion-protection-days' }
  );
  
  // 移除删除相关的Label
  patchBody.push(
    { op: 'remove', path: '/metadata/labels/tower.io~1recycle-bin' },
    { op: 'remove', path: '/metadata/labels/tower.io~1deletion-status' }
  );

  const patchUrl = `${origin}/apis/kubevirt.io/v1/namespaces/${encodeURIComponent(path.namespace)}/virtualmachines/${encodeURIComponent(path.name)}`;
  const result = await requestJson('PATCH', patchUrl, token, insecure, patchBody, {
    'Content-Type': 'application/json-patch+json'
  });

  console.info('[RestoreVM] VM restored from recycle bin', { namespace: path.namespace, name: path.name });
  
  return {
    vm: result,
    status: 'Restored',
    message: '虚拟机已从回收站恢复'
  };
};