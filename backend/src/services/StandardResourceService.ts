import { AppDataSource } from '../config/database';
import { Cloud } from '../entities/Cloud';

export interface QueryCommand {
  description: string;
  type: 'http_request' | 'cli_command';
  payload: {
    url?: string;
    method?: string;
    headers?: Record<string, string>;
    params?: Record<string, any>;
    body?: any;
    command?: string;
  };
}

export class StandardResourceService {
  /**
   * 1. Query name and ID from resource pool list
   */
  async getResourcePoolOptions() {
    const repo = AppDataSource.getRepository(Cloud);
    const clouds = await repo.find({
      select: ['id', 'name', 'type', 'config', 'region'] // Optimized select
    });

    return clouds.map(c => ({
      id: c.id,
      name: c.name,
      provider: (c.config as any)?.provider || c.type,
      region: c.region
    }));
  }

  /**
   * 2. Assemble VPC query commands based on ID
   */
  async assembleVpcQuery(cloudId: string): Promise<QueryCommand> {
    const cloud = await this.getCloud(cloudId);
    if (!cloud) throw new Error('Resource pool not found');

    const provider = String((cloud.config as any)?.provider || '').toLowerCase();
    
    // Standardized API Endpoint on our own platform that proxies the request
    // This allows "other features" to call this internal API
    const internalApiUrl = `/api/clouds/${cloud.id}/resources/vpcs`;

    // If the user literally means "Backend Interface Function" that returns the COMMAND to be executed by the caller:
    // We can return the metadata describing how to fetch.
    
    return {
      description: `Query VPCs for cloud ${cloud.name} (${provider})`,
      type: 'http_request',
      payload: {
        url: internalApiUrl,
        method: 'GET',
        headers: {
          'Content-Type': 'application/json'
        }
      }
    };
  }

  /**
   * 3. Assemble VM query commands based on ID
   */
  async assembleVmQuery(cloudId: string): Promise<QueryCommand> {
    const cloud = await this.getCloud(cloudId);
    if (!cloud) throw new Error('Resource pool not found');

    const provider = String((cloud.config as any)?.provider || '').toLowerCase();
    
    // For VMs, we have ecs-all or provider specific endpoints
    const internalApiUrl = `/api/clouds/${cloud.id}/resources/ecs`;

    return {
      description: `Query VMs for cloud ${cloud.name} (${provider})`,
      type: 'http_request',
      payload: {
        url: internalApiUrl,
        method: 'GET',
        headers: {
          'Content-Type': 'application/json'
        }
      }
    };
  }

  private async getCloud(id: string) {
    const repo = AppDataSource.getRepository(Cloud);
    return repo.findOne({ where: { id } });
  }
}

export const standardResourceService = new StandardResourceService();
