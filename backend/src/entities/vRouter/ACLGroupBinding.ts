import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { ACLGroup } from './ACLGroup';

@Entity()
@Index(['aclGroupId', 'vrId'], { unique: true })
export class ACLGroupBinding {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  aclGroupId!: string;

  @Column()
  vrId!: string;

  @ManyToOne('ACLGroup', 'bindings', { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'aclGroupId' })
  aclGroup!: ACLGroup;

  @CreateDateColumn()
  createdAt!: Date;
}
