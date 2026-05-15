/**
 * HarborRegistry - Harbor 实例配置实体
 * 
 * 用于存储 Harbor 镜像仓库的连接配置信息。
 * 支持平台内置 Harbor 和外部 Harbor 两种来源。
 * 
 * @see design/harbor-integration-design.md 第二章
 */
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

export enum HarborStatus {
  HEALTHY = 'healthy',
  UNHEALTHY = 'unhealthy',
  UNKNOWN = 'unknown',
}

@Entity('harbor_registries')
export class HarborRegistry {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ length: 100 })
  @Index()
  name!: string;

  @Column({ length: 512 })
  url!: string;

  @Column({ length: 100 })
  username!: string;

  @Column({ length: 255 })
  password!: string;

  @Column({ default: false })
  insecure!: boolean;

  @Column({ default: false, name: 'is_built_in' })
  isBuiltIn!: boolean;

  @Column({
    type: 'simple-enum',
    enum: HarborStatus,
    default: HarborStatus.UNKNOWN,
  })
  status!: HarborStatus;

  @Column({ length: 32, nullable: true })
  version?: string;

  @Column({ type: 'json', nullable: true })
  metadata?: any;

  @Column({ nullable: true, name: 'tenant_id' })
  tenantId?: string;

  @Column({ nullable: true, name: 'last_test_at' })
  lastTestAt?: Date;

  @Column({ nullable: true, name: 'last_sync_at' })
  lastSyncAt?: Date;

  @Column({ nullable: true, name: 'created_by' })
  createdBy?: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
