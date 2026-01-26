import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Organization } from './Organization';
import { Cloud } from './Cloud';

@Entity('resource_pool_assignments')
export class ResourcePoolAssignment {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'organization_id' })
  organizationId!: string;

  @Column({ name: 'cloud_id', nullable: true })
  cloudId?: string;

  @Column({ type: 'int', default: 0 })
  cpuQuota!: number;

  @Column({ type: 'int', default: 0 })
  memoryQuota!: number; // GB

  @Column({ type: 'int', default: 0 })
  storageQuota!: number; // GB

  @Column({ type: 'text', nullable: true })
  permissions?: string; // JSON string

  @Column({ type: 'text', nullable: true })
  namespace?: string;

  @Column({ name: 'assigned_by', nullable: true })
  assignedBy?: string;

  @Column({ name: 'assigned_at', type: 'datetime', nullable: true })
  assignedAt?: Date;

  @Column({
    type: 'simple-enum',
    enum: ['active', 'inactive'],
    default: 'active',
  })
  status!: 'active' | 'inactive';

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;

  @ManyToOne(() => Organization, (organization) => organization.resourcePoolAssignments)
  @JoinColumn({ name: 'organization_id' })
  organization?: Organization;

  @ManyToOne(() => Cloud)
  @JoinColumn({ name: 'cloud_id' })
  cloud?: Cloud;
}
