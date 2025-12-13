import { Entity, PrimaryGeneratedColumn, Column, Index, CreateDateColumn, UpdateDateColumn } from 'typeorm';

@Entity({ name: 'vr_config' })
export class VRConfig {
  @PrimaryGeneratedColumn()
  id!: number;

  @Index({ unique: true })
  @Column({ type: 'varchar', length: 128 })
  uuid!: string;

  @Column({ type: 'text' })
  config_json!: string; // 完整配置JSON字符串

  // 新增：角色（PE/CE），可为空
  @Column({ type: 'varchar', length: 10, nullable: true })
  role?: string;

  @CreateDateColumn({ type: 'datetime' })
  created_at!: Date;

  @UpdateDateColumn({ type: 'datetime' })
  updated_at!: Date;
}