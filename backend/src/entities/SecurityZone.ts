import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

@Entity('security_zones')
export class SecurityZone {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'text' })
  name!: string;

  @Column({ type: 'text', nullable: true })
  description?: string;

  @Column({ type: 'text', nullable: true })
  clusterName?: string;

  @Column({ type: 'text', default: 'active' })
  status!: string; // active, inactive

  // Tenancy
  @Index()
  @Column({ type: 'text', nullable: true })
  tenantId?: string;

  @Index()
  @Column({ type: 'text', nullable: true })
  organizationId?: string;

  @CreateDateColumn({ type: 'datetime' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'datetime' })
  updatedAt!: Date;
}
