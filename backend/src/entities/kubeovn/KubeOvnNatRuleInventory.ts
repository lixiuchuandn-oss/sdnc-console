import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

@Entity('kube_ovn_nat_rule_inventory')
export class KubeOvnNatRuleInventory {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'text' })
  cloudId!: string;

  @Index()
  @Column({ type: 'text' })
  uid!: string;

  @Column({ type: 'text' })
  name!: string; // Name of the rule or generated ID

  @Column({ type: 'text', nullable: true })
  vpc?: string;

  @Column({ type: 'text', nullable: true })
  type?: string; // SNAT or DNAT

  @Column({ type: 'text', nullable: true })
  cidr?: string; // Internal CIDR for SNAT

  @Column({ type: 'text', nullable: true })
  eip?: string; // External IP name

  @Column({ type: 'text', nullable: true })
  externalIp?: string; // Resolved External IP

  @Column({ type: 'text', nullable: true })
  internalIp?: string; // For DNAT

  @Column({ type: 'text', nullable: true })
  internalPort?: string; // For DNAT

  @Column({ type: 'text', nullable: true })
  externalPort?: string; // For DNAT

  @Column({ type: 'text', nullable: true })
  protocol?: string;

  @Column({ type: 'simple-json', nullable: true })
  rawData?: any;

  @CreateDateColumn({ type: 'datetime' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'datetime' })
  updatedAt!: Date;
}
