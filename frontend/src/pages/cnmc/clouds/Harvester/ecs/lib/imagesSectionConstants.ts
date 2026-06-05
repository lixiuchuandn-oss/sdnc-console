/** 镜像列表状态中文（与 resolveImageListStateKey 返回值一致） */
export const IMAGE_LIST_STATE_LABEL_ZH: Record<string, string> = {
  imported: '已导入',
  pending: '等待',
  downloading: '下载中',
  uploading: '上传中',
  importing: '导入中',
  exporting: '导出中',
  ready: '已就绪',
  failed: '失败',
  cancelled: '已取消',
  unknown: '未知',
  pending_sync: '待同步',
  syncing: '同步中',
};

/** 镜像列表筛选：状态选项（与 resolveImageListStateKey 返回值一致） */
export const IMAGE_STATUS_FILTER_OPTIONS = [
  'ready',
  'failed',
  'uploading',
  'syncing',
  'importing',
  'exporting',
  'downloading',
  'cancelled',
  'pending_sync',
  'unknown',
] as const;

export const IMAGE_OS_FILTER_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: '全部' },
  { value: 'windows', label: 'Windows' },
  { value: 'ubuntu', label: 'Ubuntu' },
  { value: 'centos', label: 'CentOS' },
  { value: 'debian', label: 'Debian' },
  { value: 'redhat', label: 'RedHat/RHEL' },
  { value: 'rhel', label: 'RedHat/RHEL' },
  { value: 'fedora', label: 'Fedora' },
  { value: 'suse', label: 'SUSE/openSUSE/SLES' },
  { value: 'opensuse', label: 'SUSE/openSUSE/SLES' },
  { value: 'sles', label: 'SUSE/openSUSE/SLES' },
  { value: 'android', label: 'Android' },
  { value: 'freebsd', label: 'FreeBSD' },
  { value: 'kylin', label: '麒麟' },
  { value: 'neokylin', label: '中标麒麟' },
  { value: 'uos', label: 'UOS' },
  { value: 'openeuler', label: 'openEuler' },
  { value: 'anolis', label: 'Anolis' },
];

/** 上传任务抽屉展示用状态（同步阶段在 UI 层映射为 uploaded） */
const UPLOAD_TASK_STATUS_ZH: Record<string, string> = {
  pending: '等待上传',
  ingesting: '上传中',
  uploaded: '上传已完成',
  failed: '失败',
  cancelled: '已取消',
};

export function imageUploadTaskStatusLabel(status?: string): string {
  const s = String(status || '').toLowerCase();
  return UPLOAD_TASK_STATUS_ZH[s] || s || '-';
}
