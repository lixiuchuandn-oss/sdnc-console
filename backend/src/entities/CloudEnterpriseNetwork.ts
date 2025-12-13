import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, ManyToOne } from 'typeorm';
import { Tenant } from './Tenant';

export enum CenStatus {
  CREATING = 'creating',
  AVAILABLE = 'available'
}

@Entity('cens')
export class CloudEnterpriseNetwork {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  name!: string;

  @Column({ type: 'text', nullable: true })
  description?: string;

  @Column({
    type: 'simple-enum',
    enum: CenStatus,
    default: CenStatus.CREATING,
  })
  status!: CenStatus;

  // 归属租户，用于多租管理
  @Column()
  tenantId!: string;

  @ManyToOne(() => Tenant)
  tenant!: Tenant;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
} 