import {
  Column,
  CreateDateColumn,
  Entity,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { IbrHaGroupMember } from './IbrHaGroupMember';

export type IbrHaGroupMode = 'active-standby';
export type IbrHaGroupStatus = 'draft' | 'configured' | 'degraded' | 'unknown';

@Entity({ name: 'ibr_ha_group' })
export class IbrHaGroup {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 128 })
  name!: string;

  @Column({ type: 'text', nullable: true })
  description?: string | null;

  @Column({ type: 'varchar', length: 32, default: 'active-standby' })
  mode!: IbrHaGroupMode;

  /** 组级 VRRP 意图（JSON 字符串）；P1 下发使用 */
  @Column({ type: 'text', nullable: true })
  vrrpIntentJson?: string | null;

  @Column({ type: 'varchar', length: 32, default: 'draft' })
  status!: IbrHaGroupStatus;

  @OneToMany(() => IbrHaGroupMember, (member) => member.group, { cascade: true })
  members!: IbrHaGroupMember[];

  @CreateDateColumn({ type: 'datetime' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'datetime' })
  updatedAt!: Date;
}
