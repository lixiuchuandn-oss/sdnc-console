import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

export type ServiceType = 'vm' | 'container' | 'mixed';
export type ServiceStatus = 'running' | 'stopped' | 'degraded';

@Entity('service_catalogs')
export class ServiceCatalog {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'text' })
  name!: string;

  @Column({ type: 'text' })
  domainId!: string;

  @Column({ type: 'text', nullable: true })
  domainName?: string;

  @Column({ type: 'text' })
  type!: ServiceType;

  @Column({ type: 'integer', default: 0 })
  instanceCount!: number;

  @Column({ type: 'text', default: 'running' })
  status!: ServiceStatus;

  @Column({ type: 'text', nullable: true })
  strategies?: string; // 逗号分隔：IBAC,RBAC,ABAC

  @Column({ type: 'text', nullable: true })
  instances?: string; // JSON 字符串数组，保存虚机/容器实例ID

  @CreateDateColumn({ type: 'datetime' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'datetime' })
  updatedAt!: Date;
}