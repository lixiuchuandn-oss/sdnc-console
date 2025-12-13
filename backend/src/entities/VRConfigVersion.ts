import { Entity, PrimaryGeneratedColumn, Column, Index, CreateDateColumn, UpdateDateColumn } from 'typeorm';

@Entity({ name: 'vr_config_version' })
export class VRConfigVersion {
  @PrimaryGeneratedColumn()
  id!: number;

  @Index()
  @Column({ type: 'varchar', length: 128 })
  uuid!: string;

  @Index()
  @Column({ type: 'varchar', length: 10 })
  role!: string; // 角色：PE/CE/标准/SASE（统一大写）

  @Column({ type: 'text' })
  config_json!: string; // 配置JSON字符串

  @CreateDateColumn({ type: 'datetime' })
  created_at!: Date;

  @UpdateDateColumn({ type: 'datetime' })
  updated_at!: Date;
}