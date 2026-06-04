import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import type {
  Srv6EndpointFingerprint,
  Srv6InjectedDelta,
  Srv6RdRtMeta,
} from './srv6Tunnel.types';

export enum SRv6Status {
  CREATING = 'creating',
  AVAILABLE = 'available',
  DEGRADED = 'degraded',
  DEPLOYING = 'deploying',
  ERROR = 'error',
}

@Entity('srv6_tunnels')
export class SRv6Tunnel {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  name!: string;

  @Column()
  peA!: string;

  @Column()
  peB!: string;

  @Column()
  ceA!: string;

  @Column()
  ceB!: string;

  @Column({
    type: 'simple-enum',
    enum: SRv6Status,
    default: SRv6Status.CREATING,
  })
  status!: SRv6Status;

  /** PE-A 内网口（关系档案） */
  @Column({ type: 'text', nullable: true })
  peAInnerIf?: string | null;

  @Column({ type: 'text', nullable: true })
  peBInnerIf?: string | null;

  @Column({ type: 'simple-json', nullable: true })
  rdRtMeta?: Srv6RdRtMeta | null;

  /** 各 VR 注入条目清单，删除回退依据 */
  @Column({ type: 'simple-json', nullable: true })
  injectedDelta?: Srv6InjectedDelta | null;

  /** 创建/更新时端点关键字段指纹，漂移检测依据 */
  @Column({ type: 'simple-json', nullable: true })
  endpointFingerprint?: Srv6EndpointFingerprint | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
