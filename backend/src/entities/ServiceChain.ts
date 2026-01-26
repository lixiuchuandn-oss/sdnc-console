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
import { SecurityZone } from './SecurityZone';
import { Tenant } from './Tenant';
import { Organization } from './Organization';

export type ServiceChainType = 'serial' | 'bypass';

@Entity('service_chains')
export class ServiceChain {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'text' })
  name!: string;

  @Column({ type: 'text', nullable: true })
  clusterName?: string;

  @Column({ type: 'text' })
  type!: ServiceChainType;

  @Column({ type: 'text', default: 'active' })
  status!: string;

  @Column({ type: 'text', nullable: true })
  description?: string;

  // Domain Association
  @Column({ type: 'text', nullable: true })
  domainId?: string;

  @Column({ type: 'text', nullable: true })
  domainName?: string;

  // New Fields
  @Column({ type: 'text', nullable: true })
  steeringMode?: string; // 'vr' | 'direct'

  @Column({ type: 'text', nullable: true })
  securityServices?: string; // JSON array or comma separated

  @Column({ type: 'text', nullable: true })
  protectionTargets?: string; // JSON array or summary

  // Relationship to SecurityZone (Optional)
  @Column({ nullable: true })
  securityZoneId?: string;

  @ManyToOne(() => SecurityZone, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'securityZoneId' })
  securityZone?: SecurityZone;

  // Tenancy
  @Index()
  @Column({ type: 'text', nullable: true })
  tenantId?: string;

  @Index()
  @Column({ type: 'text', nullable: true })
  organizationId?: string;

  @ManyToOne(() => Tenant)
  @JoinColumn({ name: 'tenantId' })
  tenant?: Tenant;

  @ManyToOne(() => Organization)
  @JoinColumn({ name: 'organizationId' })
  organization?: Organization;

  @CreateDateColumn({ type: 'datetime' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'datetime' })
  updatedAt!: Date;
}
