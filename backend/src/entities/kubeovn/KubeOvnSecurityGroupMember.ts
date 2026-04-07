import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
  ManyToOne,
  JoinColumn,
  Unique,
} from 'typeorm';
import { KubeOvnSecurityGroup } from './KubeOvnSecurityGroup';

@Entity('kube_ovn_security_group_members')
@Unique('UQ_kube_ovn_sgm_sg_vm', ['securityGroupId', 'vmNamespace', 'vmName'])
export class KubeOvnSecurityGroupMember {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'text' })
  securityGroupId!: string;

  @ManyToOne(() => KubeOvnSecurityGroup, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'securityGroupId' })
  securityGroup!: KubeOvnSecurityGroup;

  @Column({ type: 'text' })
  vmNamespace!: string;

  @Column({ type: 'text' })
  vmName!: string;

  @CreateDateColumn({ type: 'datetime' })
  createdAt!: Date;
}
