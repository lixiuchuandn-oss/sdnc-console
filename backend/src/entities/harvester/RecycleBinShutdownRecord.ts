import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

/**
 * 回收站自动关机记录实体
 * 用于记录定时任务自动关闭回收站中运行虚拟机的操作历史
 */
@Entity('recycle_bin_shutdown_records')
@Index(['cloudId', 'namespace', 'name'])
@Index(['shutdownAt'])
@Index(['status'])
export class RecycleBinShutdownRecord {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'text' })
  cloudId!: string;

  @Column({ type: 'text' })
  cloudName!: string; // 云平台名称，便于查询

  @Column({ type: 'text' })
  namespace!: string;

  @Column({ type: 'text' })
  name!: string;

  @Column({ type: 'text', nullable: true })
  displayName?: string;

  @Column({ type: 'text' })
  instanceId!: string; // 格式: namespace/name

  @Column({ type: 'text' })
  uid!: string; // K8s UID

  @CreateDateColumn({ type: 'datetime' })
  shutdownAt!: Date; // 关机时间

  @Column({ type: 'text' })
  status!: string; // 状态: 'success' | 'failed' | 'skipped'

  @Column({ type: 'text', nullable: true })
  errorMessage?: string; // 错误信息（如果失败）

  @Column({ type: 'text', nullable: true })
  previousStatus?: string; // 关机前的状态

  @Column({ type: 'text', nullable: true })
  taskId?: string; // 任务批次ID，用于关联同一次扫描的所有记录
}
