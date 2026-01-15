import { HarvesterTestParams } from './types';
import { getJsonOnce, requestJson, requestOnce } from './utils';

export const listHarvesterVMsStandard = async ({ endpoint, token, insecure = false }: HarvesterTestParams): Promise<any[]> => {
  const base = (endpoint || '').replace(/\/+$/, '');
  let origin = base;
  try {
    const u = new URL(base);
    origin = `${u.protocol}//${u.host}`;
  } catch {
    origin = base.replace(/\/v[0-9].*$/, '');
  }
  const vmCandidates = [
    // 原生 Harvester 聚合路径
    `${origin}/v1/harvester/kubevirt.io.virtualmachines`,
    // 兼容部分环境仅暴露 kubevirt API 或经 Cloudmap 代理的情况
    `${origin}/v1/kubevirt.io.virtualmachines`,
    `${origin}/apis/kubevirt.io/v1/virtualmachines`
  ];
  let vmJson: any = null; let vmErr: any = null;
  for (const url of vmCandidates) {
    try { vmJson = await getJsonOnce(url, token, insecure); if (vmJson) break; } catch (e:any) { vmErr = e; }
  }
  if (!vmJson && vmErr) {
    const s = Number(vmErr?.status || 0);
    const m = String(vmErr?.message || '').toLowerCase();
    const b = String(vmErr?.body || '').toLowerCase();
    if (s===401 || m.includes('unauthorized') || b.includes('unauthorized')) return [];
    if (s===404 || m.includes('not found') || b.includes('not found')) return [];
  }

  const vmiUrl = `${origin}/v1/harvester/kubevirt.io.virtualmachineinstances`;
  const dvUrl = `${origin}/v1/harvester/cdi.kubevirt.io.datavolumes`;
  const imgCandidates = [
    `${origin}/v1/harvester/harvesterhci.io.virtualmachineimages`
  ];
  const ovnVpcUrl = `${origin}/v1/kubeovn.io.vpcs`;
  const ovnSubnetUrl = `${origin}/v1/kubeovn.io.subnets`;
  const ovnIpUrl = `${origin}/v1/kubeovn.io.ips`;
  const pvcUrlCandidates = [
    `${origin}/api/v1/persistentvolumeclaims`
  ];
  const pvUrlCandidates = [
    `${origin}/api/v1/persistentvolumes`
  ];
  const metricsPodsUrl = `${origin}/apis/metrics.k8s.io/v1beta1/pods`;
  const [vmiJson, dvJson, imgJson, vpcJson, subnetJson, ipJson, pvcJson, pvJson] = await Promise.all([
    getJsonOnce(vmiUrl, token, insecure).catch(() => ({ items: [], data: [] })),
    getJsonOnce(dvUrl, token, insecure).catch(() => ({ items: [], data: [] })),
    (async()=>{ for (const u of imgCandidates) { try { const j = await getJsonOnce(u, token, insecure); return j; } catch {} } return { items: [], data: [] }; })(),
    getJsonOnce(ovnVpcUrl, token, insecure).catch(() => ({ items: [], data: [] })),
    getJsonOnce(ovnSubnetUrl, token, insecure).catch(() => ({ items: [], data: [] })),
    getJsonOnce(ovnIpUrl, token, insecure).catch(() => ({ items: [], data: [] })),
    (async()=>{ for (const u of pvcUrlCandidates) { try { const j = await getJsonOnce(u, token, insecure); return j; } catch {} } return { items: [], data: [] }; })(),
    (async()=>{ for (const u of pvUrlCandidates) { try { const j = await getJsonOnce(u, token, insecure); return j; } catch {} } return { items: [], data: [] }; })()
  ]);
  const vmItems = Array.isArray(vmJson?.data) ? vmJson?.data : Array.isArray(vmJson?.items) ? vmJson?.items : [];
  const vmiItems = Array.isArray(vmiJson?.data) ? vmiJson?.data : Array.isArray(vmiJson?.items) ? vmiJson?.items : [];
  const vmiMap = new Map<string, any>();
  for (const vmi of vmiItems) {
    const nm = vmi?.metadata?.name || vmi?.name || '';
    const ns = vmi?.metadata?.namespace || vmi?.namespace || '';
    const key = ns && nm ? `${ns}/${nm}` : (vmi?.metadata?.uid || '');
    if (key) vmiMap.set(key, vmi);
  }
  const dvItems = Array.isArray(dvJson?.data) ? dvJson?.data : Array.isArray(dvJson?.items) ? dvJson?.items : [];
  const dvAllMap = new Map<string, any>();
  for (const dv of dvItems) {
    const nm = dv?.metadata?.name || dv?.name || '';
    const ns = dv?.metadata?.namespace || dv?.namespace || '';
    const key = ns && nm ? `${ns}/${nm}` : '';
    if (key) dvAllMap.set(key, dv);
  }
  const pvcItems = Array.isArray(pvcJson?.data) ? pvcJson?.data : Array.isArray(pvcJson?.items) ? pvcJson?.items : [];
  const pvcMap = new Map<string, any>();
  for (const pvc of pvcItems) {
    const nm = pvc?.metadata?.name || pvc?.name || '';
    const ns = pvc?.metadata?.namespace || pvc?.namespace || '';
    const key = ns && nm ? `${ns}/${nm}` : '';
    if (key) pvcMap.set(key, pvc);
  }
  const pvItems = Array.isArray(pvJson?.data) ? pvJson?.data : Array.isArray(pvJson?.items) ? pvJson?.items : [];
  const pvMap = new Map<string, any>();
  for (const pv of pvItems) {
    const nm = pv?.metadata?.name || pv?.name || '';
    if (nm) pvMap.set(nm, pv);
  }
  const imgItems = Array.isArray(imgJson?.data) ? imgJson?.data : Array.isArray(imgJson?.items) ? imgJson?.items : [];
  const imgMap = new Map<string, string>();
  for (const img of imgItems) {
    const id = img?.metadata?.name || img?.name || '';
    const ns = img?.metadata?.namespace || img?.namespace || '';
    const dn = img?.spec?.displayName || img?.spec?.name || '';
    const val = dn || id;
    if (id) {
      imgMap.set(id, val);
      if (ns) imgMap.set(`${ns}/${id}`, val);
    }
  }
  const vpcItems = Array.isArray(vpcJson?.data) ? vpcJson?.data : Array.isArray(vpcJson?.items) ? vpcJson?.items : [];
  const subnetItems = Array.isArray(subnetJson?.data) ? subnetJson?.data : Array.isArray(subnetJson?.items) ? subnetJson?.items : [];
  const ipItems = Array.isArray(ipJson?.data) ? ipJson?.data : Array.isArray(ipJson?.items) ? ipJson?.items : [];
  const vpcNameMap = new Map<string, string>();
  for (const vpc of vpcItems) {
    const name = vpc?.metadata?.name || vpc?.name || '';
    const display = vpc?.spec?.name || vpc?.spec?.displayName || name;
    if (name) vpcNameMap.set(name, display || name);
  }
  const subnetToVpc = new Map<string, string>();
  for (const sn of subnetItems) {
    const sname = sn?.metadata?.name || sn?.name || '';
    const vpc = sn?.spec?.vpc || sn?.spec?.vpcName || '';
    if (sname && vpc) subnetToVpc.set(sname, vpc);
  }
  const ipToSubnet = new Map<string, string>();
  for (const ip of ipItems) {
    const addr = ip?.spec?.ipAddress || ip?.status?.ipAddress || ip?.ip || '';
    const subnet = ip?.spec?.subnet || ip?.status?.subnet || ip?.subnet || '';
    if (addr && subnet) ipToSubnet.set(addr, subnet);
  }

  let metricsPods: any[] = [];
  try {
    const mjson = await getJsonOnce(metricsPodsUrl, token, insecure);
    metricsPods = Array.isArray(mjson?.items) ? mjson.items : Array.isArray(mjson?.data) ? mjson.data : [];
  } catch {}
  const parseCpuMillicores = (s: any): number => {
    const v = String(s || '').trim();
    if (!v) return 0;
    if (v.endsWith('n')) { const n = Number(v.slice(0, -1)); return isNaN(n) ? 0 : Math.round(n / 1_000_000); }
    if (v.endsWith('u')) { const n = Number(v.slice(0, -1)); return isNaN(n) ? 0 : Math.round(n / 1000); }
    if (v.endsWith('m')) { const n = Number(v.slice(0, -1)); return isNaN(n) ? 0 : n; }
    const n = Number(v); return isNaN(n) ? 0 : Math.round(n * 1000);
  };
  const parseMemMi = (s: any): number => {
    const v = String(s || '').trim();
    if (!v) return 0;
    const suf = v.replace(/^[0-9\.]+/, '');
    const num = Number(v.replace(/[^0-9\.]/g, ''));
    if (isNaN(num)) return 0;
    if (suf === 'Ki') return Math.round(num / 1024);
    if (suf === 'Mi') return Math.round(num);
    if (suf === 'Gi') return Math.round(num * 1024);
    if (suf === 'Ti') return Math.round(num * 1024 * 1024);
    return Math.round(num / (1024 * 1024));
  };
  const metricsMap = new Map<string, { cpuMilli: number; memMi: number }>();
  for (const p of metricsPods) {
    const ns = p?.metadata?.namespace || p?.namespace || '';
    const labels = p?.metadata?.labels || {};
    const domain = labels['kubevirt.io/domain'] || labels['kubevirt.io/vm'] || '';
    if (!ns || !domain) continue;
    const key = `${ns}/${domain}`;
    const cs = Array.isArray(p?.containers) ? p?.containers : Array.isArray(p?.containersMetrics) ? p?.containersMetrics : [];
    let cpu = 0, mem = 0;
    for (const c of cs) {
      cpu += parseCpuMillicores((c?.usage || c?.usageMetrics || {})?.cpu);
      mem += parseMemMi((c?.usage || c?.usageMetrics || {})?.memory);
    }
    metricsMap.set(key, { cpuMilli: cpu, memMi: mem });
  }

  const pickImageInfo = (vm: any, namespace: string): { id?: string; display?: string; value?: string } => {
    const vols: any[] = Array.isArray(vm?.spec?.template?.spec?.volumes) ? vm?.spec?.template?.spec?.volumes : [];
    const dvTemplates: any[] = Array.isArray(vm?.spec?.dataVolumeTemplates) ? vm?.spec?.dataVolumeTemplates : [];
    const dvTmplMap = new Map<string, any>();
    for (const dv of dvTemplates) {
      const dn = dv?.metadata?.name || dv?.name || '';
      if (dn) dvTmplMap.set(dn, dv);
    }

    const getInfoFromAnn = (ann: any) => {
      const imgId = ann['harvesterhci.io/imageId'] || '';
      const imgName = ann['harvesterhci.io/imageName'] || '';
      if (imgName) return { id: imgId || undefined, display: imgName, value: imgName };
      if (imgId) {
        const short = imgId.includes('/') ? (imgId.split('/').pop() || imgId) : imgId;
        const disp = imgMap.get(imgId) || imgMap.get(short);
        if (disp) return { id: short, display: disp, value: disp };
        return { id: short, display: short, value: short };
      }
      return null;
    };

    const getInfoFromSource = (spec: any) => {
        const src = spec?.source || {};
        const httpUrl = src?.http?.url;
        const regUrl = src?.registry?.url || src?.registry?.image || src?.registry?.pullSecretName;
        const s3Url = src?.s3?.url;
        const val = httpUrl || regUrl || s3Url || '';
        if (typeof val === 'string' && val) {
            try {
                const part = val.split('/').pop() || val;
                const s = part.split('?')[0];
                return { display: s, value: s };
            } catch {
                return { display: String(val), value: String(val) };
            }
        }
        return null;
    };

    // 1. Priority: Harvester Image Annotation (Check all volumes)
    for (const v of vols) {
        // DataVolume
        if (v.dataVolume?.name) {
            const name = v.dataVolume.name;
            // Template
            if (dvTmplMap.has(name)) {
                const info = getInfoFromAnn(dvTmplMap.get(name)?.metadata?.annotations || {});
                if (info) return info;
            }
            // Existing DV
            const key = namespace && name ? `${namespace}/${name}` : '';
            const dv = key ? dvAllMap.get(key) : null;
            if (dv) {
                const info = getInfoFromAnn(dv?.metadata?.annotations || {});
                if (info) return info;
            }
        }
        // PVC
        if (v.persistentVolumeClaim?.claimName) {
            const name = v.persistentVolumeClaim.claimName;
            const key = namespace && name ? `${namespace}/${name}` : '';
            // Check DV backing PVC
            const dv = key ? dvAllMap.get(key) : null;
            if (dv) {
                const info = getInfoFromAnn(dv?.metadata?.annotations || {});
                if (info) return info;
            }
            // Check PVC
            const pvc = key ? pvcMap.get(key) : null;
            if (pvc) {
                const info = getInfoFromAnn(pvc?.metadata?.annotations || {});
                if (info) return info;
                // Check PV
                const pvName = pvc?.spec?.volumeName || '';
                const pv = pvName ? pvMap.get(pvName) : null;
                if (pv) {
                     const info = getInfoFromAnn(pv?.metadata?.annotations || {});
                     if (info) return info;
                }
            }
        }
    }

    // 2. Priority: Container Disk
    const containerImg = vols.find((v: any) => !!v?.containerDisk)?.containerDisk?.image;
    if (containerImg) {
      const s = String(containerImg);
      return { display: s, value: s };
    }

    // 3. Priority: Source URL (HTTP/S3/Registry) in DVs
    for (const v of vols) {
        if (v.dataVolume?.name) {
             const name = v.dataVolume.name;
             if (dvTmplMap.has(name)) {
                 const info = getInfoFromSource(dvTmplMap.get(name)?.spec || {});
                 if (info) return info;
             }
             const key = namespace && name ? `${namespace}/${name}` : '';
             const dv = key ? dvAllMap.get(key) : null;
             if (dv) {
                 const info = getInfoFromSource(dv?.spec || {});
                 if (info) return info;
             }
        }
        if (v.persistentVolumeClaim?.claimName) {
            const name = v.persistentVolumeClaim.claimName;
            const key = namespace && name ? `${namespace}/${name}` : '';
            const dv = key ? dvAllMap.get(key) : null;
            if (dv) {
                 const info = getInfoFromSource(dv?.spec || {});
                 if (info) return info;
            }
        }
    }

    // 4. Fallback: CloudInit (display only)
    const cloudInit = vols.find((v: any) => !!v?.cloudInitNoCloud)?.cloudInitNoCloud?.userData;
    if (cloudInit) {
      const s = String(cloudInit);
      return { display: s, value: s };
    }

    // 5. Last resort: just show first PVC name
    const firstPvc = vols.find((v: any) => !!v?.persistentVolumeClaim)?.persistentVolumeClaim?.claimName;
    if (firstPvc) return { value: `PVC:${firstPvc}` };

    return {};
  };

  return vmItems.map((vm: any) => {
    const name = vm?.metadata?.name || vm?.name || '';
    const namespace = vm?.metadata?.namespace || vm?.namespace || '';
    const uid = vm?.metadata?.uid || vm?.id || name;
    const status = vm?.status?.printableStatus || vm?.status?.phase || vm?.state || 'Unknown';
    const ip0 = vm?.status?.vmIp || vm?.status?.interfaces?.[0]?.ipAddress || undefined;
    const node0 = vm?.status?.nodeName || vm?.status?.host || '';
    const vmi = vmiMap.get(namespace && name ? `${namespace}/${name}` : uid);
    const ip = ip0 || (vmi?.status?.interfaces?.[0]?.ipAddress || vmi?.status?.ipAddress || undefined);
    const nodeName = node0 || (vmi?.status?.nodeName || vmi?.status?.host || '');
    const networksArr: any[] = Array.isArray(vm?.spec?.template?.spec?.networks) ? vm?.spec?.template?.spec?.networks : [];
    const networks: string[] = networksArr.map((n:any)=> n?.multus?.networkName || (n?.name ? String(n.name) : 'pod')).filter((s:string)=> !!s);
    
    let subnetName = ip && typeof ip === 'string' ? ipToSubnet.get(ip) : undefined;
    if (!subnetName && networks.length > 0) {
      for (const net of networks) {
        const s = net.includes('/') ? net.split('/').pop()! : net;
        if (subnetToVpc.has(s)) { subnetName = s; break; }
      }
    }

    const vpcRaw = subnetName ? subnetToVpc.get(subnetName) : undefined;
    const vpcName = vpcRaw && vpcNameMap.has(vpcRaw) ? vpcNameMap.get(vpcRaw) : (vpcRaw || '');
    const cpu = vm?.spec?.template?.spec?.domain?.cpu?.cores || vm?.spec?.template?.spec?.domain?.cpu?.sockets || undefined;
    const memory = vm?.spec?.template?.spec?.domain?.resources?.requests?.memory || vm?.spec?.template?.spec?.domain?.memory?.guest || undefined;
    const info = pickImageInfo(vm, namespace);
    const pickedId = String(info?.id || '').trim();
    const pickedDisp = String(info?.display || info?.value || '').trim();
    let image = pickedDisp;
    if (pickedId) {
      const short = pickedId.includes('/') ? (pickedId.split('/').pop() || pickedId) : pickedId;
      const disp = imgMap.get(pickedId) || imgMap.get(short);
      if (disp) image = disp;
    }
    if (!pickedId && pickedDisp) {
      const short = pickedDisp.includes('/') ? (pickedDisp.split('/').pop() || pickedDisp) : pickedDisp;
      const disp = imgMap.get(pickedDisp) || imgMap.get(short);
      if (disp) image = disp;
    }
    
    const volsArr: any[] = Array.isArray(vm?.spec?.template?.spec?.volumes) ? vm?.spec?.template?.spec?.volumes : [];
    const volumeClaims: string[] = volsArr.map((v:any)=> v?.persistentVolumeClaim?.claimName).filter((s:string)=> !!s);
    const volumeMap: Record<string,string> = {};
    for (const v of volsArr) {
      const claim = v?.persistentVolumeClaim?.claimName;
      const vname = v?.name;
      if (claim && vname) { volumeMap[String(claim)] = String(vname); }
    }
    const m = metricsMap.get(namespace && name ? `${namespace}/${name}` : uid);
    const cpuMilli = m?.cpuMilli || 0;
    const memMi = m?.memMi || 0;
    const cpuPct = (typeof cpu === 'number' && cpu > 0) ? Math.min(100, Math.max(0, Math.round((cpuMilli / (cpu * 1000)) * 100))) : undefined;
    return {
      InstanceId: namespace && name ? `${namespace}/${name}` : uid,
      InstanceName: name,
      Status: status,
      InstanceType: '',
      ZoneId: '',
      VpcId: vpcRaw || '',
      VpcName: vpcName || '',
      VpcAttributes: {
        PrivateIpAddress: {
          IpAddress: ip ? [ip] : []
        }
      },
      CreationTime: vm?.metadata?.creationTimestamp || '',
      Extra: {
        Namespace: namespace || '',
        NodeName: nodeName || '',
        CPU: cpu,
        Memory: memory,
        Image: image || '',
        ImageId: (function(){
          const id0 = String(info?.id || '').trim();
          if (id0) return id0.includes('/') ? (id0.split('/').pop() || id0) : id0;
          const d0 = String(info?.display || info?.value || '').trim();
          const s = d0.includes('/') ? (d0.split('/').pop() || d0) : d0;
          return /^image-[a-z0-9]+$/i.test(s) ? s : '';
        })(),
        ImageRaw: info?.value || '',
        Networks: networks,
        SubnetName: subnetName || '',
        CpuUsagePct: cpuPct,
        MemUsage: memMi ? `${memMi}Mi` : '',
        VolumeClaims: volumeClaims,
        VolumeMap: volumeMap
      }
    };
  });
};

export const buildHarvesterVMManifest = (payload: any) => {
  const nets: string[] = Array.isArray(payload.networks) ? (payload.networks.filter(Boolean) as string[]) : [];
  const ifaces = Array.isArray((payload as any).netIfaces) ? (payload as any).netIfaces : [];
  const rootSourceType = String((payload as any).rootSourceType || 'image');
  const rootDiskName = String((payload as any).rootName || 'rootdisk');
  const rootDeviceType = String((payload as any).rootDeviceType || 'disk');
  const rootBus = String((payload as any).rootBus || payload.diskBus || 'virtio');
  const rootSize = String((payload as any).rootSize || payload.systemDiskSize || '40Gi');
  const rootImage = String(((payload as any).rootImage || payload.image || ''));
  const rootPvc = String((payload as any).rootPvc || '');
  const gpuResourceName = String((payload as any).gpuResourceName || '');
  const gpuCount = Number((payload as any).gpuCount || 0);
  const runStrategy = String(((payload as any).runStrategy || '')).trim();
  const bootUseEfi = !!(payload as any).bootUseEfi;
  const efiPersistent = !!(payload as any).efiPersistent;
  const efiSecureBoot = !!(payload as any).efiSecureBoot;
  const tpmEnabled = !!(payload as any).tpmEnabled;
  const tpmPersistent = !!(payload as any).tpmPersistent;
  const useUsbTablet = !!(payload as any).useUsbTablet;
  const cpuSockets = Number((payload as any).cpuSockets || 0);
  const cpuCores = Number((payload as any).cpuCores || 0);
  const cpuThreads = Number((payload as any).cpuThreads || 0);
  const cpuModel = String((payload as any).cpuModel || '');
  const cpuModelCustom = String((payload as any).cpuModelCustom || '');
  const dedicatedCPUPlacement = !!(payload as any).dedicatedCPUPlacement;
  const isolateEmulatorThread = !!(payload as any).isolateEmulatorThread;
  const cpuRequest = (payload as any).cpuRequest;
  const cpuLimit = (payload as any).cpuLimit;
  const memoryLimit = (payload as any).memoryLimit;
  const totalVcpu = (cpuSockets>0 && cpuCores>0 && cpuThreads>0) ? (cpuSockets * cpuCores * cpuThreads) : Number(payload.cpu || 0);
  const extraList: Array<{ name: string; size?: string; bus?: string; storageClassName?: string; type?: string; image?: string; sourceType?: string; pvc?: string; volumeMode?: string }> = Array.isArray(payload.extraDisks) ? payload.extraDisks.filter((d:any)=> !!d?.name) : [];
  const memoryRequestGi = (payload as any).memoryRequestGi;
  const hotExpandEnabled = !!(payload as any).hotExpandEnabled;
  const sshNames: string[] = Array.isArray((payload as any).sshNames) ? (payload as any).sshNames : [];
  const imageSource: any = (payload as any).imageSource || null;
  const normalizeMemory = (raw: any) => {
    const s = String(raw || '').trim();
    if (!s) return '1Gi';
    if (/^[0-9]+$/.test(s)) return `${s}Gi`;
    const m = s.match(/^([0-9]+(?:\.[0-9]+)?)\s*([A-Za-z]+)$/);
    if (!m) return '1Gi';
    const num = parseFloat(m[1]);
    const u = m[2].toLowerCase();
    if (u === 'gi' || u === 'g' || u === 'gb' || u === 'gib') return `${Math.max(1, Math.round(num))}Gi`;
    if (u === 'mi' || u === 'm' || u === 'mb' || u === 'mib') return `${Math.max(1, Math.ceil(num / 1024))}Gi`;
    if (u === 'ki' || u === 'k' || u === 'kb' || u === 'kib') return `${Math.max(1, Math.ceil(num / (1024 * 1024)))}Gi`;
    if (u === 'ti' || u === 't' || u === 'tb' || u === 'tib') return `${Math.max(1, Math.round(num * 1024))}Gi`;
    if (u === 'b' || u === 'bytes') return `${Math.max(1, Math.ceil(num / (1024 * 1024 * 1024)))}Gi`;
    return `${Math.max(1, Math.round(num))}Gi`;
  };
  const vm: any = {
    apiVersion: 'kubevirt.io/v1',
    kind: 'VirtualMachine',
    metadata: { namespace: payload.namespace, name: payload.name },
    spec: {
      ...(function(){ const v = runStrategy; return (v && ['Always','RerunOnFailure','Manual','Halted'].includes(v)) ? { runStrategy: v } : { running: false }; })(),
      dataVolumeTemplates: [
            ...extraList
              .filter((d:any)=> (d.sourceType) !== 'existing')
              .map((d:any)=> ({
                metadata: { name: d.name, annotations: d.image ? { 'harvesterhci.io/imageId': d.image, 'harvesterhci.io/imageName': d.image } : undefined },
                spec: {
                  source: { blank: {} },
                  pvc: {
                    accessModes: ['ReadWriteOnce'],
                    resources: { requests: { storage: d.size || '10Gi' } },
                    ...(d.storageClassName ? { storageClassName: d.storageClassName } : {}),
                    ...(d.volumeMode ? { volumeMode: String(d.volumeMode) } : {}),
                  },
                },
              })),
          ],
          template: {
            spec: {
          ...(payload.nodeSelector && Object.keys(payload.nodeSelector || {}).length > 0
            ? { nodeSelector: payload.nodeSelector }
            : (payload.nodeName ? { nodeSelector: { 'kubernetes.io/hostname': payload.nodeName } } : {})),
          domain: {
            cpu: {
              ...(payload.cpu ? { cores: Number(payload.cpu) } : {}),
              ...(cpuSockets>0 ? { sockets: cpuSockets } : {}),
              ...(cpuCores>0 ? { cores: cpuCores } : {}),
              ...(cpuThreads>0 ? { threads: cpuThreads } : {}),
              ...(cpuModelCustom ? { model: cpuModelCustom } : (cpuModel ? { model: cpuModel } : {})),
              ...(dedicatedCPUPlacement ? { dedicatedCPUPlacement: true } : {}),
              ...(isolateEmulatorThread ? { isolateEmulatorThread: true } : {}),
            },
            features: {
              acpi: { enabled: true }
            },
            machine: { type: 'q35' },
          resources: {
            requests: {
                memory: (function(){ const mr = (typeof memoryRequestGi === 'number' ? `${memoryRequestGi}Gi` : undefined); const base = String((mr || payload.memory) || '').trim(); const v = (base && base.toLowerCase() !== 'undefined') ? base : '4Gi'; return normalizeMemory(v); })(),
                ...(typeof cpuRequest !== 'undefined' && cpuRequest !== null ? { cpu: String(cpuRequest) } : (dedicatedCPUPlacement && totalVcpu>0 ? { cpu: String(totalVcpu) } : {})),
              },
              ...(function(){
                const limits: any = {};
                if ((typeof cpuLimit !== 'undefined' && cpuLimit !== null) || (dedicatedCPUPlacement && totalVcpu>0)) {
                  limits.cpu = String(typeof cpuLimit !== 'undefined' && cpuLimit !== null ? cpuLimit : totalVcpu);
                }
                const reqMem = (function(){ const mr = (typeof memoryRequestGi === 'number' ? `${memoryRequestGi}Gi` : undefined); const base = String((mr || payload.memory) || '').trim(); const v = (base && base.toLowerCase() !== 'undefined') ? base : '4Gi'; return normalizeMemory(v); })();
                limits.memory = String(memoryLimit || reqMem);
                if (hotExpandEnabled) {
                  if (!('cpu' in limits)) { const v = Number(payload.cpu || 1); limits.cpu = String(Math.max(1, v * 4)); }
                  if (!('memory' in limits)) { const mm = String(reqMem||'').toUpperCase(); const num = Number(String(mm).replace(/[^0-9]/g,''))||0; limits.memory = /MI$/.test(mm) ? `${num*4}Mi` : `${num*4}Gi`; }
                }
                return Object.keys(limits).length>0 ? { limits } : {};
              })(),
            },
          devices: {
            disks: [
              (function(){
                const dev = { bus: rootBus || 'virtio' } as any;
                return rootDeviceType === 'cdrom'
                  ? { name: rootDiskName, cdrom: dev, bootOrder: 1 }
                  : { name: rootDiskName, disk: dev, bootOrder: 1 };
              })(),
              ...(payload.userData ? [
                { name: 'cloudinitdisk', disk: { bus: payload.cloudInitBus || 'virtio' } }
              ] : []),
              ...extraList.map((d:any)=> ({ name: d.name, disk: { bus: d.bus || 'virtio' } })),
            ],
            ...(gpuResourceName && gpuCount > 0 ? { gpus: Array.from({ length: gpuCount }).map((_, i) => ({ deviceName: gpuResourceName, name: `gpu${i+1}` })) } : {}),
            ...((Array.isArray((payload as any).usbDevices) && (payload as any).usbDevices.length > 0) ? { hostDevices: ((payload as any).usbDevices as string[]).map((resName: string, i: number) => ({ deviceName: resName, name: `usb${i+1}` })) } : {}),
            ...(tpmEnabled ? { tpm: (tpmPersistent ? { persistent: true } : {}) } : {}),
            ...(useUsbTablet ? { inputs: [{ type: 'tablet', bus: 'usb' }] } : {}),
            interfaces: [
              ...(ifaces.length > 0
                ? ifaces.map((n:any) => ({
                    name: (function(){ const s = String(n?.name || ''); const t = s.includes('/') ? (s.split('/').pop() || s) : s; return t.replace(/[^a-zA-Z0-9-]/g,'-').toLowerCase(); })(),
                    ...(function(){ const t = String(n?.type||'bridge'); if (n.name === 'default' || t === 'masquerade') return { masquerade: {} }; if (t === 'sriov') return { sriov: {} }; if (t === 'macvtap') return { macvtap: {} }; return { bridge: {} }; })(),
                    ...(n.model ? { model: n.model } : {}),
                    ...(n.macAddress ? { macAddress: n.macAddress } : {})
                  }))
                : [
                    { name: 'default', masquerade: {} },
                    ...nets.map((n) => ({ name: (function(){ const s = String(n || ''); const t = s.includes('/') ? (s.split('/').pop() || s) : s; return t.replace(/[^a-zA-Z0-9-]/g,'-').toLowerCase(); })(), bridge: {} }))
                  ]
              )
            ]
          },
          ...(bootUseEfi
            ? {
                firmware: {
                  bootloader: {
                    efi: {
                      ...(efiSecureBoot ? { secureBoot: true } : {}),
                      ...(efiPersistent ? { persistent: true } : {})
                    }
                  }
                }
              }
            : {
                firmware: {
                  bootloader: { bios: {} }
                }
              }
          )
        },
        volumes: [
            ...(
              (rootSourceType === 'existing' && rootPvc)
                ? [{ name: rootDiskName, persistentVolumeClaim: { claimName: rootPvc } }]
                : [{ name: rootDiskName, persistentVolumeClaim: { claimName: rootDiskName } }]
            ),
            ...(payload.userData ? [
              { name: 'cloudinitdisk', cloudInitNoCloud: { userData: payload.userData } }
            ] : []),
            ...extraList.map((d:any)=> (
              (d.sourceType === 'existing' && d.pvc)
                ? { name: d.name, persistentVolumeClaim: { claimName: d.pvc } }
                : { name: d.name, dataVolume: { name: d.name } }
            )),
          ],
          networks: [
            ...(ifaces.length > 0
              ? ifaces.map((n:any) => (
                  n.name === 'default'
                    ? { name: 'default', pod: {} }
                    : { name: (function(){ const s = String(n?.name || ''); const t = s.includes('/') ? (s.split('/').pop() || s) : s; return t.replace(/[^a-zA-Z0-9-]/g,'-').toLowerCase(); })(), multus: { networkName: n.name } }
                ))
              : [
                  { name: 'default', pod: {} },
                  ...nets.map((n) => ({ name: (function(){ const s = String(n || ''); const t = s.includes('/') ? (s.split('/').pop() || s) : s; return t.replace(/[^a-zA-Z0-9-]/g,'-').toLowerCase(); })(), multus: { networkName: n } }))
                ]
            )
          ]
        }
      }
    }
  };
  // Inject Harvester volumeClaimTemplates annotation for image-based root disk
  if (rootSourceType === 'image' && rootImage) {
    try {
      const lastSeg = rootImage.includes('/') ? (rootImage.split('/').pop() || rootImage) : rootImage;
      const suffix = String(lastSeg).replace(/^image-/, '');
      const scName = payload.storageClassName ? String(payload.storageClassName) : (suffix ? `longhorn-image-${suffix}` : undefined);
      const normalizeQuantity = (raw: any) => {
        const s = String(raw || '').trim();
        if (!s) return '1Gi';
        if (/^[0-9]+$/.test(s)) return `${s}Gi`;
        const m = s.match(/^([0-9]+(?:\.[0-9]+)?)\s*([A-Za-z]+)$/);
        if (!m) return '1Gi';
        const num = m[1];
        const u = m[2].toLowerCase();
        const unit = (function(){
          if (u === 'gi' || u === 'g' || u === 'gb') return 'Gi';
          if (u === 'mi' || u === 'm' || u === 'mb') return 'Mi';
          if (u === 'ki' || u === 'k' || u === 'kb') return 'Ki';
          if (u === 'ti' || u === 't' || u === 'tb') return 'Ti';
          if (u === 'pi' || u === 'p' || u === 'pb') return 'Pi';
          if (u === 'ei' || u === 'e' || u === 'eb') return 'Ei';
          return 'Gi';
        })();
        return `${num}${unit}`;
      };
      const sizeQ = normalizeQuantity(rootSize);
      const tmpl = [{
        metadata: {
          name: rootDiskName,
          annotations: { 'harvesterhci.io/imageId': rootImage }
        },
        spec: {
          accessModes: ['ReadWriteMany'],
          resources: { requests: { storage: sizeQ } },
          volumeMode: 'Block',
          ...(scName ? { storageClassName: scName } : {})
        }
      }];
      const ipsArr = (function(){ const arr:any[]=[]; const list:any[] = Array.isArray(ifaces)?ifaces:[]; list.forEach((x:any)=>{ if (x && (x.name||'') && x.ipAddress) { arr.push({ name: String(x.name), ipAddress: String(x.ipAddress) }); } }); return arr; })();
      vm.metadata.annotations = { ...(vm.metadata.annotations || {}), 'harvesterhci.io/volumeClaimTemplates': JSON.stringify(tmpl), 'network.harvesterhci.io/ips': JSON.stringify(ipsArr) };
    } catch {}
  } else {
     // Ensure IPS are injected even if not image-based (e.g. existing pvc)
     const ipsArr = (function(){ const arr:any[]=[]; const list:any[] = Array.isArray(ifaces)?ifaces:[]; list.forEach((x:any)=>{ if (x && (x.name||'') && x.ipAddress) { arr.push({ name: String(x.name), ipAddress: String(x.ipAddress) }); } }); return arr; })();
     vm.metadata.annotations = { ...(vm.metadata.annotations || {}), 'network.harvesterhci.io/ips': JSON.stringify(ipsArr) };
  }
  
  vm.spec.template = vm.spec.template || {};
  vm.spec.template.metadata = { ...(vm.spec.template.metadata || {}), annotations: { ...(vm.spec.template?.metadata?.annotations || {}), 'harvesterhci.io/sshNames': JSON.stringify(sshNames) }, labels: { ...(vm.spec.template?.metadata?.labels || {}), 'harvesterhci.io/vmName': String(payload.name || rootDiskName) } };
  const mem = (function(){ const base = String(payload.memory || '').trim(); const v = (base && base.toLowerCase() !== 'undefined') ? base : '2Gi'; return normalizeMemory(v); })();
  vm.spec.template.spec.domain = vm.spec.template.spec.domain || {};
  vm.spec.template.spec.domain.memory = { guest: mem };
  if (bootUseEfi && efiSecureBoot) {
    vm.spec.template.spec.domain.features = { ...(vm.spec.template.spec.domain.features || {}), smm: { enabled: true } };
  }
  return vm;
};

export const createHarvesterVM = async (
  { endpoint, token, insecure = false }: HarvesterTestParams,
  payload: { namespace: string; name: string; cpu: number; memory: string; image: string; networks?: string[]; userData?: string; systemDiskSize?: string; storageClassName?: string; nodeName?: string; nodeSelector?: Record<string,string>; diskBus?: string; cloudInitAsCdrom?: boolean; cloudInitBus?: string; runStrategy?: 'Always'|'RerunOnFailure'|'Manual'|'Halted'; extraDisks?: Array<{ name: string; size?: string; bus?: string; storageClassName?: string; type?: string; image?: string; sourceType?: string; pvc?: string; volumeMode?: string }>; netIfaces?: Array<{ name: string; type?: string; model?: string; macAddress?: string; ipAddress?: string }>; cpuSockets?: number; cpuCores?: number; cpuThreads?: number; cpuModel?: string; cpuModelCustom?: string; dedicatedCPUPlacement?: boolean; isolateEmulatorThread?: boolean; cpuRequest?: number; cpuLimit?: number; memoryLimit?: string; memoryRequestGi?: number; hotExpandEnabled?: boolean; sshNames?: string[]; bootUseEfi?: boolean; efiPersistent?: boolean; efiSecureBoot?: boolean; gpuMode?: string; gpuResourceName?: string; gpuCount?: number; usbDevices?: string[]; tpmEnabled?: boolean; tpmPersistent?: boolean; useUsbTablet?: boolean; installGuestAgent?: boolean }
) => {
  const base = (endpoint || '').replace(/\/+$/, '');
  let origin = base;
  try { const u = new URL(base); origin = `${u.protocol}//${u.host}`; } catch { origin = base.replace(/\/v[0-9].*$/, ''); }
  const url = `${origin}/v1/harvester/kubevirt.io.virtualmachines/${encodeURIComponent(payload.namespace)}`;
  let imageSource: any = null;
  try {
    const imgCandidates = [
      `${origin}/v1/harvester/harvesterhci.io.virtualmachineimages`,
      `${origin}/apis/harvesterhci.io/v1/virtualmachineimages`
    ];
    let imgJson: any = null;
    for (const iu of imgCandidates) { try { imgJson = await getJsonOnce(iu, token, insecure); if (imgJson) break; } catch {} }
    const items: any[] = Array.isArray(imgJson?.data?.items) ? imgJson?.data?.items : (Array.isArray(imgJson?.items) ? imgJson?.items : []);
    const hit = items.find((it:any)=> (it?.metadata?.name || it?.name) === payload.image);
    imageSource = hit?.spec?.source || null;
  } catch {}
  const vm = buildHarvesterVMManifest({ ...(payload as any), imageSource });
  return await requestJson('POST', url, token, insecure, vm);
};

export const getHarvesterVM = async ({ endpoint, token, insecure = false }: HarvesterTestParams, namespace: string, name: string): Promise<any> => {
  const base = (endpoint || '').replace(/\/+$/, '');
  let origin = base;
  try { const u = new URL(base); origin = `${u.protocol}//${u.host}`; } catch { origin = base.replace(/\/v[0-9].*$/, ''); }
  const url = `${origin}/v1/harvester/kubevirt.io.virtualmachines/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}`;
  const json = await getJsonOnce(url, token, insecure);
  return json;
};

export const updateHarvesterVMSpec = async (
  { endpoint, token, insecure = false }: HarvesterTestParams,
  namespace: string,
  name: string,
  payload: { cpu?: number; memory?: string; runStrategy?: 'Always'|'Manual'|'RerunOnFailure'|'Halted'; cpuSockets?: number; cpuCores?: number; cpuThreads?: number; dedicatedCPUPlacement?: boolean; cpuRequest?: number; cpuLimit?: number; memoryLimit?: string }
): Promise<any> => {
  const base = (endpoint || '').replace(/\/+$/, '');
  let origin = base;
  try { const u = new URL(base); origin = `${u.protocol}//${u.host}`; } catch { origin = base.replace(/\/v[0-9].*$/, ''); }
  const url = `${origin}/v1/harvester/kubevirt.io.virtualmachines/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}`;
  const cur = await getJsonOnce(url, token, insecure);
  const next = JSON.parse(JSON.stringify(cur || {}));
  next.spec = next.spec || {};
  if (payload.runStrategy) next.spec.runStrategy = payload.runStrategy;
  const tpl = next.spec.template = next.spec.template || {};
  const tspec = tpl.spec = tpl.spec || {};
  const domain = tspec.domain = tspec.domain || {};
  domain.cpu = domain.cpu || {};
  domain.resources = domain.resources || {};
  domain.resources.requests = domain.resources.requests || {};
  domain.resources.limits = domain.resources.limits || {};
  if (typeof payload.cpu === 'number' && payload.cpu > 0) {
    domain.cpu.cores = payload.cpu;
  }
  if (typeof payload.cpuSockets === 'number' && payload.cpuSockets > 0) domain.cpu.sockets = payload.cpuSockets;
  if (typeof payload.cpuCores === 'number' && payload.cpuCores > 0) domain.cpu.cores = payload.cpuCores;
  if (typeof payload.cpuThreads === 'number' && payload.cpuThreads > 0) domain.cpu.threads = payload.cpuThreads;
  if (typeof payload.dedicatedCPUPlacement === 'boolean') domain.cpu.dedicatedCpuPlacement = payload.dedicatedCPUPlacement;
  if (typeof payload.cpuRequest === 'number' && payload.cpuRequest >= 0) domain.resources.requests.cpu = String(payload.cpuRequest);
  if (typeof payload.cpuLimit === 'number' && payload.cpuLimit >= 0) domain.resources.limits.cpu = String(payload.cpuLimit);
  if (typeof payload.memory === 'string' && payload.memory) {
    domain.resources.requests.memory = String(payload.memory);
  }
  if (typeof payload.memoryLimit === 'string' && payload.memoryLimit) {
    domain.resources.limits.memory = String(payload.memoryLimit);
  }
  const putJson = await requestJson('PUT', url, token, insecure, next);
  return putJson;
};

export const getHarvesterVmVncUrl = async (
  { endpoint, token, insecure = false }: HarvesterTestParams,
  namespace: string,
  name: string
): Promise<string | null> => {
  const base = (endpoint || '').replace(/\/+$/, '');
  let origin = base;
  try { const u = new URL(base); origin = `${u.protocol}//${u.host}`; } catch { origin = base.replace(/\/v[0-9].*$/, ''); }
  let clusterId: string | null = null;
  try {
    const clusters = await getJsonOnce(`${origin}/v3/clusters`, token, insecure);
    const items: any[] = Array.isArray(clusters?.data) ? clusters?.data : Array.isArray(clusters?.items) ? clusters?.items : [];
    const local = items.find((c: any) => String(c?.id || c?.Id || '').toLowerCase() === 'local');
    const any = items[0];
    clusterId = String((local?.id || local?.Id || any?.id || any?.Id || ''))?.trim() || null;
  } catch {}
  let uid: string | null = null;
  try {
    const vmi = await getJsonOnce(`${origin}/v1/harvester/kubevirt.io.virtualmachineinstances/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}`, token, insecure);
    uid = String(vmi?.metadata?.uid || vmi?.id || '').trim() || null;
  } catch {}
  if (!uid) {
    try {
      const vm = await getJsonOnce(`${origin}/v1/harvester/kubevirt.io.virtualmachines/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}`, token, insecure);
      uid = String(vm?.metadata?.uid || vm?.id || '').trim() || null;
    } catch {}
  }
  const cid = clusterId || 'local';
  if (uid) {
    const candidates = [
      `${origin}/dashboard/harvester/c/${encodeURIComponent(cid)}/console/${encodeURIComponent(uid)}/vnc`,
      `${origin}/dashboard/cloud/c/${encodeURIComponent(cid)}/console/${encodeURIComponent(uid)}/vnc`
    ];
    for (const u of candidates) {
      try {
        const j: any = await getJsonOnce(u, token, insecure);
        const text = typeof j?.text === 'string' ? j.text : '';
        const isFailWhale = /fail-whale/i.test(text || '');
        if (!isFailWhale) return u;
      } catch {
        // 如无法解析为JSON，说明是HTML，继续尝试下一候选
      }
    }
    return null;
  }
  return null;
};
