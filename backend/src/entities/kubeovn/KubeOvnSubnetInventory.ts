import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

@Entity('kube_ovn_subnet_inventory')
export class KubeOvnSubnetInventory {
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

  // Subnet is cluster scoped in Kube-OVN
  @Column({ type: 'text', nullable: true })
  namespace?: string;

  @Column({ type: 'text', nullable: true })
  vpc?: string;

  @Column({ type: 'text', nullable: true })
  cidr?: string;

  @Column({ type: 'text', nullable: true })
  gateway?: string;

  @Column({ type: 'text', nullable: true })
  protocol?: string; // IPv4/IPv6

  @Column({ type: 'integer', nullable: true })
  availableIps?: number;

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
