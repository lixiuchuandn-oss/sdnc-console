import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

@Entity('harvester_ssh_key_inventory')
export class HarvesterSshKeyInventory {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'text' })
  cloudId!: string;

  @Index()
  @Column({ type: 'text' })
  uid!: string;

  @Column({ type: 'text' })
  name!: string;

  @Column({ type: 'text' })
  namespace!: string;

  @Column({ type: 'text', nullable: true })
  publicKey?: string;

  @Column({ type: 'text', nullable: true })
  fingerprint?: string;

  @Column({ type: 'simple-json', nullable: true })
  labels?: Record<string, string>;

  @Column({ type: 'simple-json', nullable: true })
  annotations?: Record<string, string>;

  @Column({ type: 'simple-json', nullable: true })
  rawData?: any;

  @CreateDateColumn({ type: 'datetime' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'datetime' })
  updatedAt!: Date;
}
