import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { NATAddressGroup } from './NATAddressGroup';

@Entity()
export class NATStaticMapping {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  addressGroupId!: string;

  @ManyToOne(() => NATAddressGroup, (group) => group.mappings, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'addressGroupId' })
  addressGroup!: NATAddressGroup;

  @Column({ default: 'tcp' })
  proto!: string;

  @Column()
  inside!: string;

  @Column({ type: 'int' })
  localPort!: number;

  @Column()
  outside!: string;

  @Column({ type: 'int' })
  externalPort!: number;

  @Column({ nullable: true })
  vrf!: string;

  @Column({ nullable: true })
  twiceNat!: string;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
