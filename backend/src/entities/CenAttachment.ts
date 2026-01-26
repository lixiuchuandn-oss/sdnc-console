import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { CloudEnterpriseNetwork } from './CloudEnterpriseNetwork';
import { VpcNetwork } from './VpcNetwork';
import { SecurityDomain } from './SecurityDomain';

export enum CenAttachmentStatus {
  ATTACHING = 'attaching',
  ATTACHED = 'attached',
}

@Entity('cen_attachments')
export class CenAttachment {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  cenId!: string;

  @ManyToOne(() => CloudEnterpriseNetwork)
  cen!: CloudEnterpriseNetwork;

  @Column({ nullable: true })
  vpcId?: string;

  @ManyToOne(() => VpcNetwork)
  vpc?: VpcNetwork;

  // 关联安全域（用于前端渲染来自 /api/security-domains 的分类/子类等字段）
  @Column({ type: 'text', nullable: true })
  securityDomainId?: string;

  @ManyToOne(() => SecurityDomain, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'securityDomainId' })
  securityDomain?: SecurityDomain;

  @Column({
    type: 'simple-enum',
    enum: CenAttachmentStatus,
    default: CenAttachmentStatus.ATTACHING,
  })
  status!: CenAttachmentStatus;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
