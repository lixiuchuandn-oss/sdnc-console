import { useEffect } from 'react';
import type { FormInstance } from 'antd/es/form';
import type { Dispatch, SetStateAction } from 'react';

/**
 * 「变更 GPU」菜单项：GPU 资源列表异步到达后，同步表单 gpuMode / gpuResourceNames 与表格选中行 key（与原先 `useVmReconfigure` 内 effect 一致）。
 */
export function useVmReconfigureGpuMenuSync(params: {
  open: boolean;
  selectedKey: string;
  activeRecord: any;
  gpuResources: any[];
  form: FormInstance;
  setSelectedGpuKeys: Dispatch<SetStateAction<string[]>>;
}) {
  const { open, selectedKey, activeRecord, gpuResources, form, setSelectedGpuKeys } = params;

  useEffect(() => {
    if (!open) return;
    if (selectedKey !== 'change_gpu') return;

    const domain = activeRecord?.spec?.template?.spec?.domain;
    const hostDevices = domain?.devices?.hostDevices || [];
    const gpus = domain?.devices?.gpus || [];
    const hostNames = (Array.isArray(hostDevices) ? hostDevices : []).map((x: any) => x?.deviceName).filter(Boolean);
    const gpuNames = (Array.isArray(gpus) ? gpus : []).map((x: any) => x?.deviceName).filter(Boolean);
    const getResourceName = (x: any) => x?.resourceName || x?.raw?.status?.resourceName || x?.raw?.spec?.resourceName;
    const resList = Array.isArray(gpuResources) ? gpuResources : [];

    const deriveModeFromVm = () => {
      if (gpuNames.length > 0) return 'vgpu';
      if (hostNames.length === 0) return 'none';
      const wanted = new Set(hostNames.map((x: any) => String(x)));
      const matchedTypes = new Set<string>();
      resList.forEach((x: any) => {
        const rn = getResourceName(x);
        if (!rn) return;
        if (!wanted.has(String(rn))) return;
        const t = String(x?.type || '').toLowerCase();
        if (t) matchedTypes.add(t);
      });
      if (matchedTypes.has('sriov')) return 'sriov';
      if (matchedTypes.has('passthrough')) return 'passthrough';
      return 'passthrough';
    };

    const inferredMode = deriveModeFromVm();
    const currentMode = form.getFieldValue('gpuMode') || 'none';
    if (currentMode !== inferredMode) {
      const names = inferredMode === 'vgpu' ? gpuNames : inferredMode === 'none' ? [] : hostNames;
      form.setFieldsValue({ gpuMode: inferredMode, gpuResourceNames: Array.from(new Set(names.filter(Boolean))) });
    }

    const effectiveMode = form.getFieldValue('gpuMode') || inferredMode || 'none';
    if (effectiveMode === 'none') {
      setSelectedGpuKeys([]);
      return;
    }

    const vmAssigned = effectiveMode === 'vgpu' ? gpus : hostDevices;
    const vmAssignedNames = (Array.isArray(vmAssigned) ? vmAssigned : []).map((x: any) => x?.deviceName).filter(Boolean);

    const currentNames = form.getFieldValue('gpuResourceNames');
    const desiredNames = Array.isArray(currentNames) && currentNames.length > 0 ? currentNames : vmAssignedNames;
    if (!Array.isArray(desiredNames) || desiredNames.length === 0) {
      setSelectedGpuKeys([]);
      return;
    }

    form.setFieldsValue({ gpuResourceNames: Array.from(new Set(desiredNames.filter(Boolean))) });

    const parseAllocation = () => {
      try {
        const raw = activeRecord?.metadata?.annotations?.['harvesterhci.io/deviceAllocationDetails'];
        if (!raw) return null;
        return typeof raw === 'string' ? JSON.parse(raw) : raw;
      } catch {
        return null;
      }
    };
    const allocation = parseAllocation();
    const hostAlloc = allocation?.hostdevices || {};
    const runningNode = activeRecord?.vmi?.status?.nodeName || activeRecord?.vmiRaw?.status?.nodeName || undefined;

    const matchByAllocName = (allocName: string) => {
      const target = String(allocName || '');
      if (!target) return null;
      const found = resList.find((x: any) => String(x?.raw?.metadata?.name || x?.name || '') === target);
      if (!found) return null;
      if (String(found?.type) !== String(effectiveMode)) return null;
      const name = found?.raw?.metadata?.name || found?.name || target || '-';
      const node = found?.node || found?.nodeName || '-';
      const bus = found?.pciAddress || found?.address || found?.pci || '-';
      return `${name}|${node}|${bus}`;
    };

    const buildKeyFromResourceName = (rn: string, usedKeys: Set<string>) => {
      const candidates = resList
        .filter((x: any) => String(x?.type) === String(effectiveMode))
        .filter((x: any) => String(getResourceName(x) || '') === String(rn || ''));
      const scored = candidates.slice().sort((a: any, b: any) => {
        const an = String(a?.node || a?.nodeName || '');
        const bn = String(b?.node || b?.nodeName || '');
        const as = runningNode && an === runningNode ? 1 : 0;
        const bs = runningNode && bn === runningNode ? 1 : 0;
        return bs - as;
      });
      const pick =
        scored.find((x: any) => {
          const name = x?.raw?.metadata?.name || x?.name || rn || '-';
          const node = x?.node || x?.nodeName || '-';
          const bus = x?.pciAddress || x?.address || x?.pci || '-';
          const key = `${name}|${node}|${bus}`;
          return !usedKeys.has(key);
        }) || scored[0];
      if (!pick) return null;
      const name = pick?.raw?.metadata?.name || pick?.name || rn || '-';
      const node = pick?.node || pick?.nodeName || '-';
      const bus = pick?.pciAddress || pick?.address || pick?.pci || '-';
      return `${name}|${node}|${bus}`;
    };

    const keys: string[] = [];
    const usedKeys = new Set<string>();

    if (effectiveMode !== 'vgpu') {
      const assigned = Array.isArray(hostDevices) ? hostDevices : [];
      assigned.forEach((d: any) => {
        const rn = String(d?.deviceName || '');
        const allocNames = Array.isArray(hostAlloc?.[rn]) ? hostAlloc[rn] : [];
        if (allocNames.length > 0) {
          const k = matchByAllocName(String(allocNames[0] || ''));
          if (k) {
            keys.push(k);
            usedKeys.add(k);
            return;
          }
        }
        const k = buildKeyFromResourceName(rn, usedKeys);
        if (k) {
          keys.push(k);
          usedKeys.add(k);
        }
      });
    } else {
      const assigned = Array.isArray(gpus) ? gpus : [];
      assigned.forEach((d: any) => {
        const rn = String(d?.deviceName || '');
        const k = buildKeyFromResourceName(rn, usedKeys);
        if (k) {
          keys.push(k);
          usedKeys.add(k);
        }
      });
    }

    setSelectedGpuKeys(keys);
    const inferredNode = (() => {
      const first = keys[0];
      if (!first) return null;
      const parts = String(first).split('|');
      const node = parts.length >= 2 ? String(parts[1] || '') : '';
      if (!node || node === '-') return null;
      return node;
    })();
    form.setFieldsValue({ gpuNodeName: inferredNode });
  }, [open, selectedKey, activeRecord, gpuResources, form, setSelectedGpuKeys]);
}
