import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

@Entity('kubevirt_volume_inventory')
@Index(['cloudId', 'uid'], { unique: true })
export class KubevirtVolumeInventory {
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
  phase?: string; // Bound, Pending, etc.

  @Column({ type: 'text', nullable: true })
  capacity?: string;

  @Column({ type: 'text', nullable: true })
  storageClassName?: string;

  @Column({ type: 'text', nullable: true })
  volumeMode?: string; // Filesystem, Block

  @Column({ type: 'text', nullable: true })
  accessModes?: string; // ReadWriteOnce, etc.

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
