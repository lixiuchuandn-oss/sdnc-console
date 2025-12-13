import { Entity, PrimaryGeneratedColumn, Column, Index, CreateDateColumn, UpdateDateColumn } from 'typeorm';

@Entity({ name: 'vr_list_cache' })
export class VRListCache {
  @PrimaryGeneratedColumn()
  id!: number;

  @Index()
  @Column({ type: 'integer' })
  page_num!: number;

  @Index()
  @Column({ type: 'integer' })
  page_size!: number;

  @Column({ type: 'text' })
  data!: string; // 原始列表响应JSON字符串

  @CreateDateColumn({ type: 'datetime' })
  created_at!: Date;

  @UpdateDateColumn({ type: 'datetime' })
  updated_at!: Date;
}