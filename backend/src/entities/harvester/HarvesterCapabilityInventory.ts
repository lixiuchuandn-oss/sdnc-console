import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

@Entity('harvester_capability_inventory')
@Index(['cloudId', 'name'], { unique: true })
export class HarvesterCapabilityInventory {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'text' })
  cloudId!: string;

  @Column({ type: 'text', unique: false }) // Explicitly disable unique constraint to override legacy schema
  name!: string; // e.g. 'harvester'

  @Column({ type: 'text', nullable: true })
  version?: string;

  @Column({ type: 'simple-json', nullable: true })
  features?: any;

  @Column({ type: 'simple-json', nullable: true })
  rawData?: any;

  @CreateDateColumn({ type: 'datetime' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'datetime' })
  updatedAt!: Date;
}
