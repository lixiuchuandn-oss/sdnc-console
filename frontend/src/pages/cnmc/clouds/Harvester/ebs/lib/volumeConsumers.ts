import type { VolumeView } from './volumesSectionTypes';

export type PvcWorkloadConsumer = {
  kind: string;
  name: string;
};

export function parseVolumeWorkloadConsumers(record: VolumeView | Record<string, unknown>): PvcWorkloadConsumer[] {
  const row = record as VolumeView & { workloadConsumers?: PvcWorkloadConsumer[] };
  if (Array.isArray(row.workloadConsumers) && row.workloadConsumers.length > 0) {
    return row.workloadConsumers.filter((item) => item?.name);
  }

  const raw = (row.raw || row) as {
    workloadConsumers?: PvcWorkloadConsumer[];
  };
  if (Array.isArray(raw?.workloadConsumers) && raw.workloadConsumers.length > 0) {
    return raw.workloadConsumers.filter((item) => item?.name);
  }

  return [];
}

export function formatWorkloadConsumerLabel(consumer: PvcWorkloadConsumer): string {
  if (!consumer?.name) return '';
  return consumer.kind ? `${consumer.kind}/${consumer.name}` : consumer.name;
}

export function getVolumeWorkloadConsumerLabels(record: VolumeView): string[] {
  const fromConsumers = parseVolumeWorkloadConsumers(record)
    .map(formatWorkloadConsumerLabel)
    .filter(Boolean);
  if (fromConsumers.length > 0) return fromConsumers;

  return (record.attachedTo || []).filter((label) =>
    /^(Deployment|StatefulSet|DaemonSet|Job|CronJob)\//.test(String(label)),
  );
}

export function isVolumeUsedByWorkload(record: VolumeView): boolean {
  return getVolumeWorkloadConsumerLabels(record).length > 0;
}

export function volumeWorkloadInUseHint(record: VolumeView): string {
  const labels = getVolumeWorkloadConsumerLabels(record);
  if (labels.length === 0) return '';
  return `该云盘正被工作负载使用：${labels.join(', ')}，请先在相关工作负载中解除挂载后再删除`;
}
