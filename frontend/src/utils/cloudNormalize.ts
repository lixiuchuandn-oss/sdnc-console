export interface NormalizedVpc {
  id: string;
  name: string;
  cidr: string;
  ipv6Cidr?: string;
  status?: string;
  isDefault?: boolean;
  createdAt?: string;
  resourceGroupId?: string;
  regionId?: string;
  description?: string;
  provider?: string;
  raw?: any;
}

export function normalizeVpcs(provider: string | undefined, list: any[]): NormalizedVpc[] {
  const p = (provider || '').toLowerCase();
  return (list || []).map((item: any) => ({
    id: item?.VpcId ?? item?.vpcId ?? item?.id ?? '',
    name: item?.VpcName ?? item?.name ?? item?.displayName ?? '',
    cidr: item?.CidrBlock ?? item?.cidr ?? item?.ipv4Cidr ?? '',
    ipv6Cidr: item?.Ipv6CidrBlock ?? item?.ipv6Cidr ?? '',
    status: item?.Status ?? item?.status ?? '',
    isDefault: item?.IsDefault ?? item?.default ?? false,
    createdAt: item?.CreationTime ?? item?.createdAt ?? item?.createTime ?? '',
    resourceGroupId: item?.ResourceGroupId ?? item?.enterpriseProjectId ?? '',
    regionId: item?.RegionId ?? item?.region ?? '',
    description: item?.Description ?? item?.description ?? '',
    provider: p,
    raw: item,
  }));
}