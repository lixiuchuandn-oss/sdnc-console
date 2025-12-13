import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, ManyToOne } from 'typeorm';
import { CloudEnterpriseNetwork } from './CloudEnterpriseNetwork';
import { VpcNetwork } from './VpcNetwork';
import { InfoDomain } from './InfoDomain';

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

  // 关联信息域（用于前端渲染来自 /api/info-domains 的分类/子类等字段）
  @Column({ type: 'text', nullable: true })
  infoDomainId?: string;

  @ManyToOne(() => InfoDomain)
  infoDomain?: InfoDomain;

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