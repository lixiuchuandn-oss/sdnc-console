/**
 * 虚拟机卡片：从 VM 和 VMI 列表解析 运行中/已暂停/已关机/其他
 * 
 * [修复说明]
 * - 之前只使用 VMI 列表统计，但 VMI 只在虚拟机运行时存在，导致已关机的虚拟机无法统计
 * - 现在使用 VM 列表统计总数（VM 始终存在），使用 VMI 列表和 VM 状态统计运行状态
 */
export type VMStatusKey = 'running' | 'paused' | 'stopped' | 'other';

export interface VMStatusSegment {
  label: string;
  value: number;
  key: VMStatusKey;
}

export interface VMInstancesSummary {
  total: number;
  segments: VMStatusSegment[];
}

function getVMList(response: any): any[] {
  if (Array.isArray(response)) return response;
  if (response && Array.isArray(response.data)) return response.data;
  if (response && Array.isArray(response.items)) return response.items;
  return [];
}

function getVMIList(response: any): any[] {
  if (Array.isArray(response)) return response;
  if (response && Array.isArray(response.data)) return response.data;
  if (response && Array.isArray(response.items)) return response.items;
  return [];
}

function isPaused(vmi: any): boolean {
  const conditions = vmi?.status?.conditions || [];
  return conditions.some((c: any) => c.type === 'Paused');
}

/**
 * 从 VM 和 VMI 列表解析虚拟机状态统计
 * @param vmResponse VM 列表响应（用于统计总数）
 * @param vmiResponse VMI 列表响应（用于统计运行状态）
 */
export function parseVMInstancesToStatusCounts(vmResponse: any, vmiResponse?: any): VMInstancesSummary {
  const vmList = getVMList(vmResponse);
  const vmiList = getVMIList(vmiResponse);
  
  // 创建 VMI 映射表，key 为 namespace/name
  const vmiMap = new Map<string, any>();
  for (const vmi of vmiList) {
    const namespace = vmi?.metadata?.namespace || '';
    const name = vmi?.metadata?.name || '';
    if (namespace && name) {
      vmiMap.set(`${namespace}/${name}`, vmi);
    }
  }

  const segments: VMStatusSegment[] = [
    { label: '运行中', value: 0, key: 'running' },
    { label: '已暂停', value: 0, key: 'paused' },
    { label: '已关机', value: 0, key: 'stopped' },
    { label: '其他', value: 0, key: 'other' },
  ];

  // 遍历所有 VM（包括已关机的）
  for (const vm of vmList) {
    // 跳过正在删除的 VM
    if (vm?.metadata?.deletionTimestamp) {
      segments[3].value++;
      continue;
    }

    const namespace = vm?.metadata?.namespace || '';
    const name = vm?.metadata?.name || '';
    const vmiKey = `${namespace}/${name}`;
    const vmi = vmiMap.get(vmiKey);

    if (vmi) {
      // 如果存在 VMI，说明虚拟机正在运行
      if (isPaused(vmi)) {
        segments[1].value++; // 已暂停
      } else {
        const phase = (vmi?.status?.phase || '').toLowerCase();
        if (phase === 'running') {
          segments[0].value++; // 运行中
        } else {
          segments[3].value++; // 其他状态
        }
      }
    } else {
      // 不存在 VMI，说明虚拟机已关机
      // 检查 VM 的状态字段
      const vmStatus = vm?.status?.printableStatus || vm?.status?.phase || '';
      const vmStatusLower = String(vmStatus).toLowerCase();
      
      if (vmStatusLower === 'stopped' || vmStatusLower === 'stopping') {
        segments[2].value++; // 已关机
      } else {
        segments[2].value++; // 默认认为已关机（因为没有 VMI）
      }
    }
  }

  return { total: vmList.length, segments };
}
