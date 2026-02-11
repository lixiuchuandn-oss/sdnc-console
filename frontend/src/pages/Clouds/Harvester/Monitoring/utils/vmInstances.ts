/**
 * 虚拟机卡片：从 VMI 列表解析 运行中/已暂停/已关机/其他
 * 与参考项目 Compute.Tower-Monitoring 一致。
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

function getVMIList(response: any): any[] {
  if (Array.isArray(response)) return response;
  if (response && Array.isArray(response.data)) return response.data;
  return [];
}

function isPaused(vmi: any): boolean {
  const conditions = vmi?.status?.conditions || [];
  return conditions.some((c: any) => c.type === 'Paused');
}

export function parseVMInstancesToStatusCounts(vmiResponse: any): VMInstancesSummary {
  const list = getVMIList(vmiResponse);
  const segments: VMStatusSegment[] = [
    { label: '运行中', value: 0, key: 'running' },
    { label: '已暂停', value: 0, key: 'paused' },
    { label: '已关机', value: 0, key: 'stopped' },
    { label: '其他', value: 0, key: 'other' },
  ];

  for (const vmi of list) {
    if (vmi?.metadata?.deletionTimestamp) {
      segments[3].value++;
      continue;
    }
    const phase = (vmi?.status?.phase || '').toLowerCase();
    if (isPaused(vmi)) segments[1].value++;
    else if (phase === 'running') segments[0].value++;
    else if (phase === 'succeeded' || phase === 'failed') segments[2].value++;
    else segments[3].value++;
  }

  return { total: list.length, segments };
}
