/**
 * ==============================================================================
 * 模块名称: 容器网络配置类型定义
 * 文件路径: frontend/src/pages/cnmc/clouds/Harvester/containers/types.ts
 * ==============================================================================
 * 
 * [功能描述]
 * 定义容器网络配置相关的 TypeScript 类型，用于工作负载创建时的网络配置。
 * 
 * [网络模式]
 * - none: 默认网络（Pod 网络）
 * - flat_subnet: 扁平子网（Harvester VLAN 网络）
 * - vpc: VPC 子网（Kube-OVN VPC 网络）
 */

// ============================================================
// 网络模式类型
// ============================================================

/**
 * 网络模式
 * - none: 默认 Pod 网络
 * - flat_subnet: 扁平子网（Harvester VLAN 网络）
 * - vpc: VPC 子网（Kube-OVN）
 */
export type NetworkMode = 'none' | 'flat_subnet' | 'vpc';

// ============================================================
// 网络配置接口
// ============================================================

/**
 * 扁平子网配置
 * 用于 Harvester 默认的 VLAN 网络
 */
export interface FlatSubnetConfig {
  /** 子网名称 */
  subnetName: string;
  /** 子网命名空间 */
  subnetNamespace: string;
  /** NAD 引用，格式: <namespace>/<name> */
  nadReference: string;
  /** CIDR 地址块（可选，用于显示） */
  cidr?: string;
  /** 网关地址（可选，用于显示） */
  gateway?: string;
}

/**
 * VPC 子网配置
 * 用于 Kube-OVN VPC 网络
 */
export interface VpcSubnetConfig {
  /** VPC 名称 */
  vpcName: string;
  /** 子网名称 */
  subnetName: string;
  /** 子网命名空间 */
  subnetNamespace: string;
  /** NAD 引用 */
  nadReference: string;
  /** CIDR 地址块（可选，用于显示） */
  cidr?: string;
}

/**
 * 网络配置接口
 * 容器网络配置的完整定义
 */
export interface NetworkConfig {
  /** 网络模式 */
  networkMode: NetworkMode;
  /** 扁平子网配置（networkMode 为 flat_subnet 时使用） */
  flatSubnet?: FlatSubnetConfig;
  /** VPC 子网配置（networkMode 为 vpc 时使用） */
  vpcSubnet?: VpcSubnetConfig;
}

// ============================================================
// 辅助类型
// ============================================================

/**
 * 网络模式选项（用于 UI 选择）
 */
export interface NetworkModeOption {
  value: NetworkMode;
  label: string;
  description: string;
}

/**
 * 预定义的网络模式选项
 */
export const NETWORK_MODE_OPTIONS: NetworkModeOption[] = [
  {
    value: 'none',
    label: '默认网络',
    description: '使用集群默认的 Pod 网络',
  },
  {
    value: 'flat_subnet',
    label: '扁平子网',
    description: 'Harvester VLAN 网络，提供二层连通性',
  },
  {
    value: 'vpc',
    label: 'VPC 子网',
    description: 'Kube-OVN VPC 网络，提供隔离的虚拟网络',
  },
];
