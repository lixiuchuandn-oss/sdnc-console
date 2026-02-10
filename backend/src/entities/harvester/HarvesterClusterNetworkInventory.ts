import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

@Entity()
@Index(['cloudId', 'name'], { unique: true })
export class HarvesterClusterNetworkInventory {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  cloudId!: string;

  @Column()
  name!: string;

  @Column({ nullable: true, type: 'text' })
  description!: string;

  @Column({ type: 'simple-json', nullable: true })
  labels!: any;

  @Column({ type: 'simple-json', nullable: true })
  annotations!: any;

  @Column({ type: 'simple-json', nullable: true })
  links!: any;

  @Column({ type: 'simple-json', nullable: true })
  uplinks!: any; // New column for storing uplink/nic configuration

  @Column({ type: 'simple-json', nullable: true })
  rawData!: any;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
