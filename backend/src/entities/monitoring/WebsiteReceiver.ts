import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

/**
 * 站内信告警接收器：开通后保存到本地数据库，每个命名空间一条记录。
 */
@Entity('website_receivers')
@Index(['cloudId', 'namespace'], { unique: true })
export class WebsiteReceiver {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  cloudId!: string;

  @Column()
  namespace!: string;

  /** 固定为 website-receiver，与邮件/钉钉结构一致 */
  @Column({ type: 'varchar', length: 64, default: 'website-receiver' })
  specReceiverName!: string;

  /** 创建人（当前登录账号名称，来自认证中间件） */
  @Column({ type: 'varchar', length: 255, nullable: true, default: 'admin' })
  creator?: string;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
