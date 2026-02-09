import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

@Entity('harvester_usb_inventory')
export class HarvesterUsbInventory {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'text' })
  cloudId!: string;

  // For USB, resourceName is the unique identifier in Harvester configuration
  @Index()
  @Column({ type: 'text' })
  resourceName!: string;

  @Column({ type: 'text', nullable: true })
  name?: string;

  @Column({ type: 'text', nullable: true })
  description?: string;

  @Column({ type: 'text', nullable: true })
  vendorId?: string;

  @Column({ type: 'text', nullable: true })
  productId?: string;

  @Column({ type: 'simple-json', nullable: true })
  rawData?: any;

  @CreateDateColumn({ type: 'datetime' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'datetime' })
  updatedAt!: Date;
}
