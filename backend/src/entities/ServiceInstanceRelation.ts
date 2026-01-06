import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';

@Entity('service_instance_relations')
export class ServiceInstanceRelation {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'text' })
  serviceId!: string;

  @Index()
  @Column({ type: 'text' })
  instanceId!: string;

  @Column({ type: 'text' })
  cloudId!: string;

  @CreateDateColumn({ type: 'datetime' })
  createdAt!: Date;
}
