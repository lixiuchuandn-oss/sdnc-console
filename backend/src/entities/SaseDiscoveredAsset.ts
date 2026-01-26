import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

@Entity('sase_discovered_assets')
@Index(['vrUuid', 'ip', 'port'], { unique: true })
export class SaseDiscoveredAsset {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  vrUuid!: string;

  @Column({ nullable: true })
  domainId?: string;

  @Column({ nullable: true })
  cloudId?: string;

  @Column()
  ip!: string;

  @Column({ nullable: true })
  port?: string;

  @Column({ nullable: true })
  type?: string;

  @Column({ nullable: true })
  ipType?: string;

  @Column({ nullable: true })
  mac?: string;

  @Column({ nullable: true })
  hostname?: string;

  @Column({ nullable: true })
  os?: string;

  @CreateDateColumn()
  firstSeen!: Date;

  @UpdateDateColumn()
  lastSeen!: Date;

  @Column({ default: 'active' })
  status!: string;
}
