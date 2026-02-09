import { Entity, PrimaryColumn, Column, UpdateDateColumn } from 'typeorm';

@Entity({ name: 'vr_cache_device' })
export class VRCacheDevice {
  @PrimaryColumn({ type: 'varchar', length: 128 })
  uuid!: string;

  @Column({ type: 'text' })
  data!: string; // JSON string of the Device/Report data

  @UpdateDateColumn({ type: 'datetime' })
  updated_at!: Date;
}
