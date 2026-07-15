export type RrDomainSource = 'manual' | 'excel_import';

export type RrDomainStatus = 'active' | 'archived';

/** Excel/CSV 导入列名（§7.6.2） */
export const RR_DOMAIN_IMPORT_COLUMNS = [
  '域标识',
  '域名称',
  '域备注',
  '域级对端ASN',
  '域级本端ASN',
  'RR名称',
  '邻居地址',
  '对端ASN',
  '本端ASN',
  'ClusterID',
  'RouterID',
  '优先级',
  '备注',
] as const;

export type RrDomainImportColumn = (typeof RR_DOMAIN_IMPORT_COLUMNS)[number];

export type RrDomainNodeInput = {
  rrName: string;
  neighborAddress: string;
  remoteAs?: number | null;
  localAs?: number | null;
  clusterId?: string | null;
  routerIdHint?: string | null;
  priority?: number;
  remark?: string | null;
  sortOrder?: number;
};

export type RrDomainUpsertInput = {
  name: string;
  displayName: string;
  description?: string | null;
  remoteAs: number;
  localAs?: number | null;
  source?: RrDomainSource;
  status?: RrDomainStatus;
  nodes: RrDomainNodeInput[];
};

export type RrDomainNodeView = {
  id: string;
  rrName: string;
  neighborAddress: string;
  remoteAs: number | null;
  localAs: number | null;
  clusterId: string | null;
  routerIdHint: string | null;
  priority: number;
  remark: string | null;
  sortOrder: number;
};

export type RrDomainView = {
  id: string;
  name: string;
  displayName: string;
  description: string | null;
  remoteAs: number;
  localAs: number | null;
  source: RrDomainSource;
  status: RrDomainStatus;
  nodes: RrDomainNodeView[];
  createdAt: string;
  updatedAt: string;
};

export type RrDomainImportPreviewDomain = {
  name: string;
  displayName: string;
  description: string | null;
  remoteAs: number;
  localAs: number | null;
  nodes: RrDomainNodeInput[];
  domainFieldWarnings: string[];
};

export type RrDomainImportPreview = {
  domains: RrDomainImportPreviewDomain[];
  errors: string[];
  warnings: string[];
};
