import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

/** @deprecated 早期 admin 自服务模型遗留表，当前云桌面用户使用 cloud_desktop_users */
@Entity('guacamole_user_bindings')
@Index(['instanceId', 'platformUserId'], { unique: true })
@Index(['instanceId', 'guacamoleUsername'], { unique: true })
export class GuacamoleUserBinding {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  instanceId!: string;

  /** Tower 系统用户 User.id（super_admin / admin） */
  @Column()
  platformUserId!: string;

  @Column({ length: 128 })
  guacamoleUsername!: string;

  @Column({ length: 512 })
  passwordEncrypted!: string;

  @Column({ length: 32, default: 'active' })
  status!: string;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
