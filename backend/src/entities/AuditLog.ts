import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
} from 'typeorm';

export enum AuditLogStatus {
  SUCCESS = 'SUCCESS',
  FAILED = 'FAILED',
}

@Entity('audit_logs')
export class AuditLog {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ nullable: true })
  userId?: string;

  @Column({ nullable: true })
  username?: string;

  @Column()
  action!: string; // e.g., 'CREATE', 'UPDATE', 'DELETE', 'LOGIN'

  @Column({ nullable: true })
  resourceType?: string; // e.g., 'VM', 'User', 'Network'

  @Column({ nullable: true })
  resourceId?: string; // ID of the affected resource

  @Column({ type: 'text', nullable: true })
  details?: string; // Additional info, e.g., diff or request body

  @Column({ nullable: true })
  ipAddress?: string;

  @Column({
    type: 'simple-enum',
    enum: AuditLogStatus,
    default: AuditLogStatus.SUCCESS,
  })
  status!: AuditLogStatus;

  @CreateDateColumn()
  createdAt!: Date;
}
