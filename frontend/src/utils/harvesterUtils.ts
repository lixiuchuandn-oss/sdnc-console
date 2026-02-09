
export const isSystemNamespace = (name: string): boolean => {
  const n = String(name || '').toLowerCase();
  
  // Exact matches
  if (['cloud-public','default', 'ingress-nginx'].includes(n)) return true;

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
