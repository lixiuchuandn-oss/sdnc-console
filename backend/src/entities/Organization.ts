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
import { TenantUser } from './TenantUser';

@Entity('organizations')
export class Organization {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ length: 100 })
  name!: string;

  @Column({ type: 'text', nullable: true })
  description?: string;

  @Column({ type: 'int' })
  level!: 1 | 2 | 3 | 4;

  @Column({ type: 'int', name: 'order_index', default: 0 })
  orderIndex!: number;

  @Column({ name: 'parent_id', nullable: true })
  parentId?: string;

  @Column({ name: 'tenant_id' })
  tenantId!: string;

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

  @ManyToOne(() => Tenant, (tenant) => tenant.organizations)
  @JoinColumn({ name: 'tenant_id' })
  tenant?: Tenant;

  @ManyToOne(() => Organization, (organization) => organization.children)
  @JoinColumn({ name: 'parent_id' })
  parent?: Organization;

  @OneToMany(() => Organization, (organization) => organization.parent)
  children?: Organization[];

  @OneToMany(() => TenantUser, (user) => user.organization)
  users?: TenantUser[];
}
