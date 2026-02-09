import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

@Entity('harvester_schedule_vm_backup_inventory')
export class HarvesterScheduleVmBackupInventory {
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

  @Column({ type: 'text' })
  namespace!: string;

  @Column({ type: 'text', nullable: true })
  cron?: string;

  @Column({ type: 'text', nullable: true })
  vmName?: string;

  @Column({ type: 'text', nullable: true })
  retention?: string;

  @Column({ type: 'int', nullable: true })
  maxFailure?: number;

  @Column({ type: 'text', nullable: true })
  status?: string; // e.g. Ready, Suspended

  @Column({ type: 'simple-json', nullable: true })
  links?: Record<string, string>;

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
