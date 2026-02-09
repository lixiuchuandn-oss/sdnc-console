import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { ACLGroup } from './ACLGroup';

export enum ACLAction {
  PERMIT = 'permit',
  DENY = 'deny',
}

export enum ACLProtocol {
  TCP = 'tcp',
  UDP = 'udp',
  ICMP = 'icmp',
  ANY = 'any',
}

@Entity()
export class ACLRule {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  name!: string;

  @Column({ nullable: true })
  description!: string;

  // VR Instance ID (Optional if part of a Group)
  @Column({ nullable: true })
  vrId!: string;

  @Column({ nullable: true })
  groupId!: string;

  @ManyToOne(() => ACLGroup, (group) => group.rules, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'groupId' })
  group!: ACLGroup;

  @Column({ type: 'int', default: 100 })
  priority!: number;

  @Column({
    type: 'simple-enum',
    enum: ACLAction,
    default: ACLAction.PERMIT,
  })
  action!: ACLAction;

  @Column({
    type: 'simple-enum',
    enum: ACLProtocol,
    default: ACLProtocol.ANY,
  })
  protocol!: ACLProtocol;

  @Column({ nullable: true })
  sourceIp!: string; // CIDR or IP

  @Column({ nullable: true })
  destinationIp!: string; // CIDR or IP

  @Column({ nullable: true })
  sourcePort!: string; // range or single

  @Column({ nullable: true })
  destinationPort!: string; // range or single

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
