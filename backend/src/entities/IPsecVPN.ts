import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

export enum IPsecStatus {
  CREATING = 'creating',
  ACTIVE = 'active',
  INACTIVE = 'inactive',
  ERROR = 'error',
}

@Entity()
export class IPsecVPN {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  name!: string;

  @Column({ nullable: true })
  description!: string;

  @Column({
    type: 'simple-enum',
    enum: IPsecStatus,
    default: IPsecStatus.CREATING
  })
  status!: IPsecStatus;

  // Local Network
  @Column()
  vrId!: string;

  @Column({ nullable: true })
  localVrName!: string;

  @Column({ nullable: true })
  localPublicIp!: string;

  @Column({ nullable: true })
  localPrivateIp!: string;

  @Column()
  localSubnet!: string;

  // Remote Network
  @Column({ nullable: true })
  peerVrId!: string;

  @Column({ nullable: true })
  peerVrName!: string;

  @Column()
  remoteGateway!: string;

  @Column({ nullable: true })
  remotePrivateIp!: string;

  @Column()
  remoteSubnet!: string;

  // Security Params
  @Column()
  psk!: string;

  @Column({ default: 'v2' })
  ikeVersion!: string;

  @Column({ default: 'aes-256' })
  encryption!: string;

  @Column({ default: 'sha256' })
  authentication!: string;

  @Column({ default: '14' })
  dhGroup!: string;

  @Column({ default: 'group14' })
  pfs!: string;

  @Column({ default: 'tunnel' })
  mode!: string;
  
  @Column({ type: 'boolean', default: false })
  natTraversal!: boolean;
  
  @Column({ type: 'boolean', default: true })
  dpd!: boolean;
  
  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
