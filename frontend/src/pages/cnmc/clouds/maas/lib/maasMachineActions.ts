import { machineStatusCode } from './maasMachineBuckets';

/** 行操作 key：deploy/detail/delete 为本地交互，其余直通 MAAS op */
export type MaasRowActionKey =
  | 'detail'
  | 'commission'
  | 'deploy'
  | 'power_on'
  | 'power_off'
  | 'power_cycle'
  | 'mark_broken'
  | 'mark_fixed'
  | 'abort'
  | 'release'
  | 'delete';

export type MaasRowAction = {
  key: MaasRowActionKey;
  label: string;
  danger?: boolean;
};

/** 进行中（可中止、其余操作应隐藏）：纳管/部署/回收/擦盘/进出救援/测试 */
const IN_PROGRESS = new Set([1, 9, 12, 14, 17, 19, 21]);

const isInProgress = (code: number | null): boolean =>
  code != null && IN_PROGRESS.has(code);
const isDeployed = (code: number | null): boolean => code === 6;
const isReady = (code: number | null): boolean => code === 4;
const isAllocated = (code: number | null): boolean => code === 10;
const isBroken = (code: number | null): boolean => code === 8;

type ActionDef = MaasRowAction & { visible: (code: number | null) => boolean };

/** 操作顺序与可见性遵循 MAAS NodeStatus 状态机，避免无效操作触发 409 */
const ACTION_DEFS: ActionDef[] = [
  { key: 'detail', label: '详情', visible: () => true },
  {
    key: 'commission',
    label: '纳管',
    visible: (c) => !isInProgress(c) && !isDeployed(c) && !isAllocated(c),
  },
  {
    key: 'deploy',
    label: '部署',
    visible: (c) => isReady(c) || isAllocated(c),
  },
  { key: 'power_on', label: '开机', visible: (c) => !isInProgress(c) },
  { key: 'power_off', label: '关机', visible: (c) => !isInProgress(c) },
  { key: 'power_cycle', label: '重启', visible: (c) => !isInProgress(c) },
  {
    key: 'mark_broken',
    label: '标记故障',
    visible: (c) => !isInProgress(c) && !isBroken(c),
  },
  { key: 'mark_fixed', label: '标记修复', visible: (c) => isBroken(c) },
  {
    key: 'abort',
    label: '中止操作',
    danger: true,
    visible: (c) => isInProgress(c),
  },
  {
    key: 'release',
    label: '释放',
    danger: true,
    visible: (c) => isDeployed(c) || isAllocated(c) || c === 11,
  },
  {
    key: 'delete',
    label: '删除',
    danger: true,
    visible: (c) => !isInProgress(c),
  },
];

export function maasMachineRowActions(statusRaw: unknown): MaasRowAction[] {
  const code = machineStatusCode(statusRaw);
  return ACTION_DEFS.filter((a) => a.visible(code)).map(
    ({ key, label, danger }) => ({
      key,
      label,
      danger,
    }),
  );
}
