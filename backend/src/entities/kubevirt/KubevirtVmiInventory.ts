import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

@Entity('kubevirt_vmi_inventory')
export class KubevirtVmiInventory {
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
  phase?: string; // status.phase

  @Column({ type: 'text', nullable: true })
  nodeName?: string; // status.nodeName

  @Column({ type: 'simple-json', nullable: true })
  ipAddresses?: string[]; // status.interfaces[].ipAddress or similar

  @Column({ type: 'simple-json', nullable: true })
  interfaces?: any[]; // status.interfaces

  @Column({ type: 'simple-json', nullable: true })
  guestOSInfo?: any; // status.guestOSInfo

  @Column({ type: 'simple-json', nullable: true })
  conditions?: any[]; // status.conditions

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
