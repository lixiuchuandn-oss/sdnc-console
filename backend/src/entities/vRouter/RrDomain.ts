import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { RrDomainNode } from './RrDomainNode';
import type { RrDomainSource, RrDomainStatus } from './rrDomain.types';

@Entity({ name: 'rr_domain' })
export class RrDomain {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** 域标识 slug（Excel「域标识」） */
  @Index({ unique: true })
  @Column({ type: 'varchar', length: 128 })
  name!: string;

  @Column({ type: 'varchar', length: 256 })
  displayName!: string;

  @Column({ type: 'text', nullable: true })
  description?: string | null;

  @Column({ type: 'int' })
  remoteAs!: number;

  @Column({ type: 'int', nullable: true })
  localAs?: number | null;

  @Column({ type: 'varchar', length: 32, default: 'manual' })
  source!: RrDomainSource;

  @Column({ type: 'varchar', length: 32, default: 'active' })
  status!: RrDomainStatus;

  @OneToMany(() => RrDomainNode, (node) => node.domain, { cascade: true })
  nodes!: RrDomainNode[];

  @CreateDateColumn({ type: 'datetime' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'datetime' })
  updatedAt!: Date;
}
