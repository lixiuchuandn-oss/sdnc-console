import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum SRv6Status {
  CREATING = 'creating',
  AVAILABLE = 'available',
}

@Entity('srv6_tunnels')
export class SRv6Tunnel {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  name!: string;

  @Column()
  peA!: string;

  @Column()
  peB!: string;

  @Column()
  ceA!: string;

  @Column()
  ceB!: string;

  @Column({
    type: 'simple-enum',
    enum: SRv6Status,
    default: SRv6Status.CREATING,
  })
  status!: SRv6Status;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
