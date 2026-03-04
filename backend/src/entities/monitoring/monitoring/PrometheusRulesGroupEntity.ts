import { Entity, PrimaryColumn, Column, UpdateDateColumn } from 'typeorm';

/**
 * Prometheus 告警分组：按资源池缓存 rulesGroupMap（groupName -> groupAliasName）
 * 由 GET /:id/monitoring/prometheus-rules 在拉取规则时写入，仅后端使用，不返回给前端。
 */
@Entity('prometheus_rules_group')
export class PrometheusRulesGroup {
  @PrimaryColumn({ type: 'varchar', length: 64 })
  cloudId!: string;

  @Column({ type: 'text', nullable: true })
  data!: string;

  @UpdateDateColumn()
  updatedAt!: Date;
}
