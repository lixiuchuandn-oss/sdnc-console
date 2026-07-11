import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  Index,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity({ name: 'vr_config' })
export class VRConfig {
  @PrimaryGeneratedColumn()
  id!: number;

  @Index({ unique: true })
  @Column({ type: 'varchar', length: 128 })
  uuid!: string;

  @Column({ type: 'text' })
  config_json!: string; // 完整配置JSON字符串

  /** SRv6 向导基线（Layer 0）；隧道贡献叠加前快照 */
  @Column({ type: 'text', nullable: true })
  srv6BaselineJson?: string | null;

  @Column({ type: 'datetime', nullable: true })
  srv6BaselineAt?: Date | null;

  /** 首次捕获基线时关联的隧道 id */
  @Column({ type: 'varchar', length: 64, nullable: true })
  srv6BaselineTunnelId?: string | null;

  // 新增：角色（PE/CE），可为空
  @Column({ type: 'varchar', length: 10, nullable: true })
  role?: string;

  @Index()
  @Column({ type: 'varchar', length: 64, nullable: true })
  tenantId?: string;

  @Index()
  @Column({ type: 'varchar', length: 64, nullable: true })
  organizationId?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  name?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  deviceFingerprint?: string;

  @Column({ type: 'varchar', length: 128, nullable: true })
  cloudId?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  cloudName?: string;

  @Column({ type: 'varchar', length: 128, nullable: true })
  vmId?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  bindStatus?: string;

  /** 设备 Paas Console 上报的 IBR 管理口 IPv4（不含掩码） */
  @Column({ type: 'varchar', length: 64, nullable: true })
  managementIp?: string;

  @CreateDateColumn({ type: 'datetime' })
  created_at!: Date;

  @UpdateDateColumn({ type: 'datetime' })
  updated_at!: Date;
}
