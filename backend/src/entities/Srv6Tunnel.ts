import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum Srv6Status {
  CREATING = 'creating',
  AVAILABLE = 'available',
}

@Entity('srv6_tunnels')
export class Srv6Tunnel {
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
    enum: Srv6Status,
    default: Srv6Status.CREATING,
  })
  status!: Srv6Status;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
