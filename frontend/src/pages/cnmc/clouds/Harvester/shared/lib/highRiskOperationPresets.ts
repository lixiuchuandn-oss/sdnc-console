/** Cloudmap / Harvester 高风险操作 — 默认风险提示文案 */

export const HIGH_RISK_ACK_DEFAULT =
  '我已了解上述影响，确认本次操作由本人发起，而非误触。';

export const DELETE_RISK_ITEMS = [
  '删除后通常不可恢复，或需通过备份/回收站等特殊路径才能恢复。',
  '请确认目标对象名称、命名空间及关联业务无误后再继续。',
] as const;

export const DELETE_NAMESPACE_RISK_ITEMS = [
  '删除后不可恢复；命名空间内资源将被级联清理。',
  '请确认集群内已无虚拟机、卷及其他重要资源。',
] as const;

export const DELETE_NETWORK_RISK_ITEMS = [
  '可能导致虚拟机或容器断网、负载均衡流量中断。',
  '若仍有资源引用，集群可能拒绝删除或留下不一致状态。',
] as const;

export const DELETE_STORAGE_RISK_ITEMS = [
  '可能导致数据不可恢复或影响依赖该存储的业务。',
  '请确认无虚拟机、Pod 或备份任务仍引用该资源。',
] as const;

export const FORCE_DELETE_VM_RISK_ITEMS = [
  '虚拟机将被永久删除，无法从回收站恢复。',
  '勾选同步删除卷时，关联 PVC 数据将一并清除且不可找回。',
] as const;

export const VM_RECYCLE_RISK_ITEMS = [
  '虚拟机将移入回收站；运行中的实例会被强制终止。',
  '默认不删除关联数据卷；彻底删除请在回收站中操作。',
] as const;

export const NODE_MAINTENANCE_RISK_ITEMS = [
  '节点将被 cordon，工作负载将按策略热迁移或关机。',
  '强制模式将关机节点上全部虚拟机，并覆盖 maintain-mode-strategy。',
] as const;

export const CHANGE_OS_RISK_ITEMS = [
  '将删除当前系统盘并重建实例，系统盘数据将会丢失。',
  '虚拟机须重启后新系统盘才会生效；请在业务低峰期执行。',
] as const;

export const DRS_RULE_RISK_ITEMS = [
  '规则生效后，指标超阈值可能触发集群自动热迁移。',
  '删除规则后集群将不再按该策略自动调度迁移。',
] as const;

export const CEPH_STORAGE_RISK_ITEMS = [
  '可能影响集群存储可用性与业务 I/O。',
  '配置错误可能导致长时间不可用或数据迁移/重建。',
] as const;

export const CEPH_STORAGE_NETWORK_CHANGE_RISK_ITEMS = [
  '变更存储网一般仅对新部署或扩容生效，已有数据路径不会自动切换。',
  '配置错误可能导致存储集群部署失败或长时间不可用。',
] as const;

export const SDRS_POLICY_RISK_ITEMS = [
  '策略变更将影响自动迁盘触发条件与调度行为。',
  '半自动/自动模式下，错误阈值可能导致频繁迁盘或难以及时触发调度。',
] as const;

export const CONTAINER_DELETE_RISK_ITEMS = [
  '可能导致业务中断；Deployment 等控制器可能自动重建 Pod。',
  '删除 Service / Ingress / Gateway 将切断对应流量入口。',
] as const;

export const VM_RESTART_RISK_ITEMS = [
  '虚拟机将重启，运行中的业务会短暂中断。',
  '请在业务低峰期执行，并确认关键数据已持久化。',
] as const;

export const VM_ABORT_MIGRATION_RISK_ITEMS = [
  '将中止当前热迁移任务，虚拟机可能停留在迁移中间状态。',
  '请确认迁移异常后再执行；必要时联系运维检查节点与存储。',
] as const;

export const VOLUME_DETACH_RISK_ITEMS = [
  '将从云主机卸载云盘，应用可能无法继续访问该卷。',
  '若虚机内未正确 umount，可能导致文件系统损坏。',
] as const;

export const CONTAINER_SCALE_RISK_ITEMS = [
  '副本数变更将立即影响运行中的 Pod 数量，缩容可能导致业务容量下降。',
  '缩容至 0 将停止该工作负载对外提供服务。',
] as const;

export const CLUSTER_COMPONENT_INSTALL_RISK_ITEMS = [
  '将在集群中安装或变更控制器组件，可能影响网关与南北向流量。',
  '请确认目标集群与命名空间无误，并在维护窗口执行。',
] as const;

export const POD_EVICT_RISK_ITEMS = [
  '将触发 Pod 驱逐；若 PDB 不允许，操作会被集群拒绝。',
  '可能导致副本数暂时下降或服务可用性波动。',
] as const;
