import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToMany,
  JoinTable,
} from 'typeorm';
import { Cloud } from './Cloud';

export enum UserRole {
  SUPER_ADMIN = 'super_admin',
  ADMIN = 'admin',
  TENANT = 'tenant',
}

export enum UserStatus {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
  SUSPENDED = 'suspended',
}

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ unique: true })
  username!: string;

  @Column({ unique: true })
  email!: string;

  @Column()
  password!: string;

  @Column()
  fullName!: string;

  @Column({
    type: 'simple-enum',
    enum: UserRole,
    default: UserRole.TENANT,
  })
  role!: UserRole;

  @Column({
    type: 'simple-enum',
    enum: UserStatus,
    default: UserStatus.ACTIVE,
  })
  status!: UserStatus;

  @Column({ nullable: true })
  phone?: string;

  @Column({ nullable: true })
  company?: string;

  @Column({ type: 'text', nullable: true })
  description?: string;

  @ManyToMany(() => Cloud)
  @JoinTable({
    name: 'user_clouds',
    joinColumn: { name: 'user_id', referencedColumnName: 'id' },
    inverseJoinColumn: { name: 'cloud_id', referencedColumnName: 'id' },
  })
  accessibleClouds!: Cloud[];

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;

  @Column({ nullable: true })
  lastLoginAt?: Date;

  /** 管理员密码最后修改时间；用于密码有效期。存量用户可为空，按 createdAt 推算 */
  @Column({ type: 'datetime', nullable: true })
  passwordChangedAt?: Date | null;
}
