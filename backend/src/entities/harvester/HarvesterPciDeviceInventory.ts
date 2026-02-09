import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

@Entity('harvester_pci_device_inventory')
export class HarvesterPciDeviceInventory {
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
  nodeName?: string;

  @Column({ type: 'text', nullable: true })
  address?: string;

  @Column({ type: 'text', nullable: true })
  vendorName?: string;

  @Column({ type: 'text', nullable: true })
  productName?: string;

  @Column({ type: 'text', nullable: true })
  vendorId?: string;

  @Column({ type: 'text', nullable: true })
  productId?: string;

  @Column({ type: 'text', nullable: true })
  classId?: string;

  @Column({ type: 'text', nullable: true })
  description?: string;

  @Column({ type: 'simple-json', nullable: true })
  rawData?: any;

  @CreateDateColumn({ type: 'datetime' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'datetime' })
  updatedAt!: Date;
}
