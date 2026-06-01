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
export class HarvesterNamespace {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  cloudId!: string;

  @Column()
  name!: string;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
