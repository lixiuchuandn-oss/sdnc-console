import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

export type ImageUploadTaskStatus =
  | 'pending'
  | 'ingesting'
  | 'uploaded'
  | 'proxying'
  | 'success'
  | 'failed'
  | 'cancelled';

@Entity('image_upload_tasks')
@Index(['cloudId', 'createdBy', 'createdAt'])
@Index(['taskStatus', 'updatedAt'])
export class ImageUploadTask {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'text' })
  cloudId!: string;

  @Column({ type: 'text' })
  namespace!: string;

  @Column({ type: 'text', nullable: true })
  displayName?: string;

  @Column({ type: 'text', nullable: true })
  imageType?: string;

  @Column({ type: 'text', nullable: true })
  filename?: string;

  @Column({ type: 'integer', nullable: true })
  fileSize?: number;

  /** 本地 qcow2 解析或集群 detail 得到的虚拟容量（字节），供列表即时展示 */
  @Column({ type: 'integer', nullable: true })

  @Column({ type: 'integer', nullable: true })
  chunkSize?: number;

  @Column({ type: 'integer', nullable: true })
  totalChunks?: number;

  /** JSON 数组：已收到的分片 index 列表 */
  @Column({ type: 'text', nullable: true })
  receivedChunksJson?: string;

  /** 相对 imageTaskTempRoot 的合并文件路径 */
  @Column({ type: 'text', nullable: true })
  localFileRelPath?: string;

  @Column({ type: 'text', nullable: true })
  createdImageName?: string;

  @Column({ type: 'text', nullable: true })
  createdImageNamespace?: string;

  @Column({ type: 'text', default: 'pending' })
  taskStatus!: ImageUploadTaskStatus;

  @Column({ type: 'text', default: 'pending' })
  phase!: 'pending' | 'ingesting' | 'uploaded' | 'proxying' | 'finished';

  @Column({ type: 'integer', default: 0 })
  progress!: number;

  @Column({ type: 'integer', default: 0 })
  ingestProgress!: number;

  @Column({ type: 'integer', default: 0 })
  proxyProgress!: number;

  @Column({ type: 'integer', default: 0 })
  bytesUploaded!: number;

  @Column({ type: 'text', nullable: true })
  errorCode?: string;

  @Column({ type: 'text', nullable: true })
  errorMessage?: string;

  @Index()
  @Column({ type: 'text' })
  createdBy!: string;

  @Column({ type: 'datetime', nullable: true })
  expiresAt?: Date;

  @Column({ type: 'integer', default: 0 })
  retryCount!: number;

  @Column({ type: 'datetime', nullable: true })
  startedAt?: Date;

  @Column({ type: 'datetime', nullable: true })
  finishedAt?: Date;

  @CreateDateColumn({ type: 'datetime' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'datetime' })
  updatedAt!: Date;
}
