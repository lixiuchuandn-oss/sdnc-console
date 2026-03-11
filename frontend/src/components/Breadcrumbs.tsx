import React from 'react';
import { HomeOutlined } from '@ant-design/icons';

export type Crumb = { label: React.ReactNode; href?: string };

export const bc = {
  home: (): Crumb => ({ label: <HomeOutlined />, href: '/' }),
  computeCenter: (): Crumb => ({ label: 'CNMC' }),
  resourceConsole: (): Crumb => ({ label: '资源控制台' }),
  resourceConsolePro: (): Crumb => ({ label: '资源控制台pro', href: '/admin/clouds/console' }),
  cloudsIndex: (): Crumb => ({ label: '资源池管理', href: '/admin/clouds' }),
  networks: (): Crumb => ({ label: '跨域互联' }),
  vrIndex: (): Crumb => ({ label: 'VR实例管理', href: '/admin/interconnect/vr' }),
  vrExpert: (): Crumb => ({ label: '专家模式' }),
  vrRoleWizard: (): Crumb => ({ label: '设置角色' }),
  srv6Index: (): Crumb => ({ label: 'SRv6 隧道管理' }),
  ipsecIndex: (): Crumb => ({ label: 'IPsec 管理' }),
  accessCenter: (): Crumb => ({ label: '权限管控' }),
  accessPolicies: (): Crumb => ({ label: '授权策略', href: '/admin/access/policies' }),
  accessActions: (): Crumb => ({ label: '权限原子', href: '/admin/access/actions' }),
  accessRoles: (): Crumb => ({ label: '角色管理', href: '/admin/access/roles' }),
  accessUsers: (): Crumb => ({ label: '用户管理', href: '/admin/access/users' }),
};

export const build = (...crumbs: Crumb[]): Crumb[] => crumbs;

 

export default bc;
