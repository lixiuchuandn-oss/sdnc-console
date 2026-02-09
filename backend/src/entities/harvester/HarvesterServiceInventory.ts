import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

@Entity('harvester_service_inventory')
export class HarvesterServiceInventory {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'text' })
  cloudId!: string;

  @Index()
  @Column({ type: 'text' })
  uid!: string;

  @Column({ type: 'text' })
  name!: string;

  @Column({ type: 'text', nullable: true })
  namespace?: string;

  @Column({ type: 'simple-json', nullable: true })
  links?: Record<string, string>;

  @Column({ type: 'text', nullable: true })
  type?: string; // ClusterIP, NodePort, LoadBalancer

  @Column({ type: 'text', nullable: true })
  clusterIP?: string;

  @Column({ type: 'simple-json', nullable: true })
  externalIPs?: string[];

  @Column({ type: 'simple-json', nullable: true })
  ports?: Record<string, any>[];

  @Column({ type: 'simple-json', nullable: true })
  selector?: Record<string, string>;

  @Column({ type: 'simple-json', nullable: true })
  labels?: Record<string, string>;

  @Column({ type: 'simple-json', nullable: true })
  annotations?: Record<string, string>;

  @Column({ type: 'simple-json', nullable: true })
  rawData?: any;

  @CreateDateColumn({ type: 'datetime' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'datetime' })
  updatedAt!: Date;
}
