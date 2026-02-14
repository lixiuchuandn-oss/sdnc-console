import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

@Entity('harvester_node_inventory')
@Index(['cloudId', 'uid'], { unique: true })
export class HarvesterNodeInventory {
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
  status?: string; // e.g., Ready, NotReady

  @Column({ type: 'text', nullable: true })
  internalIP?: string;

  @Column({ type: 'text', nullable: true })
  externalIP?: string;

  @Column({ type: 'simple-json', nullable: true })
  links?: Record<string, string>;

  @Column({ type: 'simple-json', nullable: true })
  capacity?: Record<string, string>; // cpu, memory, etc.

  @Column({ type: 'simple-json', nullable: true })
  allocatable?: Record<string, string>;

  @Column({ type: 'simple-json', nullable: true })
  labels?: Record<string, string>;

  @Column({ type: 'simple-json', nullable: true })
  annotations?: Record<string, string>;

  @Column({ type: 'text', nullable: true })
  kernelVersion?: string;

  @Column({ type: 'text', nullable: true })
  osImage?: string;

  @Column({ type: 'text', nullable: true })
  containerRuntimeVersion?: string;

  @Column({ type: 'text', nullable: true })
  kubeletVersion?: string;

  @Column({ type: 'text', nullable: true })
  kubeProxyVersion?: string;

  @Column({ type: 'text', nullable: true })
  operatingSystem?: string;

  @Column({ type: 'text', nullable: true })
  architecture?: string;

  @Column({ type: 'simple-json', nullable: true })
  nodeInfo?: Record<string, any>;

  @Column({ type: 'simple-json', nullable: true })
  rawData?: any;

  @CreateDateColumn({ type: 'datetime' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'datetime' })
  updatedAt!: Date;
}
