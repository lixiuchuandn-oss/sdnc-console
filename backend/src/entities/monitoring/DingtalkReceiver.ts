import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

/**
 * 钉钉告警接收器：原存储于 Harvester AlertmanagerConfig spec.receivers[]，
 * 现全部保存到本地数据库，不再写入 Harvester 后端。
 */
@Entity('dingtalk_receivers')
@Index(['cloudId', 'namespace', 'specReceiverName'], { unique: true })
export class DingtalkReceiver {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  cloudId!: string;

  @Column()
  namespace!: string;

  @Column()
  specReceiverName!: string;

  /** 代理 URL（内部 webhook 地址），必填 */
  @Column({ type: 'varchar', length: 512 })
  url!: string;

  @Column({ type: 'varchar', length: 512, nullable: true })
  robotUrl?: string;

  @Column({ type: 'varchar', length: 256, nullable: true })
  robotAccount?: string;

  @Column({ type: 'varchar', length: 512, nullable: true })
  robotAccessToken?: string;

  @Column({ type: 'boolean', default: true })
  sendResolved!: boolean;

  /** 创建人（当前登录账号名称，来自认证中间件） */
  @Column({ type: 'varchar', length: 255, nullable: true })
  creator?: string;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
