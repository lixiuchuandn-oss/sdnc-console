import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

@Entity('kube_ovn_provider_network_inventory')
export class KubeOvnProviderNetworkInventory {
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
  defaultInterface?: string;

  @Column({ type: 'simple-json', nullable: true })
  customInterfaces?: Array<{ interface: string; nodes: string[] }>;

  @Column({ type: 'boolean', nullable: true })
  exchangeLinkName?: boolean;

  @Column({ type: 'simple-json', nullable: true })
  excludeNodes?: string[];

  @Column({ type: 'boolean', nullable: true })
  ready?: boolean;

  @Column({ type: 'simple-json', nullable: true })
  readyNodes?: string[];

  @Column({ type: 'simple-json', nullable: true })
  notReadyNodes?: string[];

  @Column({ type: 'simple-json', nullable: true })
  vlans?: string[];

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
