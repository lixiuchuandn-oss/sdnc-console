export interface Cloud {
  id: string;
  name: string;
  description: string;
  type: 'central' | 'edge' | 'hybrid';
  status: 'online' | 'offline' | 'maintenance';
  region: string;
  endpoint: string;
  accessKey?: string;
  secretKey?: string;
  config?: any;
  totalCpu: number;
  totalMemory: number;
  totalStorage: number;
  usedCpu: number;
  usedMemory: number;
  usedStorage: number;
  createdBy?: string;
  lastTestAt?: Date;
  createdAt: string;
  updatedAt: string;
}