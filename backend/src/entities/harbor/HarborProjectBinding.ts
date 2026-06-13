/**
 * HarborProjectBinding - Harbor 项目租户绑定实体
 *
 * 用于存储 Harbor 项目与 Tower 租户的绑定关系。
 * 实现项目级别的租户隔离和公共/私有项目区分。
 *
 * @see design/harbor-user-integration-design.md 第4.2节
 */
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { HarborRegistry } from './HarborRegistry';

export enum HarborProjectCreatorType {
  SYSTEM = 'system',
  TENANT = 'tenant',
}

export enum HarborProjectVisibility {
  PUBLIC = 'public',
  PRIVATE = 'private',
}

@Entity('harbor_project_bindings')
@Index('idx_harbor_project', ['harborRegistryId', 'projectId'])
@Index('idx_tenant_projects', ['tenantId'])
export class HarborProjectBinding {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'harbor_registry_id' })
  harborRegistryId!: string;

  @Column({ name: 'project_id' })
  projectId!: number;

  @Column({ name: 'project_name', length: 100 })
  projectName!: string;

  @Column({ name: 'tenant_id', nullable: true })
  tenantId?: string;

  @Column({ name: 'created_by' })
  createdBy!: string;

  @Column({
    name: 'created_by_type',
    type: 'simple-enum',
    enum: HarborProjectCreatorType,
  })
  createdByType!: HarborProjectCreatorType;

  @Column({
    type: 'simple-enum',
    enum: HarborProjectVisibility,
  })
  visibility!: HarborProjectVisibility;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @ManyToOne(() => HarborRegistry)
  @JoinColumn({ name: 'harbor_registry_id' })
  harborRegistry?: HarborRegistry;
}
