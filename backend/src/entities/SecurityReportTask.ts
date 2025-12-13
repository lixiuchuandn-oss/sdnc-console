import { Entity, PrimaryColumn, Column } from 'typeorm';

@Entity({ name: 'security_report_tasks' })
export class SecurityReportTask {
  @PrimaryColumn({ type: 'text' })
  id!: string;

  @Column({ type: 'text' })
  lineId!: string;

  @Column({ type: 'text' })
  status!: 'pending' | 'running' | 'succeeded' | 'failed' | 'canceled';

  @Column({ type: 'integer', default: 0 })
  percent!: number;

  @Column({ type: 'text', nullable: true })
  message?: string;

  @Column({ type: 'text', nullable: true })
  response?: string; // JSON string

  @Column({ type: 'text', nullable: true })
  difyTaskId?: string;

  @Column({ type: 'text', nullable: true })
  filePath?: string;

  @Column({ type: 'text', nullable: true })
  fileName?: string;

  @Column({ type: 'text', nullable: true })
  reportFolderId?: string;

  @Column({ type: 'integer' })
  createdAt!: number;

  @Column({ type: 'integer' })
  updatedAt!: number;

  @Column({ type: 'integer', default: 0 })
  canceled!: number; // 0/1
}