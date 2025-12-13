import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, ManyToOne } from 'typeorm';
import { Cloud } from './Cloud';
import { Tenant } from './Tenant';
import { Organization } from './Organization';

export enum VpcStatus {
  CREATING = 'creating',
  READY = 'ready'
}

@Entity('vpcs')
export class VpcNetwork {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  name!: string;

  @Column()
  cidrBlock!: string;

  @Column({ type:'text', nullable:true })
  description?: string;

  @Column({
    type:'simple-enum',
    enum: VpcStatus,
    default: VpcStatus.CREATING
  })
  status!: VpcStatus;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;

  @Column()
  cloudId!: string;

  @ManyToOne(()=>Cloud)
  cloud!: Cloud;

  @Column()
  tenantId!: string;

  @ManyToOne(()=>Tenant)
  tenant!: Tenant;

  @Column({ nullable:true })
  organizationId?: string;

  @ManyToOne(()=>Organization, { nullable:true })
  organization?: Organization;
} 