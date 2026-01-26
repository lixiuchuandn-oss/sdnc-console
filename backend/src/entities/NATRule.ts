import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum NATType {
  SNAT = 'snat',
  DNAT = 'dnat',
  STATIC = 'static',
}

@Entity()
export class NATRule {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  name!: string;

  @Column({ nullable: true })
  description!: string;

  // VR Instance ID
  @Column()
  vrId!: string;

  @Column({
    type: 'simple-enum',
    enum: NATType,
    default: NATType.SNAT,
  })
  type!: NATType;

  @Column({ nullable: true })
  interface!: string;

  // Matching criteria
  @Column({ nullable: true })
  originalSourceIp!: string;

  @Column({ nullable: true })
  originalDestinationIp!: string;

  @Column({ nullable: true })
  originalSourcePort!: string;

  @Column({ nullable: true })
  originalDestinationPort!: string;

  // Action / Translation
  @Column({ nullable: true })
  translatedSourceIp!: string;

  @Column({ nullable: true })
  translatedDestinationIp!: string;

  @Column({ nullable: true })
  translatedSourcePort!: string;

  @Column({ nullable: true })
  translatedDestinationPort!: string;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
