import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

/**
 * 邮件告警接收器：原存储于 Harvester AlertmanagerConfig spec.receivers[]，
 * 现全部保存到本地数据库，不再写入 Harvester 后端。
 */
@Entity('email_receivers')
@Index(['cloudId', 'namespace', 'specReceiverName'], { unique: true })
export class EmailReceiver {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  cloudId!: string;

  @Column()
  namespace!: string;

  @Column()
  specReceiverName!: string;

  /** 收件人，逗号分隔 */
  @Column({ type: 'text', default: '' })
  emailTo!: string;

  @Column({ type: 'varchar', length: 512, default: '' })
  emailFrom!: string;

  @Column({ type: 'varchar', length: 512, nullable: true })
  smarthost?: string;

  @Column({ type: 'varchar', length: 256, nullable: true })
  smtpAuthUsername?: string;

  /** SMTP 密码通过 Secret 引用时，存储 Secret 名称 */
  @Column({ type: 'varchar', length: 256, nullable: true })
  smtpAuthPasswordSecretName?: string;

  @Column({ type: 'varchar', length: 128, nullable: true })
  smtpAuthPasswordSecretKey?: string;

  @Column({ type: 'boolean', default: true })
  smtpRequireTls!: boolean;

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
