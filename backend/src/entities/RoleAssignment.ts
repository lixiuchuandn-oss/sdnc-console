import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('rbac_role_assignments')
export class RoleAssignment {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'role_id' })
  roleId!: string;

  @Column({ type: 'simple-enum', enum: ['system', 'tenant'] })
  userType!: 'system' | 'tenant';

  @Column({ name: 'user_id' })
  userId!: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
