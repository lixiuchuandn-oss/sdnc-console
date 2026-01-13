import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { Tenant } from './Tenant';

@Entity('threat_events')
export class ThreatEvent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ nullable: true })
  tenantName: string;

  // 关联 Tenant (可选，如果能匹配到)
  @ManyToOne(() => Tenant, { nullable: true })
  @JoinColumn({ name: 'tenant_id' })
  tenant: Tenant;

  @Column({ nullable: true })
  tenantId: string;

  @Column({ nullable: true })
  fileName: string;

  @Column({ nullable: true })
  eventTime: Date;

  @Column({ nullable: true })
  srcIp: string;

  @Column({ nullable: true })
  dstIp: string;

  @Column({ nullable: true })
  threatType: string;

  @Column({ nullable: true })
  severity: string;

  @Column({ type: 'text', nullable: true })
  description: string;

  @Column({ type: 'text', nullable: true })
  rawContent: string;

  @CreateDateColumn()
  createdAt: Date;
}
