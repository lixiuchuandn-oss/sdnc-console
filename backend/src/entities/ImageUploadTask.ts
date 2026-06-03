import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

export enum UploadTaskStatus {
  PENDING = 'pending',
  PARSING = 'parsing',
  UPLOADING = 'uploading',
  COMPLETED = 'completed',
  FAILED = 'failed',
}

@Entity('registry_image_upload_tasks')
export class ImageUploadTask {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column()
  registryId!: string;

  @Column()
  fileName!: string;

  @Column({ nullable: true })
  targetRepo?: string;

  @Column({ nullable: true })
  targetTag?: string;

  @Column({
    type: 'simple-enum',
    enum: UploadTaskStatus,
    default: UploadTaskStatus.PENDING,
  })
  status!: UploadTaskStatus;

  @Column({ default: 0 })
  totalLayers!: number;

  @Column({ default: 0 })
  uploadedLayers!: number;

  @Column({ nullable: true })
  currentLayer?: string;

  @Column({ nullable: true, type: 'text' })
  error?: string;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
