import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum CloudType {
  CENTRAL = 'central',
  EDGE = 'edge',
  HYBRID = 'hybrid',
  SECURITY_POOL = 'security_pool',
  PRIVATE = 'private',
  VIRTUALIZATION = 'virtualization',
  OBJECT_STORAGE = 'object_storage',
  /** 容器类统一资源池（Rancher 等）；细分子厂商见 config.provider */
  CONTAINER_CLOUD = 'container_cloud',
  /** 历史存量：曾单独使用 rancher 作为 type */
  RANCHER = 'rancher',
}

export enum CloudStatus {
  ONLINE = 'online',
  OFFLINE = 'offline',
  MAINTENANCE = 'maintenance',
}

@Entity('clouds')
export class Cloud {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  name!: string;

  @Column({ type: 'text' })
  description!: string;

  @Column({
    type: 'simple-enum',
    enum: CloudType,
    default: CloudType.CENTRAL,
  })
  type!: CloudType;

  @Column({
    type: 'simple-enum',
    enum: CloudStatus,
    default: CloudStatus.ONLINE,
  })
  status!: CloudStatus;

  @Column()
  region!: string;

  @Column()
  endpoint!: string;

  @Column({ nullable: true })
  accessKey?: string;

  @Column({ nullable: true })
  secretKey?: string;

  @Column({ type: 'json', nullable: true })
  config?: any;

  @Column({ type: 'int', default: 0 })
  totalCpu: number = 0;

  @Column({ type: 'int', default: 0 })
  totalMemory: number = 0;

  @Column({ type: 'int', default: 0 })
  totalStorage: number = 0;

  @Column({ type: 'int', default: 0 })
  usedCpu: number = 0;

  @Column({ type: 'int', default: 0 })
  usedMemory: number = 0;

  @Column({ type: 'int', default: 0 })
  usedStorage: number = 0;

  @Column({ type: 'int', default: 0 })
  vmCount: number = 0;

  @Column({ type: 'int', default: 0 })
  runningVmCount: number = 0;

  @Column({ nullable: true })
  lastSyncAt?: Date;

  @Column({ nullable: true })
  createdBy?: string;

  @Column({ nullable: true })
  lastTestAt?: Date;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
