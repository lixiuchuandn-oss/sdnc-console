import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

@Entity()
@Index(['cloudId', 'name'], { unique: true })
export class HarvesterVlanConfigInventory {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  cloudId!: string;

  @Column()
  name!: string;

  @Column({ nullable: true, type: 'text' })
  description!: string;

  @Column({ nullable: true })
  clusterNetwork!: string; // The name of the associated ClusterNetwork

  @Column({ type: 'simple-json', nullable: true })
  nodeSelector!: any; // spec.nodeSelector

  @Column({ type: 'simple-json', nullable: true })
  uplink!: any; // spec.uplink

  @Column({ type: 'simple-json', nullable: true })
  labels!: any;

  @Column({ type: 'simple-json', nullable: true })
  annotations!: any;

  @Column({ type: 'simple-json', nullable: true })
  rawData!: any;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
