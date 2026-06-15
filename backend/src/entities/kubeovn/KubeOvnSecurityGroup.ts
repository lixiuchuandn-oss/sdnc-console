import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  Unique,
} from 'typeorm';

/**
 * Kube-OVN 子网安全组（遗留 SQLite；权威数据源为集群 SecurityGroup CR：securitygroups.hms.rivercloud.com）
 */
@Entity('kube_ovn_security_groups')
@Unique('UQ_kube_ovn_sg_cloud_subnet_name', ['cloudId', 'subnetName', 'name'])
export class KubeOvnSecurityGroup {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'text' })
  cloudId!: string;

  @Column({ type: 'text' })
  name!: string;

  @Column({ type: 'text', nullable: true })
  description?: string;

  /** Kube-OVN Subnet metadata.name */
  @Index()
  @Column({ type: 'text' })
  subnetName!: string;

  @CreateDateColumn({ type: 'datetime' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'datetime' })
  updatedAt!: Date;
}
