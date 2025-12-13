import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, OneToMany } from 'typeorm';
import { Organization } from './Organization';
import { TenantUser } from './TenantUser';
import { UserSpace } from './UserSpace';

@Entity('tenants')
export class Tenant {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ length: 100, unique: true })
  name!: string;

  @Column({ type: 'text', nullable: true })
  description?: string;

  @Column({ 
    type: 'simple-enum', 
    enum: ['active', 'inactive', 'suspended'],
    default: 'active'
  })
  status!: 'active' | 'inactive' | 'suspended';

  @Column({ name: 'root_organization_id', nullable: true })
  rootOrganizationId?: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;

  @OneToMany(() => Organization, organization => organization.tenant)
  organizations?: Organization[];

  @OneToMany(() => TenantUser, user => user.tenant)
  users?: TenantUser[];

  @OneToMany(() => UserSpace, userSpace => userSpace.tenant)
  userSpaces?: UserSpace[];
}