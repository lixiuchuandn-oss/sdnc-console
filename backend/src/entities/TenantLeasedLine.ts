import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('tenant_leased_lines')
export class TenantLeasedLine {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', nullable: true })
  tenantId?: string;

  @Column({ name: 'tenant_name', length: 200 })
  tenantName!: string;

  @Column({ length: 100, nullable: true })
  region?: string;

  @Column({ length: 64 })
  province!: string;

  @Column({ length: 64 })
  city!: string;

  @Column({ length: 100 })
  operator!: string;

  @Column({ type: 'text' })
  ips!: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
