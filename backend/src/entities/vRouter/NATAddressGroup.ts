import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
  Unique,
} from 'typeorm';
import { NATStaticMapping } from './NATStaticMapping';

@Entity()
@Unique(['vrId', 'deviceGroupId'])
export class NATAddressGroup {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  vrId!: string;

  /** 设备 JSON 中的 group_id */
  @Column({ type: 'int' })
  deviceGroupId!: number;

  /** 地址池范围，JSON 字符串数组 */
  @Column({ type: 'simple-json', nullable: true })
  range!: string[] | null;

  @OneToMany(() => NATStaticMapping, (mapping) => mapping.addressGroup, { cascade: true })
  mappings!: NATStaticMapping[];

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
