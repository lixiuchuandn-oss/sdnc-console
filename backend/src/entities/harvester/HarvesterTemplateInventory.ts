import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

@Entity('harvester_template_inventory')
export class HarvesterTemplateInventory {
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
  description?: string;

  @Column({ type: 'text', nullable: true })
  defaultVersionId?: string;

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
