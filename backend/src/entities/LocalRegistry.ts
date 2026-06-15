import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

export enum LocalRegistryStatus {
  DEPLOYING = 'deploying',
  HEALTHY = 'healthy',
  UNHEALTHY = 'unhealthy',
  DELETING = 'deleting',
}

@Entity('local_registries')
export class LocalRegistry {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column()
  cloudId!: string;

  @Column()
  name!: string;

  @Column()
  server!: string;

  @Column()
  namespace!: string;

  @Column({ default: 30500 })
  nodePort!: number;

  @Column({ nullable: true })
  storageSize?: string;

  @Column({ default: false })
  authEnabled!: boolean;

  @Column({ nullable: true })
  username?: string;

  @Column({ nullable: true })
  password?: string;

  @Column({
    type: 'simple-enum',
    enum: LocalRegistryStatus,
    default: LocalRegistryStatus.DEPLOYING,
  })
  status!: LocalRegistryStatus;

  @Column({ nullable: true })
  deploymentName?: string;

  @Column({ nullable: true })
  serviceName?: string;

  @Column({ nullable: true })
  pvcName?: string;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
