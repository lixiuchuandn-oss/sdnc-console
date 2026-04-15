import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

/**
 * ASW-CTL 物理交换机探测结果缓存（按资源池 + 交换机管理地址唯一）。
 * 成功直连 ASW-CTL 后写入；实时探测失败时可回读末次入库数据。
 */
@Entity('harvester_asw_ctl_switch_inventory')
@Index(['cloudId', 'switchHost'], { unique: true })
export class HarvesterAswCtlSwitchInventory {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'text' })
  cloudId!: string;

  /** SSH 管理地址，与 ASW-CTL JSON instances[].host 一致 */
  @Column({ type: 'text' })
  switchHost!: string;

  @Column({ type: 'text', nullable: true })
  aswCtlBaseUrl?: string;

  @Column({ type: 'text', nullable: true })
  ctlDisplayName?: string;

  @Column({ type: 'text', nullable: true })
  apiVersion?: string;

  @Column({ type: 'text', nullable: true })
  deviceProfile?: string;

  /** 与前端表格行一致（展开后单实例行，含 health/interfaces 等） */
  @Column({ type: 'simple-json', nullable: true })
  rowPayload?: Record<string, any>;

  @Column({ type: 'datetime', nullable: true })
  lastLiveSyncedAt?: Date;

  @CreateDateColumn({ type: 'datetime' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'datetime' })
  updatedAt!: Date;
}
