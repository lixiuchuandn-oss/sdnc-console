import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';

/**
 * 删除记录实体
 * 用于记录被删除的虚拟机信息，支持删除保护期和恢复功能
 */
@Entity('deleted_vm_records')
@Index(['cloudId', 'namespace', 'name'], { unique: true })
@Index(['deletedAt'])
@Index(['expiresAt'])
export class DeletedVmRecord {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'text' })
  cloudId!: string;

  @Column({ type: 'text' })
  namespace!: string;

  @Column({ type: 'text' })
  name!: string;

  @Column({ type: 'text' })
  uid!: string; // K8s UID

  @Column({ type: 'text', nullable: true })
  deletedBy?: string; // 删除操作的用户ID

  @Column({ type: 'text', nullable: true })
  reason?: string; // 删除原因

  @Column({ type: 'simple-json', nullable: true })
  vmSnapshot?: any; // VM 的完整快照（用于恢复）

  @Column({ type: 'simple-json', nullable: true })
  labels?: Record<string, string>;

  @Column({ type: 'simple-json', nullable: true })
  annotations?: Record<string, string>;

  @CreateDateColumn({ type: 'datetime' })
  deletedAt!: Date; // 删除时间

  @Column({ type: 'datetime' })
  expiresAt!: Date; // 过期时间（删除时间 + 保护期天数）

  @Column({ type: 'boolean', default: false })
  restored!: boolean; // 是否已恢复

  @Column({ type: 'datetime', nullable: true })
  restoredAt?: Date; // 恢复时间

  @Column({ type: 'text', nullable: true })
  restoredBy?: string; // 恢复操作的用户ID
}
