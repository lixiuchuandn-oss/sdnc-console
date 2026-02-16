import { AppDataSource } from '../config/database';
import { Cloud } from '../entities/Cloud';

/**
 * 标准资源查询命令的抽象描述
 *
 * 设计目的：
 * - 把“查询某个云资源池的 VPC/VM 列表”抽象成一条标准化的命令描述
 * - 供其它模块（例如自动化流程、命令编排器、前端“查看命令详情”等）使用
 * - 当前实现使用 http_request 类型，通过调用自身后端提供的统一 REST 接口来获取数据
 *
 * 后续扩展：
 * - 可以增加 type === 'cli_command' 的场景，用来描述需要在目标环境执行的 CLI 指令
 */
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
   * 1. 查询资源池（Cloud）列表，返回下拉选项所需的精简信息
   *
   * 主要用途：
   * - 在前端“资源池选择器 / 资源池下拉框”中展示可选的云资源池
   * - 只查询必要字段，避免把不需要的大字段（如密钥、配置详情）带到内存
   */
  async getResourcePoolOptions() {
    const repo = AppDataSource.getRepository(Cloud);
    const clouds = await repo.find({
      select: ['id', 'name', 'type', 'config', 'region'], // Optimized select
    });

    return clouds.map((c) => ({
      id: c.id,
      name: c.name,
      provider: (c.config as any)?.provider || c.type,
      region: c.region,
    }));
  }

  /**
   * 2. 根据资源池 ID 组装“查询 VPC 列表”的标准命令描述
   *
   * 返回的命令不会直接访问云厂商，而是访问本平台自己的 REST 接口：
   *   - /api/clouds/{cloudId}/resources/vpcs
   *
   * 这样做的好处：
   * - 所有调用方都只依赖平台统一接口，不感知各云厂商的差异
   * - 便于在平台内部做缓存、鉴权、审计等二次封装
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
          'Content-Type': 'application/json',
        },
      },
    };
  }

  /**
   * 3. 根据资源池 ID 组装“查询虚拟机（VM/实例）列表”的标准命令描述
   *
   * 当前统一使用 ecs 作为资源类型别名，对不同云厂商的虚拟机做抽象：
   *   - /api/clouds/{cloudId}/resources/ecs
   *
   * 和 VPC 查询一样，调用方只需要执行返回的 http_request，即可获取对应云资源池的 VM 列表。
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
          'Content-Type': 'application/json',
        },
      },
    };
  }

  /**
   * 内部工具方法：按 ID 查询 Cloud 记录
   *
   * 说明：
   * - 目前只做最简单的一次查询，未做缓存
   * - 如果后续频繁调用，可在服务层增加简单缓存或读库分离
   */
  private async getCloud(id: string) {
    const repo = AppDataSource.getRepository(Cloud);
    return repo.findOne({ where: { id } });
  }
}

export const standardResourceService = new StandardResourceService();
