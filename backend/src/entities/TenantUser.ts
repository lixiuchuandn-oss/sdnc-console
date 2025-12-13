import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { Tenant } from './Tenant';
import { Organization } from './Organization';

@Entity('tenant_users')
export class TenantUser {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ length: 50, unique: true })
  username!: string;

  @Column({ length: 100, unique: true })
  email!: string;

  @Column({ name: 'full_name', length: 100 })
  fullName!: string;

  @Column({ length: 255 })
  password!: string;

  @Column({ 
    type: 'simple-enum', 
    enum: ['admin', 'user', 'viewer'],
    default: 'user'
  })
  role!: 'admin' | 'user' | 'viewer';

  @Column({ name: 'organization_id' })
  organizationId!: string;

  @Column({ name: 'tenant_id' })
  tenantId!: string;

  @Column({ 
    type: 'simple-enum', 
    enum: ['active', 'inactive'],
    default: 'active'
  })
  status!: 'active' | 'inactive';

  @Column({ name: 'last_login_at', type: 'datetime', nullable: true })
  lastLoginAt?: Date;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;

  @ManyToOne(() => Tenant, tenant => tenant.users)
  @JoinColumn({ name: 'tenant_id' })
  tenant?: Tenant;

  @ManyToOne(() => Organization, organization => organization.users)
  @JoinColumn({ name: 'organization_id' })
  organization?: Organization;
} 