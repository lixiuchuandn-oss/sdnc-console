import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
} from 'typeorm';
import { ACLRule } from './ACLRule';

@Entity()
export class ACLGroup {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  name!: string;

  @Column({ nullable: true })
  description!: string;

  // The VR this group belongs to.
  // For now, let's assume one VR can have multiple groups,
  // or maybe this group is just a container and we bind it later.
  // The user requirement "Support creating ACL Groups" implies they are entities.
  // "Push... this VR's cached config" implies the VR has associated groups.
  @Column({ nullable: true })
  vrId!: string;

  @OneToMany(() => ACLRule, (rule) => rule.group)
  rules!: ACLRule[];

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
