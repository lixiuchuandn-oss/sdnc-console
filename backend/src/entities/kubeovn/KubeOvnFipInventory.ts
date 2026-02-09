import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

@Entity('kube_ovn_fip_inventory')
export class KubeOvnFipInventory {
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
  namespace?: string; // FIPs usually track which VPC/Pod they belong to implicitly or explicitly

  @Column({ type: 'text', nullable: true })
  vpc?: string;

  @Column({ type: 'text', nullable: true })
  v4Ip?: string; // The Internal IP

  @Column({ type: 'text', nullable: true })
  v4Eip?: string; // The External IP (EIP Name or IP)

  @Column({ type: 'boolean', default: false })
  ready?: boolean;

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
