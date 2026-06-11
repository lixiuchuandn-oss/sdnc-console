import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

export type ImageDownloadTaskStatus =
  | 'pending'
  | 'fetching'
  | 'ready'
  | 'failed'
  | 'cancelled';

@Entity('image_download_tasks')
@Index(['cloudId', 'createdBy', 'createdAt'])
@Index(['taskStatus', 'updatedAt'])
export class ImageDownloadTask {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'text' })
  cloudId!: string;

  @Column({ type: 'text' })
  namespace!: string;

  @Column({ type: 'text' })
  imageName!: string;

  @Column({ type: 'text', nullable: true })
  displayName?: string;

  @Column({ type: 'text', nullable: true })
  filename?: string;

  @Column({ type: 'integer', nullable: true })
  fileSize?: number;

  @Column({ type: 'integer', default: 0 })
  bytesDownloaded!: number;

  /** 相对 imageDownloadTempRoot 的路径 */
  @Column({ type: 'text', nullable: true })
  localFileRelPath?: string;

  @Column({ type: 'text', default: 'pending' })
  taskStatus!: ImageDownloadTaskStatus;

  @Column({ type: 'integer', default: 0 })
  progress!: number;

  @Column({ type: 'text', nullable: true })
  errorMessage?: string;

  @Index()
  @Column({ type: 'text' })
  createdBy!: string;

  @Column({ type: 'datetime', nullable: true })
  expiresAt?: Date;

  @Column({ type: 'datetime', nullable: true })
  startedAt?: Date;

  @Column({ type: 'datetime', nullable: true })
  finishedAt?: Date;

  @CreateDateColumn({ type: 'datetime' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'datetime' })
  updatedAt!: Date;
}
