import { supportCPUAndMemoryHotplug } from './hotplug';

const ALLOWED_PAGE_SIZES = new Set(['2Mi', '1Gi']);

function parseMemoryGi(raw: unknown): number | undefined {
  if (raw === undefined || raw === null || raw === '') return undefined;
  const s = String(raw).trim();
  if (!s) return undefined;
  if (s.endsWith('Gi')) {
    const n = parseFloat(s.slice(0, -2));
    return Number.isFinite(n) && n > 0 ? n : undefined;
  }
  if (s.endsWith('Mi')) {
    const n = parseFloat(s.slice(0, -2));
    return Number.isFinite(n) && n > 0 ? n / 1024 : undefined;
  }
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

function resolveTargetMemoryGi(spec: Record<string, unknown>, current: any): number | undefined {
  if (typeof spec.memoryRequestGi === 'number' && spec.memoryRequestGi > 0) {
    return spec.memoryRequestGi;
  }
  if (typeof spec.memoryLimitGi === 'number' && spec.memoryLimitGi > 0) {
    return spec.memoryLimitGi;
  }
  if (spec.memory !== undefined) {
    return parseMemoryGi(spec.memory);
  }
  const guest = current?.spec?.template?.spec?.domain?.memory?.guest;
  const req = current?.spec?.template?.spec?.domain?.resources?.requests?.memory;
  return parseMemoryGi(guest) ?? parseMemoryGi(req);
}

/** 变配请求中大页相关字段校验 */
export function validateHugepagesSpec(spec: Record<string, unknown>, current: any): void {
  const touchesHugepages =
    spec.hugepagesEnabled !== undefined || spec.hugepagesPageSize !== undefined;
  if (!touchesHugepages) return;

  const enabling = spec.hugepagesEnabled === true;
  const disabling = spec.hugepagesEnabled === false;

  if (disabling && spec.hugepagesPageSize === undefined) return;

  const isHotPlug =
    spec.enableHotPlug === true ||
    (spec.enableHotPlug !== false && supportCPUAndMemoryHotplug(current));

  if (isHotPlug && (enabling || (spec.hugepagesPageSize && !disabling))) {
    throw new Error('大页内存暂不支持与 CPU/内存热扩容同时启用');
  }

  const currentPageSize = current?.spec?.template?.spec?.domain?.memory?.hugepages?.pageSize;
  const pageSize = String(spec.hugepagesPageSize ?? (enabling ? currentPageSize : '') ?? '').trim();

  if (enabling || (spec.hugepagesPageSize && !disabling)) {
    if (!ALLOWED_PAGE_SIZES.has(pageSize)) {
      throw new Error('大页内存页大小须为 2Mi 或 1Gi');
    }

    const memGi = resolveTargetMemoryGi(spec, current);
    if (pageSize === '1Gi' && memGi !== undefined && !Number.isInteger(memGi)) {
      throw new Error('1Gi 大页要求虚拟机内存为整数 GiB');
    }
  }
}
