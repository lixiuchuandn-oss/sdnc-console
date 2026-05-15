import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

/**
 * Ceph mgr Dashboard /api/summary 快照（按云 + Rook 命名空间唯一，同步时覆盖更新）。
 * 供运维在 SQLite 中直接查看最近一次拉取的 REST 数据，不依赖前端。
 */
@Entity('ceph_mgr_dashboard_snapshot')
@Index(['cloudId', 'namespace'], { unique: true })
export class CephMgrDashboardSnapshot {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'text' })
  cloudId!: string;

  @Column({ type: 'text', default: 'rook-ceph' })
  namespace!: string;

  @Column({ type: 'text', nullable: true })
  healthStatus?: string | null;

  @Column({ type: 'text', nullable: true })
  mgrId?: string | null;

  /** status.version 摘要，截断存储 */
  @Column({ type: 'text', nullable: true })
  cephVersion?: string | null;

  /** 完整 /api/summary JSON 字符串 */
  @Column({ type: 'text', nullable: true })
  summaryJson?: string | null;

  @Column({ type: 'text', nullable: true })
  fetchError?: string | null;

  @Column({ type: 'integer', nullable: true })
  lastHttpStatus?: number | null;

  @Column({ type: 'datetime', nullable: true })
  fetchedAt?: Date | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
