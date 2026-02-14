import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

@Entity('harvester_vm_inventory')
@Index(['cloudId', 'uid'], { unique: true })
export class HarvesterVmInventory {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'text' })
  cloudId!: string;

  @Index()
  @Column({ type: 'text' })
  uid!: string; // K8s UID

  @Column({ type: 'text' })
  name!: string;

  @Column({ type: 'text' })
  namespace!: string;

  @Column({ type: 'text', nullable: true })
  running?: boolean; // spec.running

  @Column({ type: 'text', nullable: true })
  runStrategy?: string; // spec.runStrategy

  @Column({ type: 'text', nullable: true })
  view?: string;

  @Column({ type: 'simple-json', nullable: true })
  template?: any; // spec.template (contains domain, devices, etc.)

  @Column({ type: 'simple-json', nullable: true })
  labels?: Record<string, string>;

  @Column({ type: 'simple-json', nullable: true })
  annotations?: Record<string, string>;

  @Column({ type: 'text', nullable: true })
  creationTimestamp?: string;

  @Column({ type: 'simple-json', nullable: true })
  rawData?: any; // Full dump

  @CreateDateColumn({ type: 'datetime' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'datetime' })
  updatedAt!: Date;
}
