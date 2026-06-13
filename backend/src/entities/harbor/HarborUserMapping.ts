/**
 * HarborUserMapping - Tower 用户与 Harbor 用户映射实体
 *
 * 用于存储 Tower 租户用户与 Harbor 虚拟用户的映射关系。
 * 实现多层用户体系与单层用户体系的对接。
 *
 * @see design/harbor-user-integration-design.md 第4.1节
 */
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { HarborRegistry } from './HarborRegistry';

export enum HarborUserSyncStatus {
  SYNCED = 'synced',
  PENDING = 'pending',
  FAILED = 'failed',
}

@Entity('harbor_user_mappings')
@Index('idx_harbor_tenant_user', ['harborRegistryId', 'tenantUserId'])
@Index('idx_tenant_user', ['tenantId', 'tenantUserId'])
export class HarborUserMapping {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'harbor_registry_id' })
  harborRegistryId!: string;

  @Column({ name: 'tenant_id' })
  tenantId!: string;

  @Column({ name: 'tenant_user_id' })
  tenantUserId!: string;

  @Column({ name: 'harbor_username', unique: true, length: 100 })
  harborUsername!: string;

  @Column({ name: 'harbor_user_id', nullable: true })
  harborUserId?: number;

  @Column({ name: 'harbor_password', length: 255 })
  harborPassword!: string;

  @Column({ nullable: true, length: 100 })
  email?: string;

  @Column({
    type: 'simple-enum',
    enum: HarborUserSyncStatus,
    default: HarborUserSyncStatus.PENDING,
    name: 'sync_status',
  })
  syncStatus!: HarborUserSyncStatus;

  @Column({ name: 'last_sync_at', nullable: true, type: 'datetime' })
  lastSyncAt?: Date;

  @Column({ name: 'sync_message', nullable: true, type: 'text' })
  syncMessage?: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;

  @ManyToOne(() => HarborRegistry)
  @JoinColumn({ name: 'harbor_registry_id' })
  harborRegistry?: HarborRegistry;
}
