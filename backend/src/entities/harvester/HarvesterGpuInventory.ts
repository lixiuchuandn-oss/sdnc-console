import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

@Entity('harvester_gpu_inventory')
export class HarvesterGpuInventory {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'text' })
  cloudId!: string;

  // GPU might not have a UID in the same sense if it's just a Node status item, 
  // but if we treat each card as an item, we need a unique key.
  // Harvester uses PCI address or similar.
  @Index()
  @Column({ type: 'text' })
  uid!: string; 

  @Column({ type: 'text' })
  name!: string; // Display name or Device Name

  @Column({ type: 'text' })
  nodeName!: string;

  @Column({ type: 'text', nullable: true })
  address?: string; // PCI Address

  @Column({ type: 'text', nullable: true })
  vendorId?: string;

  @Column({ type: 'text', nullable: true })
  deviceId?: string;

  @Column({ type: 'simple-json', nullable: true })
  labels?: Record<string, string>;

  @Column({ type: 'simple-json', nullable: true })
  rawData?: any;

  @CreateDateColumn({ type: 'datetime' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'datetime' })
  updatedAt!: Date;
}
