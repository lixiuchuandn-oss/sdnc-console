import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { IbrHaGroup } from './IbrHaGroup';

export type IbrHaGroupMemberRole = 'primary' | 'backup';

@Entity({ name: 'ibr_ha_group_member' })
export class IbrHaGroupMember {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'varchar', length: 36 })
  groupId!: string;

  /** 全局唯一：同一 IBR 实例只能属于一个 HA 组 */
  @Index({ unique: true })
  @Column({ type: 'varchar', length: 128 })
  vrUuid!: string;

  @Column({ type: 'varchar', length: 16 })
  role!: IbrHaGroupMemberRole;

  @Column({ type: 'int', nullable: true })
  vrrpPriority?: number | null;

  @Column({ type: 'int', default: 0 })
  sortOrder!: number;

  @ManyToOne(() => IbrHaGroup, (group) => group.members, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'groupId' })
  group!: IbrHaGroup;

  @CreateDateColumn({ type: 'datetime' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'datetime' })
  updatedAt!: Date;
}
