import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

@Entity('cloud_desktop_users')
export class CloudDesktopUser {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ length: 64, unique: true })
  username!: string;

  @Column({ length: 100 })
  fullName!: string;

  @Column({ length: 100, nullable: true })
  email?: string;

  @Column({
    type: 'simple-enum',
    enum: ['active', 'inactive'],
    default: 'active',
  })
  status!: 'active' | 'inactive';

  /** Guacamole 登录用户名（与 username 一致或规范化后） */
  @Column({ length: 128 })
  guacamoleUsername!: string;

  @Column({ nullable: true })
  instanceId?: string;

  @Column({ length: 32, default: 'pending' })
  syncStatus!: string;

  @Column({ nullable: true })
  lastSyncAt?: Date;

  @Column({ type: 'text', nullable: true })
  lastSyncMessage?: string;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
