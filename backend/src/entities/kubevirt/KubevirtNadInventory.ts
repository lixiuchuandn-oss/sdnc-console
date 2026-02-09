import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

@Entity('kubevirt_nad_inventory')
export class KubevirtNadInventory {
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

  @Column({ type: 'simple-json', nullable: true })
  links?: Record<string, string>;

  @Column({ type: 'text', nullable: true })
  config?: string; // JSON string of CNI config

  @Column({ type: 'text', nullable: true })
  type?: string; // e.g. bridge, macvlan

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
