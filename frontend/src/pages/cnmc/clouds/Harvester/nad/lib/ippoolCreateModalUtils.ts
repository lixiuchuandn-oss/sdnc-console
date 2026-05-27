export type IPPoolCreateFormValues = {
  name: string;
  namespace: string;
  type: 'range' | 'cidr';
  cidr?: string;
  start?: string;
  end?: string;
  rangeSubnet?: string;
  rangeGateway?: string;
};

export function buildIpPoolCreatePayload(values: IPPoolCreateFormValues) {
  const payload: {
    type: string;
    metadata: { name: string };
    spec: {
      selector: { scope: Array<{ namespace: string }> };
      cidrs?: string[];
      ranges?: Array<{
        start: string;
        end: string;
        subnet: string;
        gateway: string;
      }>;
    };
  } = {
    type: 'loadbalancer.harvesterhci.io.ippool',
    metadata: {
      name: values.name,
    },
    spec: {
      selector: {
        scope: [{ namespace: values.namespace }],
      },
    },
  };

  if (values.type === 'cidr') {
    payload.spec.cidrs = [String(values.cidr || '')];
  } else {
    payload.spec.ranges = [
      {
        start: String(values.start || ''),
        end: String(values.end || ''),
        subnet: String(values.rangeSubnet || ''),
        gateway: String(values.rangeGateway || ''),
      },
    ];
  }
  return payload;
}

export function extractIpPoolNamespaceNames(res: unknown): string[] {
  const r = res as { data?: { items?: unknown[] } | unknown[]; items?: unknown[] };
  const items = Array.isArray(r?.data)
    ? r.data
    : (r?.data as { items?: unknown[] } | undefined)?.items || r?.items || [];
  return (items as Array<{ metadata?: { name?: string }; name?: string }>)
    .map((i) => i.metadata?.name || i.name || '')
    .filter(Boolean);
}
