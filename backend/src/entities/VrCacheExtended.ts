import { Entity, PrimaryColumn, Column, UpdateDateColumn } from 'typeorm';

@Entity({ name: 'vr_cache_extended' })
export class VrCacheExtended {
  @PrimaryColumn({ type: 'varchar', length: 128 })
  uuid!: string;

  @Column({ type: 'text' })
  data!: string; // JSON string of the VR3 data

  @UpdateDateColumn({ type: 'datetime' })
  updated_at!: Date;
}
