import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

/**
 * 告警通知策略与通知对象的关联表
 * 用于快速查询：某策略关联了哪些通知对象、某通知对象被哪些策略引用
 * 使用 email_receivers.id / dingtalk_receivers.id / website_receivers.id 关联，避免 specReceiverName 变更导致关联失效
 */
@Entity('alert_policy_receivers')
@Index(['cloudId', 'namespace', 'policyName', 'receiverType'])
@Index(['cloudId', 'emailReceiverId'])
@Index(['cloudId', 'dingtalkReceiverId'])
@Index(['cloudId', 'websiteReceiverId'])
export class AlertPolicyReceiver {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  cloudId!: string;

  @Column()
  namespace!: string;

  /** 告警通知策略名称（AlertmanagerConfig metadata.name） */
  @Column()
  policyName!: string;

  /** 邮件通知对象 ID（关联 email_receivers.id），与 dingtalkReceiverId/websiteReceiverId 互斥 */
  @Column({ type: 'uuid', nullable: true })
  emailReceiverId?: string;

  /** 钉钉通知对象 ID（关联 dingtalk_receivers.id），与 emailReceiverId/websiteReceiverId 互斥 */
  @Column({ type: 'uuid', nullable: true })
  dingtalkReceiverId?: string;

  /** 站内信通知对象 ID（关联 website_receivers.id），与 emailReceiverId/dingtalkReceiverId 互斥 */
  @Column({ type: 'uuid', nullable: true })
  websiteReceiverId?: string;

  /** 通知类型：email-receiver | dingtalk-receiver | website-receiver */
  @Column({ type: 'varchar', length: 64 })
  receiverType!: string;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
