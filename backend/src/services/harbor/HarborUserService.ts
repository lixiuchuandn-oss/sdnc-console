/**
 * HarborUserService - Harbor 用户映射服务
 *
 * 负责 Tower 租户用户与 Harbor 虚拟用户的映射管理。
 * 实现多层用户体系与单层用户体系的对接。
 *
 * @see design/harbor-user-integration-design.md 第4.2节
 */
import { AppDataSource } from '../../config/database';
import {
  HarborUserMapping,
  HarborUserSyncStatus,
} from '../../entities/harbor/HarborUserMapping';
import { HarborRegistry } from '../../entities/harbor/HarborRegistry';
import { TenantUser } from '../../entities/TenantUser';
import { HarborProxyService } from './HarborProxyService';
import { logger } from '../../utils/logger';

const harborUserLog = logger.child('HarborUserService');

export class HarborUserService {
  /**
   * 生成 Harbor 虚拟用户名
   * 格式：tower-{tenantId前8位}-{username}
   * 示例：tower-a1b2c3d4-zhangsan
   */
  public static generateHarborUsername(tenantId: string, username: string): string {
    const tenantPrefix = tenantId.substring(0, 8).toLowerCase();
    return `tower-${tenantPrefix}-${username.toLowerCase()}`;
  }

  /**
   * 生成 Harbor 邮箱
   * 优先使用 Tower 用户邮箱，无则生成虚拟邮箱
   */
  public static generateHarborEmail(tenantUser: TenantUser): string {
    if (tenantUser.email && tenantUser.email.trim() !== '') {
      return tenantUser.email.trim();
    }
    return `${tenantUser.username.toLowerCase()}@tower.local`;
  }

  /**
   * 加密密码
   * 使用 Base64 + 字符串反转（与 HarborRegistry 一致）
   */
  public static encryptPassword(password: string): string {
    return Buffer.from(password.split('').reverse().join('')).toString('base64');
  }

  /**
   * 解密密码
   */
  public static decryptPassword(encrypted: string): string {
    return Buffer.from(encrypted, 'base64').toString().split('').reverse().join('');
  }

  /**
   * 生成随机密码
   */
  private static generateRandomPassword(length: number = 16): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*';
    let password = '';
    for (let i = 0; i < length; i++) {
      password += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return password;
  }

  /**
   * 获取或创建用户映射
   * - 如果已存在且 syncStatus === 'synced'，直接返回
   * - 如果不存在，创建 Harbor 用户并记录映射
   * - 如果存在但 syncStatus !== 'synced'，尝试重新同步
   */
  public static async getOrCreateMapping(params: {
    harborRegistryId: string;
    tenantUser: TenantUser;
    password?: string;
  }): Promise<HarborUserMapping> {
    const { harborRegistryId, tenantUser, password } = params;
    const mappingRepo = AppDataSource.getRepository(HarborUserMapping);

    // 查询是否已存在映射
    const existingMapping = await mappingRepo.findOne({
      where: {
        harborRegistryId,
        tenantUserId: tenantUser.id,
      },
    });

    // 如果存在且已同步，直接返回
    if (existingMapping && existingMapping.syncStatus === HarborUserSyncStatus.SYNCED) {
      harborUserLog.info(
        `[映射] 已存在同步完成的映射: mappingId=${existingMapping.id}, harborUsername=${existingMapping.harborUsername}`,
      );
      return existingMapping;
    }

    // 获取 HarborRegistry 配置
    const registryRepo = AppDataSource.getRepository(HarborRegistry);
    const registry = await registryRepo.findOne({
      where: { id: harborRegistryId },
    });

    if (!registry) {
      throw new Error(`Harbor Registry not found: ${harborRegistryId}`);
    }

    // 确定密码
    const harborPassword = password || this.generateRandomPassword();

    // 如果不存在映射，创建新映射和用户
    if (!existingMapping) {
      return await this.createHarborUser({
        registry,
        tenantUser,
        password: harborPassword,
      });
    }

    // 如果存在但未同步成功，尝试重新同步
    harborUserLog.info(
      `[映射] 重新同步用户: mappingId=${existingMapping.id}, syncStatus=${existingMapping.syncStatus}`,
    );

    try {
      const proxy = HarborProxyService.getInstance(registry);
      const harborUsername = existingMapping.harborUsername;
      const harborEmail = existingMapping.email || this.generateHarborEmail(tenantUser);

      // 尝试搜索用户是否存在
      const users = await proxy.searchUsers(harborUsername);
      const existingHarborUser = users.find((u: any) => u.username === harborUsername);

      let harborUserId: number;

      if (existingHarborUser) {
        // 用户已存在，更新映射
        harborUserId = existingHarborUser.user_id;
        harborUserLog.info(
          `[用户] Harbor 用户已存在: harborUsername=${harborUsername}, userId=${harborUserId}`,
        );
      } else {
        // 用户不存在，创建新用户
        const result = await proxy.createUser({
          username: harborUsername,
          password: this.decryptPassword(existingMapping.harborPassword),
          email: harborEmail,
          realname: tenantUser.fullName || tenantUser.username,
        });
        harborUserId = result.user_id;
        harborUserLog.info(
          `[用户] 创建 Harbor 用户成功: harborUsername=${harborUsername}, userId=${harborUserId}`,
        );
      }

      // 更新映射状态
      existingMapping.harborUserId = harborUserId;
      existingMapping.email = harborEmail;
      existingMapping.syncStatus = HarborUserSyncStatus.SYNCED;
      existingMapping.lastSyncAt = new Date();
      existingMapping.syncMessage = '同步成功';

      await mappingRepo.save(existingMapping);
      harborUserLog.info(`[映射] 同步完成: mappingId=${existingMapping.id}`);

      return existingMapping;
    } catch (error: any) {
      // 更新失败状态
      existingMapping.syncStatus = HarborUserSyncStatus.FAILED;
      existingMapping.lastSyncAt = new Date();
      existingMapping.syncMessage = error.message || '同步失败';

      await mappingRepo.save(existingMapping);

      harborUserLog.error(`[映射] 同步失败: ${error.message}`);
      throw error;
    }
  }

  /**
   * 创建 Harbor 用户
   * - 生成虚拟用户名和邮箱
   * - 调用 HarborProxyService.createUser 创建 Harbor 用户
   * - 创建 HarborUserMapping 记录
   */
  public static async createHarborUser(params: {
    registry: HarborRegistry;
    tenantUser: TenantUser;
    password: string;
  }): Promise<HarborUserMapping> {
    const { registry, tenantUser, password } = params;
    const mappingRepo = AppDataSource.getRepository(HarborUserMapping);

    // 生成虚拟用户名和邮箱
    const harborUsername = this.generateHarborUsername(tenantUser.tenantId, tenantUser.username);
    const harborEmail = this.generateHarborEmail(tenantUser);

    harborUserLog.info(
      `[用户] 准备创建 Harbor 用户: tenantId=${tenantUser.tenantId}, username=${tenantUser.username}, harborUsername=${harborUsername}`,
    );

    // 检查是否已存在相同用户名的映射
    const existingByUsername = await mappingRepo.findOne({
      where: { harborUsername },
    });

    if (existingByUsername) {
      harborUserLog.warn(
        `[用户] 用户名已存在映射: harborUsername=${harborUsername}, mappingId=${existingByUsername.id}`,
      );
      // 如果已存在，返回现有映射
      if (existingByUsername.syncStatus === HarborUserSyncStatus.SYNCED) {
        return existingByUsername;
      }
      // 否则尝试重新同步
      return await this.getOrCreateMapping({
        harborRegistryId: registry.id,
        tenantUser,
        password: this.decryptPassword(existingByUsername.harborPassword),
      });
    }

    try {
      const proxy = HarborProxyService.getInstance(registry);

      // 尝试搜索用户是否已存在于 Harbor
      const users = await proxy.searchUsers(harborUsername);
      const existingHarborUser = users.find((u: any) => u.username === harborUsername);

      let harborUserId: number;

      if (existingHarborUser) {
        // 用户已存在于 Harbor，直接使用
        harborUserId = existingHarborUser.user_id;
        harborUserLog.info(
          `[用户] Harbor 用户已存在: harborUsername=${harborUsername}, userId=${harborUserId}`,
        );
      } else {
        // 在 Harbor 中创建用户
        const result = await proxy.createUser({
          username: harborUsername,
          password: password,
          email: harborEmail,
          realname: tenantUser.fullName || tenantUser.username,
        });
        harborUserId = result.user_id;
        harborUserLog.info(
          `[用户] 创建 Harbor 用户成功: harborUsername=${harborUsername}, userId=${harborUserId}`,
        );
      }

      // 创建映射记录
      const mapping = mappingRepo.create({
        harborRegistryId: registry.id,
        tenantId: tenantUser.tenantId,
        tenantUserId: tenantUser.id,
        harborUsername,
        harborUserId,
        harborPassword: this.encryptPassword(password),
        email: harborEmail,
        syncStatus: HarborUserSyncStatus.SYNCED,
        lastSyncAt: new Date(),
        syncMessage: '创建成功',
      });

      await mappingRepo.save(mapping);
      harborUserLog.info(`[映射] 创建映射记录成功: mappingId=${mapping.id}`);

      return mapping;
    } catch (error: any) {
      harborUserLog.error(`[用户] 创建 Harbor 用户失败: ${error.message}`);

      // 创建失败状态的映射记录
      const mapping = mappingRepo.create({
        harborRegistryId: registry.id,
        tenantId: tenantUser.tenantId,
        tenantUserId: tenantUser.id,
        harborUsername,
        harborPassword: this.encryptPassword(password),
        email: harborEmail,
        syncStatus: HarborUserSyncStatus.FAILED,
        lastSyncAt: new Date(),
        syncMessage: error.message || '创建失败',
      });

      await mappingRepo.save(mapping);
      harborUserLog.error(`[映射] 创建失败映射记录: mappingId=${mapping.id}`);

      throw error;
    }
  }

  /**
   * 根据 Harbor Registry ID 和 Tenant User ID 获取映射
   */
  public static async getMapping(params: {
    harborRegistryId: string;
    tenantUserId: string;
  }): Promise<HarborUserMapping | null> {
    const mappingRepo = AppDataSource.getRepository(HarborUserMapping);
    return await mappingRepo.findOne({
      where: {
        harborRegistryId: params.harborRegistryId,
        tenantUserId: params.tenantUserId,
      },
    });
  }

  /**
   * 根据 Harbor 用户名获取映射
   */
  public static async getMappingByUsername(harborUsername: string): Promise<HarborUserMapping | null> {
    const mappingRepo = AppDataSource.getRepository(HarborUserMapping);
    return await mappingRepo.findOne({
      where: { harborUsername },
    });
  }

  /**
   * 获取租户下所有用户映射
   */
  public static async getMappingsByTenantId(tenantId: string): Promise<HarborUserMapping[]> {
    const mappingRepo = AppDataSource.getRepository(HarborUserMapping);
    return await mappingRepo.find({
      where: { tenantId },
    });
  }

  /**
   * 删除用户映射
   * 注意：此方法仅删除映射记录，不会删除 Harbor 中的用户
   */
  public static async deleteMapping(mappingId: string): Promise<void> {
    const mappingRepo = AppDataSource.getRepository(HarborUserMapping);
    await mappingRepo.delete(mappingId);
    harborUserLog.info(`[映射] 删除映射记录: mappingId=${mappingId}`);
  }

  /**
   * 删除 Harbor 用户及其映射
   */
  public static async deleteHarborUser(params: {
    registry: HarborRegistry;
    mapping: HarborUserMapping;
  }): Promise<void> {
    const { registry, mapping } = params;
    const mappingRepo = AppDataSource.getRepository(HarborUserMapping);

    try {
      if (mapping.harborUserId) {
        const proxy = HarborProxyService.getInstance(registry);
        await proxy.deleteUser(mapping.harborUserId);
        harborUserLog.info(
          `[用户] 删除 Harbor 用户: harborUsername=${mapping.harborUsername}, userId=${mapping.harborUserId}`,
        );
      }
    } catch (error: any) {
      harborUserLog.error(`[用户] 删除 Harbor 用户失败: ${error.message}`);
      // 继续删除映射记录
    }

    await mappingRepo.remove(mapping);
    harborUserLog.info(`[映射] 删除映射记录: mappingId=${mapping.id}`);
  }

  /**
   * 更新映射的同步状态
   */
  public static async updateSyncStatus(params: {
    mappingId: string;
    status: HarborUserSyncStatus;
    message?: string;
  }): Promise<void> {
    const mappingRepo = AppDataSource.getRepository(HarborUserMapping);
    await mappingRepo.update(params.mappingId, {
      syncStatus: params.status,
      lastSyncAt: new Date(),
      syncMessage: params.message,
    });
  }
}
