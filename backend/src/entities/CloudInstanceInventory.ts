import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

@Entity('cloud_instance_inventory')
export class CloudInstanceInventory {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'text' })
  cloudId!: string;

  @Index()
  @Column({ type: 'text' })
  provider!: string;

  @Column({ type: 'text' })
  region!: string;

  @Index()
  @Column({ type: 'text' })
  instanceId!: string;

  @Column({ type: 'text', nullable: true })
  instanceName?: string;

  @Column({ type: 'text', nullable: true })
  status?: string;

  @Column({ type: 'text', nullable: true })
  zoneId?: string;

  @Column({ type: 'text', nullable: true })
  instanceType?: string;

  @Column({ type: 'text', nullable: true })
  privateIps?: string; // JSON 数组字符串

  @Column({ type: 'integer', nullable: true })
  cpu?: number;

  @Column({ type: 'integer', nullable: true })
  memoryGb?: number;

  @Column({ type: 'text', nullable: true })
  vpcId?: string;

  @Column({ type: 'text', nullable: true })
  vpcName?: string;

  @Column({ type: 'text', nullable: true })
  vpcCidr?: string;

  @Column({ type: 'text', nullable: true })
  subnetId?: string;

  @Column({ type: 'text', nullable: true })
  subnetName?: string;

  @Column({ type: 'text', nullable: true })
  subnetCidr?: string;

  @Column({ type: 'text', nullable: true })
  networks?: string; // JSON 数组字符串（如 Harvester Multus NAD 名称列表）

  @Column({ type: 'text', nullable: true })
  instanceCreatedAt?: string;

  @CreateDateColumn({ type: 'datetime' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'datetime' })
  updatedAt!: Date;
}
