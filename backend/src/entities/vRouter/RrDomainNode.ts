import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { RrDomain } from './RrDomain';

@Entity({ name: 'rr_domain_node' })
@Index(['domainId', 'rrName'], { unique: true })
@Index(['domainId', 'neighborAddress'], { unique: true })
export class RrDomainNode {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'varchar', length: 36 })
  domainId!: string;

  @Column({ type: 'varchar', length: 128 })
  rrName!: string;

  @Column({ type: 'varchar', length: 128 })
  neighborAddress!: string;

  @Column({ type: 'int', nullable: true })
  remoteAs?: number | null;

  @Column({ type: 'int', nullable: true })
  localAs?: number | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  clusterId?: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  routerIdHint?: string | null;

  @Column({ type: 'int', default: 1 })
  priority!: number;

  @Column({ type: 'text', nullable: true })
  remark?: string | null;

  @Column({ type: 'int', default: 0 })
  sortOrder!: number;

  @ManyToOne(() => RrDomain, (domain) => domain.nodes, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'domainId' })
  domain!: RrDomain;

  @CreateDateColumn({ type: 'datetime' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'datetime' })
  updatedAt!: Date;
}
