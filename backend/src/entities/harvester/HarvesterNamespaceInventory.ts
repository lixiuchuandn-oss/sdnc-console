import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

@Entity()
@Index(['cloudId', 'name'], { unique: true })
export class HarvesterNamespaceInventory {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  cloudId!: string;

  @Column()
  name!: string;

  @Column({ type: 'simple-json', nullable: true })
  labels!: any;

  @Column({ type: 'simple-json', nullable: true })
  annotations!: any;

  @Column({ type: 'simple-json', nullable: true })
  links!: any;

  @Column({ type: 'simple-json', nullable: true })
  rawData!: any;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
