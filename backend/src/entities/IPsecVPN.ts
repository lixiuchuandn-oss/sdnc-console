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

  // VR Instance ID (Local Gateway)
  @Column()
  vrId!: string;

  @Column()
  localSubnet!: string;

  @Column()
  remoteGateway!: string;

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
  
  @Column({ nullable: true })
  peerVrId!: string;

  // Cached IP Information
  @Column({ nullable: true })
  localPublicIp!: string;

  @Column({ nullable: true })
  localPrivateIp!: string;

  @Column({ nullable: true })
  peerPublicIp!: string;

  @Column({ nullable: true })
  peerPrivateIp!: string;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
