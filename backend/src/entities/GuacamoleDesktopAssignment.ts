import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

@Entity('guacamole_desktop_assignments')
@Index(['desktopUserId', 'cloudId', 'resourceType', 'resourceKey'], { unique: true })
export class GuacamoleDesktopAssignment {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  desktopUserId!: string;

  @Column()
  instanceId!: string;

  @Column()
  cloudId!: string;

  @Column({ length: 32 })
  resourceType!: string;

  @Column({ length: 512 })
  resourceKey!: string;

  @Column({ length: 64 })
  guacConnectionId!: string;

  @Column({ nullable: true })
  assignedByUserId?: string;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
