
export const isSystemNamespace = (name: string): boolean => {
  const n = String(name || '').toLowerCase();
  
  // Exact matches
  if (['cloud-public', 'default', 'ingress-nginx'].includes(n)) return true;

  // Prefix matches
  const prefixes = [
    'cattle',
    'fleet',
    'longhorn',
    'kube',
    'harvester',
    'cluster-fleet',
    'cluster',
    'local',
    'user'
  ];
  
  return prefixes.some(p => n.startsWith(p));
};

export const cnVmStatus = (v?: string): string => {
  const k = String(v || '').toLowerCase();
  const m: Record<string, string> = {
    running: '运行中',
    starting: '启动中',
    stopping: '停止中',
    terminating: '删除中',
    stopped: '已停止',
    terminated: '已删除',
    error: '错误',
    errorunschedulable: '调度失败',
    waitingforvolumebinding: '等待卷绑定',
    provisioning: '配置中',
    unknown: '未知'
  };
  return m[k] || (v || '-');
};
