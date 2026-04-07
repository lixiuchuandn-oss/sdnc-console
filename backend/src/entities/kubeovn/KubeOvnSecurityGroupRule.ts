import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { KubeOvnSecurityGroup } from './KubeOvnSecurityGroup';

@Entity('kube_ovn_security_group_rules')
export class KubeOvnSecurityGroupRule {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'text' })
  securityGroupId!: string;

  @ManyToOne(() => KubeOvnSecurityGroup, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'securityGroupId' })
  securityGroup!: KubeOvnSecurityGroup;

  @Column({ type: 'integer' })
  priority!: number;

  @Column({ type: 'text' })
  direction!: string;

  @Column({ type: 'text' })
  action!: string;

  @Column({ type: 'text' })
  match!: string;

  @CreateDateColumn({ type: 'datetime' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'datetime' })
  updatedAt!: Date;
}
