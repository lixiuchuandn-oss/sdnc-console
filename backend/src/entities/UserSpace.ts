import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  OneToMany,
  JoinColumn,
} from 'typeorm';
import { Tenant } from './Tenant';
import { Cloud } from './Cloud';
import { UserSpaceAllocation } from './UserSpaceAllocation';
import { Organization } from './Organization';

@Entity('user_spaces')
export class UserSpace {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ length: 100 })
  name!: string;

  @Column({ type: 'text', nullable: true })
  description?: string;

  @Column({ name: 'tenant_id' })
  tenantId!: string;

  @Column({ name: 'organization_id', nullable: true })
  organizationId?: string;

  @Column({ name: 'cloud_id' })
  cloudId!: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  namespace?: string;

  @Column({ type: 'text', nullable: true })
  permissions?: string; // JSON string

  @Column({ type: 'int', default: 0 })
  cpuQuota!: number;

  @Column({ type: 'int', default: 0 })
  memoryQuota!: number; // GB

  @Column({ type: 'int', default: 0 })
  storageQuota!: number; // GB

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

  @ManyToOne(() => Tenant, (tenant) => tenant.userSpaces)
  @JoinColumn({ name: 'tenant_id' })
  tenant?: Tenant;

  @ManyToOne(() => Organization)
  @JoinColumn({ name: 'organization_id' })
  organization?: Organization;

  @ManyToOne(() => Cloud)
  @JoinColumn({ name: 'cloud_id' })
  cloud?: Cloud;

  @OneToMany(() => UserSpaceAllocation, (allocation) => allocation.userSpace)
  allocations?: UserSpaceAllocation[];
}
