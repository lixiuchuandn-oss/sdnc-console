import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

@Entity('kubevirt_storage_class_inventory')
export class KubevirtStorageClassInventory {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'text' })
  cloudId!: string;

  @Index()
  @Column({ type: 'text' })
  uid!: string;

  @Column({ type: 'text', nullable: true })
  name!: string;

  @Column({ type: 'simple-json', nullable: true })
  links?: Record<string, string>;

  @Column({ type: 'text', nullable: true })
  provisioner?: string;

  @Column({ type: 'text', nullable: true })
  reclaimPolicy?: string;

  @Column({ type: 'text', nullable: true })
  volumeBindingMode?: string;

  @Column({ type: 'boolean', nullable: true })
  allowVolumeExpansion?: boolean;

  @Column({ type: 'simple-json', nullable: true })
  parameters?: Record<string, string>;

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
