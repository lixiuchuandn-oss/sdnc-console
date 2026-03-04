import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

/**
 * 告警通知策略：本地数据库存储，与 Harvester AlertmanagerConfig 同步
 * 新增、编辑、删除时同步到 Harvester API
 */
@Entity('alert_policies')
@Index(['cloudId', 'namespace', 'policyName'], { unique: true })
export class AlertPolicy {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  cloudId!: string;

  @Column()
  namespace!: string;

  /** 策略名称（AlertmanagerConfig metadata.name） */
  @Column()
  policyName!: string;

  /** 策略描述（metadata.annotations.description） */
  @Column({ type: 'text', default: '' })
  description!: string;

  /** 完整 spec（receivers + route）JSON */
  @Column({ type: 'text' })
  specJson!: string;

  /** metadata 部分 JSON（含 annotations 等） */
  @Column({ type: 'text', default: '{}' })
  metadataJson!: string;

  /** Harvester 返回的 resourceVersion，用于 PUT 更新 */
  @Column({ type: 'varchar', length: 64, nullable: true })
  resourceVersion?: string;

  /** 创建人（当前登录账号名称，来自认证中间件） */
  @Column({ type: 'varchar', length: 255, nullable: true })
  creator?: string;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
