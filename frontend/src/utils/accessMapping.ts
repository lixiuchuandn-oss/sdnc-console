export const PATH_PERMISSION_MAPPING = [
  { path: '/admin/dashboard', action: 'ops.dashboard:read' },
  { path: '/admin/clouds', action: 'clouds:read' },
  { path: '/admin/clouds/console', action: 'clouds.console:read' },
  { path: '/admin/tenants/leased-lines/tasks', action: 'tenants.leased-lines.reports:read' },
  { path: '/admin/tenants/leased-lines/logs', action: 'tenants.leased-lines.alert-logs:read' },
  { path: '/admin/tenants/leased-lines', action: 'tenants.leased-lines.list:read' },
  { path: '/admin/tenants', action: 'tenants:read' },
  { path: '/admin/tenants/users', action: 'tenants.users:read' },
  { path: '/admin/interconnect/nat', action: 'networks.nat:read' },
  { path: '/admin/interconnect/acl', action: 'networks.acl:read' },
  { path: '/admin/interconnect/ipsec', action: 'networks.ipsec:read' },
  { path: '/admin/interconnect/srv6', action: 'networks.srv6:read' },
  { path: '/admin/interconnect/vr', action: 'networks.vr-config:read' },
  { path: '/admin/sec-mgr-plane/security-domain', action: 'networks.security-domain:read' },
  { path: '/admin/sec-mgr-plane/cascade-channels', action: 'sec-mgr-plane.cascade-channels:read' },
  { path: '/admin/sec-mgr-plane/apps', action: 'security.services:read' },
  { path: '/admin/alarms', action: 'secops.alerts:read' },
  { path: '/admin/access', action: 'access:read' },
  { path: '/admin/coming-soon', action: 'ops:read' },
  { path: '/admin/soc/overview', action: 'secops.dashboard:read' },
  { path: '/admin/soc/threat/events', action: 'secops.alerts:read' },
  { path: '/admin/soc/threat/offline-logs', action: 'tenants.leased-lines.alert-logs:read' },
  { path: '/admin/soc/threat/rules', action: 'secops.rules:read' },
];

export const getRequiredActionForPath = (path: string): string | null => {
  const purePath = String(path || '').split('?')[0];
  for (const mapping of PATH_PERMISSION_MAPPING) {
    if (purePath.startsWith(mapping.path)) {
      return mapping.action;
    }
  }
  return null;
};

export const hasPermissionForAction = (perms: string[], act: string | null): boolean => {
  if (!act) return true;
  const base = act.split(':')[0];
  const segments = base.split('.');
  const hasDomainPrefix = segments.length >= 2 ? `${segments[0]}.${segments[1]}` : null;
  return (perms || []).includes(act)
    || (perms || []).includes(act.replace(':read', ':write'))
    || (perms || []).includes('*')
    || (perms || []).includes(`${base}:*`)
    || (!!hasDomainPrefix && (perms || []).includes(`${hasDomainPrefix}:*`))
    || (!!hasDomainPrefix && (perms || []).some(p => p.startsWith(`${hasDomainPrefix}.`)));
};

export const getDefaultAdminPath = (perms: string[] = []): string => {
  const candidates = [
    '/admin/clouds/console',
    '/admin/tenants/leased-lines',
    '/admin/tenants/leased-lines/tasks',
    '/admin/tenants/leased-lines/logs',
    '/admin/dashboard',
    '/admin/clouds',
    '/admin/tenants',
    '/admin/tenants/users',
  ];
  for (const p of candidates) {
    const act = getRequiredActionForPath(p);
    if (hasPermissionForAction(perms, act)) return p;
  }
  return '/admin/coming-soon';
};
