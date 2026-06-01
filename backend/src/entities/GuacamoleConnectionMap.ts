import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

@Entity('guacamole_connection_maps')
@Index(['cloudId', 'resourceType', 'resourceKey'], { unique: true })
export class GuacamoleConnectionMap {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  instanceId!: string;

  @Column()
  cloudId!: string;

  @Column({ length: 32 })
  resourceType!: string;

  /** vm: namespace/name；bare_metal: system_id */
  @Column({ length: 512 })
  resourceKey!: string;

  @Column({ length: 256 })
  connectionName!: string;

  @Column({ length: 64 })
  guacConnectionId!: string;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
