import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { UserSpace } from './UserSpace';

@Entity('user_space_allocations')
export class UserSpaceAllocation {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'user_space_id' })
  userSpaceId!: string;

  @Column({
    type: 'simple-enum',
    enum: ['cpu', 'memory', 'storage'],
  })
  type!: 'cpu' | 'memory' | 'storage';

  @Column({ type: 'int' })
  cpu!: number;

  @Column({ type: 'int' })
  memory!: number; // GB

  @Column({ type: 'int' })
  storage!: number; // GB

  @Column({ type: 'text', nullable: true })
  description?: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;

  @ManyToOne(() => UserSpace, (userSpace) => userSpace.allocations)
  @JoinColumn({ name: 'user_space_id' })
  userSpace?: UserSpace;
}
