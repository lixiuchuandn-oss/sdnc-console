import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

@Entity('kube_ovn_eip_inventory')
export class KubeOvnEipInventory {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'text' })
  cloudId!: string;

  @Index()
  @Column({ type: 'text' })
  uid!: string;

  @Column({ type: 'text' })
  name!: string;

  @Column({ type: 'text', nullable: true })
  namespace?: string; // Although EIPs are cluster-scoped, sometimes they might have metadata

  @Column({ type: 'text', nullable: true })
  v4Ip?: string;

  @Column({ type: 'text', nullable: true })
  v6Ip?: string;

  @Column({ type: 'text', nullable: true })
  macAddress?: string;

  @Column({ type: 'boolean', default: false })
  ready?: boolean;

  @Column({ type: 'boolean', default: false })
  inUse?: boolean;

  @Column({ type: 'text', nullable: true })
  nat?: string; // Associated NAT name if any

  @Column({ type: 'simple-json', nullable: true })
  labels?: Record<string, string>;

  @Column({ type: 'simple-json', nullable: true })
  annotations?: Record<string, string>;

  @Column({ type: 'simple-json', nullable: true })
  rawData?: any;

  @CreateDateColumn({ type: 'datetime' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'datetime' })
  updatedAt!: Date;
}
