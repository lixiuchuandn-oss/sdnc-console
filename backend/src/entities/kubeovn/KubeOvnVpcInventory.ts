import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

@Entity('kube_ovn_vpc_inventory')
export class KubeOvnVpcInventory {
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

  // VPC is cluster-scoped usually, but check Harvester/Kube-OVN. 
  // In Kube-OVN, VPC is a CRD. It is cluster scoped.
  @Column({ type: 'text', nullable: true })
  namespace?: string; 

  @Column({ type: 'text', nullable: true })
  status?: string;

  @Column({ type: 'simple-json', nullable: true })
  subnets?: string[]; // List of subnet names

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
