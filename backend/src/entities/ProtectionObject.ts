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

export type ProtectionObjectType = 'ip' | 'subnet' | 'vpc' | 'line';

@Entity('protection_objects')
export class ProtectionObject {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'text' })
  name!: string;

  @Column({ type: 'text' })
  type!: ProtectionObjectType;

  @Column({ type: 'text' })
  value!: string;

  @Column({ type: 'text', nullable: true })
  description?: string;

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

  @CreateDateColumn({ type: 'datetime' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'datetime' })
  updatedAt!: Date;
}
