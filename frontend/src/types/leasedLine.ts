export interface TenantLeasedLine {
  id: string;
  tenantId?: string;
  tenantName: string;
  region?: string;
  province: string;
  city: string;
  operator: string;
  ips: string;
  createdAt: string;
  updatedAt: string;
  hasLog?: boolean;
  logFileName?: string;
  logFileSize?: number;
  logModifiedAt?: number;
}

export interface CreateLeasedLineDto {
  tenantName: string;
  province: string;
  city: string;
  operator: string;
  ips: string[] | string;
}

export interface BatchImportLeasedLineItem {
  tenantName: string;
  province: string;
  city: string;
  operator: string;
  ips: string[] | string;
}