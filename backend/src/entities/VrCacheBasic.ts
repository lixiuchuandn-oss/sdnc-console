import { Entity, PrimaryColumn, Column, UpdateDateColumn } from 'typeorm';

@Entity({ name: 'vr_cache_basic' })
export class VrCacheBasic {
  @PrimaryColumn({ type: 'varchar', length: 128 })
  uuid!: string;

  @Column({ type: 'text' })
  data!: string; // JSON string of the VR1 data

  @UpdateDateColumn({ type: 'datetime' })
  updated_at!: Date;
}
