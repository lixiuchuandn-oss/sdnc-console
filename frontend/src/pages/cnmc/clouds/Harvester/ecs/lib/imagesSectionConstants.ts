/** 镜像列表筛选：状态选项（与 resolveImageListStateKey 返回值一致） */
export const IMAGE_STATUS_FILTER_OPTIONS = [
  'ready',
  'failed',
  'uploading',
  'importing',
  'exporting',
  'downloading',
  'cancelled',
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

const UPLOAD_TASK_STATUS_ZH: Record<string, string> = {
  pending: '等待上传',
  ingesting: '文件接收中',
  proxying: '后端代传中',
  success: '完成',
  failed: '失败',
  cancelled: '已取消',
};

export function imageUploadTaskStatusLabel(status?: string): string {
  const s = String(status || '').toLowerCase();
  return UPLOAD_TASK_STATUS_ZH[s] || s || '-';
}
