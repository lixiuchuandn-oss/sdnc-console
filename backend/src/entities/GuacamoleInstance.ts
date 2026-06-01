import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

@Entity('guacamole_instances')
export class GuacamoleInstance {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ length: 100 })
  @Index({ unique: true })
  name!: string;

  @Column({ length: 512 })
  baseUrl!: string;

  @Column({ length: 100 })
  username!: string;

  @Column({ length: 512 })
  passwordEncrypted!: string;

  /** 云桌面用户登录 Guacamole 的统一密码（加密存储） */
  @Column({ length: 512, nullable: true })
  desktopUserPasswordEncrypted?: string;

  @Column({ length: 64, default: 'postgresql' })
  dataSource!: string;

  @Column({ default: false })
  isDefault!: boolean;

  @Column({ length: 32, default: 'unknown' })
  status!: string;

  @Column({ nullable: true })
  lastTestAt?: Date;

  @Column({ nullable: true })
  lastTestMessage?: string;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
