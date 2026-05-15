import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

export type SecurityDomainType = '业务安全域' | '核心安全域' | '数据域' | '其他';
export type VpcMode = 'existing' | 'new';

@Entity('security_domains')
export class SecurityDomain {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'text' })
  name!: string;

  @Column({ type: 'text', nullable: true })
  type?: SecurityDomainType;

  // 云资源绑定信息
  @Column({ type: 'text', nullable: true })
  cloudId?: string;

  @Column({ type: 'text', nullable: true })
  provider?: string; // 例如: aliyun/aws/gcp

  @Column({ type: 'text', nullable: true })
  region?: string;

  @Column({ type: 'text', nullable: true })
  resourcePool?: string; // 资源池标识

  // VPC 相关
  @Column({ type: 'text', nullable: true })
  vpcMode?: VpcMode; // existing | new

  @Column({ type: 'text', nullable: true })
  vpcId?: string; // 绑定已有 VPC 时的 ID

  @Column({ type: 'text', nullable: true })
  newVpcName?: string; // 新建 VPC 名称

  @Column({ type: 'text', nullable: true })
  newVpcCidr?: string; // 新建 VPC CIDR (IPv4)

  // 通用网络标识（非 VPC 类型可录入）
  @Column({ type: 'text', nullable: true })
  cidr?: string; // 安全域 IPv4 CIDR（IDC/虚拟化/办公网络等）

  // IPv6 网络标识（非 VPC 类型可录入），多个用逗号分隔
  @Column({ type: 'text', nullable: true })
  cidr6?: string; // 安全域 IPv6 CIDR（如 2001:db8::/32），可逗号分隔

  // VR 绑定
  @Column({ type: 'text', nullable: true })
  vrUuid?: string;

  @Column({ type: 'text', nullable: true })
  vrName?: string;

  @Column({ type: 'text', nullable: true })
  vrInstanceIds?: string;

  @Column({ type: 'text', nullable: true })
  vrPublicEniIds?: string;

  @Column({ type: 'text', nullable: true })
  vrPrivateEniIds?: string;

  @Column({ type: 'text', nullable: true })
  vrPublicEip?: string;

  @Column({ type: 'text', nullable: true })
  vrPublicIp?: string;

  @Column({ type: 'text', nullable: true })
  vrPrivateIp?: string;

  @Column({ type: 'text', nullable: true })
  vrPublicSubnetCidr?: string;

  @Column({ type: 'text', nullable: true })
  vrPrivateSubnetCidr?: string;

  // 其他展示字段
  @Column({ type: 'text', nullable: true })
  tags?: string; // 用逗号分隔的标签

  @Column({ type: 'text', nullable: true })
  status?: string; // active/disabled 等

  /** 类型单字段：`kind:子类`（如 vpc:公有云VPC网络 / flat:IDC网络 / container:Rancher容器网络），兼容旧值纯 kind */
  @Column({ type: 'text', nullable: true })
  category?: string;

  @Index()
  @Column({ type: 'text', nullable: true })
  tenantId?: string;

  @Index()
  @Column({ type: 'text', nullable: true })
  organizationId?: string;

  @Column({ type: 'text', nullable: true })
  tenantName?: string;

  @Column({ type: 'text', nullable: true })
  organizationName?: string;

  // Direct Security Service Association (CSM vm_group_id list)
  @Column({ type: 'text', nullable: true })
  securityServiceIds?: string;

  @CreateDateColumn({ type: 'datetime' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'datetime' })
  updatedAt!: Date;
}
