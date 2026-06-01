/**
 * HarborProject - Harbor 项目缓存实体
 *
 * 用于缓存 Harbor 中的项目信息，实现项目级别的租户隔离。
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
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { HarborRegistry } from './HarborRegistry';

@Entity('harbor_projects')
export class HarborProject {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'harbor_id' })
  @Index()
  harborId!: string;

  @Column({ name: 'project_id' })
  projectId!: number;

  @Column({ length: 100 })
  @Index()
  name!: string;

  @Column({ length: 100, nullable: true, name: 'owner_name' })
  ownerName?: string;

  @Column({ default: 0, name: 'repo_count' })
  repoCount!: number;

  @Column({ type: 'json', nullable: true })
  metadata?: any;

  @Column({ name: 'tenant_id' })
  @Index()
  tenantId!: string;

  @Column({ default: 'private', length: 20 })
  visibility!: string;

  @Column({ nullable: true })
  description?: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;

  // 关联关系
  @ManyToOne(() => HarborRegistry)
  @JoinColumn({ name: 'harbor_id' })
  harbor?: HarborRegistry;
}
