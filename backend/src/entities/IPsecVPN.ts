import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum IPsecStatus {
  CREATING = 'creating',
  ACTIVE = 'active',
  INACTIVE = 'inactive',
  ERROR = 'error',
}

@Entity({ name: 'vr_ipsec_vpn' })
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
    default: IPsecStatus.CREATING,
  })
  status!: IPsecStatus;

  // Local Network
  @Column()
  localVrId!: string; // Renamed from vrId

  @Column({ nullable: true })
  localVrName!: string;

  @Column({ nullable: true })
  localVrWanName!: string; // New

  @Column({ nullable: true })
  localVrWanIP!: string; // Renamed from localPublicIp

  @Column({ nullable: true })
  localVrWanEIP!: string; // New/Renamed

  @Column({ nullable: true })
  localVrLanName!: string; // New

  @Column({ nullable: true })
  localVrLanIP!: string; // Renamed from localPrivateIp

  @Column()
  localVrLanSubnet!: string; // Renamed from localSubnet

  @Column({ type: 'boolean', default: false })
  localIkeRemoteIpAny!: boolean; // Kept for logic

  // Remote Network (Peer)
  @Column({ nullable: true })
  peerVrId!: string;

  @Column({ nullable: true })
  peerVrName!: string;

  @Column({ nullable: true })
  peerVrWanName!: string; // New

  @Column()
  peerVrWanIP!: string; // Renamed from remoteGateway

  @Column({ nullable: true })
  peerVrWanEIP!: string; // Renamed from remoteEip

  @Column({ nullable: true })
  peerVrLanName!: string; // New

  @Column({ nullable: true })
  peerVrLanIP!: string; // Renamed from remotePrivateIp

  @Column()
  peerVrLanSubnet!: string; // Renamed from remoteSubnet

  @Column({ type: 'boolean', default: false })
  remoteIkeRemoteIpAny!: boolean; // Kept for logic (maybe rename to peerVrIkeRemoteIpAny?) -> Keeping for now to minimize logic drift unless necessary. User didn't specify.

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
